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

## During

- **Spend so far:** `npm run admin -- usage`.
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

`data/usage.jsonl` contains no dialogue, so it is safe to share for tuning.

Every rollback switch is listed in `docs/COST_REPORT.md` §9.
