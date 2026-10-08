// Full-game rehearsal: a whole one-night game (the "quick" timetable, every beat in order) with 5 players texting,
// calling, missing calls, getting hints and voting, run in a few seconds against the mock OpenAI. It checks the night
// holds together end to end: no errors, every beat fires, evidence lands, everyone gets a recap.
import { until, sleep } from './helpers/env.js';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { startMockOpenAI } from './helpers/mock-openai.js';

process.env.BEAT_TIME_SCALE = '0.001'; // a 75-second wait inside a beat takes 75 ms
process.env.RING_TIMEOUT_MS = '150';   // unanswered calls go to "missed" quickly
process.env.INITIATIVE = 'on';
const mock = await startMockOpenAI();
process.env.OPENAI_BASE_URL = mock.url;
const { buildApp } = await import('../src/server.js');
const { addPlayer, messagesFor, playerByToken, firedBeats } = await import('../src/store.js');
const { runBeat } = await import('../src/beats.js');
const { pendingRing } = await import('../src/progress.js');
const { LENGTHS } = await import('../src/modes.js');
const { ledger } = await import('../src/ai/ledger.js');
const { resetAllowances } = await import('../src/voice/allowance.js');
const app = buildApp();
after(async () => { await app.close(); await mock.close(); });

const admin = { 'x-admin-key': 'test-admin' };
const post = (url, payload, headers) => app.inject({ method: 'POST', url, payload, headers });
const text = (p, thread, t) => post(`/api/p/${p.token}/messages`, { thread, text: t });
const thread = (p, th) => messagesFor(p.token).filter((m) => m.thread === th);

// Answer a ring if one comes (a live call on the mock), say `lines`, and hang up.
async function answer(p, character, lines = []) {
  await until(() => pendingRing(p.token)?.character === character, 2000, 5);
  const r = await post(`/api/p/${p.token}/call`, { character });
  assert.equal(r.statusCode, 200, `${p.name} answers ${character}: ${r.body}`);
  const { callId } = r.json();
  for (const [speaker, said] of lines) await post(`/api/p/${p.token}/call/transcript`, { callId, character, speaker, text: said });
  await post(`/api/p/${p.token}/call/end`, { callId, character, seconds: 60, reason: 'player_hung_up' });
}

test('a whole night, start to reveal, with five players', async () => {
  const errors = [];
  const realError = console.error;
  console.error = (...a) => { errors.push(a.join(' ')); realError(...a); };
  try {
    const ps = ['Ava', 'Ben', 'Cy', 'Dee', 'Eli'].map((name) => addPlayer({ name }));
    const [ava, ben, cy, dee, eli] = ps;
    const plan = LENGTHS.quick.beats.map(([b]) => b);

    for (const beat of plan) {
      if (beat === 'twist') { // the replies to Ben and Cy (with their evidence) land before the twist
        await until(() => playerByToken(ben.token).found?.includes('bingo'));
        await until(() => playerByToken(cy.token).found?.includes('diner'));
      }
      const run = runBeat(beat);
      if (beat === 'calls') {
        // The house calls everyone: three pick up, two let it ring out.
        await Promise.all([ava, ben, cy].map((p) => answer(p, 'caretaker')));
      }
      if (beat === 'lilyCalls') {
        // Ava picks up and asks the right question: phone-only evidence. The rest miss her.
        await answer(ava, 'lily', [['player', 'Lily, did you make the 911 call?'], ['character', 'okay. it was me. she was already dead when I got there.']]);
      }
      await run;

      if (beat === 'calls') {
        // Everyone has their clue and Ruth; they start texting.
        for (const p of ps) {
          assert.ok(thread(p, 'line').some((m) => m.kind === 'clue'), `${p.name} got a clue`);
          assert.equal((await text(p, 'ruth', 'Ruth, where were you Thursday night?')).statusCode, 200);
        }
      }
      if (beat === 'cast') {
        // Everyone has every suspect now. Ben asks Teddy about bingo; Cy asks Marcus about the diner; Dee accuses Marcus.
        await text(ben, 'teddy', 'Teddy, what time does bingo at St. Agnes end?');
        await text(cy, 'marcus', 'Your car was at the manor after dark. Where did you go? Rosie’s diner?');
        await text(dee, 'marcus', 'You killed her, Marcus.');
        // Eli tries Teddy, who is live: no answer, an excuse by text.
        const r = await post(`/api/p/${eli.token}/call`, { character: 'teddy' });
        assert.equal(r.statusCode, 409);
      }
      if (beat === 'twist') {
        // Halfway: anyone with nothing found got a whisper on The Line; Ben and Cy found something and didn't.
        for (const p of [dee, eli]) {
          const nudged = thread(p, 'line').some((m) => m.text.startsWith('A WHISPER ON THE LINE'));
          assert.equal(nudged, playerByToken(p.token).role !== 'accomplice', `${p.name} nudged unless they're the accomplice`);
        }
        assert.ok(!thread(ben, 'line').some((m) => m.text.startsWith('A WHISPER')));
      }
      if (beat === 'lilyCalls') {
        await sleep(300); // the others' rings time out
        assert.ok(playerByToken(ava.token).foundOnCall?.includes('call911'), 'Ava heard it on the call');
        for (const p of [ben, cy, dee, eli]) assert.ok(thread(p, 'lily').some((m) => m.text === 'nvm. forget i called.'), `${p.name} missed Lily`);
      }
      if (beat === 'caretakerHint') resetAllowances();
      if (beat === 'votesOpen') {
        const acc = ps.find((p) => playerByToken(p.token).role === 'accomplice');
        for (const p of ps) {
          const killer = p === acc ? 'Lily Blackwood' : 'Ruth Calloway';
          const accomplice = p === acc ? ben.name : acc.name;
          assert.equal((await post(`/api/p/${p.token}/vote`, { killer, accomplice })).statusCode, 200);
        }
      }
    }

    assert.deepEqual(plan.filter((b) => !firedBeats().includes(b)), [], 'every beat fired');
    assert.ok(ledger.records().some((r) => r.type === 'game_completed'));
    for (const p of ps) {
      assert.ok(thread(p, 'line').some((m) => m.kind === 'reveal'), `${p.name} saw the reveal`);
      const r = await app.inject({ method: 'GET', url: `/api/p/${p.token}/recap` });
      assert.equal(r.statusCode, 200);
      const recap = r.json();
      assert.equal(recap.group.length, 5);
      assert.equal(recap.groupVote.killer, 'Ruth Calloway');
      if (p === ava) assert.ok(recap.heardOnCalls >= 1);
    }
    const s = (await app.inject({ method: 'GET', url: '/admin/status', headers: admin })).json();
    assert.ok(s.spend.usd > 0, 'the host sees what the night cost');
    assert.deepEqual(errors, [], 'nothing went wrong along the way');
  } finally {
    console.error = realError;
  }
});
