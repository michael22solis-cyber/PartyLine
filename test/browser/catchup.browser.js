// Real-browser check: when the phone's live connection is down (switching apps, a bad network), it still catches up:
// messages appear and a ringing call still shows. Needs playwright-core (see call-ui.browser.js). Takes ~25 s.
import '../helpers/env.js';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startMockOpenAI } from '../helpers/mock-openai.js';

let chromium;
try {
  ({ chromium } = await import(process.env.PLAYWRIGHT_CORE || 'playwright-core'));
} catch {
  test('browser catch-up', { skip: 'playwright-core not installed (npm i --no-save playwright-core)' }, () => {});
}

if (chromium) {
  const mock = await startMockOpenAI();
  process.env.OPENAI_BASE_URL = mock.url;
  const { buildApp } = await import('../../src/server.js');
  const { addPlayer } = await import('../../src/store.js');
  const { deliver } = await import('../../src/live.js');
  const { ringInApp, unlock } = await import('../../src/progress.js');
  const app = buildApp();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const base = `http://localhost:${app.server.address().port}`;
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined),
  });
  after(async () => { await browser.close(); await app.close(); await mock.close(); });

  test('with live updates cut off, messages and a ringing call still arrive', { timeout: 60_000 }, async () => {
    const p = addPlayer({ name: 'Nora' });
    await unlock(p, 'ruth');
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.addInitScript((t) => {
      localStorage.setItem(`bw-on-${t}`, '1');
      localStorage.setItem(`bw-tutorial-v1-${t}`, JSON.stringify({ status: 'complete', step: 0 }));
      localStorage.setItem(`bw-role-${t}`, 'detective');
    }, p.token);
    await page.route('**/stream', (route) => route.abort()); // live updates never get through
    await page.goto(`${base}/p/${p.token}`);
    await page.waitForSelector('button.app');
    await deliver({ token: p.token, thread: 'line', from: 'character', text: 'The line is listening.' });
    await ringInApp(p, 'ruth', {});
    await page.waitForFunction(() => !document.querySelector('#ring').hidden, null, { timeout: 30_000 });
    assert.match(await page.textContent('#ring'), /Ruth/i);
    await page.click('#ringDismiss');
    await page.waitForTimeout(21_000); // the next check-in must not bring back a call she declined
    assert.equal(await page.isHidden('#ring'), true);
    await page.click('button.app:has-text("Messages")');
    await page.click('.list li button:has-text("The Line")');
    assert.match(await page.textContent('#screen'), /The line is listening\./);
  });
}
