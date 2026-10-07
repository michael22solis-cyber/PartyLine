// A transparent MODEL of how the Realtime and Chat APIs bill tokens. Used by the offline mock server and the cost
// simulator. It is an approximation, not the provider's meter; every assumption is listed here and the simulator
// reports how closely it reproduces the real baseline export.
//
// Assumptions (sources: OpenAI cost-optimization guide and prompt-caching docs; the rest inferred from the export):
//  A1. Every Realtime response re-reads the whole session: instructions + tools + every conversation item so far.
//  A2. Caller audio is ~10 input tokens/s; character audio is ~20 output tokens/s ("~600 tokens per minute heard,
//      ~1,200 per minute spoken").
//  A3. Character audio stays in the history and is re-read as AUDIO INPUT at its output token count on later turns.
//      (This is what makes the export's ~4.3k uncached audio-input tokens consistent with only ~$0.002 of
//      transcription: the caller spoke < 1 minute in total, the rest is re-read character audio.)
//  A4. Prompt caching: a prefix of >= 1,024 tokens identical to an earlier request is cached, in 128-token steps.
//  A5. Truncating an item on barge-in shortens it (less audio re-read later) and breaks the cache from that item on.
//  A6. Silence is not billed; background noise that triggers turn detection is.
import { encode } from 'gpt-tokenizer/encoding/o200k_base';

export const RATES = { userAudioTokPerSec: 10, assistantAudioTokPerSec: 20, cacheMin: 1024, cacheStep: 128 };
export const tokens = (s) => (s ? encode(String(s)).length : 0);

// One request's input, as an ordered list of segments: { id, kind: 'text'|'audio', tokens }.
export function lcpTokens(prev, cur) {
  let n = 0;
  for (let i = 0; i < Math.min(prev.length, cur.length); i++) {
    if (prev[i].id !== cur[i].id || prev[i].tokens !== cur[i].tokens) break;
    n += cur[i].tokens;
  }
  return n;
}

// Bill one request given the segments of the best earlier request it can share a cached prefix with.
export function billInput(segments, cachedFrom = []) {
  const total = segments.reduce((s, x) => s + x.tokens, 0);
  let cached = 0;
  if (total >= RATES.cacheMin && cachedFrom.length) {
    const lcp = lcpTokens(cachedFrom, segments);
    if (lcp >= RATES.cacheMin) cached = Math.floor(lcp / RATES.cacheStep) * RATES.cacheStep;
  }
  const out = { textIn: 0, textInCached: 0, audioIn: 0, audioInCached: 0 };
  let left = cached;
  for (const seg of segments) {
    const c = Math.min(left, seg.tokens);
    left -= c;
    if (seg.kind === 'audio') { out.audioInCached += c; out.audioIn += seg.tokens - c; } else { out.textInCached += c; out.textIn += seg.tokens - c; }
  }
  return { ...out, total, cached };
}

// Realtime usage block in the API's own schema (details INCLUDE cached tokens), as the mock server emits it.
export function realtimeUsageBlock(input, { textOut = 0, audioOut = 0, reasoning = 0 } = {}) {
  const textTokens = input.textIn + input.textInCached;
  const audioTokens = input.audioIn + input.audioInCached;
  return {
    total_tokens: textTokens + audioTokens + textOut + audioOut + reasoning,
    input_tokens: textTokens + audioTokens,
    output_tokens: textOut + audioOut + reasoning,
    input_token_details: {
      text_tokens: textTokens, audio_tokens: audioTokens, image_tokens: 0,
      cached_tokens: input.textInCached + input.audioInCached,
      cached_tokens_details: { text_tokens: input.textInCached, audio_tokens: input.audioInCached, image_tokens: 0 },
    },
    output_token_details: { text_tokens: textOut + reasoning, audio_tokens: audioOut, ...(reasoning ? { reasoning_tokens: reasoning } : {}) },
  };
}

// Chat Completions: prompt tokens with the usual per-message overhead.
export function chatPromptSegments(messages) {
  return messages.map((m, i) => ({ id: `${i}:${m.role}:${m.content}`, kind: 'text', tokens: tokens(m.content) + 4 }));
}
