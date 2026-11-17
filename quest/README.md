# Mind Palace Ocean on Quest 3

The visionOS ocean app (`visionos/MindPalace`, target `MindPalaceOcean`) carried over 1:1 to Meta Quest 3,
as a native Android app: OpenXR with passthrough and hand tracking, no engine. The scene's code is the
Swift ported file for file to C++ (`core/ocean`, see [PORTING.md](PORTING.md)); under it is a small layer
that stands in for RealityKit, UIKit drawing, AVFoundation and ARKit (`core`), with an OpenGL ES renderer
written for exactly what the ocean draws: unlit pictures and text, threads, dust, a hover glow, one video.

## Input

The Quest 3 has no eye tracking, so:

- **Head direction** drives what it drives on Vision Pro: the ocean's gaze zoom.
- **A hand ray** aims every look-and-pinch, and wherever the headset has its own reading it is used
  rather than worked out from joints: the ray is the system's aim pose (steadied by the headset) and a
  pinch is the system's pinch strength. A small dot shows where a ray lands: on a card, which glows as
  it did under the eyes, or on the glass blob under a group, so it is seen in the plane of the cards
  (a pinch on the glass still does what a pinch on nothing does). A pinched card follows the ray once
  it has swung more than 1.2 degrees (less than that is a tap); `-dragBy hand` has it follow the hand's
  own movement, as on visionOS. Two hands pinching do nothing more than two pinches (see below).
- **The custom gestures are the same code** but for the clap (see below): a fist pulled, pushed or carried,
  the flat-hand knife, fingers on the small tree. The knife and the clap have no system equivalent and
  are read from OpenXR's hand joints. A fist needs both the system's "grasp" reading at 0.9 or more and
  every fingertip curled to within 1.05 hand lengths of the wrist (the system alone calls a half-closed
  hand in the lap a fist); once made it holds until the hand clearly opens. The numbers are in
  `core/ocean/hands.h`.
- **A fist is read in one frame, and can be either thing until it commits** (`Hands::fist`, 15 Nov, late). The
  frame is set once as the fist closes: the normal of the layer you work on, at the place on it straight
  ahead of the fist the way you face, is the normal axis (pull and push), and the plane across it is where
  the tree is carried (`OceanModel::fistSurface`). Which of the two the fist is doing follows the whole
  movement since it closed: steeper than 52 degrees to that plane it is between layers, flatter than 38 it
  carries, and in the buffer between it stays what it was (a fist still nothing by 6 cm takes the nearer).
  It can change its mind: a carry that turns out to be a push is taken back (`panUndone`; the tree returns
  and the guide does not count it). It commits 9 cm across from where it closed, or at the first layer
  stepped, and from then on it is that until the hand opens. The Swift decides for good at 3.5 cm, which a
  first centimetre the wrong way got wrong for the whole gesture.
  Kai's words were "a perpendicular line to the nearest topmost surface". Every surface a fist acts on lies
  on the layer you work on, so that layer is the surface; but from inside a sheet 1.5 m off all round, the
  mathematically nearest place on it is nearly arbitrary (for a fist beside the body it is far off to the
  side, centimetres nearer than straight ahead), so the place is the one ahead of the fist. `-fistFrame
  nearest` takes the nearest instead, `-fistFrame eye` the place the fist is seen against (earlier that day), and
  `-fistFrame hand` is the Swift's. Not yet tried on a head.
  `desktop/test/hands_check.sh` runs made-up hands through it: pushes on and off the axis, carries, a change
  of mind each way, both commits, and the knife's pose and stroke.
- **Light on the hands** (`core/ocean/handglow.*`, Quest only), in the small tree's language of soft
  lines, rings and orbs. Round a closed hand, a gauge that goes where the fist goes. Its rings lie flat
  to the canvas and its gates stand along the line into it, because that is the frame the tree is
  carried and stepped in whichever way the fist is turned; a small plate in the middle tips with the
  fist itself. While it can still be either, the normal axis shows through where the fist closed, a small
  gate a little way along it each way (it goes once a carry has committed). A ring fills as the fist nears
  the distance at which it is first read; carrying the tree, a tail
  runs from where the fist closed to the fist, marked every 5 cm; between layers, gates slide through
  the fist's ring, an arc on the gate ahead filling until the step (a gate with no layer behind it is
  dashed). On the small tree only the index finger counts: that
  hand's pointer is hidden and the fingertip carries an orb that glows on a level and dims between two,
  a line joins it to the trunk at its height, and a ring closes round it as the thumb comes in to pick.
  `-glowDemo decide|pan|layer|layerEnd|tree` shows each without hands; pictures of them are in
  `preview-shots/`.
- **Weight.** The tree follows a carrying fist most of the way in 0.16 s rather than at once, so the
  hand's shiver does not reach it, and runs on a third as far as on visionOS when let go
  (`-panWeight <s>`, `-panCoast <s>`). The ocean's head zoom follows a line 15 degrees below where the
  headset points, which is where the eyes rest in it (`-gazeDrop <degrees>`).
- **When a gesture does not work in the headset**, the app says what it saw: once a second while a hand
  is in view it writes a `[hands]` line to the log and to `out/hands.txt` (each hand's pinch and grasp
  readings, how far its fingers reach, whether it has a ray and what the ray is on).
  `adb pull /sdcard/Android/data/com.kaifengwu.mindpalace.ocean/files/out/hands.txt`
- Hands only. Controllers do nothing.

## Joining the agent service

The agents (`agents/`, a service on the Mac) can grow the ocean's trees: your mindstorm's trees stand in the desk's
forest, a pinch on a card opens it and the Scout's picks come up round it with dashed threads, a pinch on a pick keeps
it, and the knife deletes. A piece of the ocean brought in with no tree standing asks Momo for a tree about it ("Make a
tree about Dracula"), and the service's tree, rooted on that piece of your library, stands when it comes. Brought into
one of the service's trees, it goes to the service as a kept card under the card in focus (`commands`, `addNode`),
drawn in progress until the service chooses its look, with Momo's rows like every card there
(`desktop/test/ocean_tree_check.mjs`). Palms together closes a tree; it is handed off by voice ("hand this off"). Under an open
card stand at most three suggested questions as pills, and a pinch held still on it, while a ring fills round the pinch,
asks for more like it. Gone into, the card has Kai's pen, eraser and Send: with the pen up a drag highlights words or
draws on the card, or along a video marks a stretch of it, which the service keeps with the card; one press of the
eraser takes every mark off, and Send asks Momo about all of them together (core/cards/README.md). The plan and
its state are in [agent-plan.md](agent-plan.md).

This build installs beside the app already on the headset, as "Mind Palace Ocean (agents)", because it is
signed on another machine (`QUEST_APP_SUFFIX=.agents` works on it; run `push_media.sh` once for it too).

```bash
(cd agents && npm start)                     # the service, on this Mac
QUEST_APP_SUFFIX=.agents quest/tools/run.sh --build
quest/tools/agent.sh usb                     # over the cable; `wifi` moves adb to Wi-Fi, `resume` after sleep
```

Launch flags: `-agent <address>` and `-agentToken <token>` join (agent.sh passes both); `-agentDump The%20words`
drops words in once connected (`%20` for spaces: the launcher splits flags at spaces); `-agentWalk <n>`
pinches the first new pick n times, for runs with no hands; `-agentLog` logs every change set.
A launch with `-agent` is remembered, with its token and `-cards`, in the app's own storage
(`agent-connection.json`), and a launch with no `-agent`, such as one from the app library, joins with them;
`-agentForget` (or `quest/tools/agent.sh forget`) forgets them, and the app starts as it was. The Mac preview joins
only with flags. Joined, the service's trees keep the forest's rules (Where it sits): at launch nothing stands and every
tree is put away on the desk where it stood last time (its plot, in `agent-shelf.json`); a tree asked for on the headset
stands, the standing one put away first; one asked for on the web page or Telegram is only put away. The headset's own
trees stay in their file, out of view, until it is started without the service. With the scripted service (`npm run dev:fake`)
nothing costs money.

Talking to it works as in the web client. The headset listens on the device for "hey Momo" or "hi Momo" (the
service's agent name), and nothing it hears leaves the headset unless it began with what its spotter took for the
name, or came in the conversation that opened (below). The spotter is set to miss the name seldom, and so also wakes
on about one near miss in eight ("hey mama", "hey Mo, more"): with each wake the second of sound that woke it goes to
the service, which writes it down and, unless it holds "hey" or "hi" and the name, drops the turn and has the headset
close the conversation, before Momo says or does anything (`agents/DECISIONS.md` 70; the chime has played by then). After the name it
chimes and records until you pause for 1.2 s; the service transcribes that and acts on it, and its reply is spoken
when the service has a voice. Momo sits low in front of you, drawn as in CurioCity (ClandestineOperation's
`AgentVisual`, with the values its scene gives it): three rings of Perlin noise in cyan, magenta and yellow, added into
one white ring a fifth larger than CurioCity's, with two tall white eyes that blink and
dart, and nothing behind it. The words are beside
it: yours in white as the voice hears them, then `Thinking…`, then Momo's reply in amber as it is spoken. Each line
of words stands on a bar of its own in the labels' ink, hard-edged and square-cornered as the ocean's labels are,
hugging its words; the bars of two lines meet, and a bar comes, rises and goes with its line. The ring
wobbles with your voice as you speak, 0.6 as far and as fast as with Momo's as it speaks (`Face::userMorph`), when it
also parts into coloured fringes. From the
moment your turn is sent until Momo answers, three bubbles form at its upper right: each swells up small at the base,
and as the next forms it eases the others one place out, growing, until the first is the largest at the far end, all
settled by 1.1 s; then each circles its own place, so the three turn through a line and a triangle. Once begun they
stay until they have settled, then fade gently, and Momo's voice never waits for them; any agents' lines stand above
them meanwhile. While any
agent works, Momo wears a monocle, in fine lines round the eye on your left, and its eyes glance about, and above
the words a small line for each agent at work says what it is doing (`Scout · Searching museum collections for dancing
people`, Momo's own web searches as `Momo (librarian) · …`); when an agent's last step ends its line says `finished
working` for 3 s and goes. A picture still being made keeps the Scout's line and the monocle until it lands. Nothing
else marks the agent's work: no word or light on the cards. Momo stays where it is while you look about and glides
round once you have turned away from it; `-presenceDemo` plays every state and look on a 38 s loop with made-up words
and agents, without the service. The first time, the headset
asks to use the microphone; refused, it does
not ask again until the app starts again, and replies are still spoken. A microphone that stops is opened again after
1, 2, 4, 8, then every 15 s. When the service has a live voice (hello's `live`), the headset opens its `/live`
socket, named for its own connection (hello's `connection`), and the words go another way: the name opens a
conversation. While it is open you talk with no name: whatever you say streams to the service as a turn until it says
your turn is over, and Momo answers you itself, in its own voice, which streams back and plays as it arrives: from what
it knows, a quick web answer, your saved cards, or by starting new cards, which it then tells you about as they land,
with no say of the pipeline's needed. Talking over Momo stops it at once and starts a new turn (`start`, the service's
hush and truncate): a turn begins once 3 of the last 4 tenths of a second were words, so a cough or a knock does not.
Momo's voice keeps the conversation open, and opens it again. It closes once nobody, neither you nor Momo, has talked
for 8 s; then the caption says `Say “Hey Momo”` again. While it is open between turns the caption says `Listening…`
under Momo's last words and the ring follows your voice. Momo's own voice is kept out of what the headset hears by the
platform's echo cancelling: the microphone reads Android's VOICE_COMMUNICATION source with AcousticEchoCanceler on, and
the log says which it got. `-echoCheck <reply.wav>` measures it with no service: a recorded reply plays 10 times while
you stay quiet (each turn begun is a false barge-in), then 10 times you talk over it (each logs how long after your
first word Momo stopped). `-chimeCheck` asks the same of the chime that says the name was heard: it plays 12 times
while you stay quiet (each turn begun is the chime taken for you), then 8 times while you say a short word over each
(each turn begun is you heard through it); worn, the chime alone left the microphone silent and every word was heard,
so on the headset the listener is not made deaf while the chime plays (`agents/DECISIONS.md` 71). It must be worn: lying
on a desk the microphone gives near silence whatever plays. The log says how long after your last word the turn ended and Momo answered. Without `/live`, or while it is closed (it is tried again every 5 s while hello offers it),
everything is as above. The voice says what it is doing and the orb shows it: waiting, listening from the name,
sent for 0.4 s as your turn ends, thinking until the first sound of Momo's answer (or word that none is coming, at
most 20 s), responding while Momo speaks, open while the conversation is, working while the agent works after it,
then waiting. Momo has three sounds of its own, made by `quest/sound/synth.py` in the ocean's key and played through
its mixer: the chime, a short falling tone as your turn is sent, and a quiet loop while Momo thinks. Nothing sounds
while the agent works. A question picked or typed under a card is sent and thought about the same way,
until Momo answers or the work starts. `-mute` silences every sound the app makes, Momo's voice too, and the orb still
follows the voice it would have heard. `-agentVoice off`
turns it off; `-wakeClip <file.wav>` (16 kHz mono 16-bit) is heard in place of the microphone; `-micSource
recognition` reads the recognizer's source, with no echo cancelling, and `-callMode` puts the app in Android's call
mode while the microphone is open, both to compare on the headset. The listener is sherpa-onnx's
keyword spotter, which `tools/fetch-voice.sh` fetches into `quest/vendor/` (the builds run it); `core/agent/test/run.sh`
tests it on spoken clips.

When the service moves the view (`navigate`, as for "go back to the start"), the headset brings the card into view
as hands would: it stands the card's tree, taking it off the desk and putting away the one that stood, then opens
the card on its layer, standing that layer first if it is not the one in view. A navigate to a tree stands it at its
root. It waits while you are recorded or Momo's reply is on its way or playing (at most 20 s), so the view moves after
the sentence, not during it. A pinch on a card whose parent has led no layer yet stands the parent's layer the same way
before the card opens. `node quest/desktop/test/navigate_check.mjs` runs the preview against a stand-in service
and checks this from its log.

## Where it sits

On visionOS the scene stands wherever the head was and faced at launch, and stays. On the Quest it is
seated at a desk and can be brought along (`core/ocean/desk.*`, `oceanmodel_desk.cpp`; none of it is in
the Swift).

- **The room.** Meta's MR Utility Kit exists for Unity, Unreal and the Spatial SDK only, so this app
  reads the scene model it is built on directly, through OpenXR (`XR_FB_scene`,
  `XR_FB_spatial_entity_query`; `android/.../room_android.*`). Only tables are kept. The room has to have
  been scanned once in the headset (Settings > Environment setup > Space setup), and the app has to be
  allowed to see it: the headset asks the first time a hand is held up in the app, not at launch, so a
  run with the headset lying on a desk is never held up by the question. Until then, or without a
  scan, there are no tables and everything below falls back. `-scanRoom` opens Space Setup from the app
  when the room is unknown; `-noRoom` never reads it.
- **The desk.** A table counts as the desk you sit at when one of its edges is in front of you no more
  than 75 cm ahead, you face it within 35 degrees of square, and its top is 22 cm to 1.05 m below the
  eyes (`-deskReach <m>`, `-deskSquare <degrees>`). Then the whole scene is squared to that edge rather
  than to the head, centred on you. Otherwise the scene faces the way you face and a desk is assumed:
  its top as far below the eyes as a 73 cm desk is (42 to 60 cm), its edge 28 cm ahead, 1.4 m by 75 cm.
  Either way there is a desk, and the things at hand stand on it:
  - the small tree, right in front of you, about 36 cm ahead of the eyes;
  - the trees put away, as a wood round you, each with its name in front of its foot. They stand at
    the desk's height (the desk is taken to be large: on an ordinary one they stand past its edges),
    none nearer than 1.5 m, in rings: two before you, 22 degrees to left and right, one further back
    between them, two at your sides, then on outward to 5 m; thirteen places, each trunk on its own
    line of sight. A tree is picked by its trunk, its pictures or its name, not by a box round the whole of
    it, so a hand ray passes between those to the trees behind. A tree can be slid over the desk by hand and stays where it is put (kept in the
    shelf file as `plot`);
  - what can be done with the standing tree, to the right of the small tree, square to the edge; the
    tray further right and back.
  The gardener's briefs stand where visionOS has them, before the forest's feet.
- **The forest has two states**, so that the desk is free while a tree is worked on:
  - *No tree open:* every tree put away stands there, about a metre tall (1.7 times its cover's own
    measure, `-forestGrown`) and with up to eight of its pictures round it. The pictures, and the
    tree's name, are 0.65 of the size the cover gives them and as much nearer the trunk, so a tree is
    about 1.2 m across.
  - *Round each tree's foot*, standing or sunk, rings lie on the ground as gravel is raked round a
    stone in a dry garden (枯山水): they set the tree off from the ocean behind it (`core/ocean/gravel.*`).
    They are marks, not circles, and stand between a tree's rings and a ripple. Eleven rings, none a
    true circle and all out of true together, unevenly spaced and wider apart further out, in three
    line weights: every third a heavy line in long strokes; the ones between fine and broken into
    round-ended dashes a few centimetres long; the last a fine, nearly whole edge. Small stones lie
    close round the foot, and a faint pool of light under it all. Each tree is raked its own way.
    Where two trees stand close, the nearer one's rings are whole and the further one's run up to its
    edge and end there. The rings draw in to the foot before a tree leaves its place and spread out
    from it again, over 1.2 s, once it has come to rest.
  - *A tree opens:* its tree of light goes to the front of the desk, where the small tree stands, and
    becomes it (turned and squashed on the way so the two agree level for level, one fading into the
    other in place). Its pictures stay where they were for a beat, then lift off one after another,
    60 ms apart, each already the card it stands for, and rise to that card's place on the layers. Its
    name goes, and its rings. The other trees shrink to half (`-forestScale`, five pictures, at 0.75)
    and sink to the ocean's floor, half as far off again along their own line of sight and no nearer
    than 3.3 m, past the foot of the layer you work on and clear of what stands on the desk, where a
    hand ray does not pick them. A new tree started from a brief or from
    the ocean sinks them all the same way.
  - *The tree is put away or sent:* it presses into its cover on the layer, and that cover itself
    comes down to its place on the desk, shrinking and turning as it comes, while the others rise
    again and grow. The small tree fades out; the briefs come back once the cover has landed.
  Anything that moves the whole forest glides over a second; the opening tree and the cover travel
  with a soft start and a long settle; nothing appears or goes in one frame.
  `preview-shots/forest-rings.png` shows six moments of it at this size (`forest-open-close.png` is
  the first, small version). `-noRise` opens a tree without the rising pictures, to compare timings.
- **Kept to the desk.** The scene's own space never changes; the host lays it over the room
  (`platform::carryScene`). While it sits at a real table it follows that table's anchor, so it stays
  on the desk when the headset corrects its own bearings.
- **Bringing it along.** When you have been more than 85 cm from where you sat, 40 cm higher or lower,
  or turned more than 75 degrees away for a few seconds, a small card comes up where you look:
  a dark card with a lit edge, about 30 cm wide: "You moved away" (or "You turned away") as a
  headline, "Reset the space here?" under it, and "Reset" and "Not now". It rises a little into place
  as it appears, and is heard. Resetting fades the whole scene out, seats it where you are
  now (at the desk there, if there is one) and fades it back; nothing in it changes. Recentring the
  headset does the same without asking. `-noSeatPrompt` turns the card off; `-reseatAt <s>` and
  `-seatPromptAt <s>` do each at a set time.
- **In the Mac preview** `-deskAhead 0.3` puts a table in the room (`-deskTurn`, `-deskBelow`,
  `-deskWide`, `-deskDeep`, `-deskAside`), and `-yaw`, `-moveX`, `-moveZ` with `-moveAt <s>` move the head away.

## Build and run

Needs the Android SDK (platform 34, build-tools 34, NDK 27.2, CMake 3.22) in `~/Library/Android/sdk`,
JDK 17 (`brew install openjdk@17`), and the headset over USB with developer mode on.

```bash
quest/tools/run.sh --build
```

The media (what the visionOS bundle carries as resources, about 700 MB) is not inside the APK. Copy it
to the headset once, after the first install; later runs send only what changed. Uninstalling the app
removes it, so update with `run.sh --build`, which installs over the old build.

```bash
quest/tools/push_media.sh
```

Every launch flag of the visionOS app works (`-demo`, `-walk 3`, `-brief 1`, …), after `--`:

```bash
quest/tools/run.sh -- -demo -mute
```

```bash
quest/tools/run.sh --log
```

The host adds its own: `-hz`, `-scale`, `-msaa`, `-ffr`, `-cpuLevel`, `-gpuLevel`, `-cull`, `-noBatch`,
`-uploadBudget`, `-perf`, `-quitAfter`, `-shotAt`, `-shotEvery`, `-testScene`, `-noRoom`, `-scanRoom` (described at the top of
`android/app/src/main/cpp/main.cpp`).

## The judging build

One APK a judge installs and opens, with nothing else to do: "Mind Palace" (`com.kaifengwu.mindpalace.ocean.judge`),
installed beside the two apps above and replacing neither.

```bash
quest/tools/judge.sh             # build it and check its id, name, signature and the media inside
quest/tools/judge.sh --install   # and install it on the headset on the cable
```

- **Its service.** It joins the service named in `~/.mind-palace/judging.properties` (`server=https://…`, `appKey=…`) by
  itself, with the cards, and never reads or keeps `agent-connection.json`. Started with `-agent`, it joins that one, as
  given, for that launch only. Its token is `<appKey>.<device id>`, sent wherever a token goes (`?token=` and the
  Bearer header): the id is 32 hex digits made on its first launch and kept in its own files (`device-id`), so the
  hosted service keeps each headset's mindstorm apart. Developer builds send their token as before.
- **When it can't reach the service**, Momo shows with "Can’t reach Momo, retrying" in its caption, and the app tries
  again after 1, 2, 4 and 8 s, then every 15 s.
- **The microphone.** The first time, Momo's caption says "Allow the microphone to talk to Momo", and the system asks
  1.5 s later. Refused, the caption says "No microphone, so type or pick to ask Momo" for 10 s, and typing and picking
  work as before.
- **The room.** As in every build, the first time a hand is held up the system asks whether the app may see the room,
  so the scene sits at the real desk (Where it sits). Refused, it sits at an assumed desk. The two questions never meet:
  one asked while the other is up waits for its answer (`MainActivity.askPermission`), since Android cancels a second
  request outright. Passthrough and hands need no permission while the app runs.
- **The media** (about 780 MB) is inside the APK, stored uncompressed under `assets/media` with the list of it
  (`index.txt`), and read from there: pictures by `ImageDecoder` from the APK, films by `MediaPlayer` from the APK's
  own file, text and sounds through the NDK's asset manager, Fraunces by `Typeface.createFromAsset`. Besides the
  library's media it carries the app's own, from `media-src/quest`: the sounds (about 80 MB), the guide's hand model
  and the greeting's two fonts with their notice. Nothing is copied out at first launch.
- **Signing.** Release-signed with `~/.mind-palace/keys/judge.jks`, its passwords in `keys/judge.properties` beside it.
  A later APK installs over this one only if it is signed with the same key, so keep both. Raise `version` in
  `judging.properties` for each APK handed out.

## Measuring performance

```bash
quest/tools/perf.py
```

One run is one scripted scenario on the real headset, hands-free: the launch flags drive the same
functions a hand would, and the headset is told it is being worn, so it tracks, draws and runs its
clocks as it does on a head. The script joins the app's own line per frame (CPU time split into update
and drawing, GPU time, draw calls, the gap between frames) with the compositor's line per second (frames
shown, stale frames, the app's GPU time as the system measures it, load, clock levels, temperature),
prints a summary and keeps it as JSON in `quest/perf/`.

```bash
quest/tools/perf.py --flags "-walk 4 -mute" --seconds 30 --label walk4
```

```bash
quest/tools/perf.py --save-baseline
```

```bash
quest/tools/perf.py --compare quest/perf/baseline.json
```

```bash
quest/tools/perf.py --profile 10
```

```bash
quest/tools/perf.py --sweep "-hz 72" "-hz 90" "-ffr 0" "-scale 1.2"
```

`--compare` exits with 1 when a run is worse than the baseline by more than its margins (CPU and GPU
time at the 95th percentile, late frames, draw calls, stale frames), so it can gate a change.
`--profile` samples the CPU with simpleperf and lists the hottest functions. With `-perf` (which
the script passes) or `-fps`, the app also writes a `[hitch]` line to the log for every frame that took
more than 13 ms, saying how much of it went to text layout, rasterising, picture decoding
and texture upload; the whole log of the last run is kept in `quest/perf/last-log.txt`.

The headset can interrupt a run by itself: its boundary dialog appears when it loses its bearings on a
desk, and a nudge can wake its wear sensor. The script notices (the session stops), says so, and runs
again up to `--retries` times. If it keeps happening, put the headset on once and confirm the boundary.

`quest/perf/baseline.json` is the scripted demo (60 s, release build, 90 Hz, default settings) on
2026-11-14: 0.02 % late frames (1 of 5,131), CPU 2.1 ms at the median and 3.6 ms at the 95th percentile,
the worst frame 8 ms, 1.8 ms of GPU as the compositor measures it, at most 118 draw calls. The
compositor's own stale-frame count swings between about 15 and 55 from run to run of the same build.

For numbers that can be compared: put the headset on a stand facing the same way each time (what is in
view is what is drawn), let it cool between runs, and use the release build (`run.sh --build --release`,
which also compiles the app's Kotlin ahead of time on the headset).

## Loading without stutter

Nothing slow runs on the frame thread if it can run elsewhere (`core/async.*`, one background thread),
and what must run there is spread over frames:

- **Card pictures.** The drawing calls for a card are recorded on the frame thread (its size comes from
  measuring text, which stays there) and turned into pixels in the background. The card's picture is a
  texture whose size is known and whose pixels are on their way; the renderer simply does not draw it
  until they are there, then sends at most 3 ms of new pictures to the GPU per frame.
- **Work pictures.** A card a few centimetres wide is drawn from a small copy of the work's picture
  (`works-small/<id>.jpg`, 512 px, made by `tools/push_media.sh` into `media-src/quest`): unpacking the
  1600 px original costs the headset about 55 ms, the small copy about 4. It is unpacked in the
  background, and the card waits its turn in the build queue until it is ready. The full picture an open
  work shows, and the two atlases at launch, are unpacked in the background too.
- **A tree's cards** are made over the few frames after it is stood up, about 3 ms' worth a frame and
  each before it is due to appear, not all in the one frame (`-standBudget <ms>`).
- **Saved trees' covers** are hung one a frame after launch, the most lately saved first, so the shelf
  can grow without the launch growing with it.
- **Film players** are made and let go on their own thread.
- **What you see while waiting.** Anything that arrives within about 0.15 s just appears. A card that
  waits longer shows as a faint film of light, the size it will be, with a slow sweep across it, and
  its picture fades in over 0.25 s when it arrives.

`-syncRaster` puts picture drawing back on the frame thread to compare; `-slowRaster <ms>` delays each
picture so the waiting look can be seen; `-rasterTest` checks the background path on the headset before
any session starts.

## Sound

The visionOS app has no sounds of its own yet; these are the Quest's (and the Mac preview's).

- **The sounds** are synthesized by `quest/sound/synth.py` (numpy, scipy): about 80 wav files, 80 MB, all in
  one key (D Lydian) so anything that overlaps agrees. Each layer has a chord, a stack of fifths that
  climbs a step per layer; single things (a card that arrives, a level of the small tree) have single notes.
  They are in git, in `media-src/quest/sounds`, so a clone has them without numpy or scipy.
  `tools/push_media.sh` makes them again only when the script is not the one they were last made by (its
  hash is kept in `sound/made-by.sha`; the script gives the same files every time), and sends them with
  the rest of the media. Without them the app runs silent.
- **The mixer** is `core/audio.*`: one-shot voices and loops whose level can be eased, mixed on the audio
  thread without locks. `android/.../audio_android.cpp` plays it through AAudio while the session runs;
  `desktop/audio_mac.cpp` through the Mac's output.
- **When each is heard** is in `core/ocean/oceanmodel_sound.cpp` and at the place each thing happens
  (`sound("take")` in `take`). The layer's chord is struck whenever the layer you stand on changes, by any
  means: upward on coming nearer, downward on stepping back. While a fist nears a layer's gate, that
  layer's chord is held and swells with the gauge's arc. The cards the gardener brings sound one note each, up
  their layer's chord. On the service's trees, where a press opens a card where it stands, the press sounds the
  card's own note: its layer's chord, by its place among its parent's cards (`soundCard`), so neighbours differ; and
  the cards the service brings sound one note each as the gardener's do (`desktop/test/click_notes_check.mjs`,
  which shows what was played with `-soundLog` and writes it to a file, heard by no one). The ocean's bed draws back under a film's sound. While Momo
  listens, thinks or speaks, the bed, the layer chords and the glints play about 9 dB down (`conversationDip`).
- **Momo's own** are `momo_chime`, `momo_sent` and `momo_thinking` (a loop), made by `momo()` in synth.py from its
  own random numbers, so the ocean's sounds stay as they were; `core/agent/voice.cpp` plays them.
- **The ocean** has a held sound under everything, kept very low, and glints: a piece that swells where
  the head points rings a short high note of its own (`Shell::swelled`, `soundGlints`). One is heard for
  every few degrees the look travels, so a slow look round is a glint now and then, a quick one a run of
  them, and a head held still none. They are fainter while a tree stands, and fainter still under a film.
- **Flags:** `-mute` or `-noSound` for none, `-sound <0…1>` for how loud (0.8), `-soundLog` to log each sound
  as it is asked for; `-oceanBed <0…2>` and `-glitter <0…3>` for how loud the ocean's held sound and its
  glints are, of what they are made at. In the preview, `-soundOut <file.wav>` (with `-shot`) writes what would have been heard.
- **To listen to them one by one:** `sketches/sound/index.html` (not in git), fed by
  `python3 quest/sound/synth.py --page sketches/sound`.

## The guide

(The reasons, and the standards behind them, are on the design board, `sketches/onboarding/index.html`, not in git.)

- **The welcome tree**, once: on a first launch a tree stands by itself, "Welcome to Mind Forest". It is an
  ordinary tree whose cards are the lessons, eight of them, one a layer: pinch a card, grab to pan, grab
  to pull or push, pinch and hold to move, ask Momo, show Momo part of a picture, choose a layer on the
  small tree, palms together to close. The cards are notes made in code (`addWelcomeNotes`), each drawn as a premade
  card of the card library (`core/cards/lesson.cpp`) in the look of the others, with or without `-cards`,
  and each with a few pictures round it so that its layer is a real one. The walk (`updateTour`) is always
  at some lesson and that lesson at some beat, and it never leaves you with nothing to read:
  - **One line over the tree** says the one thing to do now, large, with where the walk is before it
    ("3 of 8 · Close your hand and pull it toward you"). It changes with each beat, not each card.
  - **What to act on is pointed at**, in the accent: a line round it that breathes and rings out, and
    arrowheads running to it along a path (`drawMarks`). The next card from the first; either way under
    the card for panning; a picture and a dashed place to put it for moving; the picture, then its tools,
    then a dashed round on the face for marking; the small tree, with the way down to it; Put away.
  - **The open lesson plays its gesture on its own face.** Opened, a lesson's card is its step as the
    badge ("Step 3 of 7"), the lesson's name, the stage where the hand plays the gesture (for marking, the
    picture to mark), and what to do in the lesson's own words. The hand is at its full size (`stage` in
    the lessons' table), in the middle of a stage 35 cm tall (`lessonStageTall`) that holds all it draws;
    the card is as tall as that and the words, taller than the library's cards, and never scrolls.
    Closed, every lesson is its number on a plain ground over its name, always on the right of the open one.
  - **Beats.** Pulling is two (pull; then "Now push it away to come back", with pull and push playing on
    the layer pulled back to). The picture is five (go in; take up the pen; draw; pinch Send, which is
    ringed; say a word about it), the last four said along the foot of the picture on the card itself.
  - **Done, then the next card.** A lesson done is a chime, a tick where its gesture played (it stays
    there while the card is shown) and "Done. Pinch card 4 to go on", with that card ringed and
    arrowheads running to it. Pinching it is the next lesson (as it is at any time: that is the skip,
    and it is said so after 14 s on a lesson not done).
    Left alone for 15 s the walk takes the card itself (`-guideAutoAfter <s>`); after the small tree, which
    leaves you on another layer where the next card is not to be seen, it does so after 4 s.
  - **Two lessons are done by talking to Momo** (15 Nov, once Momo was in the build; `tourTalk`). The
    fifth: say "Hi Momo, what can you do for me?", and Momo answers with a layer, "Here is what I can do",
    a card for each of five things to ask for in words that work (start a tree, find new things, look in
    what you saved, more like this, hand it off). The sixth: draw round part of a picture, pinch Send,
    then say what you want to know; Momo answers with a layer, "From your sketch", that quotes what was
    said. A talking lesson's own card has no next card beside it: the way on is from the layer Momo
    answered with, which is that lesson's too (`TourStep::result`).
    The cards of both layers are the walk's own (`addWelcomeNotes`, `tourMarkNote`), so the walk goes the
    same way with the service or without it, and the sketch's layer is a stand-in that says so: the
    walk's picture is not one Momo knows. What is real is the listening. While a lesson waits for
    words, Momo's ears are lent to the walk (`agent::Voice::Tutor`, the only change to the agents' code:
    `core/agent/voice.*`, `Bridge::talk`): the name and then the words come to the walk, turns are
    recorded and transcribed and never streamed to /live, and the service is not told, since it might
    stand a tree of its own in the walk's place.
    Nobody is left waiting. A line over the lesson says how it is going, and where speaking cannot work,
    or has failed twice, or 32 s have gone by, a button under it, "Go on without speaking", does what the
    words would have done:
    - Momo is not in this copy, or is joined and not listening yet (the service has not answered); the
      microphone was refused, is being asked for, or is not on;
    - nothing is said for 14 s ("Say it out loud, and begin with “Hi Momo”");
    - the name and nothing after it ("Say it all in one go");
    - something else is asked (fifth lesson only: for the sketch any words are taken). It is quoted
      back: Momo heard “…”. Keep that for after the walk: now ask what it can do.
    What counts as asking what Momo can do is loose (`asksWhatItCan`), since a transcript is seldom
    word for word. Outside these two lessons Momo is Momo: a tree asked for then replaces the welcome
    tree, the walk ends, and the greeting follows.
    Under `-cards` (how a joined copy and the judging build run) the walk's own cards keep the ocean's
    drawing (`cards::ocean::cardOf`): as cards of the agent's, a lesson was a small card saying "Picture
    unavailable" with no stage for its gesture.
    `tools/judging.sh [-- flags]` joins a developer copy on the headset to the hosted judging service from
    `~/.mind-palace/judging.properties`, with a token made as the judging build makes its own, printing
    neither key nor token; `tools/judging.sh preview -- …` does the same for the Mac preview. That is how
    the fifth lesson was run against the real service (16 Nov, preview, spoken clips through `-wakeClip`:
    "start a tree on trains" turned back, "what can you do for me?" answered).
    `desktop/test/walk_talk_check.mjs` runs the fifth lesson through the real listening against a
    stand-in service. In the preview: `-guideHear ready|starting|asking|refused|off|none`,
    `-guideWokeAt <s>`, `-guideSayAt <s> -guideSay <words_with_underscores>`.
    Not yet tried on a head, nor against the real service.
  - **Off the walk.** A picture or a film followed instead of a lesson: over what opened, "You have left
    the walk", with Back to step N and Skip the tutorial; the lesson's own card, where it shows, is ringed
    as well. Skipping ends the walk and leaves the tree as it is; what was not done is shown later in its
    place, by the ghost hand.
  - **Nothing empties the view.** A lesson's card is not gone into (a pinch on the open first card, or on
    one that is done, moves on instead), and a pinch that misses does not close the open lesson.
  - Putting the tree away, by hand or by button, ends the walk at any point; palms together on this tree
    only puts it away, and only one welcome tree is ever kept among the trees put away (the walk taken
    again replaces it). With no hands seen for 5 s it asks for them.
- **After the walk** (done, put away early or skipped), once nothing stands: a greeting, as a headset
  greets you after its own setting up (`showHome`). "Welcome to Mind Forest" in Fraunces, white and
  large, standing free in the room on no card, a word at a time; under it and much smaller, "Start
  exploring now by" in Fraunces italic and the three ways to begin, each with its number (pinching a tree,
  pinching an item, talking to Momo), and a Start exploring button. It has the room to itself: the kept
  trees stay down on the ocean's floor and the questions wait. It goes at its button or as soon as
  something is begun; the trees then come up to the desk, the questions appear, and the three numbers
  stand in the room by a tree, over the ocean and at the questions for 14 s. Shown once (`home` in
  `ocean-guide.txt`).
  The face is that of Muse's Garden's title, as Kai asked: Fraunces 72pt Soft Light and its italic (SIL
  Open Font License), two more of `Font::Weight` (`display`, `displayItalic`). Their files are in git with the
  rest of the app's own media: `media-src/quest/fonts/`, sent by
  `tools/push_media.sh` to `media/fonts/` on the headset. The Mac preview reads the same files. Without
  them the platform's own serif stands in. "Momo" is Kai's word (2026-11-15); this build has no Momo yet,
  so its number stands at the questions still headed "Ask the gardener".
- **A ghost hand in context**, on a small card (half the size it first had, its ground half see-through,
  only the gesture's name under it: as Kai asked on 2026-11-15, it took too much room and ran into what
  stood near it), for what was skipped or is not on the tour: grab to pull or push (once a
  second layer exists), grab to pan (after the first step), marking (a card gone into for 6 s), the small
  tree (at three layers, shown over the tree itself), cutting (at eight cards). Each waits 10 s for you
  to do it yourself, plays three times and rests, comes back once a minute later, and is retired for good
  the first time you do the thing. A closed hand of your own sends the grab ones away at once: the gauge
  round it takes over. None comes during the welcome tree's walk.
- **A few words by things** that need no new gesture: by the ocean, under a lifted piece, and over the open
  card ("Pinch a card round it to follow it", "Pinch this card again to go in"); and when a card has been
  gone into for 12 s ("Pinch empty space to step back").
- **Gestures**, a button beside the briefs and beside the tree's own controls: every gesture's name in a
  column and the one picked playing beside them, with Take the tour (the welcome tree again) and Start the guide over.
- **The hand** is the headset's own model of a hand, posed by bending its joints (`core/ocean/guidehand.*`,
  the nine gestures in `guidegestures.cpp`) and drawn as a line: `Material::Kind::ghost` draws a shape
  three times over, unseen for depth, faintly for its body, and swollen and inside out for an edge of
  even weight. What the hands act on is drawn in the line material, as the small tree is.
  The model is in git (`media-src/quest/hands/`), and `tools/push_media.sh` sends it with the rest of the
  media. To take it from a headset again: `tools/run.sh -- -dumpHandMesh -quitAfter 8` writes it there and
  `adb pull …/files/out/hand-right.bin media-src/quest/hands/` fetches it. Without it the guide is off.
- **What has been learned** is kept in `ocean-guide.txt` beside the shelf's file.
- **Flags:** `-noGuide`; `-freshGuide` forgets what was learned (the welcome tree stands again);
  `-guideWelcomed` starts past it; `-guideDemo tour|sheet|<gesture>` (pinch, carry, layers, drag, hold, mark,
  tree, clap, cut) shows one thing at once and keeps it up, `-guideT <s>` holds it at that second of its
  loop; with `-guideDemo tour`, `-guideStep <n>` walks to the nth lesson by itself (a card every 3.6 s),
  `-guideDone` keeps a lesson as it is just after it is done, `-guideBeat <n>` sets the beat,
  `-guideSkipAfter <s>` how soon the skip is offered, `-guideAutoAfter <s>` how long a done lesson waits
  for a pinch, and `-guideOff <s>` follows a picture off the walk at that second. `-guideDemo home` is the
  greeting after the walk (`-guideHomeClose <s>` leaves it).

## What the hands do differently from visionOS

- **A card has two sizes**, as it opens and gone into: a pinch on the open card each way. There is no
  size between, and no zoom with both hands (without gaze nothing says what two pinches are spreading).
- **Marking is by pen.** Gone into, a card has three icons down from its picture's top right corner, just
  outside it (`layTools`, `pickTool` in `oceanmodel_tree.cpp`; they keep their own size, 10 cm, as the
  card grows). While a hand's ray rests on one, a flat tag as tall as the button comes out to its right
  and says what it is for: Comment, Erase, Send to Momo (`-toolHover <0…2>` holds one out). The pen: a pinch takes it up or puts it down, and while it is up (shown in the accent) a drag on
  the card marks it as what lay under where the drag began would have it: a picture is drawn on, words
  are highlighted, a video's stretch is taken (its bar shows when the pen is taken up; a marked stretch
  has a handle at each end, which a later drag takes it by). With the pen down a drag does nothing (on a
  card drawn as one of the agent's, `-cards`, it scrolls the card). The eraser takes the mark off. Send,
  light once something is marked, asks about it (`askMark`). On a card of the agent service's the pen's
  highlights, lines and stretch are kept by the service, one press of the eraser takes them all off, and Send
  asks Momo about them together (core/cards/README.md).
  The pen's icon is the app's own, the one the marking gesture's diagram draws (a pen at a slant and the
  mark under its nib), and in hand it lights in the accent as it does there; the eraser and send are
  Lucide's (ISC). All are kept as the lines of their strokes in `core/ocean/icons.h`, which
  `tools/icons.py <a copy of lucide-react>` writes.
- **A tap is a pinch that never went anywhere** (`pinchEnded`): judged by the furthest the hand got from
  where it began, not by where it ended. A line drawn round something comes back to its start, and used
  to be taken for a tap on the card, which closed it the moment the drawing was done.
- **A picture is marked with a marker.** With the pen up, a pinch held and moved draws on the
  picture freely, a little steadied, stroke after stroke (`drawInk`: one mesh of soft-edged bands in the
  accent on the card's face). What is marked, and what the gardener is asked about, is the part of the
  picture the strokes cover between them; a dab too short to be a stroke is taken off again.
- **The knife is a pose that is made and held** (`Hands::read`, `Hands::blade`, 15 Nov, late). Any open hand
  with its fingers together used to be one, so a blade showed beside the pointer of nearly every hand.
  Now: every finger straight from knuckle to tip and in the palm's plane, the fingers together, the hand
  on its edge (the palm facing neither up nor down, neither at you nor away), no pinch coming, the other
  hand not within 22 cm, all held for 0.45 s (each measure was asked a little more of after Kai wore the
  first set: it could "still be a little bit harder to make"). A ring closes round the middle fingertip over that time;
  then the blade is out, with a sound, and that hand's pointer is put away (`pointerHidden`), so there is
  one line on the hand. It holds through 0.18 s of lost pose, since a fast stroke blurs the fingers.
  `-knifeLog` prints what each hand reads once a second, for tuning the numbers in `hands.h` on a head.
  Not yet tried on one: if the pose proves too hard to make, those are the numbers to loosen.
- **The blade points, and shows where it cuts** (`HandGlow::blade`, `Hands::blade`, `oceanmodel_cut.cpp`).
  It is one line in the accent, the way the hand points (wrist through middle fingertip, steadied over
  40 ms): from the heel of the hand, brightest just past the fingertips, and on, thinner, all the way to
  the layer. Where it lands there is a mark on the layer (a ring with four ticks), and that place is what
  cuts; a stroke leaves a quarter-second trail there, and the thread within four degrees of the mark
  lights. A stroke is the mark's travel on the layer over 60 ms at 2 m/s or more (a hand turning about 95
  degrees a second; one frame's jump in the tracking was a stroke before), and it cuts the thread it is
  seen to pass over, carried only a little past its ends. `-glowDemo blade` shows it without a hand.
  One stroke makes one cut: after a cut lands nothing cuts for 0.8 s, and then not until the mark has come
  to rest (under 0.5 m/s for 0.2 s), so a hand that shakes or tracking that jitters cannot make the second
  cut that confirms.
  (The first version put the mark where the blade's end was seen against the layer from the eyes. In the
  headset the line then pointed above its own mark, the hand being below the eyes: Kai, 15 Nov.)
- **Cutting takes two steps** (`oceanmodel_cut.cpp`). A slice across a thread, or a pinch on one, marks
  it for cutting: "Cut again to confirm" stands on it for five seconds while a ring runs down. A second
  slice across it, or a pinch on those words, cuts it; a pinch on nothing, or waiting, lets it be. The slice itself is easier to
  make than on visionOS (0.8 m/s, not 1.1), since it no longer cuts by itself.
- **The clap is palms together, held** (`Hands::clap`): fingers up as they meet, palms within 8.5 cm of
  each other for one second, while a ring round the hands fills (`HandGlow::Hold`). Hands that only pass
  each other no longer press the tree. Joined to the agent service it only closes the tree, on every
  tree: a tree is handed off by voice. Not yet tried on a head: how the headset reads two hands pressed
  together is the thing to check first.
- **Marker strokes follow the card's curve**: each point is bent as the card's own pieces are, and bent
  again whenever the card's bend changes (going in, coming back).
- `-toolAt <s>` with `-tool pen|eraser|send` (and `-toolAt2` with `-tool2`, on to 4), `-armCutAt <s>`, `-cutAt <s>`,
  `-glowDemo blade|hold` do these without hands; `-bendLog` writes the open card's bend radius beside its sheet's twice a second.
## Notes from the agents merge (15 Nov)

For Kai: what merging this branch into the agents work (tracy/agents) changed or left open in yours.

- **The greeting's Momo line.** The third way to begin still says "Talking to Momo, pinch a question to begin", as
  you wrote it. In the agents build you talk to Momo by saying "hey Momo" (or "hi Momo"); a pinched question is
  sent to Momo too, so the line is not wrong, only not the whole of it. It is yours to change.
- **Momo and the desk.** Momo floats at a fixed place from the head, about 28 degrees below the eye line and
  1.25 m out (`core/agent/presence_look.h`). Looking down at the desk, that is where the gardener's questions and
  the Gestures button stand, and in the Mac preview Momo covers them. Not yet seen on a headset. If it covers them
  there too, Momo can be raised to 18 to 20 degrees below the eye line.
- **Palms together closes, everywhere.** Joined to the service, palms together closes the tree on every tree,
  the service's too, and never sends it on. A tree is handed off by voice only ("hand this off"), and the strip's
  "Send to image generation" is not shown while joined. A handoff gesture or button may come later. Without
  the service, your clap is as you made it.
- **The pen, the eraser and Send are wired to the service.** On a card of the agent service's, the pen's
  highlights (a drag from words) and lines (a drag from anywhere else) are the service's own edits, kept with
  the card (`addEdit`, agents/docs/protocol.md, Edits on a card): they come back on any headset and "undo" takes
  the last back. They are drawn as the agents' cards draw them, amber behind words and a white line, not your
  marker. A card keeps up to 100. A video's stretch is drawn as your mark and kept by the service too, one a
  card: a new stretch takes the old one's place, and one undo brings the old one back. The eraser works as
  yours does: one press takes every mark off, as one change that one undo brings back. Send asks Momo about all
  the card's marks together ("Tell me more about these parts: …"), naming the highlighted words, the lines and
  the stretch by its times; the card leads a new layer and Momo answers. With the pen down, a pinch
  held still on the open card asks for more like it, and a drag scrolls the card. On your own trees all three
  work as you made them. The Gestures sheet has a row for the pinch held still, and the marking gesture draws
  all three buttons where the card has them (agents/DECISIONS.md 66).
- **The forest keeps the service's trees.** They stand in your forest and keep their plot between launches in
  `agent-shelf.json` (version 2), as your trees keep theirs in the shelf file.
- **The room and the microphone are both asked,** in every build: the room at your moment, the first time a
  hand is up, and the microphone with Momo's reason first. One asked while the other is up waits for its
  answer (`MainActivity.askPermission`).
- **The app's own media is in the judging APK:** the sounds, your hand model and the two Fraunces files, read from
  inside it. Fraunces is now `Font::Design::display` with its own face bit, not two more weights, which the
  agents' serif bit had taken.

## Looking at it on the Mac

```bash
quest/desktop/build.sh
```

```bash
quest/desktop/preview -demo
```

A window with the same scene and renderer, one eye, the mouse for a hand (move: the ray; click: pinch;
right-drag: turn the head; scroll: magnify). No video and no hand gestures. For a picture without a window:

```bash
quest/desktop/preview -walk 3 -shot /tmp/walk.png -shotAt 6
```

## What is where

See the table at the top of [PORTING.md](PORTING.md).
