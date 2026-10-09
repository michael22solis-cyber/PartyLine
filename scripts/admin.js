// Game-master controls. Talks to your running server.
//   npm run admin -- add Maya +15555550123     add a player (phone optional) and print their link
//   npm run admin -- status                    players, votes, schedule
//   npm run admin -- beat intro                fire a beat right now
//   npm run admin -- schedule memo 2026-10-30T21:40:00-05:00
//   npm run admin -- night 2026-10-31T20:00-05:00 [quick|evening]   schedule the whole night (~75 min or ~2 hrs)
//   npm run admin -- usage                     AI cost so far (from the server's usage ledger)
//   npm run admin -- reset                     wipe the game (careful)
import 'dotenv/config';

const { ADMIN_KEY, PORT = 5050 } = process.env;
const BASE = process.env.ADMIN_BASE_URL || `http://localhost:${PORT}`;

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
    case 'night': {
      const r = await api('POST', '/admin/schedule-game', { at: args[0], length: args[1] || 'quick' });
      r.scheduled.forEach((x) => console.log(`scheduled ${x.beat} at ${x.at}`));
      break;
    }
    case 'usage': {
      const { formatReport } = await import('../src/ai/report.js');
      console.log(formatReport(await api('GET', '/admin/usage')));
      break;
    }
    case 'reset':
      console.log(await api('POST', '/admin/reset'));
      break;
    default:
      console.log('Commands: add, status, beat, schedule, night, usage, reset (see scripts/admin.js)');
  }
} catch (err) {
  console.error('Error:', err.message);
  process.exit(1);
}
