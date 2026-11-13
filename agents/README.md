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

Keys are read from `~/.muse-garden.env` (`MODEL_API_KEY`, and `META_IG_TOKEN` with `META_IG_USER_ID` for Instagram). Nothing is copied into the repo. Your mindstorm is saved in `agents/data/`.

To try the client with no model and no cost: `npm run dev:fake`.

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
npm test                 # 112 tests on scripted models, no network
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
| Scout | Brings new content from outside: web search, image generation, code sketches, your Instagram posts. Links to existing content only when the tie is strong. | `src/core/roles/scout.ts` |
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
- **Vision Pro.** Launch Ocean with `-agent ws://<your Mac's address>:8787 -agentToken <token>`. See `docs/ocean-adapter.md`.

Over plain `http://` on a local network address, browsers refuse the microphone. Typing still works.

## Not verified

- Nothing has run on a Quest or a Vision Pro.
- The microphone, live speech recognition and spoken replies in the web client have not been exercised. Speech-to-text through the service was checked once with a synthesized recording.
- The Ocean adapter was typechecked against an older visionOS SDK and exercised on macOS. It has not been built for visionOS 26.
- Reading your Instagram posts and reading a web page were each checked live once. Image generation was seen live in a pick. Video understanding and code sketches are written and unit-tested but were not triggered in a live run.
