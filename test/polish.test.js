// Polish: getting back in after losing your link, pausing the night, the night clock, and the counted-out votes.
import './helpers/env.js';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { startMockOpenAI } from './helpers/mock-openai.js';

process.env.BEAT_TIME_SCALE = '0.001';
process.env.RING_TIMEOUT_MS = '30';
const mock = await startMockOpenAI();
process.env.OPENAI_BASE_URL = mock.url;
const { buildApp } = await import('../src/server.js');
const { players, messagesFor, scheduled, castVote } = await import('../src/store.js');
const { runBeat } = await import('../src/beats.js');
const app = buildApp();
after(async () => { await app.close(); await mock.close(); });
const admin = { 'x-admin-key': 'test-admin' };
const req = async (method, url, payload, headers) => { const r = await app.inject({ method, url, payload, headers }); return { status: r.statusCode, body: r.json() }; };

let code;
test('a group joins and starts', async () => {
  const g = await req('POST', '/admin/game', { length: 'quick' }, admin);
  code = g.body.code;
  for (const name of ['Ava', 'Ben', 'Cy']) assert.equal((await req('POST', `/api/join/${code}`, { name })).status, 200);
  assert.equal((await req('POST', '/admin/start', {}, admin)).status, 200);
});

test('lost your link: ask from the invite page, the host lets you back in, the link works once', async () => {
  const info = await req('GET', `/api/join/${code}`);
  assert.equal(info.body.status, 'running');
  const ben = info.body.players.find((p) => p.name === 'Ben');
  assert.equal(info.body.players.some((p) => 'token' in p), false, 'no secret links on the invite page');
  const r = await req('POST', `/api/join/${code}/rejoin`, { pid: ben.pid });
  assert.equal((await req('GET', `/api/join/${code}/rejoin/${r.body.rid}`)).body.status, 'pending');
  const st = await req('GET', '/admin/status', null, admin);
  assert.deepEqual(st.body.rejoins.map((x) => x.name), ['Ben']);
  assert.equal((await req('POST', `/admin/rejoin/${r.body.rid}`, { approve: true }, admin)).status, 200);
  const ok = await req('GET', `/api/join/${code}/rejoin/${r.body.rid}`);
  assert.equal(ok.body.link, `/p/${players().find((p) => p.name === 'Ben').token}`);
  assert.equal((await req('GET', `/api/join/${code}/rejoin/${r.body.rid}`)).body.status, 'expired', 'single use');
  // Turned down: no link.
  const r2 = await req('POST', `/api/join/${code}/rejoin`, { pid: ben.pid });
  await req('POST', `/admin/rejoin/${r2.body.rid}`, { approve: false }, admin);
  assert.deepEqual((await req('GET', `/api/join/${code}/rejoin/${r2.body.rid}`)).body, { status: 'denied' });
  assert.equal((await req('POST', '/api/join/wrongcode/rejoin', { pid: ben.pid })).status, 404);
  assert.equal((await req('POST', `/admin/rejoin/${r2.body.rid}`, {}, {})).status, 401, 'only the host decides');
});

test('the night clock shows when votes open and when the final call comes', async () => {
  const ava = players().find((p) => p.name === 'Ava');
  const st = await req('GET', `/api/p/${ava.token}/state`);
  const at = (beat) => scheduled().find((s) => s.beat === beat).at;
  assert.equal(st.body.clock.votesAt, at('votesOpen'));
  assert.equal(st.body.clock.finalAt, at('reveal'));
  assert.equal(st.body.clock.paused, null);
});

test('pause holds the night; resume moves the rest of it later; every phone is told', async () => {
  const before = Date.parse(scheduled().find((s) => s.beat === 'votesOpen').at);
  await req('POST', '/admin/pause', {}, admin);
  const ava = players().find((p) => p.name === 'Ava');
  assert.ok((await req('GET', `/api/p/${ava.token}/state`)).body.clock.paused);
  assert.equal((await req('GET', '/admin/status', null, admin)).body.paused, true);
  assert.ok(messagesFor(ava.token).some((m) => /paused the night/.test(m.text)));
  await new Promise((r) => setTimeout(r, 60));
  await req('POST', '/admin/resume', {}, admin);
  const afterAt = Date.parse(scheduled().find((s) => s.beat === 'votesOpen').at);
  assert.ok(afterAt - before >= 50, 'pending beats moved later by the pause');
  assert.ok(messagesFor(ava.token).some((m) => /line is open again/.test(m.text)));
  assert.equal((await req('GET', '/admin/status', null, admin)).body.paused, false);
});

test('before the final call, the votes are counted out on every phone (anonymously)', async () => {
  const [a, b, c] = players();
  castVote(a.token, 'Ruth Calloway', null); castVote(b.token, 'Ruth Calloway', null); castVote(c.token, 'Lily Blackwood', null);
  await runBeat('reveal');
  const tally = messagesFor(a.token).find((m) => m.kind === 'tally');
  assert.equal(tally.text, 'THE VOTES ARE IN\nRuth Calloway: 2\nLily Blackwood: 1');
  assert.ok(!/Ava|Ben|Cy/.test(tally.text), 'counts only, not who voted for whom');
});

test('the 15-minute test run: the same beats in the same order, and one phone can start it', async () => {
  const { LENGTHS } = await import('../src/modes.js');
  const order = (k) => LENGTHS[k].beats.map(([b]) => b);
  assert.deepEqual(order('test'), order('quick'));
  const mins = LENGTHS.test.beats.map(([, m]) => m);
  assert.deepEqual(mins, [...mins].sort((x, y) => x - y), 'beats in time order');
  assert.equal(mins.at(-1), 15);

  await req('POST', '/admin/reset', {}, admin);
  const g = await req('POST', '/admin/game', { length: 'test' }, admin);
  const token = (await req('POST', `/api/join/${g.body.code}`, { name: 'Host' })).body.link.split('/').pop();
  const st = await req('GET', `/api/p/${token}/state`);
  assert.equal(st.body.lobby.minPlayers, 1);
  assert.equal((await req('POST', `/api/p/${token}/start`, {})).status, 200);
  const reveal = Date.parse(scheduled().find((s) => s.beat === 'reveal').at);
  assert.ok(Math.abs(reveal - Date.now() - 15 * 60_000) < 5000, 'the final call comes 15 minutes after Start');
});
