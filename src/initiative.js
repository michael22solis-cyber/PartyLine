// Characters reaching out on their own, so the phone buzzes with people, not just replies:
// - a reaction: accuse someone, or uncover their secret, and a few minutes later they text you about it;
// - gossip: word gets around, so another suspect texts a *different* player about what happened.
// Every message is one short text, capped hard so the cost stays small: at most 2 per character per player, 5 per
// player per night, and never two within 4 minutes for the same player. INITIATIVE=off disables it.
import { players, playerByToken } from './store.js';
import { deliver } from './live.js';
import { remember } from './memory.js';
import { CHARACTERS } from './characters/index.js';
import { buildNudgePrompt } from './context.js';
import { chatComplete } from './ai/openai.js';
import { isUnlocked } from './progress.js';
import { ledger } from './ai/ledger.js';

const env = process.env;
const PER_CHARACTER = 2;
const PER_PLAYER = 5;
const GAP_MS = 4 * 60_000;
const sent = new Map(); // token -> { total, last, by: { npc: n } }
const scale = () => (env.TEXT_FAST === '1' ? 0 : Number(env.INITIATIVE_DELAY_SCALE ?? 1));
const later = (minMs, maxMs, fn) => {
  const t = setTimeout(() => fn().catch((e) => console.error('[initiative]', e.message)), (minMs + Math.random() * (maxMs - minMs)) * scale());
  t.unref?.();
};

export const initiativeOn = () => env.INITIATIVE !== 'off';
export function resetInitiative() { sent.clear(); }

function allowed(p, npc) {
  const s = sent.get(p.token) || { total: 0, last: 0, by: {} };
  return s.total < PER_PLAYER && (s.by[npc] || 0) < PER_CHARACTER && Date.now() - s.last >= GAP_MS * Math.min(1, scale() || 0);
}
function count(p, npc) {
  const s = sent.get(p.token) || { total: 0, last: 0, by: {} };
  s.total += 1; s.last = Date.now(); s.by[npc] = (s.by[npc] || 0) + 1;
  sent.set(p.token, s);
}

// One unprompted text from `npc` to player `p`, following `direction` (a stage direction the player never sees).
export async function reachOut(p, npc, direction, why) {
  const target = playerByToken(p.token);
  if (!target || !initiativeOn() || !CHARACTERS[npc]?.textable || !isUnlocked(target, npc) || !allowed(target, npc)) return null;
  count(target, npc);
  const { text } = await chatComplete(buildNudgePrompt({ npc, player: target, direction }), {
    meta: { session: target.pid, npc, capability: 'initiative', purpose: why },
  });
  await deliver({ token: target.token, thread: npc, from: 'character', text });
  remember({ player: target.name, pid: target.pid, npc, character: CHARACTERS[npc].name, speaker: 'character', text: `(text, unprompted) ${text}`, channel: 'text' });
  ledger.event('character_reached_out', { session: target.pid, npc, why });
  return text;
}

// Who would gossip about it: the suspects other than the one accused, most talkative first.
const GOSSIPS = ['teddy', 'ruth', 'marcus', 'lily'];

// A player accused `npc` (by text or on a call).
export function onAccusation(p, npc, said) {
  if (!initiativeOn() || !CHARACTERS[npc]?.textable) return;
  const name = CHARACTERS[npc].name;
  // They come back to it, a few minutes later, on their own.
  later(90_000, 180_000, () => reachOut(p, npc,
    `(Stage direction, not from the player: a few minutes ago ${p.name} accused you: "${String(said).slice(0, 200)}". It has been eating at you. Text them about it, out of nowhere, in one or two short sentences: defensive, hurt or rattled, in character. Do not reveal anything you are hiding.)`,
    'after_accusation'));
  // Word gets around: another suspect texts someone else.
  const others = players().filter((x) => x.token !== p.token);
  const listener = others[Math.floor(Math.random() * others.length)];
  const gossip = listener && GOSSIPS.find((g) => g !== npc && isUnlocked(listener, g));
  if (gossip) {
    later(240_000, 480_000, () => reachOut(listener, gossip,
      `(Stage direction, not from the player: you heard that ${p.name} accused ${name} tonight. Text ${listener.name} about it out of nowhere: one or two short sentences of gossip, in character, with your own opinion of ${name}. Never reveal anything you are hiding.)`,
      'gossip'));
  }
}

// A player uncovered `npc`'s secret: they know it got out.
export function onSecretFound(p, npc) {
  if (!initiativeOn()) return;
  later(60_000, 150_000, () => reachOut(p, npc,
    `(Stage direction, not from the player: you just let something slip to ${p.name} that you never meant to say. Text them, one or two short sentences, in character: ask them to keep it to themselves, or take back how it sounded. Do not add any new facts.)`,
    'after_secret'));
}
