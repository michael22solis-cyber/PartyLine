// The burner-phone web app: player API, live updates, admin controls and the beat scheduler.
import fs from 'node:fs';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import {
  addPlayer, players, playerByToken, updatePlayer, messagesFor, castVote, votes,
  savePushSub, addScheduled, scheduled, markScheduledDone, getDb, resetGame,
} from './store.js';
import { TEXTABLE, CHARACTERS } from './characters/index.js';
import { remember, resetMemory } from './memory.js';
import { unlockedFor, isUnlocked, answerRing, pendingRing, onCharacterSaid, unlockMentions, audioIf } from './progress.js';
import { deliver } from './live.js';
import { sendPeer } from './crew.js';
import { createGroup, groupsForPlayer } from './groups.js';
import { handlePlayerText } from './chat.js';
import { subscribe } from './live.js';
import { vapidPublicKey } from './push.js';
import { runBeat, SUSPECTS, tallyVotes, BEATS } from './beats.js';
import { recapFor } from './recap.js';
import { ledger, readLedgerFile } from './ai/ledger.js';
import { buildReport } from './ai/report.js';
import { BusyError } from './ai/limiter.js';
import { callTiming, openingItem, realtimeModel } from './voice/session.js';
import { mintClientSecret, createSidebandCall } from './voice/realtime-api.js';
import { attachSideband } from './voice/sideband.js';
import { openCall, getCall, closeCall, callTranscript, callUsage, callDisclose } from './voice/calls.js';

const {
  ADMIN_KEY, PUBLIC_HOST, OPENAI_API_KEY,
  OPENAI_BASE_URL = 'https://api.openai.com/v1',
  MAX_CALLS_PER_PLAYER = 30,
} = process.env;
const callCounts = new Map();
const SHARED_DIR = path.resolve('src/shared');
const PUBLIC_DIR = path.resolve('public');
const APP_HTML = () => fs.readFileSync(path.join(PUBLIC_DIR, 'app.html'), 'utf8');

function requirePlayer(req, reply) {
  const p = playerByToken(req.params.token);
  if (!p) { reply.code(404).send({ error: 'This line is disconnected.' }); return null; }
  return p;
}

function requireAdmin(req, reply) {
  if (!ADMIN_KEY || req.headers['x-admin-key'] !== ADMIN_KEY) {
    reply.code(401).send({ error: 'Admin key required' });
    return false;
  }
  return true;
}

const linkFor = (token) => `https://${PUBLIC_HOST || 'localhost:5050'}/p/${token}`;

export function registerWeb(app) {
  app.register(fastifyStatic, { root: PUBLIC_DIR, prefix: '/assets/' });

  // ---------- player pages ----------
  app.get('/p/:token', (req, reply) => {
    if (!playerByToken(req.params.token)) return reply.code(404).type('text/html').send('<h1>This line is disconnected.</h1>');
    reply.type('text/html').send(APP_HTML());
  });

  // Service worker at the root so it can control /p/* pages.
  app.get('/sw.js', (_req, reply) => {
    reply.type('application/javascript').header('Cache-Control', 'no-cache')
      .send(fs.readFileSync(path.join(PUBLIC_DIR, 'sw.js'), 'utf8'));
  });

  // Per-player manifest so "Add to Home Screen" opens THEIR phone.
  app.get('/manifest/:token.webmanifest', (req, reply) => {
    const p = playerByToken(req.params.token);
    if (!p) return reply.code(404).send();
    reply.type('application/manifest+json').send({
      name: 'Blackwood Line',
      short_name: 'Blackwood',
      start_url: `/p/${p.token}`,
      scope: '/',
      display: 'standalone',
      background_color: '#07090a',
      theme_color: '#07090a',
      icons: [{ src: '/assets/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
    });
  });

  // ---------- player API ----------
  app.get('/api/p/:token/state', (req, reply) => {
    const p = requirePlayer(req, reply); if (!p) return;
    reply.send({
      me: { pid: p.pid, name: p.name, role: p.role, assigned: Boolean(p.clue), callsOff: p.callsOff, hasPhone: Boolean(p.phone) },
      threads: TEXTABLE.filter((t) => unlockedFor(p).includes(t.key)),
      ringing: pendingRing(p.token) ? { character: pendingRing(p.token).character } : null,
      messages: messagesFor(p.token),
      suspects: SUSPECTS,
      players: players().map((x) => x.name),
      groups: groupsForPlayer(p),
      peers: players().filter((x) => x.token !== p.token).map((x) => ({ pid: x.pid, name: x.name })),
      vote: votes()[p.token] || null,
      revealed: getDb().revealed,
      vapidPublicKey,
    });
  });

  app.get('/api/p/:token/stream', (req, reply) => {
    const p = requirePlayer(req, reply); if (!p) return;
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.write(': connected\n\n');
    const unsubscribe = subscribe(p.token, reply.raw);
    const ping = setInterval(() => reply.raw.write(': ping\n\n'), 25_000);
    req.raw.on('close', () => { clearInterval(ping); unsubscribe(); });
  });

  app.post('/api/p/:token/messages', async (req, reply) => {
    const p = requirePlayer(req, reply); if (!p) return;
    try {
      const msg = await handlePlayerText(p, req.body?.thread, req.body?.text, { clientId: req.body?.clientId });
      reply.send(msg);
    } catch (err) {
      reply.code(err.status || 500).send({ error: err.message });
    }
  });

  app.get('/api/p/:token/recap', (req, reply) => {
    const p = requirePlayer(req, reply); if (!p) return;
    if (!getDb().revealed) return reply.code(403).send({ error: 'The case is still open.' });
    reply.send(recapFor(p));
  });

  app.post('/api/p/:token/groups', async (req, reply) => {
    const p = requirePlayer(req, reply); if (!p) return;
    try { reply.send(await createGroup(p, req.body || {})); }
    catch (err) { reply.code(err.status || 500).send({ error: err.message }); }
  });

  app.post('/api/p/:token/peer', async (req, reply) => {
    const p = requirePlayer(req, reply); if (!p) return;
    try {
      reply.send(await sendPeer(p, req.body?.to, { text: req.body?.text, forward: req.body?.forward }));
    } catch (err) {
      reply.code(err.status || 500).send({ error: err.message });
    }
  });

  // ---------- in-app voice calls (browser <-> OpenAI Realtime over WebRTC) ----------
  // The call controller runs in the browser too: same module, served as-is.
  app.get('/assets/shared/call-controller.js', (_req, reply) => {
    reply.type('application/javascript').header('Cache-Control', 'no-cache')
      .send(fs.readFileSync(path.join(SHARED_DIR, 'call-controller.js'), 'utf8'));
  });
  app.addContentTypeParser('application/sdp', { parseAs: 'string' }, (_req, body, done) => done(null, body));

  // Start a call. Default transport: a short-lived key so the phone talks to OpenAI directly (the permanent key stays
  // here). REALTIME_TRANSPORT=sideband: the phone sends its SDP to us and the server controls the call.
  app.post('/api/p/:token/call', async (req, reply) => {
    const p = requirePlayer(req, reply); if (!p) return;
    const character = String(req.body?.character || '');
    const c = CHARACTERS[character];
    if (!c) return reply.code(400).send({ error: 'Unknown number.' });
    const ring = pendingRing(p.token);
    const answering = ring && ring.character === character;
    if (!answering && !(c.textable && isUnlocked(p, character))) return reply.code(403).send({ error: 'This number cannot be reached.' });
    const n = (callCounts.get(p.token) || 0) + 1;
    if (n > Number(MAX_CALLS_PER_PLAYER)) return reply.code(429).send({ error: 'The line is dead for tonight.' });
    const timing = callTiming(character);

    // Scripted calls (the midnight reveal) play a finished recording: no live model, no cost.
    const recording = c.recording && process.env.REVEAL_MODE !== 'live' ? audioIf(c.recording) : null;
    if (recording) {
      if (answering) answerRing(p.token);
      callCounts.set(p.token, n);
      ledger.event('call_started', { session: p.pid, npc: character, transport: 'recording' });
      if (c.revealText) remember({ player: p.name, pid: p.pid, npc: character, character: c.name, speaker: 'character', text: c.revealText, channel: 'call' });
      return reply.send({ mode: 'recording', audio: recording, name: c.name, maxSeconds: timing.maxSeconds });
    }

    if (!OPENAI_API_KEY) return reply.code(500).send({ error: 'Calls are not set up on this server.' });
    const opening = openingItem((answering && ring.opening) || (answering
      ? c.opening(p.name)
      : `${p.name} has just called you. Answer the phone in character, like you were not expecting a call.`));
    const transport = process.env.REALTIME_TRANSPORT === 'sideband' ? 'sideband' : 'ephemeral';
    let call;
    try {
      call = openCall({ player: p, npc: character, transport, timing, model: realtimeModel(character) });
    } catch (err) {
      if (err instanceof BusyError) return reply.code(503).send({ error: err.message });
      throw err;
    }
    try {
      const base = { callId: call.id, transport, opening: opening.text, openingRole: opening.role, name: c.name, maxSeconds: timing.maxSeconds, timing };
      let out;
      if (transport === 'sideband') {
        call.pending = { opening, timing };
        out = { ...base, serverControlled: true };
      } else {
        const minted = await mintClientSecret({ npc: character, player: p });
        call.model = minted.built.model;
        out = { ...base, key: minted.key, url: `${OPENAI_BASE_URL}/realtime/calls`, toolName: minted.built.toolName };
      }
      if (answering) answerRing(p.token);
      callCounts.set(p.token, n);
      reply.send(out);
    } catch (err) {
      closeCall(call.id, 'connect_failed');
      console.error(`[call ${character}] could not start:`, err.message);
      reply.code(502).send({ error: 'The call didn’t connect. Try again.' });
    }
  });

  // Sideband transport: the phone's WebRTC offer comes here; we open the call at OpenAI and keep a control socket.
  app.post('/api/p/:token/call/:callId/sdp', async (req, reply) => {
    const p = requirePlayer(req, reply); if (!p) return;
    const call = getCall(p.token, req.params.callId);
    if (!call?.pending || typeof req.body !== 'string') return reply.code(404).send({ error: 'That call has ended.' });
    const { opening, timing } = call.pending;
    call.pending = null;
    try {
      const made = await createSidebandCall({ npc: call.npc, player: p, sdp: req.body });
      call.model = made.built.model;
      attachSideband(call, p, { openaiCallId: made.openaiCallId, opening, toolName: made.built.toolName, timing });
      reply.type('application/sdp').send(made.answer);
    } catch (err) {
      closeCall(call.id, 'connect_failed');
      console.error(`[call ${call.npc}] sideband connect failed:`, err.message);
      reply.code(502).send({ error: 'The call didn’t connect. Try again.' });
    }
  });

  // What was said on an in-app call goes into the shared memory (so other characters know). Retries are deduped by
  // item id. A player line may earn a disclosure: the notes go back to the phone, which tells the character.
  app.post('/api/p/:token/call/transcript', async (req, reply) => {
    const p = requirePlayer(req, reply); if (!p) return;
    const { callId, character, speaker, text, itemId } = req.body || {};
    const call = getCall(p.token, callId);
    if (call) return reply.send(await callTranscript(call, p, speaker, text, { itemId }));
    // Older pages (no call id): the original behavior.
    const c = CHARACTERS[character];
    const clean = String(text || '').trim().slice(0, 1000);
    if (!c || !clean) return reply.send({ ok: true });
    remember({ player: p.name, pid: p.pid, npc: character, character: c.name, speaker: speaker === 'player' ? 'player' : 'character', text: clean, channel: 'call' });
    if (speaker === 'player') await unlockMentions(p, clean);
    else if (c.textable) await onCharacterSaid(p, character, clean);
    reply.send({ ok: true });
  });

  // Usage the phone saw on its data channel (response.done, transcription). Deduplicated by response id.
  app.post('/api/p/:token/call/usage', (req, reply) => {
    const p = requirePlayer(req, reply); if (!p) return;
    const call = getCall(p.token, req.body?.callId);
    const records = Array.isArray(req.body?.records) ? req.body.records.slice(0, 20) : [];
    if (!call) return reply.send({ recorded: 0 });
    reply.send({ recorded: records.filter((r) => callUsage(call, r, 'client')).length });
  });

  // The character asked to open up about a guarded topic: the engine decides.
  app.post('/api/p/:token/call/disclose', (req, reply) => {
    const p = requirePlayer(req, reply); if (!p) return;
    const call = getCall(p.token, req.body?.callId);
    if (!call) return reply.send({ decision: 'stay_guarded', note: 'Stay in character.' });
    reply.send(callDisclose(call, p, req.body?.topic, req.body?.recent));
  });

  app.post('/api/p/:token/call/end', async (req, reply) => {
    const p = requirePlayer(req, reply); if (!p) return;
    const c = CHARACTERS[req.body?.character];
    const secs = Math.max(0, Math.min(3600, Number(req.body?.seconds) || 0));
    const reason = String(req.body?.reason || 'player_hung_up').slice(0, 40);
    if (req.body?.callId) {
      const call = getCall(p.token, req.body.callId);
      if (call) closeCall(call.id, reason, { seconds: Math.round(secs) });
    } else if (req.body?.mode === 'recording') {
      ledger.event('call_ended', { session: p.pid, npc: req.body?.character, transport: 'recording', seconds: Math.round(secs), reason });
    }
    if (c && reason !== 'connect_failed') {
      const who = req.body.character.startsWith('caretaker') ? 'BLACKWOOD MANOR' : c.name;
      await deliver({ token: p.token, thread: 'unknown', from: 'system', kind: 'calllog',
        text: `${who} · ${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, '0')}` });
    }
    reply.send({ ok: true });
  });

  app.post('/api/p/:token/vote', (req, reply) => {
    const p = requirePlayer(req, reply); if (!p) return;
    if (getDb().revealed) return reply.code(409).send({ error: 'Voting is closed.' });
    const { killer, accomplice } = req.body || {};
    if (!SUSPECTS.includes(killer)) return reply.code(400).send({ error: 'Pick a killer.' });
    if (accomplice && !players().some((x) => x.name === accomplice)) return reply.code(400).send({ error: 'Pick a player.' });
    castVote(p.token, killer, accomplice || null);
    reply.send({ ok: true });
  });

  app.post('/api/p/:token/push', (req, reply) => {
    const p = requirePlayer(req, reply); if (!p) return;
    const sub = req.body?.subscription;
    if (!sub?.endpoint) return reply.code(400).send({ error: 'Bad subscription' });
    savePushSub(p.token, sub);
    reply.send({ ok: true });
  });

  app.post('/api/p/:token/settings', (req, reply) => {
    const p = requirePlayer(req, reply); if (!p) return;
    updatePlayer(p.token, { callsOff: Boolean(req.body?.callsOff) });
    reply.send({ ok: true, callsOff: Boolean(req.body?.callsOff) });
  });

  // ---------- admin (you, running the game) ----------
  app.post('/admin/players', (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { name, phone } = req.body || {};
    if (!name) return reply.code(400).send({ error: 'name required' });
    if (phone && !/^\+\d{10,15}$/.test(phone)) return reply.code(400).send({ error: 'phone must look like +15555550123' });
    const p = addPlayer({ name, phone });
    reply.send({ name: p.name, link: linkFor(p.token) });
  });

  app.get('/admin/status', (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    reply.send({
      players: players().map((p) => ({ name: p.name, role: p.role, phone: Boolean(p.phone), callsOff: p.callsOff, link: linkFor(p.token) })),
      tally: tallyVotes(),
      schedule: scheduled(),
      beats: Object.keys(BEATS),
    });
  });

  app.post('/admin/beat/:name', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    try {
      // Long beats (calls) keep running after we answer.
      const run = runBeat(req.params.name);
      const result = await Promise.race([run, new Promise((r) => setTimeout(() => r({ started: true }), 5000))]);
      reply.send(result);
    } catch (err) {
      reply.code(err.status || 500).send({ error: err.message });
    }
  });

  app.post('/admin/schedule', (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { beat, at } = req.body || {};
    if (!BEATS[beat]) return reply.code(400).send({ error: `Unknown beat. Options: ${Object.keys(BEATS).join(', ')}` });
    if (Number.isNaN(Date.parse(at))) return reply.code(400).send({ error: 'at must be a date like 2026-10-30T21:40:00-05:00' });
    reply.send(addScheduled(beat, new Date(at).toISOString()));
  });

  app.post('/admin/reset', (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    resetGame();
    resetMemory();
    reply.send({ ok: true });
  });

  // Cost report from the usage ledger (no dialogue in it).
  app.get('/admin/usage', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    await ledger.flush();
    reply.send(buildReport(readLedgerFile(ledger.file)));
  });

  // ---------- scheduler: fires due beats every 15 seconds ----------
  const scheduler = setInterval(async () => {
    const now = Date.now();
    for (const s of scheduled()) {
      if (!s.done && Date.parse(s.at) <= now) {
        markScheduledDone(s.id);
        runBeat(s.beat).catch((err) => console.error(`[schedule] ${s.beat} failed:`, err.message));
      }
    }
  }, 15_000);
  scheduler.unref?.();
  app.addHook('onClose', async () => clearInterval(scheduler));
}
