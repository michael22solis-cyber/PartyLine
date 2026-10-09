// Real-browser check of the home-screen gate in public/app.js (headless Chromium posing as each phone): a browser tab
// on a phone gets install steps instead of the game, the home-screen app boots normally, Android's own install
// dialog is offered when the browser has one, and computers are never gated.
//   npm i --no-save playwright-core && npm run test:browser
// Set SCREENSHOTS=<dir> to save what each phone sees. Skips itself when playwright-core is unavailable.
import '../helpers/env.js';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

let chromium;
try {
  ({ chromium } = await import(process.env.PLAYWRIGHT_CORE || 'playwright-core'));
} catch {
  test('home-screen gate', { skip: 'playwright-core not installed (npm i --no-save playwright-core)' }, () => {});
}

if (chromium) {
  const { buildApp } = await import('../../src/server.js');
  const { addPlayer } = await import('../../src/store.js');
  const app = buildApp();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const base = `http://localhost:${app.server.address().port}`;
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined),
  });
  after(async () => { await browser.close(); await app.close(); });

  const UA = {
    iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
    instagram: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 389.0.0.0',
    android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36',
  };

  async function openAs(ua, { standalone = false, shot = null } = {}) {
    const p = addPlayer({ name: `P${Math.random().toString(36).slice(2, 6)}` });
    const ctx = await browser.newContext(ua ? { userAgent: ua, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : {});
    if (standalone) await ctx.addInitScript(() => Object.defineProperty(Navigator.prototype, 'standalone', { get: () => true }));
    const page = await ctx.newPage();
    await page.goto(`${base}/p/${p.token}`);
    await page.waitForFunction(() => !document.querySelector('#install').hidden || document.querySelector('#pwrBtn').onclick);
    const snap = async (name) => {
      if (!process.env.SCREENSHOTS) return;
      fs.mkdirSync(process.env.SCREENSHOTS, { recursive: true });
      await page.screenshot({ path: path.join(process.env.SCREENSHOTS, `${name}.png`) });
    };
    if (shot) await snap(shot);
    return { page, ctx, snap, gated: () => page.isVisible('#install'), text: () => page.textContent('#install') };
  }

  test('iPhone in Safari: install steps instead of the game', async () => {
    const { ctx, page, gated, text } = await openAs(UA.iphone, { shot: 'iphone-safari' });
    assert.equal(await gated(), true);
    assert.equal(await page.isVisible('#pwrBtn'), false, 'the power button is out of reach');
    assert.match(await text(), /Add to Home Screen/);
    assert.match(await text(), /Open Blackwood from your home screen/);
    await ctx.close();
  });

  test('iPhone from the home screen: the phone boots as usual', async () => {
    const { ctx, page, gated } = await openAs(UA.iphone, { standalone: true });
    assert.equal(await gated(), false);
    assert.equal(await page.isVisible('#pwrBtn'), true);
    await ctx.close();
  });

  test('a browser inside another app is told to copy the link into Safari', async () => {
    const { ctx, page, text } = await openAs(UA.instagram, { shot: 'iphone-instagram' });
    assert.match(await text(), /opened inside another app.*Safari/s);
    assert.equal(await page.isVisible('#install button:has-text("COPY MY LINK")'), true);
    await ctx.close();
  });

  test('Android: manual steps, then the browser’s own install dialog once it offers one', async () => {
    const { ctx, page, snap, text } = await openAs(UA.android, { shot: 'android-steps' });
    assert.match(await text(), /Install app/);
    await page.evaluate(() => {
      const e = new Event('beforeinstallprompt', { cancelable: true });
      e.prompt = async () => { window.__prompted = true; };
      e.userChoice = Promise.resolve({ outcome: 'accepted' });
      dispatchEvent(e);
    });
    await page.click('#install button:has-text("ADD TO HOME SCREEN")');
    await snap('android-prompt-accepted');
    assert.equal(await page.evaluate(() => window.__prompted), true);
    await page.waitForSelector('.install-done');
    assert.match(await text(), /Close this tab and open Blackwood from your home screen/);
    await ctx.close();
  });

  test('computers play in the browser, and REQUIRE_INSTALL=off lets phones play in a tab', async () => {
    const desktop = await openAs(null);
    assert.equal(await desktop.gated(), false);
    await desktop.ctx.close();
    process.env.REQUIRE_INSTALL = 'off';
    try {
      const phone = await openAs(UA.iphone);
      assert.equal(await phone.gated(), false);
      assert.equal(await phone.page.isVisible('#pwrBtn'), true);
      await phone.ctx.close();
    } finally { delete process.env.REQUIRE_INSTALL; }
  });
}
