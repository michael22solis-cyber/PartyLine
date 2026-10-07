// Character text replies in the burner-phone app. Same brain and shared memory as the phone calls.
import { CHARACTERS, buildInstructions } from './characters/index.js';
import { remember, summary } from './memory.js';
import { threadHistory, countPlayerMessages } from './store.js';
import { deliver, emit } from './live.js';
import { isUnlocked, onCharacterSaid, unlockMentions } from './progress.js';

const {
  OPENAI_API_KEY,
  OPENAI_TEXT_MODEL = 'gpt-4.1-mini',
  OPENAI_BASE_URL = 'https://api.openai.com/v1',
  MAX_TEXTS_PER_PLAYER = 150,
} = process.env;

const pending = new Set(); // `${token}:${thread}` while a reply is being written
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Crude but important: if someone sounds like they're in real distress, step out of the game.
const CRISIS = /\b(kill myself|suicid|self[- ]?harm|hurt myself|end my life|want to die)\b/i;

export async function handlePlayerText(player, thread, text) {
  const c = CHARACTERS[thread];
  if (!c?.textable) throw Object.assign(new Error('That number can’t receive texts.'), { status: 400 });
  if (!isUnlocked(player, thread)) throw Object.assign(new Error('You don’t have that number yet.'), { status: 403 });
  const clean = String(text || '').trim().slice(0, 500);
  if (!clean) throw Object.assign(new Error('Empty message'), { status: 400 });
  if (countPlayerMessages(player.token) >= Number(MAX_TEXTS_PER_PLAYER)) {
    throw Object.assign(new Error('The line has gone quiet for tonight.'), { status: 429 });
  }
  const key = `${player.token}:${thread}`;
  if (pending.has(key)) throw Object.assign(new Error('Wait for a reply first.'), { status: 429 });

  const mine = await deliver({ token: player.token, thread, from: 'player', text: clean });
  remember({ player: player.name, character: c.name, speaker: 'player', text: `(text) ${clean}` });
  unlockMentions(player, clean).catch(() => {});

  if (CRISIS.test(clean)) {
    await deliver({
      token: player.token,
      thread: 'line',
      from: 'system',
      text: "Stepping outside the game for a second: if you're going through something real, you can call or text 988 (US) anytime to talk to someone. The story can wait.",
    });
    return mine;
  }

  pending.add(key);
  // Reply in the background so the app feels like real texting.
  replyLater(player, thread).finally(() => pending.delete(key));
  return mine;
}

async function replyLater(player, thread) {
  const c = CHARACTERS[thread];
  try {
    await sleep(1200 + Math.random() * 1800); // "read" delay
    emit(player.token, 'typing', { thread, on: true });

    const history = threadHistory(player.token, thread, 20).filter((m) => m.from !== 'system').map((m) => ({
      role: m.from === 'player' ? 'user' : 'assistant',
      content: m.text,
    }));

    const messages = [{ role: 'system', content: buildInstructions(thread, player.name, summary(), 'text') }, ...history];
    const reply = await complete(messages);
    if (!reply) throw new Error('Empty reply');

    await sleep(Math.min(4000, 600 + reply.length * 25)); // "typing" time scales with length
    emit(player.token, 'typing', { thread, on: false });
    await deliver({ token: player.token, thread, from: 'character', text: reply });
    remember({ player: player.name, character: c.name, speaker: 'character', text: `(text) ${reply}` });
    await onCharacterSaid(player, thread, reply);
  } catch (err) {
    console.error(`[${thread}] text reply failed:`, err.message);
    emit(player.token, 'typing', { thread, on: false });
    await deliver({ token: player.token, thread, from: 'system', text: 'Message failed to deliver. Try again. (Host: the server window says why.)', kind: 'text' });
  }
}

// Try the configured model first, then fall back if this account can't use it.
const MODELS = [...new Set([OPENAI_TEXT_MODEL, 'gpt-4.1-mini', 'gpt-4o-mini'])];
let workingModel = null;
export async function complete(messages) {
  let lastErr;
  for (const model of workingModel ? [workingModel] : MODELS) {
    const res = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, max_completion_tokens: 200 }),
    });
    if (res.ok) {
      const data = await res.json();
      const reply = data.choices?.[0]?.message?.content?.trim();
      if (!reply) throw new Error('Empty reply');
      workingModel = model;
      return reply;
    }
    const body = await res.text();
    lastErr = new Error(`OpenAI ${res.status} (${model}): ${body.slice(0, 300)}`);
    if (res.status === 401) throw new Error(`OpenAI 401: the OPENAI_API_KEY in .env is wrong or revoked.`);
    if (res.status === 429 && /quota|billing/i.test(body)) throw new Error('OpenAI 429: no credit on this account. Add billing at platform.openai.com.');
    if (![400, 403, 404].includes(res.status)) throw lastErr; // only model problems are worth retrying with another model
  }
  throw lastErr;
}

// "The house is listening": a suspect reacts to something said in the players' group chat.
export async function overheard(characterKey, target, speaker, said) {
  const c = CHARACTERS[characterKey];
  const messages = [
    { role: 'system', content: buildInstructions(characterKey, target.name, summary(), 'text') },
    { role: 'user', content: `(Stage direction, not from the player: somehow you know that ${speaker} just told the whole group: "${said.slice(0, 300)}". Text ${target.name} out of nowhere about it. One or two short sentences, unsettling, in character. Make it clear you know what ${speaker} said, but never explain how you know.)` },
  ];
  const reply = await complete(messages);
  await deliver({ token: target.token, thread: characterKey, from: 'character', text: reply });
  remember({ player: target.name, character: c.name, speaker: 'character', text: `(text, after overhearing ${speaker}) ${reply}` });
}
