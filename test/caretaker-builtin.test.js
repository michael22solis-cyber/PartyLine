// The Caretaker recorded by the host and built into the game: played as-is, with no ElevenLabs at all.
import { dataDir } from './helpers/env.js';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

let calls = 0;
const server = http.createServer((req, res) => { req.resume(); req.on('end', () => { calls++; res.writeHead(200, { 'Content-Type': 'audio/mpeg' }); res.end(Buffer.from('ID3fake')); }); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const dir = path.join(dataDir, 'builtin-audio'); // a private folder: other test files share public/audio
fs.mkdirSync(dir, { recursive: true });
process.env.BUILTIN_AUDIO_DIR = dir;
const { BUILT_FILES, recordedCall, voiceStatus } = await import('../src/voice/caretaker.js');
const placed = Object.keys(BUILT_FILES).filter((f) => !fs.existsSync(path.join(dir, f)));
const place = (files) => files.forEach((f) => fs.writeFileSync(path.join(dir, f), 'ID3fake'));
const clear = (files) => files.forEach((f) => fs.rmSync(path.join(dir, f), { force: true }));
after(() => { clear(placed); server.close(); });

test('all lines built in: recordings play with no ElevenLabs key and no request', async () => {
  place(placed);
  const r = await recordedCall('caretaker', { name: 'Ava' }, 0);
  assert.deepEqual(r.audio, ['/assets/audio/caretaker-hello.mp3', '/assets/audio/caretaker-riddle.mp3', '/assets/audio/caretaker-hint1.mp3', '/assets/audio/caretaker-fading.mp3']);
  assert.match(r.captions[0], /hello\? \.\.\.are you there/);
  assert.ok(!r.captions.join(' ').includes('Ava'), 'no name');
  assert.deepEqual((await recordedCall('caretaker_reveal', { name: 'Ava' })).audio, ['/assets/audio/caretaker-reveal.mp3']);
  assert.equal(voiceStatus().mode, 'recorded');
});

test('with ElevenLabs set up, built-in lines still win; a missing greeting is skipped, not generated', async () => {
  Object.assign(process.env, { ELEVENLABS_API_KEY: 'xi', ELEVENLABS_VOICE_ID: 'v', ELEVENLABS_BASE_URL: `http://127.0.0.1:${server.address().port}` });
  clear(placed.filter((f) => f === 'caretaker-hello.mp3')); // no built-in greeting: skipped
  const r = await recordedCall('caretaker', { name: 'Ben' }, 1);
  assert.equal(calls, 0);
  assert.deepEqual(r.audio, ['/assets/audio/caretaker-hint2.mp3', '/assets/audio/caretaker-fading.mp3']);
});
