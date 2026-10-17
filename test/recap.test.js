// The end screen: an accomplice's rank follows what the group did. One nobody named was never "caught red-handed".
import './helpers/env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { addPlayer, players, updatePlayer, castVote, resetGame } = await import('../src/store.js');
const { recapFor } = await import('../src/recap.js');

// Four players, Cy is the accomplice; everyone votes the same way.
function night(killer, accomplice) {
  resetGame();
  const ps = ['Ava', 'Ben', 'Cy', 'Dee'].map((name) => addPlayer({ name }));
  updatePlayer(ps[2].token, { role: 'accomplice' });
  ps.forEach((p) => castVote(p.token, killer, accomplice));
  return recapFor(players().find((p) => p.name === 'Cy'));
}

test('the accomplice’s rank and outcome match who the group named', () => {
  const cases = [
    ['Ruth Calloway', 'Cy', 'detectives', 'Caught Red-Handed'],
    ['Ruth Calloway', 'Dee', 'split', 'Slipped Away'],
    ['Marcus Vane', 'Cy', 'accomplice', 'Shaky Liar'],
    ['Marcus Vane', 'Dee', 'accomplice', 'Master of Misdirection'],
  ];
  for (const [killer, accomplice, outcome, rank] of cases) {
    const r = night(killer, accomplice);
    assert.equal(r.outcome, outcome, `${killer} / ${accomplice}`);
    assert.equal(r.rank, rank, `${killer} / ${accomplice}`);
  }
});
