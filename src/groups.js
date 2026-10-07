// Group chats with any mix of players and AI suspects ("Ruth, Lily & Maya").
// AI members answer when they're named, or take turns when no one is; sometimes a second suspect cuts in.
import { players, playerByPid, addGroup, groupById, groupsFor, threadHistory } from './store.js';
import { deliver, emit } from './live.js';
import { CHARACTERS, TEXTABLE } from './characters/index.js';
import { remember } from './memory.js';
import { isUnlocked, onCharacterSaid } from './progress.js';
import { MENTIONS } from './secrets.js';
import { chatComplete } from './ai/openai.js';
import { buildGroupPrompt } from './context.js';
import { approveFromPlayerText, shareApprovals } from './disclosure.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, process.env.TEXT_FAST === '1' ? 0 : ms * Number(process.env.TEXT_DELAY_SCALE ?? 1)));
const CUT_IN_CHANCE = Number(process.env.GROUP_CUT_IN_CHANCE ?? 0.4);
const busy = new Set(); // groups where an AI reply is being written
const turn = new Map(); // group id -> index of the AI whose turn it is
const MAX_MEMBERS = 7;

export const groupView = (g) => ({
  id: g.id,
  thread: `g:${g.id}`,
  name: g.name,
  players: g.players.map((pid) => playerByPid(pid)?.name).filter(Boolean),
  ai: g.ai.map((k) => ({ key: k, name: CHARACTERS[k].name })),
});
export const groupsForPlayer = (p) => groupsFor(p.pid).map(groupView);
const members = (g) => g.players.map(playerByPid).filter(Boolean);

export async function createGroup(creator, { name, players: pids = [], ai = [] }) {
  const others = [...new Set(pids)].filter((pid) => pid !== creator.pid);
  if (others.some((pid) => !playerByPid(pid))) throw Object.assign(new Error('Unknown player.'), { status: 400 });
  const bots = [...new Set(ai)];
  if (bots.some((k) => !TEXTABLE.some((t) => t.key === k) || !isUnlocked(creator, k))) {
    throw Object.assign(new Error('You can only add suspects whose number you have.'), { status: 403 });
  }
  if (others.length + bots.length < 2) throw Object.assign(new Error('Pick at least two others.'), { status: 400 });
  if (others.length + bots.length + 1 > MAX_MEMBERS) throw Object.assign(new Error(`Groups max out at ${MAX_MEMBERS}.`), { status: 400 });
  const label = String(name || '').trim().slice(0, 40)
    || [...bots.map((k) => CHARACTERS[k].name.split(' ')[0]), ...others.map((pid) => playerByPid(pid).name)].join(', ');
  const g = addGroup({ name: label, players: [creator.pid, ...others], ai: bots, createdBy: creator.pid });
  const view = groupView(g);
  const who = [...view.ai.map((a) => a.name), ...view.players.filter((n) => n !== creator.name)].join(', ');
  for (const p of members(g)) {
    emit(p.token, 'group', view);
    await deliver({ token: p.token, thread: view.thread, from: 'system', kind: 'text',
      text: `${p.token === creator.token ? 'You' : creator.name} started a group with ${who}.` });
  }
  return view;
}

// A player posts in a group (called from crew.js).
export async function postToGroup(sender, groupId, { body, extra }) {
  const g = groupById(groupId);
  if (!g || !g.players.includes(sender.pid)) throw Object.assign(new Error('You’re not in that group.'), { status: 403 });
  const thread = `g:${g.id}`;
  let mine;
  for (const p of members(g)) {
    const m = await deliver({ token: p.token, thread, from: p.token === sender.token ? 'player' : 'peer', text: body, ...extra });
    if (p.token === sender.token) mine = m;
  }
  if (g.ai.length) {
    const room = groupView(g);
    remember({ player: sender.name, pid: sender.pid, character: `the group chat "${room.name}"`, speaker: 'player', text: `(group text) ${body}`, channel: 'group' });
    if (!busy.has(g.id)) {
      busy.add(g.id);
      aiTurn(g, sender, body).catch((e) => console.error('[group]', e.message)).finally(() => busy.delete(g.id));
    }
  }
  return mine;
}

function pickResponder(g, text) {
  const named = g.ai.filter((k) => MENTIONS[k]?.test(text));
  if (named.length) return named[0];
  const i = (turn.get(g.id) || 0) % g.ai.length;
  turn.set(g.id, i + 1);
  return g.ai[i];
}

async function aiTurn(g, sender, text) {
  const first = pickResponder(g, text);
  await speak(g, first, sender, text);
  const rest = g.ai.filter((k) => k !== first);
  if (rest.length && Math.random() < CUT_IN_CHANCE) {
    await sleep(1500 + Math.random() * 2500);
    await speak(g, rest[Math.floor(Math.random() * rest.length)], sender, text, true);
  }
}

async function speak(g, key, sender, said, cuttingIn = false) {
  const c = CHARACTERS[key];
  const room = groupView(g);
  const thread = room.thread;
  const people = members(g);
  await sleep(1200 + Math.random() * 1500);
  people.forEach((p) => emit(p.token, 'typing', { thread, on: true, who: c.name }));
  const transcript = threadHistory(sender.token, thread, 20)
    .filter((m) => m.from !== 'system')
    .map((m) => `${m.from === 'player' ? sender.name : m.sender || 'someone'}: ${m.text}`);
  const others = room.ai.filter((a) => a.key !== key).map((a) => a.name);
  const setting = `You are in a GROUP TEXT called "${room.name}" with: ${[...room.players, ...others].join(', ')}. ` +
    `Players are ${room.players.join(', ')}.${others.length ? ` The other suspects in this chat (${others.join(', ')}) can read everything you write, so be careful what you admit in front of them.` : ''} ` +
    'Locked secrets stay locked unless the exact condition is met. Reply as one text message from you only; never write lines for anyone else.';
  const ask = (chat) => (cuttingIn
    ? `Here is the group chat so far:\n${chat}\n\nYou can't help cutting in on what was just said. Reply as ${c.name}.`
    : `Here is the group chat so far:\n${chat}\n\nReply as ${c.name} to the latest message.`);
  // Disclosures in a group are approved for the conversation: everyone in it hears the answer.
  const approved = approveFromPlayerText(sender, key, said, 'group').map((t) => t.id);
  let reply;
  try {
    const messages = buildGroupPrompt({ npc: key, player: sender, setting, transcript, ask, approvedNow: approved.map((id) => ({ id })) });
    ({ text: reply } = await chatComplete(messages, { meta: { session: sender.pid, npc: key, capability: 'group', purpose: cuttingIn ? 'cut_in' : 'reply' } }));
    reply = reply.replace(new RegExp(`^(${c.name}|${c.name.split(' ')[0]}):\\s*`, 'i'), '');
  } catch (err) {
    people.forEach((p) => emit(p.token, 'typing', { thread, on: false }));
    throw err;
  }
  await sleep(Math.min(3500, 500 + reply.length * 22));
  for (const p of people) {
    emit(p.token, 'typing', { thread, on: false });
    await deliver({ token: p.token, thread, from: 'character', text: reply, sender: c.name });
  }
  remember({ player: sender.name, pid: sender.pid, npc: key, character: c.name, speaker: 'character', text: `(in group chat "${room.name}") ${reply}`, channel: 'group' });
  const permittedHere = [...approved, ...((sender.permitted || {})[key] || [])];
  shareApprovals(people, key, approved);
  for (const p of people) await onCharacterSaid(p, key, reply, { approved: permittedHere });
}
