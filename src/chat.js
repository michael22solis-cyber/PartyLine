// Character text replies in the burner-phone app. Same brain and shared memory as the phone calls.
import { CHARACTERS } from './characters/index.js';
import { remember, tagLine } from './memory.js';
import { threadHistory, countPlayerMessages, markRead } from './store.js';
import { deliver, emit } from './live.js';
import { isUnlocked, onCharacterSaid, unlockMentions } from './progress.js';
import { buildTextPrompt, buildNudgePrompt, callMeNote } from './context.js';
import { topicsFor } from './secrets.js';
import { approveFromPlayerText, phoneOnlyRaised } from './disclosure.js';
import { chatComplete } from './ai/openai.js';
import { ledger } from './ai/ledger.js';
import { typingPlan, busyReplyDelayMs } from './cast.js';
import { onAccusation } from './initiative.js';

const { MAX_TEXTS_PER_PLAYER = 150 } = process.env;
const env = process.env;

// One reply cycle per player+thread at a time. Messages that arrive while a reply is being written are answered
// together in one follow-up reply instead of being rejected (people double-text).
const pending = new Map(); // `${token}:${thread}` -> { approved: Set, followUp: boolean }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Human-like pauses. TEXT_DELAY_SCALE=0 removes them (tests, load tests); TEXT_FAST=1 is the same.
const delay = (ms) => sleep(env.TEXT_FAST === '1' ? 0 : ms * Number(env.TEXT_DELAY_SCALE ?? 1));

// Crude but important: if someone sounds like they're in real distress, step out of the game.
const CRISIS = /\b(kill myself|suicid|self[- ]?harm|hurt myself|end my life|want to die)\b/i;

// Pure acknowledgements after a character's (non-question) text get no reply, like real texting. No model call.
const ACK_WORD = '(ok(ay)?|k+|kk|cool|thanks?|thank you|thx|ty|tysm|lol+|lmao|haha+|hah|nice|got it|gotcha|sure|alright|aight|np|bye|night|good ?night|see ya|ttyl|[\\p{Extended_Pictographic}\\u200d\\ufe0f]+)';
const ACK = new RegExp(`^${ACK_WORD}([\\s,.!]+${ACK_WORD})*[\\s.!]*$`, 'iu');
export const isAck = (text) => ACK.test(String(text || '').trim());
// `recent`: the thread before this message. Skip only if the character spoke last (not with a question) and the
// player has only acknowledged since.
export function isAckOnly(text, recent = []) {
  if (env.TEXT_SKIP_ACKS === 'off' || !isAck(text)) return false;
  const i = recent.map((m) => m.from).lastIndexOf('character');
  if (i < 0 || /\?\s*$/.test(recent[i].text || '')) return false;
  return recent.slice(i + 1).every((m) => m.from !== 'player' || isAck(m.text));
}

const fail = (message, status) => Object.assign(new Error(message), { status });

export async function handlePlayerText(player, thread, text, { clientId = null } = {}) {
  const c = CHARACTERS[thread];
  if (!c?.textable) throw fail('That number can’t receive texts.', 400);
  if (!isUnlocked(player, thread)) throw fail('You don’t have that number yet.', 403);
  const clean = String(text || '').trim().slice(0, 500);
  if (!clean) throw fail('Empty message', 400);
  if (countPlayerMessages(player.token) >= Number(MAX_TEXTS_PER_PLAYER)) throw fail('The line has gone quiet for tonight.', 429);

  const before = threadHistory(player.token, thread, 6).filter((m) => m.from !== 'system');
  const mine = await deliver({ token: player.token, thread, from: 'player', text: clean, clientId });
  if (mine.duplicate) return mine; // a retried send: already handled
  remember({ player: player.name, pid: player.pid, npc: thread, character: c.name, speaker: 'player', text: `(text) ${clean}`, channel: 'text' });
  unlockMentions(player, clean).catch(() => {});
  if (tagLine({ speaker: 'player', text: clean, npc: thread }).includes('accusation')) onAccusation(player, thread, clean);

  if (CRISIS.test(clean)) {
    await deliver({
      token: player.token,
      thread: 'line',
      from: 'system',
      text: "Stepping outside the game for a second: if you're going through something real, you can call or text 988 (US) anytime to talk to someone. The story can wait.",
    });
    return mine;
  }

  // The engine, not the model, decides whether this message earns a disclosure.
  const approved = approveFromPlayerText(player, thread, clean, 'text');
  const callOnly = phoneOnlyRaised(thread, clean); // things they'll only say on a call
  const key = `${player.token}:${thread}`;
  const state = pending.get(key);
  if (state) {
    approved.forEach((t) => state.approved.add(t.id));
    callOnly.forEach((t) => state.callOnly.add(t.id));
    state.followUp = true;
    return mine;
  }
  if (!approved.length && !callOnly.length && isAckOnly(clean, before)) {
    ledger.event('text_skipped', { session: player.pid, npc: thread, reason: 'acknowledgement' });
    // No reply, like a real person: but they did see it.
    delay(1500 + Math.random() * 2500).then(() => read(player, thread)).catch(() => {});
    return mine;
  }
  const s = { approved: new Set(approved.map((t) => t.id)), callOnly: new Set(callOnly.map((t) => t.id)), followUp: false };
  pending.set(key, s);
  // Reply in the background so the app feels like real texting.
  (async () => {
    try {
      do {
        await replyOnce(player, thread, s);
      } while (s.followUp);
    } finally {
      pending.delete(key);
    }
  })();
  return mine;
}

function read(player, thread) {
  const at = markRead(player.token, thread);
  if (at) emit(player.token, 'read', { thread, at });
}

// Optional escalation of key moments (accusations, contradictions, evidence) to another model. Off unless configured.
function route(text) {
  const tags = tagLine({ speaker: 'player', text });
  const key = tags.some((t) => ['accusation', 'contradiction', 'evidence'].includes(t));
  return { model: key && env.OPENAI_TEXT_ESCALATION_MODEL ? env.OPENAI_TEXT_ESCALATION_MODEL : undefined, purpose: key ? 'reply_key_moment' : 'reply' };
}

async function replyOnce(player, thread, s) {
  const c = CHARACTERS[thread];
  let approvedIds = [];
  try {
    await delay(1200 + Math.random() * 1800 + busyReplyDelayMs(thread)); // "read" delay (longer when they're busy); texts that arrive meanwhile are answered together
    read(player, thread);
    emit(player.token, 'typing', { thread, on: true });
    // Everything up to here is answered by this reply; only texts arriving from now on need a follow-up.
    s.followUp = false;
    approvedIds = [...s.approved];
    s.approved.clear();
    const callOnly = topicsFor(thread).filter((t) => s.callOnly.has(t.id));
    s.callOnly.clear();
    const history = threadHistory(player.token, thread, 30);
    const lastPlayer = [...history].reverse().find((m) => m.from === 'player');
    const approvedNow = approvedIds.map((id) => ({ id }));
    const { messages } = buildTextPrompt({ npc: thread, player, thread: history, approvedNow, extra: callMeNote(callOnly) });
    const { model, purpose } = route(lastPlayer?.text || '');
    const { text: reply } = await chatComplete(messages, {
      model, meta: { session: player.pid, npc: thread, capability: 'text', purpose, turn: countPlayerMessages(player.token) },
    });

    // "Typing" time scales with length, at each character's own pace (Ruth slow and careful, Teddy fast); some stop
    // and start again, like someone deciding what to say.
    for (const step of typingPlan(thread, reply)) {
      emit(player.token, 'typing', { thread, on: step.typing });
      await delay(step.ms);
    }
    emit(player.token, 'typing', { thread, on: false });
    await deliver({ token: player.token, thread, from: 'character', text: reply });
    remember({ player: player.name, pid: player.pid, npc: thread, character: c.name, speaker: 'character', text: `(text) ${reply}`, channel: 'text' });
    await onCharacterSaid(player, thread, reply, { approved: approvedIds, channel: 'text' });
  } catch (err) {
    console.error(`[${thread}] text reply failed:`, err.message);
    emit(player.token, 'typing', { thread, on: false });
    const busy = err.code === 'busy';
    await deliver({ token: player.token, thread, from: 'system', kind: 'text',
      text: busy ? 'Their phone is busy. Try again in a minute.' : 'Message failed to deliver. Try again. (Host: the server window says why.)' });
  }
}

// Kept for older callers: one completion, text only.
export async function complete(messages, meta = {}) {
  return (await chatComplete(messages, { meta })).text;
}

// "The house is listening": a suspect reacts to something said in the players' group chat.
export async function overheard(characterKey, target, speaker, said) {
  const c = CHARACTERS[characterKey];
  const direction = `(Stage direction, not from the player: somehow you know that ${speaker} just told the whole group: "${said.slice(0, 300)}". Text ${target.name} out of nowhere about it. One or two short sentences, unsettling, in character. Make it clear you know what ${speaker} said, but never explain how you know.)`;
  const { text: reply } = await chatComplete(buildNudgePrompt({ npc: characterKey, player: target, direction }), {
    meta: { session: target.pid, npc: characterKey, capability: 'overheard', purpose: 'overheard' },
  });
  await deliver({ token: target.token, thread: characterKey, from: 'character', text: reply });
  remember({ player: target.name, pid: target.pid, npc: characterKey, character: c.name, speaker: 'character', text: `(text, after overhearing ${speaker}) ${reply}`, channel: 'overheard' });
}
