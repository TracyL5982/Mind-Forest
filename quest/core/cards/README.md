# The agent's cards on the Quest

This folder draws the agent service's cards in the web client's look. The web side is `agents/client/js/components/*.js`, `agents/client/style.css` and `agents/docs/libraries.md` on `genui/integration`. A card is a node's `view` (`{component, props}`) and its `item`, as the service sends them.

Each card has the footprint the web gives it, worked out from the letter widths in `libraries.md` and never measured. Its words are set in the host's fonts inside that footprint.

The library draws 26 of the web's 28 components. `sheet` and `explorable` are not drawn yet. Like any unknown component, they are drawn as a note with no props, so their footprints differ from the web's until they are ported. Composites (a group's arrangement) are not drawn.

## What the bridge calls

All calls run on the frame thread.

| Call | When | What it does |
| --- | --- | --- |
| `cards::put(noteID, view, item, node)` | A node is added, or its view, its item or its status changes. | Keeps the card that the note `noteID` shows. Returns true when what the card draws changed. |
| `cards::drop(noteID)` | The note goes. | Forgets the card. |
| `cards::pictures(noteID)` | After `put`. | Lists the picture addresses the card shows, such as an image's `props.src`. |
| `cards::picture(src, image)` | A picture was fetched, or failed (`image` is null). | Keeps it and returns the notes whose cards changed. |
| `cards::footprint(view, item)` | Any time. | Returns the web footprint in px, without keeping anything. |

`view` and `item` are the service's JSON (`Json`, from `core/json.h`) with the field names of `agents/src/core/domain.ts`. The item fields a card reads are `title`, `text`, `summary`, `tags`, `data`, `origin.by`, `source.from`, `source.url` and `source.capturedAt`. `cards::Node` holds what the tree says about the card:

- `pick` is `node.status == "pick"`. A pick has an amber accent, a dashed edge and a darker face.
- `root` is true for the first card of a tree (`node.parent` is null). The root has a lighter face and a white edge.
- `why` is `node.why`. The opened card prints it.
- `accent` is the tree's colour for the card, as the web's `store.view.colour` gives it. The default is the web's trunk colour, `#e6efff`.

The note is the scene's `OceanNote` with the id `noteID`, in `catalog->notes`. Its kind does not matter. Once `put` holds a card for a note, `notes.cpp` and `Catalog::openSize` draw and size the note through `ocean.h`. The small card is `footprint * ocean::smallScale` pixels, so a 240 px note is as wide as the ocean's own small note. The opened card is the web's 384 px panel at `ocean::openScale`, as wide as the ocean's open note.

When `put` or `picture` reports a change for a note that is already on screen, rebuild that note's card in the scene. Each change gets a new texture key, so a rebuilt card never shows the old texture.

## Pictures

An address that starts with `sample:` is a sample picture from the web library page, which this library paints itself. Any other address is the caller's to fetch, for example `/assets/<id>` from the service. Until `picture` is called for an address, the card shows a dark frame. After `picture(src, nullptr)`, the card shows the web's "Picture unavailable" stripes.

## The gallery

`-cards` stands the web library page's samples as a tree, with no service and no network. The root card is the library, with four groups round it: Words, Pictures and sound, Numbers, and Lists and the rest. Pinch a group to bring its types round it. Pinch a type to bring its other samples round it, such as the pick, the card with chips and other content. Each sample's label from the web page is on its thread.

```bash
quest/desktop/preview -cards
```

```bash
quest/tools/run.sh -- -cards
```

To open one card at a given second, add `-pickRef note:cards-quote-0 -pickAt 3`. Sample notes are named `cards-<type>-<index>`, and the groups `cards-group-<index>`.

The samples are compiled in from `samples.cpp`. Regenerate the file when the web samples change:

```bash
node quest/tools/cards_samples.mjs <genui/integration checkout>/agents/client
```

If you put the library tree away, its cover stays on the shelf. Launch without `-cards` and that cover's notes no longer exist.

## Checks

`test/run.sh` checks every type this library draws against the web's golden footprints. Each sample's size and the box of each chip must match to the px.

```bash
quest/core/cards/test/run.sh <genui/integration checkout>/agents/test/footprints.json
```

`test/faces.sh` draws every gallery sample small and opened, with the Mac's fonts, into PNG files. `quest/tools/cards_compare.mjs` then sets each sample beside the web library page's drawing of the same sample, one PNG per type:

```bash
quest/core/cards/test/faces.sh /tmp/faces
node quest/tools/cards_compare.mjs --faces /tmp/faces --out /tmp/compare --playwright <a folder with node_modules/playwright-core>
```

## What is where

| File | What it is |
| --- | --- |
| `cards.h`, `cards.cpp` | The calls above: the cards notes show, and their faces, small and opened. |
| `kind.h`, `kinds.cpp` | One card type, as one `components/<type>.js` is, and the registry of types. |
| `<type>.cpp` | One file for each type drawn, named as its component: `note`, `quote`, `fact`, `image`, `video`, `audio`, `link`, `chart`, `person`, `chat`, `code`, `steps`, `facts`, `table`, `list`, `breakdown`, `qa`, `callout`, `excerpt`, `definition`, `idea`, `proscons`, `swatch`, `artwork`, `reference` and `place`. Each file has the footprint, the small face and the type's part of the opened card, and puts its type in the registry. A new type is one new file. |
| `figures.*`, `media.*`, `rows.*`, `text.*` | Helpers that several types share: figures and number formats, pictures and play marks, the foot of a list, and the fixed words and stroked glyphs. |
| `measure.h`, `measure.cpp` | The footprint arithmetic of `libraries.md` and `components/shared.js`: `span`, `fold`, `wrap`, `advance`. |
| `item.h`, `item.cpp` | The item as a card reads it, the fixed words in English or Chinese (`words.js`), and the chips (`chips.js`). |
| `said.h`, `said.cpp` | What the opened card still prints of the item's text (`said.js`). |
| `paint.h`, `paint.cpp` | The web look as canvas calls: colours, type sizes, faces and edges, pictures, chips. |
| `ocean.h`, `ocean.cpp` | Where `notes.cpp` and `catalog.cpp` ask about a note's card. |
| `gallery.h`, `gallery.cpp`, `samples.cpp` | `-cards`. |
