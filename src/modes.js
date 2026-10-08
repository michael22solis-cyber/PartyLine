// Game lengths. The story is one night: every length runs the same beats, just spread out differently.
// Tweak the minutes here after real playtests; nothing else needs to change.
// Each entry: [beat, minutes after the game starts].
export const LENGTHS = {
  quick: {
    label: 'One night · about 75 minutes',
    beats: [
      ['setup', 0], ['accomplice', 0.2], ['intro', 0.5], ['calls', 1],
      ['cast', 20], ['memo', 25], ['ruthWarning', 33], ['twist', 42], ['planted', 44],
      ['caretakerHint', 52], ['votesOpen', 62], ['lineRinging', 74], ['reveal', 75],
    ],
  },
  evening: {
    label: 'Slow burn · about 2 hours',
    beats: [
      ['setup', 0], ['accomplice', 0.2], ['intro', 0.5], ['calls', 1],
      ['cast', 30], ['memo', 40], ['ruthWarning', 55], ['twist', 70], ['planted', 73],
      ['caretakerHint', 85], ['votesOpen', 100], ['lineRinging', 119], ['reveal', 120],
    ],
  },
};
