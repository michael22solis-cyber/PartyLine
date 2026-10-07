import test from 'node:test';
import assert from 'node:assert/strict';
import { readTutorialProgress, tutorialStep, TUTORIAL_TITLES } from '../public/tutorial.js';

const waiting = () => ({ me: { assigned: false, role: 'detective' }, threads: [], messages: [], peers: [], vote: null, revealed: false });

test('missing or damaged saved progress does not block the phone', () => {
  for (const saved of [null, '', '{', 'null', '[]', '{"status":"unexpected"}']) {
    assert.deepEqual(readTutorialProgress(saved), { status: 'new', step: 0 });
  }
  assert.equal(readTutorialProgress('{"status":"active","step":99}').step, TUTORIAL_TITLES.length - 1);
  assert.equal(readTutorialProgress('{"status":"active","step":-2}').step, 0);
  assert.equal(readTutorialProgress('{"status":"active","step":"2"}').step, 0);
});

test('paused and finished tutorials survive a reload', () => {
  for (const status of ['active', 'paused', 'complete']) {
    const progress = { status, step: 3 };
    assert.deepEqual(readTutorialProgress(JSON.stringify(progress)), progress);
  }
});

test('a player waiting for the host gets a reachable next move', () => {
  const game = waiting();
  assert.match(tutorialStep(1, game).tip, /Waiting for the host/);
  assert.equal(tutorialStep(1, game).actions[0].open, 'line');
  assert.equal(tutorialStep(2, game).actions[0].open, 'line');
  game.me.assigned = true;
  assert.match(tutorialStep(1, game).tip, /role is ready/);
});

test('received clues and unlocked contacts immediately change the suggested app', () => {
  const game = waiting();
  game.messages.push({ kind: 'clue' });
  game.threads.push({ key: 'ruth' });
  assert.equal(tutorialStep(1, game).actions[0].view, 'evidence');
  assert.equal(tutorialStep(2, game).actions[0].open, null);
  assert.match(tutorialStep(2, game).tip, /contact ready/);
});

test('sharing guidance accounts for a solo player and absent clues', () => {
  const game = waiting();
  assert.match(tutorialStep(3, game).tip, /only player/);
  assert.equal(tutorialStep(3, game).actions.length, 1);
  game.peers.push({ pid: 'friend' });
  assert.match(tutorialStep(3, game).tip, /wait for a clue/);
  game.messages.push({ kind: 'memo' });
  assert.equal(tutorialStep(3, game).actions[1].view, 'evidence');
});

test('voting guidance follows a saved vote and the final reveal', () => {
  const game = waiting();
  assert.equal(tutorialStep(5, game).actions[0].view, 'vote');
  game.vote = { killer: 'some suspect' };
  assert.match(tutorialStep(5, game).tip, /saved vote/);
  game.revealed = true;
  assert.equal(tutorialStep(5, game).actions[0].view, 'recap');
});

test('the shared guide never exposes a private role, message, or solution', () => {
  const game = waiting();
  game.me.role = 'accomplice';
  game.messages.push({ kind: 'secret', text: 'PRIVATE INSTRUCTION SENTINEL' });
  const before = structuredClone(game);
  const guide = TUTORIAL_TITLES.map((_, i) => tutorialStep(i, game));
  const text = JSON.stringify(guide);
  assert.doesNotMatch(text, /PRIVATE INSTRUCTION SENTINEL|You are the accomplice|Ruth Calloway|cellar floor|bingo/);
  for (const step of guide) {
    for (const action of step.actions || []) assert.ok(['messages', 'evidence', 'notes', 'vote', 'recap'].includes(action.view));
  }
  assert.deepEqual(game, before);
});
