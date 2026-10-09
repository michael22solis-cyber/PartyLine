// Where game data lives: DATA_DIR (a persistent volume on a host), or BLACKWOOD_DATA_DIR for tests and simulations.
import path from 'node:path';
import fs from 'node:fs';

export const DATA_DIR = path.resolve(process.env.BLACKWOOD_DATA_DIR || process.env.DATA_DIR || 'data');
export const dataFile = (name) => path.join(DATA_DIR, name);
// Audio built into the game (committed to the repo). BUILTIN_AUDIO_DIR lets tests use a private folder.
export const BUILTIN_AUDIO = () => path.resolve(process.env.BUILTIN_AUDIO_DIR || 'public/audio');

// When this data folder was first used. If it changes after every deploy, the host has no persistent volume at
// DATA_DIR, so generated audio (and paid ElevenLabs credits) is thrown away and remade each time.
export function dataSince() {
  const marker = dataFile('.created');
  try { return { since: fs.readFileSync(marker, 'utf8').trim(), fresh: false }; } catch { /* first use */ }
  const since = new Date().toISOString();
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(marker, since); } catch { /* read-only: fine */ }
  return { since, fresh: true };
}
