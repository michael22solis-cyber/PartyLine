// The night, moment by moment: the timeline in each player's Notebook. The moments come from the episode pack.
// A moment appears once what it rests on has reached that player's phone (their clue, a card a friend shared, a secret
// they uncovered, the memo, the 911 call), so it never says more than the evidence they already hold.
import { messagesFor } from './store.js';
import { SECRETS } from './secrets.js';
import { episode } from './episode.js';

const card = (id) => SECRETS.find((s) => s.id === id).card;

function seenBy(p) {
  const texts = messagesFor(p.token).filter((m) => m.from !== 'player').map((m) => m.text || '');
  const has = (needle) => texts.some((t) => t.includes(needle));
  const found = (id) => (p.found || []).includes(id) || has(card(id));
  // A pack's condition: 'always', { seen: text on a card that reached them }, { found: secret id }, or a list (any).
  const holds = (c) => c === 'always' || (Array.isArray(c) ? c.some(holds) : c.seen ? has(c.seen) : found(c.found));
  return { holds };
}

export function timelineFor(p) {
  const s = seenBy(p);
  const moments = episode.timeline.filter((m) => s.holds(m.shown)).map((m) => ({
    id: m.id, time: m.time, era: Boolean(m.era), death: Boolean(m.death), known: m.shown === 'always', // everyone starts with it
    text: m.then && s.holds(m.then) ? m.then.text : m.text,
    notes: (m.notes || []).filter((n) => s.holds(n)).map((n) => n.text),
  }));
  return { moments, missing: episode.timeline.length - moments.length };
}
