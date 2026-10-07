// Post-game recap: per-player detective score, clues found, and a shareable card.
import { messagesFor, votes, players } from './store.js';
import { tallyVotes } from './beats.js';
import { CHARACTERS } from './characters/index.js';
import fs from 'node:fs';
import path from 'node:path';

const TRUTH = { killer: 'Ruth Calloway' };

import { SECRETS } from './secrets.js';
const FOUND = SECRETS.map((x) => ({ ...x, test: { test: x.test } }));

function memoryLines() {
  try { return JSON.parse(fs.readFileSync(path.resolve('data/memory.json'), 'utf8')).lines || []; } catch { return []; }
}

export function recapFor(player) {
  const keyByName = Object.fromEntries(Object.entries(CHARACTERS).map(([k, c]) => [c.name, k]));
  const heard = []; // { who, text } things characters said to this player (texts + calls)
  for (const m of messagesFor(player.token)) if (m.from === 'character') heard.push({ who: m.thread, text: m.text });
  for (const l of memoryLines()) {
    if (l.player === player.name && l.speaker === 'character') heard.push({ who: keyByName[l.character], text: l.text });
  }
  const found = FOUND.filter((f) => (player.found || []).includes(f.id) || heard.some((h) => h.who === f.who && f.test.test(h.text)));
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
      + Math.min(35, found.length * 6) ;
  }
  score = Math.min(100, score);
  const rank = isAccomplice
    ? (score >= 70 ? 'Master of Misdirection' : score >= 30 ? 'Shaky Liar' : 'Caught Red-Handed')
    : score >= 85 ? 'Lead Detective' : score >= 60 ? 'Sharp Eye' : score >= 35 ? 'Rookie Sleuth' : 'Lost in the Fog';

  return {
    name: player.name, role: player.role, score, rank, outcome,
    killerTruth: TRUTH.killer, accomplice,
    myVote: v, groupVote: { killer: tally.killer, accomplice: tally.accomplice },
    found: found.map((f) => f.label), missed: FOUND.filter((f) => !found.includes(f)).map((f) => f.label),
    totalClues: FOUND.length, textsSent: asked,
  };
}
