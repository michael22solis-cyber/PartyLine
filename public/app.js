// Blackwood Line: a haunted old phone. Vanilla JS, no build step.
import { TUTORIAL_TITLES, readTutorialProgress, tutorialStep } from './tutorial.js';

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
    hum: () => { tone(55, 0, 1.6, 'sawtooth', 0.05, 110); tone(82, 0.2, 1.4, 'sine', 0.05, 164); },
    creak: () => tone(140, 0, 0.5, 'sawtooth', 0.02, 70),
    ring: () => {
      const once = () => { for (let i = 0; i < 2; i++) { tone(440, i * 0.5, 0.4, 'sine', 0.06); tone(480, i * 0.5, 0.4, 'sine', 0.06); } buzz([400, 100, 400]); };
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
}
setInterval(tick, 10_000);

// ============ icons ============
const ICONS = {
  messages: '<path d="M4 5h16v11H9l-5 4z"/>',
  calls: '<path d="M5 4l4-1 2 5-2 1.5a11 11 0 005 5L15.5 13l5 2-1 4a2 2 0 01-2 1.5A15 15 0 013.5 6 2 2 0 015 4z"/>',
  evidence: '<path d="M3 6h7l2 2h9v11H3z"/><path d="M3 11h18"/>',
  notes: '<path d="M5 3h14v18H5z"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  vote: '<path d="M4 4h16v16H4z"/><path d="M8 12l3 3 6-7"/>',
  recap: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
};
const icon = (name) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); s.innerHTML = ICONS[name]; return s;
};
const MANOR = `<svg class="manor" viewBox="0 0 400 180" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
  <defs><linearGradient id="fog" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0c140f" stop-opacity="0"/><stop offset="1" stop-color="#0c140f"/></linearGradient></defs>
  <path d="M0 180V150l40-8 30 10 22-12 30 8v-14l20-20 24-30 14-10 14 10 8-18 10 18 16-6 12 24 30 6 14 20v62z" fill="#0a0f0c" stroke="#1a231e"/>
  <path d="M110 180v-60l30-34 30 34v60zM240 180v-54l40-30 40 30v54z" fill="#060908" stroke="#1a231e"/>
  <rect class="win" x="134" y="128" width="9" height="13"/><rect class="win b" x="154" y="128" width="9" height="13"/>
  <rect class="win b" x="266" y="124" width="9" height="13"/><rect class="win" x="292" y="124" width="9" height="13"/>
  <path d="M0 150h400v30H0z" fill="url(#fog)"/>
</svg>`;

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
  b.append(icon(name), el('span', null, label));
  if (count > 0) b.append(el('i', 'badge', String(count)));
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

function renderHome(screen) {
  const home = el('div', 'home');
  const clock = el('div', 'home-clock');
  clock.append(el('div', 'big', '--:--'), el('div', 'date', ''));
  clock.firstChild.id = 'bigClock'; clock.lastChild.id = 'bigDate';
  const note = homeNote();
  const line = el('div', `home-note${note.hot && !noteOverride ? ' hot' : ''}`, noteOverride || note.text);
  const grid = el('div', 'grid');
  grid.append(
    appButton('messages', 'MESSAGES', 'messages', unreadThreads()),
    appButton('calls', 'CALLS', 'calls', unreadCalls()),
    appButton('evidence', 'EVIDENCE', 'evidence', unreadEvidence()),
    appButton('notes', 'NOTES', 'notes'),
    appButton('vote', 'VOTE', 'vote'),
    appButton('recap', 'THE END', 'recap', 0, !state.revealed),
  );
  if (state.lobby?.status === 'lobby') home.append(clock, lobbyPanel(), grid);
  else home.append(clock, line, grid);
  const guide = el('button', 'home-guide');
  guide.append(el('span', null, 'FIELD GUIDE'), el('small', null,
    tutorial.status === 'complete' ? 'How to play · revisit any time'
      : tutorial.status === 'new' ? 'New here? Start the tutorial'
        : `Resume tutorial · ${tutorial.step + 1} / ${TUTORIAL_TITLES.length}`));
  guide.onclick = () => startTutorial();
  home.append(guide);
  home.insertAdjacentHTML('beforeend', MANOR);
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
    let date = null;
    if (L.length === 'twonights') {
      date = el('input', 'textin'); date.type = 'date';
      const y = new Date().getFullYear(); date.value = `${y}-10-30`;
      box.append(el('p', 'note', 'Night 1 date (8 pm start):'), date);
    }
    const ready = L.joined.length >= L.minPlayers;
    const start = el('button', 'wide', ready ? 'START THE GAME' : `NEED ${L.minPlayers - L.joined.length} MORE`);
    start.disabled = !ready;
    start.onclick = async () => {
      start.disabled = true; sfx.creak();
      try { await api('/start', { method: 'POST', body: JSON.stringify({ date: date?.value }) }); }
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
  if (step.example) {
    const example = el('div', 'tutorial-example');
    example.append(el('small', null, 'TRY ASKING'), el('p', null, `“${step.example}”`));
    box.append(example);
  }
  const points = el('ul', 'tutorial-points');
  step.points.forEach((text) => points.append(el('li', null, text)));
  const tip = el('div', 'tutorial-tip');
  tip.append(el('b', null, 'YOUR NEXT MOVE'), el('p', null, step.tip));
  box.append(points, tip);
  (step.actions || []).forEach((action, i) => {
    const button = el('button', i === 0 ? 'wide' : 'wide ghost', action.label);
    button.onclick = () => go(action.view, action.open);
    box.append(button);
  });
  if (step.actions?.length) box.append(el('p', 'tutorial-return', 'Try it on your phone, then tap RETURN TO GUIDE to continue.'));
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
    const tag = m.kind === 'evidence' && /^SECRET UNCOVERED/.test(m.text) ? 'NEW EVIDENCE' : { clue: 'YOUR CLUE', memo: 'VOICE MEMO', evidence: 'EVIDENCE', reveal: 'CASE CLOSED' }[m.kind];
    node.append(el('span', 'tag', tag));
    if (m.audio) node.append(audioPlayer(m));
    else if (m.kind === 'memo') {
      const wave = el('div', 'wave');
      for (let i = 0; i < 38; i++) { const bar = el('i'); bar.style.height = `${6 + Math.abs(Math.sin(i * 1.7)) * 20 * (i % 7 === 0 ? 0.3 : 1)}px`; wave.append(bar); }
      node.append(wave);
    }
    node.append(document.createTextNode(m.text));
    if (m.kind === 'evidence' && /^SECRET UNCOVERED/.test(m.text)) node.classList.add('found');
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
  } else sub.textContent = subOf(thread);
  info.append(el('div', 'to', READONLY[thread] ? 'FROM' : 'TO'), el('div', 'title', titleOf(thread)), sub);
  head.append(info);
  if (!READONLY[thread] && !isPeerThread(thread)) {
    const call = el('button', 'callbtn', '☎ CALL');
    call.onclick = () => startCall(thread);
    head.append(call);
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
function renderNotes(screen) {
  screen.append(el('div', 'app-title', 'NOTES'));
  const box = el('div', 'notes');
  box.append(el('div', 'section-label', 'SUSPECT BOARD'));
  const grid = el('div', 'board');
  state.suspects.forEach((name) => {
    const s = board[name] || 0;
    const b = el('button'); b.dataset.s = s;
    b.append(el('span', null, name), el('em', null, BOARD_LABEL[s]));
    b.onclick = () => { board[name] = (s + 1) % 3; store.set(boardKey, JSON.stringify(board)); sfx.click(); render(); };
    grid.append(b);
  });
  box.append(grid, el('div', 'section-label', 'YOUR NOTES'));
  const ta = el('textarea'); ta.placeholder = 'Who lied? What doesn’t add up?'; ta.maxLength = 4000;
  ta.value = state.drafts.notes ?? store.get(notesKey, '');
  ta.oninput = () => { state.drafts.notes = ta.value; store.set(notesKey, ta.value); };
  box.append(ta, el('p', 'fine', 'Only you can see this. It stays on this phone.'));
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
      const b = el('button', `choice${state.pick[field] === name ? ' on' : ''}`, name);
      b.onclick = () => { state.pick[field] = name; sfx.click(); render(); };
      grid.append(b);
    });
    box.append(grid);
  };
  group('WHO KILLED DANA?', state.suspects, 'killer');
  group('WHO IS THE ACCOMPLICE?', state.players.filter((n) => n !== state.me.name), 'accomplice');

  const note = el('p', 'note');
  if (state.vote) {
    note.textContent = `Your vote: ${state.vote.killer}${state.vote.accomplice ? `, accomplice ${state.vote.accomplice}` : ''}. You can change it until voting closes.`;
    note.className = 'note ok';
  } else {
    note.textContent = 'Votes close at 11:30 pm on Night 2. You can change your vote until then.';
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
  $('#ring').hidden = false; sfx.ring();
  clearTimeout(ringTimeout); ringTimeout = setTimeout(hideRing, 40_000);
}
function hideRing() { $('#ring').hidden = true; sfx.stopRing(); clearTimeout(ringTimeout); ringFor = null; setFace($('#ringFace'), null); }
$('#ringDismiss').onclick = hideRing;
$('#ringAnswer').onclick = () => { const c = ringFor; hideRing(); if (c) startCall(c); };
function incoming({ character, from }) {
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
    $('#callTime').textContent = fmtSec(secs);
    onTick?.();
    if (secs > maxSeconds) endCall('max_duration');
  }, 500);
}
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
  sfx.unlock();
  call = { character, started: 0, timer: null };
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
  } catch (ex) {
    $('#callState').textContent = ex.name === 'NotAllowedError' ? 'MICROPHONE BLOCKED' : /busy/i.test(ex.message) ? 'LINE BUSY'
      : /picking up/i.test(ex.message) ? 'NO ANSWER' : /line is dead/i.test(ex.message) ? 'NO SIGNAL' : 'CALL FAILED';
    $('#callTime').textContent = ex.name === 'NotAllowedError' ? 'Allow the microphone to talk to them.'
      : ex instanceof TypeError ? 'The line dropped. Try again.' : ex.message;
    setTimeout(() => endCall('connect_failed'), 3200);
  }
}
function endCall(reason = 'player_hung_up') {
  if (!call) return;
  const c = call; call = null;
  clearInterval(c.timer); cancelAnimationFrame(meterRaf); $('#callScreen').style.setProperty('--lvl', '0');
  captions.stop();
  c.ctl?.end(reason); // saves what was heard so far and reports any outstanding usage
  c.mic?.getTracks().forEach((t) => t.stop());
  try { c.pc?.close(); } catch { /* already closed */ }
  c.stopLine?.();
  const audio = $('#callAudio');
  audio.pause(); audio.onended = null; audio.onloadedmetadata = null; audio.srcObject = null; audio.removeAttribute('src'); audio.muted = false;
  showCallEnded(c, reason);
  if (c.started || c.callId) {
    api('/call/end', { method: 'POST', body: JSON.stringify({ callId: c.callId, character: c.character, mode: c.mode, reason, seconds: c.started ? (Date.now() - c.started) / 1000 : 0 }) }).catch(() => {});
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
    if (m.from !== 'player') {
      state.typing[m.thread] = false;
      const viewing = (state.view === 'convo' && state.open === m.thread) || (state.view === 'calls' && m.thread === 'unknown');
      if (viewing) markSeen(m.thread === 'unknown' ? 'calls' : m.thread);
      const isCall = m.thread === 'unknown' && m.kind === 'call';
      const isRinging = m.thread === 'line' && /line is ringing/i.test(m.text);
      if (isCall) showRing('BLACKWOOD MANOR', 'Your real phone is ringing. Pick it up.');
      else if (isRinging) showRing('THE LINE', 'It’s ringing. Everyone’s phone is ringing.');
      else if (!['missed', 'calllog'].includes(m.kind)) { sfx.msg(); if (!viewing) toast(m); }
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
  es.addEventListener('status', (e) => {
    const statuses = JSON.parse(e.data);
    state.threads.forEach((t) => { if (statuses[t.key] != null) t.status = statuses[t.key]; });
    render();
  });
  es.addEventListener('typing', (e) => {
    const { thread, on, who } = JSON.parse(e.data);
    state.typing[thread] = on ? (who || true) : false; render();
  });
  es.onerror = () => { /* EventSource reconnects on its own */ };
}

// ============ settings, alerts, install ============
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;

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
    menu.showModal();
  };
  $('#closeMenu').onclick = () => menu.close();
  $('#soundToggle').onchange = (e) => store.set('bw-sound', e.target.checked ? '1' : '0');
  $('#captionsToggle').onchange = (e) => store.set('bw-captions', e.target.checked ? '1' : '0');
  $('#phoneLineToggle').onchange = (e) => store.set('bw-phoneline', e.target.checked ? '1' : '0');
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
    state.revealed = fresh.revealed; state.vote = fresh.vote; state.players = fresh.players; state.peers = fresh.peers; state.groups = fresh.groups; state.lobby = fresh.lobby;
    if (state.revealed && !state.recap) loadRecap();
    render();
    if ($('#power').hidden && !roleSeen() && state.me.assigned) showRole();
  } catch { /* offline: try again next time */ }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });

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
  } else {
    $('#pwrBtn').onclick = (e) => { e.stopPropagation(); $('#pwrBtn').disabled = true; firstRun(); };
  }
}

boot();
