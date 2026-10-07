// The field guide uses public game state only. It never reveals a role or a solution.
export const TUTORIAL_TITLES = [
  'Your first night', 'Read your clue', 'Question a suspect',
  'Compare with the crew', 'Keep your own notes', 'Vote and see the ending',
];

export function readTutorialProgress(saved) {
  try {
    const value = JSON.parse(saved);
    if (!value || !['new', 'active', 'paused', 'complete'].includes(value.status)) throw new Error('Invalid progress');
    return {
      status: value.status,
      step: Number.isInteger(value.step) ? Math.max(0, Math.min(TUTORIAL_TITLES.length - 1, value.step)) : 0,
    };
  } catch {
    return { status: 'new', step: 0 };
  }
}

export function tutorialStep(index, state) {
  const evidence = state.messages.some((m) => ['clue', 'memo', 'evidence'].includes(m.kind));
  const contacts = state.threads.length > 0;
  const crew = (state.peers || []).length > 0;
  const calls = state.me.calls || { left: 30, max: 30, maxSeconds: 240 };
  const steps = [
    {
      icon: 'messages', tag: 'BLACKWOOD MOBILE · FIELD GUIDE',
      title: TUTORIAL_TITLES[0],
      intro: 'Dana Whitlock was found dead at Blackwood Manor. Your phone is your way into the mystery.',
      points: [
        'Read clues, question the four suspects, and compare notes with the other players.',
        'Your role card is private. Find it anytime in MENU → My role.',
      ],
      tip: 'BACK returns to the last app. The round HOME button opens your apps. MENU has sound, calls, captions, alerts, and this guide.',
      extra: 'Turn on alerts in MENU so you catch new messages. On iPhone, add Blackwood to your Home Screen first.',
    },
    {
      icon: 'evidence', tag: '01 · FIND A LEAD', title: TUTORIAL_TITLES[1],
      intro: 'Story updates arrive on The Line in Messages. Clues and recordings collect in Evidence, your case file.',
      points: [
        'Read your starting clue closely. Look for a name, a time, or a detail you can ask someone about.',
      ],
      tip: evidence ? 'Your case file has arrived. Open it and pick one detail to chase.'
        : state.me.assigned ? 'Your role is ready. Your clue arrives when the host sends it.'
          : 'Your role and first clue arrive when the host starts the game.',
      actions: [{ label: evidence ? 'OPEN EVIDENCE' : 'OPEN THE LINE', view: evidence ? 'evidence' : 'messages', open: evidence ? null : 'line' }],
    },
    {
      icon: 'calls', tag: '02 · ASK A QUESTION', title: TUTORIAL_TITLES[2],
      intro: 'Pick an unlocked suspect in Messages and text them a question, or tap ☎ CALL to talk out loud.',
      hint: { label: 'HOW TO ASK', text: 'Start broad. Then push on whatever doesn’t add up.' },
      visual: { type: 'calls', left: calls.left, max: calls.max, maxSeconds: calls.maxSeconds },
      points: [
        'Suspects hear what the group tells them. Catch them contradicting each other.',
      ],
      tip: contacts ? 'You have a contact ready. Pick a suspect and ask your first question.'
        : 'No contacts yet. Your first clue unlocks them, and more appear as names come up.',
      actions: [{ label: contacts ? 'CHOOSE A SUSPECT' : 'CHECK THE LINE', view: 'messages', open: contacts ? null : 'line' }],
      extra: 'When the phone rings, tap ANSWER. Missed it? Check Calls for a voicemail.',
    },
    {
      icon: 'messages', tag: '03 · PUT THE PIECES TOGETHER', title: TUTORIAL_TITLES[3],
      intro: 'The Crew is your group chat. Share what you find and compare stories.',
      visual: { type: 'share' },
      points: [
        'One of you may be lying. Trust the evidence.',
      ],
      tip: !crew ? 'You’re the only player here so far. Sharing turns on when someone joins.'
        : !evidence ? 'The crew is here. Say hello while you wait for a clue.'
          : 'Share a card from Evidence, then compare in The Crew.',
      actions: [
        { label: 'OPEN THE CREW', view: 'messages', open: 'crew' },
        ...(evidence && crew ? [{ label: 'FIND A CARD TO SHARE', view: 'evidence' }] : []),
      ],
    },
    {
      icon: 'notes', tag: '04 · FOLLOW THE THREAD', title: TUTORIAL_TITLES[4],
      intro: 'Jot down facts and open questions. Notes stay private on this device.',
      visual: { type: 'board' },
      points: [],
      tip: 'Stuck? Re-read a clue and ask one sharp follow-up.',
      actions: [{ label: 'OPEN NOTES', view: 'notes' }],
    },
    {
      icon: state.revealed ? 'recap' : 'vote', tag: '05 · FINISH THE CASE', title: TUTORIAL_TITLES[5],
      intro: state.revealed ? 'The reveal has arrived. Open The End to see the result and your recap.'
        : 'Name the killer and their accomplice, then tap LOCK IN VOTE.',
      visual: state.revealed ? null : { type: 'timeline' },
      points: [
        'At the reveal, see the result, your score, and the secrets you found.',
      ],
      tip: state.revealed ? 'Your case is closed. The End is ready to open.'
        : state.vote ? 'You have a saved vote. Change it as new evidence arrives.'
          : 'Opening Vote is safe. Nothing is sent until you tap LOCK IN VOTE.',
      actions: [{ label: state.revealed ? 'OPEN THE END' : 'REVIEW VOTING', view: state.revealed ? 'recap' : 'vote' }],
    },
  ];
  return steps[index];
}
