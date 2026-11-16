# Mind Palace agents

The agent system behind the mindstorm. You drop things in, and they go into your knowledge base. Agents hang a dump under a card only when it plainly belongs there, start a tree when you ask ("make a tree about …"), bring picks around a card when you talk about it (what you already have that fits, and new content, at most ten, the least related making room), follow what you say, choose how each card is drawn, and package handoffs.

It is a TypeScript service. Clients are thin. The web client in `client/` runs in any browser, including the Quest browser. The Vision Pro adapter, `visionos/MindPalace/Ocean/Agent/`, is not on this line (DECISIONS 40).

## Run it

```bash
cd agents
npm install
npm start
```

It prints an address such as `http://localhost:8787/#token=…`. Open it. Type a thought into the box and press Add. It goes into your knowledge base. To grow a tree, type "make a tree about …", or add "start a tree on this" to what you drop.

To talk without pressing anything, run `npm run fetch-wake` once. It builds the listener for the web client (git, cmake and make, about 2 GB free while it builds, several minutes). Then press the microphone once and say "hey Momo" or "hi Momo", then what you want. The page listens for the name on your device and sends only what follows it. Rename the agent in Settings. Without the listener the microphone records once per tap.

Keys are read from `~/.muse-garden.env`. `MODEL_API_KEY` is required. Optional keys switch sources on: `YOUTUBE_API_KEY` (direct video search), `TMDB_API_KEY` (film and television), `EUROPEANA_API_KEY` (European museums and archives), `UNSPLASH_ACCESS_KEY` (photographs from Unsplash), `GUARDIAN_API_KEY` (news), `FAL_KEY` (pictures made on fal's Muse Image instead of the Meta API's muse-image-1.0, which stays the fallback; `MIND_PALACE_FAL_MODEL` names another fal model, or `off`; DECISIONS 63), `OPENAI_API_KEY` (a faster web search, model set by `MIND_PALACE_SEARCH_MODEL`, default `gpt-5.4-mini`, a spoken voice for replies, set by `MIND_PALACE_VOICE`, default `marin`, and speech recognition told your card titles, model set by `MIND_PALACE_HEARING_MODEL`, default `gpt-4o-transcribe`), and `META_IG_TOKEN` with `META_IG_USER_ID` (Instagram: with a list of accounts at `MIND_PALACE_INSTAGRAM_LIST`, the Scout also searches their posts; see the settings below). Nothing is copied into the repo. Your mindstorm is saved in `agents/data/`.

To try the client with no model and no cost: `npm run dev:fake`.

## Reach it from Telegram

Mind Palace can be a Telegram contact. Anything you send or share to it goes into your mindstorm, from any phone or computer with Telegram. Every handoff comes back to the chat as one Markdown file you can share into any agent app.

1. **Make the bot, once.** In Telegram, open @BotFather and send `/newbot`. Give it a name and a username that ends in `bot`. BotFather answers with the bot's token.
2. **Give the service the token.** Add `TELEGRAM_BOT_TOKEN=<the token>` to `~/.muse-garden.env` and restart the service. Its log says `[telegram] reading messages for @<your bot>`.
3. **Pair, once.** On the web page open Settings, press Pair under Telegram, then Open in Telegram, and press Start. The link works once, for 10 minutes. Telegram brings the chat to every device signed in to that account, so one device is enough. Unpair is in the same place.

Then:

- Send a thought, a link, a photo, a video, a file or a voice note. What you write with it is the instruction: "start a tree on this" grows a tree from it. Mind Palace answers with what it added and where it went, a tree or your knowledge base.
- A voice note is written out by `OPENAI_API_KEY`'s transcription model, and its words are added. Without that key the recording itself is added.
- Every handoff the service makes (Handoff on the web page, or asking for one, as "hand this off" on the headset) comes to the chat as a message and one file, `<tree>-handoff-<date>.md`. It names no other file: each picture is described in words, with the address it came from. Share it into Claude, ChatGPT, Muse or any agent that takes a file. `/handoff` or "send me the handoff" sends the latest again.

Limits:

- A bot can take files up to 20 MB. Drop larger ones on the web page.
- Only the paired Telegram account is heard. Anyone else who finds the bot gets no reply.
- Only one program may read a bot's messages at a time. A second one is told so by Telegram and waits, and its log says so once. `npm run dev:fake` leaves the bot alone.
- Telegram's chats with bots are not end-to-end encrypted.
- The service reads the bot by asking Telegram for new messages, so your Mac needs no public address.

To add the headset's library (its films, works, notes, tags and saved trees), stop the service and run `npm run import-library`. It reads `visionos/MindPalace/Resources/ocean.json`, `public/clips` and `public/works`, works offline, and took 19 s on this Mac. It refuses while the service runs on the same data folder, because the service would write over it. A second run adds nothing. Set `MIND_PALACE_DATA` to import into another data folder. The works' pictures are turned into JPEGs with `sips`, so on a machine that is not a Mac they come in as text cards. The films play from `public/clips/full`, so keep the repository where it was when you imported.

If `ocean.json`'s saved trees change, run `npm run saved-trees` before importing. It builds a small program against `quest/core` with `clang++` and records how the Quest app hangs each saved tree's steps in `src/node/library-saved.json`.

| Setting | Default | Meaning |
|---|---|---|
| `MIND_PALACE_PORT` | 8787 | Port for HTTP and WebSocket. |
| `MIND_PALACE_TOKEN` | generated, saved in `data/token` | The access key every client must send. |
| `MIND_PALACE_DATA` | `agents/data` | Where the mindstorm and files are kept. |
| `MUSE_LLM_MODEL` | `muse-spark-1.3` | The model for thinking of directions (each started as it is written), grouping siblings, and every role not on the quick model. |
| `MIND_PALACE_QUICK_MODEL` | `muse-ember-1.0` | The model for what you wait on: the Conductor's reply, the suggested questions under an open card, rating ties to what you have, choosing the catalogues and words of the Scout's fast lane, choosing among what a search returned, and the card a note you drop in lands as. |
| `MIND_PALACE_TOKEN_BUDGET` | 5,000,000 | Tokens the service may spend before it refuses model calls. Restart to reset. Hosted, 180,000,000 a day (20 headsets at their 9M share), counted again at midnight Pacific. |
| `MIND_PALACE_ENV` | `~/.muse-garden.env` | The file keys are read from. |
| `MIND_PALACE_MAPS` | unset, maps off | A map provider: `openstreetmap`. With it set, a place a note names is looked up on that provider's server, which sends the place's name off this machine, and place cards draw a map from its tiles. Unset, nothing about a place leaves the machine. Lookups are kept in `data/places.json`. |
| `TELEGRAM_BOT_TOKEN` | unset | The bot that makes Mind Palace a Telegram contact. See Reach it from Telegram. |
| `MIND_PALACE_LIVE` | on with `OPENAI_API_KEY` | `off` turns Momo's live voice (`/live`) off; clients then record, transcribe and hear replies read aloud. |
| `MIND_PALACE_LIVE_MODEL` | `gpt-realtime-2.1` | The realtime model that is Momo's live voice. `gpt-realtime-2.1-mini` costs a third as much. See DECISIONS 59. |
| `MIND_PALACE_LIVE_TURN` | `semantic` | How the live voice hears that you are done: `semantic`, or `server:<ms>` for a pause of that many milliseconds. |
| `MIND_PALACE_LIVE_PAUSE` | 1800 | Milliseconds of quiet after your last word that end your turn when the turn detection has not. 1200 answers sooner and cuts a request said with a thinking pause. |
| `MIND_PALACE_LIVE_EFFORT` | `minimal` | How hard the realtime model thinks before it answers. |
| `MIND_PALACE_WEB_MODEL` | `gpt-5.4-mini` | The model behind Momo's quick web answers. |
| `MIND_PALACE_INSTAGRAM_LIST` | `~/.mind-palace/instagram-following.md` | Your chosen Instagram accounts, one per line as `- @handle — Name — what it is — address` under `### Category` headings. With `META_IG_TOKEN` and `META_IG_USER_ID`, the service reads each account's newest 25 posts in the background into `data/instagram/`, paced by the usage Instagram reports, each account again about every two days, and the Scout searches them there. `node --no-warnings --import tsx scripts/instagram.ts report <data folder>` says what it holds. Without the file, Instagram is left out. |
| `MIND_PALACE_INSTAGRAM_READ` | on | `off` searches what `data/instagram/` holds without reading Instagram, for a copy of the service. |
| `MIND_PALACE_WEB_EFFORT` | `low` | How hard it thinks. `none` answers about 0.5 s sooner and dated a launch wrong more often. |

## The walkthrough demo

`npm run demo` runs the service with one prepared tree, played round by round for recording the film: Momo is live, what the Scout brings is scripted, and a page at `/demo` goes to any round. It keeps its own data folder, `data-demo`. See [demo/README.md](demo/README.md).

## Check it

```bash
npm test                 # 497 tests on scripted models and the client's card sizes, no network
npx tsc --noEmit
node --no-warnings --import tsx test/client.e2e.ts   # the web client in a real browser, 46 checks
npm run scenario         # everything against the live model, 28 checks, about 160,000 tokens
MIND_PALACE_DATA=<a copy of a data folder> node --no-warnings --import tsx scripts/mindstorm-check.ts "<a thought>" "<a subject>"
                         # drops a thought and asks for a tree on a copy of a mindstorm, and prints the round, live
node --no-warnings --import tsx scripts/live-bench.ts --data <a copy of a data folder> --out <file.jsonl>
                         # Momo's live voice on the 40 requests of scripts/live-requests.ts, said into files, never played:
                         # which way it answered, how soon it was first heard, what it cost; about $0.65 on mini, $1.45 on the full model;
                         # --set intent: the 30 tree-or-layer requests, each said where it is set (a card open, a tree, nothing)
node --no-warnings --import tsx scripts/typed-bench.ts --data <a copy of a data folder> --runs 3
                         # the same 30 typed, through the Conductor, on the Meta key: right of N per group, the questions asked back
node --no-warnings --import tsx scripts/live-summary.ts <file.jsonl>   # the same against the voice plan's targets
node --no-warnings --import tsx scripts/live-samples.ts --data <a copy of a data folder> --out <dir> --voice marin
                         # three sample conversations with Momo as audio files and transcripts, never played
```

## The roles

You talk to one voice. Content roles decide what exists. The Renderer decides how it looks.

| Role | Job | File |
|---|---|---|
| Momo, the live voice | Holds the spoken conversation on the headset: answers from what it knows, with a quick web answer, or from what you saved, and starts new cards, a tree, more, keep, undo, going to a card, organizing and handoffs through the pipeline's own moves. It walks you through the cards a run brings as they land. | `src/node/live.ts`, `src/core/voice-tools.ts`, `src/node/web-answer.ts` |
| Conductor | Hears each typed or Telegram utterance with what you are looking at, and routes it: ask, more, navigate, organize, handoff, capture, tree, keep, undo. "Make a tree about …" and "start a tree on this" need no model call. When what you asked for lands, the agent says what came and brings the card into view. | `src/core/roles/conductor.ts`, `src/core/tree-request.ts` |
| Intake | Turns a dump into items: text, links, pictures, video, files, and chat exports from ChatGPT, Claude, Muse or a pasted transcript. | `src/core/roles/intake.ts` |
| Filer | Every dump joins the knowledge base. The Filer hangs an item under a card of a tree, as a pick, only when it plainly belongs there. It starts a tree only when the dump or the user asks for one. | `src/core/roles/filer.ts` |
| Scout | Works out what a card is and what you are doing with it, then extends it in several different directions. Each comes back as content shown in place: a written idea in the card that shows it best, written whole in the same reply (a note, steps, a list, facts, a quote, a table, a question and its answer, a definition, pros and cons, or a warning set apart), a generated picture or set, a video that plays in the card, or real material found in a source that suits the subject. Sources: the web (the page is read and the passage shown), research papers, books (Apple Books), world data as charts, Hacker News threads, GitHub projects, Stack Overflow, museum collections, Wikimedia Commons, Are.na, podcasts, recipes, the Internet Archive (films that play as a file), and with their keys news (The Guardian), film and television (TMDB), Europeana and Unsplash, and with the Instagram connection and a list, posts from the accounts you chose, kept on this machine (DECISIONS 64). It looks at a dropped picture itself. Never a bare link. Its first cards come from a fast lane: the quick model names two or three catalogues and what to search in each, and their best records land within seconds, while the main model is still thinking of its directions. Each lane holds a place for its first thing to look at, a picture found or made or a video, so written ideas never fill every place first. Every round also draws on everything you already have (dumps, cards of other trees, the headset's library) and brings what is strongly tied, the strongest first, up to 8 of the 10 places around a card. Nothing repeats inside a tree. | `src/core/roles/scout.ts`, `src/core/round.ts`, `src/node/sources.ts` |
| Organizer | Moves, groups, renames, merges, splits and deletes on request, as one undoable step. | `src/core/roles/organizer.ts` |
| Renderer | Picks a component for each card and a composite for groups of cards. Never invents data. | `src/core/roles/renderer.ts` |
| Archivist | Plain code. Keeps the change log, the search index and each tree's digest current. | `src/core/pipeline.ts`, `src/core/state.ts` |
| Packager | Writes a handoff bundle another agent can pick up cold. | `src/core/roles/packager.ts` |
| Questions | Suggests two to four short things to ask about the card you open, from the card, where it stands, the cards round it and the conversation. A client shows them under the card, and picking one asks it. | `src/core/roles/questions.ts` |

`src/core/pipeline.ts` runs the roles and is the only place their commands are applied.

## How it is built

- **`src/core/`** is the agent core: the data shape (`domain.ts`), the mindstorm with undo (`state.ts`), search (`search.ts`), the component and composite libraries (`views.ts`), the roles and the pipeline. It uses nothing that only Node has, and a test enforces that, so it can later move onto a headset.
- **`src/node/`** is the host for a Mac or a server: the model client, tools, files on disk, SQLite, and the HTTP and WebSocket server.
- **`client/`** is the web client. No build step.
- **`src/node/contact.ts`** is where a contact plugs in: what it hands the service and how a handoff is delivered. `src/node/telegram.ts` is the Telegram contact.
- **`docs/protocol.md`** is the contract every client follows. `docs/libraries.md` documents the components and composites. `docs/handoff-format.md` documents the handoff bundle. `docs/ocean-adapter.md` covers the Vision Pro adapter.
- **`DECISIONS.md`** records each call made while building this, with the reason and the alternative.

## Connecting a headset

- **Quest, at your desk.** Put the Quest in developer mode, plug it in, and run `adb reverse tcp:8787 tcp:8787`. Open `http://localhost:8787/#token=…` in the Quest browser. `localhost` counts as a secure page, so the microphone is allowed.
- **Quest, untethered.** Run a tunnel such as `cloudflared tunnel --url http://localhost:8787` and open its HTTPS address with the same `#token=…`.
- **Quest app.** The native app in `quest/` is a client of the same protocol. It tells the service it cannot show embedded players (`{t: 'client', media: {embeds: false, ...}}`), and while it is connected the Scout looks for videos as files the service streams.
- **Vision Pro.** The Ocean adapter is not on this line (DECISIONS 40). `docs/ocean-adapter.md` describes it as it was.

Over plain `http://` on a local network address, browsers refuse the microphone. Typing still works.

## Hosted for judging

One service for many headsets, on Fly.io in San Jose. Each headset gets its own space: a mindstorm, a pipeline and a live voice in `spaces/<device>` on the volume. A new space starts as a copy of `starter/`. Every space shares the model, its one Meta rate window, the keys and the maps. `MIND_PALACE_HOSTED=1` switches it on, with `MIND_PALACE_APP_KEY` and `MIND_PALACE_ADMIN_TOKEN`. `docs/protocol.md` says how a device connects.

- **Telegram.** It only sends spend alerts to the chat the user paired. It never reads the bot, since the user's Mac does.
- **Limits.** A device gets 60 minutes of voice with Momo (both ways), 30 searches and 30 web answers a day, and a share of the day's spend ($23, the most its own limits allow) and of Meta's tokens (9M), past which its own costly work stops with "today's limit" and everyone else's goes on. There is no total daily cap unless `MIND_PALACE_CAP_DOLLARS` sets one (fly.toml sets 0, none), so the bounds are each device's limits and shares, at most 20 devices and the off switch: at worst 20 × $23 = $460 a day. The paired Telegram chat hears when the day's spend passes $25, $50, $100 and every $100 after. What a user says or types to Momo is at most 4,000 characters. The day is Pacific time. The counts are in `/data/ledger.json`, so a redeploy keeps them. fly.toml sets each limit. The spend counts what the service measures in dollars: the realtime voice, its transcription, web answers, and the overflow to OpenAI. Meta's tokens have no listed price, so they count as $0 unless `MIND_PALACE_META_PRICE` gives dollars per million.
- **Overflow.** While Meta's minute is full, the Scout's calls go to OpenAI instead of waiting: gpt-5.4 for its directions, gpt-5.4-mini for its quick calls and searches (`src/node/hosted/overflow.ts`). Each one is logged as `[overflow]`. `MIND_PALACE_OVERFLOW=off` turns it off.
- **Every check reads the path decoded and normalized**, as a space does, and speech, transcription and the voice are metered inside their handlers, so no spelling of a path gets past a limit.
- **Instagram.** The service opens one library of the user's accounts, in `/data/instagram`, and every space searches it through a view of its own, each picture copied into that space's assets. No space opens or reads its own. The server does not read Instagram itself, since its pictures are made small with macOS's `sips`: `deploy/instagram.sh` copies the list and the Mac's library to the volume, never into git or the image, and restarts the machine. So the server holds no Instagram account: it opens the library from the list alone, and `deploy/secrets.sh` sends neither `META_IG_TOKEN` nor `META_IG_USER_ID`, and takes them off Fly if an earlier release left them there. `MIND_PALACE_INSTAGRAM_READ=on` without them logs that nothing is read and searches the library as it is.
- **Idle spaces** close after 20 quiet minutes and open again on the next request.
- **Against a script with the app's key.** At most 20 spaces, and 10 new devices an hour, near the number of judges, since the app's key is in the APK and one person could make many devices. A file upload is at most 25 MB, and one device's uploads 40 MB in all. Everything a device writes, its messages and Momo's tools alike, stops once its mindstorm and handoffs are 20 MB on disk, and one change stores at most 2.5 MB, so the limit is passed by at most that. A card's edits come to at most 512 KB, and a socket message is at most 1 MB. The pictures the service keeps for a device (fetched, made, copied from Instagram) come to 60 MB at most; past that, a picture is not kept and its card is left out, and uploads have their own 40 MB. While the volume has under 300 MB free, no upload, change or new space is taken, and what is there still opens. A device keeps two `/live` sockets; a third closes the oldest. The voice limit, the cap and the off switch are checked on every piece of audio, so a turn or an answer under way stops too.
- **Status and the off switch.** `GET /admin` with `Authorization: Bearer <admin token>` gives every device by its full id, the devices online, the day's spend and use, and the recent errors. `POST /admin?off=1` stops all costly work, and `?off=0` starts it again. Trees stay browsable while it is off. `DELETE /admin/spaces/<device>` deletes a space and its folder.

| Step | Command, from `agents/` |
|---|---|
| Starter trees | `npm run starter -- --from <copy of a data folder>`: the 3 trees with the most kept cards. `--list` ranks them; `--tree <id>` picks them. |
| First deploy | `deploy/setup.sh`: the app, its volume, the secrets, then the service. |
| Secrets | `deploy/secrets.sh`: keys through `loadEnv`, piped into `fly secrets import`, never printed. The Instagram account is never sent. |
| Redeploy | `deploy/deploy.sh`: typecheck, the hosted test, `fly deploy --remote-only`, a health check, with fly.toml's judging limits. `deploy/deploy.sh testing` deploys with no per-headset daily limits (`deploy/testing.env`), and `deploy/deploy.sh judging` goes back. `/admin` says which (`mode`) and gives every limit. |
| Roll back | `deploy/rollback.sh` lists the images; `deploy/rollback.sh <image>` runs one again. |
| Back up | `deploy/backup.sh`: a volume snapshot on Fly and a copy in `~/.mind-palace/backups`. |
| Status, off, on | `deploy/admin.sh status`, `deploy/admin.sh off`, `deploy/admin.sh on`. |
| Instagram | `deploy/instagram.sh`: the list and the Mac's library onto the volume, then a restart. |
| Load test | `npm run judges -- --url <service> --judges 10`: N voice-free sessions that open, ask, search and open a card. |

To run it locally in hosted mode: `MIND_PALACE_HOSTED=1 MIND_PALACE_APP_KEY=k MIND_PALACE_ADMIN_TOKEN=a MIND_PALACE_DATA=<scratch folder> MIND_PALACE_PORT=8899 npm run dev:fake`.

## Not verified

- The Telegram contact has not reached Telegram itself. It was checked against a stand-in for the Bot API (`test/fake-bot.ts`).
- Nothing has run on a Quest or a Vision Pro.
- The microphone, live speech recognition and spoken replies in the web client have not been exercised. Speech-to-text through the service was checked once with a synthesized recording.
- The wake phrase was measured on synthetic voices and a fake microphone only (DECISIONS.md 38).
- The Ocean adapter was typechecked against an older visionOS SDK and exercised on macOS. It has not been built for visionOS 26.
- No headset has sent the `client` message. The Scout's choice for a headset was seen live once, through `scripts/scout-probe.ts` with `NO_EMBEDS=1`: one of two Internet Archive finds fit and came as a film that plays from the service. Streaming through the service was checked live on another archive film and a podcast episode, not on that pick.
- The library import ran into a temporary data folder, never into `agents/data`.
- The knowledge base was checked live once, on a copy of a real mindstorm (`scripts/mindstorm-check.ts`). The Quest app and the Ocean adapter do not show items that no tree holds yet.
- Reading your Instagram posts and reading a web page were each checked live once. Image generation was seen live in a pick. Video understanding and code sketches are written and unit-tested but were not triggered in a live run.
