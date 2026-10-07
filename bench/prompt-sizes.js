// Measured prompt sizes (o200k tokenizer) for every character, legacy vs bounded, in a realistic mid-game state:
// four players, ~120 lines of shared memory, a 20-message text thread.   node bench/prompt-sizes.js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.BLACKWOOD_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bw-sizes-'));
process.env.USAGE_LEDGER = 'off';
const { encode } = await import('gpt-tokenizer/encoding/o200k_base');
const { PLAYER_LINES, REPLIES, NAMES, pick } = await import('./corpus.js');
const store = await import('../src/store.js');
const memory = await import('../src/memory.js');
const ctx = await import('../src/context.js');
const { buildLegacyInstructions } = await import('../src/characters/legacy.js');
const { CHARACTERS, TEXTABLE } = await import('../src/characters/index.js');

const tok = (s) => encode(s).length;
const msgTok = (messages) => messages.reduce((s, m) => s + tok(m.content) + 4, 0);
const players = NAMES.slice(0, 4).map((name) => store.addPlayer({ name }));
const npcs = TEXTABLE.map((t) => t.key);
for (let i = 0; i < 60; i++) {
  const p = players[i % 4];
  const npc = npcs[i % npcs.length];
  memory.remember({ player: p.name, pid: p.pid, npc, character: CHARACTERS[npc].name, speaker: 'player', text: pick(PLAYER_LINES[npc], i), channel: i % 3 ? 'text' : 'call' });
  memory.remember({ player: p.name, pid: p.pid, npc, character: CHARACTERS[npc].name, speaker: 'character', text: pick(REPLIES[npc], i), channel: i % 3 ? 'text' : 'call' });
}
const me = players[0];
const rows = [];
for (const npc of Object.keys(CHARACTERS)) {
  const row = { npc };
  if (CHARACTERS[npc].textable) {
    for (let i = 0; i < 20; i++) store.addMessage({ token: me.token, thread: npc, from: i % 2 ? 'character' : 'player', text: i % 2 ? pick(REPLIES[npc], i) : pick(PLAYER_LINES[npc], i) });
    const thread = store.threadHistory(me.token, npc, 30);
    process.env.CONTEXT_MODE = 'legacy';
    row.textLegacy = msgTok(ctx.buildTextPrompt({ npc, player: me, thread }).messages);
    process.env.CONTEXT_MODE = 'bounded';
    row.textBounded = msgTok(ctx.buildTextPrompt({ npc, player: me, thread }).messages);
  }
  row.voiceLegacy = tok(buildLegacyInstructions(npc, me.name, memory.summary(), 'voice'));
  const v = ctx.buildVoiceSetup({ npc, player: me });
  row.voiceBounded = tok(v.instructions) + (v.tools.length ? tok(JSON.stringify(v.tools)) : 0);
  row.voiceStable = tok(ctx.stableBlock(npc, 'voice')) + (v.tools.length ? tok(JSON.stringify(v.tools)) : 0);
  rows.push(row);
}
console.table(rows);
const md = ['| Character | Text: legacy | Text: bounded | Voice: legacy | Voice: bounded (stable part) |', '|---|---:|---:|---:|---:|',
  ...rows.map((r) => `| ${r.npc} | ${r.textLegacy ?? '-'} | ${r.textBounded ?? '-'} | ${r.voiceLegacy} | ${r.voiceBounded} (${r.voiceStable}) |`)];
fs.mkdirSync(new URL('./results/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('./results/prompt-sizes.md', import.meta.url), `${md.join('\n')}\n`);
memory.flushMemory();
