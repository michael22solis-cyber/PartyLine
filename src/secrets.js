// The locked secrets. When a suspect lets one slip to a player (by text or in a call),
// it becomes an evidence card in that player's case file, and it counts toward their recap score.
export const SECRETS = [
  { id: 'lullaby', who: 'lily', label: 'The lullaby was Ruth’s',
    test: (t) => /lullaby|sang|song|humm/i.test(t) && /ruth|nurse/i.test(t),
    card: 'Lily says the night nurse, Ruth Calloway, sang that lullaby to her mother every night.' },
  { id: 'mud', who: 'lily', label: 'Mud on Ruth’s shoes, 1996',
    test: (t) => /mud/i.test(t),
    card: 'Lily saw Ruth come home after midnight with mud on her shoes, the night her father vanished in 1996. She was twelve.' },
  { id: 'bingo', who: 'teddy', label: 'Bingo ends at 8:30, not 10',
    test: (t) => /8:30|eight[- ]thirty/i.test(t),
    card: 'Teddy says Thursday bingo at St. Agnes ends at 8:30 pm sharp. Not 10.' },
  { id: 'diner', who: 'marcus', label: 'Marcus was at Rosie’s Diner',
    test: (t) => /rosie|9:31|nine[- ]thirty/i.test(t),
    card: 'Marcus admits he left the manor at 7:10 and was at Rosie’s Diner by 9:31 pm. Lily was his server.' },
  { id: 'call911', who: 'lily', label: 'Lily made the 911 call',
    test: (t) => /already dead|i (made|placed) (the|that) call|i called (911|the police)|that was me|it was me/i.test(t),
    card: 'Lily admits she made the anonymous 911 call. Dana was already dead when she got there.' },
  { id: 'speakers', who: 'teddy', label: 'The “ghost” voices are speakers',
    test: (t) => /speaker/i.test(t),
    card: 'Teddy admits he rigged speakers in the manor for his tours. They play voices. They never hum.' },
];

// Who can be unlocked by being mentioned (by the player, a suspect, or a clue).
export const MENTIONS = {
  ruth: /\bruth\b|calloway|night nurse/i,
  marcus: /\bmarcus\b|\bvane\b|realtor/i,
  lily: /\blily\b|daughter/i,
  teddy: /\bteddy\b|\bfisk\b|ghost[- ]?tour|livestream/i,
};
