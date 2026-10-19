// The episode being played. Its story comes from a pack in episodes/<id>/episode.js (see docs/PLAN.md);
// EPISODE picks one (default: blackwood). Patterns arrive as strings and leave as case-insensitive regular expressions.
import blackwood from '../episodes/blackwood/episode.js';

export const EPISODES = { blackwood };

const rx = (source) => new RegExp(source, 'i');

export function loadEpisode(id) {
  const pack = EPISODES[id];
  if (!pack) throw new Error(`Unknown episode "${id}". Known: ${Object.keys(EPISODES).join(', ')}`);
  return {
    ...pack,
    secrets: pack.secrets.map((s) => {
      const said = s.said.map(rx);
      return { ...s, ask: rx(s.ask), test: (text) => said.every((r) => r.test(text)) };
    }),
    mentions: Object.fromEntries(Object.entries(pack.mentions).map(([key, source]) => [key, rx(source)])),
  };
}

// What's wrong with a pack, in plain words (an empty list means it loads and every reference resolves).
// The first of the checks an AI-drafted episode goes through before anyone reads it (docs/PLAN.md, section 3).
export function checkEpisode(pack) {
  const problems = [];
  const fail = (msg) => problems.push(msg);
  try {
    if (JSON.stringify(JSON.parse(JSON.stringify(pack))) !== JSON.stringify(pack)) fail('The pack must be plain data.');
  } catch { fail('The pack must be plain data.'); }
  for (const key of ['id', 'title', 'suspects', 'truth', 'clues', 'secrets', 'mentions', 'timeline']) if (!pack[key]) fail(`Missing "${key}".`);
  if (problems.length) return problems;

  const pattern = (where, source) => { try { rx(source); } catch (err) { fail(`${where}: bad pattern (${err.message}).`); } };
  if (!pack.suspects.includes(pack.truth.killer)) fail(`The killer, "${pack.truth.killer}", isn't one of the suspects.`);
  if (!pack.truth.story) fail('The truth needs a story for the reveal.');
  if (!pack.clues.length) fail('Deal at least one starting clue.');
  const ids = new Set();
  for (const s of pack.secrets) {
    if (ids.has(s.id)) fail(`Two secrets are called "${s.id}".`);
    ids.add(s.id);
    for (const key of ['who', 'topic', 'ask', 'fact', 'said']) if (!s[key]) fail(`Secret "${s.id}" is missing "${key}".`);
    if (s.who && !pack.mentions[s.who]) fail(`Secret "${s.id}" belongs to "${s.who}", who isn't in the cast's mentions.`);
    if (s.ask) pattern(`Secret "${s.id}" ask`, s.ask);
    (s.said || []).forEach((source) => pattern(`Secret "${s.id}" said`, source));
  }
  Object.entries(pack.mentions).forEach(([key, source]) => pattern(`Mention "${key}"`, source));
  const carded = new Set(pack.secrets.filter((s) => s.card).map((s) => s.id));
  const conditions = (c) => (c === 'always' ? [] : Array.isArray(c) ? c.flatMap(conditions) : [c]);
  for (const m of pack.timeline) {
    for (const c of [...conditions(m.shown), ...(m.then ? [m.then] : []), ...(m.notes || [])]) {
      if (c.found && !carded.has(c.found)) fail(`Moment "${m.id}" waits for secret "${c.found}", which has no evidence card.`);
      if (!c.found && !c.seen) fail(`Moment "${m.id}" has a condition that is neither "seen" nor "found".`);
    }
  }
  return problems;
}

export const episode = loadEpisode(process.env.EPISODE || 'blackwood');
