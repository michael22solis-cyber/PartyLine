// Secret agendas (pilot): dealing, goals completing, secrets leaking, and the reveal at the end.
import './helpers/env.js';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { startMockOpenAI } from './helpers/mock-openai.js';

const mock = await startMockOpenAI();
process.env.OPENAI_BASE_URL = mock.url;
const { buildApp } = await import('../src/server.js');
const { addPlayer, players, playerByToken, updatePlayer, messagesFor, castVote, setRevealed } = await import('../src/store.js');
const { runBeat } = await import('../src/beats.js');
const { checkAgendas, agendaView, GOALS } = await import('../src/agenda.js');
const { recapFor } = await import('../src/recap.js');
const { sendPeer } = await import('../src/crew.js');
const app = buildApp();
after(async () => { await app.close(); await mock.close(); });
const line = (p) => messagesFor(p.token).filter((m) => m.thread === 'line').map((m) => m.text);

const ps = ['Ava', 'Ben', 'Cy', 'Dee', 'Eli'].map((name) => addPlayer({ name }));
const fresh = (p) => playerByToken(p.token);

test('setup deals everyone a secret and three goals; the accomplice gets misdirection goals', async () => {
  await runBeat('setup');
  const secrets = new Set();
  for (const p of ps) {
    const a = fresh(p).agenda;
    assert.equal(a.goals.length, 3);
    assert.equal(a.goals[2], 'personal');
    secrets.add(a.secret);
    if (fresh(p).role === 'accomplice') assert.deepEqual(a.goals, ['acc_misdirect', 'acc_plant', 'personal']);
    else { assert.match(a.goals[0], /^case_/); assert.match(a.goals[1], /^soc_/); }
  }
  assert.equal(secrets.size, 5, 'no two players share a secret');
  await runBeat('agendas');
  for (const p of ps) assert.ok(line(p).some((t) => /^YOUR SECRET AGENDA/.test(t)));
  const st = (await app.inject({ url: `/api/p/${ps[0].token}/state` })).json();
  assert.equal(st.agenda.goals.length, 3);
  assert.equal(st.agenda.goals[2].status, 'vote');
});

test('a goal completes when the player does it, and they hear about it once', async () => {
  const det = ps.find((p) => fresh(p).role !== 'accomplice');
  const caseGoal = fresh(det).agenda.goals[0];
  const secretId = { case_bingo: 'bingo', case_diner: 'diner', case_speakers: 'speakers', case_911: 'call911', case_mud: 'mud', case_lullaby: 'lullaby' }[caseGoal];
  updatePlayer(det.token, { found: [...(fresh(det).found || []), secretId] });
  await checkAgendas();
  await checkAgendas();
  assert.equal(line(det).filter((t) => t.startsWith('✓ AGENDA COMPLETE')).length, 1);
  assert.equal(agendaView(fresh(det)).goals[0].status, 'done');
});

test('social goals are checked from what players actually do', async () => {
  const p = ps[0];
  const peers = ps.slice(1);
  assert.equal(GOALS.soc_calls.check({ ...fresh(p), called: ['ruth', 'lily'] }), false);
  assert.equal(GOALS.soc_calls.check({ ...fresh(p), called: ['ruth', 'lily', 'teddy'] }), true);
  const clue = await (await import('../src/live.js')).deliver({ token: p.token, thread: 'line', from: 'character', kind: 'clue', text: 'A clue.' });
  for (const q of peers.slice(0, 3)) await sendPeer(fresh(p), q.pid, { forward: clue.id });
  assert.equal(GOALS.soc_share.check(fresh(p)), true);
  assert.equal(GOALS.soc_receive.check(fresh(peers[0])), false, 'one sender is not enough');
  await sendPeer(fresh(peers[1]), peers[0].pid, { forward: messagesFor(peers[1].token).find((m) => m.forwarded).id });
  assert.equal(GOALS.soc_receive.check(fresh(peers[0])), true);
  await sendPeer(fresh(p), 'crew', { text: 'I heard Lily’s car was at the manor that night' });
  assert.equal(GOALS.acc_plant.check(fresh(p)), true);
});

test('leaks: Teddy tells two others someone’s secret and Ruth warns them; at most 2 a night with 5 players', async () => {
  const r1 = await runBeat('leak');
  const subject = ps.find((p) => p.name === r1.leaked);
  assert.equal(r1.to.length, 2);
  for (const name of r1.to) {
    const l = ps.find((p) => p.name === name);
    assert.ok(messagesFor(l.token).some((m) => m.thread === 'teddy' && m.text.includes(subject.name)), `${name} heard it`);
  }
  assert.ok(messagesFor(subject.token).some((m) => m.thread === 'ruth' && /people are talking about you/.test(m.text)));
  assert.ok(!messagesFor(subject.token).some((m) => m.thread === 'teddy' && m.text.includes(subject.name)), 'not told to their face');
  assert.equal(agendaView(fresh(subject)).leaked, true);
  const r2 = await runBeat('leak');
  assert.notEqual(r2.leaked, r1.leaked);
  assert.ok((await runBeat('leak')).skipped);
});

test('at the end, vote goals are settled and the recap shows everyone’s hidden agenda', async () => {
  const acc = ps.find((p) => fresh(p).role === 'accomplice');
  const named = ps.find((p) => p !== acc);
  for (const p of ps) castVote(p.token, p === acc ? 'Lily Blackwood' : 'Ruth Calloway', p === acc ? named.name : acc.name);
  setRevealed();
  const r = recapFor(fresh(named));
  const mine = r.group.find((g) => g.you);
  assert.equal(mine.agenda.goals[2].done, false, 'named as the accomplice: secret not kept');
  const accRow = r.group.find((g) => g.name === acc.name);
  assert.equal(accRow.agenda.goals[2].done, false);
  assert.ok(r.group.every((g) => g.agenda && g.agenda.secret));
  assert.equal(r.agenda.goals.length, 3);
});
