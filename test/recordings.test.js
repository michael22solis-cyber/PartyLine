// The host's one-time "Make the recordings" button: the 911 call and Ruth's voicemail are made on the server (here
// with the script's --fake voices), saved on the data volume, served, and used by the story.
import { until } from './helpers/env.js';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

process.env.EVIDENCE_FAKE = '1';
const { buildApp } = await import('../src/server.js');
const { audioIf } = await import('../src/progress.js');
const app = buildApp();
after(() => app.close());
const admin = { 'x-admin-key': 'test-admin' };
const status = async () => (await app.inject({ url: '/admin/status', headers: admin })).json().recordings;

test('missing recordings are made once on request, served, and played by the story', { timeout: 60_000 }, async () => {
  const builtIn = (f) => fs.existsSync(path.resolve('public/audio', f));
  if (builtIn('call911.mp3') && builtIn('ruth-voicemail.mp3')) return; // already built into the game
  const before = await status();
  assert.ok(before.missing > 0);
  assert.equal((await app.inject({ method: 'POST', url: '/admin/recordings/make' })).statusCode, 401, 'host only');
  await app.inject({ method: 'POST', url: '/admin/recordings/make', headers: admin });
  await until(async () => (await status()).missing === 0 && !(await status()).working, 50_000, 200);
  const after = await status();
  assert.equal(after.error, null);
  for (const f of after.files) {
    assert.ok(f.where);
    const r = await app.inject({ url: f.url });
    assert.equal(r.statusCode, 200);
    assert.ok(r.rawPayload.length > 1000, `${f.name} is real audio`);
  }
  assert.match(audioIf('call911.mp3'), /^\/assets\/(made|audio)\/call911\.mp3$/);
  assert.equal((await app.inject({ url: '/assets/made/..%2Fgame.json' })).statusCode, 404, 'only the recordings are served');
});
