// Background music for the burner phone, composed by ElevenLabs Music and getting creepier as the night goes on.
// One track per stretch of the story; each is generated once (when the server starts and the ElevenLabs key is set),
// cached on the data volume, and reused by every game. The phone crossfades to the next track as the story moves and
// warps it more and more (see public/app.js). If the music API isn't available on the plan, a looping sound-effects
// ambience is made instead. MUSIC=off disables it.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { dataFile } from './paths.js';
import { ledger } from './ai/ledger.js';

const env = process.env;
const DIR = dataFile('music');
const BASE = () => env.ELEVENLABS_BASE_URL || 'https://api.elevenlabs.io';
const LENGTH_MS = 60_000;

// Story phase (cast.js) -> track. Each one is stranger than the last.
export const TRACKS = {
  early: 'Instrumental, quiet and unsettling. A slightly out-of-tune music box plays a slow lullaby in a minor key, far away in an empty house. Soft low drone, distant wind, long silences. Sparse, eerie, never loud.',
  late: 'Instrumental, creepier. The music box lullaby slows down and drifts out of tune, as if the spring is winding down. Low cello drone, faint creaking wood, breathy pads that sound almost like whispers. Dissonant, sparse, cold.',
  deep: 'Instrumental, deeply unsettling and strange. Broken, warped lullaby fragments played backwards, detuned piano notes, slow string glissandos sliding out of tune, a faint irregular heartbeat, tape warble. Weird, haunted, disorienting.',
  final: 'Instrumental, dread. A low pulsing drone that slowly rises, a ticking clock, a heartbeat getting faster, distorted fragments of a lullaby, dissonant strings swelling, bursts of static. Tense and claustrophobic, building, never resolving.',
  after: 'Instrumental, quiet aftermath. Soft rain, a music box playing the lullaby one last time, slowing to a stop. Melancholy and still.',
};
const FALLBACK = { // sound-effects ambience if the music API isn't on the plan (30 s, seamless loop)
  early: 'eerie ambient drone in an empty old house, distant wind, faint out of tune music box, seamless loop',
  late: 'creepy ambient drone, creaking floorboards, faint whispers, slow detuned music box, seamless loop',
  deep: 'unsettling horror ambience, reversed piano, detuned strings, faint heartbeat, tape warble, seamless loop',
  final: 'horror tension drone, ticking clock, fast heartbeat, rising dissonant strings, static bursts, seamless loop',
  after: 'soft rain, slow music box winding down, quiet melancholy ambience, seamless loop',
};
// What you hear behind each character on a call (20 s seamless loops, played quietly under their voice). Ruth's has
// the hum: a clue for players who listen.
export const BEDS = {
  ruth: 'quiet old living room at night, a grandfather clock ticking, an old woman faintly humming a slow lullaby in the next room, seamless loop',
  lily: 'small-town diner in the background, plates and cutlery clinking, a fryer sizzling, low murmur of a few customers, seamless loop',
  marcus: 'inside a car at night, engine idling, light rain on the windshield, a turn signal clicking now and then, seamless loop',
  teddy: 'cramped apartment, computer fans humming, soft livestream chat notification pings every few seconds, distant city traffic, seamless loop',
};
export const PHASE_TRACK = { before: 'early', early: 'early', late: 'late', deep: 'deep', final: 'final', after: 'after' };

const KEY = () => String(env.ELEVENLABS_API_KEY || '').trim().replace(/^['"]|['"]$/g, '').trim();
export const enabled = () => Boolean(KEY() && env.MUSIC !== 'off');
let lastError = null;
const fileFor = (name) => `${name}-${crypto.createHash('sha256').update(JSON.stringify([TRACKS[name], LENGTH_MS])).digest('hex').slice(0, 12)}.mp3`;
const pathFor = (name) => path.join(DIR, fileFor(name));
const bedFile = (npc) => `bed-${crypto.createHash('sha256').update(BEDS[npc]).digest('hex').slice(0, 12)}.mp3`;
export const servedFile = (file) => (/^[a-z]+-[0-9a-f]{12}\.mp3$/.test(file) && fs.existsSync(path.join(DIR, file)) ? path.join(DIR, file) : null);

// Tracks the phone can play now: { early: '/assets/music/…', … } (missing ones are left out).
export function trackUrls() {
  if (!enabled()) return {};
  return Object.fromEntries(Object.keys(TRACKS).filter((n) => fs.existsSync(pathFor(n))).map((n) => [n, `/assets/music/${fileFor(n)}`]));
}

// Background sounds for calls that are ready: { ruth: '/assets/music/bed-…', … }.
export function bedUrls() {
  if (!enabled()) return {};
  return Object.fromEntries(Object.keys(BEDS).filter((n) => fs.existsSync(path.join(DIR, bedFile(n)))).map((n) => [n, `/assets/music/${bedFile(n)}`]));
}

async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'xi-api-key': KEY(), 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) {
    const detail = await res.json().then((j) => j.detail?.message || j.detail?.status || j.detail || j.message).catch(() => '');
    throw Object.assign(new Error(`elevenlabs_${res.status}${detail ? `: ${String(detail).slice(0, 200)}` : ''}`), { status: res.status });
  }
  return Buffer.from(await res.arrayBuffer());
}

let musicApi = true; // flips off after the music API refuses (plan), so the rest use the sound-effects fallback
async function make(name) {
  let audio;
  if (musicApi) {
    try {
      audio = await post(`${BASE()}/v1/music?output_format=mp3_44100_128`, { prompt: TRACKS[name], music_length_ms: LENGTH_MS, force_instrumental: true });
    } catch (err) {
      if (![400, 401, 402, 403, 404, 422].includes(err.status)) throw err;
      console.warn(`[music] ElevenLabs Music unavailable (${err.message}); using looping ambience instead`);
      musicApi = false;
    }
  }
  if (!audio) audio = await post(`${BASE()}/v1/sound-generation?output_format=mp3_44100_128`, { text: FALLBACK[name], duration_seconds: 30, loop: true, prompt_influence: 0.5 });
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(`${pathFor(name)}.tmp`, audio);
  fs.renameSync(`${pathFor(name)}.tmp`, pathFor(name));
  ledger.event('music_generated', { provider: 'elevenlabs', track: name, kind: musicApi ? 'music' : 'sound_effect' });
}

// Make any missing tracks, one at a time, in story order (so the opening track is ready first).
export async function warmUp() {
  if (!enabled()) return;
  await warmUpBeds(); // the call backgrounds first: small, and heard from the first call
  for (const name of Object.keys(TRACKS)) {
    if (fs.existsSync(pathFor(name))) continue;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try { await make(name); lastError = null; console.log(`[music] ${name} track ready`); break; }
      catch (err) { lastError = err.message; console.error(`[music] ${name} track failed (${err.message}), attempt ${attempt} of 2`); }
    }
  }
}

async function makeBed(npc) {
  const audio = await post(`${BASE()}/v1/sound-generation?output_format=mp3_44100_128`, { text: BEDS[npc], duration_seconds: 20, loop: true, prompt_influence: 0.6 });
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(path.join(DIR, `${bedFile(npc)}.tmp`), audio);
  fs.renameSync(path.join(DIR, `${bedFile(npc)}.tmp`), path.join(DIR, bedFile(npc)));
  ledger.event('music_generated', { provider: 'elevenlabs', track: `bed:${npc}`, kind: 'sound_effect' });
}
export async function warmUpBeds() {
  if (!enabled()) return;
  for (const npc of Object.keys(BEDS)) {
    if (fs.existsSync(path.join(DIR, bedFile(npc)))) continue;
    try { await makeBed(npc); lastError = null; console.log(`[music] ${npc} call background ready`); }
    catch (err) { lastError = err.message; console.error(`[music] ${npc} call background failed (${err.message})`); }
  }
}

export function musicStatus() {
  if (!enabled()) return { mode: 'off', reason: env.MUSIC === 'off' ? 'MUSIC=off' : 'ElevenLabs key not set' };
  return { mode: 'on', ready: Object.keys(trackUrls()).length + Object.keys(bedUrls()).length, total: Object.keys(TRACKS).length + Object.keys(BEDS).length, error: lastError };
}
