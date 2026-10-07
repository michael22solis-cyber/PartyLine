// One Realtime voice call, driven by its server events. Runs unchanged in the browser (WebRTC data channel), in the
// Twilio bridge and in the server sideband, so the same tested logic handles:
//  - usage capture per response (deduplicated by response id) with latency and generated/heard audio,
//  - transcripts that keep only what the player actually HEARD when they interrupt (memory stays truthful),
//  - the guarded-topic tool (the server approves; the model only asks),
//  - a wrap-up cue, the character hanging up after their goodbye, an idle hang-up and a hard time limit,
//  - never sending a second response.create while one is active (no duplicate responses),
//  - noise-tolerant turn taking (turns.managed): the character is only interrupted by speech that lasts, and coughs,
//    clatters or a stray "mm" are dropped instead of being answered or remembered.
// The host calls tick() about twice a second. Pure ES module: no Node or DOM APIs.

const AUDIO_OUT_TOKENS_PER_SEC = 20; // ~1,200 output audio tokens per spoken minute

export function createCallController({
  send,
  hooks = {},
  mode = 'webrtc', // 'webrtc': OpenAI plays the audio and truncates on barge-in | 'websocket': the host plays audio
  opening = null,
  openingRole = 'system',
  toolName = 'check_guarded_topic',
  timing = {},
  now = () => Date.now(),
  clearedWaitMs = 600,
  transcriptWaitMs = 1500,
  // managed: the session has create_response/interrupt_response off and this controller decides instead.
  // bargeInMs: how long the caller must keep talking over the character before it stops. minTurnMs: shorter sounds
  // only count as a turn if their transcript has real words.
  turns = {},
}) {
  const t = { wrapUpAt: 200, maxSeconds: 240, idleSeconds: 45, goodbyeGraceMs: 1200, ...timing };
  const tt = { managed: false, bargeIn: true, bargeInMs: 500, minTurnMs: 300, ...turns };
  const s = {
    startedAt: null, ended: null, opened: false,
    activeResponse: null, createQueued: null, lastCreatePurpose: null, nextPurpose: null,
    lastActivity: null, userSpeaking: false, speechStoppedAt: null, playing: false, assistantAudioUntil: 0,
    wrapSent: false, wrapPending: false, goodbyeResponse: null, endAt: null,
    responses: new Map(), items: new Map(), handledCalls: new Set(), usageSeen: new Set(), transcribed: new Set(),
    playerLines: [], lastPlayerTranscriptAt: 0,
    speechAt: 0, speechAudioStart: null, turnItem: null, overlap: false, interrupted: false, bargeTimer: null,
    playingResponse: null, discard: new Set(), committed: new Set(), shortTurns: new Map(),
  };
  const stats = { responses: 0, cancelled: 0, interruptedLines: 0, toolCalls: 0, approvals: 0, playerTurns: 0, rejectedCreates: 0, bargeIns: 0, ignoredSounds: 0 };
  const ms = () => now();

  const resp = (id) => {
    if (!id) return null;
    if (!s.responses.has(id)) s.responses.set(id, { id, createdAt: ms(), firstAudioAt: null, items: new Set(), purpose: 'reply' });
    return s.responses.get(id);
  };
  const item = (id) => {
    if (!s.items.has(id)) s.items.set(id, { id });
    return s.items.get(id);
  };

  function createResponse(purpose = 'reply') {
    if (s.ended) return;
    if (s.activeResponse) { s.createQueued = s.createQueued || purpose; return; }
    s.activeResponse = 'pending';
    s.nextPurpose = purpose;
    s.lastCreatePurpose = purpose;
    send({ type: 'response.create' });
  }
  function addSystemNote(text) {
    send({ type: 'conversation.item.create', item: { type: 'message', role: 'system', content: [{ type: 'input_text', text }] } });
  }

  function start() {
    if (s.opened) return;
    s.opened = true;
    s.startedAt = ms();
    s.lastActivity = s.startedAt;
    if (opening) send({ type: 'conversation.item.create', item: { type: 'message', role: openingRole, content: [{ type: 'input_text', text: opening }] } });
    createResponse('opening');
  }

  // ---------- character lines: save only what was heard ----------
  function finalize(itemId, { playedMs = null } = {}) {
    const it = s.items.get(itemId);
    if (!it || it.final || !it.ready || it.transcript == null) return;
    it.final = true;
    let heard = 1;
    if (it.audioEndMs != null && it.generatedMs) heard = it.audioEndMs / it.generatedMs;
    else if (playedMs != null && it.generatedMs) heard = playedMs / it.generatedMs;
    heard = Math.max(0, Math.min(1, heard));
    let text = it.transcript.trim();
    const interrupted = heard < 0.97;
    if (interrupted) {
      stats.interruptedLines += 1;
      const words = text.split(/\s+/);
      const keep = Math.floor(words.length * heard);
      text = keep ? `${words.slice(0, keep).join(' ')}—` : '';
    }
    it.heardMs = Math.round((it.generatedMs || 0) * heard);
    if (text) hooks.transcript?.('character', text, { itemId, interrupted, heardFraction: Number(heard.toFixed(2)) });
    const rec = s.responses.get(it.responseId);
    if (rec && itemsOf(rec.id).every((i) => i.final)) emitUsage(rec);
  }
  // Usage is reported once per response, after we know how much of its audio was actually heard.
  function emitUsage(rec) {
    if (!rec?.pendingUsage || s.usageSeen.has(rec.id)) return;
    s.usageSeen.add(rec.id);
    const heard = itemsOf(rec.id).reduce((sum, i) => sum + (i.heardMs ?? i.generatedMs ?? 0), 0);
    hooks.usage?.({ ...rec.pendingUsage, audioPlayedMs: itemsOf(rec.id).length ? heard : 0 });
    rec.pendingUsage = null;
  }
  const itemsOf = (responseId) => [...s.items.values()].filter((i) => i.responseId === responseId);
  function finalizeResponse(responseId, opts) { for (const it of itemsOf(responseId)) finalize(it.id, opts); }

  // ---------- noise-tolerant turn taking ----------
  const characterAudible = () => (mode === 'webrtc' ? s.playing : ms() < s.assistantAudioUntil);
  const FILLER = new Set(['uh', 'um', 'umm', 'hmm', 'hm', 'mm', 'mhm', 'mmm', 'ah', 'oh', 'eh', 'you', 'huh']);
  const hasWords = (text) => (String(text || '').toLowerCase().match(/[a-z']+/g) || []).some((w) => !FILLER.has(w));

  // Throw a sound away: never answered, never remembered, and removed from the conversation (no tokens re-read).
  function ignoreSound(itemId) {
    stats.ignoredSounds += 1;
    if (!itemId) return;
    s.discard.add(itemId);
    if (s.committed.has(itemId)) send({ type: 'conversation.item.delete', item_id: itemId });
  }

  // The caller has talked over the character long enough: stop the character where the caller heard it stop.
  function interruptCharacter() {
    s.interrupted = true;
    stats.bargeIns += 1;
    if (s.activeResponse && s.activeResponse !== 'pending') send({ type: 'response.cancel' });
    if (mode !== 'webrtc') { hooks.interrupt?.(); return; }
    const rec = s.responses.get(s.playingResponse);
    const played = rec?.playStartedAt ? ms() - rec.playStartedAt : null;
    send({ type: 'output_audio_buffer.clear' });
    // Make sure the model's own history also ends where the caller stopped hearing it.
    if (rec && played != null) {
      setTimeout(() => {
        for (const it of itemsOf(rec.id)) {
          if (it.audioEndMs != null) continue;
          const end = Math.max(0, Math.round(it.generatedMs ? Math.min(played, it.generatedMs) : played));
          send({ type: 'conversation.item.truncate', item_id: it.id, content_index: 0, audio_end_ms: end });
        }
      }, clearedWaitMs);
    }
  }

  function onSpeechStopped(evt) {
    const id = evt.item_id || s.turnItem;
    const dur = evt.audio_end_ms != null && s.speechAudioStart != null ? evt.audio_end_ms - s.speechAudioStart : ms() - s.speechAt;
    // A short sound under the character's voice: noise or an "mm-hm", not a turn.
    if (s.overlap && !s.interrupted && tt.bargeIn && dur < tt.bargeInMs) { ignoreSound(id); return; }
    // Very short: only a turn if it turns out to contain words (decided when its transcript arrives).
    if (dur < tt.minTurnMs) {
      s.shortTurns.set(id, setTimeout(() => { s.shortTurns.delete(id); ignoreSound(id); }, transcriptWaitMs + 2000));
      return;
    }
    createResponse('reply');
  }

  // ---------- the guarded-topic tool ----------
  const recentPlayerText = () => s.playerLines.slice(-3).map((l) => l.text).join(' / ');
  async function waitForTranscript() {
    // The model can call the tool before the caller's last words finish transcribing; wait briefly for them.
    const since = s.speechStoppedAt || 0;
    const until = ms() + transcriptWaitMs;
    while (s.lastPlayerTranscriptAt < since && ms() < until && !s.ended) await new Promise((r) => setTimeout(r, 50));
  }
  async function onToolCall({ call_id: callId, name, arguments: args }) {
    if (!callId || s.handledCalls.has(callId)) return;
    s.handledCalls.add(callId);
    stats.toolCalls += 1;
    let result = { decision: 'stay_guarded', note: 'Nothing to share. Stay in character.' };
    if (name === toolName && hooks.disclose) {
      let topic = '';
      try { topic = JSON.parse(args || '{}').topic || ''; } catch { /* bad args: stay guarded */ }
      await waitForTranscript();
      try { result = (await hooks.disclose(topic, recentPlayerText())) || result; } catch { /* stay guarded */ }
      if (result.decision === 'open_up') stats.approvals += 1;
    }
    if (s.ended) return;
    send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: callId, output: JSON.stringify(result) } });
    createResponse('tool_followup');
  }

  function onResponseDone(r) {
    const id = r?.id;
    const rec = resp(id);
    if (s.activeResponse === id || s.activeResponse === 'pending') s.activeResponse = null;
    stats.responses += 1;
    const status = r?.status || 'completed';
    if (status === 'cancelled') stats.cancelled += 1;
    const usage = r?.usage || null;
    const audioTokens = usage?.output_token_details?.audio_tokens || 0;
    const generatedMs = Math.round((audioTokens / AUDIO_OUT_TOKENS_PER_SEC) * 1000);
    for (const out of r?.output || []) {
      if (out.type === 'function_call') onToolCall(out);
      if (out.type === 'message' && out.id) {
        const it = item(out.id);
        it.responseId = id;
        it.generatedMs = generatedMs;
        if (it.transcript == null) {
          const part = (out.content || []).find((c) => c.transcript != null || c.text != null);
          if (part) it.transcript = part.transcript ?? part.text;
        }
        it.ready = true;
        // Already truncated, or cancelled before any audio played: we know what was heard now.
        if (it.audioEndMs != null || (status === 'cancelled' && !rec?.playStartedAt && mode === 'webrtc')) finalize(it.id, { playedMs: 0 });
      }
    }
    if (id && usage && rec && !s.usageSeen.has(id)) {
      rec.pendingUsage = {
        kind: 'response', responseId: id, status, statusReason: r?.status_details?.reason || r?.status_details?.type || null,
        usage, purpose: rec.purpose || 'reply',
        firstAudioMs: rec.firstAudioAt && rec.triggerAt ? rec.firstAudioAt - rec.triggerAt : null,
        audioGeneratedMs: generatedMs,
      };
      const msgs = itemsOf(id);
      if (!msgs.length || msgs.every((i) => i.final)) emitUsage(rec);
    }
    if (s.wrapSent && rec?.purpose === 'wrap_up' && status === 'completed') {
      s.goodbyeResponse = id;
      s.endAt = Math.max(ms(), s.assistantAudioUntil) + t.goodbyeGraceMs;
    }
    if (s.createQueued) { const p = s.createQueued; s.createQueued = null; createResponse(p); }
    else if (s.wrapPending && !s.userSpeaking) sendWrapUp();
  }

  function sendWrapUp() {
    s.wrapPending = false;
    s.wrapSent = true;
    addSystemNote('(The call is nearly over. Wrap up in story and say goodbye now, in one or two sentences.)');
    createResponse('wrap_up');
  }

  function handle(evt) {
    if (!evt || s.ended) return;
    switch (evt.type) {
      case 'response.created': {
        const rec = resp(evt.response?.id);
        if (!rec) break;
        if (s.nextPurpose) { rec.purpose = s.nextPurpose; rec.triggerAt = ms(); s.nextPurpose = null; }
        else { rec.purpose = 'reply'; rec.triggerAt = s.speechStoppedAt || ms(); } // created by turn detection
        s.activeResponse = rec.id;
        break;
      }
      case 'response.output_item.added':
        if (evt.item?.type === 'message' && evt.item.id) item(evt.item.id).responseId = evt.response_id;
        break;
      case 'response.output_audio.delta':
      case 'response.audio.delta': {
        const rec = resp(evt.response_id);
        if (rec && !rec.firstAudioAt) rec.firstAudioAt = ms();
        if (evt.item_id) item(evt.item_id).responseId ||= evt.response_id;
        s.lastActivity = ms();
        break;
      }
      case 'output_audio_buffer.started': {
        const rec = resp(evt.response_id);
        if (rec) { rec.firstAudioAt ||= ms(); rec.playStartedAt = ms(); s.playingResponse = rec.id; }
        s.playing = true;
        s.lastActivity = ms();
        break;
      }
      case 'output_audio_buffer.stopped': { // everything generated for this response has played
        const rec = resp(evt.response_id);
        s.playing = false;
        s.lastActivity = ms();
        if (rec) finalizeResponse(rec.id);
        if (s.goodbyeResponse) s.endAt = ms() + t.goodbyeGraceMs;
        break;
      }
      case 'output_audio_buffer.cleared': { // barge-in: wait briefly for conversation.item.truncated, else estimate
        const rec = resp(evt.response_id);
        s.playing = false;
        s.lastActivity = ms();
        if (rec) {
          const played = rec.playStartedAt ? ms() - rec.playStartedAt : 0;
          setTimeout(() => finalizeResponse(rec.id, { playedMs: played }), clearedWaitMs);
        }
        break;
      }
      case 'response.output_audio_transcript.done':
      case 'response.audio_transcript.done': {
        const it = item(evt.item_id);
        it.transcript = evt.transcript || '';
        it.responseId ||= evt.response_id;
        break;
      }
      case 'conversation.item.truncated': {
        const it = item(evt.item_id);
        it.audioEndMs = evt.audio_end_ms;
        finalize(evt.item_id);
        break;
      }
      case 'input_audio_buffer.speech_started':
        s.userSpeaking = true;
        s.lastActivity = ms();
        s.speechAt = ms();
        s.speechAudioStart = evt.audio_start_ms ?? null;
        s.turnItem = evt.item_id || null;
        s.overlap = characterAudible();
        s.interrupted = false;
        if (s.endAt) s.endAt = Math.max(s.endAt, ms() + 4000); // let them say goodbye back
        if (tt.managed && s.overlap && tt.bargeIn) {
          clearTimeout(s.bargeTimer);
          s.bargeTimer = setTimeout(() => {
            if (s.userSpeaking && !s.ended && characterAudible()) interruptCharacter();
          }, tt.bargeInMs);
        }
        break;
      case 'input_audio_buffer.speech_stopped':
        s.userSpeaking = false;
        s.speechStoppedAt = ms();
        s.lastActivity = ms();
        clearTimeout(s.bargeTimer);
        if (tt.managed) onSpeechStopped(evt);
        break;
      case 'input_audio_buffer.committed':
      case 'conversation.item.created':
      case 'conversation.item.added': {
        const id = evt.item_id || evt.item?.id;
        if (!id) break;
        s.committed.add(id);
        if (s.discard.has(id)) send({ type: 'conversation.item.delete', item_id: id });
        break;
      }
      case 'conversation.item.input_audio_transcription.completed': {
        if (evt.usage && evt.item_id && !s.transcribed.has(evt.item_id)) {
          s.transcribed.add(evt.item_id);
          hooks.usage?.({ kind: 'transcription', responseId: `tr_${evt.item_id}`, usage: evt.usage });
        }
        const text = String(evt.transcript || '').trim();
        if (s.shortTurns.has(evt.item_id)) { // a very short sound: a turn only if it had words
          clearTimeout(s.shortTurns.get(evt.item_id));
          s.shortTurns.delete(evt.item_id);
          if (hasWords(text)) createResponse('reply'); else ignoreSound(evt.item_id);
        }
        if (!text || s.discard.has(evt.item_id)) break; // noise never reaches memory
        stats.playerTurns += 1;
        s.playerLines.push({ text, at: ms() });
        if (s.playerLines.length > 12) s.playerLines.shift();
        s.lastPlayerTranscriptAt = ms();
        Promise.resolve(hooks.transcript?.('player', text, { itemId: evt.item_id })).then((res) => {
          if (s.ended) return;
          // The engine may approve a guarded topic from the caller's own words: tell the character, quietly.
          for (const note of res?.notes || []) { addSystemNote(note); stats.approvals += 1; }
        }).catch(() => {});
        break;
      }
      case 'response.function_call_arguments.done':
        onToolCall(evt);
        break;
      case 'response.done':
        onResponseDone(evt.response);
        break;
      case 'error': {
        if (evt.error?.code === 'conversation_already_has_active_response') {
          stats.rejectedCreates += 1;
          s.createQueued = s.createQueued || s.lastCreatePurpose || 'reply';
          break;
        }
        hooks.error?.(evt.error);
        break;
      }
      default:
        break;
    }
  }

  // Websocket mode: the host reports when the audio it has queued will have finished playing, or that it was cut off.
  function noteAssistantAudioUntil(untilMs) { s.assistantAudioUntil = Math.max(s.assistantAudioUntil, untilMs); }
  function clearAssistantAudio() { s.assistantAudioUntil = ms(); }

  function tick() {
    if (!s.startedAt || s.ended) return s.ended || null;
    const t0 = ms();
    const secs = (t0 - s.startedAt) / 1000;
    // Websocket mode: lines of finished responses are final once their audio has played out.
    if (mode === 'websocket' && t0 >= s.assistantAudioUntil) {
      for (const it of s.items.values()) if (it.ready && !it.final && it.audioEndMs == null) finalize(it.id);
    }
    if (secs >= t.maxSeconds) { end('max_duration'); return s.ended; }
    const busy = s.activeResponse || s.userSpeaking || s.playing || t0 < s.assistantAudioUntil;
    if (s.endAt && t0 >= s.endAt && !busy) { end('character_hung_up'); return s.ended; }
    if (!s.wrapSent && !s.wrapPending && secs >= t.wrapUpAt) {
      if (busy) s.wrapPending = true;
      else { sendWrapUp(); return null; } // a goodbye is now on its way; don't treat the call as idle
    }
    if (!busy && t.idleSeconds && t0 - s.lastActivity >= t.idleSeconds * 1000) { end('idle'); return s.ended; }
    return null;
  }

  function end(reason) {
    if (s.ended) return;
    // Lines still playing when the call ends: keep what had played so far.
    for (const it of s.items.values()) {
      if (!it.ready || it.final) continue;
      const rec = s.responses.get(it.responseId);
      const played = mode === 'webrtc' && rec?.playStartedAt && !rec.playStoppedAt ? ms() - rec.playStartedAt : null;
      finalize(it.id, { playedMs: played });
    }
    for (const rec of s.responses.values()) emitUsage(rec); // anything still waiting (e.g. no transcript arrived)
    clearTimeout(s.bargeTimer);
    for (const timer of s.shortTurns.values()) clearTimeout(timer);
    s.ended = reason;
    hooks.end?.(reason, summary());
  }

  function summary() {
    return { ...stats, seconds: s.startedAt ? Math.round((ms() - s.startedAt) / 1000) : 0, reason: s.ended };
  }

  return { start, handle, tick, end, summary, noteAssistantAudioUntil, clearAssistantAudio, get state() { return s; } };
}
