// Starting clues: one each at the start, never twice; in a small group the leftovers arrive a few minutes later.
import './helpers/env.js';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { startMockOpenAI } from './helpers/mock-openai.js';

process.env.BEAT_TIME_SCALE = '0.001';
process.env.RING_TIMEOUT_MS = '20';
const mock = await startMockOpenAI();
process.env.OPENAI_BASE_URL = mock.url;
const { addPlayer, messagesFor, playerByToken } = await import('../src/store.js');
const { runBeat } = await import('../src/beats.js');
const { unlockedFor } = await import('../src/progress.js');
after(() => mock.close());

test('three players: one clue each at first (not all six), the rest at the nudge; calls + clues never double up', async () => {
  const ps = ['Ann', 'Ben', 'Cy'].map((name) => addPlayer({ name }));
  await runBeat('setup');
  await runBeat('clues');
  await runBeat('calls'); // already had their clue: nothing new
  for (const p of ps) {
    const clues = messagesFor(p.token).filter((m) => m.kind === 'clue');
    assert.equal(clues.length, 1, `${p.name} got exactly one clue`);
    assert.ok(!clues[0].text.includes('\n\n'), 'a single clue, not a stack');
  }
  const contactsBefore = ps.map((p) => unlockedFor(playerByToken(p.token)).length);
  await runBeat('nudge');
  for (const p of ps) {
    const clues = messagesFor(p.token).filter((m) => m.kind === 'clue');
    assert.equal(clues.length, 2, `${p.name} gets one more lead later`);
    assert.match(clues[1].text, /^ANOTHER LEAD TURNED UP/);
  }
  assert.ok(ps.some((p, i) => unlockedFor(playerByToken(p.token)).length > contactsBefore[i]), 'the later lead brings new contacts');
});
