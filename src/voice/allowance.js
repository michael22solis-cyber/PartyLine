// Limits on calls a player starts themselves (story calls the house places are never blocked or counted):
// - minutes per game: CALL_MINUTES_PER_PLAYER (default 20, 0 = unlimited). Once used up, the line is dead; texting
//   still works. A call never runs past what is left: its hang-up and goodbye cue are pulled in to fit.
// - per-character cooldown: CALL_COOLDOWN_MINUTES (default 5, 0 = off). After a real conversation with someone, they
//   don't pick up again for a while.
// Enforced here on the server; seconds are measured here too, never taken from the phone.
import { playerByToken, updatePlayer } from '../store.js';

const env = process.env;
const MIN_USEFUL_SECONDS = 30; // less than this left counts as nothing left
const COOLDOWN_AFTER_SECONDS = 15; // a call this short (no answer, wrong tap) doesn't start a cooldown
const cooldowns = new Map(); // `${token}:${npc}` -> until (ms)

const budgetSeconds = () => Number(env.CALL_MINUTES_PER_PLAYER ?? 20) * 60;
const cooldownMs = () => Number(env.CALL_COOLDOWN_MINUTES ?? 5) * 60_000;

export function secondsLeft(player) {
  const budget = budgetSeconds();
  if (!(budget > 0)) return Infinity;
  return Math.max(0, budget - (player.callSeconds || 0));
}

// May this player call this character now? Returns { ok, timing } with the timing fitted to what is left, or
// { ok: false, status, error, reason }.
export function checkCall(player, npc, name, timing, now = Date.now()) {
  const until = cooldowns.get(`${player.token}:${npc}`) || 0;
  if (until > now) {
    return { ok: false, status: 409, reason: 'cooldown', retryAfter: Math.ceil((until - now) / 1000),
      error: `No answer. ${name} isn't picking up right now. Try again later, or send a text.` };
  }
  const left = secondsLeft(player);
  if (left < MIN_USEFUL_SECONDS) {
    return { ok: false, status: 429, reason: 'minutes', error: 'The line is dead for tonight. You can still text.' };
  }
  if (left >= timing.maxSeconds) return { ok: true, timing };
  const maxSeconds = Math.floor(left);
  return { ok: true, timing: { ...timing, maxSeconds, wrapUpAt: Math.max(5, Math.min(timing.wrapUpAt, maxSeconds - 15)) } };
}

// A call the player started has ended: count its time and start the character's cooldown.
export function chargeCall(token, npc, seconds, now = Date.now()) {
  const secs = Math.max(0, Math.round(seconds));
  const p = playerByToken(token);
  if (p) updatePlayer(token, { callSeconds: (p.callSeconds || 0) + secs });
  if (secs >= COOLDOWN_AFTER_SECONDS && cooldownMs() > 0) cooldowns.set(`${token}:${npc}`, now + cooldownMs());
}

export function resetAllowances() { cooldowns.clear(); }

// What the phone shows: minutes of calls left (null when unlimited) and the longest one call can run.
export function callAllowance(player) {
  const budget = budgetSeconds();
  const longest = Math.min(Number(env.MAX_CALL_SECONDS || 240), 240);
  if (!(budget > 0)) return { minutesLeft: null, minutesMax: null, maxSeconds: longest };
  const left = secondsLeft(player);
  return { minutesLeft: left < MIN_USEFUL_SECONDS ? 0 : Math.floor(left / 60), minutesMax: Math.round(budget / 60), maxSeconds: Math.min(longest, Math.floor(left)) };
}
