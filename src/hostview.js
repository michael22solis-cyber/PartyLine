// What the host sees while a game runs: each player's progress, the AI spend so far, and who has gone quiet.
// Built from the game file and the in-memory usage ledger (no dialogue).
import { messagesFor, getDb, getGame } from './store.js';
import { ledger } from './ai/ledger.js';

export const QUIET_MS = 10 * 60_000;

// When this game began: the start of auto mode, else the first player joining.
function gameStart() {
  const g = getGame();
  if (g?.startedAt) return Date.parse(g.startedAt);
  const joined = getDb().players.map((p) => Date.parse(p.joinedAt)).filter(Number.isFinite);
  return joined.length ? Math.min(...joined) : Date.now();
}

export function liveView(now = Date.now()) {
  const since = gameStart();
  const recs = ledger.records().filter((r) => Date.parse(r.ts) >= since);
  const usd = {}; const calls = {}; const lastCall = {};
  let total = 0;
  for (const r of recs) {
    if (r.kind === 'usage') { total += r.usd || 0; if (r.session) usd[r.session] = (usd[r.session] || 0) + (r.usd || 0); }
    else if (r.type === 'call_started' && r.session) { calls[r.session] = (calls[r.session] || 0) + 1; lastCall[r.session] = r.ts; }
  }
  const running = getDb().beats?.length > 0 || getGame()?.status === 'running';
  const players = Object.fromEntries(getDb().players.map((p) => {
    const lastText = messagesFor(p.token).filter((m) => m.from === 'player').at(-1)?.at;
    const last = Math.max(Date.parse(lastText || 0) || 0, Date.parse(lastCall[p.pid] || 0) || 0);
    const quietFor = now - Math.max(last, since);
    return [p.token, {
      calls: calls[p.pid] || 0,
      foundOnCall: (p.foundOnCall || []).length,
      usd: Number((usd[p.pid] || 0).toFixed(4)),
      lastActiveAt: last ? new Date(last).toISOString() : null,
      quietMinutes: Math.floor(quietFor / 60_000),
      quiet: running && !getDb().revealed && quietFor >= QUIET_MS,
      hinted: (p.hinted || []).length,
    }];
  }));
  return { players, usd: Number(total.toFixed(4)), since: new Date(since).toISOString() };
}
