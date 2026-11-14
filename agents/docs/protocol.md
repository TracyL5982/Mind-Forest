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

## Pictures and media

A client fetches only from the service. Every address in an item or a view that a client loads is a service address such as `/assets/<id>`. A client that cannot send the `Authorization` header adds `?token=<token>`.

- `source.asset`: the item's own file, as an asset id: a picture, or a video or recording that plays.
- `data.thumbnailUrl`: a video's still, as a service address.
- `data.mediaUrl`: a file that plays (MP4, MP3 and the like), as a service address. Every item that plays has it. The service holds the file, or streams it from where it was found, with byte ranges either way.
- `data.embed`: a player page on another site, such as `https://www.youtube.com/embed/<id>`. Only a browser can show it. A client that cannot shows `data.thumbnailUrl` and the title instead.
- `source.url`: where the item was found. A record of its origin, not something a client loads.

## Library items

`npm run import-library` adds the headset's own library as items: 100 films, 750 works, the notes and tags of `ocean.json`, and the 2 saved trees.

- `source.from` is `library`. `data.library` is `{kind, key}`:
  - `film`: `key` is the film's `index` in `public/clips/clips.json`, a number.
  - `work`: `key` is the work's `id` in `public/works/works.json`, such as `met-258425`. It is not the work's place in the file. Find the place by matching `id`.
  - `note`: `key` is the note's `id` in `ocean.json`.
  - `tag`: `key` is the tag's `id` in `ocean.json` or `works.json`.
- A headset draws a library item from its own media by `data.library`. A web client draws it like any other item: a film plays `data.mediaUrl` with `data.thumbnailUrl` as its still, and a work shows `source.asset`, a JPEG.
- Most library items are in no tree. They arrive in `snapshot.items` with no node. Keep them in the item map, and draw one only where a node holds it: in a saved tree, or as a pick under a card.
- The Scout hangs a library item under a card only when the tie is strong. The `change` adds a node whose `itemId` is the library item's id and adds no item. The node's `origin` is `{by: 'agent', role: 'scout', tool: 'library'}`.
- Deleting a library item's last node leaves the item in the library. It is never archived.

## Service to client

| `t` | Fields | Meaning |
|---|---|---|
| `hello` | `protocol`, `snapshot`, `settings`, `undo`, `voice` | Sent once on connect. `voice` is true when the service can read replies aloud through `GET /api/speak`. `hearing` is `service` when the service transcribes better than a browser can, so the client should record and post to `/api/transcribe`, and `browser` when the client should use its own recognition if it has one. `snapshot` has `seq` and the arrays `items`, `nodes`, `trees`, `links`, `groups`. Replace all local state with it. `undo` is the label of what an undo would take back now, or null. |
| `change` | `set`, `undo` | One change set: `id`, `seq`, `label`, `origin`, `patches`, optional `undoes`. `set.seq` is exactly one more than the last `seq` the client holds, from `hello.snapshot.seq` or the previous `change`. Any other value means the client missed a change: reconnect for a fresh `hello`. Apply each patch in order: `{entity, id, before, after}`. `after: null` removes the entity. Otherwise store `after` under `id`. `undo` is the new undo label, or null. |
| `activity` | `activity` | Work state: `id`, `role`, `state` (`start`, `done`, `error`), `message`, optional `nodeId`. Show a thinking mark on `nodeId` between `start` and `done`. |
| `say` | `text` | One short line for the agent to speak. |
| `heard` | `text`, `final` | The transcript the service is acting on. |
| `navigate` | `nodeId?`, `treeId?` | Move the user's view to that node or tree. |
| `handoff` | `name`, `url`, `markdown`, `files` | A handoff bundle is ready. `url` is a zip to download. |
| `settings` | `settings` | Settings changed. |
| `note` | `role`, `message` | A log line. Optional to show. |
| `error` | `message` | The last message from this client was rejected. |
| `questions` | `nodeId`, `questions` | The reply to this connection's own `questions` message, sent to it alone. See Suggested questions below. |

`origin` on a change set is `{by: 'user' | 'agent', role?, tool?}`. Use it to animate agent changes differently from the user's own.

## Client to service

| `t` | Fields | Meaning |
|---|---|---|
| `dump` | `dumps` | Things dropped into the mindstorm. Each is `{kind:'text', text, name?}`, `{kind:'link', url}`, or `{kind:'asset', asset, mime, name?}`. Upload files first (below). |
| `utter` | `text`, `final`, `scene` | Speech as text. Send partials with `final: false` as they arrive and the last one with `final: true`. |
| `focus` | `nodeId` | The user opened or looked at a node. The agent brings picks for it if it has none. |
| `ask` | `nodeId`, `need` | A typed or picked question about a node. It joins the conversation the agent reads, as a spoken one does. |
| `questions` | `nodeId` | The user opened a node: what might they ask next? Answered to this connection alone with `questions`. |
| `more` | `nodeId`, `need?` | More picks for a node. |
| `keep` | `nodeIds` | Keep picks. |
| `undo` | `id?` | Undo the latest real change, or the named one. Format choices and digests that followed it are undone with it. |
| `commands` | `label`, `commands` | Direct manipulation: any commands from `src/core/domain.ts`, such as `moveNode`, `editItem`, `deleteNode`. Applied as one undoable set. |
| `organize` | `request`, `scope`, `focus?` | A typed organizing request. `scope` is `{treeIds, nodeIds}`. |
| `handoff` | `scope`, `note?` | Package a handoff. An empty scope means everything. |
| `settings` | `patch` | `picksMode` (`provisional` or `immediate`), `picksPerRun`, `scoutOnDump`. |
| `client` | `media` | What this connection can play, sent right after connecting: `{embeds, files}`. `embeds` is false for a client that cannot show a player from another site, such as the headset. `files` lists the file extensions it plays, such as `["mp4", "mp3"]`. A connection that never sends it is taken to be a browser that shows embeds. While any connected client cannot show embeds, the Scout looks for each video as a file that plays from the service first, and leaves out recordings whose type a connected client did not list. |

`scene` is `{focus?, selection, treeId?}`: the node the user has open, the nodes they have selected, and the tree they are in. The agent uses it to resolve "this" and "that".

## Suggested questions

Under an open card a client offers a few things to ask, so the user can start a conversation about the card without speaking or typing.

1. When a card opens, send `{"t": "questions", "nodeId": "<node id>"}`.
2. The service answers this connection, and no other, with `{"t": "questions", "nodeId": "<node id>", "questions": ["How did Hitchcock use the dolly zoom?", "Show me a dolly zoom on film"]}`.
3. When the user picks one, send it as `{"t": "ask", "nodeId": "<node id>", "need": "<the question, as written>"}`.

- `questions` holds at most four strings, each a question or a short request under about eight words, written for that card, where it stands in its tree, the cards round it, and the recent conversation, in the language the user uses. An empty list means the service has nothing to offer: a model failure, or a card that is not there.
- Show your own rows until the reply arrives, and keep them when the list is empty. The first time a card is asked for, the reply took 0.75 to 3 s in eight live runs, about 1.2 s typically. Ignoring it is always safe, and a client that never asks never gets one.
- Match a reply by `nodeId`. One for a card that is no longer open is stale: drop it.
- Ask again each time a card opens. The service keeps what it wrote for each card and answers from it while the card, the cards round it and the conversation are unchanged, so asking again costs nothing then. Once any of them changes, the next ask is written afresh.

## HTTP

| Request | Body | Reply |
|---|---|---|
| `POST /api/assets?name=<file name>` | The file's bytes, with its `Content-Type` | `{id, url, mime}` |
| `GET /assets/<id>` | | The bytes. Supports byte ranges for video. A file the service streams from its source answers with the source's status and range. The service streams only the address it stored for that asset, never one named in the request, and a file on its own disk only from `public/clips/full`. |
| `POST /api/transcribe?tree=<id>` | Audio bytes, with `Content-Type` (`audio/wav`, `audio/webm`, `audio/mp4`, `audio/mpeg`, `audio/ogg`) | `{text}`. The titles of the cards in `tree`, then of every tree and the newest cards, are given to the recognizer as words the user is likely to say. |
| `GET /handoffs/<name>.zip` | | The bundle. |
| `GET /api/speak?text=<reply>` | | MP3 of the reply read aloud, streamed as it is made. 404 when the service has no voice. Takes the token as `?token=` so an audio element can play it directly. |
| `GET /api/state` | | `{snapshot, settings}` |
| `GET /api/health` | | `{ok, protocol}`. No token needed. |

## Voice

A client can turn speech into text itself and send `utter` messages. Or it can record audio, post it to `/api/transcribe`, and send the returned text as a final `utter`. The service speaks through `say` messages. The client turns them into sound, with `GET /api/speak` when `hello.voice` is true and its own voice otherwise.
