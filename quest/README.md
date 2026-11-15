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
  own movement, as on visionOS. Two hands pinching magnify.
- **The custom gestures are the same code**: a fist pulled, pushed or carried, the flat-hand knife, the
  front-to-back clap, fingers on the small tree. The knife and the clap have no system equivalent and
  are read from OpenXR's hand joints. A fist needs both the system's "grasp" reading at 0.9 or more and
  every fingertip curled to within 1.05 hand lengths of the wrist (the system alone calls a half-closed
  hand in the lap a fist); once made it holds until the hand clearly opens. The numbers are in
  `core/ocean/hands.h`.
- **Light on the hands** (`core/ocean/handglow.*`, Quest only), in the small tree's language of soft
  lines, rings and orbs. Round a closed hand, a gauge that goes where the fist goes. Its rings lie flat
  to the canvas and its gates stand along the line into it, because that is the frame the tree is
  carried and stepped in whichever way the fist is turned; a small plate in the middle tips with the
  fist itself. A ring fills as the fist nears the distance that commits it; carrying the tree, a tail
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

The agents (`agents/`, a service on the Mac) can grow the ocean's trees: your mindstorm's trees stand and
hang on the shelf, a pinch on a card opens it and the Scout's picks come up round it with dashed threads,
a pinch on a pick keeps it, the knife deletes, and a clap sends the tree on as a handoff. The plan and
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
Without `-agent` nothing changes. With the scripted service (`npm run dev:fake`) nothing costs money.

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
`-uploadBudget`, `-perf`, `-quitAfter`, `-shotAt`, `-shotEvery`, `-testScene` (described at the top of
`android/app/src/main/cpp/main.cpp`).

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
