# Put Blackwood online (Railway)

Runs 24/7 at a permanent https link, so you don't need your laptop or ngrok on game night.

## One-time setup (about 15 minutes)

1. Sign up at **railway.com** with your GitHub account. The Hobby plan is about $5/month (check railway.com/pricing for current prices).
2. **New Project → Deploy from GitHub repo →** pick `blackwood-line` (branch `main`, once this branch is merged).
   Railway finds the `Dockerfile` and builds it.
3. **Add a volume** (so players and messages survive restarts): in the service, *Settings → Volumes → New Volume*, mount path **`/data`**.
4. **Variables** (service → *Variables*), copy these from your `.env`:
   - `OPENAI_API_KEY`
   - `ADMIN_KEY` (make it long; it unlocks the host page)
   - `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (push alerts)
   - Optional: `GAME_TZ_OFFSET` (default `-05:00`, Central), `TWILIO_*` / `CALL_MODE=phone` if you use real phone calls
   You don't need `PUBLIC_HOST` or `DATA_DIR`; they're set automatically.
5. **Get a public link:** *Settings → Networking → Generate Domain*. You'll get something like `blackwood-production.up.railway.app`.
   (Later you can add your own domain there, e.g. `play.partyline.app`.)
6. Open **`https://YOUR-DOMAIN/host`**, enter your `ADMIN_KEY`, and run the game from your phone.

## Running a game from the host page

- **Players:** add each friend, then *Copy link* / *Send*. Each link is that friend's private phone.
- **setup** once everyone has joined (picks the accomplice, deals clues).
- **Story beats:** tap once to arm, again to send. Or **Schedule Night 1 / Night 2** and it runs itself.
- **Votes** fill in live; **Show roles** reveals who the accomplice is (keep it hidden if you're playing).
- **Reset** wipes everything (type RESET).

## Updating

Push to `main` and Railway redeploys automatically. Game data stays on the `/data` volume.

## Notes

- The Twilio webhook (only for real phone calls) becomes `https://YOUR-DOMAIN/voice`.
- The intro video, fonts and audio ship inside the app; `intro/assets` and `audio-src` are left out of the build to keep it small.
- `ffmpeg-static` is a dev-only dependency (used by `npm run evidence` on your computer), so the server image doesn't download it.
