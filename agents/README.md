# The agent service

The agents behind Mind Forest. You drop things in and they go into your knowledge base. You ask about a card and agents bring new material round it: what you already have that fits, and new content from the web, museums, papers, film and more, at most ten cards a round. They start a tree when you ask for one, choose how each card is drawn, follow what you say, and package a tree as a handoff another agent can pick up.

It is a TypeScript service on Node.js 22. Clients are thin: they keep a copy of the state, draw it, and send what the user does. The headset app in [quest/](../quest/README.md) is the client that matters. A browser client in `client/` was used to develop the service and still runs.

In the code and settings the service is called Mind Palace, and the collection of everything you have is called the mindstorm.

## Run it

```bash
cd agents
npm install
npm start
```

It prints an address such as `http://localhost:8787/#token=…`. Open it in a browser. Type a thought into the box and press Add, and it goes into your knowledge base. To grow a tree, type "make a tree about …", or add "start a tree on this" to what you drop.

Keys are read from `~/.muse-garden.env`. `MODEL_API_KEY` is required. Optional keys switch sources on: `YOUTUBE_API_KEY` (direct video search), `TMDB_API_KEY` (film and television), `EUROPEANA_API_KEY` (European museums and archives), `UNSPLASH_ACCESS_KEY` (photographs from Unsplash), `GUARDIAN_API_KEY` (news), `FAL_KEY` (pictures made on fal's Muse Image instead of the Meta API's muse-image-1.0, which stays the fallback; `MIND_PALACE_FAL_MODEL` names another fal model, or `off`; DECISIONS 63), `OPENAI_API_KEY` (a faster web search, model set by `MIND_PALACE_SEARCH_MODEL`, default `gpt-5.4-mini`, a spoken voice for replies, set by `MIND_PALACE_VOICE`, default `marin`, and speech recognition told your card titles, model set by `MIND_PALACE_HEARING_MODEL`, default `gpt-4o-transcribe`), and `META_IG_TOKEN` with `META_IG_USER_ID` (Instagram: with a list of accounts at `MIND_PALACE_INSTAGRAM_LIST`, the Scout also searches their posts; see the settings below). Nothing is copied into the repo. Your mindstorm is saved in `agents/data/`.

To try it with no model and no cost, with scripted agents:

```bash
npm run dev:fake
```

To join a headset to it, see [quest/README.md](../quest/README.md): `quest/tools/agent.sh usb` carries the port over the cable and starts the app joined.

To talk without pressing anything, run `npm run fetch-wake` once. It builds the listener for the web client (git, cmake and make, about 2 GB free while it builds, several minutes). Then press the microphone once and say "hey Momo" or "hi Momo", then what you want. The page listens for the name on your device and sends only what follows it, with the second of sound it took for the name, which the service checks: the listener is set to miss the name seldom, so it also wakes on about one near miss in eight, and what was not the name is dropped before Momo acts (DECISIONS.md 70). Rename the agent in Settings. Without the listener the microphone records once per tap.

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

## Momo's live voice

On the headset you talk to Momo in real time. The code is `src/node/live.ts`, with Momo's tools in `src/core/voice-tools.ts` and who Momo is in `src/core/momo.ts`.

- **A realtime model is Momo.** The service holds one session with OpenAI's realtime model for each headset's `/live` socket and relays the audio both ways. The key stays on the service. `MIND_PALACE_LIVE_MODEL` names the model.
- **Momo answers in one of four ways:** from what it knows, with a quick web answer, from a search of what you saved, or by asking the Scout for new cards. Its other tools are the pipeline's own moves: start a tree, more like this, keep, undo, go to a card, organize, hand off, save a note, connect Telegram.
- **Momo walks you through the cards.** As the cards of a run land, the service tells the model in short notes: the first card at once, later ones gathered at most every 6 s, and a wrap-up when the run ends.
- **Your own words reach the Scout.** A run Momo starts is asked in the words you said, as transcribed, with Momo's phrasing beside them (DECISIONS 61).
- **Tree or layer.** Momo starts a tree only when you ask for a tree or a space of its own. When it cannot tell whether you want a new layer here or a new tree, it asks one short question and starts nothing.
- **Talking over Momo** cancels its response and cuts its words in the conversation where the client had played them to, so it knows what you heard.
- **The wake check.** The headset's keyword spotter also wakes on things that only sound like the name. The service transcribes the second of sound that woke it and drops the turn unless it holds "hey" or "hi" and the name (DECISIONS 70).
- **Without the live voice** (no OpenAI key, or `MIND_PALACE_LIVE=off`), a client records, posts the recording to `/api/transcribe`, the Conductor decides, and the reply is read aloud through `/api/speak`.

What you type, pick under a card or send over Telegram goes to the Conductor, not to the realtime model.

## The protocol

[docs/protocol.md](docs/protocol.md) is the contract every client follows.

- One port serves HTTP and WebSocket, 8787 by default. Every request carries the access token.
- `/ws` carries the state: a snapshot, then change sets over five maps (items, nodes, trees, links, groups). A client sends what the user does: `dump`, `utter`, `focus`, `ask`, `more`, `keep`, `undo`, `commands`, `organize`, `handoff`, `share`.
- `/live` carries Momo's voice, as above.
- A node's `view` says how to draw its card: one of 28 components, documented in [docs/libraries.md](docs/libraries.md). A card is made in the look it keeps. Only a note you drop in may show as composing for up to 12 s while the quick model chooses its look.
- Every change is applied in one place, `src/core/pipeline.ts`, so every change can be undone.
- [docs/handoff-format.md](docs/handoff-format.md) documents the handoff file.

## Telegram

The service can be a Telegram contact. Anything you send or share to it goes into your mindstorm, from any phone or computer with Telegram. Every handoff comes back to the chat as one Markdown file you can share into any agent app.

1. **Make the bot, once.** In Telegram, open @BotFather and send `/newbot`. Give it a name and a username that ends in `bot`. BotFather answers with the bot's token.
2. **Give the service the token.** Add `TELEGRAM_BOT_TOKEN=<the token>` to `~/.muse-garden.env` and restart the service. Its log says `[telegram] reading messages for @<your bot>`.
3. **Pair, once.** On the web page open Settings, press Pair under Telegram, then Open in Telegram, and press Start. The link works once, for 10 minutes. Telegram brings the chat to every device signed in to that account, so one device is enough. Unpair is in the same place.

Then:

- Talk to Momo. The bot is the same Momo as in the headset (`src/core/momo.ts` holds who Momo is for both), and Momo reads each message and decides what it is for (`src/node/momo-chat.ts`, one quick model call):
  - Talk is answered and nothing is kept: "who are you", "what have I saved about heat pumps?".
  - A thought is kept, with a word of Momo's own: "heat pumps work below freezing now".
  - A question worth keeping is answered, and kept with its answer: "why do heat pumps fail in the cold?".
  - When Momo can't tell, it asks ("want me to keep that, or were you just telling me?"), and your next message settles it.
- Momo's reply comes first, in about a second. Whenever something is kept, a second message says what was kept and where, a tree or your knowledge base, once it is filed (about ten seconds). A chat's messages are answered in order.
- A link, photo, video or file is always kept. Words sent with it that ask something are answered from what the service read of it; other words are kept beside it, and "start a tree on this" grows a tree from it.
- Momo knows your trees and finds your cards by the message's words, so it answers about what you saved. It cannot look at the web from Telegram, and it starts no search there.
- Momo remembers a chat's last six lines for 30 minutes, in memory. A restart forgets them, and the next message is read on its own.
- When the model does not answer, the message is kept as it was before Momo read them.
- Anyone else who writes to the bot gets one fixed line from Momo that says the bot is paired with someone else, at most 6 times in 10 minutes, and no model is asked.
- A voice note is written out by `OPENAI_API_KEY`'s transcription model, and its words are added. Without that key the recording itself is added.
- Every handoff the service makes (Handoff on the web page, or asking for one, as "hand this off" on the headset) comes to the chat as a message and one file, `<tree>-handoff-<date>.md`. It names no other file: each picture is described in words, with the address it came from. Share it into Claude, ChatGPT, Muse or any agent that takes a file. `/handoff` or "send me the handoff" sends the latest again.
- Ask about your trees in plain words. "List my trees" or "what trees do I have" names them, newest first, with a line each. "Hand off the solar tree" or "send me the handoff for solar panels" answers "Packing …" and sends that tree's file. When several trees fit, it lists them and a number or a name picks one; when none does, it says so and lists your trees. "Find the tree about heat pumps" gives the matches, and "yes" or a number sends the handoff. A voice note asks the same way.
- A name that is one tree's is matched with no model call. Words no name holds go to the quick model, which matches them against each tree's name and cards (`src/node/tree-asks.ts`). Words the plain rules do not read ("could I get my film tree packaged up for Claude") are read by Momo with every other message.
- `/unpair` in the chat ends the pairing.

Limits:

- A bot can take files up to 20 MB. Drop larger ones on the web page.
- Only the paired Telegram account is heard. Anyone else who finds the bot gets one fixed line.
- Only one program may read a bot's messages at a time. A second one is told so by Telegram and waits, and its log says so once. `npm run dev:fake` leaves the bot alone.
- Telegram's chats with bots are not end-to-end encrypted.
- The service reads the bot by asking Telegram for new messages, so the machine it runs on needs no public address.

## Sharing a tree

Two people who both use the hosted service can share a tree. Both need a Telegram chat paired with their headset (Hosted for judging, Telegram for judges).

1. **Share.** The sharer points at a tree on the desk in the headset and pinches Share. The headset sends `share` with the tree.
2. **The copy.** The service takes a copy of the tree's first card and every card the sharer kept, with their files. Suggestions that were never kept stay behind. A copy holds at most 400 cards and 25 MB of files.
3. **The link.** The bot posts a link in the sharer's chat, to forward to a friend. It works once, for 7 days. A headset can share 20 trees a day. The sharer keeps their tree.
4. **The friend opens the link** in their own chat with the bot. The copy goes into their space under new ids, with its files copied.
5. **It grows.** The next time the friend's headset joins, or is put on again after 5 s or more off, the tree grows in front of them as their own, a layer at a time, with a recorded line of Momo's. The sharer's chat is told once it has grown.

When sharing cannot happen the headset is told why: no paired chat, the day's shares used, or a tree past the caps. A friend who has not paired is asked to pair first, and the link keeps working.

The code is `src/core/sharing.ts` (the copy and the planting), `src/core/growing.ts`, `src/node/gifts.ts` (trees waiting to grow) and `src/node/hosted/shares.ts` (the codes). `test/sharing.test.ts` runs the whole path with two devices and two chats. On a service that is not hosted, `share` answers with an error.

## The walkthrough demo

`npm run demo` runs the service with one prepared tree, played round by round for recording the film: Momo is live, what the Scout brings is scripted, and a page at `/demo` goes to any round. It keeps its own data folder, `data-demo`. `demo/headset.sh` joins the app on the headset to it, and `demo/headset.sh back` returns the app to the hosted service. See [demo/README.md](demo/README.md).

## Hosted for judging

One service for many headsets, on Fly.io in San Jose. Each headset gets its own space: a mindstorm, a pipeline and a live voice in `spaces/<device>` on the volume. A new space starts as a copy of `starter/`. Every space shares the model, its one Meta rate window, the keys and the maps. `MIND_PALACE_HOSTED=1` switches it on, with `MIND_PALACE_APP_KEY` and `MIND_PALACE_ADMIN_TOKEN`. `docs/protocol.md` says how a device connects.

- **Refusals in Momo's voice.** The lines the service says itself, when a limit is reached, the service is off or a space is full (`RECORDED_LINES` in `src/node/hosted/hosted.ts`), are played from their recordings in her realtime voice. They are `said` in `demo/lines.json`, recorded with `scripts/demo-lines.ts --retake --only said`, and shipped in the image by the Dockerfile. Words with no recording are shown with no sound, and the log says so; the speech model never says them. A test fails when a line and its recording drift apart.
- **Telegram.** The owner's bot (`TELEGRAM_BOT_TOKEN`) only sends spend alerts to the chat the user paired. The server never reads it, since the user's Mac does.
- **Telegram for judges.** A second bot, `MIND_PALACE_JUDGE_BOT_TOKEN`, is read by the server alone, with one poller for every headset (`src/node/hosted/judges.ts`). A judge says "connect my Telegram" to Momo, who gives the bot's name and a six-digit code; `POST /api/telegram/pair` returns the same `{link, bot, code}`. The judge sends the code to the bot, or opens `t.me/<bot>?start=<code>`. The code works once, for 10 minutes. From then on that chat's thoughts, links, photos, files and voice notes go into that headset's space, "list my trees" and "hand off <a tree>" work as on the Mac, and every handoff the headset makes comes to the chat. A chat has one headset and a headset one chat. `/unpair` ends it, and so does deleting the space. A chat that is not paired gets one line that says how to pair, at most 6 times in 10 minutes, and 5 wrong codes in 10 minutes stop its codes being read. Everything a judge sends is their device's work: it counts toward the device's tokens, spend and voice minutes (a voice note by its length), and is refused, in Momo's words, with the store or the upload room full, the volume nearly full, or the service switched off. Links are fetched from public addresses only. Pairings are in `judge-telegram.json` on the volume, so a redeploy keeps them. A judges' token that is the owner's own is refused at start. `/admin` gives the bot's name and how many chats are paired.
- **Limits.** A device gets 60 minutes of voice with Momo (both ways), 30 searches and 30 web answers a day, and a share of the day's spend ($23, the most its own limits allow) and of Meta's tokens (9M), past which its own costly work stops with "today's limit" and everyone else's goes on. There is no total daily cap unless `MIND_PALACE_CAP_DOLLARS` sets one (fly.toml sets 0, none), so the bounds are each device's limits and shares, at most 20 devices and the off switch: at worst 20 × $23 = $460 a day. The paired Telegram chat hears when the day's spend passes $25, $50, $100 and every $100 after. What a user says or types to Momo is at most 4,000 characters. The day is Pacific time. The counts are in `/data/ledger.json`, so a redeploy keeps them. fly.toml sets each limit. The spend counts what the service measures in dollars: the realtime voice, its transcription, web answers, and the overflow to OpenAI. Meta's tokens have no listed price, so they count as $0 unless `MIND_PALACE_META_PRICE` gives dollars per million.
- **Overflow.** While Meta's minute is full, the Scout's calls go to OpenAI instead of waiting: gpt-5.4 for its directions, gpt-5.4-mini for its quick calls and searches (`src/node/hosted/overflow.ts`). Each one is logged as `[overflow]`. `MIND_PALACE_OVERFLOW=off` turns it off.
- **Every check reads the path decoded and normalized**, as a space does, and speech, transcription and the voice are metered inside their handlers, so no spelling of a path gets past a limit.
- **Instagram.** The service opens one library of the user's accounts, in `/data/instagram`, and every space searches it through a view of its own, each picture copied into that space's assets. No space opens or reads its own. The server does not read Instagram itself, since its pictures are made small with macOS's `sips`: `deploy/instagram.sh` copies the list and the Mac's library to the volume, never into git or the image, and restarts the machine. So the server holds no Instagram account: it opens the library from the list alone, and `deploy/secrets.sh` sends neither `META_IG_TOKEN` nor `META_IG_USER_ID`, and takes them off Fly if an earlier release left them there. `MIND_PALACE_INSTAGRAM_READ=on` without them logs that nothing is read and searches the library as it is.
- **Sharing.** A tree is shared between two headsets through the judges' bot. See Sharing a tree.
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

## Settings

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
| `TELEGRAM_BOT_TOKEN` | unset | The bot that makes the service a Telegram contact. See Telegram. |
| `MIND_PALACE_JUDGE_BOT_TOKEN` | unset | Hosted mode only: a second bot, for the judges' headsets. See Hosted for judging. |
| `MIND_PALACE_LIVE` | on with `OPENAI_API_KEY` | `off` turns Momo's live voice (`/live`) off; clients then record, transcribe and hear replies read aloud. |
| `MIND_PALACE_WAKE_CHECK` | on with `OPENAI_API_KEY` | `off` takes every wake for the name. On, the service writes down the second of sound that woke a device and lets Momo act only if it holds "hey" or "hi" and the name, since the devices' spotter also wakes on about one near miss in eight. See DECISIONS 70. |
| `MIND_PALACE_LIVE_MODEL` | `gpt-realtime-2.1` | The realtime model that is Momo's live voice. `gpt-realtime-2.1-mini` costs a third as much. See DECISIONS 59. |
| `MIND_PALACE_LIVE_TURN` | `semantic` | How the live voice hears that you are done: `semantic`, or `server:<ms>` for a pause of that many milliseconds. |
| `MIND_PALACE_LIVE_PAUSE` | 1800 | Milliseconds of quiet after your last word that end your turn when the turn detection has not. 1200 answers sooner and cuts a request said with a thinking pause. |
| `MIND_PALACE_LIVE_EFFORT` | `minimal` | How hard the realtime model thinks before it answers. |
| `MIND_PALACE_WEB_MODEL` | `gpt-5.4-mini` | The model behind Momo's quick web answers. |
| `MIND_PALACE_INSTAGRAM_LIST` | `~/.mind-palace/instagram-following.md` | Your chosen Instagram accounts, one per line as `- @handle — Name — what it is — address` under `### Category` headings. With `META_IG_TOKEN` and `META_IG_USER_ID`, the service reads each account's newest 25 posts in the background into `data/instagram/`, paced by the usage Instagram reports, each account again about every two days, and the Scout searches them there. `node --no-warnings --import tsx scripts/instagram.ts report <data folder>` says what it holds. Without the file, Instagram is left out. |
| `MIND_PALACE_INSTAGRAM_READ` | on | `off` searches what `data/instagram/` holds without reading Instagram, for a copy of the service. |
| `MIND_PALACE_WEB_EFFORT` | `low` | How hard it thinks. `none` answers about 0.5 s sooner and dated a launch wrong more often. |

## Check it

```bash
npm test                 # the unit tests, on scripted models, no network
npx tsc --noEmit
npm run scenario         # everything against the live model; it spends tokens
```

`test/hosted.test.ts` holds a version 1 client to the hosted mode, `test/sharing.test.ts` covers sharing, `test/telegram.test.ts` and `test/judges.test.ts` run the bots against a stand-in for Telegram's Bot API (`test/fake-bot.ts`), and `test/live.test.ts` the live voice against a stand-in session.

Measuring scripts, each against a copy of a data folder so the real one is not touched:

```bash
node --no-warnings --import tsx scripts/live-bench.ts --data <a copy of a data folder> --out <file.jsonl>
                         # Momo's live voice on the 40 requests of scripts/live-requests.ts, said into files, never played
node --no-warnings --import tsx scripts/live-summary.ts <file.jsonl>
node --no-warnings --import tsx scripts/typed-bench.ts --data <a copy of a data folder> --runs 3
                         # the tree-or-layer requests typed, through the Conductor
npm run judges -- --url <service> --judges 10
                         # a load test of the hosted mode: N voice-free sessions
```

## How it is built

- **`src/core/`** is the agent core: the data shape (`domain.ts`), the mindstorm with undo (`state.ts`), search (`search.ts`), the card and arrangement libraries (`views.ts`), the roles (`roles/`) and the pipeline. It uses nothing that only Node has, and a test enforces that (`test/portable.test.ts`).
- **`src/node/`** is the host for a Mac or a server: the model client, the sources, files on disk, the HTTP and WebSocket server, the live voice, and Telegram. `src/node/hosted/` is the hosted mode: spaces per device, the ledger of limits, the judges' bot, shares.
- **`src/demo/`** is the scripted walkthrough.
- **`src/fake/`** is the scripted model behind `npm run dev:fake` and the tests.
- **`client/`** is the browser client. No build step.
- **`src/node/contact.ts`** is where a contact plugs in: what it hands the service and how a handoff is delivered. `src/node/telegram.ts` is the Telegram contact.
- **`deploy/`** puts the service on Fly.io ([deploy/README.md](deploy/README.md)).
- **`DECISIONS.md`** records each call made while building this, with the reason, the alternative and what measured it.

## Not verified

- The microphone, live speech recognition and spoken replies in the browser client have not been exercised.
- The wake phrase was measured on synthetic voices (DECISIONS 38, 69 and 70). It still misses about one plain utterance in eight and most fast ones.
- Video understanding and code sketches are written and unit-tested but were not triggered in a live run.
