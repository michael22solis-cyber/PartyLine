// Episode 1: The Blackwood Line.
// An episode pack is plain data (no functions), so an AI can draft one and a checker can test it. Patterns are regular
// expressions written as strings, matched without regard to case. src/episode.js loads the pack and compiles them.
// Still to move in: the cast's prompts (src/characters), the beats' scripted lines (src/beats.js), agendas, hints,
// art and audio. See docs/PLAN.md.

export default {
  id: 'blackwood',
  title: 'The Blackwood Line',
  tagline: 'Thirty years after the caretaker vanished, the manor’s new owner is found at the bottom of the cellar stairs.',

  // Who players can vote for as the killer, in lineup order.
  suspects: ['Ruth Calloway', 'Marcus Vane', 'Lily Blackwood', 'Teddy Fisk'],

  // What really happened. Server only: it reaches players at the reveal, never before.
  truth: {
    killer: 'Ruth Calloway',
    story: 'Halloween 1996: Ruth Calloway, the night nurse who sang Mrs. Blackwood to sleep, killed Elias and buried him under the cellar floor. For thirty years everyone said he ran off. Then Dana booked a crew to dig up that floor. On Thursday, bingo let out at 8:30, and Ruth went to the manor. Dana never reached the bottom of the cellar stairs alive.',
  },

  // Dealt one per player at the start; a small group gets the leftovers later.
  clues: [
    'POLICE NOTE: Dana died between 9:30 and 10 pm. An anonymous 911 call came in at 11:12 pm, from a woman.',
    'RENOVATION CONTRACT: Dana booked a crew to dig up the cellar floor on November 2.',
    'RUTH’S STATEMENT: "I was at St. Agnes bingo until 10. Ask anyone."',
    'DINER RECEIPT: Rosie’s Diner, 9:31 pm, Marcus Vane’s card. Server: "L."',
    'TEDDY’S LIVESTREAM: Teddy Fisk streamed his ghost show live from his apartment, 9–10 pm.',
    'NEIGHBOR’S TEXT: "Saw the realtor’s car at the manor after dark Thursday."',
  ],

  // Guarded topics: what a suspect knows but shares only once the engine approves it for a specific player.
  // - topic: what the character is told before approval (a subject to be cagey about, never the content)
  // - ask:   what the player's own words must match for the engine to approve it
  // - fact:  the content, sent to the model only after approval for that player
  // - said:  every pattern must match what the character says for it to count as told (and award the `card`)
  // - card:  the evidence card; topics with one are the secrets that count toward the score
  // - phoneOnly: said only on a call, never in writing
  secrets: [
    { id: 'lullaby', who: 'lily', label: 'The lullaby was Ruth’s',
      topic: 'a lullaby, humming or a song',
      ask: 'lullab|humm|\\bhum\\b|\\bsang\\b|\\bsing|\\bsong|\\btune\\b|melod',
      fact: 'The night nurse, Ruth, used to sing that lullaby to your mother every night.',
      how: 'Say it quietly, like it hurts to remember.',
      said: ['lullaby|sang|song|humm', 'ruth|nurse'],
      card: 'Lily says the night nurse, Ruth Calloway, sang that lullaby to her mother every night.' },
    { id: 'mud', who: 'lily', label: 'Mud on Ruth’s shoes, 1996', phoneOnly: true,
      topic: 'the night your father vanished in 1996',
      ask: "\\bmud|1996|ninety[- ]?six|(night|day|when|after) (your|ur|ya) (father|dad|pa)\\b|\\b(father|dad)('s)? (vanish|disappear|left|ran|went missing|gone)|(vanish|disappear).{0,30}(father|dad)|came home.{0,40}shoes",
      fact: 'You saw Ruth come home after midnight with mud on her shoes, the night your father vanished in 1996. You were twelve.',
      how: 'Tell it slowly, as a memory you have never said out loud.',
      said: ['mud'],
      card: 'Lily saw Ruth come home after midnight with mud on her shoes, the night her father vanished in 1996. She was twelve.' },
    { id: 'bingo', who: 'teddy', label: 'Bingo ends at 8:30, not 10',
      topic: 'St. Agnes bingo (you know its schedule)',
      ask: 'bingo|st\\.? ?agnes|saint agnes|\\bchurch\\b',
      fact: 'Thursday bingo at St. Agnes ends at 8:30 pm sharp; your tour walks past the church every week.',
      how: 'Say it casually; you have no reason to hide it.',
      said: ['8:30|eight[- ]thirty'],
      card: 'Teddy says Thursday bingo at St. Agnes ends at 8:30 pm sharp. Not 10.' },
    { id: 'diner', who: 'marcus', label: 'Marcus was at Rosie’s Diner',
      topic: 'your car being seen at the manor after dark, or where you really went Thursday',
      ask: '(car|vehicle|lexus|bmw|truck).{0,50}(manor|house|blackwood|after dark|that night|there)|(manor|house).{0,40}(car|vehicle)|after dark|neighbo|rosie|\\bdiner\\b|receipt|9:31|nine[- ]thirty[- ]one|7:10|seven[- ]ten',
      fact: 'You actually left the manor at 7:10 pm, not 6:30, and went straight to Rosie’s Diner, where you paid at 9:31 pm. Lily Blackwood was your server.',
      how: 'Cave in defensively, worried about your career.',
      said: ['rosie|9:31|nine[- ]thirty'],
      card: 'Marcus admits he left the manor at 7:10 and was at Rosie’s Diner by 9:31 pm. Lily was his server.' },
    { id: 'call911', who: 'lily', label: 'Lily made the 911 call', phoneOnly: true,
      topic: 'the anonymous 911 call, or your car at the manor that night',
      ask: "911|nine[- ]one[- ]one|emergency (call|line)|anonymous (call|caller|woman|tip)|(called|phoned|rang) the (police|cops)|(your|ur|lily'?s) car|(car|vehicle).{0,40}(manor|house).{0,40}(night|11|eleven)|11:12|11:02|key to the (manor|house)|at the manor that night",
      fact: 'You still have a key to the manor. At 11 pm Thursday you went to leave flowers in the cellar, found Dana dead, panicked, and made the anonymous 911 call at 11:12 pm. Dana was already dead when you arrived.',
      how: 'Admit it haltingly; you have been terrified someone would find out.',
      said: ['already dead|i (made|placed) (the|that) call|i called (911|the police)|that was me|it was me'],
      card: 'Lily admits she made the anonymous 911 call. Dana was already dead when she got there.' },
    { id: 'speakers', who: 'teddy', label: 'The “ghost” voices are speakers', phoneOnly: true,
      topic: 'the voice in the walls, or how your ghost effects work',
      ask: 'speaker|voices? in the walls?|wall voice|\\bfak(e|ed|ing)\\b|\\brig(s|ged|ging)?\\b|trick(?!\\s*(or|r)\\s*treat)|hoax|recorded voices?|sound system|special effect|wired',
      fact: 'You rigged speakers in the manor that play recorded voices for your tours. They never hum.',
      how: 'Admit it sheepishly, then insist the house is still genuinely haunted.',
      said: ['speaker'],
      card: 'Teddy admits he rigged speakers in the manor for his tours. They play voices. They never hum.' },
    { id: 'history', who: 'marcus', label: 'Marcus hid the house’s history',
      topic: 'why the house never sold, or its history',
      ask: "(why|how come).{0,40}((never|didn'?t|wouldn'?t|couldn'?t|won'?t) sel[ld]|sat empty|on the market)|history of (the|that) (house|manor|place)|(house|manor)'?s history|ghost stor|disclos|(hide|hid|hidden|tell).{0,40}(buyer|dana)|1996",
      fact: 'You hid the ghost stories and the 1996 disappearance from buyers, including Dana.',
      how: 'Get defensive: it is not illegal, everyone does it.',
      said: ["hid|didn'?t (tell|mention|disclose)|never (told|mentioned|disclosed)", 'ghost|1996|disappear|stor'],
      card: null },
  ],

  // Who gets added to a player's phone when someone mentions them (the player, a suspect, or a clue).
  mentions: {
    ruth: '\\bruth\\b|calloway|night nurse',
    marcus: '\\bmarcus\\b|\\bvane\\b|realtor',
    lily: '\\blily\\b|daughter',
    teddy: '\\bteddy\\b|\\bfisk\\b|ghost[- ]?tour|livestream',
  },

  // The night, moment by moment, for the Notebook. A moment shows once its evidence has reached the player:
  //   shown: 'always' | { seen: text on a card that reached their phone } | { found: secret id } | a list (any of them)
  //   then:  a fuller line once they've found a secret;  notes: a line added under it once they've found a secret
  timeline: [
    { id: 'elias', era: true, time: 'Halloween 1996', shown: 'always',
      text: 'Elias Blackwood, the manor’s caretaker, vanishes.',
      notes: [{ found: 'mud', text: 'Lily saw Ruth come home after midnight with mud on her shoes.' }] },
    { id: 'car', time: 'After dark', shown: { seen: 'NEIGHBOR’S TEXT' },
      text: 'A neighbor sees the realtor’s car at the manor.' },
    { id: 'leaves', time: '7:10 pm', shown: { found: 'diner' },
      text: 'Marcus leaves the manor.' },
    { id: 'claim', time: 'Until 10 pm', shown: { seen: 'RUTH’S STATEMENT' },
      text: 'Ruth says she was at St. Agnes bingo.' },
    { id: 'bingo', time: '8:30 pm', shown: { found: 'bingo' },
      text: 'Thursday bingo at St. Agnes lets out.' },
    { id: 'stream', time: '9–10 pm', shown: { seen: 'TEDDY’S LIVESTREAM' },
      text: 'Teddy streams his ghost show live from his apartment.' },
    { id: 'death', death: true, time: '9:30–10 pm', shown: 'always',
      text: 'Dana dies at the bottom of the cellar stairs, the police say.' },
    { id: 'receipt', time: '9:31 pm', shown: [{ seen: 'DINER RECEIPT' }, { found: 'diner' }],
      text: 'Marcus’s card pays at Rosie’s Diner. The server signs “L.”',
      then: { found: 'diner', text: 'Marcus pays at Rosie’s Diner. Lily is his server.' } },
    { id: 'memo', time: '9:40 pm', shown: { seen: 'Who’s there?' },
      text: 'Dana’s voice memo: a lullaby hummed on the stairs, then “Who’s there? …Ma’am?”',
      notes: [
        { found: 'lullaby', text: 'The night nurse, Ruth, sang that lullaby to Lily’s mother.' },
        { found: 'speakers', text: 'Teddy’s speakers play recorded voices. They never hum.' },
      ] },
    { id: 'call', time: '11:12 pm', shown: [{ seen: 'POLICE NOTE' }, { seen: '911 CALL' }, { found: 'call911' }],
      text: 'A woman calls 911 anonymously: someone is at the bottom of the stairs.',
      then: { found: 'call911', text: 'Lily makes the anonymous 911 call. Dana was already dead when she got there.' } },
  ],
};
