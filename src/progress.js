// How the story opens up for each player: which suspects they can reach, which secrets they've found,
// and characters ringing them inside the app.
import fs from 'node:fs';
import path from 'node:path';
import { players, playerByToken, updatePlayer } from './store.js';
import { deliver, emit } from './live.js';
import { notify } from './push.js';
import { CHARACTERS, TEXTABLE } from './characters/index.js';
import { SECRETS, MENTIONS } from './secrets.js';
import { callPhone } from './phone.js';
import { mayAward } from './disclosure.js';
import { prepare as prepareCaretaker } from './voice/caretaker.js';
import { statusOf } from './cast.js';
import { onSecretFound } from './initiative.js';
import { checkAgenda } from './agenda.js';
import { overBudget } from './budget.js';

const { UNLOCK_ALL, CALL_MODE = 'app' } = process.env; // CALL_MODE=phone uses real Twilio calls when a player has a number

// ---------- contacts ----------
export const unlockedFor = (p) => (UNLOCK_ALL === '1' ? TEXTABLE.map((t) => t.key) : p.unlocked || []);
export const isUnlocked = (p, key) => unlockedFor(p).includes(key);

export async function unlock(p, key, reason = '') {
  if (!MENTIONS[key] || isUnlocked(p, key)) return false;
  updatePlayer(p.token, { unlocked: [...(p.unlocked || []), key] });
  const t = TEXTABLE.find((x) => x.key === key);
  emit(p.token, 'unlock', { ...t, status: statusOf(key) });
  await deliver({ token: p.token, thread: 'line', from: 'system', kind: 'contact',
    text: `NEW CONTACT: ${t.name}, ${t.tagline}.${reason ? ` ${reason}` : ''}` });
  await checkAgenda(p).catch((err) => console.error('[agenda]', err.message)); // a mission about them may unseal
  return true;
}

// Anyone named in something the player said, heard, or read gets added to their phone.
export async function unlockMentions(p, text) {
  for (const [key, re] of Object.entries(MENTIONS)) if (re.test(text || '')) await unlock(p, key);
}

export async function unlockAll(reason) {
  for (const p of players()) for (const t of TEXTABLE) await unlock(p, t.key, reason);
}

// ---------- secrets ----------
// A secret becomes evidence when the character actually says it AND the engine had approved that disclosure for this
// player (or, in a group chat, for the conversation: `approved`). Each card is awarded once.
// Heard on a call counts for more (see recap.js), and some secrets only come out on a call.
export async function checkSecrets(p, characterKey, text, { approved = [], channel = 'text' } = {}) {
  for (const s of SECRETS) {
    const fresh = playerByToken(p.token) || p;
    if (s.who !== characterKey || (fresh.found || []).includes(s.id) || !s.test(text || '')) continue;
    if (!mayAward(fresh, characterKey, s.id, approved, channel)) continue;
    const onCall = channel === 'call';
    updatePlayer(p.token, { found: [...(fresh.found || []), s.id], ...(onCall ? { foundOnCall: [...(fresh.foundOnCall || []), s.id] } : {}) });
    await deliver({ token: p.token, thread: characterKey, from: 'system', kind: 'evidence',
      text: `SECRET UNCOVERED${onCall ? ' · HEARD ON A CALL' : ''}\n${s.card}` });
    onSecretFound(p, characterKey);
  }
}

// Called for everything a character says to a player (texts and call transcripts).
export async function onCharacterSaid(p, characterKey, text, opts = {}) {
  await checkSecrets(p, characterKey, text, opts);
  await unlockMentions(p, text);
}

// ---------- in-app calls ----------
const ringing = new Map(); // token -> { character, opening, until, onMissed }

export function pendingRing(token) {
  const r = ringing.get(token);
  return r && r.until > Date.now() ? r : null;
}
export function answerRing(token) {
  const r = pendingRing(token);
  if (r) { clearTimeout(r.timer); ringing.delete(token); }
  return r;
}

const AUDIO_DIR = path.resolve('public/audio');
export const audioIf = (file) => (fs.existsSync(path.join(AUDIO_DIR, file)) ? `/assets/audio/${file}` : null);

// Ring a player's Blackwood phone. If they don't pick up in 40 s it becomes a missed call (or a voicemail).
// `onMissed`: what happens if they don't pick up (besides the missed call), e.g. the caller giving up on them.
export async function ringInApp(p, character, { opening, voicemail, onMissed } = {}) {
  const c = CHARACTERS[character];
  const from = character.startsWith('caretaker') ? 'BLACKWOOD MANOR' : c.name.toUpperCase();
  // Over this game's budget (budget.js): suspects don't place live calls anymore; it goes straight to voicemail or a
  // missed call, so nobody answers into a dead line. The Caretaker's calls are recordings and still ring.
  if (!character.startsWith('caretaker') && overBudget()) {
    if (voicemail) await deliver({ token: p.token, thread: 'unknown', from: 'character', kind: 'voicemail', text: voicemail.text, audio: voicemail.audio, npc: character });
    else await deliver({ token: p.token, thread: 'unknown', from: 'system', kind: 'missed', text: `Missed call: ${from}`, npc: character });
    if (onMissed) await onMissed().catch(() => {});
    return;
  }
  const ringMs = Number(process.env.RING_TIMEOUT_MS || 40_000);
  const r = { character, opening, until: Date.now() + ringMs };
  r.timer = setTimeout(async () => {
    if (ringing.get(p.token) !== r) return;
    ringing.delete(p.token);
    emit(p.token, 'ringEnd', { character });
    if (voicemail) await deliver({ token: p.token, thread: 'unknown', from: 'character', kind: 'voicemail', text: voicemail.text, audio: voicemail.audio, npc: character });
    else await deliver({ token: p.token, thread: 'unknown', from: 'system', kind: 'missed', text: `Missed call: ${from}`, npc: character });
    if (onMissed) await onMissed().catch((err) => console.error('[ring] after missed call:', err.message));
  }, ringMs);
  ringing.set(p.token, r);
  if (character.startsWith('caretaker')) prepareCaretaker(character, p, character === 'caretaker' ? p.caretakerCalls || 0 : 0);
  emit(p.token, 'incoming', { character, from });
  await notify(p.token, { title: 'Incoming call', body: from, thread: 'unknown' });
}

// Real phone call (Twilio) when CALL_MODE=phone and the player gave a number; otherwise ring the app.
export async function callPlayer(p, character, options = {}) {
  if (p.callsOff) return 'off';
  if (CALL_MODE === 'phone' && p.phone) {
    await callPhone(p.phone, p.name, character, p.pid);
    await deliver({ token: p.token, thread: 'unknown', from: 'system', kind: 'call', text: 'Incoming call — Blackwood Manor' });
    return 'phone';
  }
  await ringInApp(p, character, options);
  return 'app';
}
