// The burner-phone web app: player API, live updates, admin controls and the beat scheduler.
import fs from 'node:fs';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import {
  addPlayer, players, playerByToken, updatePlayer, messagesFor, castVote, votes,
  savePushSub, addScheduled, scheduled, markScheduledDone, getDb, resetGame,
} from './store.js';
import { TEXTABLE, CHARACTERS, buildInstructions } from './characters/index.js';
import { remember, summary } from './memory.js';
import { unlockedFor, isUnlocked, answerRing, pendingRing, onCharacterSaid, unlockMentions } from './progress.js';
import { deliver } from './live.js';
import { sendPeer } from './crew.js';
import { createGroup, groupsForPlayer } from './groups.js';
import { handlePlayerText } from './chat.js';
import { subscribe } from './live.js';
import { vapidPublicKey } from './push.js';
import { runBeat, SUSPECTS, tallyVotes, BEATS } from './beats.js';
import { recapFor } from './recap.js';

const {
  ADMIN_KEY, PUBLIC_HOST, OPENAI_API_KEY,
  OPENAI_BASE_URL = 'https://api.openai.com/v1',
  OPENAI_REALTIME_MODEL = 'gpt-realtime',
  OPENAI_TRANSCRIBE_MODEL = 'gpt-4o-mini-transcribe',
  MAX_CALLS_PER_PLAYER = 30,
} = process.env;
const callCounts = new Map();
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
      const msg = await handlePlayerText(p, req.body?.thread, req.body?.text);
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
  // The phone asks for a short-lived key for one call; the character's instructions and the group's memory go in it.
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
    if (!OPENAI_API_KEY) return reply.code(500).send({ error: 'Calls are not set up on this server.' });
    const opening = (answering && ring.opening) || (answering
      ? c.opening(p.name)
      : `${p.name} has just called you. Answer the phone in character, like you were not expecting a call.`);
    try {
      const res = await fetch(`${OPENAI_BASE_URL}/realtime/client_secrets`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session: {
            type: 'realtime',
            model: OPENAI_REALTIME_MODEL,
            instructions: buildInstructions(character, p.name, summary(), 'voice'),
            audio: {
              input: { transcription: { model: OPENAI_TRANSCRIBE_MODEL }, turn_detection: { type: 'server_vad' } },
              output: { voice: c.voice },
            },
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.value) throw new Error(`OpenAI ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
      if (answering) answerRing(p.token);
      callCounts.set(p.token, n);
      reply.send({ key: data.value, url: `${OPENAI_BASE_URL}/realtime/calls`, opening, name: c.name, maxSeconds: 240 });
    } catch (err) {
      console.error(`[call ${character}] could not start:`, err.message);
      reply.code(502).send({ error: 'The call didn’t connect. Try again.' });
    }
  });

  // What was said on an in-app call goes into the shared memory (so other characters know).
  app.post('/api/p/:token/call/transcript', async (req, reply) => {
    const p = requirePlayer(req, reply); if (!p) return;
    const { character, speaker, text } = req.body || {};
    const c = CHARACTERS[character];
    const clean = String(text || '').trim().slice(0, 1000);
    if (!c || !clean) return reply.send({ ok: true });
    remember({ player: p.name, character: c.name, speaker: speaker === 'player' ? 'player' : 'character', text: clean });
    if (speaker === 'player') await unlockMentions(p, clean);
    else if (c.textable) await onCharacterSaid(p, character, clean);
    reply.send({ ok: true });
  });

  app.post('/api/p/:token/call/end', async (req, reply) => {
    const p = requirePlayer(req, reply); if (!p) return;
    const c = CHARACTERS[req.body?.character];
    const secs = Math.max(0, Math.min(3600, Number(req.body?.seconds) || 0));
    if (c) {
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
    fs.rmSync(path.resolve('data/memory.json'), { force: true });
    reply.send({ ok: true });
  });

  // ---------- scheduler: fires due beats every 15 seconds ----------
  setInterval(async () => {
    const now = Date.now();
    for (const s of scheduled()) {
      if (!s.done && Date.parse(s.at) <= now) {
        markScheduledDone(s.id);
        runBeat(s.beat).catch((err) => console.error(`[schedule] ${s.beat} failed:`, err.message));
      }
    }
  }, 15_000);
}
