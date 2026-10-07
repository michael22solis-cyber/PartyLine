// Shared memory across all characters and players (the "magic" moment).
// Demo version: a JSON file. In production, move this to a Supabase table.
import fs from 'node:fs';
import path from 'node:path';

import { dataFile } from './env.js';
const FILE = dataFile('memory.json');

function load() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return { lines: [] };
  }
}

function save(db) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(db, null, 2));
}

export function remember({ player, character, speaker, text }) {
  if (!text || !text.trim()) return;
  const db = load();
  db.lines.push({ at: new Date().toISOString(), player, character, speaker, text: text.trim() });
  save(db);
}

// A compact summary for prompts: the latest lines, oldest first.
export function summary(limit = 40) {
  const { lines } = load();
  return lines
    .slice(-limit)
    .map((l) => `- ${l.speaker === 'player' ? l.player : l.character} (talking ${l.speaker === 'player' ? 'to ' + l.character : 'to ' + l.player}): ${l.text}`)
    .join('\n');
}
