// REALTIME_TRANSPORT=sideband: the browser carries the audio over WebRTC, while this server holds a control socket on
// the same OpenAI call and runs the call controller itself (usage, tools, wrap-up, hang-up). Authoritative limits.
import WebSocket from 'ws';
import { createCallController } from '../shared/call-controller.js';
import { openSideband, hangup } from './realtime-api.js';
import { callTranscript, callDisclose, callUsage, closeCall } from './calls.js';

export function attachSideband(call, player, { openaiCallId, opening, toolName, timing, turns }) {
  const ws = openSideband(openaiCallId);
  let controller = null;
  let timer = null;
  let done = false;
  const send = (e) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(e)); };

  function stop(reason, { hangUp }) {
    if (done) return;
    done = true;
    clearInterval(timer);
    controller?.end(reason);
    if (hangUp) hangup(openaiCallId);
    try { ws.close(); } catch { /* already closed */ }
    closeCall(call.id, reason);
  }
  call.onClose.push((reason) => stop(reason, { hangUp: true }));

  ws.on('open', () => {
    controller = createCallController({
      mode: 'webrtc', send, opening: opening.text, openingRole: opening.role, toolName, timing, turns,
      hooks: {
        transcript: (speaker, text, meta) => callTranscript(call, player, speaker, text, meta),
        usage: (rec) => callUsage(call, rec, 'sideband'),
        disclose: (topic, recent) => callDisclose(call, player, topic, recent),
        end: (reason) => setImmediate(() => stop(reason, { hangUp: true })),
        error: (e) => console.warn(`[call ${call.npc}] realtime error:`, e?.code || e?.message),
      },
    });
    controller.start();
    timer = setInterval(() => controller.tick(), 500);
    timer.unref?.();
  });
  ws.on('message', (raw) => {
    let evt;
    try { evt = JSON.parse(raw); } catch { return; }
    controller?.handle(evt);
  });
  ws.on('close', () => stop('player_hung_up', { hangUp: false }));
  ws.on('error', (err) => console.error(`[call ${call.npc}] sideband error:`, err.message));
  return { close: () => stop('server_closed', { hangUp: true }) };
}
