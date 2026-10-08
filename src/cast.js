// The characters as people on the phone, beyond their words: what they're up to right now (a status line that follows
// the story), how they type, and the photos they send at certain moments. Their faces are in public/cast/.
import { firedBeats } from './store.js';

// The story so far, from the beats that have fired.
const PHASES = [
  ['after', ['reveal']],
  ['final', ['votesOpen', 'lineRinging']],
  ['deep', ['twist', 'planted', 'caretakerHint']],
  ['late', ['memo', 'ruthWarning']],
  ['early', ['intro', 'calls', 'clues', 'cast']],
];
export function phase(beats = firedBeats()) {
  for (const [name, triggers] of PHASES) if (triggers.some((b) => beats.includes(b))) return name;
  return 'before';
}

const STATUS = {
  ruth: {
    before: 'at evening prayers', early: 'at home, knitting', late: "up late, can't sleep", deep: 'at home with the TV on',
    final: 'praying for poor Dana', after: 'unavailable',
  },
  marcus: {
    before: 'showing a property', early: 'on another call', late: 'at the office, late', deep: 'driving',
    final: 'on the phone with his lawyer', after: 'offline',
  },
  lily: {
    before: "on shift at Rosie's", early: "on shift at Rosie's", late: 'off shift', deep: 'sitting in her car',
    final: "can't sleep", after: 'offline',
  },
  teddy: {
    before: 'prepping tonight’s tour', early: '🔴 LIVE: Blackwood ghost tour', late: 'editing the stream', deep: '🔴 LIVE: Halloween special',
    final: 'reading his comments', after: 'offline',
  },
};
export const statusOf = (npc, p = phase()) => STATUS[npc]?.[p] || '';

// How each of them types: ms per character, the longest they'll "type" for, and whether they stop and start again.
const TYPING = {
  ruth: { perChar: 55, max: 7000, hesitate: true },   // slow, careful, proper punctuation
  lily: { perChar: 40, max: 5500, hesitate: true },   // starts, stops, says less than she meant to
  marcus: { perChar: 16, max: 3000, hesitate: false }, // fast and curt
  teddy: { perChar: 14, max: 2800, hesitate: false },  // fast, lots of exclamation points
};
export function typingPlan(npc, reply) {
  const t = TYPING[npc] || { perChar: 25, max: 4000, hesitate: false };
  const total = Math.min(t.max, 600 + reply.length * t.perChar);
  if (!t.hesitate || reply.length < 40) return [{ typing: true, ms: total }];
  // Type, stop for a moment (the dots disappear), then finish.
  const first = Math.round(total * 0.45);
  return [{ typing: true, ms: first }, { typing: false, ms: 1400 }, { typing: true, ms: total - first }];
}

// Photos the characters send at story beats (made from the game's own art, see public/photos/).
// `remember` is what the character knows they sent, so they can talk about it.
export const PHOTOS = {
  cast: { npc: 'teddy', image: '/assets/photos/teddy-flyer.jpg',
    text: 'ok detectives!! since ur investigating, here’s the flyer!! Halloween tour is STILL ON 👻👻',
    remember: 'sent the player a flyer for your Blackwood Manor ghost tour ("Hear the house speak!")' },
  memo: { npc: 'marcus', image: '/assets/photos/marcus-listing.jpg',
    text: 'Listing photo from when it was on the market. It’s a cellar. Storage. That’s it, okay?',
    remember: 'sent the player the old listing photo of the manor’s cellar stairs' },
  ruthWarning: { npc: 'ruth', image: '/assets/photos/ruth-card.jpg',
    text: 'Sweetheart, I had these made for poor Dana. Keep her in your prayers tonight. God bless.',
    remember: 'sent the player a memorial prayer card you had printed for Dana' },
  twist: { npc: 'lily', image: '/assets/photos/lily-polaroid.jpg',
    text: 'found this in a box. last picture of the house before he was gone.',
    remember: 'sent the player an old polaroid of the manor from Halloween 1996, the last before your father vanished' },
};
