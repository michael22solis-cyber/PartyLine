// The Blackwood Line server: the burner-phone web app, in-app calls (WebRTC to OpenAI Realtime), and real phone
// calls (Twilio Media Streams bridged to OpenAI Realtime, see voice/twilio.js).
import 'dotenv/config';
import './env.js';
import { pathToFileURL } from 'node:url';
import Fastify from 'fastify';
import fastifyWs from '@fastify/websocket';
import fastifyFormBody from '@fastify/formbody';
import { registerWeb } from './web.js';
import { registerTwilio } from './voice/twilio.js';
import { ledger } from './ai/ledger.js';
import { realtimeModel } from './voice/session.js';

export function buildApp() {
  const app = Fastify({ logger: false });
  app.register(fastifyFormBody);
  app.register(fastifyWs);
  registerWeb(app);
  registerTwilio(app);
  app.get('/', async () => ({ ok: true, service: 'blackwood-line' }));
  app.addHook('onClose', async () => { await ledger.flush(); });
  return app;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const { OPENAI_API_KEY, PUBLIC_HOST, PORT = 5050 } = process.env;
  if (!OPENAI_API_KEY) {
    console.error('Missing OPENAI_API_KEY in .env');
    process.exit(1);
  }
  // Say clearly at startup whether the OpenAI key works (texts and calls depend on it).
  fetch(`${process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'}/models`, { headers: { Authorization: `Bearer ${OPENAI_API_KEY}` } })
    .then(async (r) => {
      if (r.ok) console.log('OpenAI key: OK');
      else console.error(`OpenAI key problem (${r.status}): ${(await r.text()).slice(0, 200)}`);
    })
    .catch((e) => console.error('Could not reach OpenAI:', e.message));

  const app = buildApp();
  // Ctrl-C / platform shutdown: stop cleanly so buffered game data and usage records are written.
  for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => { app.close().finally(() => process.exit(0)); });
  app.listen({ port: Number(PORT), host: '0.0.0.0' }).then(() => {
    console.log(`Blackwood Line server listening on :${PORT} (voice model ${realtimeModel()}, text model ${process.env.OPENAI_TEXT_MODEL || 'gpt-4.1-mini'})`);
    if (!PUBLIC_HOST) console.warn('PUBLIC_HOST is not set; Twilio will not be able to reach the media stream.');
  });
}
