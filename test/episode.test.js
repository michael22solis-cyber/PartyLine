// Episode packs: Blackwood loads from its pack and passes the checks; a broken pack is caught in plain words.
import './helpers/env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { EPISODES, loadEpisode, checkEpisode, episode } = await import('../src/episode.js');
const { recapFor } = await import('../src/recap.js');
const { addPlayer } = await import('../src/store.js');

test('every episode pack passes the checks', () => {
  for (const [id, pack] of Object.entries(EPISODES)) assert.deepEqual(checkEpisode(pack), [], id);
});

test('Blackwood is the default episode, and its patterns compile', () => {
  assert.equal(episode.id, 'blackwood');
  const bingo = episode.secrets.find((s) => s.id === 'bingo');
  assert.ok(bingo.ask.test('What time does St. Agnes bingo end?'));
  assert.ok(bingo.test('Bingo ends at 8:30 sharp.'));
  assert.ok(!bingo.test('Bingo ends late.'));
  assert.ok(episode.mentions.ruth.test('the night nurse'));
  assert.throws(() => loadEpisode('nope'), /Unknown episode "nope"/);
});

test('a broken pack is caught, in plain words', () => {
  const pack = structuredClone(EPISODES.blackwood);
  pack.truth.killer = 'Nobody';
  pack.secrets[0].ask = '(unclosed';
  pack.secrets[1].who = 'ghost';
  pack.timeline[1].shown = { found: 'history' }; // a secret with no evidence card
  const problems = checkEpisode(pack);
  assert.ok(problems.some((p) => /killer, "Nobody", isn't one of the suspects/.test(p)));
  assert.ok(problems.some((p) => /Secret "lullaby" ask: bad pattern/.test(p)));
  assert.ok(problems.some((p) => /belongs to "ghost"/.test(p)));
  assert.ok(problems.some((p) => /waits for secret "history", which has no evidence card/.test(p)));
  assert.deepEqual(checkEpisode({ ...pack, timeline: undefined }), ['Missing "timeline".']);
});

test('the reveal tells the episode’s own story', () => {
  const r = recapFor(addPlayer({ name: 'Ada' }));
  assert.equal(r.killerTruth, 'Ruth Calloway');
  assert.match(r.truth, /^Halloween 1996: Ruth Calloway, the night nurse/);
});
