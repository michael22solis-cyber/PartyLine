// Characters reaching out on their own (reactions and gossip, capped), and busy characters not picking up.
import { until } from './helpers/env.js';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { startMockOpenAI } from './helpers/mock-openai.js';

process.env.INITIATIVE = 'on';
process.env.UNLOCK_ALL = '1';
const mock = await startMockOpenAI({ chatReply: (m) => (/Stage direction/.test(m.at(-1)?.content || '') ? 'you think I did it? really?' : 'Mm.') });
process.env.OPENAI_BASE_URL = mock.url;
const { buildApp } = await import('../src/server.js');
const { addPlayer, messagesFor } = await import('../src/store.js');
const { handlePlayerText } = await import('../src/chat.js');
const { onSecretFound, reachOut } = await import('../src/initiative.js');
const { markBeat } = await import('../src/store.js');
const { ledger } = await import('../src/ai/ledger.js');
const app = buildApp();
after(async () => { await app.close(); await mock.close(); });
const fromChar = (p, npc) => messagesFor(p.token).filter((m) => m.thread === npc && m.from === 'character');

test('accuse someone and they come back to it on their own; another suspect gossips to someone else', async () => {
  const a = addPlayer({ name: 'Ava' });
  const b = addPlayer({ name: 'Ben' });
  await handlePlayerText(a, 'marcus', 'You killed her, Marcus. I know you did.');
  await until(() => fromChar(a, 'marcus').some((m) => m.text === 'you think I did it? really?'), 4000);
  await until(() => ['teddy', 'ruth', 'lily'].some((n) => fromChar(b, n).length), 4000);
  const gossip = mock.log.chat.find((body) => /you heard that Ava accused Marcus Vane/.test(body.messages.at(-1).content));
  assert.ok(gossip, 'the gossip is about what Ava did');
  assert.ok(ledger.records().some((r) => r.type === 'character_reached_out' && r.why === 'gossip'));
});

test('capped: at most 2 unprompted texts per character per player', async () => {
  const c = addPlayer({ name: 'Cy' });
  for (let i = 0; i < 4; i++) await reachOut(c, 'ruth', '(Stage direction, not from the player: say hello.)', 'test');
  assert.equal(fromChar(c, 'ruth').length, 2);
});

test('uncover a secret and the character texts you about it', async () => {
  const d = addPlayer({ name: 'Dee' });
  onSecretFound(d, 'marcus');
  await until(() => fromChar(d, 'marcus').length === 1, 4000);
  assert.ok(mock.log.chat.some((body) => /let something slip to Dee/.test(body.messages.at(-1).content)));
});

test('busy means busy: Teddy is live, so the first call goes unanswered and he texts why; the next try works', async () => {
  markBeat('intro'); // the night has started: Teddy is live
  const e = addPlayer({ name: 'Eli' });
  const r1 = await app.inject({ method: 'POST', url: `/api/p/${e.token}/call`, payload: { character: 'teddy' } });
  assert.equal(r1.statusCode, 409);
  assert.equal(r1.json().reason, 'busy');
  await until(() => fromChar(e, 'teddy').some((m) => /LIVE rn/.test(m.text)));
  const r2 = await app.inject({ method: 'POST', url: `/api/p/${e.token}/call`, payload: { character: 'teddy' } });
  assert.equal(r2.statusCode, 409, 'he asked for two minutes');
  const { resetAllowances } = await import('../src/voice/allowance.js');
  resetAllowances(); // two minutes later
  const r3 = await app.inject({ method: 'POST', url: `/api/p/${e.token}/call`, payload: { character: 'teddy' } });
  assert.equal(r3.statusCode, 200, 'he picks up this time');
  // Ruth isn't busy: she answers straight away.
  const r4 = await app.inject({ method: 'POST', url: `/api/p/${e.token}/call`, payload: { character: 'ruth' } });
  assert.equal(r4.statusCode, 200);
});
