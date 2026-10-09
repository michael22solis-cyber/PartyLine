# Next playtest: checklist

The changes in `docs/COST_REPORT.md` have only been tested offline. The next playtest is where they get measured, so a
few minutes of setup makes it count.

## Before (once)

1. **Voice model.** In `.env`, `OPENAI_REALTIME_MODEL` should be `gpt-realtime-2.1-mini`, or delete the line. An
   old `.env` that says `gpt-realtime` keeps the deprecated model, which costs about 3.5× more. On startup the server
   prints `voice model gpt-realtime-2.1-mini`.
2. **Twilio, if you use real phone calls.**
   - `TWILIO_AUTH_TOKEN` is set, and the webhook on your Twilio number is exactly `https://<PUBLIC_HOST>/voice`.
   - `/voice` now only answers requests signed by Twilio for that URL. If inbound calls fail, the server log says why;
     fix `PUBLIC_HOST` or set `TWILIO_WEBHOOK_VALIDATION=off`.
   - With ngrok, `PUBLIC_HOST` and the Twilio webhook both need updating each time the URL changes (this was already
     true before).
3. **`npm test`** should pass.
4. **Optional: recorded final reveal** (about $0.01, once). Run `npm run evidence -- --only=reveal`, or drop your own
   recording in `audio-src/custom/caretakerReveal.mp3` first. Without the file, the reveal stays a live call.
5. **Recommended: compare the voice models before players hear them** (about $0.10–$0.15).
   - Run `npm run eval:voice -- --live --budget 0.50`.
   - It runs six scripted scenes (normal chat, evidence, a probe for leaked secrets, prompt injection, repeated
     accusation, the Caretaker's opening) on `gpt-realtime` and `gpt-realtime-2.1-mini`.
   - Read the transcripts in `eval-results/`. If 2.1-mini's acting isn't good enough for a character, keep the old model
     for just that one, e.g. `OPENAI_REALTIME_MODEL_RUTH=gpt-realtime`.

6. **ElevenLabs (the Caretaker's voice, music and call backgrounds).**
   - In Railway → Variables: `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID` (the intro narrator). Never paste the key
     anywhere else, chat included.
   - The plan must be Creator or above for library voices, with credits for about 7 narrator lines, 5 music tracks
     and 4 call backgrounds (generated once, then cached on the `/data` volume).
   - On `/host`, the note under the stats should read *"all 7 lines ready"* and *"Music: all 9 tracks ready"*. If not,
     it shows what ElevenLabs said and a **Try again now** button.
   - Music is never made automatically. Tap **Make music (one time)** on `/host` once; the tracks are then looped in
     every game for free. Download them from the same note and drop them in `public/audio/music/` (named `early.mp3`,
     `late.mp3`, `deep.mp3`, `final.mp3`, `after.mp3`, `bed-ruth.mp3`, `bed-lily.mp3`, `bed-marcus.mp3`,
     `bed-teddy.mp3`) to build them into the game for good, with no ElevenLabs needed. `MUSIC_AUTO=on` restores
     automatic generation.
   - Credits: each track is made once and kept on the `/data` volume. The host page shows *"Saved audio kept since …"*;
     if that date resets after a deploy, the volume isn't attached and everything is regenerated (and charged) each
     time. A server start never makes more than `MUSIC_MAX_GENERATIONS` (default 12) tracks, and **Try again now** only
     appears after a real failure. `MUSIC=off` stops music generation entirely.
7. **Character voices (optional).** In Railway → Variables, set `VOICE_RUTH`, `VOICE_MARCUS`, `VOICE_LILY` or
   `VOICE_TEDDY` to any of: alloy, ash, ballad, cedar, coral, echo, marin, sage, shimmer, verse. `/host` shows which
   voice each character is using. A misspelled name is ignored.
8. **Rehearse the night offline:** `node --test test/rehearsal.test.js` plays a whole 75-minute game (every beat, five
   players) against the mock AI in about a second.

## What players should notice (worth watching for)

- **Some secrets only come out on a call.** Lily's 911 call, the mud on Ruth's shoes, and Teddy's speakers are never
  put in writing; by text the character tells you to call. Evidence heard on a call is marked **☎ HEARD ON A CALL** and
  scores extra.
- **Lily calls everyone** (about 47 minutes in) and only talks if you pick up and ask about Thursday night. Miss her and
  she texts "nvm" and won't pick up for 10 minutes.
- **Busy means busy.** Teddy is live during the early part and the deep part of the night, Marcus is driving late, Lily is
  on shift early. The first call goes unanswered with a text excuse; try again in two minutes. Their texts come a little
  slower too.
- **Secret agendas (pilot).** Everyone gets a sealed secret and three goals in their **Notebook**: something to
  uncover, something social (share clues, start a group chat, call three suspects, swing the vote), and *keep your
  secret: don't let anyone name you as the accomplice*. The accomplice gets misdirection goals. About 37 and 57 minutes
  in, Teddy leaks someone's secret to two other players (once with fewer than 5 players) and Ruth warns that player.
  Missions and secrets about a suspect stay sealed (🔒) until the player has that suspect in their phone, then appear
  with a heads-up on The Line.
  The end screen reveals every agenda, and whoever completed the most is **Puppet Master**.
- **Characters text first.** Accuse someone and they come back to it a few minutes later; uncover a secret and they ask
  you to keep it quiet; word gets around and another suspect gossips to someone else. Capped at 2 per character and 5
  per player a night. `INITIATIVE=off` turns it off.

## During

- **Costs are capped.** The group shares 40 minutes of calls (`CALL_POOL_MINUTES`), and each game has a hard AI budget of
  $5 (`GAME_BUDGET_USD`): at the cap the line goes dead for live calls in-story, texting continues; at $6.25 replies
  stop. `/host` shows spend against the budget and the group's call time left.

- **The host page (`/host`) is the live view:** each player's contacts, secrets (☎ = on a call), calls, call minutes
  and AI spend, plus the total spend this game. Anyone silent for 10+ minutes gets a yellow **QUIET** tag.
- **Someone lost their link?** They open the invite link again: the same phone shows *Continue as …*; a new phone
  lets them tap their name, and you tap **Let in** on `/host`.
- **Need a break?** **Pause the night** on `/host` holds every beat (phones show it) and **Resume** moves the rest of
  the night later by the time paused.
- **On the phones:** a night clock (*Votes open in 18 min*), a *While you were away* summary after a few minutes
  away, a text tone per suspect, and the votes counted out on every phone before the Caretaker's final call.
- **Stuck players:** tap **Send hint** on their row. They get a whisper on The Line about who to ask and how (never the
  answer), starting with the call-only secrets. Anyone (but the accomplice) who has found nothing by the 911 twist gets
  one automatically.

- **Spend so far:** on `/host`, or `npm run admin -- usage` for the full breakdown.
- **Characters cut off by background noise:** set `REALTIME_BARGE_IN_MS=700` and restart.
- **Players say characters are hard to interrupt:** set `REALTIME_BARGE_IN_MS=350`.
- **Loud room:** players can turn on **Captions on calls** in the ⋮ menu.
- **A call won't connect:** if OpenAI rejects a session setting, the server falls back to the original setup on its
  own and logs `session_fallback`. If calls still fail, `CONTEXT_MODE=legacy` restores the original prompts and
  session completely.

## After

1. `npm run usage` gives the typical session cost, the most expensive 5% of sessions, cost per completed mystery
   (logged when the reveal beat runs), and cost by capability.
2. Download the day's usage from the OpenAI dashboard and run `npm run usage -- --reconcile <export.json>`. It shows how
   closely the ledger's estimate matches what you were billed, bucket by bucket.
3. Notes worth writing down:
   - Did any character feel off (personality, emotional delivery, or revealing too much or too little)?
   - Did characters get cut off, or ignore people?
   - Did anyone notice that texting "ok" or "thanks" gets no reply?
   - Did people call on their own, or only answer? Did the busy excuses and unprompted texts feel alive, or annoying?
   - Did the hints arrive too early, too late, or not at all? Was anyone tagged QUIET who was actually busy?
   - Agendas: did people chase their goals, or ignore them? Did the leaks cause drama or just confusion? Which goals felt
     impossible or too easy?

`data/usage.jsonl` contains no dialogue, so it is safe to share for tuning.

Every rollback switch is listed in `docs/COST_REPORT.md` §9.
