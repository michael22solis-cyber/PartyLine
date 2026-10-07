# The Blackwood Line

A 2-night Halloween mystery played on real phones. AI characters **call** players for real, and players **text** them in a burner-phone web app (no carrier approval needed). Every character shares one memory, so Ruth knows what you told the Caretaker.

## What's in here

| Piece | What it does |
|---|---|
| Phone calls | The Caretaker calls players; players can call Ruth (or each suspect, with extra numbers). Real-time AI voices via Twilio + OpenAI Realtime (`gpt-realtime-2.1-mini` by default). 4-minute cap on every call, incoming ones included. |
| Haunted old phone | Each player's private link opens a power-on and boot screen, then a home screen with Messages, Calls, Evidence, Notes (suspect board), Vote and The End. Glitches, whispers, synth sounds and a full-screen incoming-call alert. Installs to the home screen; push alerts. |
| Intro video | A 30-second story intro plays after a player taps the power button, then their private role card (Detective, or a blurred Accomplice card), then the phone. Replay it from Menu. Script: `intro/SCRIPT.md`. |
| New-player tutorial | A six-step, spoiler-free field guide opens after the first role card. Players can open the real apps from each step, return to the guide, pause and resume, or revisit it from the home screen and Menu → How to play. Progress is saved per private link on the current device. |
| Recap | After the midnight reveal, "The End" shows each player's detective score, rank, secrets uncovered, and a no-spoiler share card (PNG). |
| Beats | Every scripted moment from the case doc (intro, clues, 9:40 voice memo, 911 twist, accomplice's secret texts, midnight reveal). Fire by hand or schedule. |
| Admin CLI | Add players, fire or schedule beats, check votes. |

## Setup (about 45 minutes)

1. `npm install`
2. `cp .env.example .env` and fill in:
   - `OPENAI_API_KEY` (an older `.env` that says `OPENAI_REALTIME_MODEL=gpt-realtime` keeps the old, deprecated and ~3.5x pricier voice model: change it to `gpt-realtime-2.1-mini` or delete the line)
   - Twilio `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and a Voice-enabled number in `CARETAKER_NUMBER` and `RUTH_NUMBER` (the same number is fine)
   - `ADMIN_KEY`: any long random string
   - Push alerts: run `npm run vapid` and paste both keys into `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`
3. Make it reachable: `ngrok http 5050`, then put the host (no `https://`) in `PUBLIC_HOST`.
4. In Twilio → your number → Voice → "A call comes in": Webhook `https://YOUR_HOST/voice`, HTTP POST.
5. `npm run dev`

Phone audio needs a long-lived connection, so host this as its own Node server (Railway, Fly.io, Render), not on Vercel. Game data lives in `data/` as JSON files, which is fine for playtests. Move it to Supabase before selling games.

## The intro video

`public/intro.mp4` is a draft drawn in code. To make the real one, put pictures in `intro/assets/` (names are in `intro/SCRIPT.md`), add the Caretaker's narration as `intro/assets/voice.mp3` if you have it, and run `python3 intro/render.py` (needs Python with playwright + numpy, and ffmpeg). Any missing picture keeps its drawn placeholder. Animated suspects go in as `intro/assets/ruth.mp4` (and `marcus`, `lily`, `teddy`); the current ones are 3-second Kling 3.0 clips made in Higgsfield. If `intro.mp4` is deleted, the app skips straight to the boot screen.

Run `beat setup` **before** you send links, so each friend sees their role right after the video. Anyone who opens it earlier sees "Your role is sealed" and gets their real role the next time they open the app.

## Immersion features

- **Talk to them in the app.** Characters ring your Blackwood phone (ANSWER / DECLINE) and you talk out loud; unlocked suspects have a ☎ CALL button. Uses OpenAI Realtime straight from the phone's browser (needs mic permission and HTTPS, which ngrok gives you). Set `CALL_MODE=phone` to use real Twilio calls instead for players with a number.
- **Contacts unlock gradually.** You start with The Line. Your clue gives you Ruth plus anyone it names; anyone a suspect mentions (or you mention) gets added. The `cast` beat (21:15 on Night 1) unlocks everyone as a backup. `UNLOCK_ALL=1` turns this off.
- **Secrets become evidence.** When a suspect lets a locked secret slip, a NEW EVIDENCE card lands in that player's case file.
- **Real audio evidence.** Run `npm run evidence` once (uses your OpenAI key) to make `public/audio/memo.mp3`, `call911.mp3`, `ruth-voicemail.mp3` and `caretaker-reveal.mp3`. The memo, 911 call and Ruth's voicemail then play in the app. Ruth's late-night warning is now a call; if you don't pick up, she leaves the voicemail. With `caretaker-reveal.mp3` present, the scripted midnight reveal call plays the recording instead of a live model (no cost per player). Lines are cached, so re-running only pays for lines you changed.

## Players talking to each other

- **The Crew:** a group chat with every player, at the top of Messages.
- **Private DMs:** one thread per player under PLAYERS (where alliances and the accomplice’s scheming happen).
- **↗ SHARE:** any clue, evidence card, memo or voicemail can be sent to the crew or one player as the real card.
- **The house is listening:** mention the cellar, Ruth, bingo, the lullaby, mud or the 911 call in the crew chat and, now and then (at most every 12 minutes), Ruth texts someone else about what was just said.

## Host it online + run it from your phone

See **DEPLOY.md** to put the game on Railway (permanent link, no laptop needed).
Then open **`/host`** on that link: add players and copy their links, fire or schedule beats, watch votes, reset. No PowerShell needed during the game.

## Run a playtest

### Helping new players

The tutorial explains the two-night investigation, first clue, suspect questions and calls, sharing with the crew, private notes, voting, and the ending. It adapts its next step when the host has not assigned roles, no clue or contacts have arrived, other players have not joined, a vote is already saved, or the reveal has happened. It keeps roles and the solution private and opens voting for review without sending a vote or making a call.

Players can tap **DO THIS LATER** and use **FIELD GUIDE** on the home screen to resume. **MENU → How to play** reopens the tutorial; after completing it, either entry starts it again. Notifications still open their requested thread directly. Tutorial progress and notes stay on the device.

Run `npm test` to check saved tutorial progress, waiting states, contact and clue unlocks, sharing guidance, voting, and role privacy.

### Host controls

```bash
# 1. Add players (phone is optional; without it they only use the app)
npm run admin -- add Michael +15555550123
npm run admin -- add Maya +15555550124
# Each command prints a private link. Send each friend THEIR link.

# 2. When everyone has opened their link, assign the accomplice and clues
npm run admin -- beat setup

# 3a. Fire beats by hand while you watch...
npm run admin -- beat intro
npm run admin -- beat calls        # Caretaker calls everyone, then sends their clue
npm run admin -- beat memo

# 3b. ...or schedule both nights (Central time)
npm run admin -- night1 2026-10-30
npm run admin -- night2 2026-10-31   # includes the midnight reveal

npm run admin -- status              # players, roles, votes, schedule
```

All beats: `setup, welcome, accomplice, intro, calls, clues, cast, memo, ruthWarning, closeNight1, twist, planted, caretakerHint, votesOpen, lineRinging, reveal`. Use `clues` instead of `calls` to test without phones.

Tell iPhone players to tap **Share → Add to Home Screen**, open Blackwood from there, and turn on alerts (⋮ menu). Android and desktop can turn on alerts directly.

Reset everything: `npm run admin -- reset`.

## AI costs, memory and secrets

- **What each character knows:** only their own story, relationships and cover. Locked clues live in the game engine (`src/secrets.js`) and reach a character only after that player's own words meet the clue's condition (`src/disclosure.js`). No character is ever sent the solution.
- **Memory:** characters remember what each player said, claimed, promised and accused, compactly and within a token budget (`src/memory.js`, `src/context.js`).
- **Usage ledger:** every model response is logged to `data/usage.jsonl` with tokens, estimated cost, latency and status (never dialogue). `npm run usage` (or `npm run admin -- usage` against a running server) shows typical and top-5% session cost, cost per completed mystery and cost by capability; `npm run usage -- --reconcile export.json` checks it against a provider export.
- **Tests:** `npm test` (offline, no key needed). `npm run bench` replays a calibrated playtest through the prompt builders. `npm run eval:voice -- --live --budget 0.50` compares voice models on the same scenarios with a hard spend limit.
- Full write-up, measured results and rollback switches: `docs/COST_REPORT.md`.

## Guardrails built in

- Characters must follow the case file and only reveal locked clues when asked the right thing (the engine decides, not the model).
- Every character is disclosed as AI; players can turn calls off in the ⋮ menu.
- If a player writes something that sounds like real distress, the game steps out and points to 988.
- Calls are capped at 4 minutes (characters wrap up and hang up, idle calls end, one live call per player, a server-wide cap); texts are capped per player (`MAX_TEXTS_PER_PLAYER`).
- Background noise doesn't cut characters off: a player has to keep talking for half a second to interrupt (`REALTIME_BARGE_IN_MS`), and coughs or clatters are ignored instead of answered.
- Only call phones whose owners agreed to it. Start with your own.

## Next up

- Signup + payment page so hosts can buy a case themselves
- Supabase storage and Twilio request-signature checks before going public
- Validate `REALTIME_TRANSPORT=sideband` live, then make it the default (server-enforced call limits)
