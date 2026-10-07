// The shared call controller, fed recorded-style Realtime event sequences (no network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCallController } from '../src/shared/call-controller.js';

const tick = (ms) => new Promise((r) => setTimeout(r, ms));
const usageBlock = (audioTokens, extra = {}) => ({
  input_tokens: 1000, output_tokens: audioTokens + 20,
  input_token_details: { text_tokens: 1000, audio_tokens: 0, cached_tokens: 0, cached_tokens_details: { text_tokens: 0, audio_tokens: 0 } },
  output_token_details: { text_tokens: 20, audio_tokens: audioTokens }, ...extra,
});

function harness(opts = {}) {
  let clock = 1_000_000;
  const sent = [];
  const lines = [];
  const usage = [];
  const ended = [];
  const ctl = createCallController({
    send: (e) => sent.push(e),
    now: () => clock,
    clearedWaitMs: 5,
    transcriptWaitMs: 50,
    timing: { wrapUpAt: 100, maxSeconds: 140, idleSeconds: 30, goodbyeGraceMs: 500 },
    hooks: {
      transcript: (speaker, text, meta) => { lines.push({ speaker, text, ...meta }); return opts.notes ? { notes: opts.notes.splice(0) } : {}; },
      usage: (r) => usage.push(r),
      disclose: opts.disclose,
      end: (reason, summary) => ended.push({ reason, summary }),
    },
    opening: 'Answer the phone.',
    ...opts.ctl,
  });
  const advance = (ms) => { clock += ms; };
  // One complete assistant reply as OpenAI emits it over WebRTC.
  const reply = (rid, itemId, text, audioTokens = 100, { played = true } = {}) => {
    ctl.handle({ type: 'response.created', response: { id: rid } });
    ctl.handle({ type: 'response.output_item.added', response_id: rid, item: { id: itemId, type: 'message' } });
    ctl.handle({ type: 'output_audio_buffer.started', response_id: rid });
    ctl.handle({ type: 'response.output_audio_transcript.done', response_id: rid, item_id: itemId, transcript: text });
    ctl.handle({ type: 'response.done', response: { id: rid, status: 'completed', output: [{ type: 'message', id: itemId }], usage: usageBlock(audioTokens) } });
    if (played) ctl.handle({ type: 'output_audio_buffer.stopped', response_id: rid });
  };
  return { ctl, sent, lines, usage, ended, advance, reply, get clock() { return clock; } };
}

test('opening is sent once and a second response.create is never sent while one is active', () => {
  const h = harness();
  h.ctl.start();
  h.ctl.start();
  assert.equal(h.sent.filter((e) => e.type === 'response.create').length, 1);
  assert.equal(h.sent[0].item.role, 'system');
  h.ctl.handle({ type: 'response.created', response: { id: 'r1' } });
  // A rejected create (server VAD raced us) is queued and retried after the active response finishes.
  h.ctl.handle({ type: 'error', error: { code: 'conversation_already_has_active_response' } });
  assert.equal(h.sent.filter((e) => e.type === 'response.create').length, 1);
  h.ctl.handle({ type: 'response.done', response: { id: 'r1', status: 'completed', output: [], usage: usageBlock(0) } });
  assert.equal(h.sent.filter((e) => e.type === 'response.create').length, 2);
});

test('usage is reported once per response, after playback, with latency and heard audio', () => {
  const h = harness();
  h.ctl.start();
  h.ctl.handle({ type: 'input_audio_buffer.speech_stopped' });
  h.advance(700);
  h.reply('r1', 'i1', 'Hello there, sweetheart.', 60);
  h.ctl.handle({ type: 'response.done', response: { id: 'r1', status: 'completed', output: [], usage: usageBlock(60) } });
  assert.equal(h.usage.length, 1);
  assert.equal(h.usage[0].responseId, 'r1');
  assert.equal(h.usage[0].audioGeneratedMs, 3000);
  assert.equal(h.usage[0].audioPlayedMs, 3000);
  assert.deepEqual(h.lines.map((l) => l.text), ['Hello there, sweetheart.']);
});

test('barge-in after generation finished: memory keeps only the words the player heard', () => {
  const h = harness();
  h.ctl.start();
  h.reply('r1', 'i1', 'one two three four five six seven eight nine ten', 200, { played: false }); // 10 s generated
  assert.equal(h.lines.length, 0, 'not saved until we know what was heard');
  h.ctl.handle({ type: 'input_audio_buffer.speech_started' });
  h.ctl.handle({ type: 'output_audio_buffer.cleared', response_id: 'r1' });
  h.ctl.handle({ type: 'conversation.item.truncated', item_id: 'i1', audio_end_ms: 3000 });
  assert.equal(h.lines.length, 1);
  assert.equal(h.lines[0].text, 'one two three—');
  assert.equal(h.lines[0].interrupted, true);
  assert.equal(h.usage[0].audioPlayedMs, 3000);
  assert.equal(h.ctl.summary().interruptedLines, 1);
});

test('barge-in without a truncation event falls back to measured playback time', async () => {
  const h = harness();
  h.ctl.start();
  h.reply('r1', 'i1', 'a b c d e f g h i j', 200, { played: false });
  h.advance(5000);
  h.ctl.handle({ type: 'output_audio_buffer.cleared', response_id: 'r1' });
  await tick(20);
  assert.equal(h.lines[0].text, 'a b c d e—');
});

test('guarded topic: waits for the caller transcript, asks the server, then answers', async () => {
  const asked = [];
  const h = harness({ disclose: async (topic, recent) => { asked.push({ topic, recent }); return { decision: 'open_up', memory: 'You made the call.' }; } });
  h.ctl.start();
  h.ctl.handle({ type: 'response.done', response: { id: 'r0', status: 'completed', output: [], usage: usageBlock(0) } });
  h.ctl.handle({ type: 'input_audio_buffer.speech_stopped' });
  h.ctl.handle({ type: 'response.created', response: { id: 'r1' } });
  h.ctl.handle({ type: 'response.function_call_arguments.done', response_id: 'r1', call_id: 'c1', name: 'check_guarded_topic', arguments: '{"topic":"call911"}' });
  // Same call id again in response.done: handled once.
  h.ctl.handle({ type: 'response.done', response: { id: 'r1', status: 'completed', output: [{ type: 'function_call', call_id: 'c1', name: 'check_guarded_topic', arguments: '{"topic":"call911"}' }], usage: usageBlock(0) } });
  await tick(5);
  h.ctl.handle({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'u1', transcript: 'did you make the 911 call?' });
  await tick(80);
  assert.equal(asked.length, 1);
  assert.equal(asked[0].topic, 'call911');
  assert.match(asked[0].recent, /911/);
  const out = h.sent.find((e) => e.item?.type === 'function_call_output');
  assert.equal(JSON.parse(out.item.output).decision, 'open_up');
  assert.equal(h.sent.filter((e) => e.type === 'response.create').length, 2, 'one follow-up response');
});

test('engine approval notes from the caller\'s own words are added quietly (no extra response)', async () => {
  const h = harness({ notes: ['(Note: you may now admit X)'] });
  h.ctl.start();
  h.ctl.handle({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'u1', transcript: 'what about the lullaby?' });
  await tick(5);
  const note = h.sent.find((e) => e.item?.role === 'system' && /may now admit/.test(e.item.content[0].text));
  assert.ok(note);
  assert.equal(h.sent.filter((e) => e.type === 'response.create').length, 1);
});

test('wrap-up cue, then the character hangs up after the goodbye has played', () => {
  const h = harness();
  h.ctl.start();
  h.reply('r1', 'i1', 'Hello.', 40);
  h.advance(101_000);
  assert.equal(h.ctl.tick(), null);
  const wrap = h.sent.find((e) => e.item?.role === 'system' && /nearly over/.test(e.item.content[0].text));
  assert.ok(wrap, 'wrap-up note sent');
  h.reply('r2', 'i2', 'The line is fading... Find me before midnight.', 80, { played: false });
  h.advance(100);
  assert.equal(h.ctl.tick(), null, 'still playing');
  h.ctl.handle({ type: 'output_audio_buffer.stopped', response_id: 'r2' });
  h.advance(600);
  assert.equal(h.ctl.tick(), 'character_hung_up');
  assert.equal(h.ended[0].reason, 'character_hung_up');
});

test('idle calls hang up; busy calls do not; the hard limit always applies', () => {
  const idle = harness();
  idle.ctl.start();
  idle.reply('r1', 'i1', 'Hello?', 40);
  idle.advance(31_000);
  assert.equal(idle.ctl.tick(), 'idle');

  const busy = harness();
  busy.ctl.start();
  busy.ctl.handle({ type: 'response.created', response: { id: 'r1' } });
  busy.advance(31_000);
  assert.equal(busy.ctl.tick(), null);
  busy.advance(110_000);
  assert.equal(busy.ctl.tick(), 'max_duration');
});

test('a call that ends mid-reply keeps what had been heard and still reports usage', () => {
  const h = harness();
  h.ctl.start();
  h.reply('r1', 'i1', 'w1 w2 w3 w4 w5 w6 w7 w8 w9 w10', 200, { played: false });
  h.advance(2000);
  h.ctl.end('player_hung_up');
  assert.equal(h.lines[0].text, 'w1 w2—');
  assert.equal(h.usage.length, 1);
  assert.equal(h.ended[0].reason, 'player_hung_up');
});

test('transcription usage is reported once per item', () => {
  const h = harness();
  h.ctl.start();
  const evt = { type: 'conversation.item.input_audio_transcription.completed', item_id: 'u9', transcript: 'hi', usage: { type: 'tokens', input_tokens: 12 } };
  h.ctl.handle(evt);
  h.ctl.handle(evt);
  assert.equal(h.usage.filter((u) => u.kind === 'transcription').length, 1);
});
