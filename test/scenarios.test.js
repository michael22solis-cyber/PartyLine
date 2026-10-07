// Scenario suite: reconnects, repeated accusations, and one whole short playtest (text + calls) whose ledger is
// reported like a real game. Offline: the model is the mock; what is measured is the system around it.
import { until } from './helpers/env.js';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { startMockOpenAI } from './helpers/mock-openai.js';

process.env.UNLOCK_ALL = '1';
const mock = await startMockOpenAI();
process.env.OPENAI_BASE_URL = mock.url;
const { buildApp } = await import('../src/server.js');
const { addPlayer, playerByToken, threadHistory } = await import('../src/store.js');
const { allLines } = await import('../src/memory.js');
const { ledger } = await import('../src/ai/ledger.js');
const { buildReport, formatReport } = await import('../src/ai/report.js');
const { handlePlayerText } = await import('../src/chat.js');
const { runBeat } = await import('../src/beats.js');

const app = buildApp();
await app.ready();
after(async () => { await app.close(); await mock.close(); });
const post = async (p, url, body) => (await app.inject({ method: 'POST', url: `/api/p/${p.token}${url}`, payload: body })).json();
const instructions = () => mock.log.clientSecrets.at(-1).session.instructions;

test('reconnect: a dropped call is superseded, memory and approvals carry over, nothing is awarded twice', async () => {
  const p = addPlayer({ name: 'Rae' });
  const c1 = await post(p, '/call', { character: 'lily' });
  await post(p, '/call/transcript', { callId: c1.callId, speaker: 'player', text: 'I know you were at the manor. The 911 call was you.', itemId: 'u1' });
  await post(p, '/call/transcript', { callId: c1.callId, speaker: 'character', text: 'okay... it was me. she was already dead.', itemId: 'a1' });
  assert.deepEqual(playerByToken(p.token).found, ['call911']);
  // The connection drops: no /call/end. The player calls back.
  const c2 = await post(p, '/call', { character: 'lily' });
  assert.notEqual(c1.callId, c2.callId);
  assert.ok(ledger.records().some((r) => r.type === 'call_ended' && r.callId === c1.callId && r.reason === 'superseded'));
  const instr = instructions();
  assert.match(instr, /The 911 call was you/, 'the new session remembers the dropped call');
  assert.match(instr, /YOU ALREADY ADMITTED THIS TO RAE/, 'the approval persists');
  // Old call id is dead; the new one works; repeating the confession does not duplicate evidence.
  assert.equal((await post(p, '/call/disclose', { callId: c1.callId, topic: 'call911' })).decision, 'stay_guarded');
  await post(p, '/call/transcript', { callId: c2.callId, speaker: 'character', text: 'like i said, it was me. she was already dead.', itemId: 'a1' });
  assert.equal(threadHistory(p.token, 'lily', 50).filter((m) => m.kind === 'evidence').length, 1);
  await post(p, '/call/end', { callId: c2.callId, character: 'lily' });
});

test('repeated accusations are remembered once, across texts and calls, without extra state changes', async () => {
  const p = addPlayer({ name: 'Acc' });
  for (let i = 0; i < 4; i++) {
    await handlePlayerText(p, 'ruth', 'You killed Dana. I know you did it.');
    await until(() => threadHistory(p.token, 'ruth', 50).filter((m) => m.from === 'character').length === i + 1);
  }
  const c = await post(p, '/call', { character: 'ruth' });
  await post(p, '/call/transcript', { callId: c.callId, speaker: 'player', text: 'You killed Dana, Ruth. Bingo ends at 8:30.', itemId: 'u1' });
  await post(p, '/call/end', { callId: c.callId, character: 'ruth' });
  await post(p, '/call', { character: 'ruth' });
  const instr = instructions();
  assert.equal((instr.match(/You killed Dana\. I know you did it\./g) || []).length, 1, 'deduplicated');
  assert.match(instr, /Bingo ends at 8:30/);
  assert.deepEqual(playerByToken(p.token).found, [], 'Ruth never hands out evidence');
  assert.equal(allLines().filter((l) => l.pid === p.pid && l.tags.includes('accusation')).length, 5);
});

test('a short playtest end to end produces a usable cost report', async () => {
  const ps = ['Maya', 'Noah', 'Iris', 'Theo'].map((name) => addPlayer({ name }));
  await runBeat('setup');
  for (const p of ps) {
    await handlePlayerText(p, 'ruth', 'Ruth, where were you on Thursday?');
    await handlePlayerText(p, 'teddy', 'Teddy, what time does bingo end at St. Agnes?');
  }
  await until(() => ps.every((p) => threadHistory(p.token, 'teddy', 20).some((m) => m.from === 'character')), 5000);
  const call = await post(ps[0], '/call', { character: 'marcus' });
  await post(ps[0], '/call/usage', { callId: call.callId, records: [{ kind: 'response', responseId: 'resp_pt1', status: 'completed', purpose: 'opening', usage: { input_tokens: 900, output_tokens: 130, input_token_details: { text_tokens: 900, audio_tokens: 0, cached_tokens: 0, cached_tokens_details: { text_tokens: 0, audio_tokens: 0 } }, output_token_details: { text_tokens: 30, audio_tokens: 100 } } }] });
  await post(ps[0], '/call/end', { callId: call.callId, character: 'marcus', seconds: 30 });
  const report = buildReport(ledger.records());
  assert.ok(report.sessions.count >= 4);
  assert.ok(report.byCapability.text.usd > 0 && report.byCapability.voice.usd > 0);
  assert.ok(report.byModel['gpt-4.1-mini'] && report.byModel['gpt-realtime-2.1-mini']);
  assert.ok(ps.every((p) => playerByToken(p.token).found.includes('bingo')), 'everyone who asked Teddy got the bingo evidence');
  const text = formatReport(report);
  assert.match(text, /typical \(median\)/);
  assert.match(text, /most expensive 5%/);
});

test('rollback: CONTEXT_MODE=legacy + OPENAI_REALTIME_MODEL=gpt-realtime reproduce the original prompts and session', async () => {
  process.env.CONTEXT_MODE = 'legacy';
  process.env.OPENAI_REALTIME_MODEL = 'gpt-realtime';
  try {
    const p = addPlayer({ name: 'Old' });
    const call = await post(p, '/call', { character: 'ruth' });
    const sent = mock.log.clientSecrets.at(-1).session;
    assert.equal(sent.model, 'gpt-realtime');
    assert.match(sent.instructions, /CASE FILE \(for your consistency only/);
    assert.equal(sent.audio.input.turn_detection.type, 'server_vad');
    assert.equal(sent.tools, undefined);
    assert.equal(sent.audio.input.noise_reduction, undefined);
    assert.equal(sent.max_output_tokens, undefined);
    assert.equal(call.openingRole, 'user', 'the original opening was sent as a user line');
    await post(p, '/call/end', { callId: call.callId, character: 'ruth' });
    await handlePlayerText(p, 'lily', 'hello lily');
    await until(() => threadHistory(p.token, 'lily', 10).some((m) => m.from === 'character'));
    assert.match(mock.log.chat.at(-1).messages[0].content, /TRUTH \(secret; only reveal pieces/);
  } finally {
    delete process.env.CONTEXT_MODE;
    delete process.env.OPENAI_REALTIME_MODEL;
  }
});
