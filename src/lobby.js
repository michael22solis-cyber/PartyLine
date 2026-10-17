// Auto mode: create a game, friends join through one invite link, the organizer taps Start,
// and the story runs itself on the chosen length's timetable.
import crypto from 'node:crypto';
import { players, addPlayer, setGame, getGame, addScheduled, updatePlayer } from './store.js';
import { emit } from './live.js';
import { LENGTHS } from './modes.js';
import { runBeat } from './beats.js';

export const MAX_PLAYERS = 8;
const MIN_PLAYERS = 3;
const minPlayers = (g) => LENGTHS[g?.length]?.minPlayers ?? MIN_PLAYERS; // the test run can start with one phone

export function createGame({ length = 'quick', mode = 'auto' } = {}) {
  if (!LENGTHS[length]) throw Object.assign(new Error(`Length must be one of: ${Object.keys(LENGTHS).join(', ')}`), { status: 400 });
  return setGame({ mode, length, status: 'lobby', code: crypto.randomBytes(4).toString('hex'), createdAt: new Date().toISOString() });
}

export function lobbyView(p) {
  const g = getGame();
  if (!g) return null;
  return {
    mode: g.mode, length: g.length, lengthLabel: (LENGTHS[g.length] || LENGTHS.quick).label, status: g.status,
    joined: players().map((x) => x.name), organizer: Boolean(p?.organizer), minPlayers: minPlayers(g),
    invite: g.status === 'lobby' ? `/join/${g.code}` : null, startedAt: g.startedAt || null,
  };
}

const broadcast = () => players().forEach((p) => emit(p.token, 'lobby', lobbyView(p)));

export function join(code, name) {
  const g = getGame();
  if (!g || g.code !== code) throw Object.assign(new Error('This invite has expired.'), { status: 404 });
  if (g.status !== 'lobby') throw Object.assign(new Error('This game has already started.'), { status: 409 });
  const clean = String(name || '').trim().slice(0, 30);
  if (!clean) throw Object.assign(new Error('Enter your name.'), { status: 400 });
  if (players().some((x) => x.name.toLowerCase() === clean.toLowerCase())) throw Object.assign(new Error('Someone already took that name.'), { status: 409 });
  if (players().length >= MAX_PLAYERS) throw Object.assign(new Error('This game is full.'), { status: 409 });
  const p = addPlayer({ name: clean, organizer: players().length === 0 });
  broadcast();
  return p;
}

export async function startGame() {
  const g = getGame();
  if (!g) throw Object.assign(new Error('No game to start.'), { status: 400 });
  if (g.status !== 'lobby') throw Object.assign(new Error('Already started.'), { status: 409 });
  const min = minPlayers(g);
  if (players().length < min) throw Object.assign(new Error(`Need at least ${min} players.`), { status: 400 });
  const now = Date.now();
  for (const [beat, min] of (LENGTHS[g.length] || LENGTHS.quick).beats) { // an old two-night game plays as one night
    if (beat === 'setup') await runBeat('setup');
    else addScheduled(beat, new Date(now + min * 60_000).toISOString());
  }
  setGame({ ...g, status: 'running', startedAt: new Date(now).toISOString() });
  broadcast();
  return lobbyView(null);
}

export function makeOrganizer(token) { updatePlayer(token, { organizer: true }); }
