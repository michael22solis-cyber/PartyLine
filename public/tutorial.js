// The field guide uses public game state only. It never reveals a role or a solution.
export const TUTORIAL_TITLES = [
  'Your burner phone', 'Read your clue', 'Text or call',
  'Team up', 'Your Notebook', 'Vote',
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
  const calls = state.me.calls || { minutesLeft: 20, minutesMax: 20, maxSeconds: 240 };
  // Short on purpose: one line of what, one line of what to do next.
  const steps = [
    {
      icon: 'messages', tag: 'FIELD GUIDE', title: TUTORIAL_TITLES[0],
      intro: 'Someone died at Blackwood Manor. Use this phone to find out who.',
      points: [],
      tip: 'HOME opens your apps. MENU has sound, alerts, and your role.',
      extra: 'MENU → Turn on alerts, so the house can ring you while your phone is locked.',
    },
    {
      icon: 'evidence', tag: '01', title: TUTORIAL_TITLES[1],
      intro: 'Clues land in Evidence. Story updates come on The Line.',
      points: [],
      tip: evidence ? 'Your clue is in. Pick one detail to chase.'
        : state.me.assigned ? 'Your role is ready. Your clue is on its way.'
          : 'Your first clue arrives when the host starts the game.',
      actions: [{ label: evidence ? 'OPEN EVIDENCE' : 'OPEN THE LINE', view: evidence ? 'evidence' : 'messages', open: evidence ? null : 'line' }],
    },
    {
      icon: 'calls', tag: '02', title: TUTORIAL_TITLES[2],
      intro: calls.shared ? 'Text a suspect, or tap ☎ CALL to talk out loud. Some secrets only come out on a call. Call time is shared by the whole group, so choose well.'
        : 'Text a suspect, or tap ☎ CALL to talk out loud. Some secrets only come out on a call.',
      visual: { type: 'calls', left: calls.minutesLeft, max: calls.minutesMax, maxSeconds: calls.maxSeconds, shared: calls.shared },
      points: [],
      tip: contacts ? 'You have a contact ready. Ask your first question.'
        : 'No contacts yet. Your clue unlocks your first one.',
      actions: [{ label: contacts ? 'CHOOSE A SUSPECT' : 'CHECK THE LINE', view: 'messages', open: contacts ? null : 'line' }],
    },
    {
      icon: 'messages', tag: '03', title: TUTORIAL_TITLES[3],
      intro: 'The Crew is your group chat. Share clues with ↗ SHARE. One of you may be lying.',
      visual: { type: 'share' },
      points: [],
      tip: !crew ? 'You’re the only player here so far.'
        : !evidence ? 'Say hello while you wait for a clue.'
          : 'Share a clue and compare stories.',
      actions: [
        { label: 'OPEN THE CREW', view: 'messages', open: 'crew' },
        ...(evidence && crew ? [{ label: 'FIND A CARD TO SHARE', view: 'evidence' }] : []),
      ],
    },
    {
      icon: 'notes', tag: '04', title: TUTORIAL_TITLES[4],
      intro: 'Your secret agenda and suspect board. Nobody else sees them.',
      visual: { type: 'board' },
      points: [],
      tip: 'Missions unlock as you meet new people.',
      actions: [{ label: 'OPEN NOTEBOOK', view: 'notes' }],
    },
    {
      icon: state.revealed ? 'recap' : 'vote', tag: '05', title: TUTORIAL_TITLES[5],
      intro: state.revealed ? 'The case is closed. See how you did.' : 'Name the killer and the accomplice before the final call.',
      visual: state.revealed ? null : { type: 'timeline' },
      points: [],
      tip: state.revealed ? 'Open The End for your recap.'
        : state.vote ? 'You have a saved vote. You can change it until the end.'
          : 'Nothing is sent until you tap LOCK IN VOTE.',
      actions: [{ label: state.revealed ? 'OPEN THE END' : 'OPEN VOTE', view: state.revealed ? 'recap' : 'vote' }],
    },
  ];
  return steps[index];
}
