// Map each API's usage schema onto the ledger's exclusive buckets (see BUCKETS in pricing.js).
//
// The schemas disagree about cached tokens, so each normalizer is explicit:
// - Chat Completions: prompt_tokens INCLUDES prompt_tokens_details.cached_tokens.
// - Realtime response.done: input_token_details.{text,audio}_tokens INCLUDE the cached tokens, which are split again in
//   input_token_details.cached_tokens_details.{text,audio}_tokens.
// - Provider cost exports list cached and uncached input as SEPARATE line items (already exclusive).
// Reasoning tokens are a subset of output tokens and are billed at the text-output rate; we keep them as an extra,
// informational field so they are never double counted.

export const emptyUsage = () => ({
  textIn: 0, textInCached: 0, audioIn: 0, audioInCached: 0, imageIn: 0, imageInCached: 0,
  textOut: 0, audioOut: 0, reasoningOut: 0,
});

const n = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : 0);

export function fromChatCompletion(u = {}) {
  const out = emptyUsage();
  const cached = n(u.prompt_tokens_details?.cached_tokens);
  const audioIn = n(u.prompt_tokens_details?.audio_tokens);
  out.textInCached = cached;
  out.textIn = Math.max(0, n(u.prompt_tokens) - cached - audioIn);
  out.audioIn = audioIn;
  const audioOut = n(u.completion_tokens_details?.audio_tokens);
  out.audioOut = audioOut;
  out.textOut = Math.max(0, n(u.completion_tokens) - audioOut);
  out.reasoningOut = n(u.completion_tokens_details?.reasoning_tokens);
  return { usage: out, quality: u.prompt_tokens == null ? 'missing' : 'full' };
}

export function fromRealtimeResponse(u = {}) {
  const out = emptyUsage();
  const inD = u.input_token_details;
  const outD = u.output_token_details;
  let quality = 'full';
  if (inD) {
    const cachedD = inD.cached_tokens_details;
    let cText = n(cachedD?.text_tokens);
    let cAudio = n(cachedD?.audio_tokens);
    const cImage = n(cachedD?.image_tokens);
    if (!cachedD && n(inD.cached_tokens)) {
      // Older/partial payloads: only the cached total. Attribute it to text first (instructions come first in the prefix).
      cText = Math.min(n(inD.cached_tokens), n(inD.text_tokens));
      cAudio = Math.min(n(inD.cached_tokens) - cText, n(inD.audio_tokens));
      quality = 'cached-split-assumed';
    }
    out.textInCached = cText;
    out.audioInCached = cAudio;
    out.imageInCached = cImage;
    out.textIn = Math.max(0, n(inD.text_tokens) - cText);
    out.audioIn = Math.max(0, n(inD.audio_tokens) - cAudio);
    out.imageIn = Math.max(0, n(inD.image_tokens) - cImage);
  } else {
    out.textIn = n(u.input_tokens);
    quality = u.input_tokens == null ? 'missing' : 'totals-only';
  }
  const audioOut = n(outD?.audio_tokens);
  out.audioOut = audioOut;
  // Everything that is not audio is billed as text output (this includes reasoning tokens whether or not the payload
  // folds them into text_tokens).
  out.textOut = Math.max(0, n(u.output_tokens) - audioOut) || n(outD?.text_tokens);
  out.reasoningOut = n(outD?.reasoning_tokens);
  if (!outD && u.output_tokens != null && quality === 'full') quality = 'totals-only';
  return { usage: out, quality };
}

// conversation.item.input_audio_transcription.completed -> usage ({type:'tokens'} or {type:'duration'})
export function fromTranscription(u = {}) {
  const out = emptyUsage();
  if (u.type === 'duration') return { usage: { ...out, audioSeconds: Number(u.seconds) || 0 }, quality: 'duration' };
  out.audioIn = n(u.input_token_details?.audio_tokens);
  out.textIn = n(u.input_token_details?.text_tokens);
  if (!u.input_token_details) out.audioIn = n(u.input_tokens);
  out.textOut = n(u.output_tokens);
  return { usage: out, quality: u.input_token_details ? 'full' : 'totals-only' };
}

export const totalInput = (u) => u.textIn + u.textInCached + u.audioIn + u.audioInCached + u.imageIn + u.imageInCached;
export const totalCached = (u) => u.textInCached + u.audioInCached + u.imageInCached;
export const totalOutput = (u) => u.textOut + u.audioOut;

export function addUsage(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) if (typeof v === 'number') out[k] = (out[k] || 0) + v;
  return out;
}

// Rough audio duration from tokens (OpenAI: ~600 input tokens per minute heard, ~1,200 output tokens per minute spoken).
export const AUDIO_IN_TOKENS_PER_SEC = 10;
export const AUDIO_OUT_TOKENS_PER_SEC = 20;
export const audioOutMs = (tokens) => Math.round((tokens / AUDIO_OUT_TOKENS_PER_SEC) * 1000);
