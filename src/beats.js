// The scripted moments of The Blackwood Line: one night, about 75 minutes (timetables in modes.js).
// Fire them by hand during a playtest (`npm run admin -- beat <name>`) or schedule them.
import { players, updatePlayer, votes, setRevealed, markBeat } from './store.js';
import { deliver, emit } from './live.js';
import { callPlayer, ringInApp, unlock, unlockMentions, unlockAll, audioIf } from './progress.js';
import { getDb } from './store.js';
import { summary, remember } from './memory.js';
import { PHOTOS, statusOf, phase } from './cast.js';
import { TEXTABLE } from './characters/index.js';
import { ledger } from './ai/ledger.js';
import { holdOff } from './voice/allowance.js';
import { nudgeStuck } from './hints.js';
import { dealAgendas, deliverAgendas, leakSecret } from './agenda.js';

// BEAT_TIME_SCALE shrinks the waits inside beats (the full-game rehearsal test runs a night in seconds).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms * Number(process.env.BEAT_TIME_SCALE ?? 1)));
const everyone = () => players();

const STARTING_CLUES = [
  'POLICE NOTE: Dana died between 9:30 and 10 pm. An anonymous 911 call came in at 11:12 pm, from a woman.',
  'RENOVATION CONTRACT: Dana booked a crew to dig up the cellar floor on November 2.',
  'RUTH’S STATEMENT: "I was at St. Agnes bingo until 10. Ask anyone."',
  'DINER RECEIPT: Rosie’s Diner, 9:31 pm, Marcus Vane’s card. Server: "L."',
  'TEDDY’S LIVESTREAM: Teddy Fisk streamed his ghost show live from his apartment, 9–10 pm.',
  'NEIGHBOR’S TEXT: "Saw the realtor’s car at the manor after dark Thursday."',
];

export const SUSPECTS = ['Ruth Calloway', 'Marcus Vane', 'Lily Blackwood', 'Teddy Fisk'];

async function toAll(thread, text, kind = 'text', audio = null) {
  await Promise.all(everyone().map((p) => deliver({ token: p.token, thread, from: 'character', text, kind, audio })));
}

// Ring every player (in the app, or a real phone with CALL_MODE=phone), a few seconds apart.
async function callEach(character, gapMs = 0) {
  await Promise.all(everyone().map(async (p, i) => {
    await sleep(i * gapMs);
    try { await callPlayer(p, character); } catch (err) { console.error(`call to ${p.name} failed:`, err.message); }
  }));
}

// A player's starting clue: it also puts Ruth, and anyone the clue names, in their phone.
async function giveClue(p) {
  const clue = p.clue || STARTING_CLUES[0];
  await deliver({ token: p.token, thread: 'line', from: 'character', kind: 'clue', text: clue });
  await unlock(p, 'ruth', 'She was the family’s night nurse. She wants to help.');
  await unlockMentions(p, clue);
}

export const BEATS = {
  // Assign the accomplice and starting clues. Run once, after everyone has joined.
  async setup() {
    const ps = everyone();
    // A real game needs 3+ (auto mode enforces it); fewer is fine for the host testing on their own.
    if (!ps.length) throw Object.assign(new Error('Add at least one player first.'), { status: 400 });
    const accomplice = ps[Math.floor(Math.random() * ps.length)];
    ps.forEach((p, i) => {
      updatePlayer(p.token, {
        role: p.token === accomplice.token && ps.length >= 4 ? 'accomplice' : 'detective',
        clue: STARTING_CLUES[i % STARTING_CLUES.length],
      });
    });
    // With fewer than 6 players, double up so every clue reaches someone.
    if (ps.length < STARTING_CLUES.length) {
      for (let i = ps.length; i < STARTING_CLUES.length; i++) {
        const p = ps[i % ps.length];
        updatePlayer(p.token, { clue: `${p.clue}\n\n${STARTING_CLUES[i]}` });
      }
    }
    dealAgendas(); // everyone's secret and three goals (see agenda.js)
    return { players: ps.length, accomplice: ps.length >= 4 ? accomplice.name : '(none, fewer than 4 players)', ...(ps.length < 3 ? { note: 'Fewer than 3 players: fine for testing, too few for a real game.' } : {}) };
  },

  // Everyone gets their secret agenda (sealed): a personal secret and three goals on top of solving the murder.
  async agendas() {
    dealAgendas({ onlyMissing: true }); // anyone setup didn't deal in (joined late, or setup was skipped)
    await deliverAgendas();
  },

  async welcome() {
    await toAll('line', 'Tonight, the Blackwood line opens. Keep this phone close. Every character you meet is an AI. Tap ⋮ to turn off calls anytime.');
  },

  async accomplice() {
    const p = everyone().find((x) => x.role === 'accomplice');
    if (!p) return { skipped: 'no accomplice' };
    await deliver({
      token: p.token, thread: 'line', from: 'character', kind: 'secret',
      text: "You've been chosen. You work for whoever is haunting Blackwood: Ruth Calloway. Keep your friends away from her. If they name anyone else, you win. Tell no one.",
    });
  },

  async intro() {
    await toAll('line', 'Blackwood Manor, 1996. The caretaker vanished on Halloween night. Every year since, his disconnected phone rings at midnight. Last night, the woman who bought the house died at the bottom of the cellar stairs. Police say it was an accident. Then the house called your number.');
  },

  // The Caretaker rings each player (staggered), then their starting clue arrives.
  async calls() {
    await Promise.all(everyone().map(async (p, i) => {
      await sleep(i * 15_000);
      let how = 'off';
      try { how = await callPlayer(p, 'caretaker'); } catch (err) { console.error(`call to ${p.name} failed:`, err.message); }
      if (how !== 'off') await sleep(75_000);
      await giveClue(p);
    }));
  },

  // Skip the calls (e.g. testing without phones) and just send the clues.
  async clues() {
    for (const p of everyone()) await giveClue(p);
  },

  // Backup for anyone who hasn't found every suspect yet.
  async cast() {
    await toAll('line', 'Dana’s phone was found at the bottom of the stairs. Every number in her recent calls is in yours now. Text them. Call them if you dare.');
    await unlockAll('From Dana’s recent calls.');
  },

  async memo() {
    await toAll('line',
      'Recorded 24 hours ago, at this exact minute.\n\n"...so the crew comes Monday, and they start on the cellar floor first, the whole slab..." [humming, faint, a lullaby] [footsteps on the stairs] "Who’s there? ...Ma’am?" [a crash] [silence]',
      'memo', audioIf('memo.mp3'));
  },

  // Ruth calls the player who has talked most about the cellar. If they don't pick up, she leaves a voicemail.
  async ruthWarning() {
    const lines = summary(400).split('\n');
    const score = (name) => lines.filter((l) => l.startsWith(`- ${name} `) && /cellar|basement|floor|dig/i.test(l)).length;
    const target = [...everyone()].sort((a, b) => score(b.name) - score(a.name))[0];
    if (!target) return;
    await unlock(target, 'ruth');
    await ringInApp(target, 'ruth', {
      opening: `You are calling ${target.name} late at night, uninvited. Speak first, sweetly but with an edge: say some doors in that house are better left closed, and that they should get some rest. Keep it short unless they push you.`,
      voicemail: { text: 'Voicemail from Ruth Calloway: "Sweetheart, it’s Ruth. Some doors in that house are better left closed. Get some rest now."', audio: audioIf('ruth-voicemail.mp3') },
    });
    return { target: target.name };
  },

  // Word gets around: a suspect leaks one player's secret to two others.
  async leak() {
    return leakSecret();
  },

  async twist() {
    await toAll('line',
      '911 CALL — Thursday, 11:12 pm. A woman, crying: "There’s someone at the bottom of the stairs at Blackwood... I think she’s dead." Then she hangs up.',
      'evidence', audioIf('call911.mp3'));
    // Halfway through: anyone who hasn't found anything yet gets a nudge.
    return { nudged: await nudgeStuck() };
  },

  async planted() {
    const p = everyone().find((x) => x.role === 'accomplice');
    if (!p) return { skipped: 'no accomplice' };
    await deliver({
      token: p.token, thread: 'line', from: 'character', kind: 'secret',
      text: 'PLANTED EVIDENCE: "Lily Blackwood’s car, parked at the manor, Thursday 11:02 pm." It’s true. It’s just not the whole truth. Tell the others about it (the group chat or a DM), and push them toward Lily or Teddy.',
    });
  },

  // Lily calls everyone herself: she wants to talk about Thursday night, but only on the phone and only now. Answer and
  // ask her about it, and she tells you; miss it and she shuts down ("nvm") and won't pick up for 10 minutes.
  async lilyCalls() {
    await Promise.all(everyone().map(async (p, i) => {
      await sleep(i * 20_000);
      await unlock(p, 'lily');
      await ringInApp(p, 'lily', {
        opening: `You are calling ${p.name} yourself, late at night, nervous. Speak first, quietly: you can't keep something in anymore and you want to tell someone, but only on the phone, and only now, because your shift starts in a few minutes. Do not say what it is yet. Wait for them to ask about Thursday night or the 911 call.`,
        onMissed: async () => {
          await deliver({ token: p.token, thread: 'lily', from: 'character', text: 'nvm. forget i called.' });
          holdOff(p.token, 'lily', 10 * 60_000);
        },
      });
    }));
  },

  async caretakerHint() {
    await callEach('caretaker', 20_000);
  },

  async votesOpen() {
    await toAll('line', 'Votes are open. Open the VOTE tab and name the killer and the accomplice before the line goes dead.');
  },

  async lineRinging() {
    await toAll('line', 'The line is ringing.');
  },

  // The final call: everyone gets the Caretaker's reveal, then the results.
  async reveal() {
    setRevealed();
    await callEach('caretaker_reveal', 0); // every phone rings at once
    await sleep(75_000);
    const tally = tallyVotes();
    const accompliceName = everyone().find((p) => p.role === 'accomplice')?.name;
    const outcome = tally.killer !== 'Ruth Calloway'
      ? `The accomplice wins. Your group named ${tally.killer || 'no one'}.`
      : !accompliceName || tally.accomplice === accompliceName
        ? 'Detectives win. Ruth Calloway is caught, and so is her accomplice.'
        : `Split win: you caught Ruth, but the accomplice walks. It was ${accompliceName}.`;
    ledger.event('game_completed', { players: everyone().length, votes: tally.votes });
    await toAll('line',
      `CASE CLOSED.\n\nThe killer was Ruth Calloway, the night nurse. In 1996 Elias caught her stealing, died in the struggle, and she buried him under the cellar. Dana was about to dig it up.\n\n${outcome}${accompliceName ? `\n\nThe accomplice was ${accompliceName}.` : ''}\n\nThanks for playing. Happy Halloween.`,
      'reveal');
    return { tally, outcome };
  },
};

export function tallyVotes() {
  const v = Object.values(votes());
  const top = (field) => {
    const counts = {};
    v.forEach((x) => { if (x[field]) counts[x[field]] = (counts[x[field]] || 0) + 1; });
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    return sorted[0]?.[0] || null;
  };
  return { killer: top('killer'), accomplice: top('accomplice'), votes: v.length, players: getDb().players.length };
}

// A character texts everyone a photo (see cast.js). They're added to anyone's phone who didn't have them yet, and
// they remember sending it.
async function sendPhoto({ npc, image, text, remember: what }) {
  const name = TEXTABLE.find((t) => t.key === npc)?.name || npc;
  for (const p of everyone()) {
    await unlock(p, npc);
    await deliver({ token: p.token, thread: npc, from: 'character', kind: 'photo', image, text, npc });
    remember({ player: p.name, pid: p.pid, npc, character: name, speaker: 'character', text: `(text) [you ${what}] ${text}`, channel: 'text' });
  }
}

export async function runBeat(name) {
  const fn = BEATS[name];
  if (!fn) throw Object.assign(new Error(`Unknown beat "${name}". Options: ${Object.keys(BEATS).join(', ')}`), { status: 400 });
  console.log(`[beat] ${name}`);
  const result = (await fn()) || { ok: true };
  markBeat(name);
  // Characters' status lines follow the story.
  const statuses = { ...Object.fromEntries(TEXTABLE.map((t) => [t.key, statusOf(t.key)])), phase: phase() };
  everyone().forEach((p) => emit(p.token, 'status', statuses));
  if (PHOTOS[name]) await sendPhoto(PHOTOS[name]);
  return result;
}
