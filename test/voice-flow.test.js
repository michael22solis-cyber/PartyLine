// Voice calls end to end against the offline mock: session config, fallback, leases and fairness, usage dedupe,
// disclosures, the recorded reveal, the server-controlled sideband transport, and the Twilio bridge (barge-in).
import { until, sleep } from './helpers/env.js';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';
import { startMockOpenAI } from './helpers/mock-openai.js';

process.env.UNLOCK_ALL = '1';
process.env.REALTIME_BARGE_IN_MS = '80'; // keep tests fast; the default is 500 ms
const mock = await startMockOpenAI();
process.env.OPENAI_BASE_URL = mock.url;

const { buildApp } = await import('../src/server.js');
const { addPlayer, playerByToken, messagesFor } = await import('../src/store.js');
const { allLines } = await import('../src/memory.js');
const { ledger } = await import('../src/ai/ledger.js');
const { ringInApp } = await import('../src/progress.js');

const app = buildApp();
await app.listen({ port: 0, host: '127.0.0.1' });
const port = app.server.address().port;
after(async () => { await app.close(); await mock.close(); });

const post = async (p, url, body) => {
  const r = await app.inject({ method: 'POST', url: `/api/p/${p.token}${url}`, payload: body });
  return { status: r.statusCode, body: r.json() };
};
const events = (type) => ledger.records().filter((r) => r.kind === 'event' && r.type === type);
const usage = () => ledger.usage();

test('in-app call: short-lived key with the configured model, tools, limits and opening note', async () => {
  const p = addPlayer({ name: 'Maya' });
  const r = await post(p, '/call', { character: 'lily' });
  assert.equal(r.status, 200);
  const sent = mock.log.clientSecrets.at(-1);
  assert.equal(sent.session.model, 'gpt-realtime-2.1-mini');
  assert.equal(sent.session.max_output_tokens, 1500);
  assert.equal(sent.session.audio.input.turn_detection.type, 'semantic_vad');
  // The game, not OpenAI's turn detection, decides when a sound is a turn or may interrupt (noise tolerance).
  assert.equal(sent.session.audio.input.turn_detection.create_response, false);
  assert.equal(sent.session.audio.input.turn_detection.interrupt_response, false);
  assert.equal(sent.session.audio.input.noise_reduction.type, 'far_field', 'phones on speaker in the app');
  assert.deepEqual(r.body.turns, { managed: true, bargeIn: true, bargeInMs: 80, minTurnMs: 300 });
  assert.equal(sent.session.tools[0].name, 'check_guarded_topic');
  assert.ok(sent.expires_after.seconds <= 120);
  assert.doesNotMatch(sent.session.instructions, /already dead when you arrived/);
  assert.equal(r.body.toolName, 'check_guarded_topic');
  assert.equal(r.body.openingRole, 'system');
  assert.ok(r.body.callId && r.body.key);
  assert.equal(r.body.timing.maxSeconds, 240);
  await post(p, '/call/end', { callId: r.body.callId, character: 'lily', seconds: 12 });
  assert.equal(events('call_ended').at(-1).seconds, 12);
});

test('rollback: OPENAI_REALTIME_MODEL switches the model; per-character overrides work', async () => {
  const p = addPlayer({ name: 'Rob' });
  process.env.OPENAI_REALTIME_MODEL = 'gpt-realtime';
  process.env.OPENAI_REALTIME_MODEL_CARETAKER = 'gpt-realtime-2.1';
  const a = await post(p, '/call', { character: 'ruth' });
  assert.equal(mock.log.clientSecrets.at(-1).session.model, 'gpt-realtime');
  await post(p, '/call/end', { callId: a.body.callId, character: 'ruth' });
  await ringInApp(p, 'caretaker');
  const b = await post(p, '/call', { character: 'caretaker' });
  assert.equal(mock.log.clientSecrets.at(-1).session.model, 'gpt-realtime-2.1');
  await post(p, '/call/end', { callId: b.body.callId, character: 'caretaker' });
  delete process.env.OPENAI_REALTIME_MODEL;
  delete process.env.OPENAI_REALTIME_MODEL_CARETAKER;
});

test('if the API rejects an optional session field, the call still connects with the original minimal config', async () => {
  const p = addPlayer({ name: 'Fay' });
  mock.setReject(['noise_reduction']);
  const n0 = mock.log.clientSecrets.length;
  const r = await post(p, '/call', { character: 'teddy' });
  mock.setReject([]);
  assert.equal(r.status, 200);
  assert.equal(mock.log.clientSecrets.length - n0, 2);
  const second = mock.log.clientSecrets.at(-1);
  assert.equal(second.session.audio.input.turn_detection.type, 'server_vad');
  assert.equal(second.session.tools, undefined);
  assert.doesNotMatch(second.session.instructions, /check_guarded_topic/, 'no reference to a tool that is not there');
  assert.equal(r.body.toolName, null);
  assert.ok(events('session_fallback').length >= 1);
  await post(p, '/call/end', { callId: r.body.callId, character: 'teddy' });
});

test('one live call per player (a new one supersedes), and a global cap returns LINE BUSY', async () => {
  const [a, b, c] = ['Ann', 'Bea', 'Cal'].map((name) => addPlayer({ name }));
  process.env.MAX_CONCURRENT_CALLS = '2';
  const open = [];
  try {
    const first = await post(a, '/call', { character: 'ruth' });
    const second = await post(a, '/call', { character: 'ruth' });
    open.push([a, second]);
    assert.ok(first.body.callId && second.body.callId);
    assert.notEqual(first.body.callId, second.body.callId);
    assert.equal(events('call_ended').at(-1).reason, 'superseded');
    const fromB = await post(b, '/call', { character: 'ruth' });
    open.push([b, fromB]);
    assert.equal(fromB.status, 200);
    const fromC = await post(c, '/call', { character: 'ruth' });
    assert.equal(fromC.status, 503);
    assert.match(fromC.body.error, /busy/i);
  } finally {
    for (const [p, r] of open) await post(p, '/call/end', { callId: r.body.callId, character: 'ruth' });
    delete process.env.MAX_CONCURRENT_CALLS;
  }
});

test('usage reported by the phone is validated and deduplicated by response id', async () => {
  const p = addPlayer({ name: 'Uma' });
  const { body: call } = await post(p, '/call', { character: 'marcus' });
  const rec = {
    kind: 'response', responseId: 'resp_abc', status: 'completed', purpose: 'reply', firstAudioMs: 640, audioGeneratedMs: 4000, audioPlayedMs: 4000,
    usage: { input_tokens: 1500, output_tokens: 110, input_token_details: { text_tokens: 1400, audio_tokens: 100, cached_tokens: 1152, cached_tokens_details: { text_tokens: 1152, audio_tokens: 0 } }, output_token_details: { text_tokens: 30, audio_tokens: 80 } },
  };
  assert.equal((await post(p, '/call/usage', { callId: call.callId, records: [rec, rec] })).body.recorded, 1);
  assert.equal((await post(p, '/call/usage', { callId: call.callId, records: [rec, { ...rec, responseId: '../bad id' }] })).body.recorded, 0);
  await post(p, '/call/usage', { callId: call.callId, records: [{ kind: 'transcription', responseId: 'tr_item1', usage: { type: 'tokens', input_tokens: 20, input_token_details: { audio_tokens: 20 }, output_tokens: 6 } }] });
  const voice = usage().find((r) => r.responseId === 'resp_abc');
  assert.equal(voice.model, 'gpt-realtime-2.1-mini');
  assert.equal(voice.usage.textInCached, 1152);
  assert.equal(voice.usage.textIn, 248);
  assert.equal(voice.source, 'client');
  assert.ok(voice.usd > 0);
  assert.equal(usage().find((r) => r.responseId === 'tr_item1').capability, 'transcription');
  await post(p, '/call/end', { callId: call.callId, character: 'marcus' });
});

test('in a call, the engine approves disclosures from the caller\'s words only; transcripts are deduped', async () => {
  const p = addPlayer({ name: 'Dot' });
  const { body: call } = await post(p, '/call', { character: 'lily' });
  assert.equal((await post(p, '/call/disclose', { callId: call.callId, topic: 'call911', recent: 'nice weather' })).body.decision, 'stay_guarded');
  const said = await post(p, '/call/transcript', { callId: call.callId, speaker: 'player', text: 'Lily, did you make the 911 call?', itemId: 'u1' });
  assert.equal(said.body.notes.length, 1);
  assert.match(said.body.notes[0], /already dead/);
  const again = await post(p, '/call/transcript', { callId: call.callId, speaker: 'player', text: 'Lily, did you make the 911 call?', itemId: 'u1' });
  assert.equal(again.body.duplicate, true);
  const told = await post(p, '/call/disclose', { callId: call.callId, topic: 'call911', recent: '' });
  assert.equal(told.body.decision, 'open_up');
  await post(p, '/call/transcript', { callId: call.callId, speaker: 'character', text: 'okay. it was me. she was already dead.', itemId: 'a1' });
  assert.deepEqual(playerByToken(p.token).found, ['call911']);
  assert.equal(allLines().filter((l) => l.pid === p.pid && /did you make the 911/.test(l.text)).length, 1);
  await post(p, '/call/end', { callId: call.callId, character: 'lily' });
});

test('the scripted midnight reveal plays a recording when one exists: no live session at all', async () => {
  const file = path.resolve('public/audio/caretaker-reveal.mp3');
  const existed = fs.existsSync(file);
  if (!existed) fs.writeFileSync(file, Buffer.from('ID3'));
  try {
    const p = addPlayer({ name: 'Rev' });
    const n0 = mock.log.clientSecrets.length;
    await ringInApp(p, 'caretaker_reveal');
    const r = await post(p, '/call', { character: 'caretaker_reveal' });
    assert.equal(r.body.mode, 'recording');
    assert.equal(r.body.audio, '/assets/audio/caretaker-reveal.mp3');
    assert.equal(mock.log.clientSecrets.length, n0);
    assert.ok(allLines().some((l) => l.pid === p.pid && /Thirty years/.test(l.text)), 'the reveal is in memory');
    await post(p, '/call/end', { character: 'caretaker_reveal', mode: 'recording', seconds: 31 });
    assert.ok(messagesFor(p.token).some((m) => m.kind === 'calllog'));
  } finally {
    if (!existed) fs.rmSync(file);
  }
});

test('sideband transport: the server runs the call (tool approvals, usage, heard-only memory, hang-up)', async () => {
  process.env.REALTIME_TRANSPORT = 'sideband';
  const p = addPlayer({ name: 'Sid' });
  const { body: call } = await post(p, '/call', { character: 'lily' });
  assert.equal(call.serverControlled, true);
  assert.equal(call.key, undefined, 'no key leaves the server');
  const sdp = await app.inject({ method: 'POST', url: `/api/p/${p.token}/call/${call.callId}/sdp`, payload: 'v=0 offer', headers: { 'content-type': 'application/sdp' } });
  assert.equal(sdp.statusCode, 200);
  assert.match(sdp.body, /mock answer/);
  assert.equal(mock.log.calls.at(-1).sdp, 'v=0 offer');
  const s = await mock.waitForSession((x) => x.callId && x.responses.length >= 1);
  s.played();
  await until(() => allLines().some((l) => l.pid === p.pid && l.speaker === 'character'));
  // The caller raises the 911 call: the model asks via the tool, the server approves, the character confesses.
  s.userTurn('did you make the 911 call that night?');
  await until(() => s.responses.length >= 3, 4000);
  s.played();
  await until(() => playerByToken(p.token).found.includes('call911'), 3000);
  const recs = usage().filter((r) => r.callId === call.callId);
  assert.ok(recs.length >= 3 && recs.every((r) => r.source === 'sideband'));
  assert.ok(recs.some((r) => r.capability === 'transcription'));
  // A cough while the character talks: no interruption, no answer, nothing remembered, removed from the conversation.
  s.userTurn('tell me more about the stairs');
  await until(() => s.responses.length >= 4);
  const noiseId = s.noise({ audioMs: 150 });
  await until(() => s.deleted.includes(noiseId));
  assert.equal(s.clears, 0, 'noise did not cut the character off');
  assert.equal(s.responses.length, 4, 'noise was not answered');
  // Real speech over the character: it stops, and only what was heard is remembered (here, the first word).
  await sleep(500);
  await s.userTurn('wait, stop, what stairs?', { speakMs: 150 });
  assert.equal(s.clears, 1);
  await until(() => allLines().some((l) => l.pid === p.pid && /—$/.test(l.text)), 3000);
  assert.ok(s.received.some((e) => e.type === 'conversation.item.truncate'), 'the model\'s history is cut too');
  const cut = allLines().find((l) => l.pid === p.pid && /—$/.test(l.text));
  assert.doesNotMatch(cut.text, /sweetheart/, 'the unheard end of the line is not remembered');
  const n0 = mock.log.hangups.length;
  await post(p, '/call/end', { callId: call.callId, character: 'lily', seconds: 40 });
  await until(() => mock.log.hangups.length - n0 === 1);
  delete process.env.REALTIME_TRANSPORT;
});

function twilioCall(params) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/media-stream`);
  const got = [];
  ws.on('message', (raw) => got.push(JSON.parse(raw)));
  const opened = new Promise((r) => ws.on('open', r));
  const closed = new Promise((r) => ws.on('close', r));
  return {
    ws, got, closed,
    async start() {
      await opened;
      ws.send(JSON.stringify({ event: 'start', start: { streamSid: 'MZ123', customParameters: params } }));
    },
    media(ts) { ws.send(JSON.stringify({ event: 'media', media: { timestamp: String(ts), payload: Buffer.alloc(160, 0xff).toString('base64') } })); },
    mark() { ws.send(JSON.stringify({ event: 'mark', mark: { name: 'part' } })); },
  };
}

test('phone call (Twilio): barge-in truncates the character at what was actually played', async () => {
  const p = addPlayer({ name: 'Pia', phone: '+15555550199' });
  const t = twilioCall({ character: 'ruth', player: 'Pia', pid: p.pid, direction: 'inbound' });
  await t.start();
  t.media(1000); // Twilio streams caller audio from the start: the clock is at 1.0 s when the character starts talking
  const s = await mock.waitForSession((x) => x.model && x.responses.length >= 1);
  assert.equal(s.config.audio.input.format.type, 'audio/pcmu');
  assert.equal(s.config.model, 'gpt-realtime-2.1-mini');
  await until(() => t.got.filter((m) => m.event === 'media').length >= 10);
  // Twilio has played 1.2 s of the 4 s opening when the caller cuts in.
  for (let ms = 20; ms <= 1200; ms += 20) t.media(1000 + ms);
  t.mark();
  await sleep(50);
  // A short noise does not interrupt...
  s.noise({ audioMs: 120 });
  await sleep(150);
  assert.equal(s.truncations.length, 0);
  assert.ok(!t.got.some((m) => m.event === 'clear'));
  // ...but the caller talking over the character does.
  await s.userTurn('wait, who is this?', { speakMs: 150 });
  await until(() => s.truncations.length === 1);
  assert.ok(Math.abs(s.truncations[0].audio_end_ms - 1200) <= 20, `truncated at ${s.truncations[0].audio_end_ms}`);
  assert.ok(t.got.some((m) => m.event === 'clear'));
  await until(() => allLines().some((l) => l.pid === p.pid && l.speaker === 'character'));
  const line = allLines().find((l) => l.pid === p.pid && l.speaker === 'character');
  assert.match(line.text, /—$/, 'only the heard part is remembered');
  assert.ok(usage().some((r) => r.npc === 'ruth' && r.source === 'server' && r.capability === 'voice'));
  t.ws.close();
  await until(() => events('call_ended').some((e) => e.session === p.pid));
});

test('phone call (Twilio): inbound calls now have a hard time limit; config fallback works on the socket too', async () => {
  process.env.MAX_CALL_SECONDS = '2';
  mock.setReject(['noise_reduction']);
  const p = addPlayer({ name: 'Lim', phone: '+15555550198' });
  const t = twilioCall({ character: 'teddy', player: 'Lim', pid: p.pid, direction: 'inbound' });
  await t.start();
  await mock.waitForSession((x) => x.model && x.responses.length >= 1);
  mock.setReject([]);
  const t0 = Date.now();
  await t.closed;
  assert.ok(Date.now() - t0 < 4000, 'server hung up');
  await until(() => events('call_ended').some((e) => e.session === p.pid));
  assert.equal(events('call_ended').find((e) => e.session === p.pid).reason, 'max_duration');
  delete process.env.MAX_CALL_SECONDS;
});
