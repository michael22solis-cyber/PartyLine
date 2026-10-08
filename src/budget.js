// A hard spending cap per game, so a game can never run away with the AI bill.
// GAME_BUDGET_USD (default 5, 0 = no cap) is measured from the usage ledger since the game started:
//   at the cap:        no new live voice calls (the line "goes dead" in-story), no unprompted character texts, and
//                      characters stop placing live calls (voicemail or a missed call instead). Texting continues.
//   at 1.25× the cap:  character text replies stop too (a dead-line note instead), so nothing more is spent.
// Recorded calls (the Caretaker, the reveal) cost nothing and always play.
import { ledger, readLedgerFile } from './ai/ledger.js';
import { getDb, getGame } from './store.js';

export const budgetUsd = () => Number(process.env.GAME_BUDGET_USD ?? 5);
const STARTED = Date.now();

// When this game began: the start of auto mode, else the first player joining.
export function gameStart() {
  const g = getGame();
  if (g?.startedAt) return Date.parse(g.startedAt);
  const joined = getDb().players.map((p) => Date.parse(p.joinedAt)).filter(Number.isFinite);
  return joined.length ? Math.min(...joined) : STARTED;
}

// Spend before this server started (a restart mid-game), read once from the ledger file per game.
let before = { since: null, usd: 0 };
function spentBeforeStart(since) {
  if (before.since !== since) {
    const usd = since < STARTED ? readLedgerFile(ledger.file)
      .filter((r) => r.kind === 'usage' && Date.parse(r.ts) >= since && Date.parse(r.ts) < STARTED)
      .reduce((s, r) => s + (r.usd || 0), 0) : 0;
    before = { since, usd };
  }
  return before.usd;
}

export function gameSpend() {
  const since = gameStart();
  const now = ledger.usage().filter((r) => Date.parse(r.ts) >= Math.max(since, STARTED)).reduce((s, r) => s + (r.usd || 0), 0);
  return spentBeforeStart(since) + now;
}

let warned = null;
function check(factor) {
  const cap = budgetUsd();
  if (!(cap > 0)) return false;
  const over = gameSpend() >= cap * factor;
  if (over && warned !== `${gameStart()}:${factor}`) {
    warned = `${gameStart()}:${factor}`;
    console.warn(`[budget] this game reached ${factor === 1 ? '' : `${factor}× `}its $${cap} budget (GAME_BUDGET_USD): ${factor === 1 ? 'no more live calls' : 'character replies stopped'}`);
    ledger.event('budget_reached', { cap, factor });
  }
  return over;
}
export const overBudget = () => check(1);
export const pastHardStop = () => check(1.25);
export const budgetView = () => ({ usd: Number(gameSpend().toFixed(4)), cap: budgetUsd() > 0 ? budgetUsd() : null, over: overBudget() });

export class BudgetError extends Error {
  constructor() { super('This game reached its AI budget.'); this.code = 'budget'; }
}
