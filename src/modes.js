// Game lengths. The story is one night: every length runs the same beats, just spread out differently.
// Tweak the minutes here after real playtests; nothing else needs to change.
// Each entry: [beat, minutes after the game starts].
export const LENGTHS = {
  quick: {
    label: 'One night · about 75 minutes',
    beats: [
      ['setup', 0], ['accomplice', 0.2], ['agendas', 0.4], ['intro', 0.5], ['calls', 1],
      ['nudge', 6], ['cast', 12], ['memo', 25], ['ruthWarning', 33], ['leak', 37], ['twist', 42], ['planted', 44], ['lilyCalls', 47],
      ['caretakerHint', 52], ['leak', 57], ['votesOpen', 62], ['lineRinging', 74], ['reveal', 75],
    ],
  },
  evening: {
    label: 'Slow burn · about 2 hours',
    beats: [
      ['setup', 0], ['accomplice', 0.2], ['agendas', 0.4], ['intro', 0.5], ['calls', 1],
      ['nudge', 8], ['cast', 18], ['memo', 40], ['ruthWarning', 55], ['leak', 62], ['twist', 70], ['planted', 73], ['lilyCalls', 78],
      ['caretakerHint', 85], ['leak', 92], ['votesOpen', 100], ['lineRinging', 119], ['reveal', 120],
    ],
  },
  // The whole night squeezed into a quarter hour, so the host can try every beat alone before game night.
  // One player can start it; keep calls short, because the beats come close together.
  test: {
    label: 'Test run · about 15 minutes',
    minPlayers: 1,
    beats: [
      ['setup', 0], ['accomplice', 0.1], ['agendas', 0.2], ['intro', 0.3], ['calls', 0.5],
      ['nudge', 2.5], ['cast', 3.5], ['memo', 5], ['ruthWarning', 6], ['leak', 7], ['twist', 8], ['planted', 8.5], ['lilyCalls', 9],
      ['caretakerHint', 10.5], ['leak', 11.5], ['votesOpen', 12], ['lineRinging', 14.5], ['reveal', 15],
    ],
  },
};
