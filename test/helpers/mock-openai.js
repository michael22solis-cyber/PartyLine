// Offline stand-in for the OpenAI API: Chat Completions, Realtime client secrets, WebRTC call creation + hangup,
// and Realtime WebSocket sessions (model sessions for Twilio, call_id sessions for the sideband). Usage blocks are
// produced by bench/billing-model.js so tests can assert on token accounting and caching behavior.
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { billInput, chatPromptSegments, realtimeUsageBlock, tokens, RATES } from '../../bench/billing-model.js';

// A plausible "model": reveals only what its prompt allows.
export function defaultChatReply(messages) {
  const sys = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  const admit = /YOU MAY NOW ADMIT[^:]*:\s*(.+)/.exec(sys);
  if (admit) return `fine. ${admit[1].split('\n')[0].replace(/\byou\b/gi, 'i').replace(/\byour\b/gi, 'my')}`;
  const last = [...messages].reverse().find((m) => m.role === 'user')?.content || '';
  if (/where were you/i.test(last)) return 'I was where I said I was. Why does everyone keep asking?';
  return 'Mm. It is late to be asking questions about that house.';
}

export function defaultVoiceResponder({ items, tools }) {
  const lastUser = [...items].reverse().find((i) => i.role === 'user' || i.kind === 'user_audio');
  const lastOutput = items[items.length - 1];
  if (lastOutput?.type === 'function_call_output') {
    const r = JSON.parse(lastOutput.output || '{}');
    return { text: r.decision === 'open_up' ? `...alright. ${r.memory}` : 'I would rather not talk about that.', audioMs: 6000 };
  }
  const text = lastUser?.transcript || (lastUser?.content || []).map((c) => c.text || '').join(' ');
  const tool = tools.find((t) => t.name === 'check_guarded_topic');
  if (tool && /911|lullaby|song|speaker|bingo|diner|receipt|1996|mud/i.test(text)) {
    const topic = tool.parameters.properties.topic.enum.find((id) => new RegExp(id === 'call911' ? '911' : id, 'i').test(text))
      || tool.parameters.properties.topic.enum[0];
    return { toolCall: { name: 'check_guarded_topic', arguments: JSON.stringify({ topic }) } };
  }
  if (!lastUser || lastUser.role === 'system') return { text: 'Hello? ...Who is this, calling so late?', audioMs: 4000 };
  return { text: 'I already told you everything I know about Thursday night, sweetheart.', audioMs: 5000 };
}

export async function startMockOpenAI({
  chatReply = defaultChatReply,
  voiceResponder = defaultVoiceResponder,
  rejectSessionFields = [], // e.g. ['noise_reduction'] to test the minimal-config fallback
  crossSessionCache = false,
} = {}) {
  const log = { chat: [], clientSecrets: [], calls: [], hangups: [], sockets: [] };
  const stats = { inFlight: 0, maxInFlight: 0 };
  const failQueue = []; // statuses to return before the next successful chat completion
  const chatHistory = []; // prompt segments for the cross-request cache
  const sessions = [];
  const prefixCache = [];
  let delayMs = 0;
  let n = 0;
  const id = (p) => `${p}_${(++n).toString(36)}`;

  let rejectList = [...rejectSessionFields];
  const rejects = (session) => rejectList.find((f) => JSON.stringify(session || {}).includes(`"${f}"`));

  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks);
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type', 'Access-Control-Expose-Headers': 'location' };
    const send = (status, body, headers = {}) => {
      res.writeHead(status, { 'Content-Type': typeof body === 'string' ? 'text/plain' : 'application/json', ...cors, ...headers });
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
    };
    if (req.method === 'OPTIONS') { res.writeHead(204, { ...cors, 'Access-Control-Allow-Methods': 'POST, GET' }); res.end(); return; }
    const url = new URL(req.url, 'http://x');
    if (req.method === 'GET' && url.pathname === '/v1/models') return send(200, { data: [] });
    if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
      const body = JSON.parse(raw.toString() || '{}');
      log.chat.push(body);
      stats.inFlight += 1;
      stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
      try { if (delayMs) await new Promise((r) => setTimeout(r, delayMs)); } finally { stats.inFlight -= 1; }
      if (failQueue.length) {
        const status = failQueue.shift();
        return send(status, { error: { message: status === 429 ? 'Rate limit reached, slow down' : 'upstream error' } });
      }
      const segs = chatPromptSegments(body.messages);
      const billed = billInput(segs, chatHistory.length ? chatHistory.reduce((a, b) => (lcp(a, segs) >= lcp(b, segs) ? a : b)) : []);
      chatHistory.push(segs);
      if (chatHistory.length > 50) chatHistory.shift();
      const text = chatReply(body.messages, body);
      const out = tokens(text);
      return send(200, {
        id: id('chatcmpl'), model: `${body.model}-2025-04-14`,
        choices: [{ message: { role: 'assistant', content: text } }],
        usage: { prompt_tokens: billed.total, completion_tokens: out, prompt_tokens_details: { cached_tokens: billed.textInCached }, completion_tokens_details: { reasoning_tokens: 0 } },
      }, { 'x-request-id': id('req') });
    }
    if (req.method === 'POST' && url.pathname === '/v1/realtime/client_secrets') {
      const body = JSON.parse(raw.toString() || '{}');
      log.clientSecrets.push(body);
      const bad = rejects(body.session) || (rejectList.includes('expires_after') && body.expires_after ? 'expires_after' : null);
      if (bad) return send(400, { error: { message: `Unknown parameter: '${bad}'.`, code: 'unknown_parameter' } });
      return send(200, { value: id('ek_mock'), expires_at: Date.now() / 1000 + 60, session: body.session });
    }
    if (req.method === 'POST' && url.pathname === '/v1/realtime/calls') {
      const text = raw.toString();
      const sdp = /name="sdp"\r\n\r\n([\s\S]*?)\r\n--/.exec(text)?.[1] ?? (req.headers['content-type'] === 'application/sdp' ? text : undefined);
      const session = JSON.parse(/name="session"\r\n\r\n([\s\S]*?)\r\n--/.exec(text)?.[1] || '{}');
      log.calls.push({ sdp, session });
      if (rejects(session)) return send(400, { error: { message: 'Unknown parameter.' } });
      const callId = id('rtc');
      pendingCalls.set(callId, session);
      return send(201, 'v=0\r\no=- mock answer\r\n', { Location: `/v1/realtime/calls/${callId}`, 'Content-Type': 'application/sdp' });
    }
    const hang = /^\/v1\/realtime\/calls\/([^/]+)\/hangup$/.exec(url.pathname);
    if (req.method === 'POST' && hang) {
      log.hangups.push(hang[1]);
      for (const s of sessions) if (s.callId === hang[1]) s.close();
      return send(200, {});
    }
    send(404, { error: { message: 'not found' } });
  });
  const lcp = (a, b) => { let t = 0; for (let i = 0; i < Math.min(a.length, b.length); i++) { if (a[i].id !== b[i].id) break; t += a[i].tokens; } return t; };
  const pendingCalls = new Map();

  const wss = new WebSocketServer({ server, path: '/v1/realtime' });
  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://x');
    const callId = url.searchParams.get('call_id');
    const s = new MockRealtimeSession(ws, {
      model: url.searchParams.get('model'), callId, webrtc: Boolean(callId),
      session: callId ? pendingCalls.get(callId) : null, voiceResponder, rejects, prefixCache: crossSessionCache ? prefixCache : null, id,
    });
    sessions.push(s);
    log.sockets.push({ model: s.model, callId, auth: req.headers.authorization });
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/v1`,
    log,
    stats,
    sessions,
    failNext: (...statuses) => failQueue.push(...statuses),
    setReject: (fields) => { rejectList = [...fields]; },
    setDelay: (ms) => { delayMs = ms; },
    lastSession: () => sessions[sessions.length - 1],
    waitForSession: async (pred = () => true, ms = 3000) => {
      const until = Date.now() + ms;
      while (Date.now() < until) { const s = sessions.find(pred); if (s) return s; await new Promise((r) => setTimeout(r, 10)); }
      throw new Error('no realtime session');
    },
    close: () => new Promise((r) => { for (const s of sessions) s.close(); wss.close(); server.close(r); server.closeAllConnections?.(); }),
  };
}

class MockRealtimeSession {
  constructor(ws, { model, callId, webrtc, session, voiceResponder, rejects, prefixCache, id }) {
    Object.assign(this, { ws, model, callId, webrtc, voiceResponder, rejects, prefixCache, id });
    this.config = session || null;
    this.items = [];
    this.history = []; // segments of earlier requests in this session
    this.active = null;
    this.received = [];
    this.responses = [];
    this.truncations = [];
    this.closed = false;
    ws.on('message', (raw) => this.onMessage(JSON.parse(raw)));
    ws.on('close', () => { this.closed = true; });
  }
  emit(evt) { if (!this.closed && this.ws.readyState === 1) this.ws.send(JSON.stringify({ event_id: this.id('evt'), ...evt })); }
  close() { this.closed = true; try { this.ws.close(); } catch { /* closed */ } }

  onMessage(evt) {
    this.received.push(evt);
    switch (evt.type) {
      case 'session.update': {
        const bad = this.rejects(evt.session);
        if (bad) { this.emit({ type: 'error', error: { type: 'invalid_request_error', code: 'unknown_parameter', message: `Unknown parameter: '${bad}'.` } }); break; }
        this.config = evt.session;
        this.emit({ type: 'session.updated', session: evt.session });
        break;
      }
      case 'conversation.item.create': {
        const item = { id: evt.item.id || this.id('item'), ...evt.item };
        const text = item.type === 'function_call_output' ? item.output : (item.content || []).map((c) => c.text || '').join(' ');
        item.segment = { id: item.id, kind: 'text', tokens: tokens(text) + 4 };
        this.items.push(item);
        this.emit({ type: 'conversation.item.created', item: { id: item.id, type: item.type || 'message', role: item.role } });
        break;
      }
      case 'response.create':
        this.respond();
        break;
      case 'conversation.item.truncate': {
        const it = this.items.find((i) => i.id === evt.item_id);
        if (it) {
          it.truncatedMs = evt.audio_end_ms;
          it.segment = { id: `${it.id}:t${evt.audio_end_ms}`, kind: 'audio', tokens: Math.round((evt.audio_end_ms / 1000) * RATES.assistantAudioTokPerSec) };
        }
        this.truncations.push(evt);
        this.emit({ type: 'conversation.item.truncated', item_id: evt.item_id, content_index: 0, audio_end_ms: evt.audio_end_ms });
        break;
      }
      default:
        break;
    }
  }

  segments() {
    const cfg = this.config || {};
    return [
      { id: `instr:${cfg.instructions}`, kind: 'text', tokens: tokens(cfg.instructions) },
      { id: `tools:${JSON.stringify(cfg.tools || [])}`, kind: 'text', tokens: cfg.tools?.length ? tokens(JSON.stringify(cfg.tools)) : 0 },
      ...this.items.map((i) => i.segment),
    ];
  }

  respond() {
    if (this.active) { this.emit({ type: 'error', error: { code: 'conversation_already_has_active_response', message: 'busy' } }); return; }
    const rid = this.id('resp');
    this.active = rid;
    const segs = this.segments();
    let best = this.history[this.history.length - 1] || [];
    if (this.prefixCache && !this.history.length) best = this.prefixCache.find((p) => p[0].id === segs[0].id) || [];
    const input = billInput(segs, best);
    this.history.push(segs);
    if (this.prefixCache) this.prefixCache.unshift(segs);
    const tools = this.config?.tools || [];
    const plan = this.voiceResponder({ items: this.items, tools, session: this });
    this.emit({ type: 'response.created', response: { id: rid, status: 'in_progress' } });
    if (plan.toolCall) {
      const callId = this.id('call');
      const fc = { type: 'function_call', id: this.id('item'), call_id: callId, name: plan.toolCall.name, arguments: plan.toolCall.arguments };
      fc.segment = { id: fc.id, kind: 'text', tokens: tokens(fc.arguments) + 6 };
      this.items.push(fc);
      this.emit({ type: 'response.function_call_arguments.done', response_id: rid, item_id: fc.id, call_id: callId, name: fc.name, arguments: fc.arguments });
      const usage = realtimeUsageBlock(input, { textOut: tokens(fc.arguments) + 6, reasoning: plan.reasoning || 0 });
      this.active = null;
      this.responses.push({ id: rid, usage, toolCall: fc });
      this.emit({ type: 'response.done', response: { id: rid, status: 'completed', output: [fc], usage } });
      return;
    }
    const itemId = this.id('item');
    const audioTokens = Math.round((plan.audioMs / 1000) * RATES.assistantAudioTokPerSec);
    this.emit({ type: 'response.output_item.added', response_id: rid, item: { id: itemId, type: 'message', role: 'assistant' } });
    if (this.webrtc) {
      this.emit({ type: 'output_audio_buffer.started', response_id: rid });
    } else {
      const chunk = Buffer.alloc(800, 0xff).toString('base64'); // 100 ms of μ-law silence
      for (let t = 0; t < plan.audioMs; t += 100) this.emit({ type: 'response.output_audio.delta', response_id: rid, item_id: itemId, delta: chunk });
    }
    this.emit({ type: 'response.output_audio_transcript.done', response_id: rid, item_id: itemId, transcript: plan.text });
    const usage = realtimeUsageBlock(input, { textOut: tokens(plan.text), audioOut: audioTokens, reasoning: plan.reasoning || 0 });
    const item = { id: itemId, role: 'assistant', type: 'message', transcript: plan.text, audioMs: plan.audioMs, segment: { id: itemId, kind: 'audio', tokens: audioTokens } };
    this.items.push(item);
    this.active = null;
    this.responses.push({ id: rid, usage, itemId, text: plan.text });
    this.emit({ type: 'response.done', response: { id: rid, status: 'completed', output: [{ type: 'message', id: itemId, role: 'assistant', content: [{ type: 'output_audio', transcript: plan.text }] }], usage } });
    this.lastAssistant = { rid, itemId, audioMs: plan.audioMs };
  }

  // WebRTC playback events, driven by the test: the whole reply played, or the caller cut in after `ms`.
  played(rid = this.lastAssistant?.rid) { this.emit({ type: 'output_audio_buffer.stopped', response_id: rid }); }
  interrupted(ms, { itemId = this.lastAssistant?.itemId, rid = this.lastAssistant?.rid } = {}) {
    this.emit({ type: 'input_audio_buffer.speech_started' });
    this.emit({ type: 'output_audio_buffer.cleared', response_id: rid });
    const it = this.items.find((i) => i.id === itemId);
    if (it) it.segment = { id: `${it.id}:t${ms}`, kind: 'audio', tokens: Math.round((ms / 1000) * RATES.assistantAudioTokPerSec) };
    this.emit({ type: 'conversation.item.truncated', item_id: itemId, content_index: 0, audio_end_ms: ms });
  }

  // A caller turn as server turn detection would report it, then (by default) the automatic response.
  userTurn(text, { audioMs = 1500, respond = true, startedAlready = false } = {}) {
    const itemId = this.id('item');
    if (!startedAlready) this.emit({ type: 'input_audio_buffer.speech_started', item_id: itemId });
    this.emit({ type: 'input_audio_buffer.speech_stopped', item_id: itemId });
    const audioTokens = Math.round((audioMs / 1000) * RATES.userAudioTokPerSec);
    this.items.push({ id: itemId, role: 'user', kind: 'user_audio', transcript: text, segment: { id: itemId, kind: 'audio', tokens: audioTokens } });
    this.emit({ type: 'conversation.item.created', item: { id: itemId, type: 'message', role: 'user' } });
    if (respond) this.respond();
    this.emit({
      type: 'conversation.item.input_audio_transcription.completed', item_id: itemId, content_index: 0, transcript: text,
      usage: { type: 'tokens', total_tokens: audioTokens + tokens(text), input_tokens: audioTokens, input_token_details: { text_tokens: 0, audio_tokens: audioTokens }, output_tokens: tokens(text) },
    });
    return itemId;
  }
}
