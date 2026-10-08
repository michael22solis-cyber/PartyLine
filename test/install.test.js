// The home-screen gate: phones play from the installed app, computers in the browser, and the host can turn it off.
import './helpers/env.js';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { deviceOS, installGate } from '../public/install.js';

const { buildApp } = await import('../src/server.js');
const { addPlayer } = await import('../src/store.js');
const app = buildApp();
await app.ready();
after(() => app.close());

const UA = {
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/138.0.7204.156 Mobile/15E148 Safari/604.1',
  iphoneInstagram: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 389.0.0.0',
  ipadOS: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36',
  androidWebView: 'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/138.0.0.0 Mobile Safari/537.36',
  windowsChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
};

test('a phone link opened in a browser tab asks to be added to the home screen first', () => {
  assert.deepEqual(installGate({ ua: UA.iphoneSafari }), { os: 'ios', inApp: false });
  assert.deepEqual(installGate({ ua: UA.iphoneChrome }), { os: 'ios', inApp: false });
  assert.deepEqual(installGate({ ua: UA.androidChrome }), { os: 'android', inApp: false });
  // iPadOS reports itself as a Mac with a touch screen
  assert.equal(deviceOS({ ua: UA.ipadOS, platform: 'MacIntel', touchPoints: 5 }), 'ios');
  assert.deepEqual(installGate({ ua: UA.ipadOS, platform: 'MacIntel', touchPoints: 5 }), { os: 'ios', inApp: false });
});

test('the home-screen app plays straight away', () => {
  for (const ua of [UA.iphoneSafari, UA.androidChrome]) assert.equal(installGate({ ua, standalone: true }), null);
});

test('browsers inside other apps are told to open the link in Safari or Chrome', () => {
  assert.deepEqual(installGate({ ua: UA.iphoneInstagram }), { os: 'ios', inApp: true });
  assert.deepEqual(installGate({ ua: UA.androidWebView }), { os: 'android', inApp: true });
});

test('computers play in the browser, and the server can turn the gate off', () => {
  assert.equal(installGate({ ua: UA.windowsChrome }), null);
  assert.equal(installGate({ ua: UA.ipadOS, platform: 'MacIntel', touchPoints: 0 }), null); // a real Mac
  assert.equal(installGate({ ua: UA.iphoneSafari, required: false }), null);
});

test('the player state says whether the gate is on (REQUIRE_INSTALL=off turns it off)', async () => {
  const p = addPlayer({ name: 'Gia' });
  const state = async () => (await app.inject({ url: `/api/p/${p.token}/state` })).json();
  assert.equal((await state()).requireInstall, true);
  process.env.REQUIRE_INSTALL = 'off';
  try { assert.equal((await state()).requireInstall, false); } finally { delete process.env.REQUIRE_INSTALL; }
});

test('the manifest opens the player’s own phone full screen, with the icons Chrome needs to install it', async () => {
  const p = addPlayer({ name: 'Hal' });
  const m = (await app.inject({ url: `/manifest/${p.token}.webmanifest` })).json();
  assert.equal(m.start_url, `/p/${p.token}`);
  assert.equal(m.display, 'standalone');
  for (const size of ['192x192', '512x512']) {
    const icon = m.icons.find((i) => i.sizes === size && i.type === 'image/png');
    assert.ok(icon, `${size} PNG icon`);
    const file = path.join('public', icon.src.replace('/assets/', ''));
    const png = fs.readFileSync(file);
    assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, size, `${file} is really ${size}`);
  }
});
