// Bridges Twilio phone calls to an OpenAI Realtime voice model playing a character.
// Flow: phone <-> Twilio Media Stream (μ-law 8 kHz) <-> this server <-> OpenAI Realtime (μ-law in/out).
import 'dotenv/config';
import Fastify from 'fastify';
import fastifyWs from '@fastify/websocket';
import fastifyFormBody from '@fastify/formbody';
import WebSocket from 'ws';
import { CHARACTERS, buildInstructions } from './characters/index.js';
import { remember, summary } from './memory.js';
import { streamTwiml, DEAD_LINE_TWIML } from './twiml.js';
import { playerByPhone } from './store.js';
import { registerWeb } from './web.js';

const {
  OPENAI_API_KEY,
  OPENAI_REALTIME_MODEL = 'gpt-realtime',
  OPENAI_TRANSCRIBE_MODEL = 'gpt-4o-mini-transcribe',
  PUBLIC_HOST,
  RUTH_NUMBER,
  CARETAKER_NUMBER,
  PORT = 5050,
} = process.env;

if (!OPENAI_API_KEY) {
  console.error('Missing OPENAI_API_KEY in .env');
  process.exit(1);
}

const app = Fastify({ logger: false });
app.register(fastifyFormBody);
app.register(fastifyWs);

registerWeb(app);

// Callers are matched to players by phone number (added with `npm run admin -- add`).
const playerName = (phone) => playerByPhone(phone)?.name || 'detective';

// Which character answers depends on the number dialed. One number is fine: it goes to Ruth.
const SUSPECT_LINES = Object.fromEntries(
  [['ruth', RUTH_NUMBER], ['marcus', process.env.MARCUS_NUMBER], ['lily', process.env.LILY_NUMBER], ['teddy', process.env.TEDDY_NUMBER]]
    .filter(([, n]) => n)
    .map(([k, n]) => [n, k]),
);

app.get('/', async () => ({ ok: true, service: 'blackwood-line' }));

// Say clearly at startup whether the OpenAI key works (texts and calls depend on it).
fetch(`${process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'}/models`, { headers: { Authorization: `Bearer ${OPENAI_API_KEY}` } })
  .then(async (r) => {
    if (r.ok) console.log('OpenAI key: OK');
    else console.error(`OpenAI key problem (${r.status}): ${(await r.text()).slice(0, 200)}`);
  })
  .catch((e) => console.error('Could not reach OpenAI:', e.message));

// Inbound calls: set this as the Voice webhook (HTTP POST) on your Twilio number.
// The number that was dialed decides which character answers.
app.post('/voice', async (req, reply) => {
  const to = req.body?.To;
  const from = req.body?.From;
  // The Caretaker never answers: calling his number back gets a dead line.
  if (to === CARETAKER_NUMBER && CARETAKER_NUMBER !== RUTH_NUMBER) {
    return reply.type('text/xml').send(DEAD_LINE_TWIML);
  }
  const character = SUSPECT_LINES[to] || 'ruth';
  reply.type('text/xml').send(streamTwiml(PUBLIC_HOST, character, playerName(from), 'inbound'));
});

app.register(async (instance) => {
  instance.get('/media-stream', { websocket: true }, (twilioWs) => {
    let streamSid = null;
    let character = 'caretaker';
    let player = 'detective';
    let direction = 'outbound';
    let openai = null;
    let assistantSpeaking = false;

    const sendToTwilio = (msg) => {
      if (twilioWs.readyState === WebSocket.OPEN) twilioWs.send(JSON.stringify(msg));
    };

    function connectOpenAI() {
      openai = new WebSocket(`wss://api.openai.com/v1/realtime?model=${encodeURIComponent(OPENAI_REALTIME_MODEL)}`, {
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      });

      openai.on('open', () => {
        const c = CHARACTERS[character];
        openai.send(JSON.stringify({
          type: 'session.update',
          session: {
            type: 'realtime',
            model: OPENAI_REALTIME_MODEL,
            output_modalities: ['audio'],
            instructions: buildInstructions(character, player, summary()),
            audio: {
              input: {
                format: { type: 'audio/pcmu' },
                transcription: { model: OPENAI_TRANSCRIBE_MODEL },
                turn_detection: { type: 'server_vad' },
              },
              output: {
                format: { type: 'audio/pcmu' },
                voice: c.voice,
              },
            },
          },
        }));

        // Make the character speak first.
        openai.send(JSON.stringify({
          type: 'conversation.item.create',
          item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: c.opening(player) }] },
        }));
        openai.send(JSON.stringify({ type: 'response.create' }));
      });

      openai.on('message', (raw) => {
        let evt;
        try { evt = JSON.parse(raw); } catch { return; }

        switch (evt.type) {
          // Audio from the character -> phone. (GA name first, older beta name second.)
          case 'response.output_audio.delta':
          case 'response.audio.delta':
            assistantSpeaking = true;
            if (streamSid && evt.delta) sendToTwilio({ event: 'media', streamSid, media: { payload: evt.delta } });
            break;

          case 'response.done':
            assistantSpeaking = false;
            break;

          // Player started talking over the character: stop the character immediately (barge-in).
          case 'input_audio_buffer.speech_started':
            if (assistantSpeaking) {
              sendToTwilio({ event: 'clear', streamSid });
              openai.send(JSON.stringify({ type: 'response.cancel' }));
              assistantSpeaking = false;
            }
            break;

          // Save both sides of the conversation to shared memory.
          case 'conversation.item.input_audio_transcription.completed':
            remember({ player, character: CHARACTERS[character].name, speaker: 'player', text: evt.transcript });
            break;
          case 'response.output_audio_transcript.done':
          case 'response.audio_transcript.done':
            remember({ player, character: CHARACTERS[character].name, speaker: 'character', text: evt.transcript });
            break;

          case 'error':
            console.error('OpenAI error:', JSON.stringify(evt.error));
            break;
          default:
            break;
        }
      });

      openai.on('close', () => console.log(`[${character}] OpenAI socket closed`));
      openai.on('error', (err) => console.error('OpenAI socket error:', err.message));
    }

    twilioWs.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      switch (msg.event) {
        case 'start': {
          streamSid = msg.start.streamSid;
          const p = msg.start.customParameters || {};
          character = CHARACTERS[p.character] ? p.character : 'caretaker';
          player = p.player || 'detective';
          direction = p.direction || 'outbound';
          console.log(`[${character}] ${direction} call with ${player} started (${streamSid})`);
          connectOpenAI();
          break;
        }
        case 'media':
          if (openai?.readyState === WebSocket.OPEN) {
            openai.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: msg.media.payload }));
          }
          break;
        case 'stop':
          console.log(`[${character}] call with ${player} ended`);
          if (openai?.readyState === WebSocket.OPEN) openai.close();
          break;
        default:
          break;
      }
    });

    twilioWs.on('close', () => {
      if (openai?.readyState === WebSocket.OPEN) openai.close();
    });
  });
});

app.listen({ port: Number(PORT), host: '0.0.0.0' }).then(() => {
  console.log(`Blackwood Line server listening on :${PORT}`);
  if (!PUBLIC_HOST) console.warn('PUBLIC_HOST is not set; Twilio will not be able to reach the media stream.');
});
