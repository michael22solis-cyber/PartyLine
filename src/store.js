// Game state for one playtest group: players, burner-phone messages, votes, push subscriptions, schedule.
// Demo version: a JSON file. In production, move each collection to a Supabase table.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { dataFile } from './env.js';
const FILE = dataFile('game.json');
const EMPTY = { players: [], messages: [], votes: {}, pushSubs: {}, schedule: [], revealed: false, groups: [], game: null };

let db = load();
db.players.forEach((p) => { p.pid ||= crypto.randomBytes(4).toString('hex'); });

function load() {
  try {
    return { ...EMPTY, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
  } catch {
    return structuredClone(EMPTY);
  }
}

function save() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(db, null, 2));
}

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
export function addMessage({ token, thread, from, text, kind = 'text', audio = null, sender = null, forwarded = false }) {
  const msg = {
    id: crypto.randomUUID(),
    token,
    thread,
    from,
    text,
    kind,
    ...(audio ? { audio } : {}),
    ...(sender ? { sender } : {}),
    ...(forwarded ? { forwarded: true } : {}),
    at: new Date().toISOString(),
  };
  db.messages.push(msg);
  save();
  return msg;
}

export const messagesFor = (token) => db.messages.filter((m) => m.token === token);
export const countPlayerMessages = (token) =>
  db.messages.filter((m) => m.token === token && m.from === 'player').length;
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

export function clearPendingSchedule() { db.schedule = db.schedule.filter((x) => x.done); save(); }

// ---- auto mode: one game per server with a self-serve invite link ----
export function setGame(game) { db.game = game; save(); return game; }
export const getGame = () => db.game;

export function setRevealed() { db.revealed = true; save(); }

export function resetGame() {
  db = structuredClone(EMPTY);
  save();
}
