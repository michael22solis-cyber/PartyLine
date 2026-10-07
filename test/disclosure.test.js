// The engine's disclosure triggers: realistic ways players raise each topic, and near-misses that must not count.
import './helpers/env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.USAGE_LEDGER = 'off';
const { TOPICS } = await import('../src/secrets.js');
const { addPlayer, playerByToken } = await import('../src/store.js');
const { requestDisclosure, approveFromPlayerText, mayAward } = await import('../src/disclosure.js');

const ask = Object.fromEntries(TOPICS.map((t) => [t.id, t.ask]));
const CASES = {
  call911: {
    yes: ['did you make the 911 call?', 'Someone called nine-one-one at 11:12. Was that you?', 'who was the anonymous caller', 'your car was at the manor at 11:02', 'Lily, you still have a key to the house, right?', 'you phoned the police that night, didn\'t you'],
    no: ['where were you thursday?', 'did you know Dana?', 'what time did your shift end'],
  },
  lullaby: {
    yes: ['do you know a lullaby someone used to hum?', 'who sang to your mother', 'what song was that on the memo', 'there was humming on the recording'],
    no: ['what happened to your dad', 'where were you at 9:40'],
  },
  mud: {
    yes: ['what happened the night your father vanished?', 'tell me about 1996', 'who came home with mud on her shoes?', 'the night your dad disappeared, what did you see'],
    no: ['what is your favorite food', 'did you see Marcus at the diner'],
  },
  bingo: {
    yes: ['what time does bingo end at St. Agnes?', 'you walk past the church on your tour?', 'saint agnes bingo, is it really till 10?'],
    no: ['where were you thursday', 'are you a fraud'],
  },
  diner: {
    yes: ['A neighbor saw your car at the manor after dark', 'your card was used at Rosie\'s at 9:31', 'I have the diner receipt', 'you left at 7:10, not 6:30'],
    no: ['what time did you leave the manor', 'who bought the house'],
  },
  speakers: {
    yes: ['are the voices in the walls speakers?', 'your ghosts are fake, admit it', 'how did you rig the house', 'is it all a hoax?', 'Ruth says it is all your tricks'],
    no: ['trick or treat!', 'did you hear the recording of the memo?', 'where were you streaming from'],
  },
  history: {
    yes: ['why did the house never sell?', 'did you disclose the history to Dana?', 'did you hide the ghost stories from buyers?'],
    no: ['how much did the house sell for', 'when did you leave'],
  },
};

for (const [id, { yes, no }] of Object.entries(CASES)) {
  test(`trigger "${id}" matches paraphrases and ignores near-misses`, () => {
    for (const s of yes) assert.match(s, ask[id], `should trigger: ${s}`);
    for (const s of no) assert.doesNotMatch(s, ask[id], `should not trigger: ${s}`);
  });
}

test('the model alone cannot unlock a secret: the player must have raised it', () => {
  const p = addPlayer({ name: 'Ava' });
  const denied = requestDisclosure(p, 'teddy', 'speakers', 'what did you have for dinner?');
  assert.equal(denied.decision, 'stay_guarded');
  assert.ok(!JSON.stringify(denied).includes('speakers in the manor'));
  assert.equal(mayAward(playerByToken(p.token), 'teddy', 'speakers'), false);
  const ok = requestDisclosure(p, 'teddy', 'speakers', 'are the voices in the walls coming from speakers?');
  assert.equal(ok.decision, 'open_up');
  assert.match(ok.memory, /speakers/);
  assert.equal(mayAward(playerByToken(p.token), 'teddy', 'speakers'), true);
  // Unknown or other characters' topics are refused.
  assert.equal(requestDisclosure(p, 'teddy', 'call911', '911!').decision, 'stay_guarded');
  // Once approved, it stays approved for that player (consistency across turns and calls).
  assert.equal(requestDisclosure(p, 'teddy', 'speakers', 'hello').decision, 'open_up');
});

test('one message can approve several topics, once each', () => {
  const p = addPlayer({ name: 'Bo' });
  const got = approveFromPlayerText(p, 'lily', 'the 911 call, and the lullaby, and 1996. all of it.');
  assert.deepEqual(got.map((t) => t.id).sort(), ['call911', 'lullaby', 'mud']);
  assert.deepEqual(approveFromPlayerText(p, 'lily', 'the 911 call again'), []);
});

test('rollback (CONTEXT_MODE=legacy) returns secret judgement to the characters, as before', async () => {
  process.env.CONTEXT_MODE = 'legacy';
  const p = addPlayer({ name: 'Cy' });
  assert.deepEqual(approveFromPlayerText(p, 'lily', '911'), []);
  assert.equal(mayAward(p, 'lily', 'call911'), true);
  delete process.env.CONTEXT_MODE;
});
