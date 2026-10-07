// Bridges Twilio phone calls to an OpenAI Realtime voice model playing a character.
// Flow: phone <-> Twilio Media Stream (μ-law 8 kHz) <-> this server <-> OpenAI Realtime (μ-law in/out).
// Barge-in: we track what Twilio has actually played (marks + media timestamps) and truncate the character's audio
// item at that point, so the model's memory and ours only contain what the caller heard.
import WebSocket from 'ws';
import { CHARACTERS } from '../characters/index.js';
import { streamTwiml, DEAD_LINE_TWIML } from '../twiml.js';
import { playerByPhone, playerByPid } from '../store.js';
import { createCallController } from '../shared/call-controller.js';
import { realtimeSession, callTiming, openingItem } from './session.js';
import { openRealtimeSocket } from './realtime-api.js';
import { openCall, closeCall, callTranscript, callDisclose, callUsage } from './calls.js';
import { ledger } from '../ai/ledger.js';
import { BusyError } from '../ai/limiter.js';

export function registerTwilio(app) {
  const { PUBLIC_HOST, RUTH_NUMBER, CARETAKER_NUMBER } = process.env;
  // Which character answers depends on the number dialed. One number is fine: it goes to Ruth.
  const SUSPECT_LINES = Object.fromEntries(
    [['ruth', RUTH_NUMBER], ['marcus', process.env.MARCUS_NUMBER], ['lily', process.env.LILY_NUMBER], ['teddy', process.env.TEDDY_NUMBER]]
      .filter(([, num]) => num)
      .map(([key, num]) => [num, key]),
  );

  // Inbound calls: set this as the Voice webhook (HTTP POST) on your Twilio number.
  app.post('/voice', async (req, reply) => {
    const to = req.body?.To;
    const from = req.body?.From;
    // The Caretaker never answers: calling his number back gets a dead line.
    if (to === CARETAKER_NUMBER && CARETAKER_NUMBER !== RUTH_NUMBER) return reply.type('text/xml').send(DEAD_LINE_TWIML);
    const character = SUSPECT_LINES[to] || 'ruth';
    const p = playerByPhone(from);
    reply.type('text/xml').send(streamTwiml(PUBLIC_HOST, character, p?.name || 'detective', 'inbound', p?.pid));
  });

  app.register(async (instance) => {
    instance.get('/media-stream', { websocket: true }, (twilioWs) => bridge(twilioWs));
  });
}

function bridge(twilioWs) {
  let streamSid = null;
  let npc = 'caretaker';
  let player = { name: 'detective', pid: null, token: null };
  let openai = null;
  let controller = null;
  let call = null;
  let tick = null;
  let minimalTried = false;
  let sessionReady = false;
  let closed = false;
  // Playback tracking for barge-in.
  let latestMediaTs = 0;
  let responseStartTs = null;
  let lastAssistantItem = null;
  let marks = 0;
  let audioUntil = 0;

  const sendTwilio = (msg) => { if (twilioWs.readyState === WebSocket.OPEN) twilioWs.send(JSON.stringify(msg)); };
  const sendOpenAI = (evt) => { if (openai?.readyState === WebSocket.OPEN) openai.send(JSON.stringify(evt)); };

  function finish(reason) {
    if (closed) return;
    closed = true;
    clearInterval(tick);
    controller?.end(reason);
    if (call) closeCall(call.id, reason);
    try { openai?.close(); } catch { /* closed */ }
    // Closing the media stream ends <Connect><Stream>, and with nothing after it in the TwiML, the call hangs up.
    try { twilioWs.close(); } catch { /* closed */ }
  }

  function configure(minimal) {
    const built = realtimeSession({ npc, player, format: 'audio/pcmu', minimal });
    sendOpenAI({ type: 'session.update', session: built.session });
    return built;
  }

  function connect() {
    const timing = callTiming(npc);
    const first = realtimeSession({ npc, player, format: 'audio/pcmu' });
    try {
      call = openCall({ player: { ...player, token: player.token || `phone:${streamSid}` }, npc, transport: 'twilio', timing, model: first.model });
    } catch (err) {
      if (err instanceof BusyError) { console.warn(`[${npc}] ${err.message}`); finish('busy'); return; }
      throw err;
    }
    openai = openRealtimeSocket(first.model);
    let built = first;
    openai.on('open', () => { built = configure(false); });
    openai.on('message', (raw) => {
      let evt;
      try { evt = JSON.parse(raw); } catch { return; }
      if (!sessionReady) {
        if (evt.type === 'session.updated') {
          sessionReady = true;
          const c = CHARACTERS[npc];
          const opening = openingItem(c.opening(player.name));
          controller = createCallController({
            mode: 'websocket', send: sendOpenAI, opening: opening.text, openingRole: opening.role, toolName: built.toolName, timing,
            hooks: {
              transcript: (speaker, text, meta) => callTranscript(call, player, speaker, text, meta),
              usage: (rec) => callUsage(call, rec, 'server'),
              disclose: (topic, recent) => callDisclose(call, player, topic, recent),
              end: (reason) => setImmediate(() => finish(reason)),
              error: (e) => console.error(`[${npc}] OpenAI error:`, JSON.stringify(e)),
            },
          });
          controller.start();
          tick = setInterval(() => controller.tick(), 500);
        } else if (evt.type === 'error' && !minimalTried) {
          minimalTried = true;
          console.warn(`[${npc}] session config rejected (${evt.error?.message || evt.error?.code}); retrying with the minimal config.`);
          ledger.event('session_fallback', { npc, transport: 'twilio', detail: evt.error?.code });
          built = configure(true);
        }
        return;
      }
      switch (evt.type) {
        // Audio from the character -> phone. (GA name first, older beta name second.)
        case 'response.output_audio.delta':
        case 'response.audio.delta':
          if (streamSid && evt.delta) {
            sendTwilio({ event: 'media', streamSid, media: { payload: evt.delta } });
            if (lastAssistantItem !== evt.item_id) { lastAssistantItem = evt.item_id; responseStartTs = latestMediaTs; }
            sendTwilio({ event: 'mark', streamSid, mark: { name: 'part' } });
            marks += 1;
            const chunkMs = (Buffer.byteLength(evt.delta, 'base64') / 8); // μ-law 8 kHz: 8 bytes per ms
            audioUntil = Math.max(Date.now(), audioUntil) + chunkMs;
            controller.noteAssistantAudioUntil(audioUntil);
          }
          break;
        // The caller started talking over the character: stop playback where it is and cut the item there.
        case 'input_audio_buffer.speech_started':
          if (marks > 0 && lastAssistantItem && responseStartTs != null) {
            sendOpenAI({ type: 'conversation.item.truncate', item_id: lastAssistantItem, content_index: 0, audio_end_ms: Math.max(0, latestMediaTs - responseStartTs) });
            sendTwilio({ event: 'clear', streamSid });
            controller.clearAssistantAudio();
            audioUntil = Date.now();
          }
          marks = 0;
          lastAssistantItem = null;
          responseStartTs = null;
          break;
        default:
          break;
      }
      controller.handle(evt);
    });
    openai.on('close', () => { console.log(`[${npc}] OpenAI socket closed`); finish('openai_closed'); });
    openai.on('error', (err) => console.error('OpenAI socket error:', err.message));
  }

  twilioWs.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    switch (msg.event) {
      case 'start': {
        streamSid = msg.start.streamSid;
        const p = msg.start.customParameters || {};
        npc = CHARACTERS[p.character] ? p.character : 'caretaker';
        const known = (p.pid && playerByPid(p.pid)) || null;
        player = known || { name: p.player || 'detective', pid: null, token: null };
        console.log(`[${npc}] ${p.direction || 'outbound'} call with ${player.name} started (${streamSid})`);
        connect();
        break;
      }
      case 'media':
        latestMediaTs = Number(msg.media.timestamp) || latestMediaTs;
        if (sessionReady) sendOpenAI({ type: 'input_audio_buffer.append', audio: msg.media.payload });
        break;
      case 'mark':
        if (marks > 0) marks -= 1;
        break;
      case 'stop':
        console.log(`[${npc}] call with ${player.name} ended`);
        finish('player_hung_up');
        break;
      default:
        break;
    }
  });
  twilioWs.on('close', () => finish('player_hung_up'));
}
