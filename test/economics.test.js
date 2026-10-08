// Game economics: one call-time pool shared by the group, and a hard AI budget per game.
import { until } from './helpers/env.js';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { startMockOpenAI } from './helpers/mock-openai.js';

process.env.CALL_POOL_MINUTES = '40';
process.env.UNLOCK_ALL = '1';
const mock = await startMockOpenAI();
process.env.OPENAI_BASE_URL = mock.url;
const { buildApp } = await import('../src/server.js');
const { addPlayer, updatePlayer, messagesFor } = await import('../src/store.js');
const { checkCall, callAllowance, resetAllowances } = await import('../src/voice/allowance.js');
const { handlePlayerText } = await import('../src/chat.js');
const { ringInApp, pendingRing } = await import('../src/progress.js');
const { gameSpend } = await import('../src/budget.js');
const app = buildApp();
after(async () => { await app.close(); await mock.close(); });
const timing = { maxSeconds: 240, wrapUpAt: 200, idleSeconds: 45 };
const admin = { 'x-admin-key': 'test-admin' };

test('call time is one pool for the whole group', async () => {
  const a = addPlayer({ name: 'Ann' });
  const b = addPlayer({ name: 'Bo' });
  assert.equal(callAllowance(b).minutesLeft, 40);
  assert.equal(callAllowance(b).shared, true);
  updatePlayer(a.token, { callSeconds: 38 * 60 }); // Ann talked a lot
  assert.equal(callAllowance(b).minutesLeft, 2, 'Bo sees what the group has left');
  assert.equal(checkCall(b, 'ruth', 'Ruth', timing).timing.maxSeconds, 120, 'a call is fitted to the pool');
  updatePlayer(b.token, { callSeconds: 2 * 60 });
  const out = checkCall(b, 'ruth', 'Ruth', timing);
  assert.equal(out.ok, false);
  assert.match(out.error, /group is out of call time/);
  const st = (await app.inject({ url: '/admin/status', headers: admin })).json();
  assert.deepEqual(st.callPool, { minutesLeft: 0, minutesMax: 40 });
  updatePlayer(a.token, { callSeconds: 0 }); updatePlayer(b.token, { callSeconds: 0 });
});

test('the game budget: at the cap, no more live calls or suspect rings; past it, texts stop too', async () => {
  resetAllowances();
  const p = addPlayer({ name: 'Cal' });
  await handlePlayerText(p, 'ruth', 'Ruth, where were you Thursday?');
  await until(() => messagesFor(p.token).some((m) => m.thread === 'ruth' && m.from === 'character'));
  const spent = gameSpend();
  assert.ok(spent > 0);

  process.env.GAME_BUDGET_USD = String(spent * 0.9); // the game is now just over its cap
  const call = await app.inject({ method: 'POST', url: `/api/p/${p.token}/call`, payload: { character: 'marcus' } });
  assert.equal(call.statusCode, 429);
  assert.equal(call.json().reason, 'budget');
  await ringInApp(p, 'lily', { voicemail: { text: 'Voicemail from Lily.' } });
  assert.equal(pendingRing(p.token), null, 'suspects stop placing live calls');
  assert.ok(messagesFor(p.token).some((m) => m.kind === 'voicemail' && m.text === 'Voicemail from Lily.'));
  const st = (await app.inject({ url: '/admin/status', headers: admin })).json();
  assert.equal(st.budget.over, true);

  process.env.GAME_BUDGET_USD = String(spent * 0.5); // way past it: replies stop, nothing more is spent
  const before = mock.log.chat.length;
  await handlePlayerText(p, 'ruth', 'Ruth? Are you there?');
  await until(() => messagesFor(p.token).some((m) => /No signal/.test(m.text)));
  assert.equal(mock.log.chat.length, before, 'no AI call was made');

  process.env.GAME_BUDGET_USD = '0'; // 0 = no cap
  const again = await app.inject({ method: 'POST', url: `/api/p/${p.token}/call`, payload: { character: 'marcus' } });
  assert.equal(again.statusCode, 200);
  delete process.env.GAME_BUDGET_USD;
});
