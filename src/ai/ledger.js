// Central AI usage ledger: one line per model response (or failed request), plus a few game events.
//
// - Deduplicated by response ID (the same Realtime response can be reported by the browser AND the server).
// - Usage is stored in exclusive buckets (see usage.js) with an estimated cost and the price-book version used.
// - Privacy: no player tokens, names, prompts or dialogue are written here. Players are identified by their public
//   pid; errors are stored as short codes.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { dataFile } from '../paths.js';
import { costOf, CURRENT_PRICING_VERSION, canonicalModel } from './pricing.js';
import { emptyUsage } from './usage.js';

const SOURCE_RANK = { client: 1, script: 2, server: 3, sideband: 3, provider: 4 };
const MAX_IDS = 200_000;
const MAX_IN_MEMORY = 50_000;

const clampInt = (v, max = 5_000_000) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));
const short = (s, max = 80) => (s == null ? undefined : String(s).replace(/\s+/g, ' ').slice(0, max));

export function createLedger({ file = dataFile('usage.jsonl'), gameId = process.env.GAME_ID || 'default', persist = true } = {}) {
  const seen = new Map(); // id -> source rank
  const records = [];
  let writing = Promise.resolve();
  let buffer = [];
  let timer = null;

  if (persist) {
    try {
      for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        if (!line) continue;
        try {
          const r = JSON.parse(line);
          if (r.id) seen.set(r.id, Math.max(seen.get(r.id) || 0, SOURCE_RANK[r.source] || 0));
        } catch { /* skip a torn line */ }
      }
    } catch { /* no ledger yet */ }
  }

  function flushSoon() {
    if (!persist || timer) return;
    timer = setTimeout(() => { timer = null; flush(); }, 200);
    timer.unref?.();
  }

  function flush() {
    if (!persist || !buffer.length) return writing;
    const chunk = buffer.map((r) => JSON.stringify(r)).join('\n') + '\n';
    buffer = [];
    writing = writing.then(async () => {
      await fs.promises.mkdir(path.dirname(file), { recursive: true });
      await fs.promises.appendFile(file, chunk);
    }).catch((err) => console.error('[ledger] write failed:', err.message));
    return writing;
  }

  function keep(r) {
    records.push(r);
    if (records.length > MAX_IN_MEMORY) records.splice(0, records.length - MAX_IN_MEMORY);
    if (r.id) {
      seen.set(r.id, SOURCE_RANK[r.source] || 0);
      if (seen.size > MAX_IDS) seen.delete(seen.keys().next().value);
    }
    buffer.push(r);
    flushSoon();
  }

  // Record one model response. Returns { recorded, duplicate, record }.
  function record(entry) {
    const source = entry.source || 'server';
    const id = entry.responseId || entry.id || `gen_${crypto.randomUUID()}`;
    const prior = seen.get(id);
    if (prior != null && prior >= (SOURCE_RANK[source] || 0)) return { recorded: false, duplicate: true };
    const usage = { ...emptyUsage() };
    for (const [k, v] of Object.entries(entry.usage || {})) usage[k] = k === 'audioSeconds' ? Math.max(0, Number(v) || 0) : clampInt(v);
    const model = canonicalModel(entry.model) || 'unknown';
    const cost = costOf(entry.model || model, usage, entry.pricingVersion || CURRENT_PRICING_VERSION);
    const r = {
      v: 1,
      kind: 'usage',
      id,
      ts: entry.ts || new Date().toISOString(),
      game: entry.game || gameId,
      session: entry.session || null, // player pid
      callId: entry.callId || undefined,
      npc: entry.npc || null,
      turn: entry.turn ?? undefined,
      capability: entry.capability || 'unknown', // voice | text | group | overheard | transcription | tts | summary | eval
      purpose: entry.purpose || undefined,
      model,
      modelSnapshot: entry.model && entry.model !== model ? entry.model : undefined,
      requestId: short(entry.requestId),
      responseId: entry.responseId || undefined,
      source,
      status: entry.status || 'completed',
      statusReason: short(entry.statusReason, 40),
      usage,
      usageQuality: entry.usageQuality || undefined,
      usd: Number(cost.usd.toFixed(8)),
      pricingVersion: cost.version,
      priceGaps: cost.gaps.length ? cost.gaps : undefined,
      latencyMs: entry.latencyMs != null ? clampInt(entry.latencyMs, 600_000) : undefined,
      firstAudioMs: entry.firstAudioMs != null ? clampInt(entry.firstAudioMs, 600_000) : undefined,
      audioGeneratedMs: entry.audioGeneratedMs != null ? clampInt(entry.audioGeneratedMs, 3_600_000) : undefined,
      audioPlayedMs: entry.audioPlayedMs != null ? clampInt(entry.audioPlayedMs, 3_600_000) : undefined,
      retries: entry.retries ? clampInt(entry.retries, 20) : undefined,
      error: short(entry.error, 60),
      supersedes: prior != null ? true : undefined,
    };
    for (const k of Object.keys(r)) if (r[k] === undefined) delete r[k];
    keep(r);
    return { recorded: true, duplicate: false, record: r };
  }

  // Game/call events (call_started, call_ended, text_skipped, game_completed...). No dialogue.
  function event(type, data = {}) {
    const r = { v: 1, kind: 'event', id: `evt_${crypto.randomUUID()}`, ts: new Date().toISOString(), game: data.game || gameId, type };
    for (const [k, v] of Object.entries(data)) {
      if (k === 'game') continue;
      if (typeof v === 'number' || typeof v === 'boolean' || v == null) r[k] = v;
      else r[k] = short(v, 80);
    }
    keep(r);
    return r;
  }

  // Last chance on shutdown: write whatever is still buffered, synchronously.
  if (persist) {
    process.on('exit', () => {
      if (!buffer.length) return;
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.appendFileSync(file, buffer.map((r) => JSON.stringify(r)).join('\n') + '\n');
        buffer = [];
      } catch { /* nothing more we can do */ }
    });
  }

  return {
    record,
    event,
    flush,
    records: () => records.slice(),
    usage: () => records.filter((r) => r.kind === 'usage'),
    has: (id) => seen.has(id),
    file,
    async close() { clearTimeout(timer); timer = null; await flush(); },
    reset() { records.length = 0; seen.clear(); buffer = []; },
  };
}

export const ledger = createLedger({ persist: process.env.USAGE_LEDGER !== 'off' });

export function readLedgerFile(file = dataFile('usage.jsonl')) {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap((l) => {
      try { return [JSON.parse(l)]; } catch { return []; }
    });
  } catch { return []; }
}
