// Isolated environment for one test file (node --test runs each file in its own process).
// Import this BEFORE any src/ module: it points data, the ledger and the OpenAI base URL somewhere safe.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bw-test-'));
process.env.BLACKWOOD_DATA_DIR = dataDir;
// Built-in audio (music, the Caretaker's lines) lives in public/audio in the real game; tests get an empty private folder
// so the host's real files never change what a test expects. Tests of built-in audio point this at their own folder.
process.env.BUILTIN_AUDIO_DIR ??= path.join(dataDir, 'builtin-audio');
process.env.OPENAI_API_KEY = 'sk-test-not-real';
process.env.TEXT_FAST = '1';
process.env.ADMIN_KEY = 'test-admin';
process.env.OPENAI_TEXT_MAX_RETRIES ??= '2';
delete process.env.VAPID_PUBLIC_KEY;
delete process.env.VAPID_PRIVATE_KEY;
// Never reach ElevenLabs from tests, even if a developer's .env has keys (dotenv won't override these).
process.env.ELEVENLABS_API_KEY = '';
process.env.ELEVENLABS_VOICE_ID = '';
process.env.INITIATIVE ??= 'off'; // characters texting first: tested on its own (test/initiative.test.js)
process.env.CALL_POOL_MINUTES ??= '0'; // per-player minutes in the older tests; the shared pool is tested on its own

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function until(fn, ms = 3000, step = 10) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out waiting for condition');
    await sleep(step);
  }
}
