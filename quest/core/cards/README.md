# The agent's cards on the Quest

This folder draws the agent service's cards with the web client's layout, type scale, card types and sizes, in the Ocean's colours. The web side is `agents/client/js/components/*.js`, `agents/client/style.css` and `agents/docs/libraries.md` on `genui/integration`. A card is a node's `view` (`{component, props}`) and its `item`, as the service sends them.

Each card takes the sizes of the sizing spec (`quest-card-sizing.md`, "Build spec", with its numbers from `derive.mjs`). A small face is 210 px wide and at most 146 px tall. Its lines are counted by the host's own layout of its words, in its own fonts, two pixels a px as the face is drawn, so a face reserves no line it then leaves blank. The web keeps its own sizes until it adopts the spec, so for now the two clients' footprints differ by design.

- **The small face** holds whole lines only, up to what its type allows (`face.h`, and each type's `lay`). The title comes first in its height budget, in at most two lines. It is the item's `data.shortTitle` when the service gives one (what a face shows of a title too long for two lines, agents/docs/libraries.md, "Two titles of an item"), else its `title`. A title that fits them is whole, and a longer one shows its first two, cut at a whole word (a character in Chinese) and ended with an ellipsis, the one place a face draws one. The face then goes on as normal. What is under the title gives way to it: the body lines, the caption and the designed preview's detail line, and a picture over it, which keeps 52 px at least. A question, a term, a place's name, an idea's thought, a fact's foot and an excerpt's source are their faces' titles. The opened card shows the whole title. When anything is left out, its last row is the cue: "More", or a count such as "3 more" or "12 rows", in meta in the card's colour. Nothing is cut, ellipsised or shrunk. Chart, code, table, breakdown and pros and cons show a designed preview. Chips are not on the small face. A structured card's face shows the item's own lines in order from the top: the title, then the lines over its structure (`props.above`, a heading among them in the title's weight), then the heads row over its two columns (`props.heads`), then its entries, and the cue. A line over the structure is never left out to make room for an entry: when one does not fit, the face ends there with the cue. The list, steps, facts, fact, chart, breakdown, table, qa, callout, excerpt, definition, quote, pros and cons, sheet and explorable read `above`; facts, fact, chart and breakdown draw `heads` as a row, and pros and cons name its sides with them. The opened card shows them too, over the structure. The title is 18 px semibold, the body 16 px medium, and meta, labels and the cue 13.5 px medium.
- **The opened card** of a text, chart or link card is a fixed 384 by 311 px frame, 46 by 37.2 cm. A picture card keeps the ocean's open note for its picture. The whole panel is drawn once, as one picture, and shows through a window in the frame. It holds everything: the type's full form, the text, the tags and every chip source in full. Its title is 21 px semibold, what is read 15 px medium (rows, sources, roles, cells), and labels, tags, units and the chart's axes 11.5 px. Code stays at the web's 12.5 px monospace. A table stands whole in the panel's width, no column narrower than its widest word or number; when they cannot all stand, each row is set as a record of its heads beside its values.

The library draws all 28 of the web's components. The explorable is drawn as it stands first; its opened card writes its states and result out, and its controls do not work on the Quest yet. A component the library does not know is drawn as a note with no props, as on the web. Composites (a group's arrangement) are not drawn.

A view with `composing: true` is a card whose look the service is still choosing (agents/docs/protocol.md). Whatever its component, it is drawn as the in-progress card of `composing.cpp`: the item's kind and where it came from, "Note · Dropped in" or "Link · nytimes.com", over three soft bars, and none of its title or words; opened, it says it is being laid out. The scene runs a band of light across it (`OceanModel::composeFrame`), and when the finished view comes, its wordless frame (`cards::frame`) eases to the finished card's size and the finished card comes up inside it (`OceanModel::settleCard`, called from the bridge's redraw). A reference card with `cover` draws a book's cover at its small face's left with its details beside it.

## What the bridge calls

All calls run on the frame thread.

| Call | When | What it does |
| --- | --- | --- |
| `cards::put(noteID, view, item, node)` | A node is added, or its view, its item or its status changes. | Keeps the card that the note `noteID` shows. Returns true when what the card draws changed. |
| `cards::drop(noteID)` | The note goes. | Forgets the card. |
| `cards::pictures(noteID)` | After `put`. | Lists the picture addresses the card shows, such as an image's `props.src`. |
| `cards::picture(src, image)` | A picture was fetched, or failed (`image` is null). | Keeps it and returns the notes whose cards changed. |
| `cards::footprint(view, item)` | Any time. | Returns the small face's footprint in px, without keeping anything. |

`view` and `item` are the service's JSON (`Json`, from `core/json.h`) with the field names of `agents/src/core/domain.ts`. The item fields a card reads are `title`, `text`, `summary`, `tags`, `data`, `origin.by`, `source.from`, `source.url` and `source.capturedAt`. `cards::Node` holds what the tree says about the card:

- `pick` is `node.status == "pick"`. A pick has a dashed edge, a darker face and a SUGGESTED kicker.
- `root` is true for the first card of a tree (`node.parent` is null). The root has a lighter face and a white edge.
- `why` is `node.why`. The opened card prints it.
- `tone` is the tone of the card's place in the tree (`TreeNode::tone`), as its thread is drawn. The card's marks take the tone's colour. The default is `Tone::note`.

The note is the scene's `OceanNote` with the id `noteID`, in `catalog->notes`. Its kind does not matter. Once `put` holds a card for a note, the scene sizes and draws it through `ocean.h` (`OceanModel::bodies`, `buildSmall`, `buildOpen` and `Tree::openExtent` ask `cards::ocean::cardOf` first). The small card is `footprint * ocean::smallScale` pixels, one web px a millimetre at 1.5 m, so a face is at most 21 by 14.6 cm. The opened card is the web's 384 px panel at `ocean::openScale`, as wide as the ocean's open note. Both sizes are worked out the first time the scene asks and kept until the card is put again.

## Scrolling, the long pinch and the edit pencil on the opened card

Under `-cards` a pinch on the opened card's content works like this. Without `-cards` nothing changes: a drag of 2 cm on the open card marks at once.

- A pinch-drag that starts on the content scrolls it when it runs on past the window, with the edit pencil on or off. The content follows the hand one to one and stops at its top and its end. The card never moves or resizes. Each time the card opens, the content starts at the top.
- A pinch held still for 0.4 s, within 2 cm, is a long pinch. A small ring fills round the pinch while it is held, from 0.08 s, so the hand knows when it will count.
- With the pencil off, a long pinch asks for more like the card: the service's `more`, as Momo's "more like this" asks. The card is kept if it was a suggestion and leads a layer of its own, where what comes stands. When it has highlights, `need` is "More like this, especially what I highlighted: "…"".
- A drag that begins before the hold counts is a scroll. A pinch released without moving is today's tap, which zooms. A pinch that scrolled, highlighted, drew or asked is never a tap.
- Nothing scrolls or counts while the card grows or the layer glides.
- A thin bar inside the frame's right edge shows where the window is, only while the content runs on past it. It is not a target.

A card of the agent service's has the edit pencil, a round button just outside its top right corner: outlined when off, filled when on. A pinch on it turns it on or off, and it turns off when the card closes. While it is on:

- A small italic line under it says what a long pinch will do where the hand points: "Long pinch to highlight" over words, "Long pinch to draw" elsewhere.
- A long pinch on words, then a drag, highlights them, in whole words of one run of text, in see-through amber (Momo's `#F2C27A`) behind the words.
- A long pinch elsewhere, over the picture or an empty part of the card, then a drag, draws a white line 2 px wide.
- A long pinch never asks for anything.
- A short pinch on a highlight or a line takes it off.

Edits are kept by the service with the card (`node.edits`, agents/docs/protocol.md, Edits on a card), so they come back when the card opens again, after a restart and on another headset, and "undo" takes back the last. A highlight is its words and which of their appearances on the content it is, and a line its points 0 to 1 across and down the whole content, so both are found again when the card is drawn at another size. They are drawn where the content stands in its window, as two meshes cut to it (`OceanModel::drawEdits`).

In the scene: `OceanModel::Press` holds the claim, `holdPress` fills the ring and counts the hold each frame, `scrollCard` moves the window, `oceanmodel_edits.cpp` holds the pencil, and `cards::ocean` keeps each card's scroll. A film plays on its poster only while the poster is whole in view, at the top.

To drive it in the preview, `-scrollAt <s>` drags the open card's panel by `-scrollBy` (a share of how far it runs on, 1 if not given) as a hand would, `-holdAt <s>` holds a pinch still on its first words and then draws it across them, `-tapAt <s>` pinches it without moving, `-longPinchAt <s>` holds a pinch still on its middle, `-pencilAt <s>` pinches the pencil, `-drawAt <s>` holds a pinch where there are no words and draws a ring round what lies beside it, `-eraseAt <s>` pinches the newest edit, and `-aimAt <s> -aim words|elsewhere` points a hand there. `quest/desktop/test/cards_edit_check.mjs` runs them against the fake service and checks each:

```bash
quest/desktop/preview -cards -saved 0 -zoomAt 4 -scrollAt 6 -scrollBy 0.6 -holdAt 8
```

When `put` or `picture` reports a change for a note that is already on screen, rebuild that note's card in the scene. Each change gets a new texture key, so a rebuilt card never shows the old texture.

## Pictures

An address that starts with `sample:` is a sample picture from the web library page, which this library paints itself. Any other address is the caller's to fetch, for example `/assets/<id>` from the service. Until `picture` is called for an address, the card shows a dark frame. After `picture(src, nullptr)`, the card shows the web's "Picture unavailable" stripes.

## The ocean's own pieces

Under `-cards` the ocean's notes, films and works are cards too, as the service's library import (`npm run import-library`) makes them: `pieces.h` turns each into the import's item and view. A film is a video card, a work an artwork card, and a note a note, quote, image, video, chart or link card by what it holds. Its people and place tags become its chips, which the opened card lists. A tag keeps the ocean's chip. Each card is made the first time the scene asks about it, under the note's own id or the film's or work's `Ref::key` (`film:3`), and the tree's node gives it its pick and root look.

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

`-cards` stands the web library page's samples as a tree, with no service and no network, unless `-brief` or `-saved` asks for another tree. With an agent joined (`-agent`), `-cards` still draws every piece of the ocean as a card, but the library does not take the stand: the service's trees do, as they do without `-cards`. Add `-cardsGallery` to hang the library on the shelf as a cover then, to open it for review. The root card is the library, with five groups round it: Words, Pictures and sound, Numbers, Lists and the rest, and Other cards (the sheet and the explorable). Pinch a group to bring its types round it. Pinch a type to bring its other samples round it, such as the pick, the card with chips and other content. Each sample's label from the web page is on its thread.

```bash
quest/desktop/preview -cards
quest/desktop/preview -agent <address> -agentToken <token> -cards -cardsGallery
```

```bash
quest/tools/run.sh -- -cards
```

To open one card at a given second, add `-pickRef note:cards-quote-0 -pickAt 3`. Sample notes are named `cards-<type>-<index>`, and the groups `cards-group-<index>`.

The samples are compiled in from `samples.cpp`, and `samples_lines.cpp` adds the samples of `agents/test/footprints.json` on `genui/phase-2` that carry `above` or `heads`, which the web page's samples predate. `samples_titles.cpp` adds samples with a `data.shortTitle`, and one with a long title and none. Regenerate `samples.cpp` when the web samples change, and delete `samples_lines.cpp` once they have those:

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

`test/run.sh` sizes every sample of the web's golden file, `agents/test/footprints.json`, and holds each to the spec: 210 px wide, at most 146 px tall, and no chip line. It prints each type's tallest beside the tallest `derive.mjs` works out, for titles of the lengths it assumed. It no longer matches the web's sizes, which change when the web adopts the spec.

```bash
quest/core/cards/test/run.sh <genui/integration checkout>/agents/test/footprints.json
```

`test/sizes.sh` checks every gallery sample at the Quest's sizes: the small face never shrunk, at most 210 by 146 px, drawn with whole lines only and the cue after anything left out, and the opened card in its fixed box with its whole panel drawn and nothing cut. `test/pieces.sh` checks the ocean's own notes, films and works under `-cards`: each has a card, and a film's poster is whole in the first view, where the film plays.

```bash
quest/core/cards/test/sizes.sh
quest/core/cards/test/pieces.sh
```

`test/faces.sh` draws every gallery sample small and opened, with the Mac's fonts, into PNG files: the small face, the opened card at its top (and at its end when it scrolls), and the whole panel. `quest/tools/cards_compare.mjs` then sets each sample beside the web library page's drawing of the same sample, one PNG per type:

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
| `face.h`, `face.cpp` | The small face's frame, type and cue, and `Col`, which lays a face out once both to size it and to draw it. |
| `measure.h`, `measure.cpp` | The footprint arithmetic of `libraries.md` and `components/shared.js`: `span`, `fold`, `wrap`, `advance`. |
| `item.h`, `item.cpp` | The item as a card reads it, the fixed words in English or Chinese (`words.js`), and the chips (`chips.js`). |
| `said.h`, `said.cpp` | What the opened card still prints of the item's text (`said.js`). |
| `paint.h`, `paint.cpp` | The web look as canvas calls: colours, type sizes, faces and edges, pictures, chips. |
| `ocean.h`, `ocean.cpp` | Where `notes.cpp`, `catalog.cpp` and the scene ask about a note's card: its sizes, its frame and panel, and its scroll. |
| `pieces.h`, `pieces.cpp` | The ocean's notes, films and works as the library import's items and views. |
| `gallery.h`, `gallery.cpp`, `samples.cpp` | `-cards`. |
