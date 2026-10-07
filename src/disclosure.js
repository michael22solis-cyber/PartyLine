// The game engine decides what a character may reveal to whom. Models interpret and perform; they never hold a
// locked secret until a player's own words meet that secret's condition. Approvals are per player and per character,
// persist across texts and calls, and are recorded in the usage ledger as events (no dialogue).
import { topicsFor } from './secrets.js';
import { playerByToken, updatePlayer } from './store.js';
import { ledger } from './ai/ledger.js';

export const contextMode = () => (process.env.CONTEXT_MODE === 'legacy' ? 'legacy' : 'bounded');
// Bounded prompts never contain locked facts, so they always go through the engine. CONTEXT_MODE=legacy (rollback)
// restores the original prompts, where each character holds its secrets and judges the conditions itself.
export const gatingOn = () => contextMode() !== 'legacy';

const fresh = (p) => playerByToken(p.token) || p;
export const permittedIds = (p, npc) => fresh(p).permitted?.[npc] || [];
export const permittedTopics = (p, npc) => {
  const ids = new Set(permittedIds(p, npc));
  return topicsFor(npc).filter((t) => ids.has(t.id));
};

function grant(p, npc, topics, via) {
  if (!topics.length) return [];
  const cur = fresh(p);
  const have = new Set(cur.permitted?.[npc] || []);
  const added = topics.filter((t) => !have.has(t.id));
  if (!added.length) return [];
  updatePlayer(p.token, { permitted: { ...(cur.permitted || {}), [npc]: [...have, ...added.map((t) => t.id)] } });
  for (const t of added) ledger.event('disclosure_approved', { session: cur.pid, npc, topic: t.id, via });
  return added;
}

// A player's message to `npc`: approve every guarded topic their own words raise. Returns newly approved topics.
export function approveFromPlayerText(p, npc, text, via = 'text') {
  if (!gatingOn()) return [];
  const t = String(text || '');
  return grant(p, npc, topicsFor(npc).filter((s) => s.ask.test(t)), via);
}

// The character asked to open up about a topic (voice tool call). Approved only when the player's recent words
// support it; the model's own judgement is never enough on its own.
export function requestDisclosure(p, npc, topicId, recentPlayerText) {
  const topic = topicsFor(npc).find((t) => t.id === topicId);
  if (!topic) return { decision: 'stay_guarded', note: 'Nothing to share about that. Stay in character.' };
  const already = permittedIds(p, npc).includes(topic.id);
  if (already || topic.ask.test(String(recentPlayerText || ''))) {
    if (!already) grant(p, npc, [topic], 'tool');
    return { decision: 'open_up', memory: topic.fact, how: topic.how };
  }
  ledger.event('disclosure_denied', { session: fresh(p).pid, npc, topic: topic.id, via: 'tool' });
  return { decision: 'stay_guarded', note: 'They have not raised it directly. Deflect or stay vague, in character.' };
}

// Everyone who heard a disclosure (a group chat) shares the approval, so the character stays consistent with each
// of them afterwards.
export function shareApprovals(ps, npc, ids, via = 'group') {
  if (!gatingOn() || !ids.length) return;
  const topics = topicsFor(npc).filter((t) => ids.includes(t.id));
  for (const p of ps) grant(p, npc, topics, via);
}

// Should this line by the character count as the secret being uncovered by this player?
export function mayAward(p, npc, secretId, approvedNow = []) {
  if (!gatingOn()) return true;
  return approvedNow.includes(secretId) || permittedIds(p, npc).includes(secretId);
}
