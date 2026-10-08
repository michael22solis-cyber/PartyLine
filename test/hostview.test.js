// The host's live view (progress, spend, quiet players) and hints for stuck players.
import { until } from './helpers/env.js';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { startMockOpenAI } from './helpers/mock-openai.js';

const mock = await startMockOpenAI();
process.env.OPENAI_BASE_URL = mock.url;
const { buildApp } = await import('../src/server.js');
const { addPlayer, messagesFor, updatePlayer, markBeat, getDb } = await import('../src/store.js');
const { handlePlayerText } = await import('../src/chat.js');
const { runBeat } = await import('../src/beats.js');
const { liveView } = await import('../src/hostview.js');
const app = buildApp();
after(async () => { await app.close(); await mock.close(); });
const admin = { 'x-admin-key': 'test-admin' };
const status = async () => (await app.inject({ method: 'GET', url: '/admin/status', headers: admin })).json();
const line = (p) => messagesFor(p.token).filter((m) => m.thread === 'line').map((m) => m.text);

test('the host sees each player’s progress and the AI spend so far', async () => {
  const a = addPlayer({ name: 'Ava' });
  updatePlayer(a.token, { unlocked: ['ruth'], found: ['bingo', 'call911'], foundOnCall: ['call911'] });
  await handlePlayerText(a, 'ruth', 'Ruth, where were you Thursday?');
  await until(() => messagesFor(a.token).some((m) => m.thread === 'ruth' && m.from === 'character'), 4000);
  const s = await status();
  const row = s.players.find((p) => p.name === 'Ava');
  assert.equal(row.found, 2);
  assert.equal(row.foundOnCall, 1);
  assert.ok(row.usd > 0, 'her texts cost something');
  assert.ok(s.spend.usd >= row.usd);
  assert.equal(row.quiet, false);
  assert.equal(row.hintLeft, true);
  assert.equal(row.token, undefined, 'the secret token is not exposed beyond the link');
});

test('a player quiet for 10+ minutes in a running game is flagged', () => {
  const b = addPlayer({ name: 'Ben' });
  markBeat('intro');
  const view = liveView(Date.now() + 11 * 60_000);
  assert.equal(view.players[b.token].quiet, true);
  assert.ok(view.players[b.token].quietMinutes >= 10);
});

test('Send hint: a whisper on The Line about who to ask, and the contact if they lacked it; never repeats', async () => {
  const c = addPlayer({ name: 'Cy' });
  const r = await app.inject({ method: 'POST', url: `/admin/hint/${c.pid}`, headers: admin });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().about, 'lily');
  assert.ok(line(c).some((t) => /^A WHISPER ON THE LINE: .*Call her/.test(t)));
  assert.ok((getDb().players.find((p) => p.pid === c.pid).unlocked || []).includes('lily'));
  await app.inject({ method: 'POST', url: `/admin/hint/${c.pid}`, headers: admin });
  const hints = line(c).filter((t) => t.startsWith('A WHISPER'));
  assert.equal(hints.length, 2);
  assert.notEqual(hints[0], hints[1]);
  const denied = await app.inject({ method: 'POST', url: `/admin/hint/${c.pid}` });
  assert.equal(denied.statusCode, 401);
});

test('at the 911 twist, detectives with nothing found get a nudge; others do not', async () => {
  const d = addPlayer({ name: 'Dee' });
  const e = addPlayer({ name: 'Eve' });
  updatePlayer(e.token, { found: ['bingo'] });
  await runBeat('twist');
  assert.ok(line(d).some((t) => t.startsWith('A WHISPER')));
  assert.ok(!line(e).some((t) => t.startsWith('A WHISPER')));
});

test('character voices can be changed from Railway variables; a typo falls back safely', async () => {
  const { voiceFor } = await import('../src/voice/session.js');
  process.env.VOICE_RUTH = 'Shimmer';
  process.env.VOICE_TEDDY = 'banana';
  assert.equal(voiceFor('ruth'), 'shimmer');
  assert.equal(voiceFor('teddy'), 'verse', 'unknown voice: keeps the default');
  assert.equal((await status()).voices.Ruth, 'shimmer');
  const { realtimeSession } = await import('../src/voice/session.js');
  const p = addPlayer({ name: 'Vi' });
  const out = realtimeSession({ npc: 'ruth', player: p });
  assert.equal((out.session || out).audio.output.voice, 'shimmer', 'the live call uses it');
  delete process.env.VOICE_RUTH; delete process.env.VOICE_TEDDY;
});
