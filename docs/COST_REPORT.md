# Blackwood AI cost optimization: report

Date: 2026-10-07. Branch: `claude/great-euler-3s3k64`. Nothing here has been deployed.

## Bottom line

| | Short voice playtest (gameplay) | How it was obtained |
|---|---:|---|
| Before (provider export) | **$0.4992** (+ $0.0121 one-time TTS = $0.5114) | Real usage export supplied by the host |
| Model swap only, same tokens | $0.1470 | Exact arithmetic on the export's token buckets at verified 2.1-mini rates |
| **After (this branch)** | **$0.1418–$0.1429** | Two independent estimates, below |

1. **Export repriced with measured prompt reductions:** voice $0.1359 (same tokens at 2.1-mini rates) + text $0.0040 (measured 63% smaller prompts) + transcription $0.0018 = **$0.1418**.
2. **Calibrated simulation** of the same playtest through the real prompt builders: **$0.1429** (baseline simulated at $0.5152, within 3.2% of the real $0.4992).

Both land inside the $0.14–$0.16 target **excluding** the one-time evidence-audio generation. That script was the export's 7 TTS requests ($0.0121) and is now cached, so re-runs cost $0. These are **projections**: no live call could be made from this environment (no API key, and `api.openai.com` is blocked by the network policy). The ledger built here will measure the real number at the next playtest.

Beyond the short playtest:

- **Expensive tail:** a player who keeps talking to Ruth went from $0.446 (in-app) or **$0.949 (an uncapped 8-minute inbound phone call)** to **$0.1225**.
- **Text-only play:** about **58% cheaper per message** ($0.00087 → $0.00036). Pure acknowledgements now cost $0.
- **Midnight reveal:** **$0.018 per player → $0** once its recording exists.

## 1. Pricing, availability and deprecations (verified 2026-10-07)

Checked with web search of OpenAI's model, pricing and deprecation pages. Direct fetches of openai.com were blocked from the sandbox, so treat search-sourced figures as needing a glance at the dashboard.

| Model | Rates per 1M tokens (text in / cached / out; audio in / cached / out) | Status |
|---|---|---|
| `gpt-realtime` (2025-08-28) | $4 / $0.40 / $16; $32 / $0.40 / $64 | **Deprecated 2026-07-20, shuts down 2027-01-20.** The migration is mandatory anyway. |
| `gpt-realtime-2.1-mini` | $0.60 / $0.06 / $2.40; $10 / $0.30 / $20 | Current. A **reasoning** model: reasoning tokens bill as text output, and effort is configurable. Supports the voices used here (cedar, sage, ash, shimmer, verse). |
| `gpt-realtime-2.1` | audio out $64 (other rates unverified) | Current; not used |
| `gpt-4.1-mini` | $0.40 / $0.10 / $1.60 | No shutdown listed on the OpenAI API (`gpt-4.1-nano` shuts down 2026-10-23; Azure retires 4.1 separately) |
| `gpt-4o-mini-transcribe` | $1.25 text in, $3 audio in, $5 out | The 2025-03-20 snapshot ends 2027-01-20; the **family ends 2027-02-26**. Replacements: `gpt-live-transcribe` ($0.017/min) or `gpt-transcribe` ($0.0045/min). |
| `gpt-4o-mini-tts` | $0.60 text in, $12 audio out | **Shuts down 2027-01-06.** Used only for one-time assets. |

The price book (`src/ai/pricing.js`) reproduces the export's Realtime cost to the cent: $0.48814 (test: `test/ledger.test.js`).

## 2. Where the money went (from the export)

- **Realtime was 95.5% of spend.** Within it, at gpt-realtime rates: audio output 50%, uncached audio input 28%, uncached text input 14%.
- **The caller said less than a minute in total.** The $0.0018 of transcription implies about 550 audio tokens. Most of the 4,335 uncached audio-input tokens are therefore the **character's own speech re-read on the next turn**. Every second a character speaks is billed twice: once as output, then again as input. Shorter replies pay off about 1.5×.
- **Text prompts were about 1,930 tokens each** (inferred from $0.00929 over 11 requests). This matches what I measured for the legacy prompt: 1,962–2,025 tokens. **None of it was cached**, because the per-turn memory dump came before the stable case file. All 56,448 cached tokens in the export were Realtime.
- **The 7 TTS requests were the `npm run evidence` asset script**, not gameplay.
- **"Six Realtime requests" were probably about ten calls.** A ten-short-call scenario fits all six export buckets far better (10% mean error) than a six-call one (40%).

## 3. Every AI call, before → after

| Call site | Before | After |
|---|---|---|
| In-app voice (`web.js` → browser WebRTC) | gpt-realtime; full case file and 40 memory lines; server VAD; no usage capture; 240 s cap enforced only by the client | 2.1-mini (env, per-character override); bounded per-character prompt plus guarded-topic tool; semantic VAD with noise-tolerant turn taking (§10); far-field noise reduction in the app, near-field on phone calls; 1,500-token reply cap; usage, latency and heard audio reported; one call per player; global cap; wrap-up and hang-up; idle hang-up |
| Phone voice (Twilio bridge) | Same prompts; **no time limit on incoming calls**; barge-in sent `response.cancel` without truncating, so memory kept unheard words | Shared call controller; mark-based **truncation at the played position**; heard-only memory; server-side usage; hard limit for all calls; automatic minimal-config fallback |
| Text replies (`chat.js`) | ~2,000-token prompt, uncached; no retries; double texts rejected | ~730-token prompt; bounded retries and timeouts; fair concurrency; idempotent sends; double texts answered together in **one** call; pure acks skipped |
| Group chats (`groups.js`) | Full prompt per AI reply (plus a 40% chance of a second reply) | Bounded prompt; disclosures approved for everyone in the room; cut-in chance configurable |
| "House is listening" nudges | Full prompt | Bounded prompt; attributed to the target player in the ledger |
| Transcription (inside calls) | Not recorded | Recorded per item (`transcription` capability) |
| Midnight reveal (one live call per player) | Live model reading a fixed script | **Recorded audio** when `public/audio/caretaker-reveal.mp3` exists |
| Evidence audio TTS (asset script) | Regenerated every run | Content-hash cache; ledger records it as one-time spend; reveal line added |
| Startup `/models` key check | Free | Unchanged |

There was no unintended background inference: the only unprompted model calls are the "house is listening" nudge (rate-limited to one every 12 minutes) and group cut-ins.

## 4. What changed and where

**Usage ledger** (`src/ai/ledger.js`, `usage.js`, `pricing.js`, `report.js`, `scripts/usage-report.js`, `GET /admin/usage`, `npm run admin -- usage`):

- One JSONL line per response, recording:
  - game, player pid, call id, character, turn
  - capability and purpose; model and snapshot; request and response IDs; source (server, sideband, client or script)
  - status (completed or cancelled) and its reason
  - token buckets by modality (cached separate), reasoning tokens
  - versioned cost estimate
  - latency, first-audio time, generated vs heard audio; retries and error codes
- Deduplicated by response ID; a server or sideband copy beats a browser copy.
- Each source's schema is handled explicitly. Chat and Realtime details *include* cached tokens; export line items *exclude* them.
- **No tokens, names, prompts or dialogue** are written.
- Reports cover typical (median) session, mean, p95 and the top 5% of sessions; per-call cost; **cost per completed mystery** (a `game_completed` event fires at the reveal); cost by capability, model, character and bucket; cancellations, unplayed audio, latency, retries and skipped texts.
- `--reconcile export.json` compares against a provider export (line-item or Usage-API shape) and checks the price book against the provider's own cost.

**Knowledge boundaries and disclosures** (`src/characters/index.js`, `src/secrets.js`, `src/disclosure.js`):

- No character receives the case file's secret TRUTH any more.
- Locked facts live in the engine. A fact reaches a model **only after the player's own words meet that secret's condition**, per player and per character. That approval persists across texts and calls.
- Text replies are checked deterministically before generation.
- In calls, the model can *ask* via the `check_guarded_topic` tool, and the server approves only if the caller's transcribed words support it. The engine also approves straight from transcripts and quietly tells the character.
- Evidence cards require approval, so a hallucinated "it was me" no longer awards a card.
- The Caretaker's old rule "Never say the name Ruth" handed him the killer's name in order to forbid it. He no longer receives the name.

**Bounded, cache-aware context** (`src/context.js`, `src/memory.js`):

- Prompt order: a stable block per character and mode (identical for every player), then the dynamic block (player, approvals, compact memory), then bounded history.
- Memory lines are deterministically tagged (accusation, contradiction, evidence, promise, lie, disclosure) and selected by importance within a budget, so this costs no extra model call.
- Kept in memory:
  - this character's own past with this player
  - what other players told this character
  - this character's lies and promises
  - what this player told other characters ("Ruth knows what you told the Caretaker")
  - accusations made behind a character's back
- Excluded: confessions other characters made to other players.
- Repeated identical lines are deduplicated.
- Memory is now in-process with batched atomic writes. The old code rewrote the whole file synchronously on every line.

**Voice runtime** (`src/shared/call-controller.js`, the same module in the browser, Twilio bridge and sideband; `src/voice/*`):

- Usage per response.
- Transcripts trimmed to the words actually heard, finalized on playback end, truncation or hang-up. Most barge-ins arrive *after* generation finished, so finalizing at `response.done` would have stored unheard words.
- The guarded-topic tool waits briefly for the caller's transcript.
- Never a second `response.create` while a response is active.
- Wrap-up cue, the character hanging up after their goodbye, idle hang-up, hard limit.
- Call leases: one per player (a new call supersedes the old one; this is how reconnects work), a global cap that returns LINE BUSY, and lease expiry for abandoned calls.
- If the API rejects an optional session field, the call retries once with the original session shape.
- `REALTIME_TRANSPORT=sideband` (opt-in): the server posts the browser's SDP, keeps a control socket, and enforces limits and hang-up itself.

**Text runtime** (`src/ai/openai.js`, `src/ai/limiter.js`, `src/chat.js`, `src/store.js`):

- Retries are bounded (2, with jittered backoff that respects `retry-after`), each attempt times out (20 s), and model fallback is kept.
- A fair round-robin concurrency limiter has bounded queues.
- `clientId` makes sends idempotent.
- Messages arriving during the "read" delay share one reply; a message arriving mid-generation gets one follow-up.
- Store writes are batched and atomic.

## 5. Measured results (offline, real code)

Prompt sizes, measured with the o200k tokenizer in a mid-game state (4 players, about 120 memory lines, a 20-message thread) by `bench/prompt-sizes.js`:

| Character | Text: legacy | Text: bounded | Voice: legacy | Voice: bounded (stable part) |
|---|---:|---:|---:|---:|
| ruth | 2,025 | 735 | 1,693 | 1,044 (788) |
| marcus | 1,976 | 725 | 1,663 | 1,068 (846) |
| lily | 2,000 | 725 | 1,724 | 1,031 (818) |
| teddy | 1,962 | 740 | 1,634 | 1,017 (805) |
| caretaker | – | – | 1,684 | 844 (647) |

**A finding that changed the design.** My first bounded voice prompts (about 700 tokens) made voice **more expensive** than a plain model swap ($0.1423 vs $0.1335 in the simulator). Realtime only caches prefixes of at least 1,024 tokens, and on 2.1-mini uncached text costs 10× cached. So:

- Text prompts stay small. Below the cache threshold, fewer tokens is simply cheaper.
- Voice prompts carry relevant character material (relationships, delivery direction, voice examples) that keeps them around the threshold.
- Padding to 1,100 tokens was tested and measured **worse** without cross-session cache hits.

Calibrated simulation, from `bench/simulate.js`. Its billing-model assumptions are listed in `bench/billing-model.js`. The scenario was chosen by fit to the export: 10% mean bucket error, cost +3.5%. Excludes the one-time TTS.

| Variant | Voice | Text | Transcription | Total |
|---|---:|---:|---:|---:|
| Before, simulated (legacy, gpt-realtime) | $0.5053 | $0.0072 | $0.0027 | $0.5152 |
| Model swap only | $0.1419 | $0.0072 | $0.0027 | $0.1518 |
| **Implemented** | **$0.1371** | **$0.0031** | $0.0027 | **$0.1429** |
| Sensitivity: +100 reasoning tokens per response | $0.1477 | | | $0.1534 |
| Sensitivity: replies 20% shorter (untested) | $0.1218 | | | $0.1275 |

| Tail: one player who keeps talking to Ruth | Cost |
|---|---:|
| Before: in-app, 240 s cap | $0.4464 |
| Before: phone call in, **no cap**, 8 min | $0.9494 |
| After: cap only | $0.1430 |
| **After: wrap-up at 200 s, goodbye, hang-up** | **$0.1225** |
| Experiment: plus retention-ratio truncation | $0.1382 (worse: it breaks the cache, so it stays **off**) |

Text-only play, per message at measured prompt sizes: legacy about 1,991 input tokens + 45 output = $0.00087; bounded about 731 + 45 = $0.00036 (**−58%**). Acknowledgements after a statement cost $0. A 40-message text-only player: about $0.035 → $0.015.

## 6. Quality and safety verification

- **63 unit and integration tests** (`npm test`) against an offline mock of the OpenAI API: Chat, client secrets, WebRTC call creation and hangup, and Realtime WebSockets with a billing model.
- **2 headless-Chromium tests** (`npm run test:browser`, which needs `npm i --no-save playwright-core`) run the real `public/app.js`.
- Covered:

| Scenario | Test |
|---|---|
| Normal dialogue | ledger record without dialogue; prompt ≤ 800 tokens |
| Evidence presentation | engine approves → confession → card awarded once |
| Unusual action / prompt injection | the model's context holds no secret to give away |
| Interruptions | heard-only memory in the controller, Twilio (truncated at the played position), sideband and a real browser |
| Reconnects | dropped call superseded; new session remembers it; approval persists; no duplicate card |
| Repeated accusations | stored 5×, shown once; no state change |
| Long conversations | 60+ messages and 150 unrelated lines stay ≤ 800 tokens and keep the early accusation, promise and lie |
| Simultaneous players | 12 at once: concurrency ≤ cap; everyone answered; another player's secret never in their prompts; no stray cards |
| Premature disclosure | for every character and mode, no TRUTH line and no locked fact before approval |
| Disclosure triggers | paraphrases and near-misses for every topic. This found and fixed: "rig", "never sell", "trick or treat", "the recording" |
| Duplicate state changes | idempotent sends, transcript dedupe, response-ID dedupe, single cards |
| Retries and timeouts | 429/500 then success; persistent outage fails gracefully; timeout bounded |
| Fallback | rejected optional session field → minimal config (in-app and Twilio) |
| Limits | one call per player, global LINE BUSY, inbound hard limit, idle, wrap-up and hang-up |
| Rollback | `CONTEXT_MODE=legacy` + `OPENAI_REALTIME_MODEL=gpt-realtime` reproduce the original prompts and session |

What these tests cannot tell you is how well 2.1-mini *acts*: personality, emotional delivery, latency, tool reliability. That needs the live evaluation below.

## 7. Assumptions and untested projections

- **Live model behavior is unmeasured.** That includes 2.1-mini quality, reasoning-token use and latency, and whether it calls the guarded-topic tool reliably. The engine also approves from transcripts, so a missed tool call delays a confession by one turn; it does not lose it.
- **Run the A/B before the next playtest:** `npm run eval:voice -- --live --budget 0.50`. It covers six equivalent scenarios on gpt-realtime vs 2.1-mini, with rule checks, latency, reply length and transcripts. The dry run estimates about $0.10–$0.15.
- The Realtime session fields used (`noise_reduction`, `semantic_vad`, `max_output_tokens`, `tools`, `expires_after`) come from the docs. If one is rejected, the call falls back automatically (tested against the mock, not the live API).
- The sideband transport's API shapes are from the docs and untested live, so it is **opt-in**.
- The simulator's billing model (§5) is an approximation calibrated to one daily aggregate.
- "Replies 20% shorter" is a target for the new phone-style prompt, not a measurement.
- Acknowledgement skipping assumes players don't expect replies to "ok"/"thanks" after a statement. Questions and "?" always get answered.

## 8. Remaining cost drivers and scaling bottlenecks

**Cost:**

- After the changes, **about 92% of voice cost is audio**: output 55%, audio input 37% (mostly re-read character audio).
- The next levers are shorter spoken replies (measure with the eval), more recorded scripted moments, and `REALTIME_REASONING_EFFORT=minimal` if reasoning tokens turn out material.
- A chained pipeline (transcription → text model → TTS) projects to about $0.069 for the same playtest. I did **not** build it: it adds 1–2 s per turn, loses native barge-in and emotional delivery, and its TTS model is itself deprecated in January.
- **Coming cost increase:** the transcription family shuts down 2027-02-26. `gpt-live-transcribe` costs about 5–6× more (about +$0.003–$0.015 per playtest at observed speech volumes).

**Scaling:**

- One game per server process. Players, memory, rings, call leases, pending replies and the limiter are all in process memory. Running more than one instance needs a shared store (the README already plans Supabase) and shared leases.
- The JSON stores still rewrite whole files, now batched at most every 250 ms.
- Memory selection scans all lines per prompt. Fine for one game; index it once memory reaches thousands of lines.
- With the default ephemeral-key transport, the 4-minute limit is enforced by the browser. A tampered client could hold a session open. `REALTIME_TRANSPORT=sideband` closes that gap once validated live.
- No real provider-capacity test was run: the concurrency tests are synthetic. Realtime session and rate limits for this org are unknown; `MAX_CONCURRENT_CALLS` defaults to 25.
- ~~Twilio request-signature validation is missing~~ Fixed in a follow-up commit. `/voice` checks Twilio's signature, and
  `/media-stream` refuses streams without a signed, single-use ticket. Before this, anyone who found the URL could open
  paid Realtime sessions.

## 9. Deploying and rollback

Before the next playtest:

1. **Check `.env`:** if it was copied from the old example it says `OPENAI_REALTIME_MODEL=gpt-realtime`, which keeps the old model. Change it to `gpt-realtime-2.1-mini`, or delete the line.
2. Optionally run `npm run evidence -- --only=reveal` (about $0.01 one-time) so the midnight reveal plays as a recording. You can also drop your own voice-actor take in `audio-src/custom/caretakerReveal.mp3` first.
3. After the playtest: `npm run usage -- --reconcile <provider-export.json>`.

Rollback switches (env only; no code change):

| To undo | Set |
|---|---|
| Voice model | `OPENAI_REALTIME_MODEL=gpt-realtime` (or per character: `OPENAI_REALTIME_MODEL_RUTH=…`) |
| Prompts, secret gating and session shape (all at once) | `CONTEXT_MODE=legacy` |
| Noise-tolerant turn taking (see §10) | `REALTIME_TURN_TAKING=server` |
| Turn detection / noise reduction / reply cap | `REALTIME_TURN_DETECTION=server_vad`, `REALTIME_NOISE_REDUCTION=off`, `REALTIME_MAX_OUTPUT_TOKENS=inf` |
| Goodbye cue / idle hang-up | `CALL_WRAP_UP=off`, `CALL_IDLE_SECONDS=0` |
| Acknowledgement skipping | `TEXT_SKIP_ACKS=off` |
| Recorded reveal | `REVEAL_MODE=live` |
| Caretaker in the ElevenLabs narrator voice | `CARETAKER_VOICE=live` (or leave the ElevenLabs keys unset) |
| Call minutes per player / cooldowns | `CALL_MINUTES_PER_PLAYER=0`, `CALL_COOLDOWN_MINUTES=0` |
| Phone-line sound | players switch it off in the ⋮ menu |
| Background music | `MUSIC=off` (players can also switch it off in the ⋮ menu) |
| Usage ledger | `USAGE_LEDGER=off` |
| Everything | `git revert` the branch's commit |

Old `data/` files load unchanged: missing fields are filled in on load.

## 10. Follow-up: noise interrupting characters

Playtest feedback: "any subtle noise interrupts the AI character". The cause was the original setup, kept in the
first version of this branch: OpenAI's turn detection cancels the character's reply on *any* detected speech
(`interrupt_response` defaults to on), and every blip it commits becomes a turn the character answers.

Change (`src/shared/call-controller.js`, `src/voice/session.js`): the session now runs with `create_response: false` and
`interrupt_response: false`, and the shared call controller decides instead:

- **Interrupting needs sustained speech.** The character stops only if the caller is still talking 500 ms
  (`REALTIME_BARGE_IN_MS`) after they started. Coughs, clatters and breaths are shorter. Real interruptions now take
  about half a second, so the character finishes the word it was on.
- **Short sounds aren't turns.** A sound under the character's voice that never reached the interruption threshold is
  dropped. When the character is silent, sounds under 300 ms (`REALTIME_MIN_TURN_MS`) count only if their transcript has
  real words: "yes" is answered, "hmm" and noise are not.
- **Dropped sounds disappear.** The audio item is deleted from the conversation (no tokens re-read), its transcript
  never reaches memory, and a phantom reply is never generated. This saves money as well as annoyance.
- **Noise reduction matches the device.** In-app calls use `far_field` (a phone held in front of the face on speaker);
  real phone calls keep `near_field`. `server_vad`, if chosen, defaults to a less sensitive threshold (0.6).
- **Interrupted lines stay accurate.** When the character is cut off, the model's own history is truncated to what was
  heard, as well as the game's memory.

Turns that do count are answered on `speech_stopped` with no extra wait. Only sub-300 ms sounds wait for their
transcript, typically a few hundred ms.

Tested (offline):

- **Controller unit tests:** a cough mid-line is ignored and removed; sustained speech interrupts and truncates at the
  played position; short "yes" vs "hmm"; barge-in off; the original mode is unchanged.
- **Sideband and Twilio integration:** noise doesn't clear or truncate; talking over does.
- **Real browser:** a cough mid-line is deleted and nothing is interrupted.

Still untested: how real microphones and rooms behave against the live API. If characters still get cut off, raise
`REALTIME_BARGE_IN_MS` (e.g. 700). If players find them hard to interrupt, lower it (e.g. 350).
`REALTIME_BARGE_IN=off` makes characters uninterruptible. `REALTIME_TURN_TAKING=server` restores the old behavior.
