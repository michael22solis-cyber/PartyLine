// Shared memory across all characters and players (the "magic" moment: Ruth knows what you told the Caretaker).
// Demo version: a JSON file, kept in memory and written in the background. In production, move this to a table.
//
// Each line records who said what to whom, on which channel, plus deterministic tags (accusation, contradiction,
// evidence, promise, lie, disclosure) so long conversations can be compacted without a model call while keeping the
// things later dialogue depends on.
import fs from 'node:fs';
import path from 'node:path';
import { dataFile } from './paths.js';
import { KEY_BY_NAME } from './characters/index.js';
import { TOPICS, MENTIONS } from './secrets.js';

const FILE = dataFile('memory.json');
const MAX_TEXT = 600;

let lines = load();
const itemIds = new Set(lines.map((l) => l.itemId).filter(Boolean));
let saveTimer = null;

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8')).lines || [];
    // Older files have no npc key or tags; fill them in.
    return raw.map((l) => ({ ...l, npc: l.npc || KEY_BY_NAME[l.character] || null, tags: l.tags || tagLine(l) }));
  } catch {
    return [];
  }
}

function writeNow() {
  saveTimer = null;
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    const tmp = `${FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ lines }));
    fs.renameSync(tmp, FILE);
  } catch (err) {
    console.error('[memory] save failed:', err.message);
  }
}
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(writeNow, 250);
  saveTimer.unref?.();
}
export function flushMemory() { if (saveTimer) { clearTimeout(saveTimer); writeNow(); } }
process.on('exit', flushMemory);

// ---------- tagging ----------
const SUSPECT = '(ruth|marcus|lily|teddy|she|he|her|him|you|u)';
const RE = {
  accusation: new RegExp(`\\b(killer|murderer|liar)\\b|\\bit was (you|her|him|ruth|marcus|lily|teddy)\\b|\\b${SUSPECT}\\b.{0,30}\\b(killed|murdered|pushed|did it|(is|are|was|were|been) lying|lied|guilty|buried)\\b|\\bi know (what )?you did\\b`, 'i'),
  contradiction: /\b(but|yet) you (said|told|claimed)|you (said|told me|claimed) .{0,60}\b(but|yet)\b|that'?s not what you|doesn'?t add up|contradict|you just said|caught you|lying about/i,
  evidence: /receipt|9:31|8:30|7:10|11:12|11:02|livestream|replay|voice ?memo|voicemail|\b911\b|neighbo|contract|statement|planted|\bmud\b|speaker/i,
  promise: /\b(i promise|i swear|you have my word|our (little )?secret|i won'?t tell|i'?ll (tell|call|find|bring|keep|help|come|make sure|be there|protect|get)|i will (tell|call|find|bring|keep|help|protect))\b/i,
};
// Known cover stories: when a suspect repeats one, remember that they told this player that version.
const COVER = {
  marcus: /6:30|six[- ]thirty/i,
  ruth: /bingo.{0,40}(10|ten)|barely knew|ran off|running off/i,
  lily: /(wasn'?t|was not|never went|didn'?t go|nowhere near).{0,30}(manor|there|house)/i,
};

export function tagLine({ speaker, text, npc, character }) {
  const t = String(text || '');
  const key = npc || KEY_BY_NAME[character];
  const tags = [];
  if (speaker === 'player') {
    if (RE.accusation.test(t)) tags.push('accusation');
    if (RE.contradiction.test(t)) tags.push('contradiction');
    if (RE.evidence.test(t)) tags.push('evidence');
  } else {
    if (COVER[key]?.test(t)) tags.push('lie');
    if (TOPICS.some((s) => s.who === key && s.test(t))) tags.push('disclosure');
  }
  if (RE.promise.test(t)) tags.push('promise');
  return tags;
}

// ---------- writing ----------
// channel: 'text' | 'call' | 'group' | 'overheard'. itemId (optional) dedupes retried call transcripts.
export function remember({ player, pid = null, npc = null, character, speaker, text, channel = null, itemId = null, at = null }) {
  const clean = String(text || '').trim();
  if (!clean) return null;
  if (itemId) {
    if (itemIds.has(itemId)) return null;
    itemIds.add(itemId);
  }
  const key = npc || KEY_BY_NAME[character] || null;
  const line = {
    at: at || new Date().toISOString(),
    player, pid, npc: key, character, speaker, channel,
    text: clean.slice(0, MAX_TEXT),
    ...(itemId ? { itemId } : {}),
  };
  line.tags = tagLine(line);
  lines.push(line);
  save();
  return line;
}

export const allLines = () => lines;
export function resetMemory() {
  lines = [];
  itemIds.clear();
  clearTimeout(saveTimer);
  saveTimer = null;
  fs.rmSync(FILE, { force: true });
}

// The original prompt summary: the latest lines from everyone, oldest first. Used by the legacy prompts and beats.
export function summary(limit = 40) {
  return lines
    .slice(-limit)
    .map((l) => `- ${l.speaker === 'player' ? l.player : l.character} (talking ${l.speaker === 'player' ? 'to ' + l.character : 'to ' + l.player}): ${l.text}`)
    .join('\n');
}

// ---------- reading: compact, relevant memory for one character talking to one player ----------
const estTokens = (s) => Math.ceil(String(s).length / 3.8);
const ago = (at, now) => {
  const m = Math.max(0, Math.round((now - Date.parse(at)) / 60_000));
  return m < 2 ? 'just now' : m < 90 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
};
const clip = (s, n = 150) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const first = (name) => String(name || 'someone').split(' ')[0];
const TAG_WEIGHT = { accusation: 5, contradiction: 5, disclosure: 4, lie: 4, promise: 4, evidence: 3 };
const weight = (l) => (l.tags || []).reduce((s, t) => s + (TAG_WEIGHT[t] || 0), 0);

/**
 * Notes for `npc` talking to player `pid`, most important first, within `budgetTokens`.
 * - skipChannel / skipSince: lines the caller already sends verbatim (e.g. the recent text thread).
 * Never includes what OTHER characters told other players (their confessions stay with whoever earned them).
 */
export function memoryNotes({ npc, pid, playerName, budgetTokens = 220, skipChannel = null, skipSince = null, now = Date.now() }) {
  const name = first(playerName);
  const where = (l) => (l.channel === 'group' ? 'the group chat' : first(l.character));
  // Score one line for this conversation, or skip it (null).
  const note = (l, age) => {
    const mine = l.npc === npc && l.pid === pid;
    if (mine) {
      if (skipChannel && l.channel === skipChannel && (!skipSince || l.at >= skipSince)) return null; // already verbatim
      // This character's own past exchanges with this player (calls, older texts): what was said, claimed, promised.
      const who = l.speaker === 'player' ? name : 'you';
      return { score: 20 + weight(l) * 3 - age * 0.05, text: `- ${who} (${l.channel || 'earlier'}, ${ago(l.at, now)}): "${clip(l.text)}"` };
    }
    if (l.npc === npc && l.speaker === 'player') {
      // Other players who contacted this character.
      return { score: 6 + weight(l) * 2 - age * 0.05, text: `- ${first(l.player)} told you (${ago(l.at, now)}): "${clip(l.text, 110)}"` };
    }
    if (l.npc === npc && weight(l) && !l.tags.includes('disclosure')) {
      // Lies and promises this character made to others keep their story straight. Disclosures stay with whoever earned them.
      return { score: 4 + weight(l) - age * 0.05, text: `- you told ${first(l.player)} (${ago(l.at, now)}): "${clip(l.text, 110)}"` };
    }
    if (l.speaker === 'player' && l.pid === pid && l.npc !== npc) {
      // What this player said to other characters: the house is listening.
      return { score: 5 + weight(l) * 2 - age * 0.05, text: `- ${name} told ${where(l)} (${ago(l.at, now)}): "${clip(l.text, 110)}"` };
    }
    if (l.speaker === 'player' && l.npc !== npc && l.tags.includes('accusation') && MENTIONS[npc]?.test(l.text)) {
      // Other players accusing this character behind their back.
      return { score: 4 + weight(l) - age * 0.05, text: `- ${first(l.player)} told ${where(l)} (${ago(l.at, now)}): "${clip(l.text, 110)}"` };
    }
    return null;
  };
  const pick = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const n = note(lines[i], lines.length - i);
    if (n) pick.push({ ...n, i });
  }
  pick.sort((a, b) => b.score - a.score);
  const out = [];
  const seenText = new Set(); // the same accusation five times is one memory, not five
  let used = 0;
  for (const p of pick) {
    const key = p.text.replace(/\(([^)]*)\)/, '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ');
    if (seenText.has(key)) continue;
    seenText.add(key);
    const t = estTokens(p.text) + 1;
    if (used + t > budgetTokens) continue;
    out.push(p);
    used += t;
    if (out.length >= 10) break;
  }
  out.sort((a, b) => a.i - b.i); // read oldest first
  return { notes: out.map((p) => p.text), tokens: used, considered: pick.length };
}
