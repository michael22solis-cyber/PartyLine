// Cost simulator: replays a calibrated short playtest through the REAL prompt builders (legacy vs bounded) and the
// billing model in bench/billing-model.js. Prompt token counts are measured with the o200k tokenizer; everything about
// how the provider bills is a stated model assumption, checked against the real baseline export.
//
//   npm run bench            -> prints tables, writes bench/results/latest.{json,md}
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.BLACKWOOD_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bw-sim-'));
process.env.USAGE_LEDGER = 'off';
const { billInput, tokens, RATES } = await import('./billing-model.js');
const { PLAYER_LINES, REPLIES, NAMES, pick } = await import('./corpus.js');
const { costOf } = await import('../src/ai/pricing.js');
const store = await import('../src/store.js');
const memory = await import('../src/memory.js');
const ctx = await import('../src/context.js');
const { buildLegacyInstructions } = await import('../src/characters/legacy.js');
const { CHARACTERS } = await import('../src/characters/index.js');
const baseline = JSON.parse(fs.readFileSync(new URL('../test/fixtures/baseline-export.json', import.meta.url)));

// ---------------- the scenario (calibrated to the baseline export) ----------------
// 6 calls, 34 caller turns, 40 responses, 11 text replies, ~55 s of caller speech, ~190 s of character speech.
// "Six Realtime requests" need not mean six calls: scenario B (ten shorter calls) is also tried, and the one that
// fits the export's token buckets best is used for the headline numbers.
const SCENARIOS = {
  A: [
    { npc: 'caretaker', p: 0, openingSec: 17, turns: 3, replySec: 5.5 },
    { npc: 'caretaker', p: 1, openingSec: 17, turns: 2, replySec: 5.5 },
    { npc: 'ruth', p: 0, openingSec: 3.5, turns: 8, replySec: 3.5 },
    { npc: 'lily', p: 1, openingSec: 2.5, turns: 7, replySec: 3.0 },
    { npc: 'teddy', p: 2, openingSec: 4, turns: 8, replySec: 3.6 },
    { npc: 'marcus', p: 3, openingSec: 2.5, turns: 6, replySec: 3.2 },
  ],
  B: [
    { npc: 'caretaker', p: 0, openingSec: 16, turns: 2, replySec: 5 },
    { npc: 'caretaker', p: 1, openingSec: 16, turns: 2, replySec: 5 },
    { npc: 'caretaker', p: 2, openingSec: 16, turns: 1, replySec: 5 },
    { npc: 'ruth', p: 0, openingSec: 3.5, turns: 5, replySec: 3.4 },
    { npc: 'ruth', p: 3, openingSec: 3.5, turns: 4, replySec: 3.4 },
    { npc: 'lily', p: 1, openingSec: 2.5, turns: 4, replySec: 3.0 },
    { npc: 'lily', p: 2, openingSec: 2.5, turns: 3, replySec: 3.0 },
    { npc: 'teddy', p: 2, openingSec: 4, turns: 4, replySec: 3.4 },
    { npc: 'teddy', p: 3, openingSec: 4, turns: 3, replySec: 3.4 },
    { npc: 'marcus', p: 3, openingSec: 2.5, turns: 6, replySec: 3.0 },
  ],
};
let CALLS = SCENARIOS.A;
const TEXTS = [{ p: 0, npc: 'ruth', n: 3 }, { p: 1, npc: 'lily', n: 3 }, { p: 2, npc: 'teddy', n: 3 }, { p: 3, npc: 'marcus', n: 2 }];
const USER_SEC = 1.6;
const TEXT_OUT_TOKENS = 45; // average reply length implied by the export (~500 output tokens over 11 replies)

function resetWorld() {
  store.resetGame();
  memory.resetMemory();
  return NAMES.slice(0, 4).map((name) => store.addPlayer({ name }));
}

// Text replies: measured prompt tokens with each builder; billed with the chat cache model.
function simulateTexts(players, mode, chatHistory) {
  process.env.CONTEXT_MODE = mode;
  const out = [];
  for (const { p, npc, n } of TEXTS) {
    const player = players[p];
    for (let i = 0; i < n; i++) {
      const said = pick(PLAYER_LINES[npc], i + 1);
      store.addMessage({ token: player.token, thread: npc, from: 'player', text: said });
      memory.remember({ player: player.name, pid: player.pid, npc, character: CHARACTERS[npc].name, speaker: 'player', text: `(text) ${said}`, channel: 'text' });
      const { messages } = ctx.buildTextPrompt({ npc, player, thread: store.threadHistory(player.token, npc, 30) });
      const segs = messages.map((m, k) => ({ id: `${k}:${m.content}`, kind: 'text', tokens: tokens(m.content) + 4 }));
      const best = chatHistory.reduce((a, b) => (lcpLen(a, segs) >= lcpLen(b, segs) ? a : b), []);
      const bill = billInput(segs, best);
      chatHistory.push(segs);
      out.push({ npc, textIn: bill.textIn, textInCached: bill.textInCached, textOut: TEXT_OUT_TOKENS, promptTokens: bill.total });
      const reply = pick(REPLIES[npc], i + 1);
      store.addMessage({ token: player.token, thread: npc, from: 'character', text: reply });
      memory.remember({ player: player.name, pid: player.pid, npc, character: CHARACTERS[npc].name, speaker: 'character', text: `(text) ${reply}`, channel: 'text' });
    }
  }
  return out;
}
const lcpLen = (a, b) => { let t = 0; for (let i = 0; i < Math.min(a.length, b.length); i++) { if (a[i].id !== b[i].id) break; t += a[i].tokens; } return t; };

/**
 * One call. opts: mode (legacy|bounded), replyScale, reasoning (tokens per response), padTo (pad the stable voice
 * prefix to N tokens), crossCache (shared prefix cache), truncate ({ limit, ratio }) for retention-ratio truncation,
 * wrapAt (seconds: cue the goodbye then hang up).
 */
function simulateCall(call, players, opts, prefixCache) {
  const player = players[call.p];
  const c = CHARACTERS[call.npc];
  process.env.CONTEXT_MODE = opts.mode;
  let instructions;
  let tools = [];
  if (opts.mode === 'legacy') instructions = buildLegacyInstructions(call.npc, player.name, memory.summary(), 'voice');
  else ({ instructions, tools } = ctx.buildVoiceSetup({ npc: call.npc, player }));
  let instrTokens = tokens(instructions);
  const stableTokens = opts.mode === 'legacy' ? 0 : tokens(ctx.stableBlock(call.npc, 'voice'));
  const padding = opts.padTo && opts.mode !== 'legacy' ? Math.max(0, opts.padTo - stableTokens - (tools.length ? tokens(JSON.stringify(tools)) : 0)) : 0;
  instrTokens += padding;
  // The stable part (plus padding and tools) is one segment shared across sessions of the same character; the
  // player-specific tail is another.
  const stableId = `stable:${opts.mode}:${call.npc}:${padding}`;
  const head = opts.mode === 'legacy'
    ? [{ id: `instr:${instructions}`, kind: 'text', tokens: instrTokens }]
    : [{ id: stableId, kind: 'text', tokens: stableTokens + padding + (tools.length ? tokens(JSON.stringify(tools)) : 0) },
      { id: `dyn:${instructions}`, kind: 'text', tokens: instrTokens - stableTokens - padding }];
  const opening = opts.mode === 'legacy' ? c.opening(player.name) : c.opening(player.name);
  const items = [{ id: 'opening', kind: 'text', tokens: tokens(opening) + 4 }];
  const responses = [];
  let prev = (opts.crossCache && prefixCache.get(head[0].id)) || [];
  let elapsed = 0;
  const totalResponses = call.turns + 1;
  let wrapped = false;
  for (let k = 0; k < totalResponses; k++) {
    if (k > 0) {
      const userTokens = Math.round(USER_SEC * RATES.userAudioTokPerSec);
      items.push({ id: `u${k}`, kind: 'audio', tokens: userTokens });
      elapsed += USER_SEC + 0.8;
    }
    if (opts.maxSec && elapsed >= opts.maxSec) break; // hard hang-up
    if (opts.wrapAt && !wrapped && elapsed >= opts.wrapAt) { wrapped = true; items.push({ id: 'wrap', kind: 'text', tokens: 24 }); }
    let segs = [...head, ...items];
    if (opts.truncate) {
      const post = items.reduce((s, x) => s + x.tokens, 0);
      if (post > opts.truncate.limit) {
        // Drop the oldest items until we are under ratio * limit (the cache breaks at the first dropped item).
        let keep = items.slice();
        while (keep.reduce((s, x) => s + x.tokens, 0) > opts.truncate.limit * opts.truncate.ratio) keep.shift();
        items.splice(0, items.length, ...keep);
        segs = [...head, ...items];
      }
    }
    const bill = billInput(segs, prev);
    prev = segs;
    if (opts.crossCache && k === 0) prefixCache.set(head[0].id, segs);
    const sec = (k === 0 ? call.openingSec : call.replySec * (opts.replyScale ?? 1));
    const audioOut = Math.round(sec * RATES.assistantAudioTokPerSec);
    const replyText = k === 0 ? pick(REPLIES[call.npc], 0) : pick(REPLIES[call.npc], k);
    const textOut = Math.round(tokens(replyText) * (sec / Math.max(1, replyText.split(' ').length / 2.6))) + (opts.reasoning || 0);
    responses.push({ ...bill, audioOut, textOut });
    items.push({ id: `a${k}`, kind: 'audio', tokens: audioOut });
    elapsed += sec;
    // memory, so later calls see a growing game
    if (k > 0) memory.remember({ player: player.name, pid: player.pid, npc: call.npc, character: c.name, speaker: 'player', text: pick(PLAYER_LINES[call.npc], k), channel: 'call' });
    memory.remember({ player: player.name, pid: player.pid, npc: call.npc, character: c.name, speaker: 'character', text: replyText, channel: 'call' });
    if (wrapped && k > 0) break; // the character said goodbye and hung up
  }
  return { npc: call.npc, responses, instrTokens: instrTokens + (tools.length ? tokens(JSON.stringify(tools)) : 0), userTurns: responses.length - 1 };
}

function sum(rs, keys = ['textIn', 'textInCached', 'audioIn', 'audioInCached', 'textOut', 'audioOut']) {
  const out = Object.fromEntries(keys.map((k) => [k, 0]));
  for (const r of rs) for (const k of keys) out[k] += r[k] || 0;
  return out;
}

function runPlaytest(opts) {
  const players = resetWorld();
  const prefixCache = new Map();
  const chatHistory = [];
  // Night 1: the Caretaker calls first, then players text, then they call suspects.
  const calls = [];
  for (const call of CALLS.filter((c) => c.npc === 'caretaker')) calls.push(simulateCall(call, players, opts, prefixCache));
  const texts = simulateTexts(players, opts.textMode || opts.mode, chatHistory);
  for (const call of CALLS.filter((c) => c.npc !== 'caretaker')) calls.push(simulateCall(call, players, opts, prefixCache));
  const voice = sum(calls.flatMap((c) => c.responses));
  const userTurns = calls.reduce((s, c) => s + c.userTurns, 0);
  const transcription = { audioIn: Math.round(userTurns * USER_SEC * RATES.userAudioTokPerSec), textOut: userTurns * 6 };
  const text = sum(texts, ['textIn', 'textInCached', 'textOut']);
  const usd = {
    voice: costOf(opts.voiceModel, voice).usd,
    text: costOf(opts.textModel || 'gpt-4.1-mini', text).usd,
    transcription: costOf('gpt-4o-mini-transcribe', transcription).usd,
  };
  usd.total = usd.voice + usd.text + usd.transcription;
  return {
    voice, text, usd, responses: calls.reduce((s, c) => s + c.responses.length, 0), userTurns,
    perResponseTextIn: Math.round((voice.textIn + voice.textInCached) / calls.reduce((s, c) => s + c.responses.length, 0)),
    instrTokens: Object.fromEntries(calls.map((c, i) => [`${c.npc}#${i}`, c.instrTokens])),
    textPrompt: { avg: Math.round(texts.reduce((s, t) => s + t.promptTokens, 0) / texts.length), max: Math.max(...texts.map((t) => t.promptTokens)) },
  };
}

// A long, chatty call (the expensive tail): the player keeps talking to Ruth until something stops the call.
function longCall(opts, turns = 60) {
  const players = resetWorld();
  for (let i = 0; i < 30; i++) memory.remember({ player: 'Noah', pid: players[1].pid, npc: 'teddy', character: 'Teddy Fisk', speaker: i % 2 ? 'character' : 'player', text: pick(i % 2 ? REPLIES.teddy : PLAYER_LINES.teddy, i), channel: 'text' });
  const r = simulateCall({ npc: 'ruth', p: 0, openingSec: 3.5, turns, replySec: 5 }, players, opts, new Map());
  const v = sum(r.responses);
  return { usd: costOf(opts.voiceModel, v).usd, responses: r.responses.length, voice: v };
}

// ---------------- runs ----------------
const LEGACY_RT = { mode: 'legacy', voiceModel: 'gpt-realtime' };
const real = baseline.models['gpt-realtime-2025-08-28'].buckets;
const fitError = (v) => Object.keys(real).reduce((e, k) => e + Math.abs(v[k] - real[k]) / real[k], 0) / Object.keys(real).length;
const fits = {};
for (const [name, calls] of Object.entries(SCENARIOS)) {
  CALLS = calls;
  const r = runPlaytest(LEGACY_RT);
  fits[name] = { meanAbsBucketError: Number(fitError(r.voice).toFixed(3)), costError: Number(((r.usd.voice - baseline.models['gpt-realtime-2025-08-28'].cost) / baseline.models['gpt-realtime-2025-08-28'].cost).toFixed(3)) };
}
const bestScenario = Object.entries(fits).sort((a, b) => a[1].meanAbsBucketError - b[1].meanAbsBucketError)[0][0];
CALLS = SCENARIOS[bestScenario];
const results = {};
results.baseline = runPlaytest(LEGACY_RT);
results.modelSwapOnly = runPlaytest({ ...LEGACY_RT, voiceModel: 'gpt-realtime-2.1-mini' });
results.implemented = runPlaytest({ mode: 'bounded', voiceModel: 'gpt-realtime-2.1-mini' });
results.implementedCrossCache = runPlaytest({ mode: 'bounded', voiceModel: 'gpt-realtime-2.1-mini', crossCache: true });
results.paddedTo1100 = runPlaytest({ mode: 'bounded', voiceModel: 'gpt-realtime-2.1-mini', padTo: 1100 });
results.paddedTo1100CrossCache = runPlaytest({ mode: 'bounded', voiceModel: 'gpt-realtime-2.1-mini', padTo: 1100, crossCache: true });
results.reasoning100 = runPlaytest({ mode: 'bounded', voiceModel: 'gpt-realtime-2.1-mini', reasoning: 100 });
results.brevity20 = runPlaytest({ mode: 'bounded', voiceModel: 'gpt-realtime-2.1-mini', replyScale: 0.8 });
results.textLegacyOnMini = runPlaytest({ mode: 'bounded', textMode: 'legacy', voiceModel: 'gpt-realtime-2.1-mini' });

const MINI = { mode: 'bounded', voiceModel: 'gpt-realtime-2.1-mini' };
const tail = {
  'before: in-app call, 240 s cap (gpt-realtime)': longCall({ ...LEGACY_RT, maxSec: 240 }),
  'before: phone call in, no cap, 8 min (gpt-realtime)': longCall({ ...LEGACY_RT, maxSec: 480 }, 80),
  'after: 240 s cap, no wrap-up (2.1-mini)': longCall({ ...MINI, maxSec: 240 }),
  'after: wrap-up at 200 s, goodbye, hang-up (implemented)': longCall({ ...MINI, maxSec: 240, wrapAt: 200 }),
  'experiment: + retention-ratio truncation (2,000 tokens, 0.6)': longCall({ ...MINI, maxSec: 240, wrapAt: 200, truncate: { limit: 2000, ratio: 0.6 } }),
};

// Per-player reveal call (scripted) live vs recording: ~26 s of speech, one caller turn.
const revealLive = (() => {
  const players = resetWorld();
  const r = simulateCall({ npc: 'caretaker_reveal', p: 0, openingSec: 26, turns: 1, replySec: 4 }, players, { mode: 'bounded', voiceModel: 'gpt-realtime-2.1-mini' }, new Map());
  return costOf('gpt-realtime-2.1-mini', sum(r.responses)).usd;
})();

// Chained pipeline projection for the same playtest (STT -> text model -> TTS), not implemented.
const chained = (() => {
  const b = results.implemented;
  const speechSec = b.voice.audioOut / RATES.assistantAudioTokPerSec;
  const stt = (b.userTurns * USER_SEC / 60) * 0.0045; // gpt-transcribe per-minute rate
  const llm = costOf('gpt-4.1-mini', { textIn: b.responses * 750, textOut: b.responses * 40 }).usd;
  const tts = costOf('gpt-4o-mini-tts', { textIn: b.responses * 60, audioOut: Math.round(speechSec * 20.8) }).usd;
  return { usd: stt + llm + tts, stt, llm, tts };
})();

// ---------------- calibration vs the real export ----------------
const calib = Object.keys(real).map((k) => ({ bucket: k, export: real[k], simulated: results.baseline.voice[k], diffPct: Math.round(((results.baseline.voice[k] - real[k]) / real[k]) * 100) }));
const realVoiceUsd = baseline.models['gpt-realtime-2025-08-28'].cost;

const f = (x) => `$${x.toFixed(4)}`;
const rows = [
  ['Baseline as simulated (legacy prompts, gpt-realtime)', results.baseline],
  ['Model swap only (legacy prompts, gpt-realtime-2.1-mini)', results.modelSwapOnly],
  ['Implemented (bounded prompts + tools, 2.1-mini)', results.implemented],
  ['  ...with cross-session prefix cache hits', results.implementedCrossCache],
  ['Experiment: stable voice prefix padded to 1,100 tokens', results.paddedTo1100],
  ['  ...padded + cross-session cache hits', results.paddedTo1100CrossCache],
  ['Sensitivity: +100 reasoning tokens / response', results.reasoning100],
  ['Sensitivity: replies 20% shorter (untested)', results.brevity20],
];
const md = [];
md.push(`## Simulated short playtest (scenario ${bestScenario}: ${CALLS.length} calls, ${results.baseline.userTurns} caller turns, ${results.baseline.responses} voice responses, 11 texts)`, '');
md.push(`Scenario fit to the export (mean absolute error across the six Realtime buckets): ${Object.entries(fits).map(([k, v]) => `${k} ${(v.meanAbsBucketError * 100).toFixed(0)}% (cost ${(v.costError * 100).toFixed(0)}%)`).join(', ')}.`, '');
md.push('| Variant | Voice | Text | Transcription | Total | text-in/response | text prompt avg (max) |', '|---|---:|---:|---:|---:|---:|---:|');
for (const [name, r] of rows) md.push(`| ${name} | ${f(r.usd.voice)} | ${f(r.usd.text)} | ${f(r.usd.transcription)} | **${f(r.usd.total)}** | ${r.perResponseTextIn} | ${r.textPrompt.avg} (${r.textPrompt.max}) |`);
md.push('', 'Excludes one-time TTS asset generation ($0.01212 in the export).', '');
md.push('## Calibration: simulated baseline vs the real export (gpt-realtime buckets)', '', '| Bucket | Export | Simulated | Diff |', '|---|---:|---:|---:|');
for (const c of calib) md.push(`| ${c.bucket} | ${c.export} | ${c.simulated} | ${c.diffPct}% |`);
md.push(`| cost | ${f(realVoiceUsd)} | ${f(results.baseline.usd.voice)} | ${Math.round(((results.baseline.usd.voice - realVoiceUsd) / realVoiceUsd) * 100)}% |`, '');
md.push('## Expensive tail: one player who keeps talking to Ruth', '', '| Variant | Cost | Responses |', '|---|---:|---:|');
for (const [k, v] of Object.entries(tail)) md.push(`| ${k} | ${f(v.usd)} | ${v.responses} |`);
md.push('', `Scripted midnight reveal per player: live on 2.1-mini ${f(revealLive)} vs recording $0.0000.`, '');
md.push(`Chained pipeline projection for the same playtest (STT + gpt-4.1-mini + gpt-4o-mini-tts): ${f(chained.usd)} (STT ${f(chained.stt)}, LLM ${f(chained.llm)}, TTS ${f(chained.tts)}); not implemented: adds 1-2 s per turn and loses native barge-in.`);
const report = md.join('\n');
console.log(report);
fs.mkdirSync(new URL('./results/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('./results/latest.md', import.meta.url), `${report}\n`);
fs.writeFileSync(new URL('./results/latest.json', import.meta.url), JSON.stringify({ scenario: bestScenario, fits, results, tail, revealLive, chained, calib }, null, 2));
memory.flushMemory();
