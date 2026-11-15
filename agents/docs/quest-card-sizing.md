# Quest card sizing

This sets the size, the type and the content limit of all 28 card types on the Quest 3 and on the web. It works back from published legibility guidance, from how the original app lays a layer out and opens a card, and from what you found on the headset. Where they conflict, best practice wins, as you asked. The last section, "Build spec", is everything an implementer needs, without the rest.

Every number comes from `derive.mjs` in this folder, which reads the web library's own letter widths and line counters and changes nothing. Each claim is labelled. "Sourced" means a page or paper I read. "Measured" means the script or the code computed it. "Inferred" means it follows from those. "Judgment" means it is my call.

## The answer

- **Text sits in the published comfortable range.** Microsoft's comfortably legible range is 0.6 to 0.75°, which is 15.7 to 19.6 mm at 1.5 m (sourced, converted). Small-card body text is 16 mm (0.61°) and titles 18 mm (0.69°). Meta lines and the "more" cue are 13.5 mm (0.52°), and nothing that is read is smaller. Opened-card body text is 18 mm (0.69°). All text is medium weight or heavier, in white at 0.82 or more on the dark face, which is 11.6:1 (measured).
- **A small card is at most 21 × 14.6 cm.** That is what the ring of cards round an open card holds without overlap (measured). At 16 mm text that leaves room for a title and 2 or 3 lines. So a small card is a glanceable summary. It shows whole lines or entries up to its limit, then a fade and a "more" cue. It never cuts and never scrolls. Five types (chart, code, table, breakdown, pros and cons) get a designed preview instead, because nothing of their structure reads at 16 mm in that box.
- **One web px is one mm on the headset's small face.** The web draws the same face at the same px, so both clients share one footprint rule. The small face is 210 px wide and at most 146 px tall, with text at 18, 16 and 13.5 px.
- **Every text kind opens to 46 × 37.2 cm,** fixed before the layer is laid out. Opening then moves the layer 1.36 times as much as opening an original note, the same as an original chart (measured from the layout's own rule). Chips appear on the opened card only. The opened card holds everything. A pinch-drag on its content scrolls it inside the fixed box, and a pinch held still for 0.4 s and then dragged marks words.
- **The note summary is capped at 2 lines of the small note.** That is 30 English characters or 22 Chinese characters, so that it always fits under a 2-line title. When the title takes 1 line, it is 45 English or 33 Chinese.

## How the cards are seen

- **Distance.** The layer you work on stands 1.5 m away, its middle at eye level (`Stage::focus`, `Stage::openY` in `quest/core/ocean/stage.h`, measured). At 1.5 m, 1° is 26.2 mm.
- **Pixels.** The Quest 3 shows 2064 × 2208 px an eye at 25 pixels per degree ([Meta, Compare devices](https://developers.meta.com/horizon/essentials/compare-devices), sourced; Meta does not say how it measures this). At 25 PPD, 1 mm at 1.5 m is 0.95 display px. Cards are textures at 2000 px a metre (`Art::ppm`), mipmapped (`quest/core/render.cpp`), so the display limits sharpness, not the texture (inferred).
- **Sizes are font sizes.** `Art::font` passes a size to the system font as its point size, so a size here is the em. In SF, capitals are 0.705 em and the x-height 0.508 em (measured from `SFNS.ttf`).
- **The comfortable region.** [Android XR](https://developer.android.com/design/ui/xr/guides/visual-design) puts primary content in a 41° field of view "so users don't have to move their head to interact" (sourced). The opened card is 17.4° × 14.1°. The open group, the opened card and its ring, takes about 56° × 31° in the original. That is wider than 41° by design, since you turn to the neighbours (measured).

## Why these text sizes

| Source | What it says |
|---|---|
| [Microsoft, mixed reality typography](https://learn.microsoft.com/en-us/windows/mixed-reality/design/typography) | Minimum legible 0.35 to 0.4°, comfortably legible 0.6 to 0.75°, at 2 m. At 1.5 m that is 9.2 to 10.5 mm and 15.7 to 19.6 mm. It avoids light weights and uses white text on a dark plate. (Sourced; the conversion is measured.) |
| [Android XR](https://developer.android.com/design/ui/xr/guides/visual-design) | 14 dp or larger, weight normal or heavier. At its 0.868 dmm a dp, 14 dp is 0.70°, 18.2 mm at 1.5 m. (Sourced; conversion measured.) |
| [Meta, typography](https://developers.meta.com/horizon/design/styles_typography/) | 14 px minimum, 18 px comfortable, Medium and heavier, no italics. It gives no size for a px in the headset. (Sourced.) |
| [Kojić et al. 2020](https://arxiv.org/abs/2004.01545) | Readers on an Oculus Go and the first Quest chose 16 to 18 dmm for 21- and 51-word texts, and contrast of at least 7:1. No minimum or comfortable size. (Sourced.) |
| Hoffmann et al. 2019, cited in [Kilpeläinen and Häkkinen 2023](https://www.frontiersin.org/journals/virtual-reality/articles/10.3389/frvir.2023.1243387/full) | Legibility threshold 45 arcmin, comfort 70.2 arcmin, on a 13.8 PPD display. Scaled by pixels to 25 PPD, that is 0.41° and 0.65°. (Cited; the scaling is inferred.) |

The original app's 13.5 mm body is readable on the headset because the Quest 3 has nearly twice the pixels a degree of the displays those thresholds came from (inferred). That puts 13.5 mm above the scaled threshold, but below every comfortable figure above. Following best practice, text that is read sits at 16 to 18 mm, inside Microsoft's comfortable range and at Hoffmann's scaled comfort. 13.5 mm stays only as the floor for meta lines, at the original's own body size. Solum 2019 and Dingler et al. 2018 are cited elsewhere and unverified, so nothing rests on them.

## Type scale

The small face is drawn at one web px to one mm at 1.5 m. The opened card keeps the port's `openScale`, 1.198 mm a px (46 cm for the 384 px panel). Quest 3 px are display pixels at 25 PPD (measured).

| Small face | Web px | mm | Degrees | Quest 3 px, em | Line, px | Weight |
|---|---|---|---|---|---|---|
| Title | 18 | 18.0 | 0.69 | 17.2 | 24 | semibold 620 |
| Body | 16 | 16.0 | 0.61 | 15.3 | 22 | medium 500 |
| Meta and the cue | 13.5 | 13.5 | 0.52 | 12.9 | 18 | medium 500 |
| Large figure | 34 | 34.0 | 1.30 | 32.5 | 36 | semibold 650 |
| Middle figure | 24 | 24.0 | 0.92 | 22.9 | 28 | semibold 650 |

| Opened card | Web px | mm | Degrees | Quest 3 px, em | Weight |
|---|---|---|---|---|---|
| Title | 21 | 25.2 | 0.96 | 24.0 | semibold 650 |
| Body and all reading text | 15 | 18.0 | 0.69 | 17.2 | medium 500 |
| Labels, tags, chips, map credit | 11.5 | 13.8 | 0.53 | 13.2 | medium 500 |

All text is white at 0.82 opacity or more on the face `#1b1d23`, 11.6:1 (measured). The web's card text today, `#a3a39c`, is 6.6:1. Quotations, passages and definitions are set in upright serif, because Meta says italics "do not render well in fully immersive experiences" (sourced).

## What the layout and the open animation require of sizes

### Placement

- **How the original places cards** (measured from `quest/core/ocean/tree.cpp`). Round the open card, nine places stand on an ellipse at 20° and every 40° on (`Tree::ringAngles`). The half axes are `max(0.72, half width + 0.46)` across and `(up + down) / 2 + 0.23` up and down, from the open box (`Tree::ring`). Each place is moved up to 2.5 cm at random (`Tree::spot`). Nothing in a group moves one card out of another's way, and a place counts as taken only when a card lies within 0.2 m across and 0.14 m up or down (`Tree::freeSlots`). So the ring assumes cards of about 0.2 × 0.14 m. The original's cards are that size. A small note is 21 cm wide and 6.1 to 11.7 cm tall, and a small film with its label at most 17 × 14.6 cm.
- **Groups are sized.** Groups on a layer part until their boxes keep 25 cm between them (`Tree::part`). A group whose first card is not open draws in to 0.55 of its ring (`Branching::closed`). Its cards then overlap by design, since even the original's notes would need 0.62 to keep clear (measured).
- **Tolerance** (measured, open ring, 1.5 cm of air in the worst jitter):

| Open box, 46 cm wide | Tallest neighbour, 17 to 25 cm wide | Widest neighbour, 14.6 cm tall |
|---|---|---|
| Link, 21.8 cm | 15.2 cm | 25.1 cm |
| Text, 27 cm | 16.9 cm | 25.1 cm |
| Chart, 37.2 cm | 20.2 cm | 36.1 cm |
| Our artwork before f024f86, 87 cm | 36.2 cm | 42.0 cm |

- **So the hard box is 21 × 14.6 cm.** It clears every original open box. Before f024f86 our small cards were up to 0.33 m tall (quest-cards-2, measured), which is where "two cards seem to overlap" came from. A layer stays even when every card is 21 cm wide (a picture may be narrower) and 6 to 14.6 cm tall, the span of the original's notes and films (judgment).

### The open transition

- **What happens** (measured from `Tree::focus`, `OceanModel::restyle` and `CardView::update`):
  1. Opening a card makes it the first card of a group on the next layer, and everything glides there over `Pace::step`, 1.0 s.
  2. The card grows in place over `Pace::grow`, 0.5 s. Both faces scale by the width ratio, 46 / 21 = 2.19, while the small face fades out between 35% and 80% of the grow and the open face fades in between 20% and 70%.
  3. The layer clears the open box and 13 cm under it (`OceanModel::openReach`). Cards in that room, on the same layer or behind it, glide to its nearest edge over 1.0 s (`OceanModel::nudge`). This is the push you saw.
  4. New cards pop in round it after the gardener thinks, 0.42 s each and 45 ms apart.
- **How much moves.** This is a model of the nudge rule, not a measurement of frames. It multiplies the room cleared by the mean distance a card in it moves, with an original note as 1.

| Opening | Motion |
|---|---|
| Original text note, 46 × 27, small 21 × 11.7 | 1.00× |
| Original film with caption, small 17 × 14.6 | 1.26× |
| 46 × 37.2, small 21 × 14.6 | 1.36× |
| Ours before f024f86, 46 × 87, small 21 × 33 | 3.25× |

- **The grow sets a bound.** A small face that is taller in proportion than the open box sticks out past it while they cross-fade. The tallest 21 cm small face that stays inside is 10.0 cm for the original link box, 12.3 cm for its text box and 17.0 cm for 37.2 cm (measured). A 14.6 cm face sticks out of the 27 cm text box by 2.5 cm at each edge.
- **So the open box need not equal the original's box for its kind, within four bounds.** It must be 46 cm wide, fixed before the card is placed, at least 2.19 times the small face's height, and no more than 37.2 cm for a text kind, the most any original text kind takes. 46 × 37.2 cm meets all four for every text kind, link included. Opening a note then moves the layer as opening an original chart does. Pictures keep the original's rule, the picture at most 46 × 32 cm with its plate under it.

### The flash

quest-cards-2 found and fixed it, and I relay its findings (I have not viewed its frames). The two faces cross-fade in one plane on a layer bent in 2.5 cm columns, and they hide each other in stripes. Bright faces show it. 220b457 sets the open face 1.5 mm in front (`openLift`). What must hold before the layout runs:

- Small and open sizes are worked out once, the first time the scene asks, and never change. A picture that arrives later is drawn into the same box (f024f86).
- Both faces are made before the card can open. The original makes its open face on the pinch in about 14 ms, and ours took 25 ms (quest-cards-2), more than a frame at any Quest 3 refresh rate.
- The open face stands 1.5 mm in front of the small one.
- The small face is at most 1 / 2.19 of the open height, so nothing sticks out while it grows.

### Scrolling and marking

- **The original scrolls nothing** (measured). It cuts text to its lines and zooms instead. A tap on the open card zooms into it (`OceanModel::tap` calls `zoomIn`), and two hands pinching and spreading zoom further (`OceanModel::magnifyChanged`).
- **How the original claims a drag today** (measured, `quest/core/ocean/oceanmodel_flags.cpp`).
  - `Input::update` (`quest/core/input.cpp`) calls `pinchChanged` when a pinch lands, and again each frame that the pinched point moves. The point moves with the hand at a gain of the card's distance over 0.6 m, held between 1 and 3, so 2 cm of point is about 8 to 10 mm of hand on the layer (inferred). In ray mode it stays still until the ray clearly swings.
  - In `OceanModel::pinchChanged`, a pinch on the open card claims the drag the first time its point is more than 2 cm from where it began: `if (!marking && length(d) > 0.02f) markBegin(...)`.
  - `markBegin` (`oceanmodel_tree.cpp`) sets `OceanModel::marking` only when the drag began on the picture or within 10 px of a block of words. Elsewhere nothing claims the drag.
  - `pinchEnded` calls `markEnd` when `marking` is set. A pinch that travelled less than 3.5 cm is a tap. Today that includes a mark of 2 to 3.5 cm, which also zooms.
  - So `OceanModel::marking`, set at the 2 cm mark, is the one state that decides. Nothing else claims a pinch on the open card.
- **The new rule, under `-cards` only.** A drag that starts on the content scrolls it. A pinch held still on words or a picture for 0.4 s, then dragged, marks. The build spec's section 4 gives the states, the edge cases and where each check goes. Without `-cards`, marking is unchanged.
- **A small card never scrolls.** A pinch on it opens it or carries it, as today.

## Card widths and characters per line

The width is the ring's, 21 cm. At the body size, a 177 px line holds about 20 letters or 11 Chinese characters. At the title size it holds about 20 letters or 9 Chinese characters, so a 2-line title is 31 to 40 letters or 18 Chinese characters. The opened card's 346 px column at 15 px holds about 45 letters or 23 Chinese characters. (Measured, as the middle of three English and three Chinese sample paragraphs laid out by the web's `wrap`.) None of the sources I read gives a VR line length. The brief's figure of 20 Chinese characters a line I could not trace to its cited article, so nothing rests on it.

## Each type

The face is 210 × 146 px, which is 21 × 14.6 cm at 1 mm a px. The ring's box sets every limit here, because at comfortable text nothing else binds first. "Designed" marks a type whose structure cannot be shown at 16 mm in the box, so its face says what the card holds instead. Counts are the middle of the samples, and every face below is at most 146 px tall (measured). "Web today" is the cap in `docs/libraries.md` in genui-int.

| Type | Face | Holds | Web today |
|---|---|---|---|
| note | Title, body, cue | Title 2 lines and 2 body lines (about 8 words or 22 Chinese characters), or title 1 line and 3 (about 12 words or 33) | Title 2, body 3 at 240 px |
| quote | Quotation mark, quotation in upright serif, speaker, cue | 3 lines and the speaker when that is all, else 2, the speaker and the cue (about 8 words or 20 Chinese) | 5 lines at 288 px |
| fact | Value as a figure, label, title as a foot | Value whole: 8 digits at 34 px, 11 at 24 px, else 2 lines at 18 px, up to the Renderer's 32 characters. Label 2 lines, 1 when the value takes 2. | Value up to 8 lines, 200 to 320 px |
| image | Picture, caption plate | Picture 210 px wide, 81 to 103 px tall. Caption 2 lines (about 8 words or 22 Chinese), else 1 line and the cue over an 85 px picture. | Picture 130 to 260 px at 240 px |
| video | Poster at 16:9 with its play mark, caption plate | Poster 183 × 103 px under a 1-line caption, 144 × 81 under 2 | Poster 272 × 153 px |
| audio | Title, play strip, transcript, cue | Title 1 line, the strip and 1 line of transcript (about 4 words or 11 Chinese). A 2-line title leaves the strip and the cue. | Transcript 3 lines at 272 px |
| link | Site bar, title, description, cue | Title 1 line and 2 description lines (about 8 words or 22 Chinese), or title 2 lines and 1. On the headset a picture taller than wide, such as a film's poster, stands at the right, 60 × 90 px. Any other, such as a page's own preview, lies in a 48 px band under the site bar, with the title on 1 line (DECISIONS 55). The web draws no picture on the small face. | Description 2, 272 or 316 px |
| chart | Designed: title, the shape, one meta line | Title; the bars or line, 38 to 62 px tall, with no text; one meta line with the count and the first and last labels, such as "12 points, 2015 to 2026" | 300 × 195 px with labels |
| person | Face, name, role | Face 48 px, name 2 lines of about 10 letters or 6 Chinese, role 2 lines | 252 × 88, each cut to 1 line |
| chat | Title, bubbles, cue | 2 messages of 1 line (about 14 letters or 8 Chinese) when that is all, else the first message whole in up to 2 lines and the cue | 3 messages at 288 px |
| code | Designed: title, one meta line | Title and "24 lines of Python". A line of source at 16 px holds 18 characters, so none is shown. | 7 lines at 304 px |
| steps | Title, numbered steps, cue | 2 steps of 1 line (about 17 letters or 9 Chinese each), or the first step whole in 2 lines | 5 steps cut to 1 line |
| facts | Title, a row of two figures, cue | 2 figures, values up to 5 digits at 24 px, labels 1 meta line; a longer value takes the row alone | 6 facts at 320 px |
| table | Designed: title, heads, count | Title 2 lines, the heads in meta joined by a middle dot as far as they fit whole with "+N" after, and "12 rows" | 6 rows × 5 columns, up to 352 px |
| list | Title, entries, cue | 3 entries of 1 line when that is all, else 2 and the cue (about 20 letters or 9 Chinese an entry); a checklist keeps its tally | 6 entries of 2 lines |
| breakdown | Designed: title, one bar, the largest part, cue | Title, a 16 px bar split into the parts, the largest part as a body line such as "Rent 42%", and "6 parts" | 8 parts at 300 px |
| qa | Question, answer, cue | Question 1 line and 2 answer lines (about 7 words or 18 Chinese), or 2 and 1 | Question 4, answer 6 |
| callout | Tone row, text at the title size, cue | 3 lines (about 11 words or 27 Chinese) | 5 lines |
| excerpt | Passage in upright serif, source line, cue | 4 lines and the source when that is all, else 3 and the cue (about 11 words or 30 Chinese) | 6 lines at 288 px |
| definition | Term as a figure, meaning in upright serif, cue | Term on 1 line at 24 px, or 2 at 18 px; meaning 3 lines when that is all, else 2 and the cue (about 8 words or 22 Chinese) | Meaning 6 lines |
| idea | Spark, the thought as a figure | 2 lines at 34 px, 3 at 24 px, or 3 at 18 px, 45 to 57 characters or 26 Chinese; a longer one ends with the cue | Under 60 characters |
| proscons | Designed: title, a first point a side, cue | Title, the first point for (+) and against (−) when each is whole on 1 line (about 20 letters or 9 Chinese), and "3 for, 2 against" in the item's own words | 4 points a side at 320 px |
| swatch | Band, title, a named row, cue | The band of up to 12 colours, the title and 1 named row | 6 rows |
| artwork | The work whole on a 6 px mat, title plate | Picture box 210 × 101 px, title 1 line; maker, date, medium and holder on the opened card | Mat 196 px, 7 plate lines |
| reference | Kind and year, title, first author | Kind and year in meta, title 2 lines, the first author with "and N others" in meta; the venue on the opened card | Title 3, authors 2, venue 2 |
| place | Name as a figure, then a map or words | With a point, the name and a 210 × 88 px map. Without one, the name and 3 lines of words, else 2 and the cue (about 8 words or 22 Chinese). | Picture, map and 3 lines |
| sheet | Title, the first part as its own preview, cue | The first part in 68 px (3 text lines, a row of two figures or 2 entries), and the cue counts the other parts | Every part, 140 px picture |
| explorable | Explore mark, title, the output's label, cue | The mark, the title in 1 line, the output's label as 1 line, and "2 controls"; the controls on the opened card | Every control at 288 px |

An item's headings and opening prose over its structure (`props.above`, in genui-g5a) go to the opened card only. On the small face they would take the room of the structure they head (judgment).

## The opened card

- **Box.** 46 × 37.2 cm (384 × 311 px at 1.198 mm a px, 17.4° × 14.1°) for every text kind, link included, fixed before the layout runs. Pictures keep the original's picture rule.
- **Text.** Title 21 px (25.2 mm), and every line that is read at 15 px (18 mm). That raises the 13.5 and 14 px detail text. Labels, tags, chips and the map credit are 11.5 px (13.8 mm).
- **Chips.** Every source, in full, as the web's opened card already lists them.
- **First view.** Under a 2-line title it holds 9 lines of body, at least 80 words or 189 Chinese characters (measured). The rest scrolls by a pinch-drag on the content.

## The note summary

The small note holds 2 body lines under a 2-line title and 3 under a 1-line title (measured). The least any sample held in 2 lines was 31 English characters, or 4 words, and 22 Chinese characters. In 3 lines it was 45 English characters and 33 Chinese.

So the service caps the summary at **30 English characters or 22 Chinese characters**. It may write up to **45 English or 33 Chinese** when the title it writes fits 1 line of the small note. The exact test is the footprint rule's own: the summary takes at most 2 lines (or 3) of the 177 px body column. The opened card shows the summary whole either way.

## What must change

The build spec below gives each change in full. In short:

- **Quest.** Draw the small face by the shared rule at 1 mm a px in place of shrinking the web card. Open every text kind to 46 × 37.2 cm. Put chips on the opened card only. Replace pages with a pinch-drag scroll, and marking with hold-then-drag. Keep the 1.5 mm lift and the fixed sizes.
- **Web.** Adopt the same small face: 210 px wide and at most 146 px tall, text at 18, 16 and 13.5 px in white at 0.82. Chips move to the opened card, and the cue replaces "and N more". Rewrite the caps in `docs/libraries.md` and regenerate `test/footprints.json`.
- **Service.** Cap the summary at 30 English or 22 Chinese characters, 45 or 33 under a 1-line title.

## Sources

Read for this document, with the claims they support marked "sourced" above:

- Meta, [Typography](https://developers.meta.com/horizon/design/styles_typography/), [Panels](https://developers.meta.com/horizon/design/panels/), [Horizon OS panel sizing](https://developers.meta.com/horizon/essentials/horizon-os-panel-sizing/) and [Compare devices](https://developers.meta.com/horizon/essentials/compare-devices).
- [Android XR, Visual design](https://developer.android.com/design/ui/xr/guides/visual-design).
- Apple, [Spatial layout](https://developer.apple.com/design/human-interface-guidelines/spatial-layout) and [Typography](https://developer.apple.com/design/human-interface-guidelines/typography).
- [Microsoft, Typography for mixed reality](https://learn.microsoft.com/en-us/windows/mixed-reality/design/typography).
- [Kojić et al. 2020](https://arxiv.org/abs/2004.01545) and [Kilpeläinen and Häkkinen 2023](https://www.frontiersin.org/journals/virtual-reality/articles/10.3389/frvir.2023.1243387/full). Hoffmann et al. 2019 is known only as the latter cites it.

Code read, in the quest-cards worktree: `quest/core/ocean/` (`stage.h`, `tree.h`, `tree.cpp`, `art.h`, `notes.cpp`, `catalog.cpp`, `cardview.h`, `cardview.cpp`, `hands.h`, `oceanmodel_cards.cpp`, `oceanmodel_threads.cpp`, `oceanmodel_flags.cpp`, `oceanmodel_tree.cpp`) and `quest/core/cards/` (`ocean.h`, `ocean.cpp`, `cards.cpp`) at f024f86 and after. Commits 220b457 and f024f86, and quest-cards-2's measured sizes in `scratchpad/qc/sizes-1.txt` and `sizes-2.txt`. In genui-int: `docs/libraries.md`, `client/style.css`, `client/js/components/*.js` and `test/footprints.json`. In genui-g5a: `docs/libraries.md`.

## How to rerun

```
node agents/scripts/quest-sizing.mjs
```

It takes the web library's components folder as an optional first argument, genui-int's `agents/client/js/components/` when none is given. Section 6 checks that every type's tallest face is at most 146 px.

## Build spec

This section stands alone. Sizes are in web px. On the Quest, the small face is drawn at 1 mm a px at 1.5 m (2 texture px a web px at `Art::ppm` 2000), and the opened card at 1.198 mm a px.

### 1. The small face

- **Box.** 210 px wide. Height as the content needs, at most 146 px. A picture-led face (image, video, artwork) may be narrower when its picture keeps its proportions.
- **Frame.** Padding 13 px top and bottom and 15 px each side, inside a 1 px border. Count 30 px of height and 33 px of width for the frame. The text column is 177 px.
- **Type.**

| Role | Size | Line | Weight | Colour |
|---|---|---|---|---|
| Title | 18 px | 24 px | 620 | white |
| Body | 16 px | 22 px | 500 | white at 0.82 or more |
| Meta, labels and the cue | 13.5 px | 18 px | 500 | white at 0.82 or more |
| Large and middle figures | 34 and 24 px | 36 and 28 px | 650 | white |
| Quotation, passage, meaning | 16 px upright serif | 22 px | 400 | white at 0.82 or more |

  Nothing that is read is under 13.5 px. Nothing is italic. The face is `#1b1d23`. Accents (marks, ticks, bars, the cue) take the card's colour.
- **Spacing.** 6 px under the title. A list keeps 5 px between entries, steps 8 px, and a row of figures 12 px.
- **Chips.** None on the small face.
- **Whole lines only.** The title is whole, up to 4 lines. Body lines and entries are whole, and one that does not fit is not drawn at all.
- **The cue.** When anything is left out, the last row is the cue, 18 px tall. It holds "More", or the count of what is left ("3 more", "12 rows", "6 parts"), in meta at the start of the row, in the accent colour. A 12 px gradient from the face colour at 0 to 1 sits above the cue, over the space under the last whole line, never over a letter. The cue's words come in English and Chinese, chosen as the card's fixed words are.
- **Never scrolls.** A pinch on a small card opens it (released within 3.5 cm) or carries it (moved 2 cm or more).
- **Counting.** Lines are counted with the web's `wrap`. Until the new faces are measured, count body and meta in the title face (`TITLE_LETTER` 93, measured at 16 px semibold), scaling the column by 16 / size, because that face is never narrower than the medium the text is drawn in. Then add measured advances for 16 px medium, 18 px semibold and 13.5 px medium to `ADVANCES`, `EM` and `FIGURES` in `shared.js`.

### 2. Each type's face

Heights are the most each face takes, every one at most 146 px. "Cue" means the 18 px cue row when anything is left out.

| Type | Face, top to bottom | Limit |
|---|---|---|
| note | frame, title, 6, body lines, cue | Title 2 lines and 2 body lines, or 1 and 3 |
| quote | frame, mark 22, quotation, 8, speaker in meta, cue | 3 lines and the speaker, or 2, the speaker and the cue |
| fact | frame, value 36 (28 or 2 × 24 when it steps down), 4, label lines, 8, title in meta | Value whole at 34, 24 or 18 px; label 2 lines, 1 when the value takes 2 |
| image | picture, 2, plate (19 + caption lines) | Picture 210 × 81 to 103; caption 2 lines, else 1 line and the cue |
| video | poster at 16:9, 2, plate | 183 × 103 under 1 caption line, 144 × 81 under 2 |
| audio | frame, title, 6, strip 40, 6, transcript lines, cue | Title 1 line and 1 transcript line, or title 2 and the strip |
| link | site bar 30, a wide picture's band 48, frame 26, title, 4, description lines, cue; a portrait picture 60 × 90 at the right | Title 1 and description 2, or title 2 and 1; title 1 under a band |
| chart | frame, title, 6, shape 38 to 62 with no text, 6, meta line | The meta line holds the count and the first and last labels |
| person | frame, face 48 beside the name (title) and the role (body) | Name 2 lines, role 2 lines |
| chat | frame, title, 2, bubbles (6 + 12 + 22 a line, at most 86% wide), cue | 2 one-line messages, or the first message in up to 2 lines and the cue |
| code | frame, title, 6, meta line | "N lines of Language"; no source |
| steps | frame, title, 10, steps (22 a line, number 22 round), cue | 2 one-line steps, or 1 step of 2 lines |
| facts | frame, title, 12, row of two figures (28 + 18 label), cue | 2 figures up to 5 digits, or 1 longer figure |
| table | frame, title, 6, heads in meta, 4, count in meta | Heads joined by a middle dot while whole, then "+N" |
| list | frame, title, 10, entries (22 a line, marker 20), cue | 3 one-line entries, or 2 and the cue |
| breakdown | frame, title, 6, bar 16 split by share, 8, largest part, 4, cue | One bar, one body line |
| qa | frame, 8, question (title), 6, answer lines, cue | Question 1 and answer 2, or 2 and 1 |
| callout | frame, tone row 24, text at the title size, cue | 3 lines |
| excerpt | frame, passage lines, 10, source in meta, cue | 4 lines and the source, or 3 and the cue |
| definition | frame, 10, term 28 (or 2 × 24), meaning lines, cue | Meaning 3 lines, or 2 and the cue |
| idea | frame, spark 22, thought | 2 lines at 34, 3 at 24, 3 at 18, else the cue |
| proscons | frame, title, 10, first point for, 5, first point against, cue | Each point whole on 1 line with its + or −; the cue reads "3 for, 2 against" |
| swatch | band 44, 29, title, 8, one named row, cue | 1 named row |
| artwork | picture box 210 × 101 (6 px mat, the work contained), 2, plate with the title | Title 1 line |
| reference | frame, kind and year in meta, rule 14, title, 6, first author in meta | Title 2 lines, "First Author and N others" |
| place | frame, name 28, then a map 210 × 88, or 8 and words with the cue | Map with a point, else words 3 lines, or 2 and the cue |
| sheet | frame, title, 6, the first part (68 px at most), cue | 3 text lines, a row of two figures or 2 entries |
| explorable | frame, mark 22, title, 10, the output's label, cue | Title 1 line, label 1 line, the cue counts the controls |

### 3. The opened card

- **Box.** 384 × 311 px (46 × 37.2 cm) for every text kind, which is text, chart and link. Picture kinds keep `Catalog::openSize`'s picture rule. The box is fixed when the card is first placed and never changes.
- **Type.** Title 21 px semibold. Every line that is read at 15 px medium, white at 0.82 or more. Labels, tags, chips and the map credit at 11.5 px.
- **Content.** Everything, which is the type's full form, the summary, the text, the lines over a structure, the tags, and every chip source in full.
- **Scrolling.** Only the content moves, inside the fixed box. The card never moves or resizes. Section 4 gives the gesture. Draw the whole sheet once, or in tiles of one view, and move the window, so a scroll never lays anything out again (judgment).

### 4. Scrolling and marking on the opened card

These rules hold under `-cards` (`Flags::has("cards")`) for every opened card, whether or not it overflows. Without `-cards`, nothing here changes. Distances are the pinched point's travel on the card, as `pinchChanged` receives it.

| A pinch on the opened card | Result |
|---|---|
| Released within 3.5 cm, nothing claimed | The tap it is today: `zoomIn` |
| Moves past 2 cm before the hold arms | Scrolls the content when it overflows, else does nothing |
| Held within 2 cm for 0.4 s on words or a picture, then moved past 2 cm | Marks, through `markBegin`, `markMove` and `markEnd` as today |
| Held 0.4 s on the margin, away from any block | Never arms, so a drag after it scrolls |
| Armed, then released within 3.5 cm | The tap it is today: `zoomIn` |
| A second hand pinches | Two-hand zoom; `magnifyChanged` cancels the press as today, and the content stays where it was |

- **Hold.** 0.4 s, the press-and-hold convention (judgment). The tolerance during the hold is 2 cm of point travel, the original's own drag threshold, about 8 to 10 mm of hand on the layer (inferred).
- **When it arms.** The word under the pinch takes the mark's own stroke, `Art::hot` (`#FF5A36`) at 0.45 opacity, as `markMove` draws a marked word. On a picture, the picture's frame takes a 2 px `Art::hot` outline. Either stays until the pinch ends.
- **Scroll.** The content follows the point's movement along the face one to one, in face coordinates from `onCard`. It stops at the top and at the end, with no fling and no bounce (judgment). Each time the card opens, the content starts at the top.
- **Settled first.** The hold timer does not start, and a drag does not scroll, until the card has finished growing and the layer has stopped gliding. In code, that is `time >= max(c.openMix.end(), c.xy.end(), c.nudge.end(), focusLevel.end(), pan.end())`. A release without travel is still a tap.
- **A claimed drag is never a tap.** Once a pinch scrolls or marks, its release does neither zoom nor anything else. This changes today's case where a 2 to 3.5 cm mark also zooms, and only under `-cards`.
- **The indicator.** A bar 4 px wide (4.8 mm) inside the right edge, 12 px from the top and the bottom, in white at 0.4 (judgment). Its thumb's length is the visible share of the content, and its place is the scrolled share. It is drawn only while the content overflows. It is not a target, so a pinch on it is a pinch on the content.
- **Tap to zoom and the two-hand spread are unchanged.** A tap still zooms. The zoom scales the whole card, and the scroll offset is kept in face coordinates, so it holds through a zoom.

**Where it goes in the code** (quest-cards worktree):

- `OceanModel::Press` (`oceanmodel.h`). Add `double began`, `bool armed`, and `enum class Claim { open, scroll, mark, spent } claim`. This `claim` is the state that decides, in place of `marking` alone.
- `OceanModel::update` (`oceanmodel.cpp`). Under `-cards`, check the hold every frame, because `pinchChanged` is not called while the hand is still. When a press is on the focused card, its claim is `open`, it is settled, 0.4 s have passed since it began or since it settled (whichever is later), and it has travelled no more than 2 cm, set `armed` when the point lies on a block or the picture, the same test `markBegin` makes, and draw the arming stroke.
- `OceanModel::pinchChanged` (`oceanmodel_flags.cpp`), in the `Pick::Kind::card` branch where `tree->focus() == id`. Under `-cards`, replace `if (!marking && length(d) > 0.02f) markBegin(...)`. When `claim == open` and `length(d) > 0.02f`, then if `armed`, set `claim = mark` and call `markBegin`. Otherwise, if the card is settled and overflows, set `claim = scroll`. Otherwise set `claim = spent`. Then `claim == mark` calls `markMove`, and `claim == scroll` sets the offset.
- `OceanModel::pinchEnded` (`oceanmodel_flags.cpp`). `claim == mark` calls `markEnd` and returns. `claim == scroll` or `spent` returns. `claim == open` with less than 3.5 cm of travel calls `tap`, as today.
- `OceanModel::magnifyChanged`. Unchanged. It already sets `press->cancelled`.
- The scroll offset and its range live with the open face: `cards::ocean` keeps them by note, and `CardView` draws the window and the indicator.

### 5. Motion and the flash

- Small and open sizes are worked out the first time the scene asks and kept until the card is put again.
- Both faces, and the opened sheet, are made before the card can open.
- The open face stands 1.5 mm in front of the small face (`openLift`).
- The small face's height is at most the open height / 2.19, which 146 px against 311 px meets.

### 6. Quest code to change (quest-cards worktree)

- `cards::ocean::shownOf` (`quest/core/cards/ocean.cpp`). Replace the shrink-to-fit `smallK = min(smallNoteWidth / width, smallCeiling / height)` with the fixed 1 mm a px of the shared rule, and the footprint of section 2. Keep `smallCeiling` only as the 146 px check.
- `cards::sized` and `cards::small` (`quest/core/cards/cards.cpp`). Drop `CHIP_LINE` and the chip line from the small face, and draw the cue.
- `Kind::size` and `Kind::draw` in each `quest/core/cards/<type>.cpp`. Draw section 2's face.
- `Catalog::openSize`, as `cards::ocean` calls it through `Kind::opens`. Open text, chart and link kinds to 46 × 37.2 cm.
- `cards::paginate`, `cards::layOut` and `cards::open` (`cards.cpp`), and `cards::ocean::pages`, `page` and `turn` (`ocean.cpp`). Replace the pages with one sheet, a scroll offset and its range.
- `OceanModel::buildRows` (`oceanmodel_cards.cpp`), `OceanModel::turnPage` (`oceanmodel_tree.cpp`) and `Pick::page` (`oceanmodel.h`). Remove the "Next page" row and its tap. The other rows under the card stay. Replace the `-pageAt` and `-pageAgainAt` flags with a flag that scrolls the open card by a given share, for the preview.
- `OceanModel::Press`, `OceanModel::update`, `pinchChanged` and `pinchEnded`, as section 4 gives them.
- Keep `openLift` in `cardview.h` and the early open face from f024f86.

### 7. Web code to change (genui-int, `agents/`)

- `client/js/components/shared.js`. Constants `TITLE` 24, `TEXT` 22, a new `META` 18 and `CUE` 18. The figures' smallest step goes to 18 px on 24. Add the new faces' advances.
- `client/js/components/<type>.js`. Each `size` and `draw` follows section 2, with every width 210.
- `client/js/components/index.js`. `sizeOf` no longer adds `CHIP_LINE`, and `drawCard` draws no chip line on the face. The chips move to `drawDetail` and the opened panel.
- `client/style.css`. Card faces at 18, 16 and 13.5 px, weight 500, white at 0.82. `.card-text`, `.card-foot` and `.kind` leave `--ink-2` and `--ink-3`. The panel's 13.5 and 14 px detail text goes to 15 px, and the panel's labels, tags and credit to at least 11.5 px.
- `client/js/words.js`. Add the cue's words in English and Chinese: "More", "N more", "N rows", "N points", "N parts", "N lines of …", "N for, M against", "N controls".
- `test/footprints.json`, regenerated by `scripts/footprints.ts`, with samples at each limit.

### 8. `docs/libraries.md` caps that change

- **Constants.** `TITLE` 21 → 24, `TEXT` 17 → 22, add `META` 18 and `CUE` 18. `FRAME` 30 and `SIDES` 33 stay.
- **Figures.** The smallest size, 21 px lines at letter 105, becomes 18 px on 24 lines.
- **The chip line.** It moves to the opened card. A card's footprint never adds 28 px.
- **"and N more".** The 25 px foot (`8 + TEXT`) becomes the 18 px cue.
- **Each type.** Every width becomes 210. The note's body goes from 3 lines to 2 or 3. The quote goes from 5 lines to 3, or 2 and the cue. Image and video pictures go to 81 to 103 px. Audio's transcript drops to 1 line. The link loses its thumbnail and keeps 1 or 2 description lines. The chart, code, table, breakdown and pros and cons faces become the designed previews of section 2. Steps go from 5 to 2, facts from 6 to 2, lists from 6 to 2 or 3, qa answers from 6 lines to 1 or 2, callouts from 5 lines to 3, excerpts from 6 to 3 or 4, and definitions from 6 to 2 or 3. An idea's middle size holds 3 lines in place of 4, and its smallest size becomes 18 px on 3 lines in place of 21 px lines on 5. Swatch rows go from 6 to 1. The artwork's mat goes from 196 px to a 101 px picture box with a 1-line plate. The reference goes to a 2-line title and the first author. The place shows a map or words, and the sheet shows its first part.
- **Lines over a structure.** `props.above` is drawn on the opened card only.
- **Fixed words.** Add the cue's words.

### 9. Service

- The summary is at most 2 lines of the small note's 177 px body column, which is 30 English or 22 Chinese characters. When the title fits 1 line of the title column, it may take 3 lines, 45 English or 33 Chinese.
- Titles fit 2 lines of the title column where the service writes them, 31 to 40 English or 18 Chinese characters.

### 10. Checks

- Every sample of every type in `test/footprints.json` is at most 210 × 146 px on both clients.
- No sample draws a line it did not count, and no line is cut. A face with content left out shows the cue.
- Under `-cards`, on an opened card that overflows: a drag started at once scrolls, and the card does not move. A pinch held still for 0.4 s on a word shows the stroke, and a drag after it marks. A pinch released without travel zooms. A second hand's spread zooms and cancels the press. Nothing scrolls or arms while the card grows or the layer glides. The indicator shows the visible share.
- Without `-cards`, a drag of 2 cm on the open card marks at once, as today.
- On the headset, open a note, a chart, a link and a picture. Check that no neighbour overlaps, that no face sticks out while growing, and that there is no flash.
