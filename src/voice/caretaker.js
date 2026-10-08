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

export const enabled = () => Boolean(env.ELEVENLABS_API_KEY && env.ELEVENLABS_VOICE_ID && env.CARETAKER_VOICE !== 'live');
const model = () => env.ELEVENLABS_MODEL || 'eleven_v4';
const fileFor = (text) => `${crypto.createHash('sha256').update(JSON.stringify([env.ELEVENLABS_VOICE_ID, model(), text])).digest('hex').slice(0, 24)}.mp3`;
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
    const res = await fetch(`${env.ELEVENLABS_BASE_URL || 'https://api.elevenlabs.io'}/v1/text-to-speech/${env.ELEVENLABS_VOICE_ID}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({ text, model_id: model() }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`elevenlabs_${res.status}`);
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
  const lines = character === 'caretaker_reveal' ? [LINES.reveal] : script(callIndex, player.name);
  try {
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
export async function warmUp() {
  if (!enabled()) return;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const results = await Promise.allSettled(FIXED().map(clip));
    const failed = results.filter((r) => r.status === 'rejected');
    if (!failed.length) { console.log(`[caretaker] narrator voice ready (${results.length} lines)`); return; }
    console.error(`[caretaker] ${failed.length} line(s) not generated yet (${failed[0].reason?.message}); attempt ${attempt} of 3`);
    await new Promise((r) => setTimeout(r, attempt * 5000));
  }
}
// For the host page: is the Caretaker on the narrator's voice, and are his lines ready?
export function voiceStatus() {
  if (!enabled()) return { mode: 'live', reason: env.CARETAKER_VOICE === 'live' ? 'CARETAKER_VOICE=live' : 'ElevenLabs keys not set' };
  const lines = FIXED();
  return { mode: 'narrator', voice: `…${String(env.ELEVENLABS_VOICE_ID).slice(-4)}`, model: model(), ready: lines.filter((t) => fs.existsSync(path.join(DIR, fileFor(t)))).length, total: lines.length };
}
