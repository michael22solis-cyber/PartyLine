// Talking to the OpenAI Realtime API from the server. The permanent key never leaves this process.
//  - mintClientSecret: short-lived key for a browser WebRTC call (the default transport).
//  - createSidebandCall / openSideband / hangup: REALTIME_TRANSPORT=sideband. The server posts the browser's SDP itself
//    and keeps a control socket on the call, so limits, tools and usage are enforced server-side.
// Optional session fields the API rejects trigger one retry with the original minimal session shape.
import WebSocket from 'ws';
import { realtimeSession } from './session.js';
import { ledger } from '../ai/ledger.js';

const env = process.env;
const BASE = () => env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
export const WS_BASE = () => env.OPENAI_REALTIME_WS_URL || BASE().replace(/^http/, 'ws');
const auth = () => ({ Authorization: `Bearer ${env.OPENAI_API_KEY}` });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One retry on network errors and 5xx/429 (bounded; voice setup must stay snappy).
async function post(url, init, { timeoutMs = 10_000 } = {}) {
  let last;
  for (let a = 0; a < 2; a++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { method: 'POST', ...init, signal: ctrl.signal });
      if (a === 0 && (res.status >= 500 || res.status === 429)) { last = res; await sleep(400); continue; }
      return res;
    } catch (err) {
      last = err;
      if (a === 0) { await sleep(400); continue; }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
  return last;
}

async function withFallback(npc, player, attemptFn) {
  for (const minimal of [false, true]) {
    const built = realtimeSession({ npc, player, minimal });
    const res = await attemptFn(built, minimal);
    if (res.ok) return { ...res, built, minimal };
    if (res.status === 400 && !minimal) {
      console.warn(`[call ${npc}] OpenAI rejected the session config (${res.detail}); retrying with the minimal config.`);
      ledger.event('session_fallback', { npc, status: 400, detail: res.detail });
      continue;
    }
    throw Object.assign(new Error(`OpenAI ${res.status}: ${res.detail}`), { status: res.status });
  }
  throw new Error('unreachable');
}

export async function mintClientSecret({ npc, player }) {
  return withFallback(npc, player, async ({ session }, minimal) => {
    const body = minimal ? { session } : { expires_after: { anchor: 'created_at', seconds: 120 }, session };
    const res = await post(`${BASE()}/realtime/client_secrets`, {
      headers: { ...auth(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok && Boolean(data.value), status: res.status, key: data.value, detail: JSON.stringify(data).slice(0, 200) };
  });
}

export async function createSidebandCall({ npc, player, sdp }) {
  return withFallback(npc, player, async ({ session }) => {
    const fd = new FormData();
    fd.set('sdp', sdp);
    fd.set('session', JSON.stringify(session));
    const res = await post(`${BASE()}/realtime/calls`, { headers: auth(), body: fd });
    const answer = await res.text();
    const openaiCallId = (res.headers.get('location') || '').split('/').filter(Boolean).pop() || null;
    return { ok: res.ok && Boolean(openaiCallId), status: res.status, answer, openaiCallId, detail: res.ok ? 'no call id' : answer.slice(0, 200) };
  });
}

export function openSideband(openaiCallId) {
  return new WebSocket(`${WS_BASE()}/realtime?call_id=${encodeURIComponent(openaiCallId)}`, { headers: auth() });
}

export async function hangup(openaiCallId) {
  try {
    await post(`${BASE()}/realtime/calls/${encodeURIComponent(openaiCallId)}/hangup`, { headers: auth() }, { timeoutMs: 5000 });
  } catch (err) {
    console.error('[call] hangup failed:', err.message);
  }
}

export function openRealtimeSocket(model) {
  return new WebSocket(`${WS_BASE()}/realtime?model=${encodeURIComponent(model)}`, { headers: auth() });
}
