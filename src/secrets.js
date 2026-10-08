// Guarded topics: what a suspect knows but only shares once the game engine approves it for a specific player.
//
// - topic: what the CHARACTER is told before approval (a subject to be cagey about, never the content).
// - ask:   player-side trigger. The engine approves a disclosure only when the player's own words match it.
// - fact:  the content, sent to the model only after approval for that player.
// - test:  detects the character actually saying it, which turns it into an evidence card (`card`).
// Locked secrets with an evidence card are the SECRETS list (they count toward the recap score).
// - phoneOnly: the character will only say it on a call (never in writing). Over text they tell the player to call.
export const TOPICS = [
  { id: 'lullaby', who: 'lily', label: 'The lullaby was Ruth’s',
    topic: 'a lullaby, humming or a song',
    ask: /lullab|humm|\bhum\b|\bsang\b|\bsing|\bsong|\btune\b|melod/i,
    fact: 'The night nurse, Ruth, used to sing that lullaby to your mother every night.',
    how: 'Say it quietly, like it hurts to remember.',
    test: (t) => /lullaby|sang|song|humm/i.test(t) && /ruth|nurse/i.test(t),
    card: 'Lily says the night nurse, Ruth Calloway, sang that lullaby to her mother every night.' },
  { id: 'mud', who: 'lily', label: 'Mud on Ruth’s shoes, 1996', phoneOnly: true,
    topic: 'the night your father vanished in 1996',
    ask: /\bmud|1996|ninety[- ]?six|(night|day|when|after) (your|ur|ya) (father|dad|pa)\b|\b(father|dad)('s)? (vanish|disappear|left|ran|went missing|gone)|(vanish|disappear).{0,30}(father|dad)|came home.{0,40}shoes/i,
    fact: 'You saw Ruth come home after midnight with mud on her shoes, the night your father vanished in 1996. You were twelve.',
    how: 'Tell it slowly, as a memory you have never said out loud.',
    test: (t) => /mud/i.test(t),
    card: 'Lily saw Ruth come home after midnight with mud on her shoes, the night her father vanished in 1996. She was twelve.' },
  { id: 'bingo', who: 'teddy', label: 'Bingo ends at 8:30, not 10',
    topic: 'St. Agnes bingo (you know its schedule)',
    ask: /bingo|st\.? ?agnes|saint agnes|\bchurch\b/i,
    fact: 'Thursday bingo at St. Agnes ends at 8:30 pm sharp; your tour walks past the church every week.',
    how: 'Say it casually; you have no reason to hide it.',
    test: (t) => /8:30|eight[- ]thirty/i.test(t),
    card: 'Teddy says Thursday bingo at St. Agnes ends at 8:30 pm sharp. Not 10.' },
  { id: 'diner', who: 'marcus', label: 'Marcus was at Rosie’s Diner',
    topic: 'your car being seen at the manor after dark, or where you really went Thursday',
    ask: /(car|vehicle|lexus|bmw|truck).{0,50}(manor|house|blackwood|after dark|that night|there)|(manor|house).{0,40}(car|vehicle)|after dark|neighbo|rosie|\bdiner\b|receipt|9:31|nine[- ]thirty[- ]one|7:10|seven[- ]ten/i,
    fact: 'You actually left the manor at 7:10 pm, not 6:30, and went straight to Rosie’s Diner, where you paid at 9:31 pm. Lily Blackwood was your server.',
    how: 'Cave in defensively, worried about your career.',
    test: (t) => /rosie|9:31|nine[- ]thirty/i.test(t),
    card: 'Marcus admits he left the manor at 7:10 and was at Rosie’s Diner by 9:31 pm. Lily was his server.' },
  { id: 'call911', who: 'lily', label: 'Lily made the 911 call', phoneOnly: true,
    topic: 'the anonymous 911 call, or your car at the manor that night',
    ask: /911|nine[- ]one[- ]one|emergency (call|line)|anonymous (call|caller|woman|tip)|(called|phoned|rang) the (police|cops)|(your|ur|lily'?s) car|(car|vehicle).{0,40}(manor|house).{0,40}(night|11|eleven)|11:12|11:02|key to the (manor|house)|at the manor that night/i,
    fact: 'You still have a key to the manor. At 11 pm Thursday you went to leave flowers in the cellar, found Dana dead, panicked, and made the anonymous 911 call at 11:12 pm. Dana was already dead when you arrived.',
    how: 'Admit it haltingly; you have been terrified someone would find out.',
    test: (t) => /already dead|i (made|placed) (the|that) call|i called (911|the police)|that was me|it was me/i.test(t),
    card: 'Lily admits she made the anonymous 911 call. Dana was already dead when she got there.' },
  { id: 'speakers', who: 'teddy', label: 'The “ghost” voices are speakers', phoneOnly: true,
    topic: 'the voice in the walls, or how your ghost effects work',
    ask: /speaker|voices? in the walls?|wall voice|\bfak(e|ed|ing)\b|\brig(s|ged|ging)?\b|trick(?!\s*(or|r)\s*treat)|hoax|recorded voices?|sound system|special effect|wired/i,
    fact: 'You rigged speakers in the manor that play recorded voices for your tours. They never hum.',
    how: 'Admit it sheepishly, then insist the house is still genuinely haunted.',
    test: (t) => /speaker/i.test(t),
    card: 'Teddy admits he rigged speakers in the manor for his tours. They play voices. They never hum.' },
  { id: 'history', who: 'marcus', label: 'Marcus hid the house’s history',
    topic: 'why the house never sold, or its history',
    ask: /(why|how come).{0,40}((never|didn'?t|wouldn'?t|couldn'?t|won'?t) sel[ld]|sat empty|on the market)|history of (the|that) (house|manor|place)|(house|manor)'?s history|ghost stor|disclos|(hide|hid|hidden|tell).{0,40}(buyer|dana)|1996/i,
    fact: 'You hid the ghost stories and the 1996 disappearance from buyers, including Dana.',
    how: 'Get defensive: it is not illegal, everyone does it.',
    test: (t) => /hid|didn'?t (tell|mention|disclose)|never (told|mentioned|disclosed)/i.test(t) && /ghost|1996|disappear|stor/i.test(t),
    card: null },
];

export const SECRETS = TOPICS.filter((t) => t.card);
export const topicsFor = (npc) => TOPICS.filter((t) => t.who === npc);
export const isPhoneOnly = (id) => Boolean(TOPICS.find((t) => t.id === id)?.phoneOnly);

// Who can be unlocked by being mentioned (by the player, a suspect, or a clue).
export const MENTIONS = {
  ruth: /\bruth\b|calloway|night nurse/i,
  marcus: /\bmarcus\b|\bvane\b|realtor/i,
  lily: /\blily\b|daughter/i,
  teddy: /\bteddy\b|\bfisk\b|ghost[- ]?tour|livestream/i,
};
