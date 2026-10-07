// Turn ledger records into cost reports, and reconcile them against a provider usage export.
import { BUCKETS, costOf, canonicalModel, CURRENT_PRICING_VERSION } from './pricing.js';
import { emptyUsage, addUsage, totalInput, totalCached, totalOutput } from './usage.js';

const RANK = { client: 1, script: 2, server: 3, sideband: 3, provider: 4 };
// One-time or out-of-game spend: reported, but not counted as a player's session cost.
export const NON_GAMEPLAY = new Set(['tts', 'eval', 'asset']);

export function dedupe(records) {
  const best = new Map();
  const events = [];
  for (const r of records) {
    if (r.kind === 'event') { events.push(r); continue; }
    const prev = best.get(r.id);
    if (!prev || (RANK[r.source] || 0) > (RANK[prev.source] || 0)) best.set(r.id, r);
  }
  return { usage: [...best.values()], events };
}

export function percentile(values, p) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
}
const median = (v) => percentile(v, 50);
const round = (x, d = 6) => Number((x || 0).toFixed(d));

function group(usage, keyFn) {
  const out = {};
  for (const r of usage) {
    const k = keyFn(r) ?? 'unattributed';
    const g = (out[k] ||= { usd: 0, responses: 0, usage: emptyUsage() });
    g.usd += r.usd;
    g.responses += 1;
    g.usage = addUsage(g.usage, r.usage);
  }
  for (const g of Object.values(out)) g.usd = round(g.usd);
  return out;
}

export function buildReport(records, { version } = {}) {
  const { usage: raw, events } = dedupe(records);
  // Optionally re-price every record with one price book (e.g. to compare models on equal terms).
  const usage = version
    ? raw.map((r) => ({ ...r, usd: costOf(r.model, r.usage, version).usd, pricingVersion: version }))
    : raw;
  const gameplay = usage.filter((r) => !NON_GAMEPLAY.has(r.capability));

  const sessionsMap = group(gameplay.filter((r) => r.session), (r) => r.session);
  const sessionCosts = Object.entries(sessionsMap).map(([session, g]) => ({ session, ...g })).sort((a, b) => b.usd - a.usd);
  const topN = Math.max(1, Math.ceil(sessionCosts.length * 0.05));
  const callsMap = group(gameplay.filter((r) => r.callId), (r) => r.callId);
  const callEnds = Object.fromEntries(events.filter((e) => e.type === 'call_ended' && e.callId).map((e) => [e.callId, e]));
  const calls = Object.entries(callsMap).map(([callId, g]) => ({
    callId, ...g,
    npc: gameplay.find((r) => r.callId === callId)?.npc,
    seconds: callEnds[callId]?.seconds, reason: callEnds[callId]?.reason,
  }));

  const completedGames = new Set(events.filter((e) => e.type === 'game_completed').map((e) => e.game));
  const gameplayUsd = gameplay.reduce((s, r) => s + r.usd, 0);
  const completedUsd = gameplay.filter((r) => completedGames.has(r.game)).reduce((s, r) => s + r.usd, 0);

  const bucketUsd = {};
  for (const r of usage) {
    const { breakdown } = costOf(r.model, r.usage, r.pricingVersion || CURRENT_PRICING_VERSION);
    for (const [b, c] of Object.entries(breakdown)) bucketUsd[`${r.model}:${b}`] = round((bucketUsd[`${r.model}:${b}`] || 0) + c);
  }

  const byModel = group(usage, (r) => r.model);
  for (const g of Object.values(byModel)) {
    const inTok = totalInput(g.usage);
    g.cacheHitRate = inTok ? round(totalCached(g.usage) / inTok, 3) : 0;
  }
  const statuses = {};
  for (const r of usage) statuses[r.status] = (statuses[r.status] || 0) + 1;
  const voice = usage.filter((r) => r.capability === 'voice');
  const cancelled = voice.filter((r) => r.status === 'cancelled');
  const text = usage.filter((r) => ['text', 'group', 'overheard'].includes(r.capability));

  return {
    records: usage.length,
    events: events.length,
    totals: {
      usd: round(usage.reduce((s, r) => s + r.usd, 0)),
      gameplayUsd: round(gameplayUsd),
      oneTimeUsd: round(usage.filter((r) => NON_GAMEPLAY.has(r.capability)).reduce((s, r) => s + r.usd, 0)),
      usage: usage.reduce((u, r) => addUsage(u, r.usage), emptyUsage()),
    },
    byCapability: group(usage, (r) => r.capability),
    byModel,
    byNpc: group(gameplay, (r) => r.npc),
    byBucket: bucketUsd,
    sessions: {
      count: sessionCosts.length,
      typicalUsd: round(median(sessionCosts.map((s) => s.usd))),
      meanUsd: round(sessionCosts.length ? sessionCosts.reduce((s, x) => s + x.usd, 0) / sessionCosts.length : 0),
      p95Usd: round(percentile(sessionCosts.map((s) => s.usd), 95)),
      top5pct: sessionCosts.slice(0, topN),
    },
    calls: {
      count: calls.length,
      typicalUsd: round(median(calls.map((c) => c.usd))),
      p95Usd: round(percentile(calls.map((c) => c.usd), 95)),
      top5pct: calls.sort((a, b) => b.usd - a.usd).slice(0, Math.max(1, Math.ceil(calls.length * 0.05))),
    },
    mysteries: {
      completed: completedGames.size,
      usdPerCompleted: completedGames.size ? round(completedUsd / completedGames.size) : null,
    },
    quality: {
      statuses,
      voiceResponses: voice.length,
      cancelledVoiceResponses: cancelled.length,
      unplayedAudioMs: cancelled.reduce((s, r) => s + Math.max(0, (r.audioGeneratedMs || 0) - (r.audioPlayedMs || 0)), 0),
      textLatencyP50: percentile(text.map((r) => r.latencyMs).filter(Number.isFinite), 50),
      textLatencyP95: percentile(text.map((r) => r.latencyMs).filter(Number.isFinite), 95),
      firstAudioP50: percentile(voice.map((r) => r.firstAudioMs).filter(Number.isFinite), 50),
      firstAudioP95: percentile(voice.map((r) => r.firstAudioMs).filter(Number.isFinite), 95),
      retries: usage.reduce((s, r) => s + (r.retries || 0), 0),
      errors: usage.filter((r) => r.error).length,
      reasoningTokens: usage.reduce((s, r) => s + (r.usage.reasoningOut || 0), 0),
      textSkipped: events.filter((e) => e.type === 'text_skipped').length,
    },
  };
}

const usd = (x) => (x == null ? 'n/a' : `$${Number(x).toFixed(5)}`);
export function formatReport(r) {
  const lines = [];
  lines.push(`AI usage: ${r.records} responses, total ${usd(r.totals.usd)} (gameplay ${usd(r.totals.gameplayUsd)}, one-time assets ${usd(r.totals.oneTimeUsd)})`);
  lines.push('');
  lines.push('By capability:');
  for (const [k, g] of Object.entries(r.byCapability).sort((a, b) => b[1].usd - a[1].usd)) lines.push(`  ${k.padEnd(14)} ${usd(g.usd).padStart(10)}  ${g.responses} responses`);
  lines.push('By model:');
  for (const [k, g] of Object.entries(r.byModel).sort((a, b) => b[1].usd - a[1].usd)) {
    lines.push(`  ${k.padEnd(24)} ${usd(g.usd).padStart(10)}  ${g.responses} responses, cache hit ${(g.cacheHitRate * 100).toFixed(0)}%`);
  }
  lines.push('');
  lines.push(`Player sessions: ${r.sessions.count}; typical (median) ${usd(r.sessions.typicalUsd)}, mean ${usd(r.sessions.meanUsd)}, p95 ${usd(r.sessions.p95Usd)}`);
  lines.push(`  most expensive 5%: ${r.sessions.top5pct.map((s) => `${s.session} ${usd(s.usd)}`).join(', ') || 'n/a'}`);
  lines.push(`Calls: ${r.calls.count}; typical ${usd(r.calls.typicalUsd)}, p95 ${usd(r.calls.p95Usd)}`);
  lines.push(`Completed mysteries: ${r.mysteries.completed}; cost per completed mystery ${usd(r.mysteries.usdPerCompleted)}`);
  lines.push('');
  const q = r.quality;
  lines.push(`Voice responses ${q.voiceResponses} (${q.cancelledVoiceResponses} cancelled, ${(q.unplayedAudioMs / 1000).toFixed(1)} s generated but never played)`);
  lines.push(`Latency: text p50 ${q.textLatencyP50} ms / p95 ${q.textLatencyP95} ms; voice first audio p50 ${q.firstAudioP50} ms / p95 ${q.firstAudioP95} ms`);
  lines.push(`Retries ${q.retries}, errors ${q.errors}, reasoning tokens ${q.reasoningTokens}, texts answered without a model call ${q.textSkipped}`);
  return lines.join('\n');
}

// ---------- reconciliation against a provider export ----------
// Accepted shapes:
//  { format: 'buckets', models: { '<model>': { requests, cost, buckets: { textIn, textInCached, ... } } } }
//    (dashboard cost line items; cached and uncached are separate)
//  { format: 'usage_api', data: [{ model, input_tokens, input_cached_tokens, input_audio_tokens, output_tokens,
//    output_audio_tokens, num_model_requests }] }   (Usage API; input_tokens INCLUDES cached and audio tokens)
export function reconcile(records, exp) {
  const { usage } = dedupe(records);
  const ledgerBy = {};
  for (const r of usage) {
    const g = (ledgerBy[r.model] ||= { responses: 0, usd: 0, usage: emptyUsage() });
    g.responses += 1; g.usd += r.usd; g.usage = addUsage(g.usage, r.usage);
  }
  const rows = [];
  const push = (model, field, provider, ledger) => {
    if (provider == null) return;
    const diff = (ledger || 0) - provider;
    rows.push({ model, field, provider, ledger: round(ledger || 0, 6), diff: round(diff, 6), diffPct: provider ? round((diff / provider) * 100, 1) : null });
  };
  if (exp.format === 'usage_api') {
    const prov = {};
    for (const d of exp.data || []) {
      const m = canonicalModel(d.model);
      const g = (prov[m] ||= { input: 0, cached: 0, audioIn: 0, output: 0, audioOut: 0, requests: 0 });
      g.input += d.input_tokens || 0; g.cached += d.input_cached_tokens || 0; g.audioIn += d.input_audio_tokens || 0;
      g.output += d.output_tokens || 0; g.audioOut += d.output_audio_tokens || 0; g.requests += d.num_model_requests || 0;
    }
    for (const [m, p] of Object.entries(prov)) {
      const l = ledgerBy[m]?.usage || emptyUsage();
      push(m, 'input_tokens (incl. cached)', p.input, totalInput(l));
      push(m, 'input_cached_tokens', p.cached, totalCached(l));
      push(m, 'input_audio_tokens (incl. cached)', p.audioIn, l.audioIn + l.audioInCached);
      push(m, 'output_tokens', p.output, totalOutput(l));
      push(m, 'output_audio_tokens', p.audioOut, l.audioOut);
      rows.push({ model: m, field: 'requests (not comparable: provider counts requests, ledger counts responses)', provider: p.requests, ledger: ledgerBy[m]?.responses || 0 });
    }
  } else {
    for (const [model, p] of Object.entries(exp.models || {})) {
      const m = canonicalModel(model);
      const l = ledgerBy[m];
      if (p.buckets) for (const b of BUCKETS) if (p.buckets[b] != null) push(m, b, p.buckets[b], l?.usage[b] || 0);
      if (p.cost != null) push(m, 'cost_usd', p.cost, l?.usd || 0);
      if (p.requests != null) rows.push({ model: m, field: 'requests (not comparable: provider counts requests, ledger counts responses)', provider: p.requests, ledger: l?.responses || 0 });
    }
  }
  return rows;
}

// Price a provider export's buckets with our price book: validates the price book against the provider's own cost.
export function priceExport(exp, version = CURRENT_PRICING_VERSION) {
  const out = {};
  for (const [model, p] of Object.entries(exp.models || {})) {
    if (!p.buckets) continue;
    out[model] = { provider: p.cost ?? null, estimated: round(costOf(model, p.buckets, version).usd, 6) };
  }
  return out;
}
