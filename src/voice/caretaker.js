// The Caretaker in one voice: the intro narrator's ElevenLabs voice, on every call and at the final reveal.
// He only ever speaks his fixed riddles and hints, so his calls are recordings, not live sessions. Each line is
// generated once (ELEVENLABS_API_KEY + ELEVENLABS_VOICE_ID, same as `npm run voice`), cached on the data volume, and
// reused by every game; a player's name is a separate short clip, also cached. Without the keys, or if generation
// fails, his calls stay live on OpenAI exactly as before. CARETAKER_VOICE=live forces that.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { dataFile } from '../paths.js';
import { ledger } from '../ai/ledger.js';

const env = process.env;
const DIR = dataFile('voice');
const TIMEOUT_MS = 20_000;

// Delivery tags are read by Eleven v3/v4 and never spoken. Captions use the same words without the tags.
const TAG = '[slow, raspy, old man, quiet, far away on a bad phone line]';
export const LINES = {
  riddle: `${TAG} Twenty steps down... and I never came back up. [pause] She didn't fall on her own. [pause] Neither did I.`,
  hints: [
    `${TAG} The humming... [pause] the humming was real.`,
    `${TAG} The voice in the walls... is a liar. [pause] Don't listen to it.`,
    `${TAG} Ask my daughter... [pause] about the song.`,
    `${TAG} Ask who came home... with mud on her shoes.`,
  ],
  fading: `${TAG} The line is fading... [long pause] Find me before the line goes dead.`,
  reveal: `${TAG} Thirty years I've waited under that floor. [pause] She sang my wife to sleep... and then she buried me. [long pause] Ruth Calloway. [pause] Dana was going to find me... so Ruth made sure she never reached the bottom of the stairs alive. [long pause] Thank you for listening. [pause] Happy Halloween.`,
};
const greeting = (name) => `${TAG} ...${name}... [pause] are you there...?`;
export const spoken = (line) => line.replace(/\[[^\]]*\]\s*/g, '').trim();

// Railway variables pasted with spaces or quotes around them still work.
const clean = (v) => String(v || '').trim().replace(/^['"]|['"]$/g, '').trim();
const KEY = () => clean(env.ELEVENLABS_API_KEY);
const VOICE = () => clean(env.ELEVENLABS_VOICE_ID);
export const enabled = () => Boolean(KEY() && VOICE() && env.CARETAKER_VOICE !== 'live');
let lastError = null; // what ElevenLabs said the last time it refused (shown on the host page)
const model = () => clean(env.ELEVENLABS_MODEL) || 'eleven_v4';
const FALLBACK_MODEL = 'eleven_multilingual_v2';
const fileFor = (text) => `${crypto.createHash('sha256').update(JSON.stringify([VOICE(), model(), text])).digest('hex').slice(0, 24)}.mp3`;
export const servedFile = (name) => (/^[0-9a-f]{24}\.mp3$/.test(name) && fs.existsSync(path.join(DIR, name)) ? path.join(DIR, name) : null);

const inFlight = new Map();
// One clip, generated at most once (concurrent requests share the same generation).
function clip(text) {
  const name = fileFor(text);
  const file = path.join(DIR, name);
  const url = `/assets/voice/${name}`;
  if (fs.existsSync(file)) return Promise.resolve(url);
  if (inFlight.has(name)) return inFlight.get(name);
  const job = (async () => {
    const say = async (modelId, words) => fetch(`${env.ELEVENLABS_BASE_URL || 'https://api.elevenlabs.io'}/v1/text-to-speech/${encodeURIComponent(VOICE())}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': KEY(), 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({ text: words, model_id: modelId }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    let res = await say(model(), text);
    // A model this account can't use: try the standard one (it would read [delivery tags] aloud, so drop them).
    if ([400, 422].includes(res.status) && model() !== FALLBACK_MODEL) res = await say(FALLBACK_MODEL, spoken(text));
    if (!res.ok) {
      const detail = await res.json().then((j) => j.detail?.message || j.detail?.status || j.detail || j.message).catch(() => '');
      lastError = { status: res.status, message: String(detail || '').slice(0, 200), at: new Date().toISOString() };
      throw new Error(`elevenlabs_${res.status}${detail ? `: ${lastError.message}` : ''}`);
    }
    lastError = null;
    const buf = Buffer.from(await res.arrayBuffer());
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(`${file}.tmp`, buf);
    fs.renameSync(`${file}.tmp`, file);
    ledger.event('tts_generated', { provider: 'elevenlabs', model: model(), characters: spoken(text).length });
    return url;
  })().finally(() => inFlight.delete(name));
  inFlight.set(name, job);
  return job;
}

// What the Caretaker says on this player's nth call (0-based): the riddle first, then a new hint each time.
export function script(callIndex, name) {
  const hints = LINES.hints;
  const body = callIndex === 0 ? [LINES.riddle, hints[0]] : [hints[callIndex % hints.length]];
  return [greeting(name), ...body, LINES.fading];
}

// The recorded call for this player, or null (then the call goes live). `character` is caretaker or caretaker_reveal.
export async function recordedCall(character, player, callIndex = 0) {
  if (!enabled()) return null;
  let lines = character === 'caretaker_reveal' ? [LINES.reveal] : script(callIndex, player.name);
  try {
    // The player's name is the only line made on the fly. If it can't be made (no credits left, a hiccup), he skips
    // it and plays his recorded lines anyway, rather than switching to a different (paid, live) voice.
    const named = lines[0] === greeting(player.name);
    if (named) {
      const hello = await clip(lines[0]).catch((err) => { console.warn('[caretaker] name clip unavailable, skipping it:', err.message); return null; });
      if (!hello) lines = lines.slice(1);
    }
    const audio = await Promise.all(lines.map(clip));
    return { audio, captions: lines.map(spoken) };
  } catch (err) {
    console.error('[caretaker] recording unavailable, going live:', err.message);
    ledger.event('tts_failed', { provider: 'elevenlabs', error: String(err.message).slice(0, 60) });
    return null;
  }
}

// Start generating while the phone rings, so answering doesn't wait. Errors surface on answer.
export function prepare(character, player, callIndex = 0) {
  if (enabled()) recordedCall(character, player, callIndex).catch(() => {});
}

// Every fixed line (riddle, hints, sign-off, reveal), generated at startup so the Caretaker is in the narrator's voice
// from the first call of the night and never has to fall back to a different voice mid-game. Names are made as rings go.
const FIXED = () => [LINES.riddle, ...LINES.hints, LINES.fading, LINES.reveal];
export async function warmUp({ attempts = 3 } = {}) {
  if (!enabled()) return;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const results = await Promise.allSettled(FIXED().map(clip));
    const failed = results.filter((r) => r.status === 'rejected');
    if (!failed.length) { console.log(`[caretaker] narrator voice ready (${results.length} lines)`); return; }
    console.error(`[caretaker] ${failed.length} line(s) not generated yet (${failed[0].reason?.message}); attempt ${attempt} of ${attempts}`);
    if (attempt < attempts) await new Promise((r) => setTimeout(r, attempt * 5000));
  }
}
// For the host page: is the Caretaker on the narrator's voice, and are his lines ready?
const HINTS = {
  401: 'ElevenLabs rejected the API key: check ELEVENLABS_API_KEY, and that the key has Text to Speech access.',
  402: 'ElevenLabs needs a paid plan or more credits for this voice (library voices can’t be used through the API on the free plan).',
  403: 'The API key isn’t allowed to use Text to Speech or this voice: check the key’s permissions.',
  404: 'ElevenLabs doesn’t know that voice ID: check ELEVENLABS_VOICE_ID (and add the voice to “My Voices”).',
  422: 'ElevenLabs refused the request (often the model or voice ID).',
  429: 'ElevenLabs is rate-limiting or out of quota; it will retry.',
};
// For the host page: is the Caretaker on the narrator's voice, are his lines ready, and if not, why?
export function voiceStatus() {
  if (!enabled()) {
    const reason = env.CARETAKER_VOICE === 'live' ? 'CARETAKER_VOICE=live' : !KEY() && !VOICE() ? 'ElevenLabs keys not set'
      : !KEY() ? 'ELEVENLABS_API_KEY not set' : 'ELEVENLABS_VOICE_ID not set';
    return { mode: 'live', reason };
  }
  const lines = FIXED();
  return {
    mode: 'narrator', voice: `…${VOICE().slice(-4)}`, model: model(),
    ready: lines.filter((t) => fs.existsSync(path.join(DIR, fileFor(t)))).length, total: lines.length,
    error: lastError ? { ...lastError, hint: HINTS[lastError.status] || 'ElevenLabs refused the request.' } : null,
  };
}
