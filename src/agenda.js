// Secret agendas (pilot): every player gets three private goals and a personal secret on top of solving the murder.
//   case:     something specific to uncover (checked by the evidence system)
//   social:   something to do with the other players (sharing, group chats, calls, the vote)
//   personal: keep your secret: don't let anyone name you as the accomplice. Now and then a suspect leaks someone's
//             secret to a couple of other players (the `leak` beat), which makes that harder.
// The accomplice gets misdirection goals instead of case/social ones, and a secret too, so leaks don't give them away.
// A goal or secret about a particular suspect (`who`) stays sealed until the player has that suspect in their phone,
// so the agenda never spoils who's in the story; it appears in the Notebook (with a heads-up) the moment they do.
// Everything is checked from game state with plain rules: no AI calls, no extra cost. Goals tied to the vote are
// settled at the reveal; at the end the recap shows everyone's agenda.
import { players, playerByToken, updatePlayer, messagesFor, votes, groupsFor, getDb } from './store.js';
import { deliver } from './live.js';
import { unlock, isUnlocked } from './progress.js';
import { remember } from './memory.js';
import { ledger } from './ai/ledger.js';

const SUSPECT_KEYS = ['ruth', 'marcus', 'lily', 'teddy'];
const KILLER = 'Ruth Calloway';
const mine = (p) => messagesFor(p.token).filter((m) => m.from === 'player');

// ---------- personal secrets: `you` is what the owner reads, `they` is how gossip tells it ----------
export const SECRETS = [
  { id: 'casserole', you: 'You were at the manor Thursday afternoon, dropping off a casserole for Dana. You never told anyone.',
    they: 'was at the manor thursday afternoon. like, THE day' },
  { id: 'will', you: 'Dana put you in her will: her whole vintage record collection. You found out last week.',
    they: 'is in dana’s WILL. she left them her record collection' },
  { id: 'ex', who: 'teddy', you: 'You dated Teddy Fisk in high school, and you still watch every one of his streams.',
    they: 'used to date me in high school 😳 and still watches every stream' },
  { id: 'debt', who: 'marcus', you: 'You owe Marcus Vane $2,000 from a bet you lost, and he’s been texting you about it.',
    they: 'owes marcus vane two grand. from a BET' },
  { id: 'brick', you: 'You stole a brick from the manor’s cellar wall last Halloween as a souvenir. It’s in your car.',
    they: 'took a brick out of the manor cellar last halloween. it’s in their car rn' },
  { id: 'review', you: 'You left Dana’s renovation crew a one-star review under a fake name. She found out it was you.',
    they: 'left dana a fake one-star review and she FOUND OUT' },
  { id: 'prayer', who: 'ruth', you: 'You’ve been going to Ruth’s prayer group. Twice. You liked it.',
    they: 'has been going to ruth’s prayer group 🙏 like on purpose' },
  { id: 'date', you: 'You were outside Rosie’s Diner at 9:30 Thursday, on a date you’re keeping secret.',
    they: 'was outside rosie’s diner thursday at 9:30 on a secret date' },
];

// ---------- goals ----------
const found = (id) => (p) => (p.found || []).includes(id);
const distinctThreads = (msgs) => new Set(msgs.map((m) => m.thread)).size;

export const GOALS = {
  // case: one specific thing to uncover
  case_bingo: { slot: 'case', who: 'teddy', text: 'Find out what time bingo really ends at St. Agnes.', check: found('bingo') },
  case_diner: { slot: 'case', who: 'marcus', text: 'Find out where Marcus really went Thursday night.', check: found('diner') },
  case_speakers: { slot: 'case', who: 'teddy', text: 'Find out how Teddy’s “ghost voices” really work.', check: found('speakers') },
  case_911: { slot: 'case', who: 'lily', text: 'Find out who made the anonymous 911 call.', check: found('call911') },
  case_mud: { slot: 'case', who: 'lily', text: 'Find out what Lily saw the night her father vanished.', check: found('mud') },
  case_lullaby: { slot: 'case', who: 'lily', text: 'Find out whose lullaby keeps humming in that house.', check: found('lullaby') },
  // social: the other players
  soc_share: { slot: 'social', text: 'Share clues or evidence (↗ SHARE) in 3 different chats.',
    check: (p) => distinctThreads(mine(p).filter((m) => m.forwarded)) >= 3 },
  soc_receive: { slot: 'social', text: 'Get 2 different players to share something with you.',
    check: (p) => new Set(messagesFor(p.token).filter((m) => m.from === 'peer' && m.forwarded).map((m) => m.sender)).size >= 2 },
  soc_group: { slot: 'social', text: 'Start a group chat with at least one other player and one suspect in it.',
    check: (p) => groupsFor(p.pid).some((g) => g.createdBy === p.pid && g.ai.length && g.players.length > 1) },
  soc_calls: { slot: 'social', text: 'Talk on the phone with 3 different suspects.',
    check: (p) => new Set(p.called || []).size >= 3 },
  soc_textall: { slot: 'social', text: 'Text all four suspects.',
    check: (p) => SUSPECT_KEYS.every((k) => mine(p).some((m) => m.thread === k)) },
  soc_bloc: { slot: 'social', atVote: true, text: 'Get at least 2 other players to vote for the same killer as you.',
    check: (p) => { const v = votes()[p.token]?.killer; return Boolean(v) && players().filter((x) => x.token !== p.token && votes()[x.token]?.killer === v).length >= 2; } },
  // personal: keep your secret
  personal: { slot: 'personal', atVote: true, text: 'Keep your secret: don’t let anyone name you as the accomplice.',
    check: (p) => !Object.values(votes()).some((v) => v.accomplice === p.name) },
  // accomplice
  acc_misdirect: { slot: 'case', atVote: true, text: 'Get other players to vote for someone other than Ruth (2 of them, or 1 in a small group).',
    check: (p) => players().filter((x) => x.token !== p.token && votes()[x.token] && votes()[x.token].killer !== KILLER).length >= (players().length >= 5 ? 2 : 1) },
  acc_plant: { slot: 'social', who: 'lily', text: 'Tell the others about Lily’s car at the manor (the planted evidence), in a chat with other players.',
    check: (p) => mine(p).some((m) => !SUSPECT_KEYS.includes(m.thread) && m.thread !== 'line' && /lily/i.test(m.text) && /\bcar\b/i.test(m.text)) },
};

const shuffle = (a) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };

// Deal everyone's agenda (run by the setup beat, after roles are assigned).
export function dealAgendas({ onlyMissing = false } = {}) {
  const cases = shuffle(Object.keys(GOALS).filter((k) => k.startsWith('case_')));
  const socials = shuffle(Object.keys(GOALS).filter((k) => k.startsWith('soc_')));
  const secrets = shuffle(SECRETS.map((s) => s.id));
  players().forEach((p, i) => {
    if (onlyMissing && p.agenda) return;
    const goals = p.role === 'accomplice' ? ['acc_misdirect', 'acc_plant', 'personal'] : [cases[i % cases.length], socials[i % socials.length], 'personal'];
    updatePlayer(p.token, { agenda: { secret: secrets[i % secrets.length], goals }, agendaDone: [], agendaSeen: [], agendaDelivered: false, leaked: false });
  });
}

const secretOf = (p) => SECRETS.find((s) => s.id === p.agenda?.secret);

// What the phone shows: the goals and how each stands. Before the reveal, vote goals read "decided at the vote".
// Sealed until the player has met the suspect it's about (everything opens at the reveal; `all` for the host).
const sealed = (p, who, all) => Boolean(who) && !all && !getDb().revealed && !isUnlocked(p, who);
export function agendaView(p, { all = false } = {}) {
  if (!p.agenda) return null;
  const revealed = getDb().revealed;
  const secretLocked = sealed(p, secretOf(p)?.who, all);
  return {
    secret: secretLocked ? null : secretOf(p)?.you || null,
    secretLocked,
    leaked: Boolean(p.leaked),
    goals: p.agenda.goals.map((id) => {
      const g = GOALS[id];
      if (sealed(p, g.who, all)) return { id, slot: g.slot, text: null, status: 'locked' };
      const status = g.atVote ? (revealed ? (g.check(p) ? 'done' : 'failed') : 'vote')
        : (p.agendaDone || []).includes(id) || g.check(p) ? 'done' : revealed ? 'failed' : 'open';
      return { id, slot: g.slot, text: g.text, status };
    }),
  };
}
export const agendaScore = (p) => agendaView(p)?.goals.filter((g) => g.status === 'done').length || 0;

// Notice goals completed since last time and tell the player. Runs every few seconds from the scheduler.
export async function checkAgendas() {
  for (const p of players()) await checkAgenda(p);
}
export async function checkAgenda(p) {
  if (!p?.agenda || !playerByToken(p.token)?.agendaDelivered) return; // nothing until the agenda packet has arrived
  // Newly unsealed (they just met the suspect it's about): a heads-up on The Line.
  const v = agendaView(playerByToken(p.token));
  const seen = playerByToken(p.token).agendaSeen || [];
  const unsealed = [...(v.secret && !seen.includes('secret') ? ['secret'] : []), ...v.goals.filter((g) => g.text && !seen.includes(g.id)).map((g) => g.id)];
  if (unsealed.length) {
    updatePlayer(p.token, { agendaSeen: [...seen, ...unsealed] });
    for (const id of unsealed) {
      const text = id === 'secret' ? `Your secret: ${v.secret}` : v.goals.find((g) => g.id === id).text;
      await deliver({ token: p.token, thread: 'line', from: 'system', kind: 'agenda', text: `📓 NEW IN YOUR NOTEBOOK: ${text}` });
    }
  }
  for (const id of p.agenda.goals) {
    const g = GOALS[id];
    const fresh = playerByToken(p.token);
    if (sealed(fresh, g.who, false) || g.atVote || (fresh.agendaDone || []).includes(id) || !g.check(fresh)) continue;
    updatePlayer(p.token, { agendaDone: [...(fresh.agendaDone || []), id] });
    ledger.event('agenda_goal_done', { session: p.pid, goal: id });
    await deliver({ token: p.token, thread: 'line', from: 'system', kind: 'agenda', text: `✓ AGENDA COMPLETE: ${g.text}` });
  }
}

// The welcome packet: your secret and your three goals, for your eyes only.
export async function deliverAgendas() {
  for (const p of players()) {
    const v = agendaView(p);
    if (!v) continue;
    const LOCKED = '🔒 Sealed until you meet the right person.';
    await deliver({ token: p.token, thread: 'line', from: 'character', kind: 'secret',
      text: `YOUR SECRET AGENDA\n\nYour secret: ${v.secret || LOCKED}\n\n${v.goals.map((g, i) => `${i + 1}. ${g.text || LOCKED}`).join('\n')}\n\nSolve the murder first. These are extra. They're in your Notebook.` });
    updatePlayer(p.token, { agendaDelivered: true, agendaSeen: [...(v.secret ? ['secret'] : []), ...v.goals.filter((g) => g.text).map((g) => g.id)] });
  }
}

// Word gets around: Teddy leaks one player's secret to two others, and Ruth lets the player know people are talking.
// One leak per beat; at most 1 a night in a small group, 2 with 5 or more players.
export async function leakSecret() {
  const ps = players().filter((p) => p.agenda);
  const max = ps.length >= 5 ? 2 : 1;
  if (ps.filter((p) => p.leaked).length >= max) return { skipped: 'enough secrets out tonight' };
  const candidates = ps.filter((p) => !p.leaked);
  const subject = candidates[Math.floor(Math.random() * candidates.length)];
  if (!subject || ps.length < 3) return { skipped: 'no one to leak' };
  const s = secretOf(subject);
  const listeners = shuffle(ps.filter((p) => p.token !== subject.token)).slice(0, 2);
  for (const l of listeners) {
    await unlock(l, 'teddy');
    const text = `ok don’t freak out but i heard ${subject.name} ${s.they}?? 👀 make of that what u will`;
    await deliver({ token: l.token, thread: 'teddy', from: 'character', text });
    remember({ player: l.name, pid: l.pid, npc: 'teddy', character: 'Teddy Fisk', speaker: 'character', text: `(text, gossip) ${text}`, channel: 'text' });
  }
  await unlock(subject, 'ruth');
  await deliver({ token: subject.token, thread: 'ruth', from: 'character', text: 'Sweetheart, people are talking about you tonight. I’d be careful who you trust.' });
  updatePlayer(subject.token, { leaked: true });
  ledger.event('secret_leaked', { session: subject.pid, secret: s.id, listeners: listeners.length });
  return { leaked: subject.name, to: listeners.map((l) => l.name) };
}

// For the recap and host page: everyone's agenda, once it's all over (or for the host, any time).
export function agendaSummary(p) {
  const v = agendaView(p, { all: true });
  return v && { secret: v.secret, leaked: v.leaked, goals: v.goals.map((g) => ({ text: g.text, done: g.status === 'done' })), done: v.goals.filter((g) => g.status === 'done').length };
}
