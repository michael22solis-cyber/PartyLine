// Makes the audio evidence: Dana's voice memo, the anonymous 911 call, and Ruth's voicemail.
// Voices come from OpenAI text-to-speech (same OPENAI_API_KEY as the game); the humming, footsteps,
// crash, phone line and dial tone are generated here, then everything is mixed with ffmpeg.
//   npm run evidence            -> public/audio/memo.mp3, call911.mp3, ruth-voicemail.mp3
//   npm run evidence -- --fake  -> same files with beeps instead of voices (to test without a key)
//   npm run evidence -- --only=memo   (or call911, voicemail, reveal) -> remake just one recording
//   npm run evidence -- --force       -> ignore the cache and regenerate every voice line
// Voice lines are cached by content (model + voice + text + acting notes) in audio-src/.tts-cache.json, so re-running
// only pays for lines you changed. Each generated line is recorded in the usage ledger as one-time asset spend.
//
// EDITING: change any line's words, voice or acting notes ("how") in LINES below.
// Voices: alloy, ash, ballad, coral, echo, fable, nova, onyx, sage, shimmer, verse.
// REPLACE ANY PIECE WITH A REAL RECORDING: put a file in audio-src/custom/ named after the piece
// (dana1, dana2, hum, steps, crash, dispatch1, lily, dispatch2, vmIntro, ruth) as .wav, .mp3 or .m4a.
// Example: record a friend humming a lullaby on their phone, save it as audio-src/custom/hum.m4a.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import ffmpeg from 'ffmpeg-static';
import { ledger } from '../src/ai/ledger.js';

const FAKE = process.argv.includes('--fake');
const FORCE = process.argv.includes('--force');
const { OPENAI_API_KEY, OPENAI_BASE_URL = 'https://api.openai.com/v1', OPENAI_TTS_MODEL = 'gpt-4o-mini-tts' } = process.env;
if (!FAKE && !OPENAI_API_KEY) { console.error('Add OPENAI_API_KEY to .env first (or run with --fake).'); process.exit(1); }

const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7);
const SR = 24000;
const WORK = path.resolve('audio-src');
const OUT = path.resolve('public/audio');
fs.mkdirSync(WORK, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

// ---------- voices ----------
const LINES = {
  dana1: { voice: 'coral', text: "Okay, note to self. So the crew comes Monday, and they start on the cellar floor first. The whole slab comes up. Remind Marcus about the—",
    how: 'A tired woman in her forties recording a casual voice memo to herself late at night in an empty old house. Natural, a little echoey, unhurried.' },
  dana2: { voice: 'coral', text: "Hello? ...Who's there? ...Ma'am?",
    how: 'Suddenly frightened, quiet, uncertain. Long pauses between each word, like she is peering down dark stairs.' },
  dispatch1: { voice: 'onyx', text: "Nine-one-one, what's the address of your emergency?",
    how: 'A calm, professional emergency dispatcher on a phone line.' },
  lily: { voice: 'marin', fallbackVoice: 'shimmer', text: "There's... there's someone at the bottom of the stairs. At Blackwood. The old manor on Crane Road. I think... I think she's dead.",
    how: 'A woman crying and panicking, whispering, breath shaking, trying not to be heard. Breaks off between phrases.' },
  dispatch2: { voice: 'onyx', text: "Ma'am, can I get your name? Ma'am? Are you still there?",
    how: 'A calm dispatcher becoming concerned as the caller goes silent.' },
  vmIntro: { voice: 'alloy', text: 'First new message. Received Friday, at ten thirty-one P M.',
    how: 'A flat automated voicemail system voice.' },
  ruth: { voice: 'sage', text: "Sweetheart, it's Ruth. I heard you've been asking about the cellar. Some doors in that house are better left closed. You get some rest now. God bless.",
    how: 'A sweet elderly woman leaving a voicemail, warm and grandmotherly on the surface, with something cold and threatening underneath. Slow.' },
  // The midnight reveal is fully scripted, so every player hears a recording instead of a live model call.
  // Tip: drop the intro narrator's version in audio-src/custom/caretakerReveal.mp3 to match the intro's voice.
  caretakerReveal: { voice: 'cedar', fallbackVoice: 'onyx', text: "Thirty years I've waited under that floor. ... She sang my wife to sleep, and then she buried me. ... Ruth Calloway. ... Dana was going to find me, so Ruth made sure she never reached the bottom of the stairs alive. ... Thank you for listening. ... Happy Halloween.",
    how: 'A very old man, the ghost of the house, speaking slowly and quietly from far away on a bad phone line. Weary, then at peace. Long pauses.' },
};

const CUSTOM = path.join(WORK, 'custom');
function custom(name) {
  for (const ext of ['wav', 'mp3', 'm4a', 'ogg', 'aac']) {
    const f = path.join(CUSTOM, `${name}.${ext}`);
    if (fs.existsSync(f)) { console.log(`using your recording: audio-src/custom/${name}.${ext}`); return f; }
  }
  return null;
}

const CACHE_FILE = path.join(WORK, '.tts-cache.json');
const cache = (() => { try { return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch { return {}; } })();
const keyOf = (model, voice, text, how) => crypto.createHash('sha256').update(JSON.stringify([model, voice, text, how])).digest('hex').slice(0, 16);

async function tts(name, { voice, fallbackVoice, text, how }) {
  const own = custom(name); if (own) return own;
  const file = path.join(WORK, `${name}.wav`);
  if (FAKE) { writeWav(file, tone(1.2 + text.length / 22, 300 + name.length * 40)); return file; }
  const hit = cache[name];
  if (!FORCE && hit && fs.existsSync(file) && hit.key === keyOf(hit.model, hit.voice, text, how)) { console.log(`voice: ${name} (cached, no API call)`); return file; }
  for (const [model, v] of [[OPENAI_TTS_MODEL, voice], [OPENAI_TTS_MODEL, fallbackVoice], ['tts-1', fallbackVoice || voice]]) {
    if (!v) continue;
    const res = await fetch(`${OPENAI_BASE_URL}/audio/speech`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, voice: v, input: text, response_format: 'wav', ...(model === 'tts-1' ? {} : { instructions: how }) }),
    });
    if (res.ok) {
      fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      cache[name] = { key: keyOf(model, v, text, how), model, voice: v };
      fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
      // One-time asset spend, estimated from the audio length (the speech endpoint returns no usage block).
      const secs = seconds(file);
      ledger.record({ responseId: res.headers.get('x-request-id') || undefined, model, capability: 'tts', purpose: `asset:${name}`, source: 'script',
        usage: { textIn: Math.ceil((text.length + how.length) / 4), audioOut: Math.round(secs * 20.8) } });
      console.log(`voice: ${name}`);
      return file;
    }
    const body = await res.text();
    if (res.status === 401) throw new Error('OpenAI 401: check OPENAI_API_KEY in .env');
    if (![400, 404].includes(res.status)) throw new Error(`OpenAI ${res.status}: ${body.slice(0, 200)}`);
  }
  throw new Error(`No text-to-speech model worked for ${name}`);
}

// ---------- sound effects (synthesized) ----------
function writeWav(file, samples) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + samples.length * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((v, i) => buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(v * 32767))), 44 + i * 2));
  fs.writeFileSync(file, buf);
  return file;
}
const len = (sec) => new Float32Array(Math.round(sec * SR));
const rand = (() => { let x = 7; return () => ((x = (x * 16807) % 2147483647) / 2147483647) * 2 - 1; })();
function tone(sec, f) { const a = len(sec); for (let i = 0; i < a.length; i++) a[i] = 0.2 * Math.sin((2 * Math.PI * f * i) / SR); return a; }

// A woman humming Brahms' Lullaby (public domain), soft and far away.
function hum() {
  const notes = [[64, 0.5], [64, 0.5], [67, 1.5], [64, 0.5], [64, 0.5], [67, 1.5], [64, 0.5], [67, 0.5], [72, 1], [71, 1.0], [69, 1], [69, 0.5], [67, 1.5]];
  const beat = 0.5;
  const total = notes.reduce((s, [, d]) => s + d * beat * 2, 0) + 1;
  const a = len(total);
  let t0 = 0;
  for (const [midi, d] of notes) {
    const f = 440 * 2 ** ((midi - 69) / 12) / 2; // an octave down: a low female hum
    const dur = d * beat * 2;
    const n0 = Math.round(t0 * SR), n = Math.round(dur * SR);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const vib = 1 + 0.006 * Math.sin(2 * Math.PI * 5.2 * t);
      const env = Math.min(1, t / 0.08) * Math.min(1, (dur - t) / 0.15);
      let v = 0;
      for (const [h, amp] of [[1, 1], [2, 0.45], [3, 0.18], [4, 0.08]]) v += amp * Math.sin(2 * Math.PI * f * h * vib * (t0 + t));
      a[n0 + i] += 0.16 * env * v + 0.004 * rand() * env;
    }
    t0 += dur;
  }
  return a;
}
function footsteps(count, gap) {
  const a = len(count * gap + 0.6);
  for (let k = 0; k < count; k++) {
    const n0 = Math.round(k * gap * SR);
    for (let i = 0; i < SR * 0.25; i++) {
      const t = i / SR;
      a[n0 + i] += 0.5 * Math.exp(-t / 0.035) * Math.sin(2 * Math.PI * (70 - 40 * t) * t) + 0.08 * Math.exp(-t / 0.01) * rand();
    }
    if (k % 2) for (let i = 0; i < SR * 0.4; i++) { const t = i / SR; a[n0 + i] += 0.03 * Math.sin(2 * Math.PI * (380 + 60 * Math.sin(t * 9)) * t) * Math.exp(-t / 0.15); } // stair creak
  }
  return a;
}
function crash() {
  const a = len(2.2);
  const hits = [[0, 1], [0.18, 0.7], [0.42, 0.55], [0.7, 0.35]];
  for (const [at, g] of hits) {
    const n0 = Math.round(at * SR);
    for (let i = 0; i < SR * 0.6; i++) {
      const t = i / SR;
      a[n0 + i] += g * (0.55 * Math.exp(-t / 0.08) * Math.sin(2 * Math.PI * (55 - 25 * t) * t) + 0.25 * Math.exp(-t / 0.03) * rand());
    }
  }
  return a;
}
function roomTone(sec, amt = 0.012) { const a = len(sec); let b = 0; for (let i = 0; i < a.length; i++) { b = 0.97 * b + 0.03 * rand(); a[i] = amt * b * 4; } return a; }
function dialTone(sec) { const a = len(sec); for (let i = 0; i < a.length; i++) { const t = i / SR; a[i] = 0.12 * (Math.sin(2 * Math.PI * 350 * t) + Math.sin(2 * Math.PI * 440 * t)); } return a; }
function beep(sec = 0.45) { const a = len(sec); for (let i = 0; i < a.length; i++) a[i] = 0.25 * Math.sin((2 * Math.PI * 1000 * i) / SR) * Math.min(1, (a.length - i) / 400); return a; }
function click() { const a = len(0.08); for (let i = 0; i < a.length; i++) a[i] = 0.5 * Math.exp(-i / 120) * rand(); return a; }

// ---------- mixing ----------
function seconds(file) {
  try { execFileSync(ffmpeg, ['-hide_banner', '-i', file], { stdio: ['ignore', 'ignore', 'pipe'] }); } catch (e) {
    const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(e.stderr?.toString() || '');
    if (m) return +m[1] * 3600 + +m[2] * 60 + +m[3];
  }
  return 0;
}
// parts: [{ file, at, filter }] -> one mp3
function mix(outName, parts, total, master = '') {
  const args = ['-y', '-loglevel', 'error'];
  parts.forEach((p) => args.push('-i', p.file));
  const chains = parts.map((p, i) => `[${i}:a]aresample=${SR},${p.filter ? `${p.filter},` : ''}adelay=${Math.round(p.at * 1000)}:all=1[p${i}]`);
  const inputs = parts.map((_, i) => `[p${i}]`).join('');
  const graph = `${chains.join(';')};${inputs}amix=inputs=${parts.length}:normalize=0:duration=longest,atrim=0:${total.toFixed(2)}${master ? `,${master}` : ''},afade=t=out:st=${(total - 0.4).toFixed(2)}:d=0.4,loudnorm=I=-18:TP=-1.5[out]`;
  args.push('-filter_complex', graph, '-map', '[out]', '-ac', '1', '-ar', '44100', '-b:a', '96k', path.join(OUT, outName));
  execFileSync(ffmpeg, args);
  console.log(`made public/audio/${outName} (${total.toFixed(1)} s)`);
}

const sfx = (name, samples) => custom(name) || writeWav(path.join(WORK, `${name}.wav`), samples);
const PHONE = 'highpass=f=320,lowpass=f=3300,acompressor=threshold=-20dB:ratio=4,volume=1.4';
const MEMO_ROOM = 'aecho=0.8:0.6:35|70:0.25|0.15';

const NEEDS = { memo: ['dana1', 'dana2'], call911: ['dispatch1', 'lily', 'dispatch2'], voicemail: ['vmIntro', 'ruth'], reveal: ['caretakerReveal'] };
const want = (k) => !ONLY || ONLY === k;
fs.mkdirSync(CUSTOM, { recursive: true });
const v = {};
for (const [name, line] of Object.entries(LINES)) {
  const OUTS = { memo: 'memo-final.mp3', call911: 'call911-final.mp3', voicemail: 'ruth-voicemail-final.mp3', reveal: 'caretaker-reveal-final.mp3' };
  if (Object.entries(NEEDS).some(([k, names]) => want(k) && !fs.existsSync(path.join(CUSTOM, OUTS[k])) && names.includes(name))) v[name] = await tts(name, line);
}

// A finished recording in audio-src/custom/<name>-final.mp3 is used as-is (e.g. a memo mixed by hand).
function finished(outName) {
  const f = path.join(CUSTOM, outName.replace('.mp3', '-final.mp3'));
  if (!fs.existsSync(f)) return false;
  fs.copyFileSync(f, path.join(OUT, outName));
  console.log(`using your finished ${outName} (audio-src/custom/${path.basename(f)})`);
  return true;
}

// 1) Dana's voice memo
if (want('memo') && !finished('memo.mp3')) {
  const d1 = seconds(v.dana1), d2 = seconds(v.dana2);
  const humAt = 0.4 + d1 - 1.5;
  const stepsAt = humAt + 3.2;
  const dana2At = stepsAt + 3.0;
  const crashAt = dana2At + d2 + 0.5;
  const total = crashAt + 3.0;
  mix('memo.mp3', [
    { file: sfx('room', roomTone(total + 1)), at: 0 },
    { file: v.dana1, at: 0.4, filter: MEMO_ROOM },
    { file: sfx('hum', hum()), at: humAt, filter: 'lowpass=f=1800,aecho=0.8:0.85:120|240:0.4|0.25,volume=0.55,afade=t=in:d=2.5' },
    { file: sfx('steps', footsteps(5, 0.62)), at: stepsAt, filter: 'lowpass=f=2500,volume=0.8' },
    { file: v.dana2, at: dana2At, filter: `${MEMO_ROOM},volume=0.9` },
    { file: sfx('crash', crash()), at: crashAt },
  ], total);
}

// 2) The anonymous 911 call
if (want('call911') && !finished('call911.mp3')) {
  const a = seconds(v.dispatch1), b = seconds(v.lily), c = seconds(v.dispatch2);
  const lilyAt = 0.6 + a + 0.6;
  const d2At = lilyAt + b + 1.4;
  const clickAt = d2At + c + 0.3;
  const total = clickAt + 2.6;
  mix('call911.mp3', [
    { file: sfx('line', roomTone(total + 1, 0.02)), at: 0, filter: PHONE },
    { file: v.dispatch1, at: 0.6, filter: PHONE },
    { file: v.lily, at: lilyAt, filter: `${PHONE},volume=0.85` },
    { file: v.dispatch2, at: d2At, filter: PHONE },
    { file: sfx('click', click()), at: clickAt },
    { file: sfx('dial', dialTone(2.4)), at: clickAt + 0.15, filter: `${PHONE},volume=0.5` },
  ], total);
}

// 3) Ruth's voicemail
if (want('voicemail') && !finished('ruth-voicemail.mp3')) {
  const a = seconds(v.vmIntro), r = seconds(v.ruth);
  const beepAt = 0.3 + a + 0.4;
  const total = beepAt + 0.7 + r + 1.2;
  mix('ruth-voicemail.mp3', [
    { file: v.vmIntro, at: 0.3, filter: 'lowpass=f=5000' },
    { file: sfx('beep', beep()), at: beepAt },
    { file: sfx('vline', roomTone(total + 1, 0.015)), at: beepAt + 0.5, filter: PHONE },
    { file: v.ruth, at: beepAt + 0.7, filter: PHONE },
  ], total);
}

// 4) The Caretaker's midnight reveal (played as a recorded call; see CHARACTERS.caretaker_reveal.recording)
if (want('reveal') && !finished('caretaker-reveal.mp3')) {
  const r = seconds(v.caretakerReveal);
  const total = 0.8 + r + 1.6;
  mix('caretaker-reveal.mp3', [
    { file: sfx('rline', roomTone(total + 1, 0.02)), at: 0, filter: PHONE },
    { file: v.caretakerReveal, at: 0.8, filter: `${PHONE},aecho=0.8:0.7:60:0.25,volume=0.95` },
  ], total);
}

await ledger.close();
console.log('\nDone. Restart the server; the memo, 911 call, voicemail and midnight reveal now play in the app.');
