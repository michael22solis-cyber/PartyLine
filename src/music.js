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
export const PHASE_TRACK = { before: 'early', early: 'early', late: 'late', deep: 'deep', final: 'final', after: 'after' };

export const enabled = () => Boolean(env.ELEVENLABS_API_KEY && env.MUSIC !== 'off');
const fileFor = (name) => `${name}-${crypto.createHash('sha256').update(JSON.stringify([TRACKS[name], LENGTH_MS])).digest('hex').slice(0, 12)}.mp3`;
const pathFor = (name) => path.join(DIR, fileFor(name));
export const servedFile = (file) => (/^[a-z]+-[0-9a-f]{12}\.mp3$/.test(file) && fs.existsSync(path.join(DIR, file)) ? path.join(DIR, file) : null);

// Tracks the phone can play now: { early: '/assets/music/…', … } (missing ones are left out).
export function trackUrls() {
  if (!enabled()) return {};
  return Object.fromEntries(Object.keys(TRACKS).filter((n) => fs.existsSync(pathFor(n))).map((n) => [n, `/assets/music/${fileFor(n)}`]));
}

async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'xi-api-key': env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) throw Object.assign(new Error(`elevenlabs_${res.status}`), { status: res.status });
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
  for (const name of Object.keys(TRACKS)) {
    if (fs.existsSync(pathFor(name))) continue;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try { await make(name); console.log(`[music] ${name} track ready`); break; }
      catch (err) { console.error(`[music] ${name} track failed (${err.message}), attempt ${attempt} of 2`); }
    }
  }
}

export function musicStatus() {
  if (!enabled()) return { mode: 'off', reason: env.MUSIC === 'off' ? 'MUSIC=off' : 'ElevenLabs key not set' };
  return { mode: 'on', ready: Object.keys(trackUrls()).length, total: Object.keys(TRACKS).length };
}
