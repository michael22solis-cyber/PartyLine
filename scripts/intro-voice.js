// Generates the Caretaker's 8 intro lines with ElevenLabs (Eleven v4) into intro/assets/voice/01.mp3 ... 08.mp3.
// Usage: put ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID in .env, then `npm run voice`.
// Send the 8 files back to Claude (or run `python3 intro/render.py`) to mix them into the intro video.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';

const { ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID, ELEVENLABS_MODEL = 'eleven_v4' } = process.env;
if (!ELEVENLABS_API_KEY || !ELEVENLABS_VOICE_ID) {
  console.error('Add ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID to .env first.');
  process.exit(1);
}

// Same words as the captions. The [tags] tell Eleven v4 how to deliver each line.
const LINES = [
  '[slow, raspy, old man] Halloween... nineteen ninety-six.',
  '[low, hollow] I went down into my cellar that night... [pause] and I never came back up.',
  '[quiet, bitter] Last night, the woman who bought my house died at the bottom of those stairs. Police say... accident.',
  '[slow] Four people were near my house that night.',
  '[whispers] One of them is lying.',
  '[close to the phone] So I\'m calling you.',
  '[urgent, low] Question them. Share your clues. Name the killer by midnight on Halloween.',
  '[whispers, menacing] And careful... one of your friends already works for the house.',
];

const outDir = path.resolve('intro/assets/voice');
fs.mkdirSync(outDir, { recursive: true });

for (const [i, text] of LINES.entries()) {
  const file = path.join(outDir, `${String(i + 1).padStart(2, '0')}.mp3`);
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': ELEVENLABS_API_KEY, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: ELEVENLABS_MODEL }),
  });
  if (!res.ok) {
    console.error(`Line ${i + 1} failed: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  console.log(`saved ${path.relative(process.cwd(), file)}`);
}
console.log('\nDone. Send the 8 files in intro/assets/voice/ to Claude to mix them into the intro.');
