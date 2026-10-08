// The host testing on their own: every beat works with a single player.
import './helpers/env.js';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { startMockOpenAI } from './helpers/mock-openai.js';

const mock = await startMockOpenAI();
process.env.OPENAI_BASE_URL = mock.url;
process.env.BEAT_TIME_SCALE = '0.001';
process.env.RING_TIMEOUT_MS = '50';
const { buildApp } = await import('../src/server.js');
const { addPlayer, messagesFor, playerByToken } = await import('../src/store.js');
const app = buildApp();
after(async () => { await app.close(); await mock.close(); });
const admin = { 'x-admin-key': 'test-admin' };

test('one player: setup, agendas and the Notebook work', async () => {
  const me = addPlayer({ name: 'Host' });
  const setup = await app.inject({ method: 'POST', url: '/admin/beat/setup', headers: admin });
  assert.equal(setup.statusCode, 200, setup.body);
  assert.match(setup.json().note, /testing/);
  const r = await app.inject({ method: 'POST', url: '/admin/beat/agendas', headers: admin });
  assert.equal(r.statusCode, 200);
  assert.ok(messagesFor(me.token).some((m) => /^YOUR SECRET AGENDA/.test(m.text)));
  const st = (await app.inject({ url: `/api/p/${me.token}/state` })).json();
  assert.equal(st.agenda.goals.length, 3);
});

test('agendas still reach a player who joined after setup', async () => {
  const late = addPlayer({ name: 'Late' });
  await app.inject({ method: 'POST', url: '/admin/beat/agendas', headers: admin });
  assert.equal(playerByToken(late.token).agenda.goals.length, 3);
});

test('every beat runs with one or two players without failing', async () => {
  const { BEATS } = await import('../src/beats.js');
  for (const name of Object.keys(BEATS)) {
    const r = await app.inject({ method: 'POST', url: `/admin/beat/${name}`, headers: admin });
    assert.equal(r.statusCode, 200, `${name}: ${r.body}`);
  }
});
