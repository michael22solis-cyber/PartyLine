// Gradual unlocking: a stuck player gets texted first, and voting only offers suspects you've met.
import './helpers/env.js';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { startMockOpenAI } from './helpers/mock-openai.js';

const mock = await startMockOpenAI();
process.env.OPENAI_BASE_URL = mock.url;
const { buildApp } = await import('../src/server.js');
const { addPlayer, messagesFor, playerByToken } = await import('../src/store.js');
const { runBeat } = await import('../src/beats.js');
const { unlock, unlockedFor } = await import('../src/progress.js');
const { LENGTHS } = await import('../src/modes.js');
const app = buildApp();
after(async () => { await app.close(); await mock.close(); });

test('the nudge: anyone down to one contact gets texted first by a new suspect; others are left alone', async () => {
  const lonely = addPlayer({ name: 'Lou' });
  const busy = addPlayer({ name: 'Bea' });
  await unlock(lonely, 'ruth');
  await unlock(busy, 'ruth'); await unlock(busy, 'marcus');
  const r = await runBeat('nudge');
  assert.equal(r.nudged, 1);
  assert.deepEqual(unlockedFor(playerByToken(lonely.token)), ['ruth', 'teddy']);
  assert.ok(messagesFor(lonely.token).some((m) => m.thread === 'teddy' && m.from === 'character' && /tip/.test(m.text)));
  assert.deepEqual(unlockedFor(playerByToken(busy.token)), ['ruth', 'marcus']);
});

test('you can only vote for a suspect you have met', async () => {
  const v = addPlayer({ name: 'Vic' });
  await unlock(v, 'ruth');
  const no = await app.inject({ method: 'POST', url: `/api/p/${v.token}/vote`, payload: { killer: 'Lily Blackwood' } });
  assert.equal(no.statusCode, 400);
  assert.match(no.json().error, /haven’t met/);
  const yes = await app.inject({ method: 'POST', url: `/api/p/${v.token}/vote`, payload: { killer: 'Ruth Calloway' } });
  assert.equal(yes.statusCode, 200);
});

test('the 75-minute night: the nudge at 6 minutes, everyone unlocked by 12, long before votes open', () => {
  const at = Object.fromEntries(LENGTHS.quick.beats);
  assert.equal(at.nudge, 6);
  assert.equal(at.cast, 12);
  assert.ok(at.votesOpen > at.cast);
});
