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
  const steps = [
    {
      icon: 'messages', tag: 'BLACKWOOD MOBILE · FIELD GUIDE',
      title: TUTORIAL_TITLES[0],
      intro: 'Dana Whitlock was found dead at Blackwood Manor. Your phone is your way into the mystery.',
      points: [
        'Read clues, question the four suspects, and compare what you learn with the other players.',
        'Your private role card explains your goal. Keep it to yourself. You can read it again in MENU → My role.',
        'The host releases the story over two nights. You can explore the phone at your own pace between updates.',
      ],
      tip: 'BACK returns to the previous app. The round HOME button opens your apps. MENU has sound, calls, and alerts. You can return to this guide at any time.',
      extra: 'To catch new messages, use MENU → Turn on alerts. On iPhone, first add Blackwood to your Home Screen. If alerts are unavailable, keep the page open during play.',
    },
    {
      icon: 'evidence', tag: '01 · FIND A LEAD', title: TUTORIAL_TITLES[1],
      intro: 'Open The Line in Messages for story updates. Clues and recordings also collect in Evidence, your case file.',
      points: [
        'Read your starting clue closely. Look for a name, a time, or a detail you can ask someone about.',
        'When a recording has a play button, tap it to listen. Its written transcript stays on the card.',
        'The Line sends updates and private instructions; it does not accept replies.',
      ],
      tip: evidence ? 'Your case file has arrived. Open it and choose one detail to investigate.'
        : state.me.assigned ? 'Your role is ready. Your clue arrives when the host starts the first calls or sends the clues. Check The Line while you wait.'
          : 'Waiting for the host is normal. Your role and first clue will arrive as the game begins. Keep your private link handy.',
      actions: [{ label: evidence ? 'OPEN EVIDENCE' : 'OPEN THE LINE', view: evidence ? 'evidence' : 'messages', open: evidence ? null : 'line' }],
    },
    {
      icon: 'calls', tag: '02 · ASK A QUESTION', title: TUTORIAL_TITLES[2],
      intro: 'In Messages, choose an unlocked suspect under CONTACTS. Type a question and tap SEND.',
      example: 'Where were you when Dana died?',
      points: [
        'Start with an open question, then ask a follow-up about a detail from your clue. Try “Who can confirm that?”',
        'Suspects remember what the group tells them. Compare their answers and ask about contradictions.',
        'You can also tap CALL in a suspect’s conversation and talk out loud. Calls need microphone access and last up to four minutes. Texting is always an option.',
      ],
      tip: contacts ? 'You have a contact ready. Choose a suspect and ask your first question.'
        : 'No contacts yet? The first clue unlocks contacts, and more appear as names come up in conversations. Check The Line for the next update.',
      actions: [{ label: contacts ? 'CHOOSE A SUSPECT' : 'CHECK THE LINE', view: 'messages', open: contacts ? null : 'line' }],
      extra: 'When the phone rings, tap ANSWER and speak. If you miss it, check Calls for the call log or a voicemail. You can always come back to this guide afterward.',
    },
    {
      icon: 'messages', tag: '03 · PUT THE PIECES TOGETHER', title: TUTORIAL_TITLES[3],
      intro: 'Players receive different clues. The Crew is the group chat at the top of Messages.',
      points: [
        'On a clue, evidence card, or recording, tap ↗ SHARE, then choose The Crew or one player. They receive a copy of the card.',
        'Ask the crew what they found and compare times and stories. Use a player’s private chat for a one-to-one conversation.',
        'One player may have a different goal. Check claims against the evidence, and keep your role and private instructions to yourself.',
      ],
      tip: !crew ? 'You are the only player on the line so far. Sharing buttons appear when another player joins.'
        : !evidence ? 'The crew is here. Say hello while you wait for a clue to share.'
          : 'Open Evidence to share a card, then visit The Crew to compare what everyone knows.',
      actions: [
        { label: 'OPEN THE CREW', view: 'messages', open: 'crew' },
        ...(evidence && crew ? [{ label: 'FIND A CARD TO SHARE', view: 'evidence' }] : []),
      ],
    },
    {
      icon: 'notes', tag: '04 · FOLLOW THE THREAD', title: TUTORIAL_TITLES[4],
      intro: 'Use Notes to keep a timeline and remember what you want to ask next.',
      points: [
        'Write one fact you learned and one question you still have. Your notes save as you type.',
        'Tap a name on the suspect board to cycle through ?, SUSPICIOUS, and CLEARED. These are your own working theories.',
        'Notes are private and stored on this device. Keep using the same device to keep them with you.',
      ],
      tip: 'Stuck? Re-read a clue or recording, compare it with an answer, and ask one specific follow-up. New story updates arrive from the host; you do not need to find everything at once.',
      actions: [{ label: 'OPEN NOTES', view: 'notes' }],
    },
    {
      icon: state.revealed ? 'recap' : 'vote', tag: '05 · FINISH THE CASE', title: TUTORIAL_TITLES[5],
      intro: state.revealed ? 'The reveal has arrived. Open The End to see the result and your personal recap.'
        : 'When you are ready, open Vote to name the killer and the player you think is the accomplice.',
      points: [
        'Choose a suspect, choose an accomplice from the other players, then tap LOCK IN VOTE. Watch for “Your vote” to confirm it saved.',
        'You can update a saved vote until voting closes. The game’s deadline is 11:30 pm on Night 2; watch The Line for the host’s reminders.',
        'At the midnight reveal, The End unlocks with the result, your score, and the secrets you found.',
      ],
      tip: state.revealed ? 'Your case is closed. The End is ready to open.'
        : state.vote ? 'You already have a saved vote. Review it as new evidence arrives.'
          : 'Opening Vote lets you review the choices. Your vote is sent only when you tap LOCK IN VOTE.',
      actions: [{ label: state.revealed ? 'OPEN THE END' : 'REVIEW VOTING', view: state.revealed ? 'recap' : 'vote' }],
      extra: 'Your investigation loop: read a clue → ask a question → compare answers → update your notes. Then make your final vote.',
    },
  ];
  return steps[index];
}
