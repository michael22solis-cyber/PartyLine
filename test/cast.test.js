// The characters as people on the phone: status lines that follow the story, how they type, photos they send at
// story beats (and remember sending), and their faces on calls, voicemails and the call log.
import { until } from './helpers/env.js';
import { test, after, mock as fake } from 'node:test';
import assert from 'node:assert/strict';
import { startMockOpenAI } from './helpers/mock-openai.js';

const mock = await startMockOpenAI();
process.env.OPENAI_BASE_URL = mock.url;
const { buildApp } = await import('../src/server.js');
const { addPlayer, messagesFor, playerByToken } = await import('../src/store.js');
const { runBeat } = await import('../src/beats.js');
const { phase, statusOf, typingPlan, PHOTOS } = await import('../src/cast.js');
const { allLines } = await import('../src/memory.js');
const { buildTextPrompt } = await import('../src/context.js');
const { ringInApp } = await import('../src/progress.js');
const { threadHistory } = await import('../src/store.js');
const app = buildApp();
after(async () => { await app.close(); await mock.close(); });

test('status lines follow the story', () => {
  assert.equal(phase([]), 'before');
  assert.equal(phase(['setup', 'intro']), 'early');
  assert.equal(phase(['intro', 'memo']), 'late');
  assert.equal(phase(['intro', 'memo', 'twist']), 'deep');
  assert.equal(phase(['twist', 'reveal']), 'after');
  assert.match(statusOf('teddy', 'early'), /LIVE/);
  assert.equal(statusOf('ruth', 'after'), 'unavailable');
  for (const npc of ['ruth', 'marcus', 'lily', 'teddy']) {
    for (const ph of ['before', 'early', 'late', 'deep', 'final', 'after']) assert.ok(statusOf(npc, ph), `${npc} ${ph}`);
  }
});

test('each character types at their own pace; the hesitant ones stop and start', () => {
  const reply = 'Oh sweetheart, I was at bingo until ten, God bless. Why do you ask?';
  const ruth = typingPlan('ruth', reply);
  const teddy = typingPlan('teddy', reply);
  const total = (plan) => plan.reduce((s, x) => s + x.ms, 0);
  assert.ok(total(ruth) > 2 * total(teddy), 'Ruth types much slower than Teddy');
  assert.deepEqual(ruth.map((x) => x.typing), [true, false, true], 'Ruth pauses mid-message');
  assert.deepEqual(teddy.map((x) => x.typing), [true]);
  assert.ok(total(typingPlan('marcus', 'x'.repeat(2000))) <= 8000, 'capped');
  // Typing time follows length: a short text is quick, a longer one takes noticeably longer.
  assert.ok(total(typingPlan('teddy', 'lol no')) < 1500);
  assert.ok(total(typingPlan('teddy', 'x'.repeat(60))) > 3 * total(typingPlan('teddy', 'lol no')));
});

test('photos arrive with the story beat, in the character’s thread, and the character knows they sent it', async () => {
  const ps = ['Maya', 'Theo', 'Rita'].map((name) => addPlayer({ name }));
  const p = ps[0];
  const statusEvents = [];
  const { subscribe } = await import('../src/live.js');
  subscribe(p.token, { write: (s) => { if (s.startsWith('event: status')) statusEvents.push(JSON.parse(s.split('data: ')[1])); } });
  await runBeat('cast');
  for (const x of ps) {
    const photo = messagesFor(x.token).find((m) => m.kind === 'photo');
    assert.equal(photo.thread, 'teddy');
    assert.equal(photo.npc, 'teddy');
    assert.equal(photo.image, PHOTOS.cast.image);
    assert.ok(playerByToken(x.token).unlocked.includes('teddy'));
  }
  assert.match(statusEvents.at(-1).teddy, /LIVE/);
  assert.ok(allLines().some((l) => l.pid === p.pid && l.npc === 'teddy' && /flyer/.test(l.text)));
  const { messages } = buildTextPrompt({ npc: 'teddy', player: playerByToken(p.token), thread: threadHistory(p.token, 'teddy', 30) });
  assert.ok(messages.some((m) => m.role === 'assistant' && /^\[you sent a photo\]/.test(m.content)), 'Teddy sees it was a photo');

  // The image is served, and the state the phone loads carries each contact's status.
  const img = await app.inject({ method: 'GET', url: PHOTOS.cast.image });
  assert.equal(img.statusCode, 200);
  const state = (await app.inject({ method: 'GET', url: `/api/p/${p.token}/state` })).json();
  assert.match(state.threads.find((t) => t.key === 'teddy').status, /LIVE/);

  // A player can share the photo with the crew.
  const photo = messagesFor(p.token).find((m) => m.kind === 'photo');
  const r = await app.inject({ method: 'POST', url: `/api/p/${p.token}/peer`, payload: { to: 'crew', forward: photo.id } });
  assert.equal(r.statusCode, 200, r.body);
  await until(() => messagesFor(ps[1].token).some((m) => m.thread === 'crew' && m.kind === 'photo' && m.image === PHOTOS.cast.image));
});

test('missed calls, voicemails and call logs know whose face to show', async () => {
  const p = addPlayer({ name: 'Ivy' });
  fake.timers.enable({ apis: ['setTimeout'] });
  try {
    await ringInApp(p, 'ruth', { voicemail: { text: 'Voicemail from Ruth Calloway', audio: null } });
    await ringInApp(p, 'lily', {}); // replaces the first ring: Ruth's ring goes quiet without a voicemail
    fake.timers.tick(40_000);
  } finally { fake.timers.reset(); }
  await until(() => messagesFor(p.token).some((m) => m.kind === 'missed'));
  assert.equal(messagesFor(p.token).find((m) => m.kind === 'missed').npc, 'lily');
  const q = addPlayer({ name: 'Vic' });
  fake.timers.enable({ apis: ['setTimeout'] });
  try {
    await ringInApp(q, 'ruth', { voicemail: { text: 'Voicemail from Ruth Calloway', audio: null } });
    fake.timers.tick(40_000);
  } finally { fake.timers.reset(); }
  await until(() => messagesFor(q.token).some((m) => m.kind === 'voicemail'));
  assert.equal(messagesFor(q.token).find((m) => m.kind === 'voicemail').npc, 'ruth');
  await app.inject({ method: 'POST', url: `/api/p/${q.token}/call/end`, payload: { character: 'marcus', seconds: 30, reason: 'player_hung_up' } });
  assert.equal(messagesFor(q.token).find((m) => m.kind === 'calllog').npc, 'marcus');
});

test('one night: the host schedules the whole story from a start time', async () => {
  const at = '2026-10-31T20:00:00-05:00';
  const r = await app.inject({ method: 'POST', url: '/admin/schedule-game', headers: { 'x-admin-key': 'test-admin' }, payload: { at, length: 'quick' } });
  assert.equal(r.statusCode, 200, r.body);
  const beats = r.json().scheduled;
  assert.equal(beats[0].beat, 'setup');
  assert.equal(beats.at(-1).beat, 'reveal');
  assert.equal((new Date(beats.at(-1).at) - new Date(at)) / 60_000, 75, 'the final call 75 minutes in');
  assert.ok(!beats.some((b) => b.beat === 'closeNight1'));
  const bad = await app.inject({ method: 'POST', url: '/admin/schedule-game', headers: { 'x-admin-key': 'test-admin' }, payload: { at, length: 'twonights' } });
  assert.equal(bad.statusCode, 400);
  await app.inject({ method: 'POST', url: '/admin/schedule/clear', headers: { 'x-admin-key': 'test-admin' } });
});
