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
// EVIDENCE_WORK / EVIDENCE_OUT: where the server's "Make the recordings" button works and saves (the data volume).
const WORK = path.resolve(process.env.EVIDENCE_WORK || 'audio-src');
const OUT = path.resolve(process.env.EVIDENCE_OUT || 'public/audio');
fs.mkdirSync(WORK, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

// ---------- voices ----------
const LINES = {
  dana1: { voice: 'coral', text: "Okay, note to self. So the crew comes Monday, and they start on the cellar floor first. The whole slab comes up. Remind Marcus about the—",
    how: 'A tired woman in her forties recording a casual voice memo to herself late at night in an empty old house. Natural, a little echoey, unhurried.' },
  dana2: { voice: 'coral', text: "Hello? ...Who's there? ...Ma'am?",
    how: 'Suddenly frightened, quiet, uncertain. Long pauses between each word, like she is peering down dark stairs.' },
  // The 911 call, in short pieces so the pauses, interruptions and overlaps land like a real recording.
  // Acting notes ask for a real person, not a performance: breaths, cracks, false starts, uneven pace.
  d911a: { voice: 'ash', fallbackVoice: 'onyx', text: "Nine-one-one, what's the address of your emergency?",
    how: 'A real night-shift 911 dispatcher, not an actor. Brisk, practiced, slightly fast and a little flat from saying it a thousand times. Natural, unpolished.' },
  l911a: { voice: 'marin', fallbackVoice: 'shimmer', text: "Hi— um. I— there's... there's someone. At the bottom of the stairs.",
    how: 'A real young woman, terrified, whispering into her phone so no one hears her. Out of breath, shaky inhales between fragments, voice catching, swallowing. Not acting: messy, uneven, trailing off.' },
  d911b: { voice: 'ash', fallbackVoice: 'onyx', text: "Okay. Ma'am, where are you right now?",
    how: 'The dispatcher shifts gears: calm, slower, firmer, leaning in. Real, not theatrical.' },
  l911b: { voice: 'marin', fallbackVoice: 'shimmer', text: "Blackwood. The old— the manor on Crane Road. She's not moving. She's... I think she's dead. Oh my god. Oh my god.",
    how: 'Crying now, panicking, words tumbling over each other, a sharp gasp, a sob breaking through on "oh my god". Still trying to whisper. A real person falling apart, not a performance.' },
  d911c: { voice: 'ash', fallbackVoice: 'onyx', text: "Okay, I need you to stay on the line with me. Is she breathing? Can you check if she's—",
    how: 'Urgent but controlled, quick, a real dispatcher talking someone through it. Gets cut off at the end.' },
  l911c: { voice: 'marin', fallbackVoice: 'shimmer', text: "I can't. I can't, I'm sorry. I'm so sorry.",
    how: 'Whispered through tears, getting quieter, already pulling the phone away from her face. Ragged breathing.' },
  d911d: { voice: 'ash', fallbackVoice: 'onyx', text: "Ma'am? Ma'am, can I get your name? ... Ma'am, are you still there?",
    how: 'Concerned, then quieter and slower, realizing the line is dead. Alone. Real, understated.' },
  // Ruth's voicemail: a sweet old lady who isn't great with voicemail, until she very much is.
  vmIntro: { voice: 'alloy', text: 'You have... one... new message. Received... Friday... at ten... thirty-one... P.M.',
    how: 'An old automated voicemail system: flat, robotic, evenly spaced words with odd gaps.' },
  ruth1: { voice: 'sage', text: "Oh— hello? Is it... oh, it's recording. Hello, sweetheart! It's Ruth. Ruth Calloway, from down the road.",
    how: 'A real elderly woman fumbling with a voicemail, unsure if it is recording, a little breathless, mouth close to the phone, then a warm chuckle and bright hello. Natural and imperfect, not an actress.' },
  ruth2: { voice: 'sage', text: "I heard you've been asking around... about the cellar.",
    how: 'Still warm, but slower now, the smile fading from her voice. A small pause in the middle, as if choosing her words.' },
  ruth3: { voice: 'sage', text: "Some doors in that house are better left closed, dear.",
    how: 'Very quiet and calm, close to the phone, all the warmth gone for a moment. Cold. No drama, just certain.' },
  ruth4: { voice: 'sage', text: "Anyway! You get some rest now. God bless.",
    how: 'Suddenly bright and cheerful again, a little too cheerful, a short laugh at the start. Then she fumbles for the button.' },
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
// The caller's side: wind and a big empty house behind her. Ruth's side: a clock ticking in a quiet room.
function wind(sec) { const a = len(sec); let b = 0, g = 0; for (let i = 0; i < a.length; i++) { b = 0.995 * b + 0.005 * rand(); g = 0.9995 * g + 0.0005 * Math.abs(rand()); a[i] = b * (6 + 30 * g); } return a; }
function ticks(sec) { const a = len(sec); for (let k = 0; k < sec; k++) { const n0 = Math.round((k + 0.3) * SR); for (let i = 0; i < 600 && n0 + i < a.length; i++) a[n0 + i] += (k % 2 ? 0.05 : 0.07) * Math.exp(-i / 90) * rand(); } return a; }
// Someone handling the phone: thumps and rustle.
function handling(sec = 1.2) { const a = len(sec); for (const at of [0.05, 0.3, 0.55, 0.9]) { const n0 = Math.round(at * SR); for (let i = 0; i < SR * 0.15 && n0 + i < a.length; i++) { const t = i / SR; a[n0 + i] += 0.25 * Math.exp(-t / 0.03) * Math.sin(2 * Math.PI * 90 * t) + 0.05 * Math.exp(-t / 0.05) * rand(); } } return a; }
// The line going dead after a hang-up: three fast busy tones.
function disconnect() { const a = len(1.6); for (let k = 0; k < 3; k++) for (let i = 0; i < SR * 0.25; i++) { const t = i / SR; a[Math.round(k * 0.5 * SR) + i] = 0.13 * (Math.sin(2 * Math.PI * 480 * t) + Math.sin(2 * Math.PI * 620 * t)); } return a; }
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
  console.log(`made ${path.join(OUT, outName)} (${total.toFixed(1)} s)`);
}

const sfx = (name, samples) => custom(name) || writeWav(path.join(WORK, `${name}.wav`), samples);
const PHONE = 'highpass=f=320,lowpass=f=3300,acompressor=threshold=-20dB:ratio=4,volume=1.4';
// A cheap cell phone held too close (the caller) vs. a dispatcher's headset; both through the recording system.
const CELL = 'highpass=f=420,lowpass=f=2900,acrusher=bits=10:mode=log:aa=1,acompressor=threshold=-24dB:ratio=6:attack=5,volume=1.6';
const HEADSET = 'highpass=f=260,lowpass=f=3600,acompressor=threshold=-20dB:ratio=3,volume=1.3';
const MEMO_ROOM = 'aecho=0.8:0.6:35|70:0.25|0.15';

const NEEDS = { memo: ['dana1', 'dana2'], call911: ['d911a', 'l911a', 'd911b', 'l911b', 'd911c', 'l911c', 'd911d'], voicemail: ['vmIntro', 'ruth1', 'ruth2', 'ruth3', 'ruth4'], reveal: ['caretakerReveal'] };
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

// 2) The anonymous 911 call: the dispatcher's recording. Pieces overlap a little, like real people talking over each
// other; the caller's line is rougher and has wind behind it; she hangs up, the line goes dead, the dispatcher keeps asking.
if (want('call911') && !finished('call911.mp3')) {
  const L = Object.fromEntries(['d911a', 'l911a', 'd911b', 'l911b', 'd911c', 'l911c', 'd911d'].map((k) => [k, seconds(v[k])]));
  const t = {};
  t.d911a = 0.7;
  t.l911a = t.d911a + L.d911a + 0.9; // she hesitates before speaking
  t.d911b = t.l911a + L.l911a + 0.35;
  t.l911b = t.d911b + L.d911b + 0.25;
  t.d911c = t.l911b + Math.max(0.5, L.l911b - 0.4); // the dispatcher starts before she's quite done
  t.l911c = t.d911c + Math.max(1.2, L.d911c - 0.7); // and she cuts him off
  const hangup = t.l911c + L.l911c + 0.2;
  t.d911d = hangup + 0.9;
  const total = t.d911d + L.d911d + 2.4;
  mix('call911.mp3', [
    { file: sfx('line', roomTone(total + 1, 0.02)), at: 0, filter: HEADSET },
    { file: sfx('wind', wind(hangup - t.l911a + 1)), at: Math.max(0, t.l911a - 0.6), filter: `lowpass=f=900,${CELL},volume=0.35` },
    { file: v.d911a, at: t.d911a, filter: HEADSET },
    { file: v.l911a, at: t.l911a, filter: `${CELL},volume=0.9` },
    { file: v.d911b, at: t.d911b, filter: HEADSET },
    { file: v.l911b, at: t.l911b, filter: CELL },
    { file: v.d911c, at: t.d911c, filter: `${HEADSET},afade=t=out:st=${Math.max(0.5, L.d911c - 1.1).toFixed(2)}:d=0.5` },
    { file: v.l911c, at: t.l911c, filter: `${CELL},afade=t=out:st=${Math.max(0.3, L.l911c - 1.2).toFixed(2)}:d=1.1,volume=0.85` },
    { file: sfx('click', click()), at: hangup },
    { file: sfx('dead', disconnect()), at: hangup + 0.25, filter: `${HEADSET},volume=0.35` },
    { file: v.d911d, at: t.d911d, filter: `${HEADSET},volume=0.9` },
  ], total);
}

// 3) Ruth's voicemail: the system intro, the beep, then Ruth in her quiet living room (a clock ticking), fumbling
// with the phone at both ends.
if (want('voicemail') && !finished('ruth-voicemail.mp3')) {
  const L = Object.fromEntries(['vmIntro', 'ruth1', 'ruth2', 'ruth3', 'ruth4'].map((k) => [k, seconds(v[k])]));
  const beepAt = 0.3 + L.vmIntro + 0.4;
  const t1 = beepAt + 1.3; // a second of rustling before she realizes it's recording
  const t2 = t1 + L.ruth1 + 0.7;
  const t3 = t2 + L.ruth2 + 1.1; // a long pause before the warning
  const t4 = t3 + L.ruth3 + 0.9;
  const end = t4 + L.ruth4 + 0.2;
  const total = end + 2.0;
  mix('ruth-voicemail.mp3', [
    { file: v.vmIntro, at: 0.3, filter: 'lowpass=f=5000' },
    { file: sfx('beep', beep()), at: beepAt },
    { file: sfx('vline', roomTone(total + 1, 0.015)), at: beepAt + 0.5, filter: PHONE },
    { file: sfx('ticks', ticks(end - beepAt + 1)), at: beepAt + 0.5, filter: `${PHONE},volume=0.5` },
    { file: sfx('fumble1', handling()), at: beepAt + 0.4, filter: `${PHONE},volume=0.8` },
    { file: v.ruth1, at: t1, filter: PHONE },
    { file: v.ruth2, at: t2, filter: PHONE },
    { file: v.ruth3, at: t3, filter: `${PHONE},volume=0.95` },
    { file: v.ruth4, at: t4, filter: PHONE },
    { file: sfx('fumble2', handling()), at: end, filter: `${PHONE},volume=0.9` },
    { file: sfx('vclick', click()), at: end + 1.2 },
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
