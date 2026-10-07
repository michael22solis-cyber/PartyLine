// Versioned price book for cost ESTIMATES (USD per 1M tokens). The provider's invoice is the source of truth;
// every ledger record stores the price-book version it was priced with, so records can be re-priced later.
//
// To change rates: append a new book (never edit an old one) and bump CURRENT_PRICING_VERSION.
// Buckets are exclusive, like the provider's cost line items: `textIn` is UNCACHED text input, `textInCached` is the
// cached part, and so on (see src/ai/usage.js for how each API's usage schema is mapped onto these buckets).

export const BUCKETS = ['textIn', 'textInCached', 'audioIn', 'audioInCached', 'imageIn', 'imageInCached', 'textOut', 'audioOut'];

export const PRICE_BOOKS = {
  '2026-10-07': {
    checked: '2026-10-07',
    note: 'Checked via web search of OpenAI model/pricing/deprecation pages (direct fetch of openai.com was blocked from the build sandbox). Entries marked `unverified` are projections only.',
    sources: [
      'https://developers.openai.com/api/docs/pricing',
      'https://developers.openai.com/api/docs/models/gpt-realtime-2.1-mini',
      'https://developers.openai.com/api/docs/deprecations',
      'https://developers.openai.com/api/docs/guides/voice-latency-cost',
    ],
    models: {
      // ---- speech-to-speech ----
      'gpt-realtime': {
        textIn: 4, textInCached: 0.4, textOut: 16, audioIn: 32, audioInCached: 0.4, audioOut: 64, imageIn: 5, imageInCached: 0.5,
        lifecycle: 'deprecated 2026-07-20; shutdown 2027-01-20; replacement gpt-realtime-2.1 / gpt-realtime-2.1-mini',
      },
      'gpt-realtime-mini': {
        textIn: 0.6, textInCached: 0.06, textOut: 2.4, audioIn: 10, audioInCached: 0.3, audioOut: 20,
        lifecycle: 'deprecated 2026-07-20; shutdown 2027-01-20; replacement gpt-realtime-2.1-mini',
      },
      'gpt-realtime-2.1-mini': {
        // Reasoning model (released 2026-07-06): reasoning tokens are billed as text output.
        textIn: 0.6, textInCached: 0.06, textOut: 2.4, audioIn: 10, audioInCached: 0.3, audioOut: 20,
        lifecycle: 'current',
      },
      'gpt-realtime-2.1': {
        textIn: 4, textInCached: 0.4, textOut: 16, audioIn: 32, audioInCached: 0.4, audioOut: 64,
        lifecycle: 'current',
        unverified: ['textIn', 'textInCached', 'textOut', 'audioIn', 'audioInCached'], // audioOut $64 confirmed
      },
      // ---- text ----
      'gpt-4.1-mini': { textIn: 0.4, textInCached: 0.1, textOut: 1.6, lifecycle: 'current on the OpenAI API (Azure retires it separately)' },
      'gpt-4o-mini': { textIn: 0.15, textInCached: 0.075, textOut: 0.6, lifecycle: 'legacy fallback only' },
      'gpt-5.6-luna': { textIn: 0.2, textInCached: 0.02, textOut: 1.2, lifecycle: 'current', unverified: true },
      // ---- transcription / speech ----
      'gpt-4o-mini-transcribe': {
        textIn: 1.25, textOut: 5, audioIn: 3,
        lifecycle: '2025-03-20 snapshot shuts down 2027-01-20; whole family shuts down 2027-02-26 (replacement gpt-live-transcribe / gpt-transcribe)',
      },
      'gpt-4o-mini-tts': { textIn: 0.6, audioOut: 12, lifecycle: 'deprecated; shutdown 2027-01-06' },
    },
    // Duration-billed models (USD per audio minute). Used when a usage block reports seconds instead of tokens.
    perMinute: {
      'gpt-live-transcribe': 0.017,
      'gpt-transcribe': 0.0045,
      'gpt-4o-mini-transcribe': 0.003,
    },
  },
};

export const CURRENT_PRICING_VERSION = '2026-10-07';

// 'gpt-realtime-2025-08-28' -> 'gpt-realtime'; 'gpt-4.1-mini-2025-04-14' -> 'gpt-4.1-mini'.
export function canonicalModel(model) {
  return String(model || '').trim().replace(/-\d{4}-\d{2}-\d{2}$/, '');
}

export function priceFor(model, version = CURRENT_PRICING_VERSION) {
  const book = PRICE_BOOKS[version];
  if (!book) throw new Error(`Unknown pricing version ${version}`);
  const id = canonicalModel(model);
  return book.models[id] ? { id, ...book.models[id] } : null;
}

// Cost of one usage record. Buckets with tokens but no rate fall back to the uncached rate and are reported as gaps.
export function costOf(model, usage = {}, version = CURRENT_PRICING_VERSION) {
  const p = priceFor(model, version);
  const breakdown = {};
  const gaps = [];
  let usd = 0;
  if (!p) {
    const perMin = PRICE_BOOKS[version].perMinute[canonicalModel(model)];
    if (perMin && usage.audioSeconds) {
      usd = (usage.audioSeconds / 60) * perMin;
      return { usd, breakdown: { audioSeconds: usd }, gaps, version, priced: true };
    }
    return { usd: 0, breakdown, gaps: ['model'], version, priced: false };
  }
  for (const b of BUCKETS) {
    const n = usage[b] || 0;
    if (!n) continue;
    let rate = p[b];
    if (rate == null) {
      rate = p[b.replace('Cached', '')];
      gaps.push(b);
    }
    if (rate == null) continue;
    const c = (n * rate) / 1e6;
    breakdown[b] = c;
    usd += c;
  }
  if (!usd && usage.audioSeconds) {
    const perMin = PRICE_BOOKS[version].perMinute[p.id];
    if (perMin) { usd = (usage.audioSeconds / 60) * perMin; breakdown.audioSeconds = usd; }
  }
  return { usd, breakdown, gaps, version, priced: true };
}
