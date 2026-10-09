// Realtime session configuration, shared by in-app (WebRTC) and phone (Twilio) calls.
// Every knob is an environment variable so a model or setting can be rolled back without a deploy of new code.
import { CHARACTERS } from '../characters/index.js';
import { buildVoiceSetup, TOOL_NAME } from '../context.js';
import { contextMode } from '../disclosure.js';

// The OpenAI Realtime voices a character can use. Pick one per character in Railway Variables, no code change:
// VOICE_RUTH=shimmer, VOICE_MARCUS=echo, VOICE_LILY=coral, VOICE_TEDDY=ballad, VOICE_CARETAKER=... A name that isn't
// on the list is ignored (with a warning) so a typo never breaks a call.
export const VOICES = ['alloy', 'ash', 'ballad', 'cedar', 'coral', 'echo', 'marin', 'sage', 'shimmer', 'verse'];
export function voiceFor(npc) {
  const c = CHARACTERS[npc];
  const want = String(process.env[`VOICE_${String(npc).split('_')[0].toUpperCase()}`] || '').trim().toLowerCase();
  if (want && VOICES.includes(want)) return want;
  if (want) console.warn(`[voice] VOICE_${npc.split('_')[0].toUpperCase()}=${want} is not a Realtime voice (${VOICES.join(', ')}); using ${c?.voice}`);
  return c?.voice;
}

const env = process.env;
// gpt-realtime (2025-08-28) is deprecated and shuts down 2027-01-20. Roll back with OPENAI_REALTIME_MODEL=gpt-realtime.
export const realtimeModel = (npc) => env[`OPENAI_REALTIME_MODEL_${String(npc || '').toUpperCase()}`] || env.OPENAI_REALTIME_MODEL || 'gpt-realtime-2.1-mini';
export const transcribeModel = () => env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe';
const isReasoningModel = (m) => /^gpt-realtime-2(\.|-|$)/.test(m);

// Turn taking. By default the call controller (src/shared/call-controller.js) decides when a sound is a turn and when
// it may interrupt the character, so a cough or a door doesn't cut a character off or get an answer.
// REALTIME_TURN_TAKING=server hands both decisions back to OpenAI's turn detection (the original behavior).
export function turnTaking({ minimal = false } = {}) {
  return {
    managed: !minimal && env.REALTIME_TURN_TAKING !== 'server',
    bargeIn: env.REALTIME_BARGE_IN !== 'off', // off: the character can't be talked over; the caller waits their turn
    bargeInMs: Number(env.REALTIME_BARGE_IN_MS ?? 500), // keep talking this long over the character to interrupt
    minTurnMs: Number(env.REALTIME_MIN_TURN_MS ?? 300), // shorter sounds count only if they contain words
  };
}

function turnDetection(turns) {
  const type = env.REALTIME_TURN_DETECTION || 'semantic_vad';
  const control = turns.managed ? { create_response: false, interrupt_response: false } : {};
  if (type === 'server_vad') {
    return {
      type: 'server_vad',
      threshold: Number(env.REALTIME_VAD_THRESHOLD || 0.6), // API default 0.5; higher = less sensitive to noise
      ...(env.REALTIME_VAD_SILENCE_MS ? { silence_duration_ms: Number(env.REALTIME_VAD_SILENCE_MS) } : {}),
      ...control,
    };
  }
  return { type: 'semantic_vad', ...(env.REALTIME_VAD_EAGERNESS ? { eagerness: env.REALTIME_VAD_EAGERNESS } : {}), ...control };
}

// Call timing for one character: when to cue the goodbye, the hard limit, and the idle hang-up.
export function callTiming(npc) {
  const c = CHARACTERS[npc] || {};
  const cap = Number(env.MAX_CALL_SECONDS || 240);
  const maxSeconds = Math.min(cap, c.call?.maxSeconds || cap);
  return {
    maxSeconds,
    // CALL_WRAP_UP=off: no goodbye cue (a large number, not Infinity, because this travels as JSON).
    wrapUpAt: env.CALL_WRAP_UP === 'off' ? 1e9 : Math.max(5, Math.min(maxSeconds - 15, c.call?.wrapUpAt || maxSeconds - 40)),
    idleSeconds: Number(env.CALL_IDLE_SECONDS ?? 45), // 0 disables the idle hang-up
  };
}

/**
 * Build the session for one call. `format` is set for phone calls ('audio/pcmu'); WebRTC negotiates its own codec.
 * `minimal` reproduces the original, known-good session shape (used as an automatic fallback if the API rejects an
 * optional field, and for CONTEXT_MODE=legacy).
 */
export function realtimeSession({ npc, player, format = null, minimal = false }) {
  const c = CHARACTERS[npc];
  if (!c) throw new Error(`Unknown character: ${npc}`);
  const model = realtimeModel(npc);
  const { instructions, tools, stats } = buildVoiceSetup({ npc, player, withTool: !minimal });
  // CONTEXT_MODE=legacy is the one-switch rollback: original prompts AND the original session shape.
  const legacy = contextMode() === 'legacy';
  if (legacy) minimal = true;
  const turns = turnTaking({ minimal });
  const session = {
    type: 'realtime',
    model,
    ...(format ? { output_modalities: ['audio'] } : {}),
    instructions,
    audio: {
      input: {
        ...(format ? { format: { type: format } } : {}),
        transcription: { model: transcribeModel() },
        turn_detection: minimal ? { type: 'server_vad' } : turnDetection(turns),
      },
      output: { ...(format ? { format: { type: format } } : {}), voice: voiceFor(npc) },
    },
  };
  if (!minimal) {
    // In-app calls are usually a phone held in front of the face on speaker (far field); real phone calls are held to
    // the ear (near field).
    const nr = env.REALTIME_NOISE_REDUCTION ?? (format ? 'near_field' : 'far_field');
    if (nr && nr !== 'off') session.audio.input.noise_reduction = { type: nr };
    if (tools.length) { session.tools = tools; session.tool_choice = 'auto'; }
    const maxOut = env.REALTIME_MAX_OUTPUT_TOKENS ?? '1500';
    if (maxOut && maxOut !== 'inf') session.max_output_tokens = Number(maxOut);
    if (env.REALTIME_REASONING_EFFORT && isReasoningModel(model)) session.reasoning = { effort: env.REALTIME_REASONING_EFFORT };
    if (env.REALTIME_RETENTION_RATIO) {
      session.truncation = {
        type: 'retention_ratio',
        retention_ratio: Number(env.REALTIME_RETENTION_RATIO),
        ...(env.REALTIME_POST_INSTRUCTIONS_TOKENS ? { token_limits: { post_instructions: Number(env.REALTIME_POST_INSTRUCTIONS_TOKENS) } } : {}),
      };
    }
  }
  return { session, model, stats, turns, toolName: tools.length && !minimal ? TOOL_NAME : null };
}

// How the call opens: a system note in the conversation (bounded mode) or the original fake "user" line (legacy).
export function openingItem(text) {
  return { text, role: contextMode() === 'legacy' ? 'user' : 'system' };
}
