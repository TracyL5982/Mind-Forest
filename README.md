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
- `/studies/scatter/`: about 90 to 220 small dots (scaled to the window). They sway in a breeze and swell toward the hover peak as the cursor nears. The dot being looked at (hovered, open, or showing the headline) is pinned where you found it, and the others make way. Layout is deterministic (`studies/shared/lens.js`): each dot's target comes from its home and the focused dots only, through a radial push whose strength and reach scale with the focus's size; neighbors grow only as far as their room allows, and the breeze calms near the focus. A clicked dot opens fully until another is clicked. (The `main` branch has the earlier physics version, `studies/shared/field.js`.)

Both studies share `studies/shared/node.js`, where `MemoryNode.shape(e)` defines the whole dot-to-image transition, and `studies/shared/label.js`, the text tag under each node. Tags have four tiers set by expansion (`TIERS`): hidden, short tag, headline, then headline plus description. The tag scales smoothly with its node and opens like a drawer: the short tag widens into the headline, then the description slides out below (timings in `DURATION`). Text is placeholder.

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
