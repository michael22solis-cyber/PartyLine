// Live voice calls on the server: leases (one call per player, a global cap, expiry), and the hooks every transport
// shares (transcripts into memory, disclosures, usage into the ledger).
import crypto from 'node:crypto';
import { CHARACTERS } from '../characters/index.js';
import { ledger } from '../ai/ledger.js';
import { fromRealtimeResponse, fromTranscription } from '../ai/usage.js';
import { BusyError } from '../ai/limiter.js';
import { remember } from '../memory.js';
import { unlockMentions, onCharacterSaid } from '../progress.js';
import { approveFromPlayerText, requestDisclosure } from '../disclosure.js';
import { approvalNote } from '../context.js';
import { transcribeModel } from './session.js';

const env = process.env;
const maxConcurrent = () => Number(env.MAX_CONCURRENT_CALLS || 25);
const calls = new Map(); // callId -> call
const byPlayer = new Map(); // player token -> callId

export function openCall({ player, npc, transport, timing, model }) {
  // One live call per player: a new call supersedes the old one (double tap, second tab, reconnect).
  const prev = byPlayer.get(player.token);
  if (prev) closeCall(prev, 'superseded');
  if (calls.size >= maxConcurrent()) throw new BusyError('All lines are busy. Try again in a minute, or send a text.');
  const call = {
    id: `call_${crypto.randomBytes(8).toString('hex')}`,
    token: player.token, pid: player.pid, npc, transport, model,
    startedAt: Date.now(),
    leaseUntil: Date.now() + ((timing?.maxSeconds || 240) + 60) * 1000,
    playerText: [], responses: 0, onClose: [], closed: false,
  };
  calls.set(call.id, call);
  byPlayer.set(player.token, call.id);
  ledger.event('call_started', { session: player.pid, callId: call.id, npc, transport, model });
  return call;
}

export const getCall = (token, callId) => {
  const c = calls.get(String(callId || ''));
  return c && c.token === token ? c : null;
};
export const activeCalls = () => calls.size;

export function closeCall(callId, reason, { seconds } = {}) {
  const call = calls.get(callId);
  if (!call || call.closed) return null;
  call.closed = true;
  calls.delete(callId);
  if (byPlayer.get(call.token) === callId) byPlayer.delete(call.token);
  for (const fn of call.onClose) {
    try { fn(reason); } catch (err) { console.error('[call] cleanup failed:', err.message); }
  }
  ledger.event('call_ended', {
    session: call.pid, callId, npc: call.npc, transport: call.transport, reason,
    seconds: seconds ?? Math.round((Date.now() - call.startedAt) / 1000), responses: call.responses,
  });
  return call;
}

// Abandoned calls (the page vanished without saying goodbye) are released when their lease runs out.
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const c of [...calls.values()]) if (c.leaseUntil < now) closeCall(c.id, 'lease_expired');
}, 15_000);
sweeper.unref?.();

// ---------- hooks shared by WebRTC (browser-reported), sideband and Twilio ----------
export async function callTranscript(call, player, speaker, text, { itemId = null } = {}) {
  const c = CHARACTERS[call.npc];
  const clean = String(text || '').trim().slice(0, 1000);
  if (!clean || !c) return { notes: [] };
  const line = remember({
    player: player.name, pid: player.pid, npc: call.npc, character: c.name,
    speaker: speaker === 'player' ? 'player' : 'character', text: clean, channel: 'call',
    itemId: itemId ? `${call.id}:${String(itemId).slice(0, 80)}` : null,
  });
  if (!line) return { notes: [], duplicate: true };
  if (!player.token) return { notes: [] }; // a caller we don't know: memory only
  if (speaker === 'player') {
    call.playerText.push(clean);
    if (call.playerText.length > 6) call.playerText.shift();
    await unlockMentions(player, clean);
    const approved = approveFromPlayerText(player, call.npc, clean, 'call');
    return { notes: approved.map((t) => approvalNote(player, t)) };
  }
  if (c.textable) await onCharacterSaid(player, call.npc, clean, { channel: 'call' });
  return { notes: [] };
}

export function callDisclose(call, player, topic, recent = '') {
  if (!player.token) return { decision: 'stay_guarded', note: 'Stay in character.' };
  return requestDisclosure(player, call.npc, String(topic || ''), [String(recent || '').slice(0, 600), ...call.playerText.slice(-3)].join(' / '));
}

const ID = /^[\w.-]{1,100}$/;
export function callUsage(call, rec, source) {
  if (!rec || !ID.test(String(rec.responseId || ''))) return false;
  const base = { responseId: rec.responseId, source, session: call.pid, npc: call.npc, callId: call.id };
  if (rec.kind === 'transcription') {
    const { usage, quality } = fromTranscription(rec.usage || {});
    return ledger.record({ ...base, model: transcribeModel(), usage, usageQuality: quality, capability: 'transcription' }).recorded;
  }
  const { usage, quality } = fromRealtimeResponse(rec.usage || {});
  const r = ledger.record({
    ...base, model: call.model, usage, usageQuality: quality, capability: 'voice',
    purpose: ['opening', 'reply', 'tool_followup', 'wrap_up'].includes(rec.purpose) ? rec.purpose : 'reply',
    status: ['completed', 'cancelled', 'incomplete', 'failed'].includes(rec.status) ? rec.status : 'completed',
    statusReason: rec.statusReason, firstAudioMs: rec.firstAudioMs, audioGeneratedMs: rec.audioGeneratedMs, audioPlayedMs: rec.audioPlayedMs,
  });
  if (r.recorded) call.responses += 1;
  return r.recorded;
}
