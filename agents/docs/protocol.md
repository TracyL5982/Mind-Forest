# Client protocol, version 1

A client is anything that shows the mindstorm: the web client, the Ocean app, a later Quest app. It holds no logic. It keeps a copy of the state, draws it, and sends what the user does.

## Connecting

- The service listens on one port (default 8787) for HTTP and WebSocket.
- Every request except static files and `GET /api/health` needs the access token. Send it as `Authorization: Bearer <token>`, as `?token=<token>`, or rely on the `mp_token` cookie the service sets after the first authorized request. The service prints the token at start and saves it in `data/token`.
- Open the socket at `ws://<host>:<port>/ws?token=<token>`. All socket messages are JSON objects with a `t` field.

## State a client keeps

Five maps keyed by id: `item`, `node`, `tree`, `link`, `group`. Shapes are in `src/core/domain.ts`.

- **Item.** One piece of content: `kind`, `title`, `text`, `summary`, `tags`, `data`, `source` (`from`, `url`, `asset`), `origin`.
- **Node.** An item's place in a tree: `treeId`, `itemId`, `parent` (null for a root), `status` (`kept` or `pick`), `why`, `importance` (0 to 1), `view` (`component`, `props`), `order` among siblings.
- **Tree.** `title`, `rootId`, `digest`.
- **Link.** A tie between two nodes, usually across trees: `a`, `b`, `why`, `strength`.
- **Group.** A composite: `anchor` (the parent node), `composite`, `title`, `members` (node ids), `props`.

Drawing rules:

- A node whose `status` is `pick` is the agent's suggestion. Draw its thread to its parent dashed. When it becomes `kept` the thread turns solid.
- Draw a link as a dashed, bowed line between its two nodes, labelled with `why`.
- A node's layer is its depth: the number of parents above it.
- `view.component` and `view.props` say how to draw a node. `group.composite` says how to arrange its members. Both libraries are documented in `docs/libraries.md`. A client that does not know a component draws it as `note`.
- An asset address such as `/assets/<id>` is relative to the service.

## Service to client

| `t` | Fields | Meaning |
|---|---|---|
| `hello` | `protocol`, `snapshot`, `settings`, `undo`, `voice`, `hearing` | Sent once on connect. `settings.agentName` is what the user calls the agent, `momo` unless renamed (see Voice). `voice` is true when the service can read replies aloud through `GET /api/speak`. `hearing` is `service` when the service transcribes better than a browser can, so the client should record and post to `/api/transcribe`, and `browser` when the client should use its own recognition if it has one. `snapshot` has `seq` and the arrays `items`, `nodes`, `trees`, `links`, `groups`. Replace all local state with it. `undo` is the label of what an undo would take back now, or null. |
| `change` | `set`, `undo` | One change set: `id`, `seq`, `label`, `origin`, `patches`, optional `undoes`. Apply each patch in order: `{entity, id, before, after}`. `after: null` removes the entity. Otherwise store `after` under `id`. `undo` is the new undo label, or null. |
| `activity` | `activity` | Work state: `id`, `role`, `state` (`start`, `done`, `error`), `message`, optional `nodeId`. Show a thinking mark on `nodeId` between `start` and `done`. |
| `say` | `text` | One short line for the agent to speak. |
| `heard` | `text`, `final` | The transcript the service is acting on. |
| `navigate` | `nodeId?`, `treeId?` | Move the user's view to that node or tree. |
| `handoff` | `name`, `url`, `markdown`, `files` | A handoff bundle is ready. `url` is a zip to download. |
| `settings` | `settings` | Settings changed. |
| `note` | `role`, `message` | A log line. Optional to show. |
| `error` | `message` | The last message from this client was rejected. |

`origin` on a change set is `{by: 'user' | 'agent', role?, tool?}`. Use it to animate agent changes differently from the user's own.

## Client to service

| `t` | Fields | Meaning |
|---|---|---|
| `dump` | `dumps` | Things dropped into the mindstorm. Each is `{kind:'text', text, name?}`, `{kind:'link', url}`, or `{kind:'asset', asset, mime, name?}`. Upload files first (below). |
| `utter` | `text`, `final`, `scene` | Speech as text. Send partials with `final: false` as they arrive and the last one with `final: true`. A leading wake phrase is dropped before the service acts, and an utterance that is only the phrase asks nothing (see Voice). |
| `focus` | `nodeId` | The user opened or looked at a node. The agent brings picks for it if it has none. |
| `ask` | `nodeId`, `need` | A typed question about a node. |
| `more` | `nodeId`, `need?` | More picks for a node. |
| `keep` | `nodeIds` | Keep picks. |
| `undo` | `id?` | Undo the latest real change, or the named one. Format choices and digests that followed it are undone with it. |
| `commands` | `label`, `commands` | Direct manipulation: any commands from `src/core/domain.ts`, such as `moveNode`, `editItem`, `deleteNode`. Applied as one undoable set. |
| `organize` | `request`, `scope`, `focus?` | A typed organizing request. `scope` is `{treeIds, nodeIds}`. |
| `handoff` | `scope`, `note?` | Package a handoff. An empty scope means everything. |
| `settings` | `patch` | `picksMode` (`provisional` or `immediate`), `picksPerRun`, `scoutOnDump`, `agentName` (1 to 32 characters: a letter, then letters, digits, spaces, hyphens or apostrophes). |

`scene` is `{focus?, selection, treeId?}`: the node the user has open, the nodes they have selected, and the tree they are in. The agent uses it to resolve "this" and "that".

## HTTP

| Request | Body | Reply |
|---|---|---|
| `POST /api/assets?name=<file name>` | The file's bytes, with its `Content-Type` | `{id, url, mime}` |
| `GET /assets/<id>` | | The bytes. Supports byte ranges for video. |
| `POST /api/transcribe?tree=<id>` | Audio bytes, with `Content-Type` (`audio/wav`, `audio/webm`, `audio/mp4`, `audio/mpeg`, `audio/ogg`) | `{text}`, without a leading wake phrase, so `""` when only the phrase was said. The agent's name and the titles of the cards in `tree`, then of every tree and the newest cards, are given to the recognizer as words the user is likely to say. |
| `GET /handoffs/<name>.zip` | | The bundle. |
| `GET /api/speak?text=<reply>` | | MP3 of the reply read aloud, streamed as it is made. 404 when the service has no voice. Takes the token as `?token=` so an audio element can play it directly. |
| `GET /api/state` | | `{snapshot, settings}` |
| `GET /api/health` | | `{ok, protocol}`. No token needed. |

## Voice

A client can turn speech into text itself and send `utter` messages. Or it can record audio, post it to `/api/transcribe`, and send the returned text as a final `utter`. The service speaks through `say` messages. The client turns them into sound, with `GET /api/speak` when `hello.voice` is true and its own voice otherwise.

### The wake phrase

The user wakes the agent by saying "hey" or "hi" and its name, `settings.agentName` ("hey Momo", "hi Momo"). A client that listens for it:

- Spots the phrase on the device. No audio leaves the device before the phrase is heard.
- Then records until the speaker pauses for 1.2 seconds, or for 8 seconds when nothing more is said, and sends nothing in that case. The recording starts a moment before the phrase, so words said straight after it are kept.
- Posts that recording to `/api/transcribe` and sends the text as a final `utter`.
- Does not listen while a reply is playing.

The service drops a leading wake phrase from `/api/transcribe` replies and from `utter` text: "hey" or "hi", then the name, in any case, with any punctuation around them and a space or hyphen allowed inside the name ("Hi, Mo-mo!"). "Hey Momo, undo that" is acted on as "Undo that". The phrase anywhere else, or another greeting ("hello Momo"), is left as it was.

