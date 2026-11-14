# Mind Palace agents

The agent system behind the mindstorm. You drop things in. Agents file them into trees, bring new related content as dashed picks, follow what you say, choose how each card is drawn, and package handoffs.

It is a TypeScript service. Clients are thin. The web client in `client/` runs in any browser, including the Quest browser. The Ocean app on Vision Pro connects through `visionos/MindPalace/Ocean/Agent/`.

## Run it

```bash
cd agents
npm install
npm start
```

It prints an address such as `http://localhost:8787/#token=…`. Open it. Type a thought into the box and press Add.

Keys are read from `~/.muse-garden.env`. `MODEL_API_KEY` is required. Optional keys switch sources on: `YOUTUBE_API_KEY` (direct video search), `TMDB_API_KEY` (film and television), `EUROPEANA_API_KEY` (European museums and archives), `GUARDIAN_API_KEY` (news), `OPENAI_API_KEY` (a faster web search, model set by `MIND_PALACE_SEARCH_MODEL`, default `gpt-5.4-mini`, a spoken voice for replies, set by `MIND_PALACE_VOICE`, default `marin`, and speech recognition told your card titles, model set by `MIND_PALACE_HEARING_MODEL`, default `gpt-4o-transcribe`), and `META_IG_TOKEN` with `META_IG_USER_ID` (Instagram). Nothing is copied into the repo. Your mindstorm is saved in `agents/data/`.

To try the client with no model and no cost: `npm run dev:fake`.

To add the headset's library (its films, works, notes, tags and saved trees), stop the service and run `npm run import-library`. It reads `visionos/MindPalace/Resources/ocean.json`, `public/clips` and `public/works`, works offline, and took 19 s on this Mac. It refuses while the service runs on the same data folder, because the service would write over it. A second run adds nothing. Set `MIND_PALACE_DATA` to import into another data folder. The works' pictures are turned into JPEGs with `sips`, so on a machine that is not a Mac they come in as text cards. The films play from `public/clips/full`, so keep the repository where it was when you imported.

If `ocean.json`'s saved trees change, run `npm run saved-trees` before importing. It builds a small program against `quest/core` with `clang++` and records how the Quest app hangs each saved tree's steps in `src/node/library-saved.json`.

| Setting | Default | Meaning |
|---|---|---|
| `MIND_PALACE_PORT` | 8787 | Port for HTTP and WebSocket. |
| `MIND_PALACE_TOKEN` | generated, saved in `data/token` | The access key every client must send. |
| `MIND_PALACE_DATA` | `agents/data` | Where the mindstorm and files are kept. |
| `MUSE_LLM_MODEL` | `muse-spark-1.3` | The model for every role. |
| `MIND_PALACE_TOKEN_BUDGET` | 5,000,000 | Tokens the service may spend before it refuses model calls. Restart to reset. |
| `MIND_PALACE_ENV` | `~/.muse-garden.env` | The file keys are read from. |

## Check it

```bash
npm test                 # 154 tests on scripted models, no network
npx tsc --noEmit
node --no-warnings --import tsx test/client.e2e.ts   # the web client in a real browser, 23 checks
npm run scenario         # everything against the live model, 25 checks, about 160,000 tokens
```

## The roles

You talk to one voice. Content roles decide what exists. The Renderer decides how it looks.

| Role | Job | File |
|---|---|---|
| Conductor | Hears each utterance with what you are looking at, and routes it: ask, more, navigate, organize, handoff, capture, keep, undo. | `src/core/roles/conductor.ts` |
| Intake | Turns a dump into items: text, links, pictures, video, files, and chat exports from ChatGPT, Claude, Muse or a pasted transcript. | `src/core/roles/intake.ts` |
| Filer | Places each new item in an existing tree or starts a new one. | `src/core/roles/filer.ts` |
| Scout | Works out what a card is and what you are doing with it, then extends it in several different directions. Each comes back as content shown in place: a written idea, steps, a generated picture or set, a video that plays in the card, or real material found in a source that suits the subject. Sources: the web (the page is read and the passage shown), research papers, books (Apple Books), world data as charts, Hacker News threads, GitHub projects, Stack Overflow, museum collections, Are.na, podcasts, recipes, the Internet Archive (films that play as a file), and with their keys news (The Guardian), film and television (TMDB) and Europeana. It looks at a dropped picture itself. Never a bare link. Links to existing content, and hangs a film or work from the headset's library under the card, only when the tie is strong. | `src/core/roles/scout.ts`, `src/node/sources.ts` |
| Organizer | Moves, groups, renames, merges, splits and deletes on request, as one undoable step. | `src/core/roles/organizer.ts` |
| Renderer | Picks a component for each card and a composite for groups of cards. Never invents data. | `src/core/roles/renderer.ts` |
| Archivist | Plain code. Keeps the change log, the search index and each tree's digest current. | `src/core/pipeline.ts`, `src/core/state.ts` |
| Packager | Writes a handoff bundle another agent can pick up cold. | `src/core/roles/packager.ts` |

`src/core/pipeline.ts` runs the roles and is the only place their commands are applied.

## How it is built

- **`src/core/`** is the agent core: the data shape (`domain.ts`), the mindstorm with undo (`state.ts`), search (`search.ts`), the component and composite libraries (`views.ts`), the roles and the pipeline. It uses nothing that only Node has, and a test enforces that, so it can later move onto a headset.
- **`src/node/`** is the host for a Mac or a server: the model client, tools, files on disk, SQLite, and the HTTP and WebSocket server.
- **`client/`** is the web client. No build step.
- **`docs/protocol.md`** is the contract every client follows. `docs/libraries.md` documents the components and composites. `docs/handoff-format.md` documents the handoff bundle. `docs/ocean-adapter.md` covers the Vision Pro adapter.
- **`DECISIONS.md`** records each call made while building this, with the reason and the alternative.

## Connecting a headset

- **Quest, at your desk.** Put the Quest in developer mode, plug it in, and run `adb reverse tcp:8787 tcp:8787`. Open `http://localhost:8787/#token=…` in the Quest browser. `localhost` counts as a secure page, so the microphone is allowed.
- **Quest, untethered.** Run a tunnel such as `cloudflared tunnel --url http://localhost:8787` and open its HTTPS address with the same `#token=…`.
- **Quest app.** The native app in `quest/` is a client of the same protocol. It tells the service it cannot show embedded players (`{t: 'client', media: {embeds: false, ...}}`), and while it is connected the Scout looks for videos as files the service streams.
- **Vision Pro.** Launch Ocean with `-agent ws://<your Mac's address>:8787 -agentToken <token>`. See `docs/ocean-adapter.md`.

Over plain `http://` on a local network address, browsers refuse the microphone. Typing still works.

## Not verified

- Nothing has run on a Quest or a Vision Pro.
- The microphone, live speech recognition and spoken replies in the web client have not been exercised. Speech-to-text through the service was checked once with a synthesized recording.
- The Ocean adapter was typechecked against an older visionOS SDK and exercised on macOS. It has not been built for visionOS 26.
- No headset has sent the `client` message. The Scout's choice for a headset was seen live once, through `scripts/scout-probe.ts` with `NO_EMBEDS=1`: one of two Internet Archive finds fit and came as a film that plays from the service. Streaming through the service was checked live on another archive film and a podcast episode, not on that pick.
- The library import ran into a temporary data folder, never into `agents/data`.
- Reading your Instagram posts and reading a web page were each checked live once. Image generation was seen live in a pick. Video understanding and code sketches are written and unit-tested but were not triggered in a live run.
