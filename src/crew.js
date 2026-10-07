// Players talking to each other: "The Crew" group chat and one-to-one DMs.
// Each player keeps their own copy of every message, like real phones.
import { players, playerByPid, messageById, countPlayerMessages } from './store.js';
import { deliver } from './live.js';
import { isUnlocked } from './progress.js';
import { overheard } from './chat.js';
import { postToGroup } from './groups.js';

const { MAX_TEXTS_PER_PLAYER = 150 } = process.env;
const SHAREABLE = new Set(['clue', 'evidence', 'memo', 'voicemail', 'text']);

// The house listens to the group chat: certain words can make Ruth text someone about it.
const TRIGGER = /cellar|basement|ruth|lullaby|humm|bingo|mud|911|accomplice|killer/i;
const COOLDOWN_MS = 12 * 60_000;
let lastOverheard = 0;

export async function sendPeer(sender, to, { text, forward } = {}) {
  if (countPlayerMessages(sender.token) >= Number(MAX_TEXTS_PER_PLAYER) * 2) {
    throw Object.assign(new Error('The line has gone quiet for tonight.'), { status: 429 });
  }
  let body = String(text || '').trim().slice(0, 600);
  let kind = 'text';
  let audio = null;
  if (forward) {
    const m = messageById(sender.token, forward);
    if (!m || !SHAREABLE.has(m.kind)) throw Object.assign(new Error('That can’t be shared.'), { status: 400 });
    body = m.text; kind = m.kind === 'text' ? 'text' : m.kind; audio = m.audio || null;
  }
  if (!body) throw Object.assign(new Error('Empty message'), { status: 400 });
  const extra = { kind, audio, sender: sender.name, forwarded: Boolean(forward) };

  if (String(to).startsWith('g:')) return postToGroup(sender, String(to).slice(2), { body, extra });

  if (to === 'crew') {
    const mine = await deliver({ token: sender.token, thread: 'crew', from: 'player', text: body, ...extra });
    await Promise.all(players().filter((p) => p.token !== sender.token)
      .map((p) => deliver({ token: p.token, thread: 'crew', from: 'peer', text: body, ...extra })));
    if (!forward && TRIGGER.test(body) && Date.now() - lastOverheard > COOLDOWN_MS) {
      const others = players().filter((p) => p.token !== sender.token && isUnlocked(p, 'ruth'));
      const target = others[Math.floor(Math.random() * others.length)];
      if (target) {
        lastOverheard = Date.now();
        setTimeout(() => overheard('ruth', target, sender.name, body).catch((e) => console.error('[overheard]', e.message)), 20_000 + Math.random() * 40_000);
      }
    }
    return mine;
  }

  const other = playerByPid(String(to || ''));
  if (!other || other.token === sender.token) throw Object.assign(new Error('No such player.'), { status: 400 });
  const mine = await deliver({ token: sender.token, thread: `dm:${other.pid}`, from: 'player', text: body, ...extra });
  await deliver({ token: other.token, thread: `dm:${sender.pid}`, from: 'peer', text: body, ...extra });
  return mine;
}
