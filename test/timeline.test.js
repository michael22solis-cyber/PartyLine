// Thursday night in the Notebook: a moment shows up only once its evidence has reached that player's phone.
import './helpers/env.js';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { startMockOpenAI } from './helpers/mock-openai.js';

process.env.BEAT_TIME_SCALE = '0.001';
const mock = await startMockOpenAI();
process.env.OPENAI_BASE_URL = mock.url;
const { buildApp } = await import('../src/server.js');
const { addPlayer, playerByToken, updatePlayer } = await import('../src/store.js');
const { deliver } = await import('../src/live.js');
const { runBeat } = await import('../src/beats.js');
const { sendPeer } = await import('../src/crew.js');
const { SECRETS } = await import('../src/secrets.js');
const app = buildApp();
after(async () => { await app.close(); await mock.close(); });

const timeline = async (p) => (await app.inject({ method: 'GET', url: `/api/p/${p.token}/state` })).json().timeline;
const ids = (tl) => tl.moments.map((m) => m.id);
const card = (id) => `SECRET UNCOVERED\n${SECRETS.find((s) => s.id === id).card}`;

test('a new player has only what everyone knows, and nothing locked reaches the phone', async () => {
  const p = addPlayer({ name: 'Nia' });
  const tl = await timeline(p);
  assert.deepEqual(ids(tl), ['elias', 'death']);
  assert.ok(tl.moments.every((m) => m.known));
  assert.equal(tl.missing, 8);
  assert.doesNotMatch(JSON.stringify(tl), /8:30|Rosie|speaker|mud|911/i, 'no locked facts in the payload');
});

test('a clue adds its moment; uncovering the secret behind it adds detail', async () => {
  const p = addPlayer({ name: 'Oto' });
  await deliver({ token: p.token, thread: 'line', from: 'character', kind: 'clue', text: 'YOUR CLUE\nDINER RECEIPT: Rosie’s Diner, 9:31 pm, Marcus Vane’s card. Server: "L."' });
  let tl = await timeline(p);
  assert.deepEqual(ids(tl), ['elias', 'death', 'receipt'], 'in story order');
  assert.match(tl.moments.find((m) => m.id === 'receipt').text, /signs “L\.”/);

  updatePlayer(p.token, { found: ['diner'] });
  tl = await timeline(playerByToken(p.token));
  assert.ok(ids(tl).includes('leaves'), 'Marcus leaving at 7:10 comes from his confession');
  assert.match(tl.moments.find((m) => m.id === 'receipt').text, /Lily is his server/);
  assert.equal(tl.moments.find((m) => m.id === 'receipt').known, false);
});

test('a card a friend shares counts too; notes attach to the memo, which carries its time', async () => {
  const a = addPlayer({ name: 'Pip' });
  const b = addPlayer({ name: 'Quin' });
  await runBeat('memo');
  const mine = await deliver({ token: a.token, thread: 'teddy', from: 'system', kind: 'evidence', text: card('speakers') });
  updatePlayer(a.token, { found: ['speakers'] });
  await sendPeer(playerByToken(a.token), 'crew', { forward: mine.id });

  const tl = await timeline(b);
  const memo = tl.moments.find((m) => m.id === 'memo');
  assert.equal(memo.time, '9:40 pm');
  assert.deepEqual(memo.notes, ['Teddy’s speakers play recorded voices. They never hum.']);
  // The memo card itself carries the same time.
  const { messages } = (await app.inject({ method: 'GET', url: `/api/p/${b.token}/state` })).json();
  assert.match(messages.find((m) => m.kind === 'memo').text, /^Recorded on Dana’s phone, Thursday, 9:40 pm\./);
});
