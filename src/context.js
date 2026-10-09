// Builds what each model sees: a STABLE block per character and mode (identical for every player and turn, so it
// caches), then a small DYNAMIC block (this player, what the engine has approved, compact memory), then bounded
// recent history. CONTEXT_MODE=legacy restores the original prompts exactly.
import { CHARACTERS } from './characters/index.js';
import { buildLegacyInstructions } from './characters/legacy.js';
import { topicsFor } from './secrets.js';
import { memoryNotes, summary } from './memory.js';
import { permittedTopics, contextMode, gatingOn } from './disclosure.js';

export const estTokens = (s) => Math.ceil(String(s || '').length / 3.8);
const env = process.env;
export const TEXT_BUDGET = () => Number(env.TEXT_CONTEXT_TOKENS || 950); // 800 before characters' life details; memory keeps its room
export const VOICE_MEMORY_BUDGET = () => Number(env.VOICE_MEMORY_TOKENS || 350);
export const TOOL_NAME = 'check_guarded_topic';

const PUBLIC_STORY = `WHAT EVERYONE KNOWS: Halloween night 1996, Elias Blackwood, caretaker of Blackwood Manor, vanished. Every Halloween since, the manor's disconnected landline rings once at midnight. Thursday Oct 29, Dana Whitlock, the house's new buyer, was found dead at the bottom of the cellar stairs. Police called it an accident. Dana, 46, was an architect from Boston who restored old houses; she meant to turn the manor into a bed and breakfast and spent her first weeks asking around town about the house's history. Around town: Rosie's Diner on Main Street, St. Agnes church and its Thursday bingo, Crane Road where the manor stands.`;

const RULES = `RULES YOU MUST ALWAYS FOLLOW:
- This is a fictional Halloween mystery game the player opted into. Stay in character.
- Never contradict what you know here. If unsure, deflect in character instead of inventing facts.
- Never volunteer guarded things. Keep it scary, not gory. Nothing sexual. No real people, places or brands.
- Never ask for personal information, money, codes or passwords.
- If the player sounds genuinely distressed, mentions self-harm, or asks to stop, drop the character immediately, speak plainly and kindly, and (for self-harm) tell them they can call or text 988 in the US.`;

const TEXT_STYLE = `TEXTING: real texts, usually a few words or a line. Up to ~60 words only for a story, reveal or real question. No narration; emojis only if in character.`;

const VOICE_STYLE = `ON THE PHONE: talk like a real person on a call. Usually one or two natural spoken sentences per turn; go longer only when the moment calls for it (your opening, a confession, a story, a direct question that needs it). Keep your emotional delivery: pauses, hesitation, warmth or menace as your character would. No lists, no stage directions, never read out sound effects. Let the caller lead.
SOUND HUMAN, NOT LIKE AN ASSISTANT: you are not helpful and you are not polished. Use contractions and everyday words. Let speech be messy where it fits: "um", "uh", "I mean", "look", restarting a sentence, trailing off, a short laugh or sigh. React before you answer ("Wait, what?", "Who told you that?"). It's fine to be short, evasive, annoyed or to answer a question with a question. Never repeat the caller's question back, never say "great question", "I understand" or "is there anything else", never summarize, and never offer help. Where your HOW YOU SPEAK notes say otherwise, they win.
When you are told the call is nearly over, wrap up in story and say goodbye in one or two sentences.`;

function guardedBlock(npc, mode, withTool) {
  const topics = topicsFor(npc);
  if (!topics.length || !gatingOn()) return '';
  const list = topics.map((t) => `${t.id}: ${t.topic}`).join('; ');
  return mode === 'voice' && withTool
    ? `GUARDED TOPICS (you are hiding or holding something back about each): ${list}.\nWhen the caller asks about, or confronts you with, one of these, call ${TOOL_NAME} with its id BEFORE answering, then follow what it returns. If it says stay guarded, deflect in character. Never mention the tool or the word "guarded".`
    : `GUARDED TOPICS (you are cagey about these and say nothing specific unless a note below says you may open up): ${list.replace(/\b\w+: /g, '')}.`;
}

const stableCache = new Map();
// The cacheable prefix for one character and mode. Contains no player, time or memory.
export function stableBlock(npc, mode, { withTool = true } = {}) {
  const key = `${npc}:${mode}:${gatingOn()}:${withTool}`;
  if (stableCache.has(key)) return stableCache.get(key);
  const c = CHARACTERS[npc];
  if (!c) throw new Error(`Unknown character: ${npc}`);
  const parts = [
    c.persona,
    npc.startsWith('caretaker') ? '' : PUBLIC_STORY,
    c.story ? `YOUR STORY (what you tell people):\n${c.story}` : '',
    c.life ? `YOUR LIFE (small true details; use them naturally when they fit, never recite them):\n${c.life}` : '',
    c.knows ? `WHAT YOU KNOW:\n${c.knows}` : '',
    c.behaviors ? `HOW YOU BEHAVE:\n${c.behaviors}` : '',
    guardedBlock(npc, mode, withTool),
    // Voice only: relationships, delivery direction and examples. They also bring the per-character voice prefix close
    // to the 1,024-token prompt-cache threshold, which the simulator showed is cheaper than a shorter prefix that misses
    // the cache (bench/simulate.js). Text prompts stay small: below the threshold, fewer tokens is simply cheaper.
    mode === 'voice' && c.relationships ? `PEOPLE IN YOUR STORY:\n${c.relationships}` : '',
    mode === 'voice' && c.delivery ? `HOW YOU SPEAK:\n${c.delivery}` : '',
    mode === 'voice' && c.examples?.length ? `HOW YOU SOUND (examples of your voice; never repeat them word for word):\n${c.examples.map((e) => `- "${e}"`).join('\n')}` : '',
    RULES,
    mode === 'voice' ? VOICE_STYLE : TEXT_STYLE,
  ].filter(Boolean);
  const out = parts.join('\n\n').replace(/\{player\}/g, 'their name');
  stableCache.set(key, out);
  return out;
}

const firstName = (n) => String(n || 'detective').split(' ')[0];

function disclosureLines(player, npc, approvedNow, mode = 'voice') {
  const now = new Set(approvedNow.map((t) => t.id));
  const lines = [];
  for (const t of permittedTopics(player, npc)) {
    if (mode !== 'voice' && t.phoneOnly) { // told on a call; never in writing
      lines.push(`ON THE PHONE YOU TOLD ${firstName(player.name).toUpperCase()} ABOUT ${t.topic}. Never put it in writing; if they bring it up, say you already told them on the phone.`);
      continue;
    }
    lines.push(now.has(t.id)
      ? `YOU MAY NOW ADMIT THIS TO ${firstName(player.name).toUpperCase()} (they raised it; say it in this reply, in character. ${t.how}): ${t.fact}`
      : `YOU ALREADY ADMITTED THIS TO ${firstName(player.name).toUpperCase()} (stay consistent): ${t.fact}`);
  }
  return lines;
}

function dynamicBlock({ player, npc, approvedNow = [], notes = [], extra = '', mode = 'voice' }) {
  return [
    `THE PLAYER you are talking with is ${player.name}. You may mention other players by first name if it fits (e.g. "Maya asked me the same thing an hour ago").`,
    ...disclosureLines(player, npc, approvedNow, mode),
    notes.length ? `YOUR MEMORY (keep your story consistent with it):\n${notes.join('\n')}` : '',
    extra,
  ].filter(Boolean).join('\n');
}

/**
 * Text reply prompt. `thread` is the player's thread with this character (store messages, oldest first, may include
 * the message being answered). Returns { messages, stats }.
 */
export function buildTextPrompt({ npc, player, thread, approvedNow = [], extra = '', budget = TEXT_BUDGET() }) {
  const asChat = (m) => ({ role: m.from === 'player' ? 'user' : 'assistant', content: m.kind === 'photo' ? `[you sent a photo] ${m.text}` : m.text });
  const usable = thread.filter((m) => m.from !== 'system');
  if (contextMode() === 'legacy') {
    const messages = [{ role: 'system', content: buildLegacyInstructions(npc, player.name, summary(), 'text') }, ...usable.slice(-20).map(asChat)];
    return { messages, stats: statsOf(messages) };
  }
  const stable = stableBlock(npc, 'text');
  const fixed = dynamicBlock({ player, npc, approvedNow, extra, mode: 'text' });
  let room = Math.max(120, budget - estTokens(stable) - estTokens(fixed) - 8);
  // History first (newest backwards, always the last 2), up to ~55% of what is left; memory gets the rest.
  const hist = [];
  let histTok = 0;
  for (let i = usable.length - 1; i >= 0; i--) {
    const t = estTokens(usable[i].text) + 4;
    if (hist.length >= 2 && histTok + t > room * 0.55) break;
    hist.unshift(usable[i]);
    histTok += t;
  }
  room -= histTok;
  const mem = memoryNotes({ npc, pid: player.pid, playerName: player.name, budgetTokens: Math.max(0, room), skipChannel: 'text', skipSince: hist[0]?.at || null });
  const dynamic = dynamicBlock({ player, npc, approvedNow, notes: mem.notes, extra, mode: 'text' });
  const messages = [{ role: 'system', content: stable }, { role: 'system', content: dynamic }, ...hist.map(asChat)];
  return { messages, stats: { ...statsOf(messages), stableTokens: estTokens(stable), historyKept: hist.length, historyDropped: usable.length - hist.length, memoryNotes: mem.notes.length } };
}

// Group chat: one text from `npc` into a group transcript.
export function buildGroupPrompt({ npc, player, setting, transcript, ask, approvedNow = [] }) {
  if (contextMode() === 'legacy') {
    return [
      { role: 'system', content: `${buildLegacyInstructions(npc, player.name, summary(), 'text')}\n${setting}` },
      { role: 'user', content: ask(transcript.slice(-20).join('\n')) },
    ];
  }
  const lines = [];
  let tok = 0;
  for (let i = transcript.length - 1; i >= 0 && lines.length < 12; i--) {
    const t = estTokens(transcript[i]) + 1;
    if (lines.length >= 2 && tok + t > 260) break;
    lines.unshift(transcript[i]);
    tok += t;
  }
  const mem = memoryNotes({ npc, pid: player.pid, playerName: player.name, budgetTokens: 120, skipChannel: 'group' });
  return [
    { role: 'system', content: stableBlock(npc, 'text') },
    { role: 'system', content: dynamicBlock({ player, npc, approvedNow, notes: mem.notes, extra: setting, mode: 'text' }) },
    { role: 'user', content: ask(lines.join('\n')) },
  ];
}

// A one-off unprompted text (e.g. "the house is listening").
export function buildNudgePrompt({ npc, player, direction }) {
  if (contextMode() === 'legacy') {
    return [{ role: 'system', content: buildLegacyInstructions(npc, player.name, summary(), 'text') }, { role: 'user', content: direction }];
  }
  const mem = memoryNotes({ npc, pid: player.pid, playerName: player.name, budgetTokens: 140 });
  return [
    { role: 'system', content: stableBlock(npc, 'text') },
    { role: 'system', content: dynamicBlock({ player, npc, notes: mem.notes, mode: 'text' }) },
    { role: 'user', content: direction },
  ];
}

// Realtime session instructions + tools for one call. Fixed for the whole call, so every response after the first
// reads them from cache; new approvals during the call arrive as conversation items, not instruction rewrites.
export function buildVoiceSetup({ npc, player, withTool = true }) {
  if (contextMode() === 'legacy') {
    const instructions = buildLegacyInstructions(npc, player.name, summary(), 'voice');
    return { instructions, tools: [], stats: { instructionsTokens: estTokens(instructions) } };
  }
  const tools = withTool ? voiceTools(npc) : [];
  const stable = stableBlock(npc, 'voice', { withTool: tools.length > 0 }).replace(/their name/g, firstName(player.name));
  const mem = memoryNotes({ npc, pid: player.pid, playerName: player.name, budgetTokens: VOICE_MEMORY_BUDGET() });
  const instructions = `${stable}\n\n${dynamicBlock({ player, npc, notes: mem.notes })}`;
  return {
    instructions,
    tools,
    stats: { instructionsTokens: estTokens(instructions), stableTokens: estTokens(stable), toolTokens: estTokens(JSON.stringify(tools)), memoryNotes: mem.notes.length },
  };
}

export function voiceTools(npc) {
  const topics = topicsFor(npc);
  if (!topics.length || !gatingOn()) return [];
  return [{
    type: 'function',
    name: TOOL_NAME,
    description: 'Call before answering whenever the caller asks about, or confronts you with, one of your guarded topics. Returns whether you are ready to talk about it and what you remember.',
    parameters: {
      type: 'object',
      properties: { topic: { type: 'string', enum: topics.map((t) => t.id), description: topics.map((t) => `${t.id} = ${t.topic}`).join('; ') } },
      required: ['topic'],
    },
  }];
}

// Mid-call note when the engine approves a topic from the caller's own words (no tool call needed).
// A written message raised something this character will only talk about on a call.
export const callMeNote = (topics) => topics.length
  ? `They just brought up ${topics.map((t) => t.topic).join(' and ')} in writing. You will NOT discuss that over text: anyone could read it. Say nothing specific about it; in your own words, tell them to call you if they want to talk about it.`
  : '';

export const approvalNote = (player, t) =>
  `(Note for you, not the caller: ${firstName(player.name)} has raised ${t.topic}. You may now admit this, in character. ${t.how} ${t.fact})`;

function statsOf(messages) {
  const totalTokens = messages.reduce((s, m) => s + estTokens(m.content) + 4, 0);
  return { totalTokens, messages: messages.length };
}
