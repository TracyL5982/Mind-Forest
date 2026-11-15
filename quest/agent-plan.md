# The agents on Quest: integration plan

The goal is the agent service in `agents/` working inside the Quest app. You pinch a card and the Scout's new material grows round it, picks stay dashed until kept, the knife and the clap reach the agents, pictures and media come from the service, and voice runs through the service. First over USB and wireless adb, so testing can start soon. Then from anywhere.

Branch: `tracy/quest-agents`, made from `quest-port` with `tracy/agents` merged in. `visionos/` is exactly as `quest-port` has it; the Vision Pro adapter is retired.

## Decisions taken

- **Quest only.** The client is new C++ in `quest/core/agent/`, outside the ported scene. The scene gets small hooks, each marked `// AGENT:`. PORTING.md's 1:1 rule binds the ported files, not the new folder.
- **The service stays off the headset.** The app is a client of the same protocol as the web client (`agents/docs/protocol.md`).
- **The headset talks only to the service.** Pictures, audio and video all come from the service's address, never from a third party. One host, one token, one place to tunnel later.
- **The library is part of the mindstorm.** The headset's 100 films and 750 works, its 17 notes and 2 saved trees become existing items and trees in the service. The Scout links to them only when the tie is strong, and keeps bringing new material from its sources.
- **Card drawing belongs to the looks worktree.** The bridge maps agent items onto the five note kinds the scene draws today (text, image, video, chart, link) and keeps each item's full component and props beside it for that work to use. No file under `core/ocean/art*`, `notes.cpp`, `works.cpp` or `cardview*` is edited here.
- **Connection order.** Option 1 (USB, `adb reverse`) first, option 2 (wireless adb, `adb reverse`) the same day. Options for anywhere (Tailscale Funnel, Cloudflare named tunnel, hosted) after, by measurement. The client speaks `ws://` and `wss://` from the start, so each later option is an address.

## Data shapes

Named before code. Field names follow `agents/src/core/domain.ts` exactly.

| Shape | Where | What it is |
|---|---|---|
| `agent::Item`, `Node`, `TreeInfo`, `Link`, `Group` | `core/agent/protocol.h` | The service's entities. `data` and `view.props` stay as `Json`. |
| `agent::ChangeSet`, `Patch`, `Snapshot`, `Activity`, `Settings` | `core/agent/protocol.h` | What the service sends. |
| `agent::Inbound` | `core/agent/protocol.h` | One parsed message: a kind and its payload. |
| `agent::Outbound` | `core/agent/protocol.h` | Builders for every client message: `dump`, `utter`, `focus`, `ask`, `more`, `keep`, `undo`, `commands`, `handoff`, `settings`, `client`. |
| `agent::Mirror` | `core/agent/mirror.h` | The client's copy of the mindstorm. `apply(Snapshot)` replaces it, `apply(ChangeSet)` returns a `Delta`. |
| `agent::Delta` | `core/agent/mirror.h` | Per entity kind: ids added, ids changed, entities removed (with their last value). |
| `agent::Client` | `core/agent/client.h` | The connection's state machine over a `Transport`: connecting, live, waiting to retry (1, 2, 4, 8, then 15 s). Parses on the background thread, hands messages to the frame thread through `drain()`. |
| `agent::Transport` | `core/agent/client.h` | What a host gives the client: open a socket to a URL, send text, close; callbacks for open, text and close, on any thread. |
| `platform::Socket`, `platform::fetch` | `core/platform.h` | The hosts' socket and HTTP: OkHttp in Kotlin on the Quest, `NSURLSession` on the Mac preview. |
| `agent::Bridge` | `core/agent/bridge.h` | Mirror to scene and scene to messages. Holds the table between service node ids and `TreeNode` ids, and between items and `Ref`s. |
| A library item | service | `source.from = "library"`, `data.library = {kind: "film" | "work", key}` where `key` is the film's index or the work's id. The headset draws it from its own media as `Ref::film` or `Ref::work`. |

## Workstreams

Each one ends in a check. Labels: **Now** starts at once, in parallel. **After tools** waits for the Android build tools on this Mac. **After headset** needs the headset on USB. **After you** waits for a call of yours.

### WS1. Build tools and device scripts. After tools (scripts: Now)
- Install JDK 17, Android command-line tools, platform 34, build-tools 34, NDK 27.2, CMake 3.22, GLFW.
- Build the Mac preview (`quest/desktop/build.sh`) and the APK (`quest/tools/run.sh --build`).
- `quest/tools/agent-usb.sh`: `adb reverse tcp:8787 tcp:8787`, then launch with `-agent ws://127.0.0.1:8787 -agentToken <token from agents/data/token>`.
- `quest/tools/agent-wifi.sh`: `adb tcpip 5555`, `adb connect <headset address>`, the same reverse and launch, and a `--resume` that redoes the reverse after the headset slept.
- **Check.** The preview runs `-demo`. The APK installs. `perf.py --save-baseline` on the headset before any agent code runs.

### WS2. The agent core in C++. Now
- `quest/core/agent/protocol.*`, `mirror.*`, `client.*`. Platform-neutral C++20 on `core/json.h` and `core/base.h`. No JNI, no GL, no Objective-C.
- Tests in `quest/core/agent/test/`, built with the Mac's clang, on messages recorded from the scripted service (`npm run dev:fake`): snapshot, add, change, remove, a patch to an unknown entity, every outbound message's exact JSON, missing optional fields, a gap in `seq` (the client reconnects to get a fresh `hello`).
- **Check.** The tests pass. `quest/tools/check.sh` passes on the new files.

### WS3. Service changes. Now
- **Library import.** `npm run import-library` reads `visionos/MindPalace/Resources/ocean.json`, `public/clips/clips.json` and `public/works/works.json` and adds films, works, notes and the 2 saved trees, once and idempotently. Library items stay out of the inbox and out of filing. The service serves the Mac's copies of their pictures for the web client.
- **Every picture is a service asset.** Video thumbnails and any remote picture a card shows are stored as assets, so a client only ever fetches from the service.
- **Playable media.** A client can say what it plays (`client` message: `{media: {embeds: false, files: ["mp4", "webm", "mp3"]}}`). While a client that cannot embed is connected, the Scout prefers videos with a direct file (for example the Internet Archive) and keeps `data.mediaUrl` on every playable item.
- **Check.** `npm test` and `npx tsc --noEmit` pass. A Scout run with a library loaded links to a library film only for a strong tie and still brings new picks.

### WS4. The socket and HTTP on both hosts. Now (Mac); After tools (Quest)
- `platform::Socket` and `platform::fetch` in `core/platform.h`, implemented in `desktop/platform_mac.mm` (`NSURLSessionWebSocketTask`, `NSURLSession`) and `android/` (OkHttp from Kotlin, reached through `jni_bridge`).
- Manifest: `INTERNET`, and a network security config allowing plain `ws://` and `http://` to `127.0.0.1` and `localhost` only.
- Keepalive: a ping every 20 s from the host's socket.
- **Check.** The Mac preview connects to the scripted service, survives the service restarting, and resyncs from `hello`. On the headset, the same over `adb reverse`.

### WS5. The bridge into the scene. Now (design and hooks); After tools (running)
- Each service tree is a `Tree`. The newest stands if none does; the others hang as covers on the shelf.
- Each node is a `TreeNode`. An agent item is `Ref::note("agent-<item id>")` with its `OceanNote` in the catalog; a library item is its `Ref::film` or `Ref::work`.
- A pick is an unkept node with a dashed thread. A pinch keeps it. The scene's `kept` flag already means "only a suggestion" until confirmed.
- What you do, sent to the service:

| You do | Scene function | Message |
|---|---|---|
| Pinch a card | `take` | `keep` if it is a pick, then `focus` |
| Pick a question under the open card | `askGardener` | `ask` with the question as `need`, or `more` for "what else is like this" |
| Mark part of a card and ask | `askMark` | `ask` with the mark described in `need` |
| Cut with the flat hand | `prune` | `commands` with one `deleteNode` |
| Clap, to send | `pressTree(true)` | `handoff` for that tree |
| Clap, to put away | `pressTree(false)` | nothing: the service keeps the tree |

- The word "thinking" over a card follows `activity` for its node. Cards that arrive in a change set come up one after another through `arrive`. A change set whose origin is the user's own is applied without the arrival animation.
- Flags: `-agent <address>`, `-agentToken <token>`, `-agentDump "words"` (drop words in once connected, for runs with no hands), `-agentListen <seconds>` (record once, for voice runs before the gesture exists). Without `-agent` the app is exactly as it is today.
- Applying a change set touches the scene on the frame thread only, spread over frames like a tree's cards (`-standBudget`).
- **Check.** In the Mac preview against the scripted service, a scripted run: connect, a tree appears, `-agentDump` brings a new tree, a pinch brings picks round the card, a pinch keeps one, a cut removes one, and undo from the web client puts it back, each seen in a `-shot` picture and a `[agent]` log line. On the headset, `perf.py --compare` against the WS1 baseline.

### WS6. Pictures and media. After WS4
- A card's picture is fetched from `/assets/<id>` on the background thread into `dataDirectory()/agent/`, then drawn through the existing late-picture path (shimmer, fade in).
- An item with `data.mediaUrl` plays in the scene's video player, from the service's address with `?token=`. A video with only an embed shows its still and its title.
- **Check.** A Scout run's picture cards appear in the preview; a podcast pick plays on the headset.

### WS7. Voice. After WS4 (plumbing); After you (the gesture)
- Record with Android's `AudioRecord` (the `RECORD_AUDIO` permission), stop 1.2 s after the speaker goes quiet (the web client's rule), post to `/api/transcribe?tree=<tree in view>`, send the text as a final `utter`.
- A `say` plays `/api/speak` in the video player's audio path; recording stops while it plays.
- Until you choose the gesture, `-agentListen` starts one recording.
- **Check.** On the headset, a spoken command reaches the service and its reply is heard.

#### The wake phrase on the headset: a recipe

"Hey Momo" or "hi Momo" starts talking, as in the web client (`agents/client/js/wake-worker.js` is the reference). Measured on the Mac only: `agents/DECISIONS.md` 23. Nothing here has run on a Quest.

- **Library.** sherpa-onnx v1.13.8, `sherpa-onnx-v1.13.8-android.tar.bz2` (46 MB, sha256 `2ff63469a71cb6009aa2e3ed5f4a670f8abdcbe4bb9ffd23776afc792a6b4f44`): `jniLibs/arm64-v8a/libsherpa-onnx-c-api.so` and `libonnxruntime.so`. Or `sherpa-onnx-v1.13.8-android-static-link-onnxruntime.tar.bz2` (35 MB, sha256 `7583ca385ae7d981e65468455c2ea2c9f2da383921dccfc5658d0dc19d309e6f`) for one library. The header is `sherpa-onnx/c-api/c-api.h` at tag `v1.13.8`. Call the C API from `core/`; no JNI is needed for the spotter.
- **Model files on the headset.** From `sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01.tar.bz2` (17.6 MB, sha256 `f170013b4716e41b62b9bfd809687c207cef798ef9bc6534d524e17af9b6561a`), not its `-mobile` variant, which fails on every decode in 1.13.8: `encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx` (4.8 MB), `decoder-epoch-12-avg-2-chunk-16-left-64.onnx` (1.1 MB), `joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx` (0.16 MB), `tokens.txt`. Add `bpe.model` (0.24 MB) only to spell a new name on the headset.
- **Calls.** `SherpaOnnxCreateKeywordSpotter` with `feat_config` 16000 Hz and 80 features; `model_config.transducer` the three files, `tokens`, `num_threads = 1`, `provider = "cpu"`; `max_active_paths = 4`, `num_trailing_blanks = 1`, `keywords_score = 2.0`, `keywords_threshold = 0.05`; `keywords_buf` the lines below and `keywords_buf_size` their length. Then `SherpaOnnxCreateKeywordStream`; for each piece of audio `SherpaOnnxOnlineStreamAcceptWaveform`, and while `SherpaOnnxIsKeywordStreamReady`, `SherpaOnnxDecodeKeywordStream` and `SherpaOnnxGetKeywordResult`. A result with a non-empty `keyword` is the phrase: call `SherpaOnnxResetKeywordStream`, then `SherpaOnnxDestroyKeywordResult` as for every result. After each second without speech (the rule below), destroy the stream and create a fresh one: the spotter clears itself after 1.5 seconds of quiet and loses a phrase that begins as it does (11 and 0 of 60 caught after 1.5 and 3 seconds of quiet without this, 54 and 57 with it).
- **Keywords.** `▁HE Y ▁MO MO @HEY_MOMO`, `▁HI ▁MO MO @HI_MOMO`, `▁HIGH ▁MO MO @HI_MOMO`, one per line. For another name (`settings.agentName`), split "HEY <NAME>", "HI <NAME>" and "HIGH <NAME>" into the model's word pieces the way `encode()` in `wake-worker.js` does: for each word, the split into pieces of `bpe.model` with the highest total score. Build a new spotter with them. If a word cannot be split, keep the old one: the spotter exits the process on a keyword it cannot read.
- **Audio.** `AudioRecord` at 16 kHz, mono, 16-bit, from `VOICE_RECOGNITION` (try `VOICE_COMMUNICATION` if the headset's echo cancellation is needed and measure both), read in 100 ms pieces on its own thread, converted to floats. Keep the last 3 seconds in a ring buffer. Feed the spotter on the same thread.
- **After the phrase.** Play a short chime. Do not place the phrase with `start_time + timestamps[0]`: the timestamps restart when the spotter clears itself and `start_time` does not. The latest it can have begun is `timestamps[last] - timestamps[0] + 0.45` seconds before it was spotted. From that 100 ms piece, move back while the piece before is speech (at most 0.5 seconds), or forward past quiet to the first speech, and start the recording one piece earlier. A 100 ms piece is speech when its RMS is above both 0.015 and three times the quietest piece in the ring. Count the last piece before the phrase was spotted as speech if it is, since a short command can end before then. Record until the speaker pauses. Stop 1.2 seconds after the last speech, or after 8 seconds with no speech after the phrase (send nothing then), or at 60 seconds. Post the recording as a 16 kHz WAV to `/api/transcribe?tree=<tree in view>` and send the text as a final `utter`. The service drops "hey Momo" from it.
- **Muting.** Stop feeding the spotter while recording, while the transcript is on its way, and while a `say` plays, plus 300 ms for the room's echo. Create a fresh stream when listening starts again.
- **Measured on the Mac.** With 0.3 seconds of quiet before each phrase, 108 of 120 phrases in native English voices and 48 of 48 in accented OpenAI voices, no false wake in 1.56 hours of talk, 2 of 444 near misses. The phrase is caught 0.4 to 0.6 seconds after it ends. The browser build spent 39 to 58 ms per second of sound on one core, and the whole browser about a tenth of a core while waiting.
- **Unverified.** The Quest's microphones, their echo cancellation and gain, which `AudioRecord` source works, CPU and battery on the headset's cores, and real voices in a real room.

### WS8. Wireless adb. After headset
- `agent-wifi.sh`, measured: how long the connection lasts, what breaks when the headset sleeps, and how long the app takes to be live again.
- **Check.** Ten minutes untethered with a Scout run every minute, every one arriving.

### WS9. Anywhere. After WS8
- Try Tailscale Funnel from this Mac first (a WebSocket through it), then a Cloudflare named tunnel, then hosting, as measured in the comparison.

## Order and milestones

| Milestone | What you can do on the headset | Needs |
|---|---|---|
| M1, USB | See your trees, pinch for new picks, keep, cut | WS1, WS2, WS4, WS5 |
| M2, untethered at home | The same over wireless adb, with pictures, playable audio and the library | WS3, WS6, WS8 |
| M3, voice | Talk to it and hear replies | WS7 and your gesture |
| M4, anywhere | The same away from home | WS9 |

Started in parallel now: WS2 (agent core), WS3 (service), WS4 and WS5 on the Mac side, and WS1's scripts. Each runs on its own branch off `tracy/quest-agents` and is merged after review.

## Open, yours to decide

- The gesture that starts talking.
- Whether trees already saved on the headset are sent to the service once.
- Permission to download the build tools on this Mac, or the machine that builds the APK.
