// Blackwood Line: a haunted old phone. Vanilla JS, no build step.
import { TUTORIAL_TITLES, readTutorialProgress, tutorialStep } from './tutorial.js';
import { deviceOS, installGate } from './install.js';

const token = location.pathname.split('/').filter(Boolean)[1];
const api = (path, opts = {}) =>
  fetch(`/api/p/${token}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } })
    .then(async (r) => {
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'Something went wrong');
      return data;
    });

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const store = {
  get: (k, d = null) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

const state = {
  me: null, threads: [], messages: [], suspects: [], players: [], vote: null, revealed: false,
  vapidPublicKey: null, view: 'home', open: null, typing: {}, pick: { killer: null, accomplice: null },
  drafts: {}, recap: null, arrived: {},
};

const tutorialKey = `bw-tutorial-v1-${token}`;
let tutorial = readTutorialProgress(store.get(tutorialKey));
const saveTutorial = () => store.set(tutorialKey, JSON.stringify(tutorial));

const READONLY = { line: 'The Line', unknown: 'UNKNOWN' };

// ============ the cast's faces (public/cast/) ============
const CAST = { ruth: 'Ruth Calloway', marcus: 'Marcus Vane', lily: 'Lily Blackwood', teddy: 'Teddy Fisk' };
// Public bios: only what anyone in town could tell you. Never a secret, never anything the player has to earn.
const BIO = {
  ruth: { age: 74, role: 'Retired night nurse',
    background: ['Thirty years of night shifts at St. Agnes Hospital. In the ’90s she nursed Elias Blackwood’s sick wife at the manor.', 'Widowed since 2009. Lives alone two streets from the manor, in the yellow house with the cat in the window.', 'Bakes lemon bars for every church function. Her grandniece set up her phone; she still texts with full punctuation.'],
    thursday: 'At St. Agnes bingo until 10. Ask anyone.',
    rumor: 'Walks past the manor every evening. The neighbors say she never once looks at it.' },
  marcus: { age: 48, role: 'Realtor, Vane Realty',
    background: ['His face is on the billboard on Route 9. Divorced; his daughter stays with him every other weekend.', 'Blackwood Manor sat on the market for three years. He cut the price twice before Dana bought it in September.', 'Drives a black sedan he keeps spotless. Never off the phone.'],
    thursday: 'Showed Dana around in the evening. Says he left by 6:30 and went home.',
    rumor: 'Somebody spray-painted “LIAR” across his billboard last month.' },
  lily: { age: 42, role: 'The caretaker’s daughter',
    background: ['Was twelve when her father, Elias, vanished on Halloween 1996. Her mother died three years later.', 'Has waited tables at Rosie’s Diner for fifteen years. Lives alone above the laundromat on Main.', 'Never wanted the house sold. Can’t stand the ghost tours.'],
    thursday: 'Working her shift at Rosie’s Diner.',
    rumor: 'Every Halloween she leaves flowers at the manor gate, and never says who they’re for.' },
  teddy: { age: 34, role: 'Ghost-tour guide & streamer',
    background: ['Runs Blackwood Ghost Tours: $25 a head, weekends and all of Halloween week. Streams as “Fisk After Dark.”', 'Dropped out of film school. Drives a van with his own face on the side.', 'Dreams of a TV deal. His mom still calls him in the middle of his streams.'],
    thursday: 'Live on his stream from his apartment, 9 to 10. The replay is online.',
    rumor: 'Tour guests swear they’ve heard voices in the walls of the manor.' },
};
const VICTIM = { name: 'Dana Whitlock', age: 46, lines: [
  'An architect from Boston who restores old houses. Bought Blackwood Manor in September and planned to turn it into a bed and breakfast.',
  'Spent her first weeks asking neighbors about the house’s history. Booked a crew to dig up the cellar floor on November 2.',
  'Found at the bottom of the cellar stairs. Police say she died between 9:30 and 10 pm, and call it an accident.',
] };
// The Line has no face, only a shape in the static that never quite resolves.
let lineAvN = 0;
function lineAvatar() {
  const a = el('span', 'avatar av-line');
  const id = `lg${++lineAvN}`; // unique per avatar so the glow survives when another copy is removed
  a.innerHTML = `<svg viewBox="0 0 40 40" aria-hidden="true"><defs><radialGradient id="${id}" cx="50%" cy="42%" r="55%"><stop offset="0" stop-color="#9fc4a3"/><stop offset="0.45" stop-color="#3d5a43"/><stop offset="1" stop-color="#050806"/></radialGradient></defs><rect width="40" height="40" fill="url(#${id})"/><g class="shade"><ellipse cx="20" cy="15.5" rx="6.2" ry="7.6"/><path d="M5 40c1-9.5 6.5-14.5 15-14.5S34 30.5 35 40z"/></g><circle class="eye" cx="17.5" cy="15.2" r="1"/><circle class="eye" cx="22.5" cy="15.2" r="1"/></svg>`;
  return a;
}
// Generated art used until a copy is added to public/cast (public/cast/<key>.jpg always wins).
const CDN_ART = {
  'clue-police': 'https://d8j0ntlcm91z4.cloudfront.net/user_3HCC73EuiIXBWsy0LnhpTM9HwUC/hf_20261009_234754_c3a18391-4df8-4140-9c37-91cd642831ca_min.webp',
  'clue-contract': 'https://d8j0ntlcm91z4.cloudfront.net/user_3HCC73EuiIXBWsy0LnhpTM9HwUC/hf_20261009_234755_7f10d95f-4966-425e-a18c-e5514fe01399_min.webp',
  'clue-ruth': 'https://d8j0ntlcm91z4.cloudfront.net/user_3HCC73EuiIXBWsy0LnhpTM9HwUC/hf_20261009_234754_5e27190d-56db-4582-bad8-b2a2800ba1f6_min.webp',
  'clue-receipt': 'https://d8j0ntlcm91z4.cloudfront.net/user_3HCC73EuiIXBWsy0LnhpTM9HwUC/hf_20261009_234754_e73bd54a-21a1-4549-95fa-68e477601a83_min.webp',
  'clue-livestream': 'https://d8j0ntlcm91z4.cloudfront.net/user_3HCC73EuiIXBWsy0LnhpTM9HwUC/hf_20261009_234753_0aaf1c8b-c54b-47f9-8a0e-152e6778a738_min.webp',
  'clue-neighbor': 'https://d8j0ntlcm91z4.cloudfront.net/user_3HCC73EuiIXBWsy0LnhpTM9HwUC/hf_20261009_234755_a29f40da-bd9d-41bf-8589-55f680f46310_min.webp',
  'elias-poster': 'https://d8j0ntlcm91z4.cloudfront.net/user_3HCC73EuiIXBWsy0LnhpTM9HwUC/hf_20261009_234754_88adf7ae-b4b6-4850-8651-e1b290cef358_min.webp',
  danaVideo: 'https://d8j0ntlcm91z4.cloudfront.net/user_3HCC73EuiIXBWsy0LnhpTM9HwUC/hf_20261009_234802_7e2589d7-8882-40f6-a732-ba5f9ac22c8c.mp4',
  'truth-cellar': 'https://d8j0ntlcm91z4.cloudfront.net/user_3HCC73EuiIXBWsy0LnhpTM9HwUC/hf_20261009_234755_0cf5fa3a-bc3d-49f9-a1a2-a6bbbe87e3a6_min.webp',
  dana: 'https://d8j0ntlcm91z4.cloudfront.net/user_3HCC73EuiIXBWsy0LnhpTM9HwUC/hf_20261008_233940_29fc5259-cc85-4e25-9b94-a5ca38dca494_min.webp',
  lineup: 'https://d8j0ntlcm91z4.cloudfront.net/user_3HCC73EuiIXBWsy0LnhpTM9HwUC/hf_20261008_233940_83d74b87-cd21-4eca-968f-22b8bec873ef_min.webp',
};
// Dana's moving photo: public/cast/dana.mp4 when it's there, otherwise the generated copy.
let danaVideoOk = null;
const DANA_VIDEO = () => (danaVideoOk === false && CDN_ART.danaVideo ? CDN_ART.danaVideo : '/assets/cast/dana.mp4');
fetch('/assets/cast/dana.mp4', { method: 'HEAD' }).then((r) => { danaVideoOk = r.ok; }).catch(() => { danaVideoOk = false; });
// Evidence art: public/art/<key>.jpg when it's there, otherwise the generated copy. Tap to see it full size.
function artImg(key, caption = '') {
  const img = el('img'); img.alt = caption; img.loading = 'lazy'; img.className = 'art';
  const srcs = [`/assets/art/${key}.jpg`, ...(CDN_ART[key] ? [CDN_ART[key]] : [])];
  img.src = srcs.shift();
  img.onerror = () => { if (srcs.length) img.src = srcs.shift(); else img.remove(); };
  img.onclick = (e) => { e.stopPropagation(); openLightbox({ image: img.currentSrc || img.src, caption }); };
  return img;
}
// Which photo goes with each starting clue.
const CLUE_ART = [[/POLICE NOTE/, 'clue-police'], [/RENOVATION CONTRACT/, 'clue-contract'], [/RUTH.S STATEMENT/, 'clue-ruth'],
  [/DINER RECEIPT/, 'clue-receipt'], [/TEDDY.S LIVESTREAM/, 'clue-livestream'], [/NEIGHBOR.S TEXT/, 'clue-neighbor']];
// A portrait, or the shape of someone you haven't met.
function portrait(key, cls = '') {
  const box = el('span', `portrait ${cls}`);
  if (key) {
    const img = el('img'); img.alt = ''; img.loading = 'lazy';
    const srcs = [`/assets/cast/${key}.jpg`, ...(CDN_ART[key] ? [CDN_ART[key]] : [])];
    img.src = srcs.shift();
    img.onerror = () => { if (srcs.length) img.src = srcs.shift(); else { img.remove(); box.classList.add('unknown'); } };
    box.append(img);
  } else box.classList.add('unknown');
  return box;
}
const KEY_OF_NAME = Object.fromEntries(Object.entries(CAST).map(([k, n]) => [n.toUpperCase(), k]));
const faceKey = (k) => (CAST[k] ? k : String(k || '').startsWith('caretaker') ? 'caretaker' : null);
const keyOfName = (name) => KEY_OF_NAME[String(name || '').trim().toUpperCase()] || (/BLACKWOOD MANOR|UNKNOWN/i.test(name || '') ? 'caretaker' : null);
function avatar(key, initial = '') {
  const k = faceKey(key);
  const a = el('span', `avatar ${k ? `av-${k}` : 'av-none'}`);
  if (k && k !== 'caretaker') {
    const img = el('img'); img.src = `/assets/cast/${k}-sm.jpg`; img.alt = ''; img.loading = 'lazy'; img.decoding = 'async';
    a.append(img);
  } else if (!k && initial) a.textContent = initial.slice(0, 1).toUpperCase();
  return a;
}
// Online / last seen, from when they last wrote to you.
function presence(thread) {
  const last = [...state.messages].reverse().find((m) => m.thread === thread && m.from === 'character');
  if (!last) return '';
  const mins = (Date.now() - new Date(last.at)) / 60000;
  if (mins < 5) return 'online';
  if (mins < 60) return `last seen ${Math.round(mins)}m ago`;
  if (mins < 24 * 60) return `last seen ${Math.round(mins / 60)}h ago`;
  return 'last seen a while ago';
}
const statusOf = (thread) => state.threads.find((t) => t.key === thread)?.status || '';
const EVIDENCE_KINDS = new Set(['clue', 'memo', 'evidence', 'reveal']);
const CALL_KINDS = new Set(['call', 'calllog', 'missed', 'voicemail']);
const SHARE_KINDS = new Set(['clue', 'evidence', 'memo', 'voicemail', 'photo']);

// Start a group chat with any mix of players and suspects you have numbers for.
function openNewGroup() {
  const sheet = $('#groupSheet'); const list = $('#groupList'); const note = $('#groupNote');
  list.replaceChildren(); note.textContent = ''; $('#groupName').value = '';
  const pick = (label, sub, value) => {
    const row = el('label', 'row pickrow');
    const box = document.createElement('input'); box.type = 'checkbox'; box.value = value;
    const txt = el('span'); txt.append(el('b', null, label), el('small', null, sub));
    row.append(txt, box); list.append(row);
  };
  state.threads.forEach((t) => pick(t.name, `suspect · ${t.tagline}`, `ai:${t.key}`));
  (state.peers || []).forEach((x) => pick(x.name, 'player', `p:${x.pid}`));
  $('#groupCreate').onclick = async () => {
    const vals = [...list.querySelectorAll('input:checked')].map((b) => b.value);
    const body = { name: $('#groupName').value, ai: vals.filter((v) => v.startsWith('ai:')).map((v) => v.slice(3)), players: vals.filter((v) => v.startsWith('p:')).map((v) => v.slice(2)) };
    if (body.ai.length + body.players.length < 2) { note.textContent = 'Pick at least two.'; return; }
    try {
      const g = await api('/groups', { method: 'POST', body: JSON.stringify(body) });
      state.groups = [...(state.groups || []).filter((x) => x.id !== g.id), g];
      sheet.close(); go('messages', g.thread);
    } catch (ex) { note.textContent = ex.message; }
  };
  sheet.showModal();
}

// Share a clue, evidence card or recording with the crew or one player.
function openShare(m) {
  const sheet = $('#shareSheet'); const list = $('#shareList');
  list.replaceChildren();
  const targets = [{ to: 'crew', label: 'The Crew (everyone)' }, ...(state.groups || []).map((g) => ({ to: g.thread, label: `${g.name} (group)` })), ...(state.peers || []).map((x) => ({ to: x.pid, label: `${x.name} (private)` }))];
  targets.forEach(({ to, label }) => {
    const b = el('button', 'choice', label);
    b.onclick = async () => {
      b.disabled = true;
      try { await api('/peer', { method: 'POST', body: JSON.stringify({ to, forward: m.id }) }); sheet.close(); sfx.click(); }
      catch (ex) { b.textContent = ex.message; b.disabled = false; }
    };
    list.append(b);
  });
  sheet.showModal();
}
const isPeerThread = (t) => t === 'crew' || t.startsWith('dm:') || t.startsWith('g:');
const groupOf = (t) => state.groups?.find((g) => g.thread === t);
const peerOf = (t) => state.peers?.find((x) => `dm:${x.pid}` === t);
const titleOf = (t) => READONLY[t] || (t === 'crew' ? 'The Crew' : peerOf(t)?.name || groupOf(t)?.name) || state.threads.find((x) => x.key === t)?.name || t;
const subOf = (t) =>
  t === 'line' ? 'no reply' : t === 'unknown' ? 'call log' : t === 'crew' ? `group chat · ${(state.peers?.length || 0) + 1} players`
    : peerOf(t) ? 'player · private' : groupOf(t) ? [...groupOf(t).ai.map((a) => a.name), ...groupOf(t).players].join(', ') : state.threads.find((x) => x.key === t)?.tagline || '';
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ============ sound (synthesized, no files) ============
const sfx = (() => {
  let ctx = null;
  let ringTimer = null;
  const enabled = () => store.get('bw-sound', '1') !== '0';
  const ensure = () => {
    if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; } }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  };
  const tone = (freq, at, dur, type = 'square', vol = 0.035, slideTo = null) => {
    const c = ensure(); if (!c || !enabled()) return;
    const o = c.createOscillator(); const g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, c.currentTime + at);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, c.currentTime + at + dur);
    g.gain.setValueAtTime(0.0001, c.currentTime + at);
    g.gain.exponentialRampToValueAtTime(vol, c.currentTime + at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + at + dur);
    o.connect(g).connect(c.destination); o.start(c.currentTime + at); o.stop(c.currentTime + at + dur + 0.05);
  };
  const buzz = (pattern) => { if (enabled() && navigator.vibrate) navigator.vibrate(pattern); };
  return {
    unlock: ensure,
    click: () => tone(1400, 0, 0.03, 'square', 0.02),
    msg: () => { tone(880, 0, 0.12); tone(660, 0.14, 0.18); buzz(60); },
    // Each suspect has their own text tone, so you know who it is before you look.
    from: (npc) => {
      const t = { ruth: [[523, 0, 0.22, 'sine'], [392, 0.24, 0.3, 'sine']], lily: [[740, 0, 0.1, 'triangle'], [740, 0.16, 0.1, 'triangle']],
        marcus: [[330, 0, 0.09, 'square'], [440, 0.1, 0.09, 'square']], teddy: [[988, 0, 0.07], [1319, 0.08, 0.07], [1568, 0.16, 0.1]] }[npc];
      if (!t) return sfx.msg();
      t.forEach(([f, at, dur, type = 'square']) => tone(f, at, dur, type)); buzz(60);
    },
    // The line goes dead: a short burst of static.
    static: () => {
      const c = ensure(); if (!c || !enabled()) return;
      const len = Math.floor(c.sampleRate * 0.45); const buf = c.createBuffer(1, len, c.sampleRate); const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = c.createBufferSource(); const g = c.createGain(); g.gain.value = 0.06; src.buffer = buf; src.connect(g).connect(c.destination); src.start();
    },
    tick: () => tone(1800, 0, 0.04, 'square', 0.03),
    hum: () => { tone(55, 0, 1.6, 'sawtooth', 0.05, 110); tone(82, 0.2, 1.4, 'sine', 0.05, 164); },
    creak: () => tone(140, 0, 0.5, 'sawtooth', 0.02, 70),
    ring: () => {
      const once = () => { for (let i = 0; i < 2; i++) { tone(440, i * 0.5, 0.4, 'sine', 0.06); tone(480, i * 0.5, 0.4, 'sine', 0.06); } buzz([400, 100, 400]); };
      clearInterval(ringTimer); // a second ring signal (reconnect, refresh) must not start a ring that never stops
      once(); ringTimer = setInterval(once, 2400);
    },
    stopRing: () => { clearInterval(ringTimer); ringTimer = null; if (navigator.vibrate) navigator.vibrate(0); },
  };
})();
addEventListener('pointerdown', () => sfx.unlock(), { once: true });

// ============ seen/unseen (per device) ============
const seenKey = `bw-seen-${token}`;
let seen = {};
try { seen = JSON.parse(store.get(seenKey, '{}')); } catch { seen = {}; }
const markSeen = (k) => { seen[k] = new Date().toISOString(); store.set(seenKey, JSON.stringify(seen)); };
const isNew = (m, k) => m.from !== 'player' && (!seen[k] || m.at > seen[k]);
const unread = (thread) => state.messages.some((m) => m.thread === thread && isNew(m, thread));
const unreadCalls = () => state.messages.filter((m) => m.thread === 'unknown' && m.kind === 'call' && isNew(m, 'calls')).length;
const unreadEvidence = () => state.messages.filter((m) => EVIDENCE_KINDS.has(m.kind) && isNew(m, 'evidence')).length;
const unreadThreads = () => ['line', 'crew', ...(state.groups || []).map((g) => g.thread), ...(state.peers || []).map((x) => `dm:${x.pid}`), ...state.threads.map((t) => t.key)].filter(unread).length;

// ============ time ============
const fmtTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
function tick() {
  const now = new Date();
  $('#clock').textContent = fmtTime(now);
  const big = $('#bigClock'); if (big) big.textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M/i, '');
  const d = $('#bigDate'); if (d) d.textContent = now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '').toUpperCase();
  const nc = $('#nightClock'); if (nc) { const t = nightClockText(); nc.textContent = t; nc.hidden = !t; }
}
// "Votes open in 18 min", then "Final call in 5 min": the pace of the night, on the home screen.
function nightClockText(now = Date.now()) {
  const c = state.clock;
  if (!c || state.revealed) return '';
  if (c.paused) return '⏸ PAUSED BY THE HOST';
  const mins = (iso) => Math.max(0, Math.ceil((Date.parse(iso) - now) / 60_000));
  if (c.votesAt && Date.parse(c.votesAt) > now) return `VOTES OPEN IN ${mins(c.votesAt)} MIN`;
  if (c.finalAt) return Date.parse(c.finalAt) > now ? `FINAL CALL IN ${mins(c.finalAt)} MIN` : 'THE FINAL CALL IS COMING';
  return '';
}
setInterval(tick, 10_000);
// Time left in the game, on every screen: a countdown to the final call (from the host's schedule). Red in the last
// five minutes; hidden when there's no schedule or the night is over.
function countdownText(now = Date.now()) {
  const c = state.clock;
  if (!c || state.revealed || !c.finalAt) return null;
  if (c.paused) return { text: '⏸ PAUSED', urgent: false };
  const left = Math.max(0, Math.floor((Date.parse(c.finalAt) - now) / 1000));
  const h = Math.floor(left / 3600), m = Math.floor((left % 3600) / 60), sec = left % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return { text: `⏳ ${h ? `${h}:${pad(m)}` : m}:${pad(sec)}`, urgent: left <= 300 };
}
function tickCountdown() {
  const el2 = $('#countdown'); if (!el2) return;
  const t = countdownText();
  el2.hidden = !t;
  if (t) { el2.textContent = t.text; el2.classList.toggle('urgent', t.urgent); }
}
setInterval(tickCountdown, 1000);

// ============ icons ============
const ICONS = {
  messages: '<path d="M4 5h16v11H9l-5 4z"/>',
  calls: '<path d="M5 4l4-1 2 5-2 1.5a11 11 0 005 5L15.5 13l5 2-1 4a2 2 0 01-2 1.5A15 15 0 013.5 6 2 2 0 015 4z"/>',
  evidence: '<path d="M3 6h7l2 2h9v11H3z"/><path d="M3 11h18"/>',
  notes: '<path d="M5 3h14v18H5z"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  vote: '<path d="M4 4h16v16H4z"/><path d="M8 12l3 3 6-7"/>',
  recap: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  share: '<path d="M12 3v12M8 7l4-4 4 4"/><path d="M8 10H5v11h14V10h-3"/>',
};
const icon = (name) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); s.innerHTML = ICONS[name]; return s;
};
// The wallpaper: Blackwood Manor at night (from the intro), with drifting fog and lights that flicker. Its mood
// follows the night (see the data-phase styles): warm at first, colder after dark, red near the end, grey at dawn.
const WALL = '<div class="wall" aria-hidden="true"><i class="fog a"></i><i class="fog b"></i><i class="grain"></i></div>';

// ============ navigation ============
function go(view, open = null) {
  const leavingGuide = state.view === 'tutorial';
  state.view = open ? 'convo' : view; state.open = open;
  sfx.click(); render();
  if (leavingGuide || view === 'tutorial') {
    $('#screen').scrollTop = 0;
    $('#screen h1, #screen .app-title, #screen .convo-head .title, #screen .home-guide')?.focus();
  }
}
function goBack() {
  if (state.view === 'convo') return go('messages');
  if (state.view !== 'home') return go('home');
}

// ============ rendering ============
let lastKey = '';
function render() {
  setTimeout(() => music.sync(), 0);
  const screen = $('#screen');
  const key = `${state.view}:${state.open || ''}`;
  const keepScroll = key === lastKey ? screen.scrollTop : 0;
  const active = document.activeElement;
  const hadFocus = active?.tagName === 'TEXTAREA' && screen.contains(active);
  const phone = $('#phone');
  phone.dataset.view = state.view;
  $('#tutorialControls').hidden = state.view !== 'tutorial';
  $('#skBack').disabled = state.view === 'home';
  $('#installBanner').style.display = state.view === 'home' ? '' : 'none';
  screen.replaceChildren();

  switch (state.view) {
    case 'home': renderHome(screen); break;
    case 'messages': renderThreads(screen); break;
    case 'convo': renderConvo(screen, state.open); break;
    case 'calls': renderCalls(screen); break;
    case 'evidence': renderEvidence(screen); break;
    case 'notes': renderNotes(screen); break;
    case 'vote': renderVote(screen); break;
    case 'recap': renderRecap(screen); break;
    case 'tutorial': renderTutorial(screen); break;
  }
  screen.querySelector('.app-title, .convo-head .title')?.setAttribute('tabindex', '-1');
  renderTutorialPrompt();
  if (state.view !== 'convo') screen.scrollTop = keepScroll;
  lastKey = key;
  if (hadFocus) { const t = screen.querySelector('textarea'); if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); } }
  tick();
}

function appButton(name, label, view, count = 0, locked = false) {
  const b = el('button', `app${locked ? ' locked' : ''}`);
  b.setAttribute('aria-label', `${label}${count > 0 ? `, ${count} new` : ''}${locked ? ', locked' : ''}`);
  const tile = el('span', 'ico'); // the rounded app icon, like a real phone's home screen
  tile.append(icon(name));
  if (count > 0) tile.append(el('i', 'badge', String(count)));
  b.append(tile, el('span', 'lbl', label));
  b.onclick = () => { if (locked) { sfx.creak(); flashNote('NOT YET.'); return; } go(view); };
  return b;
}

function homeNote() {
  const n = unreadThreads(), c = unreadCalls();
  if (c) return { text: `${c} MISSED CALL${c > 1 ? 'S' : ''}`, hot: true };
  if (n) return { text: `${n} NEW MESSAGE${n > 1 ? 'S' : ''}`, hot: true };
  if (state.revealed) return { text: 'THE LINE IS QUIET.', hot: false };
  return { text: 'LINE OPEN', hot: false };
}
let noteOverride = null;
function flashNote(text) {
  noteOverride = text; render();
  setTimeout(() => { noteOverride = null; if (state.view === 'home') render(); }, 1400);
}

// ---- home: the lock screen of the burner phone ----
const PHASE_LABEL = {
  before: 'THE LINE OPENS TONIGHT', early: 'THE LINE IS OPEN', late: 'AFTER DARK', deep: 'THE WITCHING HOUR',
  final: 'VOTES ARE OPEN', after: 'CASE CLOSED',
};
// The four suspects, at a glance: who's online, typing, live, or still a stranger.
function castStrip() {
  const row = el('div', 'cast-strip');
  Object.keys(CAST).forEach((k) => {
    const t = state.threads.find((x) => x.key === k);
    const b = el('button', 'cast-chip');
    if (!t) {
      b.classList.add('unknown'); b.disabled = true; b.setAttribute('aria-label', 'Unknown number');
      b.append(el('span', 'avatar av-none', '?'), el('span', 'nm', '???'));
      row.append(b); return;
    }
    const live = /LIVE/.test(t.status || '');
    if (state.typing[k]) b.classList.add('typing');
    else if (live) b.classList.add('live');
    else if (presence(k) === 'online') b.classList.add('online');
    if (unread(k)) b.classList.add('unread');
    b.setAttribute('aria-label', `${CAST[k]}${state.typing[k] ? ', typing' : live ? ', live' : ''}${unread(k) ? ', new message' : ''}`);
    b.append(avatar(k), el('span', 'nm', CAST[k].split(' ')[0]));
    b.onclick = () => { markSeen(k); go('messages', k); };
    row.append(b);
  });
  return row;
}
function renderHome(screen) {
  const home = el('div', 'home');
  const clock = el('div', 'home-clock');
  clock.append(el('div', 'big', '--:--'), el('div', 'date', ''));
  clock.firstChild.id = 'bigClock'; clock.lastChild.id = 'bigDate';
  // One line under the clock: what needs you (missed calls, new messages), otherwise where the story is.
  const note = homeNote();
  const quiet = !note.hot && !noteOverride && PHASE_LABEL[state.phase];
  const line = el('div', `home-note${note.hot && !noteOverride ? ' hot' : ''}${quiet ? ' quiet' : ''}`, noteOverride || (quiet ? PHASE_LABEL[state.phase] : note.text));
  const grid = el('div', 'grid');
  grid.append(
    appButton('messages', 'Messages', 'messages', unreadThreads()),
    appButton('calls', 'Calls', 'calls', unreadCalls()),
    appButton('evidence', 'Evidence', 'evidence', unreadEvidence()),
    appButton('notes', 'Notebook', 'notes', (state.agenda?.goals || []).filter((g) => g.status === 'done').length > seenAgenda() ? 1 : 0),
    appButton('vote', 'Vote', 'vote'),
    appButton('recap', 'The End', 'recap', 0, !state.revealed),
  );
  if (state.lobby?.status === 'lobby') home.append(clock, lobbyPanel(), grid);
  else {
    const nc = el('div', `night-clock${state.clock?.paused ? ' paused' : ''}`, nightClockText()); nc.id = 'nightClock'; nc.hidden = !nc.textContent;
    home.append(clock, line, nc, castStrip(), grid);
  }
  // The field guide stays on the home screen until it's done; after that it lives in the ⋮ menu.
  if (tutorial.status !== 'complete') {
    const guide = el('button', 'home-guide');
    guide.append(el('span', null, 'FIELD GUIDE'), el('small', null,
      tutorial.status === 'new' ? 'New here? Start the tutorial' : `Resume tutorial · ${tutorial.step + 1} / ${TUTORIAL_TITLES.length}`));
    guide.onclick = () => startTutorial();
    home.append(guide);
  }
  home.dataset.phase = state.phase || 'before';
  home.insertAdjacentHTML('afterbegin', WALL);
  screen.append(home);
}

// ---- auto mode lobby (before the organizer starts the game) ----
// The organizer lands on the lobby (invite + Start) rather than the tutorial; the field guide is one tap away.
const organizerWaiting = () => state.lobby?.status === 'lobby' && state.lobby.organizer;

function lobbyPanel() {
  const L = state.lobby;
  const box = el('div', 'lobby');
  box.append(el('div', 'lobby-title', 'WAITING FOR THE LINE TO OPEN'), el('div', 'lobby-sub', L.lengthLabel),
    el('div', 'lobby-names', `${L.joined.join(' · ')}  (${L.joined.length})`));
  if (L.invite) {
    const url = `${location.origin}${L.invite}`;
    const inv = el('button', 'wide ghost', 'INVITE FRIENDS');
    inv.onclick = async () => {
      sfx.click();
      if (navigator.share) { navigator.share({ title: 'The Blackwood Line', text: 'The house is calling. Join my game:', url }).catch(() => {}); return; }
      try { await navigator.clipboard.writeText(url); inv.textContent = 'LINK COPIED'; } catch { prompt('Send this link to your friends', url); }
    };
    box.append(inv);
  }
  if (L.organizer) {
    const err = el('p', 'note bad');
    const ready = L.joined.length >= L.minPlayers;
    const start = el('button', 'wide', ready ? 'START THE GAME' : `NEED ${L.minPlayers - L.joined.length} MORE`);
    start.disabled = !ready;
    start.onclick = async () => {
      start.disabled = true; sfx.creak();
      try { await api('/start', { method: 'POST', body: '{}' }); }
      catch (ex) { err.textContent = ex.message; start.disabled = false; }
    };
    box.append(start, err);
  } else {
    box.append(el('p', 'note', 'The organizer will start the game. Keep this phone close.'));
  }
  box.append(el('p', 'fine', 'This link is your private phone. Add it to your home screen.'));
  return box;
}

// ============ new-player field guide ============
function startTutorial() {
  if (tutorial.status === 'complete') tutorial.step = 0;
  tutorial.status = 'active'; saveTutorial(); go('tutorial');
}

function leaveTutorial(complete = false) {
  tutorial.status = complete ? 'complete' : 'paused';
  saveTutorial(); go('home');
}

function tutorialPage(index) {
  tutorial.step = index; saveTutorial(); go('tutorial');
}

function renderTutorialPrompt() {
  const prompt = $('#tutorialPrompt');
  const show = tutorial.status === 'active' && state.view !== 'tutorial';
  prompt.hidden = !show;
  const key = show ? String(tutorial.step) : '';
  if (!show || prompt.dataset.step === key) return;
  prompt.dataset.step = key;
  prompt.replaceChildren();
  const text = el('div');
  text.append(el('small', null, `TUTORIAL ${tutorial.step + 1} / ${TUTORIAL_TITLES.length}`),
    el('span', null, TUTORIAL_TITLES[tutorial.step]));
  const back = el('button', null, 'RETURN TO GUIDE');
  back.onclick = () => go('tutorial');
  prompt.append(text, back);
}

// Small diagrams that replace paragraphs of instructions in the field guide.
function tutorialVisual(v) {
  const fig = el('figure', `tv tv-${v.type}`);
  if (v.type === 'calls') {
    const segs = 10;
    const lit = v.max == null ? segs : v.max ? Math.ceil((v.left / v.max) * segs) : 0;
    const bar = el('div', 'tv-segs');
    for (let i = 0; i < segs; i++) bar.append(el('i', i < lit ? 'on' : ''));
    const row = (label, value) => { const r = el('div', 'tv-row'); r.append(el('span', null, label), el('b', null, value)); return r; };
    fig.append(row(v.shared ? '☎ GROUP CALL TIME' : '☎ CALL TIME LEFT', v.max == null ? 'UNLIMITED' : `${v.left} / ${v.max} MIN`), bar, row('⏱ EACH CALL', `UP TO ${fmtSec(v.maxSeconds)}`),
      el('figcaption', null, 'Out of call time? Texting always works.'));
  } else if (v.type === 'share') {
    const card = el('div', 'tv-card'); card.append(el('small', null, 'CLUE'), el('span', null, '▤ ▤▤▤ ▤▤'), el('b', null, '↗ SHARE'));
    const chat = el('div', 'tv-chat'); chat.append(el('small', null, 'THE CREW'), el('span', 'tv-bubble', '↗ shared a clue'), el('span', 'tv-bubble them', 'that time is wrong…'));
    fig.append(card, el('span', 'tv-arrow', '→'), chat);
  } else if (v.type === 'board') {
    const chips = el('div', 'tv-chips');
    [['?', ''], ['SUSPICIOUS', 'sus'], ['CLEARED', 'clear']].forEach(([label, cls], i) => {
      if (i) chips.append(el('span', 'tv-arrow', '→'));
      chips.append(el('span', `tv-chip ${cls}`, label));
    });
    fig.append(chips, el('figcaption', null, 'Tap a name on the suspect board to mark your theory.'));
  } else if (v.type === 'timeline') {
    const line = el('div', 'tv-line');
    [['NOW', 'Vote or change it'], ['VOTES OPEN', 'The Line tells you'], ['FINAL CALL', 'The reveal']].forEach(([when, what], i) => {
      const stop = el('div', `tv-stop${i === 2 ? ' end' : ''}`);
      stop.append(el('i'), el('b', null, when), el('span', null, what));
      line.append(stop);
    });
    fig.append(el('small', 'tv-night', 'TONIGHT'), line);
  }
  return fig;
}

function renderTutorial(screen) {
  const step = tutorialStep(tutorial.step, state);
  const box = el('article', 'tutorial');
  const header = el('div', 'tutorial-head');
  header.append(icon(step.icon), el('span', null, 'HOW TO PLAY'),
    el('span', 'tutorial-count', `${tutorial.step + 1} / ${TUTORIAL_TITLES.length}`));
  const progress = el('nav', 'tutorial-progress');
  progress.setAttribute('aria-label', 'Tutorial steps');
  TUTORIAL_TITLES.forEach((title, i) => {
    const button = el('button', i === tutorial.step ? 'current' : i < tutorial.step ? 'past' : '');
    button.setAttribute('aria-label', `Step ${i + 1}: ${title}`);
    if (i === tutorial.step) button.setAttribute('aria-current', 'step');
    button.onclick = () => tutorialPage(i);
    progress.append(button);
  });
  const title = el('h1', null, step.title); title.tabIndex = -1;
  box.append(header, progress, el('div', 'tutorial-tag', step.tag), title, el('p', 'tutorial-intro', step.intro));
  if (step.hint) {
    const hint = el('div', 'tutorial-example');
    hint.append(el('small', null, step.hint.label), el('p', null, step.hint.text));
    box.append(hint);
  }
  if (step.visual) box.append(tutorialVisual(step.visual));
  if (step.points.length) {
    const points = el('ul', 'tutorial-points');
    step.points.forEach((text) => points.append(el('li', null, text)));
    box.append(points);
  }
  const tip = el('div', 'tutorial-tip');
  tip.append(el('b', null, 'NEXT'), el('p', null, step.tip));
  box.append(tip);
  (step.actions || []).forEach((action, i) => {
    const button = el('button', i === 0 ? 'wide' : 'wide ghost', action.label);
    button.onclick = () => go(action.view, action.open);
    box.append(button);
  });
  if (step.extra) box.append(el('p', 'tutorial-extra', step.extra));
  const controls = el('div', 'tutorial-controls');
  const previous = el('button', 'wide ghost', 'PREVIOUS');
  previous.disabled = tutorial.step === 0;
  previous.onclick = () => tutorialPage(tutorial.step - 1);
  const next = el('button', 'wide', tutorial.step === TUTORIAL_TITLES.length - 1 ? 'FINISH GUIDE' : 'NEXT');
  next.onclick = () => tutorial.step === TUTORIAL_TITLES.length - 1 ? leaveTutorial(true) : tutorialPage(tutorial.step + 1);
  controls.append(previous, next);
  const later = el('button', 'tutorial-later', 'DO THIS LATER');
  later.onclick = () => leaveTutorial();
  $('#tutorialControls').replaceChildren(controls, later);
  screen.append(box);
}

function lastOf(thread) {
  const list = state.messages.filter((m) => m.thread === thread);
  return list[list.length - 1];
}
const preview = (m) =>
  ((m.from === 'peer' || (m.from === 'character' && m.sender)) && !m.thread.startsWith('dm:') && m.sender ? `${m.sender.split(' ')[0]}: ` : '') +
  (m.forwarded ? '↗ shared ' : '') +
  (m.kind === 'secret' ? 'Open this alone.' : m.kind === 'memo' ? '▶ Voice memo' : m.kind === 'voicemail' ? '▶ Voicemail' : m.kind === 'photo' ? '📷 Photo'
    : m.text.replace(/\s+/g, ' '));

function threadRow(thread, extraClass = '') {
  const li = el('li', unread(thread) ? 'unread' : '');
  const b = el('button');
  const last = lastOf(thread);
  if (CAST[thread] || thread.startsWith('dm:')) { b.classList.add('has-av'); b.append(avatar(thread, titleOf(thread))); }
  else if (thread === 'line') { b.classList.add('has-av'); b.append(lineAvatar()); }
  b.append(
    el('span', `name ${extraClass}`, titleOf(thread)),
    el('span', 'time', last ? fmtTime(last.at) : ''),
    el('span', 'preview', state.typing[thread] ? 'typing…' : last ? preview(last) : subOf(thread)),
  );
  b.onclick = () => { markSeen(thread); go('messages', thread); };
  li.append(b);
  return li;
}

function renderThreads(screen) {
  screen.append(el('div', 'app-title', 'MESSAGES'));
  const ul = el('ul', 'list');
  ul.append(threadRow('line', 'caps'), threadRow('crew', 'caps crew'));
  screen.append(ul);
  const gl = el('div', 'section-label row-label');
  gl.append(el('span', null, 'GROUPS'));
  const newG = el('button', 'newgroup', '+ NEW GROUP');
  newG.onclick = openNewGroup;
  gl.append(newG);
  screen.append(gl);
  if (state.groups?.length) {
    const ug = el('ul', 'list');
    state.groups.forEach((g) => ug.append(threadRow(g.thread)));
    screen.append(ug);
  }
  if (state.peers?.length) {
    screen.append(el('div', 'section-label', 'PLAYERS'));
    const up = el('ul', 'list');
    state.peers.forEach((x) => up.append(threadRow(`dm:${x.pid}`)));
    screen.append(up);
  }
  screen.append(el('div', 'section-label', 'CONTACTS'));
  const people = [...state.threads].sort((a, b) => (lastOf(b.key)?.at || '').localeCompare(lastOf(a.key)?.at || ''));
  const ul2 = el('ul', 'list');
  people.forEach((t) => ul2.append(threadRow(t.key)));
  screen.append(ul2);
}

function renderCalls(screen) {
  markSeen('calls');
  screen.append(el('div', 'app-title', 'CALL LOG'));
  const calls = state.messages.filter((m) => m.thread === 'unknown' && CALL_KINDS.has(m.kind)).reverse();
  if (!calls.length) screen.append(el('div', 'empty', 'No calls yet.\n\nWhen the line rings, answer it.'));
  else {
    const ul = el('ul', 'list');
    calls.forEach((m) => {
      if (m.kind === 'voicemail') { const li = el('li', 'vm-row'); li.append(messageNode(m)); ul.append(li); return; }
      const li = el('li', `call-row ${m.kind}`);
      const b = el('button', 'has-av'); b.disabled = true;
      const label = { call: '☎ incoming · real phone', calllog: '☎ call', missed: '✕ missed' }[m.kind];
      const who = m.kind === 'missed' ? m.text.replace(/^Missed call: /, '') : m.kind === 'calllog' ? m.text.split(' · ')[0] : 'BLACKWOOD MANOR';
      b.append(avatar(m.npc || keyOfName(who)));
      b.append(el('span', 'name', m.kind === 'missed' ? m.text.replace(/^Missed call: /, '') : m.kind === 'calllog' ? m.text.split(' · ')[0] : 'BLACKWOOD MANOR'),
        el('span', 'time', fmtTime(m.at)), el('span', 'preview', m.kind === 'calllog' ? `${label} · ${m.text.split(' · ')[1] || ''}` : label));
      li.append(b); ul.append(li);
    });
    screen.append(ul);
  }
  if (state.threads.length) {
    screen.append(el('div', 'section-label', 'CALL SOMEONE'));
    const ul2 = el('ul', 'list');
    state.threads.forEach((t) => {
      const li = el('li'); const b = el('button', 'has-av');
      b.append(avatar(t.key), el('span', 'name', t.name), el('span', 'time', '☎'), el('span', 'preview', [t.tagline, t.status].filter(Boolean).join(' · ')));
      b.onclick = () => startCall(t.key);
      li.append(b); ul2.append(li);
    });
    screen.append(ul2);
  }
}

// ---- audio evidence: one shared player so re-rendering never stops playback ----
const audioEl = new Audio();
audioEl.preload = 'none';
let audioId = null;
const fmtSec = (x) => `${Math.floor(x / 60)}:${String(Math.floor(x % 60)).padStart(2, '0')}`;
function paintAudio() {
  document.querySelectorAll('[data-audio]').forEach((n) => {
    const mine = n.dataset.audio === audioId;
    const playing = mine && !audioEl.paused;
    n.classList.toggle('playing', playing);
    n.querySelector('.play').textContent = playing ? '❚❚' : '▶';
    const prog = mine && audioEl.duration ? audioEl.currentTime / audioEl.duration : 0;
    n.querySelectorAll('.wave i').forEach((bar, i, all) => bar.classList.toggle('done', i / all.length < prog));
    n.querySelector('.secs').textContent = mine && audioEl.duration ? `${fmtSec(audioEl.currentTime)} / ${fmtSec(audioEl.duration)}` : '';
  });
}
['timeupdate', 'play', 'pause', 'ended', 'loadedmetadata'].forEach((ev) => audioEl.addEventListener(ev, paintAudio));
function audioPlayer(m) {
  const box = el('div', 'player'); box.dataset.audio = m.id;
  const btn = el('button', 'play', '▶'); btn.setAttribute('aria-label', 'Play recording');
  const wave = el('div', 'wave');
  for (let i = 0; i < 38; i++) { const bar = el('i'); bar.style.height = `${6 + Math.abs(Math.sin(i * 1.7 + m.id.length)) * 20 * (i % 7 === 0 ? 0.3 : 1)}px`; wave.append(bar); }
  box.append(btn, wave, el('span', 'secs', ''));
  btn.onclick = (e) => {
    e.stopPropagation();
    if (audioId === m.id && !audioEl.paused) { audioEl.pause(); return; }
    if (audioId !== m.id) { audioEl.src = m.audio; audioId = m.id; }
    audioEl.play().catch(() => {});
  };
  return box;
}

function messageNode(m) {
  let node;
  if (m.kind === 'photo') {
    const who = m.from === 'player' ? 'me' : m.from === 'peer' ? 'them peer' : 'them';
    node = el('div', `bubble ${who} photo`);
    const img = el('img'); img.src = m.image; img.alt = m.text || 'Photo'; img.loading = 'lazy';
    img.onclick = (e) => { e.stopPropagation(); openLightbox({ image: m.image, caption: m.text }); };
    node.append(img);
    if (m.text) node.append(el('span', 'cap', m.text));
  } else if (m.kind === 'secret') {
    node = el('div', 'secret');
    node.append(el('span', 'tag', 'FOR YOUR EYES ONLY'), el('div', 'body', m.text), el('div', 'hint', 'Make sure no one is looking, then tap to read.'));
    node.onclick = () => { node.classList.add('open'); sfx.creak(); };
  } else if (EVIDENCE_KINDS.has(m.kind)) {
    node = el('div', `card ${m.kind}`);
    const tag = m.kind === 'evidence' && /^SECRET UNCOVERED · HEARD ON A CALL/.test(m.text) ? '☎ HEARD ON A CALL' : m.kind === 'evidence' && /^SECRET UNCOVERED/.test(m.text) ? 'NEW EVIDENCE' : { clue: 'YOUR CLUE', memo: 'VOICE MEMO', evidence: 'EVIDENCE', reveal: 'CASE CLOSED' }[m.kind];
    node.append(el('span', 'tag', tag));
    if (m.audio) node.append(audioPlayer(m));
    else if (m.kind === 'memo') {
      const wave = el('div', 'wave');
      for (let i = 0; i < 38; i++) { const bar = el('i'); bar.style.height = `${6 + Math.abs(Math.sin(i * 1.7)) * 20 * (i % 7 === 0 ? 0.3 : 1)}px`; wave.append(bar); }
      node.append(wave);
    }
    node.append(document.createTextNode(m.text));
    const art = m.kind === 'clue' && CLUE_ART.find(([re]) => re.test(m.text));
    if (art) node.append(artImg(art[1], m.text.split('\n').pop()));
    if (m.kind === 'evidence' && /^SECRET UNCOVERED/.test(m.text)) node.classList.add('found');
    if (m.kind === 'evidence' && /HEARD ON A CALL/.test(m.text.split('\n')[0])) node.classList.add('oncall');
  } else if (m.kind === 'voicemail') {
    node = el('div', 'card voicemail');
    node.append(el('span', 'tag', 'VOICEMAIL'));
    if (CAST[m.npc]) { const h = el('div', 'vm-head'); h.append(avatar(m.npc), el('b', null, CAST[m.npc].toUpperCase())); node.append(h); }
    if (m.audio) node.append(audioPlayer(m));
    node.append(document.createTextNode(m.text));
  } else if (m.kind === 'contact') {
    node = el('div', 'bubble contact', m.text);
  } else {
    const who = m.from === 'player' ? 'me' : m.from === 'system' ? 'system' : m.from === 'peer' ? 'them peer' : 'them';
    node = el('div', `bubble ${who}`, m.text);
  }
  if (m.forwarded) {
    const tagEl = node.querySelector('.tag');
    const by = m.from === 'player' ? 'YOU SHARED' : `SHARED BY ${String(m.sender || '').toUpperCase()}`;
    if (tagEl) tagEl.textContent = `${by} · ${tagEl.textContent}`;
  }
  if (SHARE_KINDS.has(m.kind) && !(m.forwarded && m.from === 'player') && (state.peers || []).length) {
    const share = el('button', 'share', '↗ SHARE');
    share.onclick = (e) => { e.stopPropagation(); openShare(m); };
    node.append(share);
  }
  if ((m.thread === 'crew' || m.thread.startsWith('g:')) && m.sender && m.from !== 'player' && !node.classList.contains('card')) {
    const wrap = el('div', 'peerwrap');
    wrap.append(el('div', `sender${m.from === 'character' ? ' ai' : ''}`, m.sender), node);
    node = wrap;
  }
  const at = state.arrived[m.id];
  if (at && Date.now() - at < 900 && !reduceMotion) { node.classList.add('fresh'); node.style.animationDelay = `${-(Date.now() - at)}ms`; }
  return node;
}

function renderConvo(screen, thread) {
  const head = el('div', 'convo-head');
  const info = el('div', 'who');
  const sub = el('div', 'sub');
  if (CAST[thread]) {
    // What they're up to (follows the story) and when they were last on their phone.
    const st = statusOf(thread);
    const seen = presence(thread);
    sub.append(el('span', /LIVE/.test(st) ? 'live' : null, st || subOf(thread)));
    if (seen) sub.append(' · ', el('span', seen === 'online' ? 'on' : null, seen));
    const face = avatar(thread);
    face.onclick = () => openLightbox({ video: `/assets/cast/${thread}.mp4`, poster: `/assets/cast/${thread}.jpg`, caption: `${CAST[thread]} · ${subOf(thread)}` });
    head.append(face);
  } else {
    sub.textContent = subOf(thread);
    if (thread === 'line') head.append(lineAvatar());
  }
  info.append(el('div', 'to', READONLY[thread] ? 'FROM' : 'TO'), el('div', 'title', titleOf(thread)), sub);
  head.append(info);
  if (!READONLY[thread] && !isPeerThread(thread)) {
    const call = el('button', 'callbtn', '☎ CALL');
    call.onclick = () => startCall(thread);
    const calls = state.me?.calls;
    if (calls) {
      const box = el('div', 'callbox');
      const out = calls.minutesLeft === 0;
      box.append(call, el('div', `callsleft${out ? ' out' : ''}`, out ? (calls.shared ? 'GROUP IS OUT OF CALL TIME' : 'NO CALL TIME LEFT')
        : calls.minutesLeft == null ? `UP TO ${fmtSec(calls.maxSeconds)}` : `${calls.shared ? 'GROUP: ' : ''}${calls.minutesLeft} MIN LEFT · ${fmtSec(calls.maxSeconds)} MAX`));
      head.append(box);
    } else head.append(call);
  }

  const wrap = el('div', 'bubbles');
  let lastStamp = '';
  state.messages.filter((m) => m.thread === thread).forEach((m) => {
    const stamp = new Date(m.at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
    if (stamp !== lastStamp) { wrap.append(el('div', 'stamp', stamp.toUpperCase())); lastStamp = stamp; }
    wrap.append(messageNode(m));
  });
  if (!wrap.children.length) wrap.append(el('div', 'empty', 'No messages yet.'));
  // Read receipt under your last text to a character (they don't answer everything, but they do read it).
  const mine = state.messages.filter((m) => m.thread === thread && m.from !== 'system');
  const lastMsg = mine[mine.length - 1];
  if (lastMsg?.from === 'player' && !READONLY[thread] && !isPeerThread(thread)) {
    wrap.append(el('div', 'receipt', lastMsg.readAt
      ? `Read ${new Date(lastMsg.readAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
      : 'Delivered'));
  }
  if (state.typing[thread]) {
    const t = el('div', 'typing');
    if (typeof state.typing[thread] === 'string') t.append(`${state.typing[thread].split(' ')[0]} is typing `);
    t.append(el('span', null, '●'), el('span', null, '●'), el('span', null, '●'));
    wrap.append(t);
  }
  screen.append(head, wrap);

  if (READONLY[thread]) {
    screen.append(el('div', 'readonly', 'Replies to this number are not delivered.'));
  } else {
    const err = el('div', 'error-line');
    const form = el('form', 'composer');
    const input = el('textarea');
    input.placeholder = thread === 'crew' ? 'Message the crew…' : thread.startsWith('g:') ? 'Message the group…' : `Text ${titleOf(thread).split(' ')[0]}…`;
    input.rows = 1; input.maxLength = 500;
    input.value = state.drafts[thread] || '';
    const send = el('button', null, 'SEND');
    send.type = 'submit';
    input.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } };
    input.oninput = () => { state.drafts[thread] = input.value; err.textContent = ''; };
    form.onsubmit = async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) { err.textContent = 'Type a message first.'; return; }
      err.textContent = ''; send.disabled = true; sfx.click();
      state.drafts[thread] = ''; input.value = ''; // clear first: the reply can re-render this screen before the request returns
      try {
        if (isPeerThread(thread)) await api('/peer', { method: 'POST', body: JSON.stringify({ to: thread.startsWith('dm:') ? thread.slice(3) : thread, text }) });
        else {
          // Same text resent after a failure keeps its id, so a send that did reach the server isn't answered twice.
          const prev = state.sendIds?.[thread];
          const clientId = prev?.text === text ? prev.id : (crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`);
          (state.sendIds ||= {})[thread] = { text, id: clientId };
          await api('/messages', { method: 'POST', body: JSON.stringify({ thread, text, clientId }) });
          delete state.sendIds[thread];
        }
      } catch (ex) {
        state.drafts[thread] = text;
        const live = $('#screen textarea'); if (live && !live.value) live.value = text;
        const errLive = $('#screen .error-line'); (errLive || err).textContent = ex.message;
      } finally {
        send.disabled = false; ($('#screen textarea') || input).focus();
      }
    };
    form.append(input, send);
    screen.append(err, form);
  }
  screen.scrollTop = screen.scrollHeight;
  markSeen(thread);
}

function renderEvidence(screen) {
  markSeen('evidence');
  screen.append(el('div', 'app-title', 'CASE FILE'));
  // The victim, first in the file: Dana, so she is a person and not just a name.
  const vic = el('div', 'victim');
  const vtext = el('div', 'vtext');
  vtext.append(el('span', 'tag', 'THE VICTIM'), el('b', null, VICTIM.name), el('span', 'vrole', `${VICTIM.age} · new owner of Blackwood Manor`));
  VICTIM.lines.forEach((l) => vtext.append(el('p', null, l)));
  const photo = portrait('dana', 'victim-photo');
  photo.onclick = () => openLightbox({ video: DANA_VIDEO(), poster: '/assets/cast/dana.jpg', caption: `${VICTIM.name}, three weeks before` });
  vic.append(photo, vtext);
  // The cold case under it all: Elias, missing since Halloween 1996.
  const cold = el('div', 'victim cold');
  const ctext = el('div', 'vtext');
  ctext.append(el('span', 'tag', 'THE COLD CASE · 1996'), el('b', null, 'Elias Blackwood'), el('span', 'vrole', 'Caretaker of Blackwood Manor'),
    el('p', null, 'Vanished on Halloween night, 1996. Everyone says he ran off. His daughter Lily never believed it.'));
  cold.append(artImg('elias-poster', 'MISSING: Elias Blackwood, last seen Halloween night, 1996'), ctext);
  screen.append(vic, cold);
  const items = state.messages.filter((m) => EVIDENCE_KINDS.has(m.kind) || (m.kind === 'photo' && m.from === 'character'));
  if (!items.length) { screen.append(el('div', 'empty', 'Nothing yet.\n\nClues, recordings and evidence you receive will be kept here.')); return; }
  const wrap = el('div', 'bubbles');
  items.forEach((m) => { wrap.append(el('div', 'stamp', fmtTime(m.at))); wrap.append(messageNode(m)); });
  screen.append(wrap);
}

// ---- notes + suspect board (stored on this device only) ----
const boardKey = `bw-board-${token}`, notesKey = `bw-notes-${token}`;
let board = {}; try { board = JSON.parse(store.get(boardKey, '{}')); } catch { board = {}; }
const BOARD_LABEL = ['?', 'SUSPICIOUS', 'CLEARED'];
const agendaKey = `bw-agenda-seen-${token}`;
const seenAgenda = () => Number(store.get(agendaKey, '0')) || 0;
const markAgendaSeen = () => store.set(agendaKey, String((state.agenda?.goals || []).filter((g) => g.status === 'done').length));
// Has this player met (unlocked) the suspect with this name?
const met = (name) => (state.threads || []).some((t) => t.name === name);
function renderNotes(screen) {
  screen.append(el('div', 'app-title', 'NOTEBOOK'));
  const box = el('div', 'notes');
  const ag = state.agenda;
  if (ag) {
    markAgendaSeen();
    box.append(el('div', 'section-label', 'SECRET AGENDA'));
    const sec = el('div', `agenda-secret${ag.leaked ? ' leaked' : ''}`);
    sec.append(el('span', 'tag', ag.leaked ? 'YOUR SECRET · PEOPLE ARE TALKING' : 'YOUR SECRET'), el('div', null, ag.secret || '🔒 Sealed until you meet the person it’s about.'));
    if (!ag.secret) sec.classList.add('sealed');
    box.append(sec);
    const ul = el('ul', 'agenda');
    const MARK = { done: '✓', failed: '✗', vote: '⧗', open: '', locked: '🔒' };
    ag.goals.forEach((g) => {
      const li = el('li', `st-${g.status}`);
      li.append(el('span', 'box', MARK[g.status]), el('span', null, g.text || 'Sealed. Meet the right person to reveal it.'));
      if (g.status === 'vote') li.append(el('em', null, 'decided at the vote'));
      ul.append(li);
    });
    box.append(ul, el('p', 'fine', 'Solving the murder comes first. These are extra, and nobody else can see them until the end.'));
  }
  // The lineup: all four suspects against the height chart, numbered. Tap one for their bio and to mark your theory.
  // Anyone you haven't met stands in the lineup as a shadow.
  box.append(el('div', 'section-label', 'THE LINEUP'));
  const keys = Object.keys(CAST);
  if (!keys.includes(state.lineupPick) || !met(CAST[state.lineupPick])) state.lineupPick = keys.find((k) => met(CAST[k])) || null;
  const pick = (k, known) => { if (!known) { flashNote('NOT MET YET.'); return; } state.lineupPick = k; sfx.click(); render(); };
  const lineup = el('div', 'lineup');
  keys.forEach((k, i) => {
    const known = met(CAST[k]);
    const s = board[CAST[k]] || 0;
    const b = el('button', `slot${state.lineupPick === k ? ' on' : ''}`);
    b.dataset.s = known ? s : 0;
    b.setAttribute('aria-label', known ? `${i + 1}: ${CAST[k]}` : `${i + 1}: someone you haven't met`);
    b.append(portrait(known ? k : null), el('span', 'placard', String(i + 1)), el('span', 'nm', known ? CAST[k].split(' ')[0] : '???'));
    if (known && s) b.append(el('em', 'mark', BOARD_LABEL[s]));
    b.onclick = () => pick(k, known);
    lineup.append(b);
  });
  // The lineup photo: all four against the height chart, left to right in cast order (where each one stands, in % of width).
  const LINEUP_SPOTS = [[2, 26.5], [26.5, 49.5], [49.5, 72.5], [72.5, 98]];
  // Hover (or tap) a suspect to learn more; anyone you haven't met stays in shadow. Falls back to the grid above.
  const photo = el('div', 'lineup-photo');
  const img = el('img'); img.alt = 'The four suspects in a police lineup';
  const srcs = ['/assets/cast/lineup.jpg', CDN_ART.lineup];
  img.src = srcs.shift();
  img.onerror = () => { if (srcs.length) img.src = srcs.shift(); else { photo.remove(); lineup.hidden = false; } };
  photo.append(img);
  keys.forEach((k, i) => {
    const known = met(CAST[k]);
    const s = known ? board[CAST[k]] || 0 : 0;
    const spot = el('button', `spot${known ? '' : ' hidden-suspect'}${state.lineupPick === k ? ' on' : ''}`);
    const [x0, x1] = LINEUP_SPOTS[i] || [i * 25, i * 25 + 25];
    spot.style.left = `${x0}%`; spot.style.width = `${x1 - x0}%`;
    spot.dataset.s = s;
    spot.setAttribute('aria-label', known ? `${i + 1}: ${CAST[k]}` : `${i + 1}: someone you haven't met`);
    if (!known) spot.append(el('span', 'q', '???'));
    else {
      const tip = el('span', 'tip');
      tip.append(el('b', null, CAST[k]), el('span', null, `${BIO[k].age} · ${BIO[k].role}`), el('em', null, BIO[k].rumor));
      spot.append(tip);
      if (s) spot.append(el('em', 'mark', BOARD_LABEL[s]));
    }
    spot.onclick = () => pick(k, known);
    photo.append(spot);
  });
  lineup.hidden = true;
  box.append(photo, el('p', 'fine lineup-hint', 'Hover or tap a suspect to learn more.'));
  box.append(lineup);
  const k = state.lineupPick;
  const grid = el('div', 'bio');
  if (!k) grid.append(el('p', 'fine', 'Meet the suspects to fill in the lineup.'));
  else {
    const bio = BIO[k];
    grid.append(el('b', 'bio-name', CAST[k]), el('span', 'bio-role', `${bio.age} · ${bio.role}`));
    const ul = el('ul'); bio.background.forEach((l) => ul.append(el('li', null, l))); grid.append(ul);
    grid.append(el('div', 'bio-sub', 'THEIR STORY: THURSDAY NIGHT'), el('p', 'bio-said', `“${bio.thursday}”`));
    grid.append(el('div', 'bio-sub', 'AROUND TOWN'), el('p', 'bio-rumor', bio.rumor));
    // What this player has uncovered about them (their own evidence cards).
    const found = state.messages.filter((m) => m.thread === k && m.kind === 'evidence' && /^SECRET UNCOVERED/.test(m.text)).map((m) => m.text.split('\n').slice(1).join(' '));
    if (found.length) { grid.append(el('div', 'bio-sub', 'WHAT YOU’VE UNCOVERED')); const f = el('ul', 'found'); found.forEach((t) => f.append(el('li', null, t))); grid.append(f); }
    const marks = el('div', 'bio-marks');
    BOARD_LABEL.forEach((label, s) => {
      const mb = el('button', (board[CAST[k]] || 0) === s ? 'on' : '', s === 0 ? 'UNDECIDED' : label);
      mb.dataset.s = s;
      mb.onclick = () => { board[CAST[k]] = s; store.set(boardKey, JSON.stringify(board)); sfx.click(); render(); };
      marks.append(mb);
    });
    grid.append(marks);
  }
  box.append(grid, el('div', 'section-label', 'YOUR NOTES'));
  const ta = el('textarea'); ta.placeholder = 'Who lied? What doesn’t add up?'; ta.maxLength = 4000;
  ta.value = state.drafts.notes ?? store.get(notesKey, '');
  ta.oninput = () => { state.drafts.notes = ta.value; store.set(notesKey, ta.value); };
  box.append(ta, el('p', 'fine', 'Notes stay private from the group.'));
  screen.append(box);
}

function renderVote(screen) {
  screen.append(el('div', 'app-title', 'VOTE'));
  const box = el('div', 'vote');
  if (state.revealed) {
    box.append(el('p', 'note', 'Voting is closed.'));
    return screen.append(box);
  }
  const group = (label, options, field) => {
    box.append(el('h2', null, label));
    const grid = el('div', 'choices');
    options.forEach((name) => {
      if (field === 'killer' && !met(name)) { // suspects you haven't met yet stay a mystery here too
        const b = el('button', 'choice locked', '???'); b.disabled = true; grid.append(b); return;
      }
      const b = el('button', `choice${state.pick[field] === name ? ' on' : ''}`, name);
      b.onclick = () => { state.pick[field] = name; sfx.click(); render(); };
      grid.append(b);
    });
    box.append(grid);
  };
  group('WHO KILLED DANA?', state.suspects, 'killer');
  if (state.suspects.some((n) => !met(n))) box.append(el('p', 'fine', 'Meet more suspects to add them here.'));
  group('WHO IS THE ACCOMPLICE?', state.players.filter((n) => n !== state.me.name), 'accomplice');

  const note = el('p', 'note');
  if (state.vote) {
    note.textContent = `Your vote: ${state.vote.killer}${state.vote.accomplice ? `, accomplice ${state.vote.accomplice}` : ''}. You can change it until voting closes.`;
    note.className = 'note ok';
  } else {
    note.textContent = 'Votes close at the final call. You can change your vote until then.';
  }
  const submit = el('button', 'wide', state.vote ? 'UPDATE VOTE' : 'LOCK IN VOTE');
  submit.onclick = async () => {
    if (!state.pick.killer) { note.textContent = 'Pick who killed Dana first.'; note.className = 'note bad'; return; }
    submit.disabled = true;
    try {
      await api('/vote', { method: 'POST', body: JSON.stringify(state.pick) });
      state.vote = { ...state.pick }; sfx.creak(); render();
    } catch (ex) {
      note.textContent = ex.message; note.className = 'note bad'; submit.disabled = false;
    }
  };
  box.append(submit, note);
  screen.append(box);
}

// ---- recap ----
async function loadRecap() {
  try { state.recap = await api('/recap'); } catch (ex) { state.recap = { error: ex.message }; }
  if (state.view === 'recap') render();
}
function renderRecap(screen) {
  screen.append(el('div', 'app-title', 'THE END'));
  const r = state.recap;
  if (!r) { screen.append(el('div', 'empty', 'Reading the file…')); if (state.revealed) loadRecap(); return; }
  if (r.error) { screen.append(el('div', 'empty', r.error)); return; }
  const box = el('div', 'recap');
  const score = el('div', 'score');
  const win = r.role === 'accomplice' ? r.outcome !== 'detectives' : r.outcome !== 'accomplice';
  const outText = {
    detectives: 'Detectives win. Ruth and her accomplice were both named.',
    split: `You caught Ruth, but the accomplice (${r.accomplice}) walked.`,
    accomplice: 'The group named the wrong killer. The accomplice wins.',
  }[r.outcome];
  score.append(el('div', 'num', String(r.score)), el('div', 'rank', r.rank), el('div', `out ${win ? 'win' : 'lose'}`, outText));
  box.append(score);
  // What was under the cellar floor all along.
  const truth = el('div', 'truth');
  truth.append(artImg('truth-cellar', 'The cellar of Blackwood Manor'), el('div', 'section-label', 'WHAT REALLY HAPPENED'),
    el('p', 'note', 'Halloween 1996: Ruth Calloway, the night nurse who sang Mrs. Blackwood to sleep, killed Elias and buried him under the cellar floor. For thirty years everyone said he ran off. Then Dana booked a crew to dig up that floor. On Thursday, bingo let out at 8:30, and Ruth went to the manor. Dana never reached the bottom of the cellar stairs alive.'));
  box.append(truth);

  if (r.role === 'accomplice') {
    box.append(el('div', 'section-label', 'YOUR SECRET'), el('p', 'note', 'You were the accomplice. Your score measures how well you steered the group.'));
  } else {
    box.append(el('div', 'section-label', 'YOUR VOTE'), el('p', 'note', r.myVote ? `Killer: ${r.myVote.killer}${r.myVote.accomplice ? ` · Accomplice: ${r.myVote.accomplice}` : ''}` : 'You did not vote.'));
  }
  box.append(el('div', 'section-label', `SECRETS UNCOVERED  ${r.found.length}/${r.totalClues}`));
  const ul = el('ul', 'checks');
  r.found.forEach((t) => ul.append(el('li', 'got', t)));
  r.missed.forEach((t) => ul.append(el('li', null, t)));
  box.append(ul);
  if (r.heardOnCalls) box.append(el('p', 'note', `☎ ${r.heardOnCalls} of them you heard on a call, for bonus points.`));
  if (r.group?.length > 1) {
    box.append(el('div', 'section-label', 'THE GROUP'));
    box.append(el('p', 'note', `The group named ${r.groupVote.killer || 'no one'} as the killer${r.groupVote.accomplice ? ` and ${r.groupVote.accomplice} as the accomplice` : ''}.`));
    const gl = el('ul', 'group-recap');
    r.group.forEach((g) => {
      const li = el('li', g.you ? 'you' : null);
      li.append(el('b', null, `${g.name}${g.you ? ' (you)' : ''}${g.accomplice ? ' 🗝' : ''}`),
        el('span', null, `${g.found} secret${g.found === 1 ? '' : 's'}${g.onCall ? ` · ${g.onCall} ☎` : ''} · ${g.vote ? `named ${g.vote.split(' ')[0]}` : 'no vote'}`));
      gl.append(li);
    });
    box.append(gl);
  }
  if (r.group?.some((g) => g.agenda)) {
    box.append(el('div', 'section-label', 'HIDDEN AGENDAS'));
    const best = Math.max(...r.group.map((g) => g.agenda?.done || 0));
    r.group.filter((g) => g.agenda).forEach((g) => {
      const card = el('div', `agenda-recap${g.you ? ' you' : ''}`);
      const head = el('div', 'head');
      head.append(el('b', null, `${g.name}${g.you ? ' (you)' : ''}`), el('span', null, `${g.agenda.done}/3${best > 0 && g.agenda.done === best ? ' · PUPPET MASTER' : ''}`));
      card.append(head, el('div', 'secret-line', `${g.agenda.leaked ? '🗣 leaked · ' : ''}${g.agenda.secret}`));
      const ul = el('ul', 'agenda small');
      g.agenda.goals.forEach((x) => { const li = el('li', x.done ? 'st-done' : 'st-failed'); li.append(el('span', 'box', x.done ? '✓' : '✗'), el('span', null, x.text)); ul.append(li); });
      card.append(ul);
      box.append(card);
    });
  }
  const share = el('button', 'wide', 'SAVE SHARE CARD');
  share.onclick = () => shareCard(r);
  box.append(share, el('p', 'fine', 'The card shows your rank and score, with no spoilers.'));
  screen.append(box);
}

async function shareCard(r) {
  try { await document.fonts?.ready; } catch { /* ignore */ }
  const c = document.createElement('canvas'); c.width = 1080; c.height = 1350;
  const g = c.getContext('2d');
  g.fillStyle = '#050706'; g.fillRect(0, 0, 1080, 1350);
  for (let y = 0; y < 1350; y += 4) { g.fillStyle = 'rgba(255,255,255,0.025)'; g.fillRect(0, y, 1080, 1); }
  const grad = g.createRadialGradient(540, 675, 300, 540, 675, 900); grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(1, 'rgba(0,0,0,0.7)');
  g.fillStyle = grad; g.fillRect(0, 0, 1080, 1350);
  g.strokeStyle = '#1a231e'; g.lineWidth = 4; g.strokeRect(50, 50, 980, 1250);
  g.textAlign = 'center';
  g.fillStyle = '#6b7a66'; g.font = '44px VT323, monospace'; g.fillText('P A R T Y   L I N E', 540, 150);
  g.fillStyle = '#9fe0a0'; g.shadowColor = 'rgba(159,224,160,0.6)'; g.shadowBlur = 30;
  g.font = '92px "Special Elite", serif'; g.fillText('THE BLACKWOOD', 540, 330); g.fillText('LINE', 540, 440);
  g.font = '380px VT323, monospace'; g.fillText(String(r.score), 540, 800);
  g.shadowBlur = 0;
  g.fillStyle = '#c9d6c3'; g.font = '70px "Special Elite", serif'; g.fillText(r.rank, 540, 920);
  g.fillStyle = '#6b7a66'; g.font = '48px VT323, monospace';
  g.fillText(`${r.name.toUpperCase()}  ·  ${r.found.length}/${r.totalClues} SECRETS UNCOVERED`, 540, 1010);
  if (r.heardOnCalls) { g.fillStyle = '#9fe0a0'; g.fillText(`☎ ${r.heardOnCalls} HEARD ON A CALL`, 540, 1075); }
  g.fillStyle = '#d0412e'; g.font = '52px VT323, monospace';
  g.fillText('THE HOUSE CALLED. I ANSWERED.', 540, 1180);
  g.fillStyle = '#6b7a66'; g.font = '36px VT323, monospace'; g.fillText('All characters are AI. Happy Halloween.', 540, 1240);
  const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
  const file = new File([blob], 'blackwood-line.png', { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'The Blackwood Line' }); return; } catch { /* cancelled; fall through */ }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'blackwood-line.png'; a.click();
}

// ============ the votes, counted out before the final call ============
function showVotes({ rows, total }) {
  document.querySelector('.votes-overlay')?.remove();
  const box = el('div', 'votes-overlay'); box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'The votes');
  const inner = el('div', 'votes-inner');
  inner.append(el('div', 'votes-title', 'THE VOTES ARE IN'));
  const list = el('div', 'votes-rows');
  inner.append(list);
  const foot = el('div', 'votes-foot', total ? '' : 'Nobody voted.');
  inner.append(foot);
  box.append(inner);
  box.onclick = () => box.remove();
  document.body.append(box);
  music.sync();
  // Names appear, then each vote lands one at a time.
  let at = 600;
  rows.forEach((r) => {
    const row = el('div', 'votes-row'); const dots = el('span', 'dots');
    row.append(el('b', null, r.name), dots); row.style.opacity = '0';
    list.append(row);
    setTimeout(() => { row.style.opacity = '1'; }, at);
    at += 500;
    for (let i = 0; i < r.count; i++) { setTimeout(() => { dots.append(el('i')); sfx.tick(); }, at); at += 700; }
  });
  setTimeout(() => { foot.textContent = 'The line is ringing…'; }, at + 600);
  setTimeout(() => box.remove(), at + 15_000);
}

// ============ while you were away ============
const awayKey = `bw-away-${token}`;
const markHere = () => store.set(awayKey, new Date().toISOString());
function catchUp() {
  const since = store.get(awayKey, '');
  markHere();
  if (!since || Date.now() - Date.parse(since) < 2 * 60_000 || state.lobby?.status === 'lobby') return;
  const fresh = state.messages.filter((m) => m.at > since && m.from !== 'player');
  if (!fresh.length) return;
  const lines = [];
  const by = {};
  fresh.filter((m) => CAST[m.thread] && m.kind !== 'contact').forEach((m) => { by[m.thread] = (by[m.thread] || 0) + 1; });
  Object.entries(by).forEach(([k, n]) => lines.push([`💬 ${n} message${n > 1 ? 's' : ''} from ${CAST[k].split(' ')[0]}`, 'messages', k]));
  fresh.filter((m) => m.kind === 'contact').forEach((m) => lines.push([`👤 ${m.text.replace(/^NEW CONTACT: /, '').split(',')[0]} is in your phone`, 'messages', 'line']));
  const ev = fresh.filter((m) => EVIDENCE_KINDS.has(m.kind)).length;
  if (ev) lines.push([`🗂 ${ev} new piece${ev > 1 ? 's' : ''} of evidence`, 'evidence', null]);
  fresh.filter((m) => m.kind === 'missed' || m.kind === 'voicemail').forEach((m) => lines.push([`☎ ${m.kind === 'voicemail' ? 'Voicemail' : 'Missed call'}${CAST[m.npc] ? ` from ${CAST[m.npc].split(' ')[0]}` : ''}`, 'calls', null]));
  const agenda = fresh.filter((m) => m.kind === 'agenda').length;
  if (agenda) lines.push(['📓 Your Notebook changed', 'notes', null]);
  if (!lines.length) return;
  const box = el('div', 'catchup'); box.setAttribute('role', 'dialog');
  const card = el('div', 'catchup-card');
  card.append(el('div', 'catchup-title', 'WHILE YOU WERE AWAY'));
  lines.slice(0, 6).forEach(([text, view, open]) => {
    const b = el('button', 'catchup-row', text);
    b.onclick = () => { box.remove(); go(view, open); };
    card.append(b);
  });
  const ok = el('button', 'wide', 'GOT IT'); ok.onclick = () => box.remove();
  card.append(ok);
  box.append(card);
  document.body.append(box);
}
setInterval(() => { if (document.visibilityState === 'visible') markHere(); }, 30_000);

// ============ incoming call overlay ============
let ringTimeout = null;
let ringFor = null; // character key when the call can be answered in the app
// The caller's face fills the ring screen: their portrait moving, or for the house, a lit window through static.
function setFace(box, key, { video = false } = {}) {
  const k = faceKey(key);
  box.querySelectorAll('video, img, i').forEach((n) => n.remove());
  box.classList.toggle('on', Boolean(k));
  box.classList.toggle('ghost', k === 'caretaker');
  if (!k) return;
  if (k === 'caretaker') { box.prepend(el('i')); return; }
  if (video && !reduceMotion) {
    const v = el('video'); v.muted = true; v.loop = true; v.autoplay = true; v.playsInline = true; v.setAttribute('playsinline', '');
    v.poster = `/assets/cast/${k}.jpg`; v.src = `/assets/cast/${k}.mp4`;
    box.prepend(v); v.play().catch(() => {});
  } else {
    const img = el('img'); img.src = `/assets/cast/${k}.jpg`; img.alt = ''; box.prepend(img);
  }
}
function showRing(sub, note, { id = 'UNKNOWN', answer = null } = {}) {
  if (call) return; // already on a call
  closeCallScreen(); // a lingering "call ended" screen would sit on top of the ring
  setFace($('#ringFace'), answer, { video: true });
  ringFor = answer;
  $('#ringId').textContent = id; $('#ringSub').textContent = sub; $('#ringNote').textContent = note;
  $('#ringAnswer').hidden = !answer;
  $('#ringDismiss').textContent = answer ? 'DECLINE' : 'DISMISS';
  $('#ring').hidden = false; sfx.ring(); music.sync();
  clearTimeout(ringTimeout); ringTimeout = setTimeout(hideRing, 40_000);
}
function hideRing() { $('#ring').hidden = true; sfx.stopRing(); clearTimeout(ringTimeout); ringFor = null; setFace($('#ringFace'), null); setTimeout(() => music.sync(), 0); }
let declined = null; // the ring the player turned down, so catching up doesn't bring it back
$('#ringDismiss').onclick = () => { declined = ringFor; hideRing(); };
$('#ringAnswer').onclick = () => { const c = ringFor; hideRing(); if (c) startCall(c); };
function incoming({ character, from }) {
  document.querySelector('.votes-overlay')?.remove();
  declined = null;
  const ghost = character.startsWith('caretaker');
  const t = state.threads.find((x) => x.key === character);
  showRing(ghost ? 'BLACKWOOD MANOR' : (t?.tagline || 'MOBILE').toUpperCase(),
    ghost ? 'The house is calling you.' : 'Answer it. Talk out loud.', { id: ghost ? 'UNKNOWN' : (t?.name || from), answer: character });
}

// ============ in-app voice calls (WebRTC straight to the character's voice) ============
// The call logic (usage, heard-only transcripts, guarded topics, wrap-up, hang-up) is the same module the server uses.
let call = null;
const callName = (character) => (character.startsWith('caretaker') ? 'UNKNOWN' : state.threads.find((t) => t.key === character)?.name || 'UNKNOWN');
// ============ call captions (optional, ⋮ menu) ============
// The character's words appear in step with their voice: a line is revealed while its audio plays, never ahead of it.
const captionsOn = () => store.get('bw-captions', '0') === '1';
const captions = (() => {
  const itemOf = new Map(); // response id -> item id
  const textOf = new Map(); // item id -> transcript
  const startedAt = new Map(); // response id -> when its audio started playing
  let words = [];
  let shown = 0;
  let timer = null;
  const box = () => $('#callCaptions');
  const show = () => { box().textContent = words.slice(Math.max(0, shown - 16), shown).join(' '); };
  function stop() { clearTimeout(timer); timer = null; }
  function play(text, durMs, alreadyMs = 0) {
    stop();
    words = String(text || '').split(/\s+/).filter(Boolean);
    if (!words.length) return;
    const per = Math.max(180, Math.min(700, (durMs || words.length * 370) / words.length));
    shown = Math.min(words.length, Math.floor(alreadyMs / per));
    const step = () => { shown += 1; show(); if (shown < words.length) timer = setTimeout(step, per); };
    step();
  }
  function maybeStart(rid) {
    const item = itemOf.get(rid);
    if (!startedAt.has(rid) || !item || !textOf.has(item)) return;
    play(textOf.get(item), null, Date.now() - startedAt.get(rid));
  }
  return {
    reset() { stop(); itemOf.clear(); textOf.clear(); startedAt.clear(); words = []; box().textContent = ''; box().hidden = !captionsOn(); },
    event(evt) {
      if (!captionsOn()) return;
      switch (evt.type) {
        case 'response.output_item.added':
          if (evt.item?.type === 'message') itemOf.set(evt.response_id, evt.item.id);
          break;
        case 'response.output_audio_transcript.done':
        case 'response.audio_transcript.done':
          textOf.set(evt.item_id, evt.transcript || '');
          if (evt.response_id) { itemOf.set(evt.response_id, evt.item_id); maybeStart(evt.response_id); }
          break;
        case 'output_audio_buffer.started':
          startedAt.set(evt.response_id, Date.now());
          maybeStart(evt.response_id);
          break;
        case 'output_audio_buffer.cleared': // interrupted: the rest was never said
          stop();
          break;
        default:
          break;
      }
    },
    line(text, durMs) { if (captionsOn()) { box().hidden = false; play(text, durMs); } }, // recorded calls
    stop,
  };
})();

let callAfterTimer = null;
function callScreen(character) {
  clearTimeout(callAfterTimer);
  captions.reset();
  $('#callName').textContent = callName(character);
  setFace($('#callFace'), character);
  $('#callScreen').classList.toggle('has-face', Boolean(CAST[character]));
  $('#callScreen').style.setProperty('--lvl', '0');
  $('#callState').textContent = 'CALLING…';
  $('#callTime').textContent = '';
  $('#callMute').classList.remove('on');
  $('#callBtns').hidden = false;
  $('#callAfter').hidden = true;
  $('#callScreen').classList.remove('ended');
  $('#callScreen').hidden = false;
}
// Say why a call ended instead of the screen just vanishing (characters hang up on their own now).
const CALL_ENDINGS = {
  character_hung_up: 'THEY HUNG UP', idle: 'THE LINE WENT QUIET', max_duration: 'THE LINE WENT DEAD',
  recording_ended: 'THE LINE WENT DEAD', connection_lost: 'CALL DROPPED', player_hung_up: 'CALL ENDED',
};
function closeCallScreen() {
  clearTimeout(callAfterTimer);
  $('#callScreen').hidden = true;
  $('#callScreen').classList.remove('ended');
}
function showCallEnded(c, reason) {
  const ghost = c.character.startsWith('caretaker');
  const label = ghost && reason === 'character_hung_up' ? 'THE LINE WENT DEAD' : CALL_ENDINGS[reason];
  if (!label || !c.started) { closeCallScreen(); return; }
  const canCallBack = ['connection_lost', 'idle'].includes(reason) && state.threads.some((t) => t.key === c.character);
  $('#callState').textContent = label;
  $('#callScreen').classList.add('ended');
  $('#callBtns').hidden = true;
  $('#callAfter').hidden = false;
  $('#callBack').hidden = !canCallBack;
  $('#callBack').onclick = () => { closeCallScreen(); startCall(c.character); };
  callAfterTimer = setTimeout(closeCallScreen, reason === 'player_hung_up' ? 900 : canCallBack ? 8000 : 2600);
}
$('#callClose').onclick = closeCallScreen;
function startClock(maxSeconds, onTick) {
  call.started = Date.now();
  $('#callState').textContent = 'ON THE LINE';
  call.timer = setInterval(() => {
    if (!call) return;
    const secs = (Date.now() - call.started) / 1000;
    $('#callTime').textContent = `${fmtSec(Math.max(0, maxSeconds - secs))} LEFT`;
    onTick?.();
    if (secs > maxSeconds) endCall('max_duration');
  }, 500);
}
// ============ background music (ElevenLabs tracks, ⋮ menu) ============
// One track per stretch of the night, each stranger than the last (src/music.js). The phone crossfades to the next one
// as the story moves, and warps it more as it goes: slower and lower, a wobbling tape, the line cutting out. It goes
// quiet for calls, rings, the intro and recordings, and when the phone is put away.
const musicOn = () => store.get('bw-music', '1') === '1' && store.get('bw-sound', '1') !== '0';
const MUSIC_ORDER = ['early', 'late', 'deep', 'final', 'after'];
const TRACK_OF = { before: 'early', early: 'early', late: 'late', deep: 'deep', final: 'final', after: 'after' };
const WEIRD = { // playback rate, tape wobble depth, chance of the sound cutting out (per check)
  early: { rate: 1, wobble: 0, drop: 0 }, late: { rate: 0.97, wobble: 0.004, drop: 0 },
  deep: { rate: 0.93, wobble: 0.012, drop: 0.25 }, final: { rate: 0.9, wobble: 0.02, drop: 0.4 }, after: { rate: 0.86, wobble: 0, drop: 0 },
};
const MUSIC_VOL = 0.22;
const music = (() => {
  const buffers = new Map();
  let cur = null; let busy = false; let dropTimer = null;
  const load = (url, ctx) => {
    if (!buffers.has(url)) buffers.set(url, fetch(url).then((r) => r.arrayBuffer()).then((b) => ctx.decodeAudioData(b)).catch((e) => { buffers.delete(url); throw e; }));
    return buffers.get(url);
  };
  function wanted() {
    const tracks = state.music || {};
    let i = MUSIC_ORDER.indexOf(TRACK_OF[state.phase] || 'early');
    while (i >= 0 && !tracks[MUSIC_ORDER[i]]) i -= 1; // not composed yet: keep the latest one that is
    return i >= 0 ? { name: MUSIC_ORDER[i], url: tracks[MUSIC_ORDER[i]] } : null;
  }
  const shouldPlay = () => musicOn() && !call && $('#ring').hidden && !document.querySelector('.votes-overlay') && $('#power').hidden && $('#intro').hidden && !document.hidden && audioEl.paused;
  function fadeOut(t, secs = 1.2) {
    if (!t) return;
    const ctx = t.gain.context;
    t.gain.gain.cancelScheduledValues(ctx.currentTime);
    t.gain.gain.setTargetAtTime(0, ctx.currentTime, secs / 4);
    setTimeout(() => { try { t.src.stop(); t.lfo?.stop(); } catch { /* stopped */ } t.gain.disconnect(); }, secs * 1000 + 200);
  }
  function dropouts(t, chance) {
    clearInterval(dropTimer);
    if (!chance) return;
    dropTimer = setInterval(() => { // the line cuts out for a moment
      if (cur !== t || Math.random() > chance) return;
      const g = t.gain.gain; const now = t.gain.context.currentTime;
      g.cancelScheduledValues(now); g.setValueAtTime(MUSIC_VOL * 0.08, now); g.setValueAtTime(MUSIC_VOL, now + 0.15 + Math.random() * 0.5);
    }, 7000);
  }
  async function sync() {
    document.body.dataset.music = cur && shouldPlay() ? cur.name : '';
    if (busy) return;
    if (!shouldPlay()) { if (cur) { fadeOut(cur); cur = null; clearInterval(dropTimer); } return; }
    const want = wanted();
    if (!want) return;
    if (cur?.url === want.url) return;
    const ctx = sfx.unlock(); if (!ctx || ctx.state !== 'running') return; // waits for a first tap
    busy = true;
    try {
      const buf = await load(want.url, ctx);
      if (!shouldPlay()) return;
      const w = WEIRD[want.name] || WEIRD.early;
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true; src.playbackRate.value = w.rate;
      const gain = ctx.createGain(); gain.gain.value = 0;
      src.connect(gain).connect(ctx.destination);
      let lfo = null;
      if (w.wobble) { // warped tape: the pitch drifts slowly up and down
        lfo = ctx.createOscillator(); lfo.frequency.value = 0.23;
        const depth = ctx.createGain(); depth.gain.value = w.wobble;
        lfo.connect(depth).connect(src.playbackRate); lfo.start();
      }
      src.start(0, Math.random() * Math.max(0, buf.duration - 5));
      gain.gain.setTargetAtTime(MUSIC_VOL, ctx.currentTime, 1);
      fadeOut(cur, 3);
      cur = { name: want.name, url: want.url, src, gain, lfo };
      dropouts(cur, w.drop);
    } catch { /* no music this time; try again later */ } finally { busy = false; }
    document.body.dataset.music = cur && shouldPlay() ? cur.name : '';
  }
  return { sync };
})();
setInterval(() => music.sync(), 4000);
document.addEventListener('visibilitychange', () => music.sync());
['play', 'pause', 'ended'].forEach((ev) => audioEl.addEventListener(ev, () => music.sync()));
addEventListener('pointerdown', () => setTimeout(() => music.sync(), 50));

// ============ phone-line sound (on by default, ⋮ menu) ============
// The character's voice goes through a telephone band (about 300-3,400 Hz) with a faint line hiss, like a real call
// on an old landline, instead of studio-clean audio. If the browser can't do it, the voice plays unprocessed.
const phoneLineOn = () => store.get('bw-phoneline', '1') === '1';
function phoneChain(ctx) {
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 320;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3300;
  const presence = ctx.createBiquadFilter(); presence.type = 'peaking'; presence.frequency.value = 1700; presence.Q.value = 0.9; presence.gain.value = 4;
  const out = ctx.createGain(); out.gain.value = 1.6; // the band filter takes some loudness away
  hp.connect(lp).connect(presence).connect(out).connect(ctx.destination);
  const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const noise = ctx.createBufferSource(); noise.buffer = noiseBuf; noise.loop = true;
  const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 1400; nf.Q.value = 0.6;
  const ng = ctx.createGain(); ng.gain.value = 0.006;
  noise.connect(nf).connect(ng).connect(ctx.destination);
  noise.start();
  const nodes = [hp, lp, presence, out, noise, nf, ng];
  return { input: hp, stop: () => { try { noise.stop(); } catch { /* stopped */ } nodes.forEach((n) => { try { n.disconnect(); } catch { /* gone */ } }); } };
}
// What you hear behind a character on a call (their room, their car, their stream), quietly under their voice and through
// the same telephone band. Ruth's room has someone humming. Returns a teardown, or null.
async function callBed(character) {
  const url = state.callBeds?.[character];
  const ctx = url && sfx.unlock();
  if (!ctx) return null;
  try {
    const buf = await fetch(url).then((r) => r.arrayBuffer()).then((b) => ctx.decodeAudioData(b));
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 300;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3400;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(hp).connect(lp).connect(g).connect(ctx.destination);
    src.start(0, Math.random() * Math.max(0, buf.duration - 1));
    g.gain.setTargetAtTime(0.09, ctx.currentTime, 0.8);
    return () => { g.gain.setTargetAtTime(0, ctx.currentTime, 0.2); setTimeout(() => { try { src.stop(); } catch { /* done */ } g.disconnect(); }, 800); };
  } catch { return null; }
}

// Live call: route the remote stream through the line. Returns a teardown, or null to play it as is.
function phoneLineStream(stream) {
  if (!phoneLineOn()) return null;
  try {
    const ctx = sfx.unlock(); if (!ctx) return null;
    const chain = phoneChain(ctx);
    const src = ctx.createMediaStreamSource(stream);
    src.connect(chain.input);
    return () => { try { src.disconnect(); } catch { /* gone */ } chain.stop(); };
  } catch { return null; }
}

// A scripted call (the Caretaker, the midnight reveal): finished recordings play through the call screen, one after
// another with a short pause, captions in step.
async function playRecordingCall(character, info) {
  const c = call;
  c.mode = 'recording';
  const parts = [].concat(info.audio);
  const lines = [].concat(info.captions || []);
  const finish = () => setTimeout(() => { if (call === c) endCall('recording_ended'); }, 800);
  startClock(info.maxSeconds);
  const ctx = phoneLineOn() ? sfx.unlock() : null;
  if (ctx) {
    try {
      const buffers = await Promise.all(parts.map((u) => fetch(u).then((r) => r.arrayBuffer()).then((b) => ctx.decodeAudioData(b))));
      if (call !== c) return;
      const chain = phoneChain(ctx);
      meter(chain.input); // the Caretaker's window (or face) pulses with his voice
      let src = null;
      c.stopLine = () => { try { src?.stop(); } catch { /* done */ } chain.stop(); };
      for (const [i, buf] of buffers.entries()) {
        if (call !== c) return;
        src = ctx.createBufferSource(); src.buffer = buf; src.connect(chain.input);
        if (lines[i]) captions.line(lines[i], buf.duration * 1000);
        await new Promise((done) => { src.onended = done; src.start(); });
        await new Promise((done) => setTimeout(done, 650));
      }
      finish();
      return;
    } catch { if (call !== c) return; c.stopLine?.(); c.stopLine = null; }
  }
  // Plain playback (no phone-line sound, or the browser couldn't decode it).
  const audio = $('#callAudio');
  audio.srcObject = null;
  let i = 0;
  const next = () => {
    if (call !== c) return;
    if (i >= parts.length) { finish(); return; }
    const at = i++;
    audio.src = parts[at];
    audio.onloadedmetadata = () => { if (lines[at]) captions.line(lines[at], audio.duration * 1000); };
    audio.onended = () => setTimeout(next, 650);
    audio.play().catch(() => {});
  };
  next();
}
async function startCall(character) {
  if (call) return;
  hideRing(); // however the call starts (ANSWER, CALL, call back), nothing keeps ringing underneath it
  sfx.unlock();
  call = { character, started: 0, timer: null };
  music.sync(); // quiet for the call
  callScreen(character);
  const audio = $('#callAudio');
  audio.play().catch(() => {}); // unlock playback inside the tap
  const getMic = async () => {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser can’t use the microphone. Open the link in Safari or Chrome.');
    return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  };
  try {
    // Microphone first (the short-lived call key is only minted once we can use it). The Caretaker's recorded calls need
    // none (if his call turns out to be live, the microphone is requested below).
    let mic = character.startsWith('caretaker') ? null : await getMic();
    call.mic = mic;
    if (!call) { mic?.getTracks().forEach((t) => t.stop()); return; }
    const info = await api('/call', { method: 'POST', body: JSON.stringify({ character }) });
    if (!call) { mic?.getTracks().forEach((t) => t.stop()); return; }
    call.callId = info.callId;
    if (info.mode === 'recording') { mic?.getTracks().forEach((t) => t.stop()); call.mic = null; playRecordingCall(character, info); return; }
    if (!mic) { mic = await getMic(); call.mic = mic; }
    const pc = new RTCPeerConnection();
    call.pc = pc;
    pc.ontrack = (e) => {
      audio.srcObject = e.streams[0];
      // The element keeps the stream flowing (some browsers need it); with the phone-line sound on, it's muted and the
      // voice is heard through the filter instead.
      const stop = call ? phoneLineStream(e.streams[0]) : null;
      if (stop) { audio.muted = true; call.stopLine = stop; }
      audio.play().catch(() => {});
      meter(e.streams[0]);
    };
    mic.getTracks().forEach((t) => pc.addTrack(t, mic));
    const dc = pc.createDataChannel('oai-events');
    const callId = info.callId;
    const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify({ callId, character, ...body }) });
    if (!info.serverControlled) {
      const { createCallController } = await import('/assets/shared/call-controller.js');
      call.ctl = createCallController({
        mode: 'webrtc',
        send: (evt) => { if (dc.readyState === 'open') dc.send(JSON.stringify(evt)); },
        opening: info.opening, openingRole: info.openingRole, toolName: info.toolName, timing: info.timing, turns: info.turns,
        hooks: {
          transcript: (speaker, text, meta) => post('/call/transcript', { speaker, text, itemId: meta?.itemId }).catch(() => ({})),
          usage: (rec) => { post('/call/usage', { records: [rec] }).catch(() => {}); },
          disclose: (topic, recent) => post('/call/disclose', { topic, recent }),
          end: (reason) => setTimeout(() => endCall(reason), 0),
          error: (e) => console.warn('call error', e),
        },
      });
      dc.onopen = () => call?.ctl?.start();
    }
    dc.onmessage = (e) => {
      let evt; try { evt = JSON.parse(e.data); } catch { return; }
      captions.event(evt);
      call?.ctl?.handle(evt);
    };
    pc.onconnectionstatechange = () => { if (['failed', 'closed'].includes(pc.connectionState)) endCall('connection_lost'); };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const r = info.transport === 'sideband'
      ? await fetch(`/api/p/${token}/call/${callId}/sdp`, { method: 'POST', body: offer.sdp, headers: { 'Content-Type': 'application/sdp' } })
      : await fetch(info.url, { method: 'POST', body: offer.sdp, headers: { Authorization: `Bearer ${info.key}`, 'Content-Type': 'application/sdp' } });
    if (!r.ok) throw new Error('The call didn’t connect. Try again.');
    await pc.setRemoteDescription({ type: 'answer', sdp: await r.text() });
    if (!call) return;
    startClock(info.maxSeconds, () => call?.ctl?.tick());
    const c0 = call;
    callBed(character).then((stop) => { if (stop && call === c0) c0.stopBed = stop; else stop?.(); });
  } catch (ex) {
    $('#callState').textContent = ex.name === 'NotAllowedError' ? 'MICROPHONE BLOCKED' : /busy/i.test(ex.message) ? 'LINE BUSY'
      : /picking up|can't talk right now/i.test(ex.message) ? 'NO ANSWER' : /line is dead|out of call time/i.test(ex.message) ? (sfx.static(), 'NO SIGNAL') : 'CALL FAILED';
    $('#callTime').textContent = ex.name === 'NotAllowedError' ? 'Allow the microphone to talk to them.'
      : ex instanceof TypeError ? 'The line dropped. Try again.' : ex.message;
    setTimeout(() => endCall('connect_failed'), 3200);
  }
}
function endCall(reason = 'player_hung_up') {
  if (!call) return;
  const c = call; call = null;
  setTimeout(() => music.sync(), 1500); // the music creeps back after the call
  clearInterval(c.timer); cancelAnimationFrame(meterRaf); $('#callScreen').style.setProperty('--lvl', '0');
  captions.stop();
  c.ctl?.end(reason); // saves what was heard so far and reports any outstanding usage
  c.mic?.getTracks().forEach((t) => t.stop());
  try { c.pc?.close(); } catch { /* already closed */ }
  c.stopLine?.(); c.stopBed?.();
  const audio = $('#callAudio');
  audio.pause(); audio.onended = null; audio.onloadedmetadata = null; audio.srcObject = null; audio.removeAttribute('src'); audio.muted = false;
  showCallEnded(c, reason);
  if (c.started || c.callId) {
    api('/call/end', { method: 'POST', body: JSON.stringify({ callId: c.callId, character: c.character, mode: c.mode, reason, seconds: c.started ? (Date.now() - c.started) / 1000 : 0 }) })
      .then(() => refresh()).catch(() => {}); // refresh: the call-time meter
  }
  sfx.creak();
}
$('#callEnd').onclick = () => endCall('player_hung_up');
$('#callMute').onclick = () => {
  if (!call?.mic) return;
  const on = !$('#callMute').classList.toggle('on');
  call.mic.getAudioTracks().forEach((t) => { t.enabled = on; });
};
// The rings pulse with the character's voice.
let meterRaf = 0;
function meter(source) {
  try {
    const ctx = sfx.unlock(); if (!ctx) return;
    const an = ctx.createAnalyser(); an.fftSize = 256;
    (source instanceof MediaStream ? ctx.createMediaStreamSource(source) : source).connect(an);
    const buf = new Uint8Array(an.frequencyBinCount);
    const scr = $('#callScreen');
    cancelAnimationFrame(meterRaf);
    const tickMeter = () => {
      an.getByteFrequencyData(buf);
      const level = buf.reduce((a, b) => a + b, 0) / buf.length / 255;
      scr.style.setProperty('--lvl', Math.min(1, level * 3).toFixed(3));
      meterRaf = requestAnimationFrame(tickMeter);
    };
    tickMeter();
  } catch { /* visual only */ }
}

// ============ photo / portrait viewer ============
function openLightbox({ image, video, poster, caption }) {
  const box = $('#lightbox'); const img = $('#lightboxImg'); const vid = $('#lightboxVid');
  img.hidden = !image; vid.hidden = !video;
  if (image) img.src = image;
  if (video) { vid.poster = poster || ''; vid.src = video; if (!reduceMotion) vid.play().catch(() => {}); }
  $('#lightboxCap').textContent = caption || '';
  box.hidden = false;
}
$('#lightbox').onclick = () => { const v = $('#lightboxVid'); v.pause(); v.removeAttribute('src'); $('#lightbox').hidden = true; };

// ============ toast ============
let toastTimer = null;
function toast(m) {
  const t = $('#toast'); t.replaceChildren(el('b', null, titleOf(m.thread).toUpperCase()), el('span', null, preview(m)));
  t.hidden = false;
  t.onclick = () => { t.hidden = true; markSeen(m.thread); if (READONLY[m.thread] === 'UNKNOWN') go('calls'); else go('messages', m.thread); };
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 4000);
}

// ============ haunting: glitches, whispers, signal drops ============
const WHISPERS = ['…HELLO?', 'WHO’S THERE', 'HE’S LISTENING', '1996', 'DON’T GO DOWN', 'LINE OPEN', 'I SEE YOU', 'PICK UP'];
function haunt() {
  const phone = $('#phone');
  const roll = Math.random();
  if (reduceMotion) { schedule(); return; }
  if (roll < 0.45) { phone.classList.add('glitch'); setTimeout(() => phone.classList.remove('glitch'), 260); }
  else if (roll < 0.7) { phone.classList.add('flicker'); setTimeout(() => phone.classList.remove('flicker'), 380); sfx.creak(); }
  else if (roll < 0.9) {
    const c = $('#carrier'); c.textContent = WHISPERS[Math.floor(Math.random() * WHISPERS.length)]; c.classList.add('whisper');
    setTimeout(() => { c.textContent = 'BLACKWOOD'; c.classList.remove('whisper'); }, 1100);
  } else {
    const b = $('#bars'); b.classList.add('dead'); setTimeout(() => b.classList.remove('dead'), 1500);
  }
  schedule();
}
const schedule = () => setTimeout(haunt, 18_000 + Math.random() * 30_000);

// ============ live updates ============
function connect() {
  const es = new EventSource(`/api/p/${token}/stream`);
  es.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (state.messages.some((x) => x.id === m.id)) return;
    state.messages.push(m);
    state.arrived[m.id] = Date.now();
    if (m.kind === 'reveal') { state.revealed = true; loadRecap(); }
    if (m.kind === 'agenda' || /^YOUR SECRET AGENDA/.test(m.text || '')) refresh();
    if (m.from !== 'player') {
      state.typing[m.thread] = false;
      const viewing = (state.view === 'convo' && state.open === m.thread) || (state.view === 'calls' && m.thread === 'unknown');
      if (viewing) markSeen(m.thread === 'unknown' ? 'calls' : m.thread);
      const isCall = m.thread === 'unknown' && m.kind === 'call';
      const isRinging = m.thread === 'line' && /line is ringing/i.test(m.text);
      if (isCall) showRing('BLACKWOOD MANOR', 'Your real phone is ringing. Pick it up.');
      else if (isRinging) showRing('THE LINE', 'It’s ringing. Everyone’s phone is ringing.');
      else if (!['missed', 'calllog'].includes(m.kind)) { if (/^No signal/.test(m.text || '')) sfx.static(); else if (CAST[m.thread]) sfx.from(m.thread); else sfx.msg(); if (!viewing) toast(m); }
    }
    render();
    setTimeout(() => { if (Object.values(state.arrived).some((t) => Date.now() - t < 1000)) render(); }, 1000);
  });
  es.addEventListener('unlock', (e) => {
    const t = JSON.parse(e.data);
    if (!state.threads.some((x) => x.key === t.key)) state.threads.push(t);
    render();
  });
  es.addEventListener('lobby', (e) => {
    const was = state.lobby?.status;
    state.lobby = JSON.parse(e.data);
    if (was === 'lobby' && state.lobby.status === 'running') { sfx.ring(); setTimeout(() => sfx.stopRing(), 2400); refresh(); }
    render();
  });
  es.addEventListener('group', (e) => {
    const g = JSON.parse(e.data);
    state.groups = [...(state.groups || []).filter((x) => x.id !== g.id), g];
    render();
  });
  es.addEventListener('incoming', (e) => incoming(JSON.parse(e.data)));
  es.addEventListener('ringEnd', (e) => { if (ringFor === JSON.parse(e.data).character) hideRing(); });
  es.addEventListener('read', (e) => {
    const { thread, at } = JSON.parse(e.data);
    state.messages.forEach((m) => { if (m.thread === thread && m.from === 'player' && !m.readAt) m.readAt = at; });
    render();
  });
  es.addEventListener('clock', (e) => { state.clock = JSON.parse(e.data); render(); tickCountdown(); });
  es.addEventListener('votes', (e) => showVotes(JSON.parse(e.data)));
  es.addEventListener('status', (e) => {
    const statuses = JSON.parse(e.data);
    state.threads.forEach((t) => { if (statuses[t.key] != null) t.status = statuses[t.key]; });
    if (statuses.phase) state.phase = statuses.phase;
    render();
  });
  es.addEventListener('typing', (e) => {
    const { thread, on, who } = JSON.parse(e.data);
    state.typing[thread] = on ? (who || true) : false; render();
  });
  // EventSource reconnects on its own after a drop (switching apps, a network blip), but anything sent while it was
  // down is lost: catch up as soon as it's back.
  let opened = false;
  es.addEventListener('open', () => { if (opened) refresh(); opened = true; });
  es.onerror = () => { /* reconnects on its own; 'open' catches up */ };
}

// ============ settings, alerts, install ============
const device = { ua: navigator.userAgent, platform: navigator.platform, touchPoints: navigator.maxTouchPoints || 0 };
const isIOS = deviceOS(device) === 'ios';
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

// ---- home-screen gate: on a phone, the game only runs from the home-screen app (see install.js) ----
// Chrome on Android offers its own install dialog; keep it for our button instead of the browser's mini bar.
let gate = null;
let installPrompt = null;
let installed = false;
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; if (gate) drawInstallGate(); });
addEventListener('appinstalled', () => { installed = true; installPrompt = null; if (gate) drawInstallGate(); });

async function copyMyLink(btn) {
  const link = location.origin + location.pathname;
  try { await navigator.clipboard.writeText(link); btn.textContent = 'LINK COPIED'; }
  catch { btn.replaceWith(el('p', 'install-link', link)); } // in-app browsers often block the clipboard: select it by hand
}

function drawInstallGate() {
  const box = $('#installInner');
  const ios = gate.os === 'ios';
  const say = (cls, ...parts) => { const n = el('p', cls); n.append(...parts); return n; };
  const b = (t) => el('b', null, t);
  const logo = el('div', 'logo'); logo.append('BLACKWOOD', el('br'), 'MOBILE');
  box.replaceChildren(logo, el('div', 'install-kicker', 'ONE MORE STEP'), el('h2', null, 'Put the line on your home screen'),
    say(null, 'The house can only reach you through the Blackwood app. Add it to your home screen, then open it from there to play.'));

  const copy = (cls) => { const c = el('button', cls, 'COPY MY LINK'); c.onclick = () => copyMyLink(c); return c; };
  if (gate.inApp) {
    box.append(say('install-warn', 'This link opened inside another app, which can’t add to your home screen. Copy your link and open it in ',
      b(ios ? 'Safari' : 'Chrome'), '.'), copy('wide'));
  }

  if (installed) {
    box.append(say('install-done', b('ADDED.'), ' Close this tab and open ', b('Blackwood'), ' from your home screen.'));
  } else if (!ios && installPrompt) {
    const add = el('button', 'wide', 'ADD TO HOME SCREEN');
    add.onclick = async () => {
      const offer = installPrompt; installPrompt = null; // each offer can be shown once
      try { await offer.prompt(); if ((await offer.userChoice).outcome === 'accepted') installed = true; } catch { /* show the manual steps */ }
      drawInstallGate();
    };
    box.append(add, say('fine', 'Then open ', b('Blackwood'), ' from your home screen.'));
  } else {
    const steps = el('ol', 'install-steps');
    const step = (...parts) => { const li = el('li'); const span = el('span'); span.append(...parts); li.append(span); steps.append(li); };
    if (ios) {
      step(icon('share'), ' Tap ', b('Share'), '. Don’t see it? Tap ', b('•••'), ' first.');
      step('Scroll down and tap ', b('Add to Home Screen'), '. Leave ', b('Open as Web App'), ' on if you see it, then tap ', b('Add'), '.');
    } else {
      step('Tap ', b('⋮'), ' in the top corner of your browser.');
      step('Tap ', b('Add to Home screen'), ' or ', b('Install app'), ', then ', b('Install'), '.');
    }
    step('Open ', b('Blackwood'), ' from your home screen.');
    box.append(steps);
  }

  if (!installed) box.append(say('fine', 'Already added it? Open Blackwood from your home screen. This link is yours alone: don’t share it.'));
  if (!gate.inApp) box.append(copy('wide ghost'));
}

function setupMenu() {
  const menu = $('#menu');
  $('#skMenu').onclick = () => {
    sfx.click();
    $('#who').textContent = `Signed in as ${state.me.name}`;
    $('#callsToggle').checked = !state.me.callsOff;
    $('#callsToggle').disabled = !state.me.hasPhone;
    $('#soundToggle').checked = store.get('bw-sound', '1') !== '0';
    $('#captionsToggle').checked = captionsOn();
    $('#phoneLineToggle').checked = phoneLineOn();
    $('#musicToggle').checked = store.get('bw-music', '1') === '1';
    menu.showModal();
  };
  $('#closeMenu').onclick = () => menu.close();
  $('#soundToggle').onchange = (e) => store.set('bw-sound', e.target.checked ? '1' : '0');
  $('#captionsToggle').onchange = (e) => store.set('bw-captions', e.target.checked ? '1' : '0');
  $('#phoneLineToggle').onchange = (e) => store.set('bw-phoneline', e.target.checked ? '1' : '0');
  $('#musicToggle').onchange = (e) => { store.set('bw-music', e.target.checked ? '1' : '0'); music.sync(); };
  $('#callsToggle').onchange = async (e) => {
    try {
      const r = await api('/settings', { method: 'POST', body: JSON.stringify({ callsOff: !e.target.checked }) });
      state.me.callsOff = r.callsOff;
    } catch { e.target.checked = !e.target.checked; }
  };
  $('#alertsBtn').onclick = enableAlerts;
}

function urlB64ToUint8Array(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function enableAlerts() {
  const note = $('#alertsNote');
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    note.textContent = isIOS && !standalone
      ? 'On iPhone: tap Share, then "Add to Home Screen". Open the Blackwood app from your home screen and turn on alerts there.'
      : 'This browser can’t show alerts. Keep this page open during the game.';
    return;
  }
  if (!state.vapidPublicKey) { note.textContent = 'Alerts aren’t set up on this server yet.'; return; }
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { note.textContent = 'Alerts are blocked. You can allow them in your settings.'; return; }
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) ||
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(state.vapidPublicKey) }));
    await api('/push', { method: 'POST', body: JSON.stringify({ subscription: sub }) });
    note.textContent = 'Alerts are on. The line can reach you now.';
    $('#installBanner').hidden = true;
  } catch (ex) {
    note.textContent = `Couldn’t turn on alerts: ${ex.message}`;
  }
}

function showInstallBanner() {
  const banner = $('#installBanner');
  if ('Notification' in window && Notification.permission === 'granted') return;
  banner.replaceChildren();
  if (isIOS && !standalone) {
    banner.append('The line needs to reach you. Tap ', el('b', null, 'Share'), ', then ', el('b', null, 'Add to Home Screen'), ', and open Blackwood from there.');
  } else {
    const b = el('b', null, 'Turn on alerts');
    b.style.cursor = 'pointer'; b.onclick = enableAlerts;
    banner.append(b, ' so new messages buzz your phone.');
  }
  banner.hidden = false;
}

// ============ intro video ============
// Must be started from the power-button tap so phones allow sound.
function playIntro() {
  return new Promise((resolve) => {
    const box = $('#intro'), v = $('#introVideo'), playBtn = $('#introPlay');
    let finished = false;
    const finish = () => {
      if (finished) return; finished = true;
      v.pause(); box.classList.add('out');
      setTimeout(() => { box.hidden = true; box.classList.remove('out'); resolve(); }, 600);
    };
    if (v.error) { resolve(); return; } // no intro.mp4 on this server: skip straight to the phone
    box.hidden = false; playBtn.hidden = true;
    v.muted = store.get('bw-sound', '1') === '0';
    try { v.currentTime = 0; } catch { /* not loaded yet */ }
    v.onended = finish;
    v.onerror = finish;
    $('#introSkip').onclick = () => { sfx.click(); finish(); };
    const start = () => v.play().then(() => { playBtn.hidden = true; }).catch(() => { playBtn.hidden = false; });
    playBtn.onclick = () => { v.muted = store.get('bw-sound', '1') === '0'; start(); };
    start();
  });
}

// ============ role card ============
const roleKey = `bw-role-${token}`;
const roleSeen = () => store.get(roleKey) === `${state.me.assigned ? state.me.role : 'pending'}`;
function showRole() {
  return new Promise((resolve) => {
    const box = $('#role'), inner = $('#roleInner');
    inner.replaceChildren();
    const name = state.me.name.toUpperCase();
    if (!state.me.assigned) {
      const d = el('div', 'dossier sealed');
      d.append(el('span', 'tag', 'BLACKWOOD LINE · PERSONNEL FILE'), el('h3', null, 'Your role is sealed.'), el('div', 'agent', `AGENT: ${name}`),
        el('p', null, 'The line will assign it when the game begins. Keep this phone close.'));
      inner.append(d);
    } else if (state.me.role === 'accomplice') {
      const d = el('div', 'secret role-secret');
      const body = el('div', 'body');
      body.append(el('h3', null, 'You are the accomplice.'),
        el('p', null, 'You work for the house. Your orders will arrive on The Line, and only you can see them.'),
        el('p', null, 'Steer your friends away from the truth. If the group names the wrong killer, you win.'),
        el('p', null, 'Tell no one. Act like a detective.'));
      d.append(el('span', 'tag', 'FOR YOUR EYES ONLY'), body, el('div', 'hint', 'Make sure no one can see your screen, then tap to read.'));
      d.onclick = () => { d.classList.add('open'); sfx.creak(); };
      inner.append(d);
    } else {
      const d = el('div', 'dossier');
      d.append(el('span', 'tag', 'PERSONNEL FILE'), el('span', 'stamp-ink', 'DETECTIVE'), el('h3', null, 'Your role'), el('div', 'agent', `AGENT: ${name}`),
        el('p', null, 'Text and call the four suspects. They remember everything your friends ask them.'),
        el('p', null, 'You each hold different clues. Share them. But one of your friends is working for the house.'),
        el('p', null, 'Name the killer and the accomplice in the Vote app before the line goes dead.'));
      inner.append(d);
    }
    const go = el('button', 'wide', 'OPEN THE PHONE');
    go.onclick = () => {
      sfx.click();
      store.set(roleKey, state.me.assigned ? state.me.role : 'pending');
      box.classList.add('out');
      setTimeout(() => { box.hidden = true; box.classList.remove('out'); resolve(); }, 500);
    };
    inner.append(go);
    box.hidden = false;
  });
}

// ============ power on ============
function bootText(name) {
  return new Promise((resolve) => {
    $('#powerIdle').hidden = true;
    const boot = $('#boot'); boot.hidden = false; boot.textContent = '';
    const lines = [
      'BLACKWOOD MOBILE  v1.996', 'MEMORY ........ OK', 'BATTERY ....... 13%', 'SEARCHING FOR NETWORK...',
      '<span class="bad">NO SERVICE</span>', '<span class="bad">NO SERVICE</span>', 'SIGNAL FOUND: THE LINE', '',
      `WELCOME, ${name.toUpperCase()}`, 'SOMEONE IS ALREADY HERE.',
    ];
    let i = 0, skipped = false;
    const power = $('#power');
    const step = () => {
      if (skipped) return;
      if (i >= lines.length) { setTimeout(resolve, 700); return; }
      boot.insertAdjacentHTML('beforeend', `${lines[i++]}\n`);
      setTimeout(step, i === 5 || i === 6 ? 520 : 300);
    };
    sfx.hum(); step();
    setTimeout(() => { power.onclick = () => { skipped = true; power.onclick = null; resolve(); }; }, 0); // tap to skip
  });
}
function hidePower() {
  const power = $('#power');
  power.classList.add('off');
  setTimeout(() => { power.hidden = true; power.classList.remove('off'); }, 700);
}

async function firstRun() {
  sfx.unlock();
  const intro = playIntro(); // started inside the tap, so sound is allowed
  $('#powerIdle').hidden = true;
  await intro;
  await bootText(state.me.name);
  if (!roleSeen()) await showRole();
  hidePower();
  store.set(`bw-on-${token}`, '1');
  if (tutorial.status === 'new' && !state.revealed && !organizerWaiting()) startTutorial();
}

// Pull fresh state when the app comes back to the foreground (phones pause live updates in the background).
async function refresh() {
  try {
    const fresh = await api('/state');
    const known = new Set(state.messages.map((m) => m.id));
    fresh.messages.filter((m) => !known.has(m.id)).forEach((m) => state.messages.push(m));
    Object.assign(state.me, fresh.me);
    state.threads = fresh.threads;
    state.phase = fresh.phase; state.music = fresh.music; state.callBeds = fresh.callBeds;
    state.revealed = fresh.revealed; state.vote = fresh.vote; state.players = fresh.players; state.peers = fresh.peers; state.groups = fresh.groups; state.lobby = fresh.lobby; state.agenda = fresh.agenda; state.clock = fresh.clock;
    if (state.revealed && !state.recap) loadRecap();
    // A call that started ringing while this screen wasn't listening.
    if (fresh.ringing && $('#ring').hidden && !call && declined !== fresh.ringing.character) incoming({ character: fresh.ringing.character, from: '' });
    render();
    if ($('#power').hidden && !roleSeen() && state.me.assigned) showRole();
  } catch { /* offline: try again next time */ }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh().then(catchUp); else markHere(); });
// Safety net: if live updates quietly stall (some networks hold them back), check in every 20 seconds anyway.
setInterval(() => { if (document.visibilityState === 'visible' && token) refresh(); }, 20_000);

// ============ boot ============
async function boot() {
  const link = document.createElement('link');
  link.rel = 'manifest'; link.href = `/manifest/${token}.webmanifest`;
  document.head.append(link);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});

  try {
    Object.assign(state, await api('/state'));
  } catch (ex) {
    $('#power').hidden = true;
    $('#screen').append(el('div', 'empty', ex.message));
    return;
  }
  gate = installGate({ ...device, standalone, required: state.requireInstall });
  if (gate) {
    $('#power').hidden = true; $('#install').hidden = false;
    drawInstallGate();
    return;
  }
  if (state.vote) state.pick = { killer: state.vote.killer, accomplice: state.vote.accomplice };
  const fromHash = location.hash.slice(1);
  if (fromHash === 'unknown') state.view = 'calls';
  else if (fromHash && (READONLY[fromHash] || state.threads.some((t) => t.key === fromHash))) { state.view = 'convo'; state.open = fromHash; }

  setupMenu();
  $('#replayBtn').onclick = async () => { $('#menu').close(); sfx.unlock(); await playIntro(); };
  $('#roleBtn').onclick = async () => { $('#menu').close(); await showRole(); };
  $('#tutorialBtn').onclick = () => { $('#menu').close(); startTutorial(); };
  $('#skBack').onclick = goBack;
  $('#skHome').onclick = () => { if (state.view !== 'home') go('home'); };
  showInstallBanner();
  render();
  connect();
  if (state.revealed) loadRecap();
  schedule();

  const already = store.get(`bw-on-${token}`) === '1';
  if (already || fromHash) {
    $('#power').hidden = true;
    if (state.ringing) incoming({ character: state.ringing.character, from: '' });
    if (!roleSeen() && state.me.assigned) await showRole();
    if (!fromHash && !state.revealed && !state.ringing && !organizerWaiting() && ['new', 'active'].includes(tutorial.status)) startTutorial();
    else if (!state.ringing) catchUp();
  } else {
    $('#pwrBtn').onclick = (e) => { e.stopPropagation(); $('#pwrBtn').disabled = true; firstRun(); };
  }
}

boot();
