// Live updates to open burner-phone screens (Server-Sent Events), plus push for closed ones.
import { addMessage } from './store.js';
import { notify } from './push.js';
import { CHARACTERS } from './characters/index.js';

const streams = new Map(); // token -> Set of reply objects

export function subscribe(token, res) {
  if (!streams.has(token)) streams.set(token, new Set());
  streams.get(token).add(res);
  return () => streams.get(token)?.delete(res);
}

export function emit(token, event, data) {
  for (const res of streams.get(token) || []) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }
}

const THREAD_TITLES = { line: 'The Line', unknown: 'UNKNOWN', crew: 'The Crew' };
export const threadTitle = (thread) => THREAD_TITLES[thread] || CHARACTERS[thread]?.name || thread;

// Deliver a message to a player: save it, show it live, and buzz their phone.
export async function deliver({ token, thread, from = 'character', text, kind = 'text', audio = null, sender = null, forwarded = false, clientId = null }) {
  const msg = addMessage({ token, thread, from, text, kind, audio, sender, forwarded, clientId });
  if (msg.duplicate) return msg;
  emit(token, 'message', msg);
  if (from !== 'player') {
    const preview = kind === 'memo' ? 'New voice memo' : kind === 'voicemail' ? 'New voicemail' : kind === 'secret' ? 'Open this alone.' : text;
    const title = thread === 'crew' ? `The Crew · ${sender}` : thread.startsWith('dm:') ? sender : threadTitle(thread);
    await notify(token, { title, body: preview.slice(0, 120), thread });
  }
  return msg;
}
