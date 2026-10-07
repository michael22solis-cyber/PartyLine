// Deterministic, plausible playtest dialogue for the simulator (so prompt sizes are realistic, not guessed).
export const PLAYER_LINES = {
  caretaker: ['Hello? Who is this?', 'What do you mean, twenty steps?', 'Who pushed you?', 'Is this a prank?', 'Where are you calling from?'],
  ruth: ['Hi Ruth, sorry to call so late.', 'Where were you on Thursday night?', 'How well did you know Dana?', 'Someone said bingo ends at 8:30.', 'Did you ever work at the manor?', 'What happened to Lily\'s father?', 'Have you been down in that cellar?', 'Do you know a lullaby?', 'Who do you think did it?'],
  lily: ['Lily? I got your number from Dana\'s phone.', 'Where were you Thursday?', 'Did you serve Marcus that night?', 'Do you still go to the house?', 'What do you remember about your dad?', 'Who sang to your mother?', 'Did you make the 911 call?', 'Why are you so angry at that house?'],
  teddy: ['Teddy, is the manor really haunted?', 'Where were you Thursday at 9:40?', 'Can anyone check your livestream?', 'What do the voices in the walls say?', 'When does bingo end at St. Agnes?', 'Have you ever faked anything on a tour?', 'What do you know about Ruth?', 'Did you know Dana?'],
  caretaker_reveal: ['Wait... it was Ruth?', 'Goodbye.'],
  marcus: ['Marcus, you sold Dana the house?', 'What time did you leave Thursday?', 'A neighbor saw your car after dark.', 'Why did the house never sell before?', 'What were Dana\'s plans for the cellar?', 'Did you see anyone else there?', 'Do you trust Teddy?'],
};

export const REPLIES = {
  caretaker: ['...Twenty steps down... and I never came back up.', 'She didn\'t fall on her own. Neither did I.', 'The humming was real.', 'Ask my daughter... about the song.', 'The line is fading... Find me before midnight.'],
  ruth: ['Oh, sweetheart, it\'s no trouble at all. I don\'t sleep much these days.', 'I was at St. Agnes bingo until ten, God bless. Ask anyone.', 'I barely knew her, dear. Such a shame.', 'Eight-thirty? I must have stayed to help clean up... my memory isn\'t what it was.', 'Some doors in that house are better left closed.', 'That poor girl was always so angry at that house.', 'Oh... I don\'t know any songs, dear. Have you eaten?'],
  lily: ['...who gave you this number?', 'i was at work. ask anyone at the diner.', 'yeah. he tipped badly. around nine thirty.', 'that house took everything from us.', 'my father never left that house.', 'i don\'t want to talk about that.', 'leave me alone.'],
  teddy: ['Genuinely haunted, my friend! I\'d stake my reputation on it!', 'I was LIVE, baby! Nine to ten, check the replay!', 'The voices? Whispers from the other side! Spooky stuff!', 'Ruth? Sweet old lady. Bakes for the whole block!', 'Never met her, but I heard she wanted to dig up the cellar!'],
  caretaker_reveal: ['Thirty years I\'ve waited under that floor. She sang my wife to sleep, and then she buried me. Ruth Calloway. Dana was going to find me, so Ruth made sure she never reached the bottom of the stairs alive. Thank you for listening. Happy Halloween.', 'Yes... goodbye now.'],
  marcus: ['Marcus Vane. Who\'s this? Make it quick.', 'I showed the house and left at six-thirty, end of story.', 'Lots of people drive that road. Doesn\'t mean anything.', 'Old houses sit. That\'s the market, okay?', 'She had a crew booked for the cellar on the second.', 'Fisk? Total fraud. Ghosts don\'t pay closing costs.'],
};

export const NAMES = ['Maya', 'Noah', 'Iris', 'Theo', 'Jade', 'Omar'];
export const pick = (arr, i) => arr[i % arr.length];
