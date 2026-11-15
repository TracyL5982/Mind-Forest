# Client protocol, version 1

A client is anything that shows the mindstorm: the web client, the Ocean app, a later Quest app. It holds no logic. It keeps a copy of the state, draws it, and sends what the user does.

## Connecting

- The service listens on one port (default 8787) for HTTP and WebSocket.
- Every request except static files and `GET /api/health` needs the access token. Send it as `Authorization: Bearer <token>`, as `?token=<token>`, or rely on the `mp_token` cookie the service sets after the first authorized request. The service prints the token at start and saves it in `data/token`.
- Open the socket at `ws://<host>:<port>/ws?token=<token>`. All socket messages are JSON objects with a `t` field.

## State a client keeps

Five maps keyed by id: `item`, `node`, `tree`, `link`, `group`. Shapes are in `src/core/domain.ts`.

- **Item.** One piece of content: `kind`, `title`, `text`, `summary`, `tags`, `data`, `source` (`from`, `url`, `asset`), `origin`.
  - `title` is the item's whole title. A title the model wrote stands on the two lines a small card face gives a title; a source's own title, a paper's, a work's, a page's, a file's name, or one a person wrote, is kept whole. `data.shortTitle`, a string, is then what a small face shows of it: its first whole clause or words that fit two lines, with no ellipsis. It is there only when the whole title does not fit, and the service sets it again whenever the title changes. A client's small face shows `data.shortTitle` when it is there, else `title`, and its opened card shows `title`. docs/libraries.md gives the rule.
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
| `hello` | `protocol`, `snapshot`, `settings`, `maps`, `undo` | Sent once on connect. `snapshot` has `seq` and the arrays `items`, `nodes`, `trees`, `links`, `groups`. Replace all local state with it. `maps` is the map tile provider, `{ tiles, credit, link? }`, or null when maps are off, in which case a client asks no tile server for anything. See Maps in `docs/libraries.md`. `undo` is the label of what an undo would take back now, or null. |
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
| `dump` | `dumps` | Things dropped into the mindstorm. Each is `{kind:'text', text, name?}`, `{kind:'link', url}`, or `{kind:'asset', asset, mime, name?, sound?}`. Upload files first (below). A recording (a `mime` that starts `audio/`) carries `sound: {seconds, peaks}`, which the client measured when it decoded the file, because the service never decodes sound: see the audio card in `docs/libraries.md`. A recording sent with no `sound` is filed by name. |
| `utter` | `text`, `final`, `scene` | Speech as text. Send partials with `final: false` as they arrive and the last one with `final: true`. |
| `focus` | `nodeId` | The user opened or looked at a node. The agent brings picks for it if it has none. |
| `ask` | `nodeId`, `need` | A typed question about a node. |
| `more` | `nodeId`, `need?` | More picks for a node. |
| `keep` | `nodeIds` | Keep picks. |
| `undo` | `id?` | Undo the latest real change, or the named one. Format choices and digests that followed it are undone with it. |
| `commands` | `label`, `commands` | Direct manipulation: any commands from `src/core/domain.ts`, such as `moveNode`, `editItem`, `deleteNode`. Applied as one undoable set. |
| `organize` | `request`, `scope`, `focus?` | A typed organizing request. `scope` is `{treeIds, nodeIds}`. |
| `handoff` | `scope`, `note?` | Package a handoff. An empty scope means everything. |
| `settings` | `patch` | `picksMode` (`provisional` or `immediate`), `picksPerRun`, `scoutOnDump`. |

`scene` is `{focus?, selection, treeId?}`: the node the user has open, the nodes they have selected, and the tree they are in. The agent uses it to resolve "this" and "that".

## HTTP

| Request | Body | Reply |
|---|---|---|
| `POST /api/assets?name=<file name>` | The file's bytes, with its `Content-Type` | `{id, url, mime}` |
| `GET /assets/<id>` | | The bytes. Supports byte ranges for video. |
| `POST /api/transcribe` | Audio bytes, with `Content-Type` (`audio/wav`, `audio/webm`, `audio/mp4`, `audio/mpeg`, `audio/ogg`) | `{text}` |
| `GET /handoffs/<name>.zip` | | The bundle. |
| `GET /api/state` | | `{snapshot, settings}` |
| `GET /api/health` | | `{ok, protocol}`. No token needed. |

## Voice

A client can turn speech into text itself and send `utter` messages. Or it can record audio, post it to `/api/transcribe`, and send the returned text as a final `utter`. The service speaks through `say` messages. The client turns them into sound.
