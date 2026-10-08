// Gentle nudges for stuck players: who to talk to and how, never the answer itself. The host can send one from the
// host page, and anyone who has found nothing by the 911 twist gets one automatically on The Line. Phone-only secrets
// come first, so a nudge also teaches that some things only come out on a call.
import { players, playerByToken, updatePlayer } from './store.js';
import { deliver } from './live.js';
import { unlock } from './progress.js';
import { ledger } from './ai/ledger.js';

export const HINTS = {
  call911: { who: 'lily', text: 'Lily knows more than she’ll ever put in writing. Call her and ask about Thursday night.' },
  bingo: { who: 'teddy', text: 'Ruth says she was at bingo until 10. Teddy walks his tour past St. Agnes every week. Ask him.' },
  diner: { who: 'marcus', text: 'Someone saw the realtor’s car at the manor after dark. Ask Marcus where he really went.' },
  speakers: { who: 'teddy', text: 'The voice in the walls sounds awfully convenient for a ghost tour. Call Teddy and ask how it works.' },
  mud: { who: 'lily', text: 'Lily was twelve the night her father vanished. Call her and ask what she saw.' },
  lullaby: { who: 'lily', text: 'Someone in that house used to hum a lullaby. Ask Lily whose song it was.' },
};
const ORDER = ['call911', 'bingo', 'diner', 'speakers', 'mud', 'lullaby'];

// The next hint this player hasn't had, for a secret they haven't found.
export function nextHint(p) {
  const id = ORDER.find((s) => !(p.found || []).includes(s) && !(p.hinted || []).includes(s));
  return id ? { id, ...HINTS[id] } : null;
}

export async function sendHint(token, { auto = false } = {}) {
  const p = playerByToken(token);
  if (!p) return null;
  const h = nextHint(p);
  if (!h) return null;
  updatePlayer(token, { hinted: [...(p.hinted || []), h.id] });
  await unlock(p, h.who);
  await deliver({ token, thread: 'line', from: 'character', text: `A WHISPER ON THE LINE: ${h.text}` });
  ledger.event('hint_sent', { session: p.pid, secret: h.id, auto });
  return h;
}

// At the twist: anyone (but the accomplice) who still has no evidence gets a nudge.
export async function nudgeStuck() {
  const stuck = players().filter((p) => p.role !== 'accomplice' && !(p.found || []).length);
  for (const p of stuck) await sendHint(p.token, { auto: true });
  return stuck.length;
}
