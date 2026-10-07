import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { costOf, canonicalModel, priceFor } from '../src/ai/pricing.js';
import { fromChatCompletion, fromRealtimeResponse, fromTranscription } from '../src/ai/usage.js';
import { createLedger, readLedgerFile } from '../src/ai/ledger.js';
import { buildReport, reconcile, priceExport, percentile } from '../src/ai/report.js';

const baseline = JSON.parse(fs.readFileSync(new URL('./fixtures/baseline-export.json', import.meta.url)));
const near = (a, b, eps = 1e-5) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

test('price book reproduces the provider cost of the baseline Realtime buckets', () => {
  const rt = baseline.models['gpt-realtime-2025-08-28'];
  near(costOf('gpt-realtime-2025-08-28', rt.buckets).usd, 0.48814);
  // The same token counts at gpt-realtime-2.1-mini rates (the host's earlier estimate was ~$0.159 for the whole workload).
  const mini = costOf('gpt-realtime-2.1-mini', rt.buckets).usd;
  near(mini, 0.1359425, 1e-6);
  const others = 0.00929 + 0.01212 + 0.0018;
  near(mini + others, 0.159, 0.0005);
  // Whole-export totals are internally consistent with the fixture.
  const allCached = rt.buckets.textInCached + rt.buckets.audioInCached;
  assert.equal(allCached, baseline.totals.cachedTokens, 'all cached tokens in the export were Realtime');
});

test('snapshot ids resolve to their family', () => {
  assert.equal(canonicalModel('gpt-4.1-mini-2025-04-14'), 'gpt-4.1-mini');
  assert.equal(canonicalModel('gpt-realtime-2.1-mini'), 'gpt-realtime-2.1-mini');
  assert.ok(priceFor('gpt-4o-mini-transcribe-2025-12-15'));
});

test('chat completion usage: cached tokens are a subset of prompt tokens', () => {
  const { usage } = fromChatCompletion({
    prompt_tokens: 1200, completion_tokens: 60,
    prompt_tokens_details: { cached_tokens: 1024 }, completion_tokens_details: { reasoning_tokens: 0 },
  });
  assert.equal(usage.textIn, 176);
  assert.equal(usage.textInCached, 1024);
  assert.equal(usage.textOut, 60);
  near(costOf('gpt-4.1-mini', usage).usd, (176 * 0.4 + 1024 * 0.1 + 60 * 1.6) / 1e6, 1e-12);
});

test('realtime usage: per-modality details include cached tokens; reasoning is not double counted', () => {
  const { usage, quality } = fromRealtimeResponse({
    input_tokens: 2000, output_tokens: 330,
    input_token_details: { text_tokens: 1500, audio_tokens: 500, cached_tokens: 1408, cached_tokens_details: { text_tokens: 1280, audio_tokens: 128 } },
    output_token_details: { text_tokens: 30, audio_tokens: 300, reasoning_tokens: 12 },
  });
  assert.equal(quality, 'full');
  assert.deepEqual(
    [usage.textIn, usage.textInCached, usage.audioIn, usage.audioInCached, usage.textOut, usage.audioOut, usage.reasoningOut],
    [220, 1280, 372, 128, 30, 300, 12],
  );
  // Totals-only payloads are flagged, not silently trusted.
  assert.equal(fromRealtimeResponse({ input_tokens: 10, output_tokens: 5 }).quality, 'totals-only');
  // Cached total without a split: attributed to text first and flagged.
  const partial = fromRealtimeResponse({ input_tokens: 100, output_tokens: 0, input_token_details: { text_tokens: 80, audio_tokens: 20, cached_tokens: 90 } });
  assert.equal(partial.quality, 'cached-split-assumed');
  assert.equal(partial.usage.textInCached, 80);
  assert.equal(partial.usage.audioInCached, 10);
});

test('transcription usage handles token and duration shapes', () => {
  assert.equal(fromTranscription({ type: 'tokens', input_tokens: 40, input_token_details: { audio_tokens: 40 }, output_tokens: 9 }).usage.audioIn, 40);
  assert.equal(fromTranscription({ type: 'duration', seconds: 3.2 }).usage.audioSeconds, 3.2);
});

test('ledger dedupes by response id, prefers server over client reports, persists, and stays text-free', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bw-ledger-'));
  const file = path.join(dir, 'usage.jsonl');
  const l = createLedger({ file, gameId: 'g1' });
  const u = { textIn: 100, audioOut: 200 };
  assert.equal(l.record({ responseId: 'resp_1', model: 'gpt-realtime-2.1-mini', usage: u, source: 'client', capability: 'voice', session: 'p1' }).recorded, true);
  assert.equal(l.record({ responseId: 'resp_1', model: 'gpt-realtime-2.1-mini', usage: u, source: 'client', capability: 'voice', session: 'p1' }).duplicate, true);
  assert.equal(l.record({ responseId: 'resp_1', model: 'gpt-realtime-2.1-mini', usage: u, source: 'sideband', capability: 'voice', session: 'p1' }).recorded, true);
  assert.equal(l.record({ responseId: 'resp_1', model: 'gpt-realtime-2.1-mini', usage: u, source: 'client', capability: 'voice', session: 'p1' }).duplicate, true);
  l.event('call_ended', { callId: 'c1', seconds: 42, reason: 'player_hung_up', text: 'x'.repeat(500) });
  await l.close();
  const lines = readLedgerFile(file);
  assert.equal(lines.length, 3);
  assert.ok(lines[2].text.length <= 80, 'event strings are truncated');
  // Report-side dedupe keeps the sideband copy once.
  const rep = buildReport(lines);
  assert.equal(rep.records, 1);
  assert.equal(rep.byCapability.voice.responses, 1);
  // A fresh ledger on the same file remembers ids.
  const again = createLedger({ file });
  assert.equal(again.record({ responseId: 'resp_1', model: 'x', usage: u, source: 'client' }).duplicate, true);
});

test('report: typical session, top 5%, cost per completed mystery, one-time spend separated', () => {
  const l = createLedger({ persist: false, gameId: 'g1' });
  for (let i = 0; i < 40; i++) {
    l.record({ responseId: `r${i}`, model: 'gpt-4.1-mini', usage: { textIn: 600 + i * 100, textOut: 50 }, capability: 'text', session: `p${i % 20}` });
  }
  l.record({ responseId: 'tts1', model: 'gpt-4o-mini-tts', usage: { textIn: 50, audioOut: 900 }, capability: 'tts', source: 'script' });
  l.event('game_completed', {});
  const rep = buildReport(l.records());
  assert.equal(rep.sessions.count, 20);
  assert.equal(rep.sessions.top5pct.length, 1);
  assert.ok(rep.sessions.top5pct[0].usd >= rep.sessions.p95Usd);
  assert.ok(rep.totals.oneTimeUsd > 0);
  near(rep.mysteries.usdPerCompleted, rep.totals.gameplayUsd, 1e-9);
  assert.equal(percentile([1, 2, 3, 4], 50), 2);
});

test('reconciliation flags differences per bucket and validates the price book against the export', () => {
  const l = createLedger({ persist: false });
  const b = baseline.models['gpt-realtime-2025-08-28'].buckets;
  l.record({ responseId: 'a', model: 'gpt-realtime-2025-08-28', usage: { ...b, audioOut: b.audioOut - 91 }, capability: 'voice' });
  const rows = reconcile(l.records(), baseline);
  const ao = rows.find((r) => r.model === 'gpt-realtime' && r.field === 'audioOut');
  assert.equal(ao.diff, -91);
  const priced = priceExport(baseline);
  near(priced['gpt-realtime-2025-08-28'].estimated, 0.48814);
  // Usage API shape (inclusive totals).
  const rows2 = reconcile(l.records(), { format: 'usage_api', data: [{ model: 'gpt-realtime-2025-08-28', input_tokens: 77610, input_cached_tokens: 56448, input_audio_tokens: 7471, output_tokens: 4848, output_audio_tokens: 3791, num_model_requests: 6 }] });
  assert.equal(rows2.find((r) => r.field === 'input_tokens (incl. cached)').diff, 0);
  assert.equal(rows2.find((r) => r.field === 'input_cached_tokens').diff, 0);
});
