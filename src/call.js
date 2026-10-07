// Make a character call a phone directly (for testing).
// Usage: npm run call -- +15555550123 Maya [character]
// Only call numbers whose owners agreed to receive AI calls (start with your own phone).
import 'dotenv/config';
import { callPhone } from './phone.js';

const [to, player = 'detective', character = 'caretaker'] = process.argv.slice(2);
if (!to) {
  console.error('Usage: npm run call -- +15555550123 [PlayerName] [character]');
  process.exit(1);
}
const sid = await callPhone(to, player, character);
console.log(`Calling ${to} as ${character} (call ${sid})`);
