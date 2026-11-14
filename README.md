# Mind Palace: spatial interface demo

A browser prototype that answers "why a spatial interface?" for Mind Palace Next Gen.
The design notes and spec are in [mind-palace-next-gen.md](mind-palace-next-gen.md).

## Run

```bash
npm install
npm run dev
```

Open http://localhost:5173 and press **Space** to play the guided tour, or explore by hand
(click **Controls** in the bottom-left corner for the full list).

The 40 demo images are already in `public/media`. To re-download them from Lorem Picsum:

```bash
npm run fetch-media
```

## Studies

- `/studies/node/`: one memory going from a dot to a full image. Hover to expand; the slider sets the resting expansion (0 to 1).
- `/studies/scatter/`: about 90 to 220 small dots (scaled to the window), each a scene from film history, colored by genre. They sway in a breeze and swell toward the hover peak as the cursor nears. The dot being looked at (hovered, open, or showing the headline) is pinned where you found it, and the others make way. Layout is deterministic (`studies/shared/lens.js`): each dot's target comes from its home and the focused dots only, through a radial push whose strength and reach scale with the focus's size; neighbors grow only as far as their room allows, and the breeze calms near the focus. A clicked dot opens fully until another is clicked. (The `main` branch has the earlier physics version, `studies/shared/field.js`.)
  Growing dots play short low-res loops; a clicked dot hands off to its full clip with sound (see Clips below).

Both studies share `studies/shared/node.js`, where `MemoryNode.shape(e)` defines the whole dot-to-image transition, and `studies/shared/label.js`, the text tag under each node. Tags have four tiers set by expansion (`TIERS`): hidden, short tag, headline, then headline plus description. The tag scales smoothly with its node and opens like a drawer: the short tag widens into the headline, then the description slides out below (timings in `DURATION`). Text is placeholder.

## Clips

The scatter study plays 100 scenes from the [Condensed Movies](https://www.robots.ox.ac.uk/~vgg/research/condensed-movies) dataset (Bain, Nagrani, Brown, Zisserman, ACCV 2020), one per film, hand-picked to span the 1930s to the 2010s. This is an academic, non-public demo, and it uses short excerpts only. The media isn't in git; to rebuild it you need ffmpeg and [yt-dlp](https://github.com/yt-dlp/yt-dlp) (the dataset's videos are its original YouTube uploads):

```bash
python3 scripts/clips/download.py /path/to/yt-dlp
```

```bash
python3 scripts/clips/build.py
```

- `scripts/clips/selection.json`: the 100 films and the scene for each (plus backups per decade, used when a video is no longer available).
- `download.py` saves a 60-second window of each scene to `media-src/`.
- `build.py` writes `public/clips/`:
  - `full/NNN.mp4`: a 30-second clip with sound, up to 720p (source resolution varies from 360p to 1080p).
  - `atlas.mp4`: every clip's 4-second loop in one 10×10 grid video, so all small dots share one decoder.
  - `atlas.jpg`: the atlas's first frame, shown while the video loads.
  - `clips.json`: the manifest (tile positions, aspect ratios, film metadata and tag text).

Each loop is the first 4 seconds of its full clip, frame for frame, and its last half second blends back into its start so it cycles seamlessly. Opening a dot starts the full clip at the loop's current moment and crossfades once that frame is on screen.

## Works

The visionOS ocean also holds about 750 museum works, gathered around the ideas the films carry ("Watching unseen", "The double") and some of their own ("Before cinema", "Masks"), so a film and a painting can stand under one tag. They come from the open collections of the Met, the V&A, the Art Institute of Chicago and the Cleveland Museum of Art (through their APIs, no key) and from MoMA's published dataset. Like the clips, this is for an academic, non-public demo: MoMA's pictures in particular are mostly in copyright. Each step keeps what it fetched, so a second run asks for nothing twice:

```bash
python3 scripts/works/moma.py
```

```bash
python3 scripts/works/gather.py
```

```bash
python3 scripts/works/pick.py
```

```bash
python3 scripts/works/fetch.py
```

```bash
python3 scripts/works/build.py
```

- `themes.py`: the themes, with the searches put to each museum. `gather.py` writes every answer to `media-src/works/candidates.json`. It paces itself per museum; the Met refuses a client that asks faster than a few times a second, and the script then leaves it and says what is still to ask (`--src met` asks one museum only).
- `pick.py` chooses the works (`selection.json`): themes take turns and each takes from the museum that has had the least, a candidate must really match its theme, and no maker or series fills one. The same print kept by two museums counts once, and a work whose picture is already on disk is preferred, so a new run changes little. Ids listed in `exclude.txt` are left out (by `build.py` too, so removing a few needs no new pick). `sheet.py` makes a contact sheet per theme (`media-src/works/sheets/`) to look the choice over.
- `fetch.py` asks for each picture near the size it is kept, turns it into a HEIC of at most 1600 px (about 140 KB, good enough to look into closely; 750 come to about 105 MB) and deletes the download at once. Pictures that turn out too small or too long and thin are marked, and the next `pick.py` chooses others.
- `build.py` writes `public/works/`: `works.json` (every work with what its museum knows of it, and the tags: themes, makers, kinds, places, and the museums' own subjects where several works share one), `atlas.jpg` (every work small, for the ocean) beside `full/<id>.heic`. `norm.py` puts the five museums' wording into one vocabulary.

## Code map

| File | What it does |
|---|---|
| `src/nodes.js` | Instanced node renderer. One shader draws circles, panels and dots (rounded-rect SDF, glow, fade to color by on-screen size) and runs per-node springs. |
| `src/layout.js` | Target layouts for each level (flat, cosmos, group, focus, explore), the hex snap lattice, and the "related" ranking. |
| `src/app.js` | State, navigation API, drag / snap / regroup logic, camera. |
| `src/regions.js` | Group regions: a summed field drawn as a nebula and a contour, which stretches and turns dashed while a node is being dragged out. |
| `src/overlay.js` | Connection lines (offset from node edges), snap-slot dots, lasso. |
| `src/director.js` | The scripted Space tour. |
| `src/data.js`, `src/media-ids.js`, `src/atlas.js` | Demo content and the texture atlas. |
