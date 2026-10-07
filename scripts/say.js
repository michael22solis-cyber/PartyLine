// One-off line in any ElevenLabs voice:  npm run say -- <voiceId> "<text>" [file.mp3]
// Example: npm run say -- abc123 "[frightened, whispering] Who's there? ... Ma'am?" maam.mp3
import 'dotenv/config';
import fs from 'node:fs';

const [voice, text, out = 'line.mp3'] = process.argv.slice(2);
const { ELEVENLABS_API_KEY, ELEVENLABS_MODEL = 'eleven_v4' } = process.env;
if (!ELEVENLABS_API_KEY || !voice || !text) {
  console.error('Usage: npm run say -- <voiceId> "<text>" [file.mp3]   (needs ELEVENLABS_API_KEY in .env)');
  process.exit(1);
}
const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
  method: 'POST',
  headers: { 'xi-api-key': ELEVENLABS_API_KEY, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
  body: JSON.stringify({ text, model_id: ELEVENLABS_MODEL }),
});
if (!res.ok) { console.error(`Failed: ${res.status} ${await res.text()}`); process.exit(1); }
fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
console.log(`saved ${out}`);
