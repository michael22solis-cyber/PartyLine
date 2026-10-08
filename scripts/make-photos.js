// Renders the photos characters send during the story (scripts/photos/*.html, built from the intro art) to
// public/photos/*.jpg. Needs playwright-core (not a project dependency):
//   npm i --no-save playwright-core && node scripts/make-photos.js
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const SIZES = { 'teddy-flyer': [720, 960], 'marcus-listing': [960, 720], 'ruth-card': [720, 960], 'lily-polaroid': [720, 900] };
const out = path.resolve('public/photos');
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined });
for (const [name, [width, height]] of Object.entries(SIZES)) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto(pathToFileURL(path.resolve(`scripts/photos/${name}.html`)).href);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(out, `${name}.jpg`), type: 'jpeg', quality: 80 });
  await page.close();
  console.log(`public/photos/${name}.jpg`);
}
await browser.close();
