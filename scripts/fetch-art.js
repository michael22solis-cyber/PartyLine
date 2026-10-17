// Builds the generated art into the game, so the phones never depend on an outside link on game night.
// Run it once on your computer, then commit what it saved:
//   npm run art   -> public/art/<key>.jpg (the clue photos, the 1996 poster, the cellar) and public/cast/dana.mp4
// Files already in the game are left alone (Dana's photo and the lineup already are).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import { CDN_ART } from '../public/art.js';

const dest = (key) => (key === 'danaVideo' ? 'public/cast/dana.mp4'
  : ['dana', 'lineup'].includes(key) ? `public/cast/${key}.jpg` : `public/art/${key}.jpg`);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bw-art-'));
let saved = 0, failed = 0;
for (const [key, url] of Object.entries(CDN_ART)) {
  const out = dest(key);
  if (fs.existsSync(out)) { console.log(`already in the game: ${out}`); continue; }
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`the link answered ${res.status}`);
    const raw = path.join(tmp, `${key}${path.extname(new URL(url).pathname)}`);
    fs.writeFileSync(raw, Buffer.from(await res.arrayBuffer()));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    if (out.endsWith('.mp4')) fs.copyFileSync(raw, out);
    // Phone-sized JPEGs: no wider than 1080 px.
    else execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', raw, '-vf', "scale='min(1080,iw)':-2", '-q:v', '4', out]);
    console.log(`saved ${out} (${Math.round(fs.statSync(out).size / 1024)} KB)`);
    saved++;
  } catch (err) {
    console.error(`couldn't get ${key}: ${err.message}`);
    failed++;
  }
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(saved ? `\n${saved} saved. Commit public/art and public/cast, then push.` : '\nNothing new to save.');
if (failed) {
  console.error(`${failed} couldn't be downloaded. The phones keep using the online copy for those.`);
  process.exitCode = 1;
}
