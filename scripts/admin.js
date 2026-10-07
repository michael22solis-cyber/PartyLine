// Game-master controls. Talks to your running server.
//   npm run admin -- add Maya +15555550123     add a player (phone optional) and print their link
//   npm run admin -- status                    players, votes, schedule
//   npm run admin -- beat intro                fire a beat right now
//   npm run admin -- schedule memo 2026-10-30T21:40:00-05:00
//   npm run admin -- night1 2026-10-30         schedule all of Night 1 (Central time)
//   npm run admin -- night2 2026-10-31         schedule all of Night 2 + midnight reveal
//   npm run admin -- reset                     wipe the game (careful)
import 'dotenv/config';

const { ADMIN_KEY, PORT = 5050 } = process.env;
const BASE = process.env.ADMIN_BASE_URL || `http://localhost:${PORT}`;
const TZ = process.env.GAME_TZ_OFFSET || '-05:00'; // Central Daylight Time in late October

async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'x-admin-key': ADMIN_KEY || '', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// Times follow the case doc. Night 2's reveal fires at midnight (start of Nov 1).
const NIGHT1 = [
  ['welcome', '12:00'], ['accomplice', '19:55'], ['intro', '20:00'], ['calls', '20:05'],
  ['cast', '21:15'], ['memo', '21:40'], ['ruthWarning', '22:30'], ['closeNight1', '23:00'],
];
const NIGHT2 = [
  ['twist', '19:00'], ['planted', '20:00'], ['caretakerHint', '21:00'], ['votesOpen', '22:30'], ['lineRinging', '23:59'],
];

const [cmd, ...args] = process.argv.slice(2);
try {
  switch (cmd) {
    case 'add': {
      const [name, phone] = args;
      console.log(await api('POST', '/admin/players', { name, phone }));
      break;
    }
    case 'status':
      console.log(JSON.stringify(await api('GET', '/admin/status'), null, 2));
      break;
    case 'beat':
      console.log(await api('POST', `/admin/beat/${args[0]}`));
      break;
    case 'schedule':
      console.log(await api('POST', '/admin/schedule', { beat: args[0], at: args[1] }));
      break;
    case 'night1':
    case 'night2': {
      const day = args[0];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '')) throw new Error('Give a date like 2026-10-30');
      for (const [beat, time] of cmd === 'night1' ? NIGHT1 : NIGHT2) {
        const r = await api('POST', '/admin/schedule', { beat, at: `${day}T${time}:00${TZ}` });
        console.log(`scheduled ${beat} at ${day} ${time}`, r.id);
      }
      if (cmd === 'night2') {
        const next = new Date(`${day}T12:00:00${TZ}`);
        next.setUTCDate(next.getUTCDate() + 1);
        const midnight = `${next.toISOString().slice(0, 10)}T00:00:00${TZ}`;
        await api('POST', '/admin/schedule', { beat: 'reveal', at: midnight });
        console.log(`scheduled reveal at ${midnight}`);
      }
      console.log('Remember: run `npm run admin -- beat setup` once everyone has joined, before Night 1.');
      break;
    }
    case 'reset':
      console.log(await api('POST', '/admin/reset'));
      break;
    default:
      console.log('Commands: add, status, beat, schedule, night1, night2, reset (see scripts/admin.js)');
  }
} catch (err) {
  console.error('Error:', err.message);
  process.exit(1);
}
