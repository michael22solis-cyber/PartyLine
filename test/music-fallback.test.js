// If the ElevenLabs plan has no Music API, the background tracks fall back to looping sound-effects ambience.
import './helpers/env.js';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const seen = [];
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => { body += d; });
  req.on('end', () => {
    seen.push({ url: req.url, body: JSON.parse(body || '{}') });
    if (req.url.startsWith('/v1/music')) { res.writeHead(402); res.end('payment required'); return; }
    res.writeHead(200, { 'Content-Type': 'audio/mpeg' }); res.end(Buffer.from('ID3fake'));
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
after(() => server.close());
Object.assign(process.env, { ELEVENLABS_API_KEY: 'xi-test', ELEVENLABS_BASE_URL: `http://127.0.0.1:${server.address().port}` });
const music = await import('../src/music.js');

test('no Music API on the plan: looping ambience instead, still one per stretch of the night', async () => {
  await music.warmUp();
  assert.equal(seen.filter((r) => r.url.startsWith('/v1/music')).length, 1, 'asks for music once, then stops trying');
  const sfx = seen.filter((r) => r.url.startsWith('/v1/sound-generation'));
  assert.equal(sfx.length, 9, '4 call backgrounds + 5 ambience tracks');
  assert.ok(sfx.every((r) => r.body.loop === true));
  assert.equal(Object.keys(music.trackUrls()).length, 5);
});

test('MUSIC=off turns it off', () => {
  process.env.MUSIC = 'off';
  assert.deepEqual(music.trackUrls(), {});
  assert.equal(music.musicStatus().mode, 'off');
  delete process.env.MUSIC;
});
