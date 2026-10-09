// The burner-phone web app: player API, live updates, admin controls and the beat scheduler.
import fs from 'node:fs';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import { scheduleGame } from './schedule.js';
import { createGame, join, startGame, lobbyView } from './lobby.js';
import { getGame } from './store.js';
import {
  addPlayer, players, playerByToken, updatePlayer, messagesFor, castVote, votes,
  savePushSub, addScheduled, scheduled, markScheduledDone, getDb, resetGame, clearPendingSchedule,
  pausedAt, pauseSchedule, resumeSchedule,
} from './store.js';
import { requestRejoin, rejoinStatus, decideRejoin, pendingRejoins, resetRejoins } from './rejoin.js';
import { TEXTABLE, CHARACTERS } from './characters/index.js';
import { remember, resetMemory } from './memory.js';
import { unlockedFor, isUnlocked, answerRing, pendingRing, onCharacterSaid, unlockMentions, audioIf } from './progress.js';
import { deliver } from './live.js';
import { sendPeer } from './crew.js';
import { createGroup, groupsForPlayer } from './groups.js';
import { handlePlayerText } from './chat.js';
import { subscribe, emit } from './live.js';
import { vapidPublicKey } from './push.js';
import { runBeat, SUSPECTS, tallyVotes, BEATS } from './beats.js';
import { recapFor } from './recap.js';
import { ledger, readLedgerFile } from './ai/ledger.js';
import { buildReport } from './ai/report.js';
import { BusyError } from './ai/limiter.js';
import { callTiming, openingItem, realtimeModel, voiceFor } from './voice/session.js';
import { mintClientSecret, createSidebandCall } from './voice/realtime-api.js';
import { attachSideband } from './voice/sideband.js';
import { openCall, getCall, closeCall, callTranscript, callUsage, callDisclose } from './voice/calls.js';
import { checkCall, chargeCall, resetAllowances, callAllowance, holdOff, poolView } from './voice/allowance.js';
import { resetInitiative } from './initiative.js';
import { liveView } from './hostview.js';
import { overBudget, budgetView } from './budget.js';
import { normalizePhone } from './phonenumber.js';
import { dataSince } from './paths.js';
import { elevenToday } from './eleven-guard.js';
import { madeFile, makeRecordings, recordingsStatus } from './recordings.js';
import { sendHint, nextHint } from './hints.js';
import { agendaView, agendaSummary, checkAgendas } from './agenda.js';
import { recordedCall, servedFile as caretakerClip, voiceStatus as caretakerVoice, warmUp as warmCaretaker } from './voice/caretaker.js';
import { statusOf, phase, busyAs, excuseFor } from './cast.js';
import { trackUrls, bedUrls, servedFile as musicFile, musicStatus, warmUp as warmMusic } from './music.js';
import { SECRETS } from './secrets.js';

const {
  ADMIN_KEY, PUBLIC_HOST, OPENAI_API_KEY,
  OPENAI_BASE_URL = 'https://api.openai.com/v1',
  MAX_CALLS_PER_PLAYER = 30,
} = process.env;
const callCounts = new Map();
// The night clock on every phone: when votes open and when the final call comes (from the schedule), and if paused.
function nightClock() {
  const next = (beat) => scheduled().filter((x) => x.beat === beat && !x.done).map((x) => x.at).sort()[0] || null;
  return { votesAt: next('votesOpen'), finalAt: next('reveal'), paused: pausedAt() };
}
const excused = new Set(); // `${token}:${npc}:${phase}`: the busy excuse is given once per stretch of the night
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
      // PNGs at 192 and 512 are what Chrome needs to install it as a real app (an app that opens full screen, which the
      // home-screen gate checks for) rather than a bookmark that opens a browser tab.
      icons: [
        { src: '/assets/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/assets/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/assets/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      ],
    });
  });

  // ---------- player API ----------
  app.get('/api/p/:token/state', (req, reply) => {
    const p = requirePlayer(req, reply); if (!p) return;
    reply.send({
      me: {
        pid: p.pid, name: p.name, role: p.role, assigned: Boolean(p.clue), callsOff: p.callsOff, hasPhone: Boolean(p.phone),
        found: (p.found || []).length, totalSecrets: SECRETS.length,
        // Call allowance for the guide and the CALL button: minutes of calls left tonight (see voice/allowance.js;
        // null = unlimited) and the longest a single call can run.
        calls: callAllowance(p),
      },
      phase: phase(),
      music: trackUrls(), // background tracks, one per stretch of the night (see music.js)
      callBeds: bedUrls(), // what you hear behind each character on a call
      threads: TEXTABLE.filter((t) => unlockedFor(p).includes(t.key)).map((t) => ({ ...t, status: statusOf(t.key) })),
      ringing: pendingRing(p.token) ? { character: pendingRing(p.token).character } : null,
      clock: nightClock(),
      messages: messagesFor(p.token),
      suspects: SUSPECTS,
      players: players().map((x) => x.name),
      groups: groupsForPlayer(p),
      lobby: lobbyView(p),
      peers: players().filter((x) => x.token !== p.token).map((x) => ({ pid: x.pid, name: x.name })),
      vote: votes()[p.token] || null,
      agenda: agendaView(p),
      revealed: getDb().revealed,
      vapidPublicKey,
      // On a phone, play only from the home-screen app (public/install.js). REQUIRE_INSTALL=off lets browser tabs play.
      requireInstall: process.env.REQUIRE_INSTALL !== 'off',
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
  // Background music (generated once by ElevenLabs, cached on the data volume).
  // Evidence recordings the host made on the server (recordings.js).
  app.get('/assets/made/:file', (req, reply) => {
    const file = madeFile(req.params.file);
    if (!file) return reply.code(404).send({ error: 'Not found' });
    reply.type('audio/mpeg').header('Cache-Control', 'public, max-age=86400').send(fs.createReadStream(file));
  });
  // Make the missing evidence recordings, once (the host's button; about 1 cent of OpenAI text-to-speech).
  app.post('/admin/recordings/make', (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    makeRecordings({ remake: req.body?.remake === true }).catch(() => {});
    reply.send({ recordings: recordingsStatus() });
  });

  app.get('/assets/music/:file', (req, reply) => {
    const file = musicFile(req.params.file);
    if (!file) return reply.code(404).send({ error: 'Not found' });
    reply.type('audio/mpeg').header('Cache-Control', 'public, max-age=31536000, immutable').send(fs.createReadStream(file));
  });
  // The Caretaker's generated lines (cached on the data volume; file names are content hashes).
  app.get('/assets/voice/:file', (req, reply) => {
    const file = caretakerClip(req.params.file);
    if (!file) return reply.code(404).send({ error: 'Not found' });
    reply.type('audio/mpeg').header('Cache-Control', 'public, max-age=31536000, immutable').send(fs.createReadStream(file));
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
    let timing = callTiming(character);
    // Calls the player starts come out of their minutes and respect cooldowns; calls the house places never do.
    if (!answering) {
      const allowed = checkCall(p, character, c.name, timing);
      if (!allowed.ok) {
        ledger.event('call_refused', { session: p.pid, npc: character, reason: allowed.reason });
        return reply.code(allowed.status).send({ error: allowed.error, reason: allowed.reason, retryAfter: allowed.retryAfter });
      }
      timing = allowed.timing;
      // Busy (Teddy live, Marcus driving, Lily on shift): the first try goes unanswered and they text why.
      const why = busyAs(character);
      const excusedKey = `${p.token}:${character}:${phase()}`;
      if (why && !excused.has(excusedKey)) {
        excused.add(excusedKey);
        holdOff(p.token, character, 2 * 60_000);
        ledger.event('call_refused', { session: p.pid, npc: character, reason: 'busy' });
        const t = setTimeout(() => deliver({ token: p.token, thread: character, from: 'character', text: excuseFor(why) }).catch(() => {}), process.env.TEXT_FAST === '1' ? 0 : 4000);
        t.unref?.();
        return reply.code(409).send({ error: `No answer. ${c.name} can't talk right now.`, reason: 'busy' });
      }
    }

    // The Caretaker speaks in the intro narrator's ElevenLabs voice: his calls play recordings (see voice/caretaker.js).
    const scripted = character.startsWith('caretaker') && !(character === 'caretaker_reveal' && process.env.REVEAL_MODE === 'live')
      ? await recordedCall(character, p, character === 'caretaker' ? p.caretakerCalls || 0 : 0) : null;
    if (scripted) {
      if (answering) answerRing(p.token);
      callCounts.set(p.token, n);
      if (character === 'caretaker') updatePlayer(p.token, { caretakerCalls: (p.caretakerCalls || 0) + 1 });
      ledger.event('call_started', { session: p.pid, npc: character, transport: 'recording' });
      remember({ player: p.name, pid: p.pid, npc: character, character: c.name, speaker: 'character', text: scripted.captions.join(' '), channel: 'call' });
      return reply.send({ mode: 'recording', audio: scripted.audio, captions: scripted.captions, name: c.name, maxSeconds: timing.maxSeconds });
    }

    // Scripted calls (the midnight reveal) play a finished recording: no live model, no cost.
    const recording = c.recording && process.env.REVEAL_MODE !== 'live' ? audioIf(c.recording) : null;
    if (recording) {
      if (answering) answerRing(p.token);
      callCounts.set(p.token, n);
      ledger.event('call_started', { session: p.pid, npc: character, transport: 'recording' });
      if (c.revealText) remember({ player: p.name, pid: p.pid, npc: character, character: c.name, speaker: 'character', text: c.revealText, channel: 'call' });
      return reply.send({ mode: 'recording', audio: recording, name: c.name, maxSeconds: timing.maxSeconds, captions: c.revealText || null });
    }

    if (!OPENAI_API_KEY) return reply.code(500).send({ error: 'Calls are not set up on this server.' });
    // This game hit its AI budget (budget.js): no more live calls. Texting still works.
    if (overBudget()) {
      ledger.event('call_refused', { session: p.pid, npc: character, reason: 'budget' });
      return reply.code(429).send({ error: 'The line is dead for tonight. You can still text.', reason: 'budget' });
    }
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
    if (!answering) call.onClose.push(() => chargeCall(p.token, character, (Date.now() - call.startedAt) / 1000));
    try {
      const base = { callId: call.id, transport, opening: opening.text, openingRole: opening.role, name: c.name, maxSeconds: timing.maxSeconds, timing };
      let out;
      if (transport === 'sideband') {
        call.pending = { opening, timing };
        out = { ...base, serverControlled: true };
      } else {
        const minted = await mintClientSecret({ npc: character, player: p });
        call.model = minted.built.model;
        out = { ...base, key: minted.key, url: `${OPENAI_BASE_URL}/realtime/calls`, toolName: minted.built.toolName, turns: minted.built.turns };
      }
      if (answering) answerRing(p.token);
      callCounts.set(p.token, n);
      if (c.textable && !(p.called || []).includes(character)) updatePlayer(p.token, { called: [...(p.called || []), character] });
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
      attachSideband(call, p, { openaiCallId: made.openaiCallId, opening, toolName: made.built.toolName, timing, turns: made.built.turns });
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
    else if (c.textable) await onCharacterSaid(p, character, clean, { channel: 'call' });
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
      await deliver({ token: p.token, thread: 'unknown', from: 'system', kind: 'calllog', npc: req.body.character,
        text: `${who} · ${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, '0')}` });
    }
    reply.send({ ok: true });
  });

  app.post('/api/p/:token/vote', (req, reply) => {
    const p = requirePlayer(req, reply); if (!p) return;
    if (getDb().revealed) return reply.code(409).send({ error: 'Voting is closed.' });
    const { killer, accomplice } = req.body || {};
    if (!SUSPECTS.includes(killer)) return reply.code(400).send({ error: 'Pick a killer.' });
    const suspect = TEXTABLE.find((t) => t.name === killer);
    if (suspect && !isUnlocked(p, suspect.key)) return reply.code(400).send({ error: 'You haven’t met them yet.' });
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
    const { name } = req.body || {};
    if (!name) return reply.code(400).send({ error: 'name required' });
    const phone = normalizePhone(req.body?.phone);
    if (String(req.body?.phone || '').trim() && !phone) return reply.code(400).send({ error: 'That phone number doesn’t look right. Try 10 digits, like 806 555 0123.' });
    const p = addPlayer({ name, phone });
    reply.send({ name: p.name, link: linkFor(p.token) });
  });

  app.get('/admin/status', (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const live = liveView();
    reply.send({
      players: players().map((p) => ({
        name: p.name, role: p.role, pid: p.pid, phone: Boolean(p.phone), callsOff: p.callsOff, link: linkFor(p.token),
        voted: Boolean(votes()[p.token]), found: (p.found || []).length, contacts: (p.unlocked || []).length,
        callMinutes: Math.round((p.callSeconds || 0) / 6) / 10, ...live.players[p.token], hintLeft: Boolean(nextHint(p)), agenda: agendaSummary(p),
      })),
      spend: { usd: live.usd, since: live.since },
      budget: budgetView(),
      callPool: poolView(),
      recordings: recordingsStatus(),
      elevenToday: elevenToday(),
      paused: Boolean(pausedAt()),
      rejoins: pendingRejoins(),
      voices: Object.fromEntries(['ruth', 'marcus', 'lily', 'teddy'].map((k) => [CHARACTERS[k].name.split(' ')[0], voiceFor(k)])),
      revealed: getDb().revealed,
      caretakerVoice: caretakerVoice(),
      music: musicStatus(),
      dataSince: dataSince().since,
      game: getGame() ? { ...lobbyView(null), invite: getGame().status === 'lobby' ? `https://${PUBLIC_HOST || 'localhost:5050'}/join/${getGame().code}` : null } : null,
      tally: tallyVotes(),
      schedule: scheduled(),
      beats: Object.keys(BEATS),
    });
  });

  // Nudge a stuck player: a hint on The Line about who to ask (never the answer).
  app.post('/admin/hint/:pid', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const p = players().find((x) => x.pid === req.params.pid);
    if (!p) return reply.code(404).send({ error: 'No such player' });
    const h = await sendHint(p.token);
    if (!h) return reply.code(409).send({ error: `${p.name} has found or been pointed at everything already.` });
    reply.send({ ok: true, about: h.who });
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

  // Schedule a whole game for later (one night; the length's timetable from modes.js).
  app.post('/admin/schedule-game', (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    try { reply.send({ scheduled: scheduleGame(req.body?.at, req.body?.length) }); }
    catch (err) { reply.code(err.status || 500).send({ error: err.message }); }
  });
  // Try the ElevenLabs setup again now (after fixing a key or voice ID) and report what happened.
  app.post('/admin/voice/retry', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    await warmCaretaker({ attempts: 1 });
    reply.send({ caretakerVoice: caretakerVoice(), music: musicStatus() });
  });
  // Make the music, once (the host's "Make music" button). Already-made tracks are skipped; a run in progress is joined.
  app.post('/admin/music/make', (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    warmMusic().catch((err) => console.error('[music]', err.message));
    reply.send({ music: musicStatus() });
  });
  app.post('/admin/schedule/clear', (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    clearPendingSchedule();
    reply.send({ ok: true });
  });

  // ---------- auto mode: invite link, lobby, start ----------
  app.post('/admin/game', (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    try {
      const g = createGame({ length: req.body?.length });
      reply.send({ ...g, invite: `https://${PUBLIC_HOST || 'localhost:5050'}/join/${g.code}` });
    } catch (err) { reply.code(err.status || 500).send({ error: err.message }); }
  });
  app.post('/admin/start', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    try { reply.send(await startGame()); }
    catch (err) { reply.code(err.status || 500).send({ error: err.message }); }
  });
  app.get('/join/:code', (req, reply) => {
    const g = getGame();
    if (!g || g.code !== req.params.code) return reply.code(404).type('text/html').send('<h1 style="font-family:monospace">This invite has expired.</h1>');
    reply.type('text/html').header('Cache-Control', 'no-store').send(fs.readFileSync(path.join(PUBLIC_DIR, 'join.html'), 'utf8'));
  });
  // The invite page: who's playing (to rejoin as), and whether the game has started.
  app.get('/api/join/:code', (req, reply) => {
    const g = getGame();
    if (!g || g.code !== req.params.code) return reply.code(404).send({ error: 'This invite has expired.' });
    reply.send({ status: g.status, players: players().map((x) => ({ pid: x.pid, name: x.name })) });
  });
  app.post('/api/join/:code/rejoin', (req, reply) => {
    try { reply.send(requestRejoin(req.params.code, req.body?.pid)); }
    catch (err) { reply.code(err.status || 500).send({ error: err.message }); }
  });
  app.get('/api/join/:code/rejoin/:rid', (req, reply) => {
    try { reply.send(rejoinStatus(req.params.code, req.params.rid)); }
    catch (err) { reply.code(err.status || 500).send({ error: err.message }); }
  });
  app.post('/admin/rejoin/:rid', (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    try { decideRejoin(req.params.rid, req.body?.approve !== false); reply.send({ ok: true }); }
    catch (err) { reply.code(err.status || 500).send({ error: err.message }); }
  });

  // Pause the night (pizza, a break): beats hold still and every phone shows it; resume shifts the rest of the night.
  app.post('/admin/pause', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    if (pausedAt()) return reply.send({ paused: true });
    pauseSchedule();
    for (const p of players()) {
      emit(p.token, 'clock', nightClock());
      await deliver({ token: p.token, thread: 'line', from: 'system', kind: 'text', text: '⏸ The host paused the night. Stay close to your phone.' });
    }
    reply.send({ paused: true });
  });
  app.post('/admin/resume', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const ms = resumeSchedule();
    for (const p of players()) {
      emit(p.token, 'clock', nightClock());
      if (ms) await deliver({ token: p.token, thread: 'line', from: 'system', kind: 'text', text: '▶ The line is open again.' });
    }
    reply.send({ paused: false, shiftedMinutes: Math.round(ms / 60_000) });
  });

  app.post('/api/join/:code', (req, reply) => {
    try { const p = join(req.params.code, req.body?.name); reply.send({ link: `/p/${p.token}` }); }
    catch (err) { reply.code(err.status || 500).send({ error: err.message }); }
  });
  app.post('/api/p/:token/start', async (req, reply) => {
    const p = requirePlayer(req, reply); if (!p) return;
    if (!p.organizer) return reply.code(403).send({ error: 'Only the organizer can start the game.' });
    try { reply.send(await startGame()); }
    catch (err) { reply.code(err.status || 500).send({ error: err.message }); }
  });

  // The host's control panel (the admin key is entered on the page, never in the URL).
  app.get('/host', (_req, reply) => {
    reply.type('text/html').header('Cache-Control', 'no-store').send(fs.readFileSync(path.join(PUBLIC_DIR, 'host.html'), 'utf8'));
  });

  app.post('/admin/reset', (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    resetGame();
    resetAllowances();
    resetInitiative();
    resetRejoins();
    excused.clear();
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
    checkAgendas().catch((err) => console.error('[agenda]', err.message));
    if (pausedAt()) return; // the night is paused: nothing fires until the host resumes
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
