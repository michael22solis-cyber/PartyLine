import crypto from 'node:crypto';

const escapeXml = (s) =>
  String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

// Every media stream we hand to Twilio carries a signed, expiring ticket, and /media-stream refuses anything else:
// connecting to it opens a paid voice session, so nobody but Twilio (with our TwiML) may do that.
// Secret: STREAM_SECRET, else derived from TWILIO_AUTH_TOKEN, else random per process (fine for a single server).
const RANDOM = crypto.randomBytes(32);
const secret = () => process.env.STREAM_SECRET
  || (process.env.TWILIO_AUTH_TOKEN ? crypto.createHash('sha256').update(`blackwood-stream:${process.env.TWILIO_AUTH_TOKEN}`).digest() : RANDOM);
const TICKET_MS = () => Number(process.env.STREAM_TICKET_SECONDS || 900) * 1000; // outbound calls may ring a while
const fields = (p) => [p.character, p.player, p.direction, p.pid || '', p.exp].join('|');
const sign = (p) => crypto.createHmac('sha256', secret()).update(fields(p)).digest('base64url');

export function streamParams(character, player, direction, pid = null, now = Date.now()) {
  const p = { character, player, direction, ...(pid ? { pid } : {}), exp: String(now + TICKET_MS()) };
  return { ...p, sig: sign(p) };
}

const used = new Map(); // sig -> expiry, so a ticket can only open one stream
export function verifyStream(p, now = Date.now()) {
  if (process.env.STREAM_AUTH === 'off') return { ok: true };
  if (!p?.sig || !p.exp) return { ok: false, why: 'unsigned' };
  if (Number(p.exp) < now) return { ok: false, why: 'expired' };
  const want = Buffer.from(sign(p));
  const got = Buffer.from(String(p.sig));
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return { ok: false, why: 'bad signature' };
  for (const [s, exp] of used) if (exp < now) used.delete(s);
  if (used.has(p.sig)) return { ok: false, why: 'ticket already used' };
  used.set(p.sig, Number(p.exp));
  return { ok: true };
}

// TwiML that connects a call to our media stream and tells it which character to play.
export function streamTwiml(publicHost, character, player, direction, pid = null) {
  const params = Object.entries(streamParams(character, player, direction, pid))
    .map(([name, value]) => `      <Parameter name="${name}" value="${escapeXml(value)}"/>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://${publicHost}/media-stream">
${params}
    </Stream>
  </Connect>
</Response>`;
}

export const DEAD_LINE_TWIML = `<?xml version="1.0" encoding="UTF-8"?>
<Response><Pause length="2"/><Say voice="Polly.Matthew">The number you have dialed is no longer in service.</Say><Hangup/></Response>`;
