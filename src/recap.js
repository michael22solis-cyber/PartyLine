// Post-game recap: per-player detective score, clues found, and a shareable card.
import { messagesFor, votes, players } from './store.js';
import { tallyVotes } from './beats.js';
import { KEY_BY_NAME } from './characters/index.js';
import { allLines } from './memory.js';
import { mayAward } from './disclosure.js';

const TRUTH = { killer: 'Ruth Calloway' };

import { SECRETS } from './secrets.js';
const FOUND = SECRETS.map((x) => ({ ...x, test: { test: x.test } }));

export function recapFor(player) {
  const heard = []; // { who, text } things characters said to this player (texts + calls)
  for (const m of messagesFor(player.token)) if (m.from === 'character') heard.push({ who: m.thread, text: m.text, channel: 'text' });
  for (const l of allLines()) {
    if ((l.pid ? l.pid === player.pid : l.player === player.name) && l.speaker === 'character') heard.push({ who: l.npc || KEY_BY_NAME[l.character], text: l.text, channel: l.channel });
  }
  const found = FOUND.filter((f) => (player.found || []).includes(f.id)
    || heard.some((h) => h.who === f.who && f.test.test(h.text) && mayAward(player, f.who, f.id, [], h.channel)));
  const onCall = found.filter((f) => (player.foundOnCall || []).includes(f.id)
    || heard.some((h) => h.channel === 'call' && h.who === f.who && f.test.test(h.text)));
  const asked = messagesFor(player.token).filter((m) => m.from === 'player').length;

  const v = votes()[player.token] || null;
  const tally = tallyVotes();
  const accomplice = players().find((p) => p.role === 'accomplice')?.name || null;
  const groupCaughtRuth = tally.killer === TRUTH.killer;
  const groupCaughtAccomplice = !accomplice || tally.accomplice === accomplice;
  const isAccomplice = player.role === 'accomplice';

  let outcome; // what happened to the group
  if (!groupCaughtRuth) outcome = 'accomplice';
  else if (groupCaughtAccomplice) outcome = 'detectives';
  else outcome = 'split';

  // Score out of 100. Accomplices are scored on how well they steered the group.
  let score;
  if (isAccomplice) {
    score = (groupCaughtRuth ? 0 : 60) + (groupCaughtAccomplice ? 0 : 20) + Math.min(20, asked);
  } else {
    score = (v?.killer === TRUTH.killer ? 45 : 0) + (v?.accomplice === accomplice || !accomplice ? 20 : 0)
      + Math.min(35, found.length * 5 + onCall.length * 3); // secrets heard on a call count for more
  }
  score = Math.min(100, score);
  const rank = isAccomplice
    ? (score >= 70 ? 'Master of Misdirection' : score >= 30 ? 'Shaky Liar' : 'Caught Red-Handed')
    : score >= 85 ? 'Lead Detective' : score >= 60 ? 'Sharp Eye' : score >= 35 ? 'Rookie Sleuth' : 'Lost in the Fog';

  return {
    name: player.name, role: player.role, score, rank, outcome,
    killerTruth: TRUTH.killer, accomplice,
    myVote: v, groupVote: { killer: tally.killer, accomplice: tally.accomplice },
    found: found.map((f) => (onCall.includes(f) ? `${f.label} ☎` : f.label)), heardOnCalls: onCall.length, missed: FOUND.filter((f) => !found.includes(f)).map((f) => f.label),
    totalClues: FOUND.length, textsSent: asked,
  };
}
