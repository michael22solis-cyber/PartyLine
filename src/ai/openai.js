// Text model client: bounded retries with backoff, per-attempt timeouts, fair concurrency, model fallback, and a
// ledger record for every response. The permanent API key never leaves the server.
import { ledger } from './ledger.js';
import { fromChatCompletion } from './usage.js';
import { createLimiter } from './limiter.js';

const env = process.env;
const BASE = () => env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
export const TEXT_MODEL = () => env.OPENAI_TEXT_MODEL || 'gpt-4.1-mini';
const FALLBACKS = () => (env.OPENAI_TEXT_FALLBACK_MODELS ?? 'gpt-4.1-mini,gpt-4o-mini').split(',').map((s) => s.trim()).filter(Boolean);
const TIMEOUT_MS = () => Number(env.OPENAI_TEXT_TIMEOUT_MS || 20_000);
const MAX_RETRIES = () => Number(env.OPENAI_TEXT_MAX_RETRIES ?? 2);

export const textLimiter = createLimiter({
  concurrency: Number(env.OPENAI_TEXT_CONCURRENCY || 8),
  perKeyQueue: Number(env.OPENAI_TEXT_PER_PLAYER_QUEUE || 3),
  queueTimeoutMs: Number(env.OPENAI_TEXT_QUEUE_TIMEOUT_MS || 30_000),
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RETRYABLE = new Set([408, 409, 429, 500, 502, 503, 504]);
let workingModel = null; // first model this account could use

class ModelError extends Error {}

function backoff(attempt, res) {
  const hdr = Number(res?.headers?.get?.('retry-after-ms')) || Number(res?.headers?.get?.('retry-after')) * 1000;
  const base = 400 * 2 ** attempt + Math.random() * 250;
  return Math.min(4000, Number.isFinite(hdr) && hdr > 0 ? hdr : base);
}

async function attempt(model, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS());
  try {
    const res = await fetch(`${BASE()}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, model }),
      signal: ctrl.signal,
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run one chat completion.
 * meta: { session (pid), npc, capability, purpose, turn } for the ledger.
 * Returns { text, model, id, usage, latencyMs, retries }.
 */
export async function chatComplete(messages, { model, maxTokens = 200, meta = {} } = {}) {
  return textLimiter.run(meta.session || 'anon', () => runWithRetries(messages, { model, maxTokens, meta }));
}

async function runWithRetries(messages, { model, maxTokens, meta }) {
  const models = model ? [model] : workingModel ? [workingModel] : [...new Set([TEXT_MODEL(), ...FALLBACKS()])];
  let lastErr;
  let retries = 0;
  for (const m of models) {
    for (let a = 0; a <= MAX_RETRIES(); a++) {
      const t0 = Date.now();
      let res;
      try {
        res = await attempt(m, { messages, max_completion_tokens: maxTokens });
      } catch (err) {
        lastErr = new Error(err.name === 'AbortError' ? `OpenAI timeout after ${TIMEOUT_MS()} ms (${m})` : `OpenAI network error (${m}): ${err.message}`);
        lastErr.code = err.name === 'AbortError' ? 'timeout' : 'network';
        if (a < MAX_RETRIES()) { retries += 1; await sleep(backoff(a)); continue; }
        break;
      }
      if (res.ok) {
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content?.trim() || '';
        const { usage, quality } = fromChatCompletion(data.usage || {});
        const latencyMs = Date.now() - t0;
        ledger.record({
          responseId: data.id, requestId: res.headers.get('x-request-id'), model: data.model || m, usage, usageQuality: quality,
          latencyMs, retries, source: 'server', status: text ? 'completed' : 'empty', ...meta,
        });
        if (!text) throw Object.assign(new Error('Empty reply'), { code: 'empty' });
        if (!model) workingModel = m;
        return { text, model: data.model || m, id: data.id, usage, latencyMs, retries };
      }
      const body = await res.text();
      lastErr = new Error(`OpenAI ${res.status} (${m}): ${body.slice(0, 300)}`);
      lastErr.code = `http_${res.status}`;
      if (res.status === 401) throw Object.assign(new Error('OpenAI 401: the OPENAI_API_KEY in .env is wrong or revoked.'), { code: 'http_401' });
      if (res.status === 429 && /quota|billing/i.test(body)) throw Object.assign(new Error('OpenAI 429: no credit on this account. Add billing at platform.openai.com.'), { code: 'quota' });
      if ([400, 403, 404].includes(res.status)) { lastErr = new ModelError(lastErr.message); lastErr.code = `http_${res.status}`; break; } // try the next model
      if (RETRYABLE.has(res.status) && a < MAX_RETRIES()) { retries += 1; await sleep(backoff(a, res)); continue; }
      break;
    }
    if (!(lastErr instanceof ModelError)) break; // only model problems are worth trying another model for
  }
  ledger.record({ model: models[models.length - 1], usage: {}, status: 'error', error: lastErr?.code || 'error', retries, source: 'server', ...meta });
  throw lastErr;
}

export const _resetWorkingModel = () => { workingModel = null; };
