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
- **A fist's frame** (which way is "into the canvas" for the gauge and for pull and push) is the canvas's
  own where the hand is seen against it: the line from the eyes through the hand, followed out to the layer
  you work on. From the middle of the scene that is the hand's own bearing, as before; leaning in or sitting
  off the middle, the gauge still lies flat to the canvas behind it. `-fistFrame hand` is the old way.
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
  layer's chord is held and swells with the gauge's arc. The ocean's bed draws back under a film's sound.
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
  ordinary tree whose cards are the lessons, seven of them, one a layer: pinch a card, grab to pan, grab
  to pull or push, pinch and hold to move, mark part of a picture, choose a layer on the small tree,
  palms together to close. The cards are notes made in code (`addWelcomeNotes`), larger than other notes,
  each with a few pictures round it so that its layer is a real one. The walk (`updateTour`) is always
  at some lesson and that lesson at some beat, and it never leaves you with nothing to read:
  - **One line over the tree** says the one thing to do now, large, with where the walk is before it
    ("3 of 7 · Close your hand and pull it toward you"). It changes with each beat, not each card.
  - **What to act on is pointed at**, in the accent: a line round it that breathes and rings out, and
    arrowheads running to it along a path (`drawMarks`). The next card from the first; either way under
    the card for panning; a picture and a dashed place to put it for moving; the picture, then its tools,
    then a dashed round on the face for marking; the small tree, with the way down to it; Put away.
  - **The open lesson plays its gesture on its own face.** Closed, every lesson is its number on a plain
    ground, always on the right of the open one.
  - **Beats.** Pulling is two (pull; then "Now push it away to come back", with pull and push playing on
    the layer pulled back to). Marking is four (go in; take up the pen; draw; come back out), the last
    three said along the foot of the picture on the card itself.
  - **Done, then the next card.** A lesson done is a chime, a tick where its gesture played and "Done.
    Pinch card 4 to go on", with that card ringed and arrowheads running to it. Pinching it is the next
    lesson (as it is at any time: that is the skip, and it is said so after 14 s on a lesson not done).
    Left alone for 15 s the walk takes the card itself (`-guideAutoAfter <s>`); after the small tree, which
    leaves you on another layer where the next card is not to be seen, it does so after 4 s.
  - **The way out of the marked picture** ("Pinch empty space to come back out") has a place shown for it:
    a ring just off the card's right edge, "Pinch here", and arrowheads running to it from the words.
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
  the eight gestures in `guidegestures.cpp`) and drawn as a line: `Material::Kind::ghost` draws a shape
  three times over, unseen for depth, faintly for its body, and swollen and inside out for an edge of
  even weight. What the hands act on is drawn in the line material, as the small tree is.
  The model is in git (`media-src/quest/hands/`), and `tools/push_media.sh` sends it with the rest of the
  media. To take it from a headset again: `tools/run.sh -- -dumpHandMesh -quitAfter 8` writes it there and
  `adb pull …/files/out/hand-right.bin media-src/quest/hands/` fetches it. Without it the guide is off.
- **What has been learned** is kept in `ocean-guide.txt` beside the shelf's file.
- **Flags:** `-noGuide`; `-freshGuide` forgets what was learned (the welcome tree stands again);
  `-guideWelcomed` starts past it; `-guideDemo tour|sheet|<gesture>` (pinch, carry, layers, drag, mark,
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
  has a handle at each end, which a later drag takes it by). With the pen down a drag does nothing. The
  eraser takes the mark off. Send, light once something is marked, asks about it (`askMark`).
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
- **Cutting takes two steps** (`oceanmodel_cut.cpp`). A flat hand shows as a blade of light, and the
  thread it points at lights in the accent. A slice across a thread, or a pinch on one, marks it for
  cutting: "Cut" stands on it for five seconds while a ring runs down. A second slice across it, or a
  pinch on Cut, cuts it; a pinch on nothing, or waiting, lets it be. The slice itself is easier to make
  than on visionOS (0.8 m/s, not 1.1), since it no longer cuts by itself.
- **The clap is palms together, held** (`Hands::clap`): fingers up as they meet, palms within 8.5 cm of
  each other for one second, while a ring round the hands fills (`HandGlow::Hold`). Hands that only pass
  each other no longer press the tree. Not yet tried on a head: how the headset reads two hands pressed
  together is the thing to check first.
- **Marker strokes follow the card's curve**: each point is bent as the card's own pieces are, and bent
  again whenever the card's bend changes (going in, coming back).
- `-toolAt <s>` with `-tool words|time|region`, `-armCutAt <s>`, `-cutAt <s>`, `-glowDemo blade|hold` do
  these without hands; `-bendLog` writes the open card's bend radius beside its sheet's twice a second.

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
