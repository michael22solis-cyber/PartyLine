// Protecting ElevenLabs credits: tapping "Try again" (or anything else) while tracks are being made never generates the
// same track twice, and a server start never spends more than MUSIC_MAX_GENERATIONS.
import { dataDir } from './helpers/env.js';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const seen = [];
const server = http.createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    seen.push(req.url);
    setTimeout(() => { res.writeHead(200, { 'Content-Type': 'audio/mpeg' }); res.end(Buffer.from('ID3fake')); }, 20);
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
after(() => server.close());
Object.assign(process.env, { ELEVENLABS_API_KEY: 'xi-test', ELEVENLABS_BASE_URL: `http://127.0.0.1:${server.address().port}` });
const music = await import('../src/music.js');

test('five warm-ups at once make each track exactly once', async () => {
  await Promise.all([music.warmUp(), music.warmUp(), music.warmUp(), music.warmUp(), music.warmUp()]);
  assert.equal(seen.length, 9, `5 music tracks + 4 call backgrounds, no duplicates (${JSON.stringify(music.musicStatus())} ${seen})`);
  await music.warmUp();
  assert.equal(seen.length, 9, 'cached: nothing more is generated');
  assert.equal(music.musicStatus().ready, 9);
});

test('never more than MUSIC_MAX_GENERATIONS paid generations per server start', async () => {
  // Pretend the files keep disappearing (e.g. no persistent volume): it stops instead of paying again and again.
  for (const f of fs.readdirSync(path.join(dataDir, 'music'))) fs.rmSync(path.join(dataDir, 'music', f));
  await music.warmUp();
  assert.equal(seen.length, 12, 'stopped at the default cap of 12');
  assert.match(music.musicStatus().error, /MUSIC_MAX_GENERATIONS/);
  await music.warmUp();
  assert.equal(seen.length, 12);
});

test('tracks built into the game (public/audio/music) are used as-is and never generated', async () => {
  const dir = path.resolve('public/audio/music');
  const made = !fs.existsSync(dir);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'final.mp3');
  const existed = fs.existsSync(file);
  if (!existed) fs.writeFileSync(file, 'ID3fake');
  try {
    assert.equal(music.trackUrls().final, '/assets/audio/music/final.mp3');
    process.env.ELEVENLABS_API_KEY = ''; // no key at all: built-in tracks still play
    assert.equal(music.trackUrls().final, '/assets/audio/music/final.mp3');
    assert.equal(music.trackUrls().early, undefined);
  } finally {
    process.env.ELEVENLABS_API_KEY = 'xi-test';
    if (!existed) fs.rmSync(file);
    if (made) fs.rmSync(dir, { recursive: true });
  }
});

test('nothing is generated when the server starts unless MUSIC_AUTO=on', async () => {
  const src = fs.readFileSync(path.resolve('src/server.js'), 'utf8');
  assert.match(src, /MUSIC_AUTO === 'on' \? warmMusic\(\)/);
});
