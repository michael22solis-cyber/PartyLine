# PartyLine: the plan

PartyLine turns your friends' phones into burner phones for one night. AI characters text and call them; they
interrogate suspects, share evidence, suspect each other, vote, and get a reveal. **The Blackwood Line** is the first
case.

Think of it as a TV show. **PartyLine is the show; each case is an episode**: a self-contained story you play in one
evening (about 75 minutes) with 3–8 friends. Every episode shares the show's format, so a group that has played one
knows how the next works, but the story, the people and the twist are new.

## 1. The show and the episode

| The show (the same in every episode) | The episode (new every time) |
|---|---|
| The burner phone: Messages, Calls, Evidence, Notebook, Vote, The End | The world: the setting, the victim, the public story |
| Joining: invite link, lobby, the organizer starts, the home-screen app | The truth: who did it, how and when (never sent to a phone) |
| The night's shape: setup, first calls, clue drops, a twist, votes, a final call | The cast: 3–5 suspects with personalities, cover stories, voices and faces |
| The rules engine: a locked secret opens only when a player asks the right thing | The secrets: what each suspect hides and what makes them talk |
| Live calls and texts, one shared memory, busy statuses, characters texting first | Starting clues, evidence drops, the twist, the timeline of the night |
| The accomplice, secret agendas, hints, scoring, ranks and the recap | The accomplice's orders and planted evidence, the agenda secrets |
| Cost caps, safety (988, every character disclosed as AI), host controls | Art, recordings, music, the phone's look |

### What makes them episodes, not separate games

- **The Line is the host.** In Blackwood, The Line is the Caretaker's ghost. In PartyLine it becomes the show's
  recurring voice: it rings to open every episode ("The line has a new case for you") and closes it. An episode can give
  it a face, but it is always the same show.
- **Your crew carries over.** A group that plays together keeps its name and its record: cases solved, who was the
  accomplice, who got away with it.
- **A detective record for each player.** Scores and ranks add up across episodes: "Lead Detective · 3 cases".
- **"Next time on PartyLine."** The End shows a short teaser for the next episode.
- **Seasons.** Episodes stand alone first. Later, a season can share a thread: a recurring character, or a mystery
  that only resolves in the finale.

## 2. The episode pack

One folder per episode. The engine reads it, so a new story is a new folder, not new code.

```
episodes/
  blackwood/
    episode.js     the story: meta, world, cast, secrets, clues, beats, timeline, recap
    media/         portraits, evidence art, recordings, music, the intro video
```

The pack has a public part (what phones may see: names, bios, the case file, art) and a private part (the truth,
the secrets, who the killer is). The loader only ever hands the public part to the phone.

**Secrets become data, not code.** Today a secret's triggers are regular expressions and small functions inside
`src/secrets.js`. In a pack they are lists of patterns, so an AI can write them and a checker can test them:

```js
{
  id: 'bingo', who: 'teddy', label: 'Bingo ends at 8:30, not 10',
  topic: 'St. Agnes bingo (you know its schedule)',              // what the character is told before approval
  ask: ['bingo', 'st\\.? ?agnes', 'saint agnes', '\\bchurch\\b'],  // what the player has to bring up
  fact: 'Thursday bingo at St. Agnes ends at 8:30 pm sharp; your tour walks past the church every week.',
  said: { any: ['8:30', 'eight[- ]thirty'] },                     // the character really said it: award the card
  card: 'Teddy says Thursday bingo at St. Agnes ends at 8:30 pm sharp. Not 10.',
}
```

**Beats: the show supplies the types, the episode the content.** A beat is one of a few kinds:
`broadcast` (a text, evidence or memo card to everyone, with optional audio), `ringAll` (a character calls everyone,
staggered), `ringOne` (a character calls one player picked by a rule, with a voicemail if they miss it), `deal`
(starting clues), `unlockAll`, `nudge`, `leak`, `accomplice`, `planted`, `votesOpen`, `lineRinging` and `reveal`.
Each episode writes its timetable once for the 75-minute night; the 15-minute test run and the 2-hour slow burn
scale it.

## 3. Making episodes: AI drafts, you approve

1. **Premise.** You write a line or two ("a wedding where the best man vanished").
2. **Outline.** The AI proposes the truth, the victim, four suspects with motives, and the night minute by minute with
   exact times. You pick one or tweak it.
3. **Draft.** The AI writes the whole episode pack.
4. **Checks, before you read a word:**
   - **Format:** the pack loads and every reference resolves (a clue names a suspect who exists, and so on).
   - **Consistency:** every character's story fits the truth and the timeline, and no two times contradict each other
     (like the memo's "this exact minute" fixed in Blackwood).
   - **Solvable:** an AI detective given everything players can earn (clues and secret cards) must name the killer and
     say why; given only the starting clues, it must not be able to. Every innocent suspect has an alibi a secret
     confirms, and a secret breaks the killer's.
   - **Reachable:** each secret's triggers come up naturally from a clue, a card or the story. No secret depends on a
     question nobody would think to ask.
   - **No leaks:** an AI red team texts and calls each character, trying to get locked secrets without asking the
     right thing.
   - **Robot playtest:** four AI players play the whole night against the real engine (like the robot playtest that
     found Blackwood's bugs, but asking real questions), reporting which secrets they found, when, and whether they
     solved it.
   - **Cost:** an estimate per game.
5. **Your review.** A studio page you read like a script: edit any line, regenerate a character or a secret, rerun
   the checks, approve.
6. **Media.** Portraits, evidence photos, recordings and music, made once and built into the episode.

## 4. What has to change in the engine

In the order they block:

1. **Episode packs.** Pull Blackwood's story out of the ~30 files it is woven through into `episodes/blackwood`.
   Blackwood must play exactly as before: the test suite, the full-night rehearsal and a robot playtest prove it.
2. **Many games at once.** Today a server runs one game: one set of players, one schedule, one memory
   (`src/store.js`). Every piece of game state gets a game id, and storage moves from a JSON file to a database
   (Supabase/Postgres). Needed before anyone but you can host.
3. **Hosts as accounts.** Sign up, start a game, pick an episode. Players still join with a link and a first name.
4. **Payments.** A price per game night (an episode costs about $1–5 in AI today) or a season pass.
5. **The studio:** the drafting pipeline and review page from section 3.
6. **App stores, later.** It stays a web app added to the home screen, which already works on iPhone and Android.
   A native wrapper comes later, for the stores and more reliable alerts.

## 5. Roadmap

- **Now until Halloween:** `blackwood-line` is the game-night build and only gets fixes. PartyLine work happens here
  and never deploys to Blackwood's Railway service.
- **Phase 1 · Episode packs (started):** the format, the loader, Blackwood moved in, the same game proven.
- **Phase 2 · Episode 2,** drafted with the AI pipeline as scripts (no studio page yet), to prove the format fits a
  different story.
- **Phase 3 · Many games at once,** and the database.
- **Phase 4 · The studio:** drafting, checks and the review page.
- **Phase 5 · The storefront:** play.partyline.app, host accounts, payments, the episode library.
- **Phase 6 · Native apps.**

## 6. Questions for you (none of them block Phase 1)

- **The host:** keep "The Line" as the show's recurring voice across episodes?
- **Episode 2:** what's the premise you most want to play?
- **Price:** per game night, or a season pass?
- **Rating:** keep every episode "scary, not gory, nothing sexual", like Blackwood?
