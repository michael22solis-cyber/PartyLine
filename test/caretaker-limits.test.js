// The Caretaker in the intro narrator's ElevenLabs voice (recorded calls, cached lines, live fallback), and the
// per-player call limits (minutes per game, per-character cooldown), against offline mocks.
import { until } from './helpers/env.js';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startMockOpenAI } from './helpers/mock-openai.js';

process.env.UNLOCK_ALL = '1';
process.env.CALL_MINUTES_PER_PLAYER = '3';
process.env.CALL_COOLDOWN_MINUTES = '5';
const mock = await startMockOpenAI();
process.env.OPENAI_BASE_URL = mock.url;

// A stand-in for ElevenLabs text-to-speech.
const eleven = { requests: [], fail: false };
const elevenServer = http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => { body += d; });
  req.on('end', () => {
    eleven.requests.push({ url: req.url, key: req.headers['xi-api-key'], body: JSON.parse(body || '{}') });
    if (eleven.fail) { res.writeHead(500); res.end('nope'); return; }
    res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
    res.end(Buffer.from('ID3fake-mp3-bytes'));
  });
});
await new Promise((r) => elevenServer.listen(0, '127.0.0.1', r));
process.env.ELEVENLABS_BASE_URL = `http://127.0.0.1:${elevenServer.address().port}`;

const { buildApp } = await import('../src/server.js');
const { addPlayer, playerByToken } = await import('../src/store.js');
const { allLines } = await import('../src/memory.js');
const { ringInApp } = await import('../src/progress.js');
const { checkCall, chargeCall } = await import('../src/voice/allowance.js');
const app = buildApp();
after(async () => { await app.close(); await mock.close(); elevenServer.close(); });

const post = async (p, url, body) => {
  const r = await app.inject({ method: 'POST', url: `/api/p/${p.token}${url}`, payload: body });
  return { status: r.statusCode, body: r.json() };
};
const withEleven = () => { process.env.ELEVENLABS_API_KEY = 'xi-test'; process.env.ELEVENLABS_VOICE_ID = 'narrator123'; };

test('without ElevenLabs keys the Caretaker stays live, exactly as before', async () => {
  const p = addPlayer({ name: 'Ada' });
  await ringInApp(p, 'caretaker', {});
  const r = await post(p, '/call', { character: 'caretaker' });
  assert.equal(r.status, 200);
  assert.notEqual(r.body.mode, 'recording');
  assert.ok(r.body.key, 'a live session');
  await post(p, '/call/end', { callId: r.body.callId, character: 'caretaker', seconds: 5 });
  assert.equal(eleven.requests.length, 0);
});

test('with the narrator voice: his calls are recordings in that voice, generated once and reused', async () => {
  withEleven();
  const a = addPlayer({ name: 'Maya' });
  await ringInApp(a, 'caretaker', {}); // starts generating while it rings
  await until(() => eleven.requests.length >= 4);
  const r = await post(a, '/call', { character: 'caretaker' });
  assert.equal(r.status, 200);
  assert.equal(r.body.mode, 'recording');
  assert.equal(r.body.audio.length, 4, 'greeting, riddle, first hint, fading');
  assert.match(r.body.captions[0], /Maya\.\.\. are you there/);
  assert.match(r.body.captions[1], /^Twenty steps down/);
  assert.ok(r.body.captions.every((c) => !c.includes('[')), 'delivery tags are never shown');
  assert.ok(eleven.requests.every((q) => q.key === 'xi-test' && q.url.includes('/narrator123') && q.body.model_id === 'eleven_v4'));
  const n = eleven.requests.length;
  assert.equal(n, 4, 'the ring and the answer shared one generation per line');
  const clip = await app.inject({ method: 'GET', url: r.body.audio[1] });
  assert.equal(clip.statusCode, 200);
  assert.equal(clip.headers['content-type'], 'audio/mpeg');
  assert.ok(allLines().some((l) => l.pid === a.pid && /Twenty steps down/.test(l.text)), 'other characters can know he called');
  assert.equal(mock.log.clientSecrets.filter((s) => /CARETAKER/.test(s.session?.instructions || '')).length, 1, 'no new live session');

  // Another player: only their name is new.
  const b = addPlayer({ name: 'Theo' });
  await ringInApp(b, 'caretaker', {});
  const rb = await post(b, '/call', { character: 'caretaker' });
  assert.equal(rb.body.mode, 'recording');
  assert.equal(eleven.requests.length, n + 1);

  // His second call to Maya brings a new hint, not the riddle again.
  await ringInApp(a, 'caretaker', {});
  const r2 = await post(a, '/call', { character: 'caretaker' });
  assert.equal(r2.body.audio.length, 3);
  assert.match(r2.body.captions[1], /voice in the walls/);
  assert.equal(playerByToken(a.token).caretakerCalls, 2);

  // The midnight reveal is in the same voice.
  await ringInApp(a, 'caretaker_reveal', {});
  const rv = await post(a, '/call', { character: 'caretaker_reveal' });
  assert.equal(rv.body.mode, 'recording');
  assert.match(rv.body.captions[0], /Ruth Calloway/);
  assert.equal((await app.inject({ method: 'GET', url: '/assets/voice/game.json' })).statusCode, 404, 'only generated clips are served');
});

test('if ElevenLabs fails, the call still connects (live)', async () => {
  withEleven();
  eleven.fail = true;
  const p = addPlayer({ name: 'Zed' });
  await ringInApp(p, 'caretaker', {});
  const r = await post(p, '/call', { character: 'caretaker' });
  eleven.fail = false;
  assert.equal(r.status, 200);
  assert.notEqual(r.body.mode, 'recording');
  await post(p, '/call/end', { callId: r.body.callId, character: 'caretaker', seconds: 5 });
});

test('call minutes: a call never runs past what is left, and the line goes dead when they are used up', () => {
  const p = addPlayer({ name: 'Kit' });
  const timing = { maxSeconds: 240, wrapUpAt: 200, idleSeconds: 45 };
  const first = checkCall(p, 'ruth', 'Ruth Calloway', timing);
  assert.equal(first.ok, true);
  assert.equal(first.timing.maxSeconds, 180, '3 minutes per player in this test');
  assert.equal(first.timing.wrapUpAt, 165, 'goodbye cue pulled in to fit');
  chargeCall(p.token, 'teddy', 160);
  const low = checkCall(playerByToken(p.token), 'ruth', 'Ruth Calloway', timing);
  assert.equal(low.ok, false, '20 s left is not worth a call');
  assert.equal(low.status, 429);
  assert.match(low.error, /line is dead/);
});

test('call limits on the server: cooldowns per character, minutes counted from the server clock, story calls exempt', async () => {
  const p = addPlayer({ name: 'Lou' });
  const r = await post(p, '/call', { character: 'ruth' });
  assert.equal(r.status, 200);
  assert.ok(r.body.timing.maxSeconds <= 180);
  // The phone claims 1 s; the server measures. Pretend the call lasted 100 s.
  const { getCall } = await import('../src/voice/calls.js');
  getCall(p.token, r.body.callId).startedAt -= 100_000;
  await post(p, '/call/end', { callId: r.body.callId, character: 'ruth', seconds: 1 });
  assert.ok(playerByToken(p.token).callSeconds >= 100);

  const again = await post(p, '/call', { character: 'ruth' });
  assert.equal(again.status, 409);
  assert.match(again.body.error, /isn't picking up/);
  assert.equal(again.body.reason, 'cooldown');

  const other = await post(p, '/call', { character: 'teddy' });
  assert.equal(other.status, 200, 'other characters still answer');
  assert.ok(other.body.timing.maxSeconds <= 80, 'only the minutes left');
  getCall(p.token, other.body.callId).startedAt -= 70_000;
  await post(p, '/call/end', { callId: other.body.callId, character: 'teddy', seconds: 1 });

  const dead = await post(p, '/call', { character: 'lily' });
  assert.equal(dead.status, 429);

  // A character calling them is never blocked, and doesn't count.
  const before = playerByToken(p.token).callSeconds;
  await ringInApp(playerByToken(p.token), 'ruth', {});
  const story = await post(p, '/call', { character: 'ruth' });
  assert.equal(story.status, 200);
  await post(p, '/call/end', { callId: story.body.callId, character: 'ruth', seconds: 30 });
  assert.equal(playerByToken(p.token).callSeconds, before);

  const status = await app.inject({ method: 'GET', url: '/admin/status', headers: { 'x-admin-key': 'test-admin' } });
  assert.ok(status.json().players.find((x) => x.name === 'Lou').callMinutes >= 2.8);
});
