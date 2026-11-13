# Mind Palace: spatial interface demo

A browser prototype that answers "why a spatial interface?" for Mind Palace Next Gen.
The design notes and spec are in [mind-palace-next-gen.md](mind-palace-next-gen.md).

## The agent system

The agents that run the mindstorm live in [agents/](agents/README.md): a service, a web client, and an adapter for the Ocean app. Start there to run it.

## AI agent system plan

Read the [HTML reading edition](docs/agent-system-plan.html) for a navigable overview,
the complete plan, and the research links. It opens directly in a browser and works
offline, with mobile layouts, day/night reading, and print/PDF styling.

The canonical source is [agent-system-plan.md](agent-system-plan.md). To refresh the
HTML after editing it, run `python3 scripts/render-agent-plan.py` (requires
`markdown-it-py`). The template is in `docs/agent-system-plan.template.html`.

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
