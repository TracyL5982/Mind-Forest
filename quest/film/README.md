# Filming the headset from outside

A third-person shot of someone using the app: an ordinary camera films them, and the app's scene is drawn afterwards
from where the camera stood, over what it filmed, in time with it.

Three things make that possible, and each can be checked on its own:

- **The take.** While it is being filmed, the app writes down everything it draws, frame by frame (`core/take.h`):
  not what the user did, but what was on screen. Drawn again, it cannot come out differently, whatever the agent or
  the network do the second time, and a take stays good when the app's code changes.
- **The sheet.** One printed page that both sides can place themselves by. The headset reads the QR code in its middle
  (OpenXR's marker tracking) and so knows where the sheet lies in its scene. The camera's footage is searched for the
  eight marks round the code (`solve.py`), which say where the camera stood against the sheet.
- **The sync sound.** The headset plays a short rising sweep when a take begins and when it ends, and writes down when
  each left its speakers. The camera's microphone hears them; found in the footage's sound (`sync.py`), they match
  the two clocks to well under a frame.

## Once

```bash
quest/desktop/build.sh
```

```bash
python3 -m venv quest/film/.venv && quest/film/.venv/bin/pip install -r quest/film/requirements.txt
```

```bash
quest/film/.venv/bin/python quest/film/film.py sheet
```

Print `quest/film/sheet/sheet-letter.pdf` at 100% ("actual size", not "fit"), on matte paper, and check its 50 mm
ruler against a real one. `--paper tabloid` (or `a3`) makes a larger sheet, which places a camera better from further
off; say the same `--paper` to every later step, and launch the app with `-sheetPaper tabloid`.

The app must have been allowed to see the room (the same permission as the desk: it asks once a hand is held up).

## Shooting a take

Everything on the headset is done from the **filming panel**: a dark card low in front of your feet, tipped up to face
you: look straight down (it follows after a few seconds if you walk off). It is kept down there so that it
stays out of the headset's own recording, when that runs at the same time as a take. It shows one line on where things stand and
two buttons, pinched with a hand ray like anything else. It and the sheet's outline are drawn for you only: neither
is ever in a take. The outline is hidden while a take records.

1. Put the sheet where the camera and the headset both see it: flat on the desk in front of the person is the natural
   place. It must not move during a take. Printed: tape it down. On an iPad (`film.py sheet --paper ipad`, for the
   12.9 inch iPad Pro): show the picture full screen, not zoomed, at about half brightness, Auto-Lock off.
2. Open the app. The copy installed as `.film` always films; any other is started with `-film`. Say which sheet
   once (it is remembered): `quest/tools/run.sh -- -film -sheetPaper ipad`.
3. **Lock the sheet.** The headset places the sheet well only from very close. Look at it from a forearm's length,
   straight on: an amber outline appears and, after a second of close looking, holds still on the sheet's edge (the
   panel says "Sheet steady. Lock it."). It keeps that place for half a minute while you turn to the panel and pinch
   **Lock sheet**. The outline turns green and nothing moves it again until **Unlock sheet**. If the outline does not
   lie on the sheet's edge, unlock and look again.
4. The camera: 4K at 30 a second, **HDR off**, the 1x lens, no zoom during a take, sound on. On a tripod is best
   (see "What to expect"). In the hand, turn stabilisation off if the camera app lets you (the Blackmagic Camera app
   does), and keep the whole sheet in the picture.
5. Start the camera, then pinch **Record**. The headset plays the sweep half a second later, and the panel shows the
   take's length. Do the take. Pinch **Stop**: the sweep plays again and the take is written out. Let the camera run
   a second longer, then stop it.

A take can also be begun and ended from the Mac, by whoever holds the camera: `film.py start` and `film.py stop`.

### Momo's greeting

The panel's third button, **Play greeting**, starts a short scene with Momo and one tree. It can be pinched while
every tree is closed; pinched again while it counts down, it is called off and everything goes back.

1. At the pinch the tree fades out where it stands. Out of sight it is given the middle, straight ahead and 1.5 m
   off; trees that would be in its way glide aside round you, and the question cards in the middle of the desk fade.
   No gap is left in the other trees' rings where it will come.
2. Five seconds on (time to look up from the panel) Momo says "Hi there! I grew a new tree today on the topics you
   love! Would you like to check it out?"
3. A breath after her last word the tree grows in, over about 3.6 s: its rings spread over the ground and its
   neighbours' give way before them, the trunk comes up and opens, each picture comes as the tree reaches its
   height, then its name, then a **New** tab beside the name. A soft sound and a quiet note for each picture go with it.
4. Opened, the tree and the ones that made room have their old places again the next time they stand on the desk.

- The line is a recording of Momo's live voice (`media-src/quest/film/greeting.pcm`, its words in `greeting.txt`),
  played through her own voice in the app, so she pulses and shows the words as with any answer. Another line:
  `cd agents && MIND_PALACE_ENV=<key file> node --no-warnings --import tsx scripts/say-line.ts "<the line>" ../media-src/quest/film/greeting.pcm`,
  then `tools/push_media.sh`.
- Which tree: the one whose name has the words given, else the last one the gardener made, else the last put away.
  Say it once and it is kept: `adb shell setprop debug.mindpalace.freshTree "planet"` before pinching (or `-freshTree planet` at launch).
- From the Mac: `adb shell setprop debug.mindpalace.cue $(date +%s)` is a pinch on the button. `-cueDelay 8` changes
  the wait, `-cueFar 1.8` how far off the tree stands.
- In the Mac preview: `preview -cueAt 4 -freshTree machines` asks for it four seconds in.
- As after anything Momo says, the conversation stays open for a few seconds: what is said then goes to her without her name.

A take is about 400 MB a minute on the headset while a lot is moving, less when little is. A take's first frame or
two run long (about 20 ms) while the scene's large pictures are read back.

## Making the film

```bash
quest/film/.venv/bin/python quest/film/film.py pull
```

```bash
quest/film/.venv/bin/python quest/film/film.py make quest/film/takes/take-<when> path/to/footage.mov --paper ipad
```

(`--paper` is the sheet that was used: `letter` if it is left out.)

That writes `<footage>-film.mp4` beside the take, with the footage's own sound. Useful options:

- `--tripod` / `--handheld`: say which, if it guesses wrong.
- `--lens lens.json` or `--fov <degrees across>`: the camera's lens. A hand-held take works its lens out for itself.
  A tripod take cannot (one view does not tell a long lens far away from a short one near): make a `lens.json` once
  from a short clip moving round the sheet with the same camera, lens and video mode:

  ```bash
  quest/film/.venv/bin/python quest/film/film.py lens path/to/clip-moving-round-the-sheet.mov
  ```

- `--marks`: draws the sheet's edge, the head and the hands' joints as the take has them. **Do this on the first take
  of a session**: the edge should lie on the paper, the marks on the person's own hands and headset. If the hands' marks
  run early or late against the hands, the clocks are off; if everything is shifted together, the headset placed the
  sheet badly.
- `--still <seconds>`: one picture instead of a film, to look before waiting.
- `--overlay`: also the scene alone with its alpha (ProRes 4444, colours multiplied by alpha), for compositing in an editor.
- `--prores`: ProRes 422 HQ instead of H.264.
- `--dim <0…1>`: how much of the headset's dimming of the room is put on the footage (1: as the person saw it).
- `--offset <seconds>`: the take's time at the footage's first frame, if the sync sound could not be heard.

`film.py pov <take>` draws a take as the person in the headset saw it, at any size.

## What to expect

- **A tripod shot is clean.** The camera gets one place for the whole take, averaged over every frame.
- **A hand-held shot swims a little.** The camera is placed afresh in every frame from a sheet that is small in the
  picture, and a hair's turn of it is centimetres two metres from the sheet. Smoothing (`--smooth <frames>`) trades
  swim against lag. A larger sheet, nearer the middle of the action, helps most. Frames where the sheet is hidden or out
  of the picture get no scene (gaps under half a second are bridged).
- **The person is always behind the scene.** Nothing yet cuts them out where they stand in front of a card.
- **The hand's ray and dot are in the take**, as the person saw them, also while they aim at the filming panel.
- **Footage filmed in HDR** (hybrid log-gamma, an iPhone's default) is brought to ordinary light as the film is made.
- **For a quick look**, `--draft` makes the film 1280 across in seconds; `--again` skips looking for the sheet when the
  same take and footage were done before.
- **Films playing on cards** are drawn from the same files on this Mac (`media-src`, through `--repo`), not from the take.
- **The app's own sound** (Momo's voice, the chimes) is not in the take; the film has what the camera's microphone heard.

## What has been tried, and what has not

Tried, on 2026-11-15 and 16:

- A take recorded in the Mac preview and drawn again matches the preview's own picture (differences only in specks under a pixel).
- `film.py check` makes footage of the sheet from a known camera path, with the sync sound in its sound, and runs the
  whole way through. On it the camera is found to within a centimetre and a quarter of a degree, the lens to 0.3%,
  the clocks to a tenth of a millisecond.
- Takes recorded on the Quest 3 hold 90 frames a second, at about 1 ms more of each frame's CPU time, and draw again
  on the Mac as the headset's own screenshot shows them, a film playing on a card included.
- One real take, the whole way: the sheet shown on an iPad, locked from a close look and recorded from the panel by a
  person in the headset, filmed hand-held on an iPhone (4K, HDR). The sheet was found in 712 of the footage's 715
  frames, the lens worked out from the footage, the two sync sounds matched to 0.2 ms of what the take has. In the
  film made with `--marks` the head's mark sits on the headset and the hands' joints on the hands throughout, within
  a few centimetres by eye. Nothing was measured.

What is known to be weak:

- **The headset's own placing of the sheet.** Its QR tracking jumps by centimetres from further than a forearm
  away, which is why the sheet is locked from a close look. The better way, begun and not finished, is to find the
  sheet's marks in the headset's passthrough cameras (`headset.py`, the take's CAMI and CAMR pieces; the part that
  opens the cameras on the headset is not written).
- **The sync sound's finder hears things that are not it** (three in the real take). They did no harm, because the
  two true ones are picked by how far apart the take says they were; a take with one sync sound would be at risk.
- In one early run a take asked to stop from the Mac ran on until the app quit. It did not happen again and its
  cause was not found. Quitting the app ends a take properly (without its second sync sound).

Not tried yet: a tripod shot of a real take, a printed sheet, HDR footage of the PQ kind, the `--overlay` film in an editor.

## What is where

| | |
|---|---|
| `core/take.h`, `take.cpp` | the take: writing it (both hosts) and reading it back |
| `core/render.*` | `Renderer::drawn`: what a frame put on screen; `Renderer::read`: a picture back from the GPU |
| `core/audio.*` | `audio::sync()`: the sync sound, and the count of frames it began at |
| `android/…/filming_android.*` | the Quest: finding the sheet, locking it, beginning and ending takes, the clocks |
| `core/ocean/oceanmodel_cue.cpp` | Momo's greeting from the panel: the tree hidden and given the middle, the line (`Voice::recite`), the tree growing in |
| `core/ocean/filmpanel.*` | the filming panel; `Input::setFront` gives it pinches before the scene, `Entity::unfilmed` keeps it out of takes |
| `desktop/film.cpp` | the Mac: drawing a take from a camera over footage (`preview -film`), `-takeInfo` |
| `film/sheet.py` | the sheet |
| `film/solve.py` | the camera's place and lens from the footage |
| `film/sync.py` | the clocks from the sync sound |
| `film/film.py` | the steps above |
| `film/selftest.py` | `film.py check` |
