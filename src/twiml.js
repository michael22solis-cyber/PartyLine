const escapeXml = (s) =>
  String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

// TwiML that connects a call to our media stream and tells it which character to play.
export function streamTwiml(publicHost, character, player, direction) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://${publicHost}/media-stream">
      <Parameter name="character" value="${escapeXml(character)}"/>
      <Parameter name="player" value="${escapeXml(player)}"/>
      <Parameter name="direction" value="${escapeXml(direction)}"/>
    </Stream>
  </Connect>
</Response>`;
}

export const DEAD_LINE_TWIML = `<?xml version="1.0" encoding="UTF-8"?>
<Response><Pause length="2"/><Say voice="Polly.Matthew">The number you have dialed is no longer in service.</Say><Hangup/></Response>`;
