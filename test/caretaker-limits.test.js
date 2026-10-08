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
const eleven = { requests: [], fail: false, noMusic: false };
const elevenServer = http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => { body += d; });
  req.on('end', () => {
    eleven.requests.push({ url: req.url, key: req.headers['xi-api-key'], body: JSON.parse(body || '{}') });
    if (eleven.fail) { res.writeHead(500); res.end('nope'); return; }
    if (eleven.status) { res.writeHead(eleven.status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(eleven.body || {})); return; }
    if (eleven.noMusic && req.url.startsWith('/v1/music')) { res.writeHead(402); res.end('upgrade'); return; }
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

  // The final reveal is in the same voice.
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

test('warm-up: every fixed line is made at startup, and the host page can see it', async () => {
  withEleven();
  const { warmUp, voiceStatus } = await import('../src/voice/caretaker.js');
  await warmUp();
  const v = voiceStatus();
  assert.equal(v.mode, 'narrator');
  assert.equal(v.ready, v.total);
  assert.equal(v.total, 7, 'riddle, 4 hints, sign-off, reveal');
  const st = await app.inject({ method: 'GET', url: '/admin/status', headers: { 'x-admin-key': 'test-admin' } });
  assert.equal(st.json().caretakerVoice.ready, 7);
  assert.ok(!JSON.stringify(st.json().caretakerVoice).includes('narrator123'), 'only the last characters of the voice id are shown');
});

test('music: five tracks composed once by ElevenLabs Music, each creepier, served to the phone by phase', async () => {
  withEleven();
  const music = await import('../src/music.js');
  const n0 = eleven.requests.length;
  await music.warmUp();
  const all = eleven.requests.slice(n0);
  const beds = all.filter((r) => r.url.startsWith('/v1/sound-generation'));
  assert.equal(beds.length, 4, 'a background for each character’s calls');
  assert.match(beds.find((r) => /humming/.test(r.body.text)).body.text, /lullaby/, 'Ruth’s room has the hum');
  const made = all.filter((r) => r.url.startsWith('/v1/music'));
  assert.equal(made.length, 5);
  assert.ok(made.every((r) => r.body.force_instrumental === true && r.body.music_length_ms === 60000));
  assert.match(made[0].body.prompt, /music box/);
  assert.match(made[3].body.prompt, /dread/i, 'the final stretch is the most tense');
  await music.warmUp();
  assert.equal(eleven.requests.length, n0 + 9, 'made once, then reused');
  const p = addPlayer({ name: 'Mo' });
  const st = (await app.inject({ method: 'GET', url: `/api/p/${p.token}/state` })).json();
  assert.deepEqual(Object.keys(st.music), ['early', 'late', 'deep', 'final', 'after']);
  assert.deepEqual(Object.keys(st.callBeds).sort(), ['lily', 'marcus', 'ruth', 'teddy']);
  const file = await app.inject({ method: 'GET', url: st.music.deep });
  assert.equal(file.statusCode, 200);
  assert.equal(file.headers['content-type'], 'audio/mpeg');
  const admin = (await app.inject({ method: 'GET', url: '/admin/status', headers: { 'x-admin-key': 'test-admin' } })).json();
  assert.deepEqual(admin.music, { mode: 'on', ready: 9, total: 9, error: null });
});

test('when ElevenLabs refuses, the host page says exactly why, and pasted spaces/quotes in the variables are fine', async () => {
  const { voiceStatus } = await import('../src/voice/caretaker.js');
  Object.assign(process.env, { ELEVENLABS_API_KEY: ' "xi-test" ', ELEVENLABS_VOICE_ID: ' other-voice ' });
  eleven.status = 404; eleven.body = { detail: { status: 'voice_not_found', message: 'A voice with the voice_id other-voice was not found.' } };
  const p = addPlayer({ name: 'Err' });
  await ringInApp(p, 'caretaker', {});
  const r = await post(p, '/call', { character: 'caretaker' });
  assert.notEqual(r.body.mode, 'recording', 'falls back to live');
  assert.ok(eleven.requests.at(-1).url.includes('/other-voice?'), 'voice id trimmed');
  assert.equal(eleven.requests.at(-1).key, 'xi-test', 'key trimmed and unquoted');
  const v = voiceStatus();
  assert.equal(v.error.status, 404);
  assert.match(v.error.message, /not found/);
  assert.match(v.error.hint, /voice ID/);
  eleven.status = null; eleven.body = null;
  await post(p, '/call/end', { callId: r.body.callId, character: 'caretaker', seconds: 3 });
});

test('a confession heard on a call: phone-only evidence, marked as heard on a call, worth more at the end', async () => {
  const { checkSecrets } = await import('../src/progress.js');
  const { approveFromPlayerText } = await import('../src/disclosure.js');
  const { recapFor } = await import('../src/recap.js');
  const { messagesFor } = await import('../src/store.js');
  const a = addPlayer({ name: 'Cal' });
  approveFromPlayerText(a, 'lily', 'did you make the 911 call?', 'text');
  await checkSecrets(a, 'lily', 'okay. it was me. she was already dead.', { channel: 'text' });
  assert.deepEqual(playerByToken(a.token).found || [], [], 'not over text');
  approveFromPlayerText(a, 'lily', 'did you make the 911 call?', 'call');
  await checkSecrets(a, 'lily', 'okay. it was me. she was already dead.', { channel: 'call' });
  assert.deepEqual(playerByToken(a.token).found, ['call911']);
  const card = messagesFor(a.token).find((m) => m.kind === 'evidence');
  assert.match(card.text, /^SECRET UNCOVERED · HEARD ON A CALL/);
  const r = recapFor(playerByToken(a.token));
  assert.equal(r.heardOnCalls, 1);
  assert.ok(r.found[0].endsWith('☎'));
});

test('Lily calls everyone mid-game; miss her and she shuts down and won’t pick up for a while', async () => {
  const { BEATS } = await import('../src/beats.js');
  const { messagesFor } = await import('../src/store.js');
  const { mock: fake } = await import('node:test');
  const lonely = addPlayer({ name: 'Nia' });
  fake.timers.enable({ apis: ['setTimeout'] });
  try {
    const run = BEATS.lilyCalls();
    for (let i = 0; i < 40 && !messagesFor(lonely.token).some((m) => m.kind === 'missed' && m.npc === 'lily'); i++) {
      fake.timers.tick(20_000); await new Promise((r) => setImmediate(r));
    }
    fake.timers.tick(60_000); await new Promise((r) => setImmediate(r));
    await run;
  } finally { fake.timers.reset(); }
  await until(() => messagesFor(lonely.token).some((m) => m.thread === 'lily' && m.text === 'nvm. forget i called.'), 5000);
  const r = await post(lonely, '/call', { character: 'lily' });
  assert.equal(r.status, 409);
  assert.match(r.body.error, /isn't picking up/);
});
