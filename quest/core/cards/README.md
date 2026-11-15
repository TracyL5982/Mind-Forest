# The agent's cards on the Quest

This folder draws the agent service's cards with the web client's layout, type scale, card types and sizes, in the Ocean's colours. The web side is `agents/client/js/components/*.js`, `agents/client/style.css` and `agents/docs/libraries.md` on `genui/integration`. A card is a node's `view` (`{component, props}`) and its `item`, as the service sends them.

Each card has the footprint the web gives it, worked out from the letter widths in `libraries.md` and never measured. Its words are set in the host's fonts inside that footprint.

The library draws all 28 of the web's components. The explorable is drawn as it stands first; its opened card writes its states and result out, and its controls do not work on the Quest yet. A component the library does not know is drawn as a note with no props, as on the web. Composites (a group's arrangement) are not drawn.

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

- `pick` is `node.status == "pick"`. A pick has a dashed edge, a darker face and a SUGGESTED kicker.
- `root` is true for the first card of a tree (`node.parent` is null). The root has a lighter face and a white edge.
- `why` is `node.why`. The opened card prints it.
- `tone` is the tone of the card's place in the tree (`TreeNode::tone`), as its thread is drawn. The card's marks take the tone's colour. The default is `Tone::note`.

The note is the scene's `OceanNote` with the id `noteID`, in `catalog->notes`. Its kind does not matter. Once `put` holds a card for a note, the scene sizes and draws it through `ocean.h` (`OceanModel::bodies`, `buildSmall`, `buildOpen` and `Tree::openExtent` ask `cards::ocean::cardOf` first). The small card is `footprint * ocean::smallScale` pixels, so a 240 px note is as wide as the ocean's own small note. The opened card is the web's 384 px panel at `ocean::openScale`, as wide as the ocean's open note.

When `put` or `picture` reports a change for a note that is already on screen, rebuild that note's card in the scene. Each change gets a new texture key, so a rebuilt card never shows the old texture.

## Pictures

An address that starts with `sample:` is a sample picture from the web library page, which this library paints itself. Any other address is the caller's to fetch, for example `/assets/<id>` from the service. Until `picture` is called for an address, the card shows a dark frame. After `picture(src, nullptr)`, the card shows the web's "Picture unavailable" stripes.

## The ocean's own pieces

Under `-cards` the ocean's notes, films and works are cards too, as the service's library import (`npm run import-library`) makes them: `pieces.h` turns each into the import's item and view. A film is a video card, a work an artwork card, and a note a note, quote, image, video, chart or link card by what it holds. Its people and place tags become its chips. A tag keeps the ocean's chip. Each card is made the first time the scene asks about it, under the note's own id or the film's or work's `Ref::key` (`film:3`), and the tree's node gives it its pick and root look.

Its pictures are the ocean's own: a film's still from the atlas, drawn at the film's shape so the film covers it when it plays (`still:<film>`), a work's small picture (`work:<work>`), and a note's picture file (`file:<name>`). A file is unpacked on the background thread. Until it is there the card shows the dark frame, and then its faces are drawn again in place, the old face staying up until the new one is painted.

## Colours on the Quest

The cards take every colour from the Ocean, so they sit in the ocean as its own notes do. `paint.h` holds the table, and each line there names its source. The web's colours map like this:

| On the web | On the Quest | From |
| --- | --- | --- |
| A card's face, `--face` | `Art::panel` | the ground a layer's picture is drawn on |
| The darker face of a figure, a fact or code, `--sunk`, and a pick's face | `Art::ink` | the dark of the Ocean's labels and panels |
| The first card of a tree, and the mat of an artwork | `Art::well` | the frame of a picture that is not there |
| The opened card, `--glass` | `Art::ink`, flat and opaque | the ocean's open note |
| Words, `--ink`, `--ink-2`, `--ink-3` | white at 1, 0.82 and 0.6, and 0.78 for what a card says about itself | the Ocean's steps of strength |
| A card's marks, `--accent` (the tree's colour) | the colour of the card's tone, `color(Tone)` | as an Ocean note's kicker and strip take its tone |
| Chart bars and figures | white at 0.35, and the one the card is about in its tone | `Art::bars` |
| A pick's amber | a dashed edge in white at 0.5 and a SUGGESTED kicker at `Art::Size::micro`, bold, in the card's tone | |
| A chip's pill and glyph | a flat label in `color(Tone)` with words in `ink(Tone)`: who is `Tone::people`, where is `Tone::place`, when is `Tone::era`, and where a pick came from is `Tone::path` | `Art::chip` |
| A caution, `--danger` | `Art::hot` | the one accent |
| Hairlines and edges, `--line`, `--line-2` | white at 0.12 and 0.2 | |

`Art::hot` is otherwise left to the scene: where you are, what you marked and what you send. The web's teal for ties has no card use, because the scene draws ties as threads. The side-by-side PNGs of `cards_compare.mjs` differ from the web in colour by design, so compare their layout and size.

## The gallery

`-cards` stands the web library page's samples as a tree, with no service and no network, unless `-brief` or `-saved` asks for another tree. The root card is the library, with five groups round it: Words, Pictures and sound, Numbers, Lists and the rest, and Other cards (the sheet and the explorable). Pinch a group to bring its types round it. Pinch a type to bring its other samples round it, such as the pick, the card with chips and other content. Each sample's label from the web page is on its thread.

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

To install the gallery beside the headset's own app, build a second copy with its own suffix. The app on the headset was signed on another machine, so an install over it fails. The copy is named "Mind Palace Ocean (cards)". Set `JAVA_HOME` to a JDK 17 when `tools/env.sh`'s default is not on the Mac:

```bash
JAVA_HOME=<a JDK 17> QUEST_APP_SUFFIX=.cards quest/tools/run.sh --build -- -cards
```

A copy with no media draws no scene, because `OceanModel::start` needs the clips and `ocean.json`. When the original app already holds the media, copy it across on the headset. This is faster than `tools/push_media.sh`, which sends about 700 MB over the cable:

```bash
adb shell cp -r /sdcard/Android/data/com.kaifengwu.mindpalace.ocean/files/media /sdcard/Android/data/com.kaifengwu.mindpalace.ocean.cards/files/
```

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
| `<type>.cpp` | One file for each type drawn, named as its component: `note`, `quote`, `fact`, `image`, `video`, `audio`, `link`, `chart`, `person`, `chat`, `code`, `steps`, `facts`, `table`, `list`, `breakdown`, `qa`, `callout`, `excerpt`, `definition`, `idea`, `proscons`, `swatch`, `artwork`, `reference`, `place`, `sheet` and `explorable`. Each file has the footprint, the small face and the type's part of the opened card, and puts its type in the registry. A new type is one new file. |
| `parts.h` | What a sheet takes from the facts, list and table cards to draw its parts as they do. |
| `figures.*`, `media.*`, `rows.*`, `text.*` | Helpers that several types share: figures and number formats, pictures and play marks, the foot of a list, and the fixed words and stroked glyphs. |
| `measure.h`, `measure.cpp` | The footprint arithmetic of `libraries.md` and `components/shared.js`: `span`, `fold`, `wrap`, `advance`. |
| `item.h`, `item.cpp` | The item as a card reads it, the fixed words in English or Chinese (`words.js`), and the chips (`chips.js`). |
| `said.h`, `said.cpp` | What the opened card still prints of the item's text (`said.js`). |
| `paint.h`, `paint.cpp` | The web look as canvas calls: colours, type sizes, faces and edges, pictures, chips. |
| `ocean.h`, `ocean.cpp` | Where `notes.cpp` and `catalog.cpp` ask about a note's card. |
| `pieces.h`, `pieces.cpp` | The ocean's notes, films and works as the library import's items and views. |
| `gallery.h`, `gallery.cpp`, `samples.cpp` | `-cards`. |
