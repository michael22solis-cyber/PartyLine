// The game's hard daily ElevenLabs cap: once it's reached, no more requests are sent, even across restarts.
import './helpers/env.js';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

let calls = 0;
const server = http.createServer((req, res) => { req.resume(); req.on('end', () => { calls++; res.writeHead(200, { 'Content-Type': 'audio/mpeg' }); res.end(Buffer.from('ID3fake')); }); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
after(() => server.close());
Object.assign(process.env, { ELEVENLABS_API_KEY: 'xi-test', ELEVENLABS_VOICE_ID: 'v1', ELEVENLABS_BASE_URL: `http://127.0.0.1:${server.address().port}`, ELEVENLABS_MAX_CHARS_PER_DAY: '60' });
const { recordedCall } = await import('../src/voice/caretaker.js');
const { elevenToday } = await import('../src/eleven-guard.js');

test('over the daily cap, nothing is sent to ElevenLabs', async () => {
  const r = await recordedCall('caretaker_reveal', { name: 'Ava' }); // the reveal line alone is longer than 60 characters
  assert.equal(r, null, 'falls back instead of spending');
  assert.equal(calls, 0, 'no request went out');
  process.env.ELEVENLABS_MAX_CHARS_PER_DAY = '2000';
  await recordedCall('caretaker_reveal', { name: 'Ava' });
  assert.equal(calls, 1);
  assert.ok(elevenToday().chars > 60);
  process.env.ELEVENLABS_MAX_CHARS_PER_DAY = String(elevenToday().chars); // exactly used up
  const before = calls;
  await recordedCall('caretaker', { name: 'Ben' }); // would need new clips
  assert.equal(calls, before, 'capped: nothing more is sent');
});
