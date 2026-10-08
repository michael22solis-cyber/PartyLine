// Getting back in after losing your link (closed tab, new phone): from the invite page, pick your name and ask; the
// host approves it on /host and that device gets your link. Nobody can take over someone else's phone (and read their
// role or agenda) without the host saying yes. Requests live in memory and expire after 10 minutes.
import crypto from 'node:crypto';
import { getGame, playerByPid } from './store.js';

const TTL_MS = 10 * 60_000;
const requests = new Map(); // rid -> { pid, at, status }

function prune() {
  const now = Date.now();
  for (const [rid, r] of requests) if (now - r.at > TTL_MS) requests.delete(rid);
}
const checkCode = (code) => {
  const g = getGame();
  if (!g || g.code !== code) throw Object.assign(new Error('This invite has expired.'), { status: 404 });
};

export function requestRejoin(code, pid) {
  checkCode(code);
  prune();
  const p = playerByPid(String(pid || ''));
  if (!p) throw Object.assign(new Error('No such player.'), { status: 404 });
  for (const [rid, r] of requests) if (r.pid === p.pid && r.status === 'pending') requests.delete(rid); // one at a time
  const rid = crypto.randomBytes(12).toString('base64url');
  requests.set(rid, { pid: p.pid, at: Date.now(), status: 'pending' });
  return { rid, name: p.name };
}

// What the waiting device sees. The link only once the host has approved, and only to the device holding the rid.
export function rejoinStatus(code, rid) {
  checkCode(code);
  prune();
  const r = requests.get(String(rid || ''));
  if (!r) return { status: 'expired' };
  if (r.status !== 'approved') return { status: r.status };
  requests.delete(rid); // single use
  const p = playerByPid(r.pid);
  return p ? { status: 'approved', link: `/p/${p.token}` } : { status: 'expired' };
}

export function decideRejoin(rid, approve) {
  const r = requests.get(String(rid || ''));
  if (!r || r.status !== 'pending') throw Object.assign(new Error('That request has expired.'), { status: 404 });
  r.status = approve ? 'approved' : 'denied';
  return r;
}

export const pendingRejoins = () => {
  prune();
  return [...requests].filter(([, r]) => r.status === 'pending').map(([rid, r]) => ({ rid, name: playerByPid(r.pid)?.name, at: new Date(r.at).toISOString() }));
};
export function resetRejoins() { requests.clear(); }
