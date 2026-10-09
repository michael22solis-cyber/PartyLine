// A hard daily cap on ElevenLabs text-to-speech the game itself may spend (the Caretaker's lines and players' names).
// ELEVENLABS_MAX_CHARS_PER_DAY (default 2000 characters, roughly 2000 credits; 0 = no ElevenLabs speech at all).
// Counted on the data volume, so restarts and redeploys can't reset it. Over the cap, no request is sent: the
// Caretaker skips a player's name, or plays whatever is already recorded.
import fs from 'node:fs';
import { dataFile } from './paths.js';

const FILE = dataFile('elevenlabs-spend.json');
const cap = () => Number(process.env.ELEVENLABS_MAX_CHARS_PER_DAY ?? 2000);
const today = () => new Date().toISOString().slice(0, 10);

function read() {
  try { const s = JSON.parse(fs.readFileSync(FILE, 'utf8')); if (s.day === today()) return s; } catch { /* first use */ }
  return { day: today(), chars: 0 };
}

// Reserve n characters; false if that would go over today's cap (then nothing is sent).
export function allowChars(n) {
  const s = read();
  if (s.chars + n > cap()) {
    console.warn(`[elevenlabs] daily cap reached (${s.chars}/${cap()} characters, ELEVENLABS_MAX_CHARS_PER_DAY): request skipped`);
    return false;
  }
  s.chars += n;
  try { fs.mkdirSync(dataFile(''), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(s)); } catch { /* read-only: count in memory only */ }
  return true;
}
export const elevenToday = () => ({ chars: read().chars, cap: cap() });
