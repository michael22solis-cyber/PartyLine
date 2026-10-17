// Thursday night, moment by moment: the timeline in each player's Notebook.
// A moment appears once what it rests on has reached that player's phone (their clue, a card a friend shared, a secret
// they uncovered, the memo, the 911 call), so it never says more than the evidence they already hold.
import { messagesFor } from './store.js';
import { SECRETS } from './secrets.js';

const card = (id) => SECRETS.find((s) => s.id === id).card;
const always = () => true;

function seenBy(p) {
  const texts = messagesFor(p.token).filter((m) => m.from !== 'player').map((m) => m.text || '');
  const has = (needle) => texts.some((t) => t.includes(needle));
  return { has, found: (id) => (p.found || []).includes(id) || has(card(id)) };
}

// In story order. `shown` decides whether this player has it; `text` and `notes` can grow with what they've found.
const MOMENTS = [
  { id: 'elias', era: true, time: 'Halloween 1996', shown: always,
    text: 'Elias Blackwood, the manor’s caretaker, vanishes.',
    notes: [['mud', 'Lily saw Ruth come home after midnight with mud on her shoes.']] },
  { id: 'car', time: 'After dark', shown: (s) => s.has('NEIGHBOR’S TEXT'),
    text: 'A neighbor sees the realtor’s car at the manor.' },
  { id: 'leaves', time: '7:10 pm', shown: (s) => s.found('diner'),
    text: 'Marcus leaves the manor.' },
  { id: 'claim', time: 'Until 10 pm', shown: (s) => s.has('RUTH’S STATEMENT'),
    text: 'Ruth says she was at St. Agnes bingo.' },
  { id: 'bingo', time: '8:30 pm', shown: (s) => s.found('bingo'),
    text: 'Thursday bingo at St. Agnes lets out.' },
  { id: 'stream', time: '9–10 pm', shown: (s) => s.has('TEDDY’S LIVESTREAM'),
    text: 'Teddy streams his ghost show live from his apartment.' },
  { id: 'death', death: true, time: '9:30–10 pm', shown: always,
    text: 'Dana dies at the bottom of the cellar stairs, the police say.' },
  { id: 'receipt', time: '9:31 pm', shown: (s) => s.has('DINER RECEIPT') || s.found('diner'),
    text: (s) => (s.found('diner') ? 'Marcus pays at Rosie’s Diner. Lily is his server.' : 'Marcus’s card pays at Rosie’s Diner. The server signs “L.”') },
  { id: 'memo', time: '9:40 pm', shown: (s) => s.has('Who’s there?'),
    text: 'Dana’s voice memo: a lullaby hummed on the stairs, then “Who’s there? …Ma’am?”',
    notes: [['lullaby', 'The night nurse, Ruth, sang that lullaby to Lily’s mother.'], ['speakers', 'Teddy’s speakers play recorded voices. They never hum.']] },
  { id: 'call', time: '11:12 pm', shown: (s) => s.has('POLICE NOTE') || s.has('911 CALL') || s.found('call911'),
    text: (s) => (s.found('call911') ? 'Lily makes the anonymous 911 call. Dana was already dead when she got there.' : 'A woman calls 911 anonymously: someone is at the bottom of the stairs.') },
];

export function timelineFor(p) {
  const s = seenBy(p);
  const moments = MOMENTS.filter((m) => m.shown(s)).map((m) => ({
    id: m.id, time: m.time, era: Boolean(m.era), death: Boolean(m.death), known: m.shown === always, // everyone starts with it
    text: typeof m.text === 'function' ? m.text(s) : m.text,
    notes: (m.notes || []).filter(([id]) => s.found(id)).map(([, note]) => note),
  }));
  return { moments, missing: MOMENTS.length - moments.length };
}
