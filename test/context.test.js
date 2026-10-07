// Knowledge boundaries, premature disclosure, cross-player leakage, budgets and memory retention of the prompts.
import { dataDir } from './helpers/env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encode } from 'gpt-tokenizer/encoding/o200k_base';

process.env.USAGE_LEDGER = 'off';
const { addPlayer, addMessage, threadHistory, updatePlayer, playerByToken } = await import('../src/store.js');
const { remember } = await import('../src/memory.js');
const ctx = await import('../src/context.js');
const { TOPICS, topicsFor } = await import('../src/secrets.js');
const { approveFromPlayerText } = await import('../src/disclosure.js');
const { CHARACTERS } = await import('../src/characters/index.js');
const { buildLegacyInstructions } = await import('../src/characters/legacy.js');
const { CASE_FILE } = await import('../src/characters/caseFile.js');

const maya = addPlayer({ name: 'Maya' });
const noah = addPlayer({ name: 'Noah' });
const NPCS = Object.keys(CHARACTERS);
const allText = (msgs) => msgs.map((m) => m.content).join('\n');
const tok = (s) => encode(s).length;

// Lines of the secret TRUTH that no character should ever receive in bounded mode.
const TRUTH_MARKERS = [/stealing the family/i, /pushed her down the stairs/i, /buried him under the cellar floor/i, /Ruth went to the manor humming/i, /Truth: you left at 7:10/i];

function promptsFor(npc, player) {
  const out = { voice: ctx.buildVoiceSetup({ npc, player }).instructions + JSON.stringify(ctx.voiceTools(npc)) };
  if (CHARACTERS[npc].textable) {
    out.text = allText(ctx.buildTextPrompt({ npc, player, thread: [{ from: 'player', text: 'hi', at: new Date().toISOString() }] }).messages);
    out.group = allText(ctx.buildGroupPrompt({ npc, player, setting: 'GROUP', transcript: ['Maya: hi'], ask: (t) => t }));
    out.nudge = allText(ctx.buildNudgePrompt({ npc, player, direction: 'say hi' }));
  }
  return out;
}

test('no character receives the secret TRUTH, and no locked fact before the engine approves it', () => {
  for (const npc of NPCS) {
    for (const [mode, text] of Object.entries(promptsFor(npc, maya))) {
      for (const m of TRUTH_MARKERS) assert.doesNotMatch(text, m, `${npc}/${mode} leaks ${m}`);
      for (const t of TOPICS) assert.ok(!text.includes(t.fact), `${npc}/${mode} contains locked fact ${t.id}`);
    }
  }
  // The caretaker never gets the killer's name before the reveal; suspects other than Ruth are never told who did it.
  assert.doesNotMatch(promptsFor('caretaker', maya).voice, /\bruth\b/i);
  for (const npc of ['marcus', 'lily', 'teddy']) assert.doesNotMatch(promptsFor(npc, maya).voice, /ruth.{0,20}(killed|pushed|buried|murder)/i);
});

test('legacy prompts (the rollback path) still carry the full case file, as before', () => {
  const legacy = buildLegacyInstructions('marcus', 'Maya', '', 'text');
  assert.ok(legacy.includes(CASE_FILE.trim().slice(0, 60)));
  assert.match(legacy, /pushed her down the stairs/);
});

test('an approval is scoped to one player and one character (no cross-player or cross-character leakage)', () => {
  const approved = approveFromPlayerText(maya, 'lily', 'Lily, did you make the anonymous 911 call?');
  assert.deepEqual(approved.map((t) => t.id), ['call911']);
  const fact = topicsFor('lily').find((t) => t.id === 'call911').fact;
  const now = ctx.buildTextPrompt({ npc: 'lily', player: playerByToken(maya.token), thread: [], approvedNow: approved });
  assert.match(allText(now.messages), /YOU MAY NOW ADMIT THIS TO MAYA/);
  assert.ok(allText(now.messages).includes(fact));
  // Later turns: consistent, not re-announced as new.
  const later = allText(ctx.buildTextPrompt({ npc: 'lily', player: playerByToken(maya.token), thread: [] }).messages);
  assert.match(later, /ALREADY ADMITTED THIS TO MAYA/);
  // Noah never earned it; other characters never hear Lily's confession.
  assert.ok(!Object.values(promptsFor('lily', noah)).some((p) => p.includes(fact)));
  for (const npc of NPCS.filter((n) => n !== 'lily')) assert.ok(!Object.values(promptsFor(npc, maya)).some((p) => p.includes(fact)), npc);
  // Approving twice changes nothing.
  assert.deepEqual(approveFromPlayerText(maya, 'lily', 'about that 911 call again'), []);
});

test('stable blocks are identical for every player (cacheable); only the dynamic block differs', () => {
  for (const npc of ['ruth', 'marcus', 'lily', 'teddy']) {
    const a = ctx.buildTextPrompt({ npc, player: maya, thread: [] }).messages[0].content;
    const b = ctx.buildTextPrompt({ npc, player: noah, thread: [] }).messages[0].content;
    assert.equal(a, b);
    assert.doesNotMatch(a, /Maya|Noah/);
  }
});

test('long conversations stay within the text budget and keep accusations, lies and promises', async () => {
  const p = addPlayer({ name: 'Iris' });
  const t0 = Date.now() - 3 * 3600_000;
  const at = (i) => new Date(t0 + i * 60_000).toISOString();
  // Early, important exchanges...
  const early = [
    ['player', 'You were lying about bingo. It ends at 8:30, I know you did it.'],
    ['character', 'Sweetheart, I was at St. Agnes bingo until 10, God bless.'],
    ['player', 'I promise I will find out what is under that cellar floor.'],
  ];
  // ...then a long stretch of small talk with Ruth and lots of activity from other players.
  let i = 0;
  for (const [speaker, text] of early) {
    addMessage({ token: p.token, thread: 'ruth', from: speaker === 'player' ? 'player' : 'character', text });
    remember({ player: 'Iris', pid: p.pid, npc: 'ruth', character: 'Ruth Calloway', speaker, text: `(text) ${text}`, channel: 'text', at: at(i++) });
  }
  for (let k = 0; k < 60; k++) {
    const speaker = k % 2 ? 'character' : 'player';
    const text = speaker === 'player' ? `How is the weather out by the manor tonight, part ${k}?` : `Oh, chilly, dear. Bundle up, part ${k}.`;
    addMessage({ token: p.token, thread: 'ruth', from: speaker === 'player' ? 'player' : 'character', text });
    remember({ player: 'Iris', pid: p.pid, npc: 'ruth', character: 'Ruth Calloway', speaker, text: `(text) ${text}`, channel: 'text', at: at(i++) });
  }
  for (let k = 0; k < 150; k++) remember({ player: 'Noah', pid: noah.pid, npc: 'teddy', character: 'Teddy Fisk', speaker: 'player', text: `random chatter ${k} about ghosts and the tour schedule`, channel: 'text', at: at(i++) });
  const { messages, stats } = ctx.buildTextPrompt({ npc: 'ruth', player: playerByToken(p.token), thread: threadHistory(p.token, 'ruth', 30) });
  const total = messages.reduce((s, m) => s + tok(m.content) + 4, 0);
  assert.ok(total <= 800, `text prompt ${total} tokens`);
  assert.ok(stats.historyKept >= 2);
  const mem = messages[1].content;
  assert.match(mem, /lying about bingo/, 'accusation retained');
  assert.match(mem, /promise I will find out/, 'promise retained');
  assert.match(mem, /until 10/, 'the lie Ruth told is retained');
  assert.doesNotMatch(mem, /random chatter/, 'unrelated chatter about another character is dropped');
  // The legacy prompt for the same state is much larger.
  const legacyTok = tok(buildLegacyInstructions('ruth', 'Iris', (await import('../src/memory.js')).summary(), 'text'));
  assert.ok(legacyTok > total * 2, `legacy ${legacyTok} vs bounded ${total}`);
});

test('voice instructions stay within budget; tools exist only for characters with guarded topics', () => {
  for (const npc of NPCS) {
    const v = ctx.buildVoiceSetup({ npc, player: playerByToken(maya.token) });
    const t = tok(v.instructions) + (v.tools.length ? tok(JSON.stringify(v.tools)) : 0);
    assert.ok(t <= 1600, `${npc} voice setup ${t} tokens`);
    assert.equal(v.tools.length > 0, topicsFor(npc).length > 0, npc);
  }
});

test('memory: what a player told one character reaches the others ("the house is listening")', () => {
  const p = addPlayer({ name: 'Zed' });
  updatePlayer(p.token, {});
  remember({ player: 'Zed', pid: p.pid, npc: 'teddy', character: 'Teddy Fisk', speaker: 'player', text: 'I think Ruth killed Dana.', channel: 'call' });
  const ruth = ctx.buildVoiceSetup({ npc: 'ruth', player: playerByToken(p.token) }).instructions;
  assert.match(ruth, /Zed told Teddy/);
  assert.match(ruth, /I think Ruth killed Dana/);
  assert.ok(dataDir);
});
