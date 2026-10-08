# Playtest runbook: Play now with friends

How to run **Play now · about 75 minutes** in auto mode today, from "is the server up?" to the debrief. Budget
**about 2 hours** in total: 20 minutes of setup, 10 minutes for friends to join, 75 minutes of game, and 10 minutes
of debrief.

`docs/PLAYTEST_CHECKLIST.md` covers the cost-tuning checks (voice model, Twilio, the voice A/B). This runbook covers
running the night itself.

## At a glance

| | |
|---|---|
| Players | **3 to 8.** With 4 or more, one player is secretly the accomplice; with 3 there is no accomplice. |
| Each player needs | A phone with Safari (iPhone) or Chrome (Android), sound on, headphones if possible, and microphone permission for calls. On a phone, the game only runs from the Blackwood app on the home screen; the link walks them through adding it. |
| You need | The server reachable over HTTPS, an OpenAI key with credit, and your `ADMIN_KEY` |
| Twilio | **Not needed.** Calls ring inside the app by default (`CALL_MODE=app`) |
| Cost | A 4-minute suspect call is about $0.12. Texts are a fraction of a cent. A group of 4–6 should land at a few dollars. Watch it live (step 5). |

## Night-of checklist

- [ ] Server up, and its log says `OpenAI key: OK` (step 1)
- [ ] Solo smoke test passed on your own phone (step 2)
- [ ] New game created on `/host` with **Play now** (step 3)
- [ ] Invite sent, and the organizer chosen
- [ ] Everyone has joined, added Blackwood to their home screen, and opened it from there
- [ ] Everyone has allowed the mic and turned on alerts
- [ ] Organizer taps **START THE GAME**
- [ ] `/host` open on your phone for the whole game
- [ ] Debrief notes written down before people leave (step 7)

---

## 1. Get the server up (5–15 min)

### Option A: it's already on Railway

1. Open `https://YOUR-DOMAIN/host` and enter your `ADMIN_KEY`. If the page loads, the server is up.
2. In Railway, check that the service has `OPENAI_API_KEY`, `ADMIN_KEY`, the VAPID keys, and a volume mounted at `/data`
   (see `DEPLOY.md`).
3. Railway runs whatever is on `main`. Don't merge anything during the game, because a deploy restarts the server.

### Option B: run it from your laptop

```bash
npm install
cp .env.example .env     # only if you don't have a .env yet
```

In `.env`, set at least:

- `OPENAI_API_KEY`
- `ADMIN_KEY`: any long random string
- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`: run `npm run vapid` and paste both. Without them, phones can't get
  alerts and players miss calls whenever the app isn't on screen.

Then, in two terminals:

```bash
ngrok http 5050          # copy the host it prints, e.g. abcd-1234.ngrok-free.app
```

Put that host in `.env` as `PUBLIC_HOST=abcd-1234.ngrok-free.app` (no `https://`). Then start the server:

```bash
npm start
```

The log should show:

```
OpenAI key: OK
Blackwood Line server listening on :5050 (voice model gpt-realtime-2.1-mini, text model gpt-4.1-mini)
```

If it says `OpenAI key problem`, fix the key or the billing before you invite anyone.

Laptop rules for the night:

- **Use `npm start`, not `npm run dev`.** Dev mode restarts the server whenever a file changes, which drops live calls
  and ringing phones.
- Keep the laptop plugged in, awake, and on the same Wi-Fi all night. Don't close either terminal.
- **Keep ngrok running.** If it restarts with a new URL, every player link and every home-screen app breaks. To
  recover, update `PUBLIC_HOST`, restart the server, and resend each player their link from `/host`. Players then
  delete the old Blackwood icon and add the app again from the new link.
- On the free ngrok plan, players see an ngrok warning page the first time. Tell them to tap **Visit Site**.
- `PUBLIC_HOST` must be set. Without it, the invite link on `/host` points at `localhost` and won't work on anyone's
  phone.

### Optional: real audio for the 911 call, voicemail and reveal (2 min, about 2¢)

Only Dana's voice memo ships as audio. Run this once:

```bash
npm run evidence
```

It generates the 911 call, Ruth's voicemail and the midnight reveal. Without these files, the 911 call and the
voicemail arrive as text only, and the reveal runs as a live call for every player. Restart the server afterwards. On
Railway, commit the new files in `public/audio/` and push them to `main` **before** the game, not during it.

## 2. Solo smoke test (10 min, before anyone joins)

Test everything on your own phone first. Step 3 wipes this test player.

1. Open `/host`. Under **PLAYERS**, add `Test`, tap **Copy link**, and open the link on your phone in Safari or
   Chrome.
2. Instead of the game, you should see **Put the line on your home screen**. Follow its steps, then open **Blackwood**
   from your home screen. (A laptop skips this screen.)
3. Tap the power button. The intro video plays, then the boot screen, then a **"Your role is sealed"** card, then the
   field guide. That card is correct: roles are dealt when the game starts.
4. On `/host`, under **STORY BEATS**, tap **clues** twice (once to arm it, once to send it). A clue lands on The Line,
   and Ruth appears as a contact.
5. **Text Ruth.** A reply in a few seconds means the text model works.
6. **Call Ruth** with ☎ CALL. Allow the microphone, talk for 20 seconds, and hang up. Hearing her means voice works.
7. **Alerts:** tap MENU (bottom right), then **Turn on alerts**. Lock the phone, then send the **welcome** beat from
   `/host`. A notification should appear.

If you can, repeat steps 1–3 on one iPhone and one Android phone. Delete the test icon from your home screen
afterwards, because it opens the test player, not you. If a step fails, see step 6.

## 3. Open the lobby (10 min)

1. On `/host`, go to **AUTO MODE**, pick **Play now · about 75 minutes**, and tap **New game**. Confirm the reset: this
   wipes the test player and creates a fresh invite.
2. Decide who the **organizer** is. **The first person to join gets the START button.** If you're playing, join first
   yourself. If you'd rather keep control, start the game from `/host` with **Start now** instead.
3. Tap **Copy** next to the invite link and send it to the group chat with this message:

   > Tonight's game: LINK
   > Open it on your phone in **Safari** (iPhone) or **Chrome** (Android), not inside Instagram or Messenger. Type your
   > first name and tap ANSWER THE LINE.
   > It then asks you to **add Blackwood to your home screen**. Follow the steps and open Blackwood from your home
   > screen: the game only runs from there.
   > In the app, tap MENU → **Turn on alerts**, and allow the **microphone** when asked, because that's how you talk to
   > the characters. Sound on, headphones if you have them.

4. Watch the names appear on `/host` and on every phone's lobby screen. The rules:
   - Names must be unique. "ana" and "Ana" count as the same name.
   - 3 to 8 players. Until there are 3, the organizer sees **NEED N MORE**.
   - Joiners see "Your role is sealed" until the game starts. That's expected.
   - Names appear as soon as someone joins, before they've added the app. Before Start, check that everyone is in
     Blackwood from their home screen. The organizer only sees START THE GAME inside the app.
5. When everyone is in, **the organizer taps START THE GAME.** Every phone plays a short ring and the role cards appear.

After Start, **the invite link stops working.** Late arrivals have to be added by hand (see step 6).

## 4. What happens when (Play now)

Times are minutes after Start. The server checks for due beats every 15 seconds, so each beat can land up to 15
seconds late.

| Time | Beat | What players see | What to watch for |
|---|---|---|---|
| 0:00 | setup | Role card: Detective, or Accomplice (4+ players only) | Everyone saw a card |
| 0:12 | accomplice | The accomplice gets secret orders on The Line | Nothing visible to others |
| 0:30 | intro | The story arrives on The Line | |
| 1:00 | calls | The Caretaker rings each phone, 15 seconds apart. About 75 seconds after their ring, each player gets their starting clue and Ruth as a contact. | Unanswered rings become a missed call after 40 seconds. Missed Caretaker calls can't be returned, but the clue still arrives. With 8 players, the last clue lands around 4:00. |
| 20 | cast | Every suspect's number, for everyone | Players who were stuck can now reach everyone |
| 25 | memo | Dana's voice memo (audio) | |
| 33 | ruthWarning | Ruth calls whoever talked most about the cellar. A voicemail if they miss it. | One player only |
| 42 | twist | The anonymous 911 call | |
| 44 | planted | Planted evidence for the accomplice | Accomplice only |
| 52 | caretakerHint | The Caretaker calls everyone with a hint, 20 seconds apart | |
| 62 | votesOpen | "One hour left. Open the VOTE tab" | The vote count climbing on `/host` |
| 74 | lineRinging | "The line is ringing." | |
| 75 | reveal | Every phone rings at once with the Caretaker's reveal. About 75 seconds later: CASE CLOSED, the results, and **The End** with each player's recap. | Voting closes the moment the reveal starts |

With 3 players, the accomplice and planted beats are skipped. The votesOpen message says "one hour left", but in this
mode voting closes 13 minutes later at the reveal, so give the group a time check out loud.

Call limits: the Caretaker hangs up within 2 minutes and suspects within 4. A call with 45 seconds of silence ends on
its own. Each player can be on one call at a time.

## 5. Your job during the game

- **Keep `/host` open.** It shows the next beat, votes in, and each player's contacts and secrets found.
- **If you're playing, don't tap Show roles.** The vote tally hides the accomplice unless roles are shown.
- **Spend so far:**
  - On a laptop: `npm run admin -- usage`
  - On Railway: `ADMIN_BASE_URL=https://YOUR-DOMAIN ADMIN_KEY=... npm run admin -- usage`
- **Don't fire beats by hand in auto mode** unless you mean to. A beat you fire by hand still fires again later on
  schedule. To take over pacing, tap **SCHEDULE → Clear upcoming** first, then fire the remaining beats yourself in
  the order of the table above.
- **Never tap New game or Reset mid-game.** Both wipe every player, message and vote.

## 6. When something goes wrong

| Symptom | Fix |
|---|---|
| "This invite has expired." | A newer game exists, because New game makes a new code. Copy the current invite from `/host`. |
| "This game has already started." | Add them on `/host` under PLAYERS, then **Copy link**. They play as a detective, but get no starting clue and their role card stays sealed. Pair them with someone; the `cast` beat at 20 min gives them every number. |
| "Someone already took that name." | Use a different name or add an initial. |
| A player closed the tab or lost their link | If they added the app, the Blackwood icon on their home screen still works. Otherwise the invite won't get them back in, because their name is taken. Send their own link from `/host` (**Copy link** next to their name). |
| Stuck on **Put the line on your home screen** | That screen appears whenever the link is open in a browser tab on a phone. They need to tap the **Blackwood** icon on their home screen instead. If the icon itself opens a browser tab (an Android shortcut rather than an app), they delete it and add it again with **ADD TO HOME SCREEN** or ⋮ → **Install app**. If someone still can't get in, set `REQUIRE_INSTALL=off` and restart: phones can then play in a browser tab, but iPhones get no alerts there. |
| A phone never rang | The app has to be open, or alerts on. Missed calls show up under Calls. |
| "This browser can't use the microphone." | They opened the link inside another app. Copy it into Safari or Chrome. If they denied the mic earlier, re-allow it in the browser's site settings and reload. |
| "The call didn't connect. Try again." | Check the server log. Usually it's the OpenAI key or billing. If calls keep failing, set `CONTEXT_MODE=legacy` and restart (see the checklist). |
| "All lines are busy." | More than 25 live calls at once (`MAX_CONCURRENT_CALLS`). This shouldn't happen with 8 or fewer players. |
| "The line is dead for tonight." | The player used all 30 calls (`MAX_CALLS_PER_PLAYER`). Raise it and restart; restarting also resets the count. |
| "The line has gone quiet for tonight." | The player sent 150 texts (`MAX_TEXTS_PER_PLAYER`). Raise it and restart. |
| Characters get cut off by background noise | Set `REALTIME_BARGE_IN_MS=700` and restart. If it's the other way round (characters are hard to interrupt), use `350`. |
| Loud room | Players turn on MENU → **Captions on calls**. |
| "ok" or "thanks" gets no reply | By design. Don't tell testers in advance; it's one of the debrief questions. |
| Texts get no reply at all | Check the server log for OpenAI errors (key, billing, or rate limits). |
| Server crashed or restarted | Run `npm start` again. Players, messages and the schedule are saved in `data/`. Beats that came due while the server was down all fire within 15 seconds of the restart. Calls in progress drop. |
| The group wants to end early | **Clear upcoming**, then fire **votesOpen**, give people a few minutes, then fire **reveal**. |
| The group needs more time | **Clear upcoming**, then fire the remaining beats by hand when the room is ready. |

## 7. After the game (10–15 min)

1. Give everyone a minute in **The End**: their score, rank, the secrets they found, and a share card.
2. **Debrief out loud while it's fresh**, and write the answers down:
   - Where were you confused about what to do next?
   - Which character felt most real? Did any feel off (personality, delivery, revealing too much or too little)?
   - Did a character cut you off, talk over you, or ignore you?
   - Did anyone notice that texting "ok" or "thanks" gets no reply? Did it bother you?
   - Did calls ring at bad moments? Did you miss any? Were alerts reliable?
   - Was 75 minutes right? Where did it drag, and where did it rush?
   - Detectives: did you suspect the accomplice, and why? Accomplice: was it fun, and was the planted evidence
     useful?
   - Would you play the two-night version?
3. **Cost:** run `npm run usage` on a laptop, or `npm run admin -- usage` against Railway. To check the ledger against
   your bill, see `docs/PLAYTEST_CHECKLIST.md`, section "After".
4. **Keep the data.** Copy the `data/` folder somewhere safe before the next `New game` wipes it.
   - `data/game.json` holds every message players sent. Keep it within the group.
   - `data/usage.jsonl` has no dialogue, so it's safe to share for tuning.
5. **Tune.** If the pacing felt off, adjust the minutes for `quick` in `src/modes.js`. Nothing else needs to change.
