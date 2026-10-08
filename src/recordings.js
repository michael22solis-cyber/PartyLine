// Evidence recordings the game plays: the anonymous 911 call and Ruth's voicemail (Dana's memo ships with the game).
// Files in public/audio/ are built in. Missing ones can be made once on the server with the host's "Make the
// recordings" button: scripts/evidence-audio.js voices them with OpenAI text-to-speech (about 1 cent in total) and
// mixes the phone line with ffmpeg, saving to the data volume. Never automatic; one run at a time.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { dataFile } from './paths.js';

export const MADE_DIR = dataFile('audio');
const BUILT_IN = path.resolve('public/audio');
const PIECES = { 'call911.mp3': 'call911', 'ruth-voicemail.mp3': 'voicemail' };

export const madeFile = (file) => (PIECES[file] && fs.existsSync(path.join(MADE_DIR, file)) ? path.join(MADE_DIR, file) : null);
const where = (file) => (fs.existsSync(path.join(BUILT_IN, file)) ? 'built-in' : madeFile(file) ? 'made' : null);
const urlOf = (file) => (where(file) === 'built-in' ? `/assets/audio/${file}` : where(file) === 'made' ? `/assets/made/${file}` : null);

let running = null;
let lastError = null;

function run(only) {
  return new Promise((resolve, reject) => {
    const args = ['scripts/evidence-audio.js', `--only=${only}`, ...(process.env.EVIDENCE_FAKE === '1' ? ['--fake'] : [])]; // fake: beeps, for tests
    const child = spawn(process.execPath, args, {
      env: { ...process.env, EVIDENCE_OUT: MADE_DIR, EVIDENCE_WORK: dataFile('audio-src') }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let err = '';
    child.stdout.on('data', (d) => console.log(`[recordings] ${String(d).trim()}`));
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.trim().split('\n').pop() || `exit ${code}`))));
  });
}

// remake: replace recordings made here before (e.g. after the script's lines improved). Built-in files are never touched.
export function makeRecordings({ remake = false } = {}) {
  if (remake && !running) for (const file of Object.keys(PIECES)) { const f = madeFile(file); if (f) fs.rmSync(f); }
  running ||= (async () => {
    lastError = null;
    for (const [file, only] of Object.entries(PIECES)) {
      if (where(file)) continue;
      try { await run(only); } catch (e) { lastError = String(e.message).slice(0, 200); console.error('[recordings]', lastError); }
    }
  })().finally(() => { running = null; });
  return running;
}

export function recordingsStatus() {
  const files = Object.keys(PIECES).map((file) => ({ name: file, where: where(file), url: urlOf(file) }));
  return { files, missing: files.filter((f) => !f.where).length, made: files.filter((f) => f.where === 'made').length, working: Boolean(running), error: lastError, canMake: Boolean(process.env.OPENAI_API_KEY) };
}
