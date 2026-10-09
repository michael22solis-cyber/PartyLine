// Game state for one playtest group: players, burner-phone messages, votes, push subscriptions, schedule.
// Demo version: a JSON file. In production, move each collection to a Supabase table.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { dataFile } from './paths.js';

const FILE = dataFile('game.json');
const EMPTY = { players: [], messages: [], votes: {}, pushSubs: {}, schedule: [], revealed: false, groups: [], game: null, beats: [], pausedAt: null };

let db = load();
db.players.forEach((p) => { p.pid ||= crypto.randomBytes(4).toString('hex'); p.permitted ||= {}; });
let saveTimer = null;

function load() {
  try {
    return { ...EMPTY, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
  } catch {
    return structuredClone(EMPTY);
  }
}

// Writes are batched (at most one every 250 ms) and atomic (temp file + rename), so a busy game no longer
// rewrites the whole file synchronously on every message.
function writeNow() {
  saveTimer = null;
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    const tmp = `${FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, FILE);
  } catch (err) {
    console.error('[store] save failed:', err.message);
  }
}
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(writeNow, 250);
  saveTimer.unref?.();
}
export function flushStore() { if (saveTimer) { clearTimeout(saveTimer); writeNow(); } }
process.on('exit', flushStore);

export const getDb = () => db;

// ---- players ----
export function addPlayer({ name, phone, organizer = false }) {
  const player = {
    token: crypto.randomBytes(9).toString('base64url'),
    pid: crypto.randomBytes(4).toString('hex'), // public id other players see (the token stays secret)
    name: String(name).trim().slice(0, 30),
    phone: phone || null,
    role: 'detective',
    clue: null,
    unlocked: [],   // suspects whose numbers this player has (see progress.js)
    found: [],      // secrets this player has uncovered
    permitted: {},  // npc -> topic ids the engine has approved for disclosure to this player (see disclosure.js)
    callsOff: false,
    organizer,
    joinedAt: new Date().toISOString(),
  };
  db.players.push(player);
  save();
  return player;
}

export const players = () => db.players;
export const playerByToken = (token) => db.players.find((p) => p.token === token) || null;
export const playerByPid = (pid) => db.players.find((p) => p.pid === pid) || null;
export const messageById = (token, id) => db.messages.find((m) => m.token === token && m.id === id) || null;
export const playerByPhone = (phone) => db.players.find((p) => p.phone && p.phone === phone) || null;

export function updatePlayer(token, patch) {
  const p = playerByToken(token);
  if (!p) return null;
  Object.assign(p, patch);
  save();
  return p;
}

// ---- messages ----
// thread: a character key ('ruth', 'marcus'...), 'line' (narrator) or 'unknown' (the Caretaker's call log)
// from: 'player' | 'character' | 'system'
// kind: 'text' | 'clue' | 'memo' | 'call' | 'calllog' | 'missed' | 'voicemail' | 'secret' | 'evidence' | 'reveal'
export function addMessage({ token, thread, from, text, kind = 'text', audio = null, sender = null, forwarded = false, clientId = null, npc = null, image = null }) {
  if (clientId) {
    const dup = db.messages.find((m) => m.token === token && m.clientId === clientId);
    if (dup) return { ...dup, duplicate: true };
  }
  const msg = {
    id: crypto.randomUUID(),
    token,
    thread,
    from,
    text,
    kind,
    ...(audio ? { audio } : {}),
    ...(npc ? { npc } : {}),     // which character it is about (call log, voicemail, photo): the phone shows their face
    ...(image ? { image } : {}),
    ...(sender ? { sender } : {}),
    ...(forwarded ? { forwarded: true } : {}),
    ...(clientId ? { clientId: String(clientId).slice(0, 64) } : {}),
    at: new Date().toISOString(),
  };
  db.messages.push(msg);
  if (from === 'player') playerCounts.set(token, (playerCounts.get(token) || 0) + 1);
  save();
  return msg;
}

export const messagesFor = (token) => db.messages.filter((m) => m.token === token);
// A character has read the player's texts in a thread: stamp them (shows "Read" on the phone). Returns the time, or
// null if there was nothing new to mark.
export function markRead(token, thread) {
  const at = new Date().toISOString();
  let changed = false;
  for (const m of db.messages) {
    if (m.token === token && m.thread === thread && m.from === 'player' && !m.readAt) { m.readAt = at; changed = true; }
  }
  if (changed) save();
  return changed ? at : null;
}
const playerCounts = new Map();
for (const m of db.messages) if (m.from === 'player') playerCounts.set(m.token, (playerCounts.get(m.token) || 0) + 1);
export const countPlayerMessages = (token) => playerCounts.get(token) || 0;
export const threadHistory = (token, thread, limit = 20) =>
  db.messages.filter((m) => m.token === token && m.thread === thread).slice(-limit);

// ---- votes ----
export function castVote(token, killer, accomplice) {
  db.votes[token] = { killer, accomplice, at: new Date().toISOString() };
  save();
}
export const votes = () => db.votes;

// ---- push subscriptions ----
export function savePushSub(token, sub) {
  const list = db.pushSubs[token] || [];
  if (!list.some((s) => s.endpoint === sub.endpoint)) list.push(sub);
  db.pushSubs[token] = list;
  save();
}
export const pushSubsFor = (token) => db.pushSubs[token] || [];
export function removePushSub(token, endpoint) {
  db.pushSubs[token] = (db.pushSubs[token] || []).filter((s) => s.endpoint !== endpoint);
  save();
}

// ---- schedule ----
export function addScheduled(beat, at) {
  const item = { id: crypto.randomUUID(), beat, at, done: false };
  db.schedule.push(item);
  save();
  return item;
}
export const scheduled = () => db.schedule;
export function markScheduledDone(id) {
  const s = db.schedule.find((x) => x.id === id);
  if (s) { s.done = true; save(); }
}

// ---- group chats (any mix of players and AI suspects) ----
export function addGroup({ name, players: pids, ai, createdBy }) {
  const g = { id: crypto.randomBytes(4).toString('hex'), name, players: pids, ai, createdBy, at: new Date().toISOString() };
  db.groups.push(g);
  save();
  return g;
}
export const groupById = (id) => db.groups.find((g) => g.id === id) || null;
export const groupsFor = (pid) => db.groups.filter((g) => g.players.includes(pid));

// Pause the night: the scheduler holds still; on resume, every beat still to come moves later by the time paused.
export const pausedAt = () => db.pausedAt || null;
export function pauseSchedule(now = Date.now()) { if (!db.pausedAt) { db.pausedAt = new Date(now).toISOString(); save(); } }
export function resumeSchedule(now = Date.now()) {
  if (!db.pausedAt) return 0;
  const ms = now - Date.parse(db.pausedAt);
  for (const s of db.schedule) if (!s.done) s.at = new Date(Date.parse(s.at) + ms).toISOString();
  db.pausedAt = null;
  save();
  return ms;
}

export function clearPendingSchedule() { db.schedule = db.schedule.filter((x) => x.done); save(); }

// ---- auto mode: one game per server with a self-serve invite link ----
export function setGame(game) { db.game = game; save(); return game; }
export const getGame = () => db.game;

// Story beats that have fired, in order (characters' status lines follow the story).
export function markBeat(name) { db.beats = [...(db.beats || []), name]; save(); }
export const firedBeats = () => db.beats || [];

export function setRevealed() { db.revealed = true; save(); }

export function resetGame() {
  db = structuredClone(EMPTY);
  playerCounts.clear();
  save();
}
