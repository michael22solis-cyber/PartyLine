// Real-browser check of the in-app call flow in public/app.js (headless Chromium, fake microphone, fake WebRTC):
// answering a ring, the shared call controller loading in the page, usage/transcripts/disclosures reaching the server,
// hanging up, and the recorded reveal call. Needs playwright-core, which is not a project dependency:
//   npm i --no-save playwright-core && npm run test:browser
// (or set PLAYWRIGHT_CORE to the path of an installed playwright-core). Skips itself when unavailable.
import { until } from '../helpers/env.js';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import { startMockOpenAI } from '../helpers/mock-openai.js';

let chromium;
try {
  ({ chromium } = await import(process.env.PLAYWRIGHT_CORE || 'playwright-core'));
} catch {
  test('browser call flow', { skip: 'playwright-core not installed (npm i --no-save playwright-core)' }, () => {});
}

if (chromium) {
  process.env.UNLOCK_ALL = '1';
  const mock = await startMockOpenAI();
  process.env.OPENAI_BASE_URL = mock.url;
  const { buildApp } = await import('../../src/server.js');
  const { addPlayer, messagesFor, playerByToken } = await import('../../src/store.js');
  const { allLines } = await import('../../src/memory.js');
  const { ledger } = await import('../../src/ai/ledger.js');
  const { ringInApp } = await import('../../src/progress.js');
  const app = buildApp();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const base = `http://localhost:${app.server.address().port}`;
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined),
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
  });
  after(async () => { await browser.close(); await app.close(); await mock.close(); });

  // A stand-in RTCPeerConnection: the page talks to it exactly as it would to the real one; the test plays OpenAI.
  const FAKE_WEBRTC = () => {
    window.__sent = [];
    class FakeDC {
      constructor() { this.readyState = 'connecting'; window.__dc = this; setTimeout(() => { this.readyState = 'open'; this.onopen?.(); }, 30); }
      send(s) { window.__sent.push(JSON.parse(s)); }
    }
    class FakePC {
      constructor() { this.connectionState = 'new'; window.__pc = this; }
      createDataChannel() { return new FakeDC(); }
      addTrack() {}
      async createOffer() { return { type: 'offer', sdp: 'v=0 fake-offer' }; }
      async setLocalDescription() {}
      async setRemoteDescription() {
        this.connectionState = 'connected';
        // The character's voice: a quiet tone, so the page's audio path (phone-line sound) really runs.
        const ac = new AudioContext(); const dst = ac.createMediaStreamDestination(); const o = ac.createOscillator();
        o.connect(dst); o.start();
        setTimeout(() => this.ontrack?.({ streams: [dst.stream] }), 20);
      }
      close() { this.connectionState = 'closed'; }
    }
    window.RTCPeerConnection = FakePC;
    window.__emit = (evt) => window.__dc.onmessage({ data: JSON.stringify(evt) });
  };

  async function openPhone(p, { captions = false } = {}) {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.error('page error:', e.message));
    await page.addInitScript(FAKE_WEBRTC);
    await page.addInitScript((token) => localStorage.setItem(`bw-on-${token}`, '1'), p.token);
    if (captions) await page.addInitScript(() => localStorage.setItem('bw-captions', '1'));
    await page.goto(`${base}/p/${p.token}`);
    return page;
  }
  const usage = (pid) => ledger.usage().filter((r) => r.session === pid);

  test('answering a call in the browser: controller runs, usage + heard transcripts + disclosures reach the server', async () => {
    const p = addPlayer({ name: 'Bri' });
    await ringInApp(p, 'lily', {});
    const page = await openPhone(p, { captions: true });
    await page.click('#ringAnswer', { timeout: 10_000 });
    await page.waitForFunction(() => window.__sent?.some((e) => e.type === 'response.create'), null, { timeout: 10_000 });
    const opening = await page.evaluate(() => window.__sent[0]);
    assert.equal(opening.item.role, 'system', 'opening is a system note, not a fake caller line');
    await page.waitForFunction(() => document.querySelector('#callState').textContent === 'ON THE LINE', null, { timeout: 10_000 });

    // OpenAI answers: the opening plays fully.
    const usageBlock = { input_tokens: 1200, output_tokens: 90, input_token_details: { text_tokens: 1200, audio_tokens: 0, cached_tokens: 0, cached_tokens_details: { text_tokens: 0, audio_tokens: 0 } }, output_token_details: { text_tokens: 10, audio_tokens: 80 } };
    await page.evaluate((u) => {
      window.__emit({ type: 'response.created', response: { id: 'resp_1' } });
      window.__emit({ type: 'response.output_item.added', response_id: 'resp_1', item: { id: 'item_1', type: 'message' } });
      window.__emit({ type: 'output_audio_buffer.started', response_id: 'resp_1' });
      window.__emit({ type: 'response.output_audio_transcript.done', response_id: 'resp_1', item_id: 'item_1', transcript: '...who is this?' });
      window.__emit({ type: 'response.done', response: { id: 'resp_1', status: 'completed', output: [{ type: 'message', id: 'item_1' }], usage: u } });
      window.__emit({ type: 'output_audio_buffer.stopped', response_id: 'resp_1' });
    }, usageBlock);
    // Captions follow the voice.
    await page.waitForFunction(() => document.querySelector('#callCaptions').textContent.includes('who is this?'), null, { timeout: 5000 });
    await until(() => usage(p.pid).some((r) => r.responseId === 'resp_1'));
    assert.equal(usage(p.pid).find((r) => r.responseId === 'resp_1').source, 'client');
    await until(() => allLines().some((l) => l.pid === p.pid && l.text === '...who is this?'));

    // A cough while the character is speaking: the page ignores it (no interruption, removed from the conversation).
    await page.evaluate(() => {
      window.__emit({ type: 'output_audio_buffer.started', response_id: 'resp_1' });
      window.__emit({ type: 'input_audio_buffer.speech_started', item_id: 'noise_1', audio_start_ms: 4000 });
      window.__emit({ type: 'input_audio_buffer.speech_stopped', item_id: 'noise_1', audio_end_ms: 4150 });
      window.__emit({ type: 'input_audio_buffer.committed', item_id: 'noise_1' });
    });
    await page.waitForFunction(() => window.__sent.some((e) => e.type === 'conversation.item.delete' && e.item_id === 'noise_1'), null, { timeout: 3000 });
    assert.equal(await page.evaluate(() => window.__sent.some((e) => e.type === 'output_audio_buffer.clear')), false, 'noise did not interrupt');
    await page.evaluate(() => window.__emit({ type: 'output_audio_buffer.stopped', response_id: 'resp_1' }));

    // The caller raises the 911 call; the model asks to open up; the server approves; the page answers the tool.
    await page.evaluate(() => {
      window.__emit({ type: 'input_audio_buffer.speech_started' });
      window.__emit({ type: 'input_audio_buffer.speech_stopped' });
      window.__emit({ type: 'response.created', response: { id: 'resp_2' } });
      window.__emit({ type: 'response.function_call_arguments.done', response_id: 'resp_2', call_id: 'call_1', name: 'check_guarded_topic', arguments: '{"topic":"call911"}' });
      window.__emit({ type: 'response.done', response: { id: 'resp_2', status: 'completed', output: [{ type: 'function_call', call_id: 'call_1', name: 'check_guarded_topic', arguments: '{"topic":"call911"}' }] } });
      window.__emit({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'u_1', transcript: 'Did you make the 911 call?' });
    });
    await page.waitForFunction(() => window.__sent.some((e) => e.item?.type === 'function_call_output'), null, { timeout: 10_000 });
    const out = await page.evaluate(() => JSON.parse(window.__sent.find((e) => e.item?.type === 'function_call_output').item.output));
    assert.equal(out.decision, 'open_up');
    assert.deepEqual(playerByToken(p.token).permitted.lily, ['call911']);

    // The confession is interrupted 0.6 s into a 6 s line, before the admission: only the heard part is kept.
    await page.evaluate(() => {
      window.__emit({ type: 'response.created', response: { id: 'resp_3' } });
      window.__emit({ type: 'response.output_item.added', response_id: 'resp_3', item: { id: 'item_3', type: 'message' } });
      window.__emit({ type: 'output_audio_buffer.started', response_id: 'resp_3' });
      window.__emit({ type: 'response.output_audio_transcript.done', response_id: 'resp_3', item_id: 'item_3', transcript: 'okay. it was me. i made the call. she was already dead when i got there.' });
      window.__emit({ type: 'response.done', response: { id: 'resp_3', status: 'completed', output: [{ type: 'message', id: 'item_3' }], usage: { input_tokens: 1300, output_tokens: 130, input_token_details: { text_tokens: 1300, audio_tokens: 0, cached_tokens: 1280, cached_tokens_details: { text_tokens: 1280, audio_tokens: 0 } }, output_token_details: { text_tokens: 10, audio_tokens: 120 } } } });
      window.__emit({ type: 'input_audio_buffer.speech_started' });
      window.__emit({ type: 'output_audio_buffer.cleared', response_id: 'resp_3' });
      window.__emit({ type: 'conversation.item.truncated', item_id: 'item_3', audio_end_ms: 600 });
    });
    await until(() => allLines().some((l) => l.pid === p.pid && /^okay\./.test(l.text)));
    await new Promise((r) => setTimeout(r, 1200));
    assert.doesNotMatch(await page.textContent('#callCaptions'), /already dead/, 'captions stop where the voice was cut off');
    const heard = allLines().find((l) => l.pid === p.pid && /^okay\./.test(l.text)).text;
    assert.equal(heard, 'okay.—');
    assert.doesNotMatch(heard, /it was me|already dead/, 'the unheard words are not remembered');
    assert.deepEqual(playerByToken(p.token).found, [], 'no evidence for words the player never heard');
    await until(() => usage(p.pid).find((r) => r.responseId === 'resp_3')?.audioPlayedMs === 600);

    await page.click('#callEnd');
    await until(() => ledger.records().some((r) => r.type === 'call_ended' && r.session === p.pid));
    await until(() => messagesFor(p.token).some((m) => m.kind === 'calllog'));
    await page.close();
  });

  test('an unanswered "ok thanks" shows as Read, so silence looks intentional', async () => {
    const { handlePlayerText } = await import('../../src/chat.js');
    const { threadHistory } = await import('../../src/store.js');
    const p = addPlayer({ name: 'Rec' });
    await handlePlayerText(p, 'ruth', 'Tell me about the house');
    await until(() => threadHistory(p.token, 'ruth', 10).some((m) => m.from === 'character'));
    await handlePlayerText(p, 'ruth', 'ok thanks');
    await until(() => threadHistory(p.token, 'ruth', 10).at(-1).readAt);
    const page = await browser.newPage();
    await page.addInitScript((token) => localStorage.setItem(`bw-on-${token}`, '1'), p.token);
    await page.goto(`${base}/p/${p.token}#ruth`);
    await page.waitForSelector('.receipt', { timeout: 10_000 });
    assert.match(await page.textContent('.receipt'), /^Read /);
    await page.close();
  });

  test('a dropped call says so and offers to call back', async () => {
    const p = addPlayer({ name: 'Dro' });
    await ringInApp(p, 'teddy', {});
    const page = await openPhone(p);
    await page.click('#ringAnswer', { timeout: 10_000 });
    await page.waitForFunction(() => document.querySelector('#callState').textContent === 'ON THE LINE', null, { timeout: 10_000 });
    // With the phone-line sound (on by default) the voice is heard through the filter, not the plain element.
    await page.waitForFunction(() => document.querySelector('#callAudio').muted === true, null, { timeout: 3000 });
    await page.evaluate(() => { window.__pc.connectionState = 'failed'; window.__pc.onconnectionstatechange(); });
    await page.waitForFunction(() => document.querySelector('#callState').textContent === 'CALL DROPPED', null, { timeout: 3000 });
    assert.equal(await page.evaluate(() => document.querySelector('#callAudio').muted), false, 'unmuted again after the call');
    assert.equal(await page.isVisible('#callBack'), true);
    const calls0 = ledger.records().filter((r) => r.type === 'call_started' && r.session === p.pid).length;
    await page.click('#callBack');
    await until(() => ledger.records().filter((r) => r.type === 'call_started' && r.session === p.pid).length === calls0 + 1);
    await page.waitForFunction(() => document.querySelector('#callState').textContent === 'ON THE LINE', null, { timeout: 10_000 });
    await page.click('#callEnd');
    await page.waitForFunction(() => document.querySelector('#callState').textContent === 'CALL ENDED', null, { timeout: 2000 });
    assert.equal(await page.isVisible('#callBack'), false, 'no call back after hanging up yourself');
    await page.waitForSelector('#callScreen', { state: 'hidden', timeout: 3000 });
    // Another drop, and someone rings while "CALL DROPPED" is still up: the ring must be answerable.
    await ringInApp(p, 'teddy', {});
    await page.click('#ringAnswer', { timeout: 10_000 });
    await page.waitForFunction(() => document.querySelector('#callState').textContent === 'ON THE LINE', null, { timeout: 10_000 });
    await page.evaluate(() => { window.__pc.connectionState = 'failed'; window.__pc.onconnectionstatechange(); });
    await page.waitForFunction(() => document.querySelector('#callState').textContent === 'CALL DROPPED', null, { timeout: 3000 });
    await ringInApp(p, 'lily', {});
    await page.waitForSelector('#ringAnswer', { state: 'visible', timeout: 5000 });
    assert.equal(await page.isHidden('#callScreen'), true, 'the ended screen gave way to the ring');
    await page.close();
  });

  test('the midnight reveal plays as a recorded call in the browser', async () => {
    const file = path.resolve('public/audio/caretaker-reveal.mp3');
    const existed = fs.existsSync(file);
    if (!existed) execFileSync(ffmpeg, ['-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', '1.2', '-b:a', '64k', file]);
    try {
      const p = addPlayer({ name: 'Mid' });
      await ringInApp(p, 'caretaker_reveal', {});
      const page = await openPhone(p, { captions: true });
      const secrets0 = mock.log.clientSecrets.length;
      await page.click('#ringAnswer', { timeout: 10_000 });
      await until(() => ledger.records().some((r) => r.type === 'call_ended' && r.session === p.pid && r.transport === 'recording'), 8000);
      assert.equal(mock.log.clientSecrets.length, secrets0, 'no live model session');
      assert.equal(await page.textContent('#callState'), 'THE LINE WENT DEAD');
      assert.match(await page.textContent('#callCaptions'), /^Thirty years/, 'the recorded reveal is captioned');
      await page.waitForSelector('#callScreen', { state: 'hidden', timeout: 5000 });
      await page.close();
    } finally {
      if (!existed) fs.rmSync(file);
    }
  });

  test('the Caretaker in the narrator voice: his recorded lines play one after another, captioned, then the line dies', async () => {
    const http = await import('node:http');
    const os = await import('node:os');
    const tone = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bw-tone-')), 'line.mp3');
    execFileSync(ffmpeg, ['-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=0.5', '-b:a', '64k', tone]);
    const mp3 = fs.readFileSync(tone);
    const eleven = http.createServer((req, res) => { req.resume(); req.on('end', () => { res.writeHead(200, { 'Content-Type': 'audio/mpeg' }); res.end(mp3); }); });
    await new Promise((r) => eleven.listen(0, '127.0.0.1', r));
    Object.assign(process.env, { ELEVENLABS_API_KEY: 'xi-test', ELEVENLABS_VOICE_ID: 'narrator', ELEVENLABS_BASE_URL: `http://127.0.0.1:${eleven.address().port}` });
    try {
      const p = addPlayer({ name: 'Wren' });
      await ringInApp(p, 'caretaker', {});
      const page = await openPhone(p, { captions: true });
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      const secrets0 = mock.log.clientSecrets.length;
      await page.click('#ringAnswer', { timeout: 10_000 });
      await page.waitForFunction(() => /Twenty steps down/.test(document.querySelector('#callCaptions').textContent), null, { timeout: 8000 });
      await page.waitForFunction(() => /Find me before midnight/.test(document.querySelector('#callCaptions').textContent), null, { timeout: 8000 });
      await until(() => ledger.records().some((r) => r.type === 'call_ended' && r.session === p.pid && r.transport === 'recording'), 8000);
      assert.equal(await page.textContent('#callState'), 'THE LINE WENT DEAD');
      assert.equal(mock.log.clientSecrets.length, secrets0, 'no live model session');
      assert.deepEqual(errors, []);
      await page.close();
    } finally {
      process.env.ELEVENLABS_API_KEY = ''; process.env.ELEVENLABS_VOICE_ID = '';
      eleven.close();
    }
  });
}
