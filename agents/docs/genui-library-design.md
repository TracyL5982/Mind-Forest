# Generative UI library: second pass (design)

Status: awaiting approval. Nothing here is built yet.

## Why

The library has 11 card types and 6 arrangements. It was shaped around art and media, every card is the same grey box with small type, and the model is consulted about format only for plain text of 40 characters or more, choosing among five types. Mind Palace is used for research, brainstorming and memories, and will be used for more. The aim is that each piece of information is shown in the best format the system can give it, and that the result looks good.

The prompt for this pass was a gallery of another product's generative UI (65 building blocks, 35 composites). We take ideas from it, not its architecture.

## Goals

1. Each item is drawn in the format that suits its content, and we can measure how often that is true.
2. The catalogue covers research, brainstorming and memories.
3. Content that fits no catalogue entry still gets a fitting shape: one assembled card, one assembled arrangement.
4. Cards and arrangements look good and distinct from each other.
5. Everything the model claims is still checked against the item's own content.

## Non-goals

- Controls that collect input from the user (forms, wizards, date pickers). Controls that let the user explore content are in: see step 5.
- Recording a voice memo inside the app. Audio files can be dropped in.
- Routes and directions on maps.
- The Quest client. `docs/libraries.md` stays the specification a Quest client will be built from, and is updated.
- Changes to how the Scout searches or chooses, to the Organizer, or to the tree layout. (The Scout does pass more of each record through; see step 2.)
- Scaling a card inside a group. A card keeps its own footprint everywhere.

## Anti-goals

- The model placing anything by coordinates.
- An assembled arrangement chosen where a built-in one fits.
- Chips or badges crowding small cards.
- A card showing a value its item does not contain.

## Constraints

- A card's footprint is a pure function of the item and props (`size()` in each module of `client/js/components/`). The field is laid out without measuring the page. This holds for every new type, including the assembled card.
- The model API rejects recursive reply schemas and optional keys. Replies are flat, with every key present and empty meaning absent.
- `isValidView` and `isValidGroup` reject anything a schema does not describe. A client that meets an unknown component draws a note, and an unknown composite draws a cluster. Both stay true.
- Views already stored stay valid. No migration.
- No new dependencies in steps 1 to 4. Step 5 may add one small library to read a photo's location if writing it by hand proves unreasonable. The client stays plain JavaScript modules.

## Approaches considered

**For the long tail of content**

1. *Keep adding fixed types.* Always looks right. Never finished: each activity wants three more.
2. *Free building blocks the model composes (the gallery's way).* Most flexible. Loses the fixed footprint and the content check, and every client must implement a layout engine for cards.
3. *Fixed catalogue plus one assembled card and one assembled arrangement, both built from a small closed grammar.* **Chosen.** The catalogue handles the common shapes well, and the grammar handles the rest within the same guarantees.

**For the assembled arrangement**

1. *Free positions.* Ruled out: often looks wrong.
2. *More fixed templates.* The closed list again.
3. *A layout grammar the client turns into positions.* **Chosen.**

**For date, place, people and source**

1. *Opened view only.* Cleanest cards, but a memory and a research excerpt look alike at a glance, and a pick's origin is hidden.
2. *One optional line of chips on any card.* **Chosen.** Shown only when the data exists.
3. *A dedicated card type per combination.* The catalogue grows without limit.

## The design

The work lands in five steps. Each is reviewed on `client/library.html` before the next begins.

### Step 1: restyle and chips

**Restyle.** The theme stays dark and keeps its two reserved colours (amber for picks, teal for links). Changes:

- A type scale with three clear levels in place of today's near-uniform 11 to 15 px.
- A distinct treatment per card type, so types are told apart at canvas zoom: for example a serif quote on a tinted face, a large figure for a fact, a framed picture for an artwork.
- Charts get gridlines, readable labels and a marked value.
- Group frames get lighter, so the cards inside carry the weight.
- A small kind badge where the type would otherwise be unclear.

Exact colours, sizes and treatments are the builder's, judged on `library.html`.

**Chips.** Any card may show one line of chips under its content, drawn by shared code:

- Sources, in order: `data.when`, `data.where`, `data.people` (first two names, then a count), and the origin (site, museum, journal) for agent picks.
- At most three chips. One line. Each chip is cut to fit.
- The line adds a fixed height to the footprint only when at least one chip exists.
- Chips come from the item, not from view props, so no model output is involved.
- Cards whose type already shows a value do not repeat it (a link card does not add a site chip).

### Step 2: more structure, and the new card types by rule

**Intake extracts more structure.** `describe.ts` gains fields, each filled only when the content states it, each checked against the text read as quote and chart are today:

- `where`, `people`
- `pros`, `cons`
- `table` (column heads and rows)
- `question`, `answer`
- `term`, `definition`
- `items` (an unordered list) and whether it is a checklist
- `colours` (hex values or named colours)
- `excerpt` (a passage worth quoting from a source, with where in the source it sits)

**The Scout passes more of each record through.** Today a pick's `item.data` holds only `site`, `by`, `date` and `from`; medium reaches only the text, authors are cut to "X et al.", and venue is never requested. `Found` in `src/core/ports.ts` gains optional `medium`, `holder`, `authors`, `venue` and `kind` (artwork, paper, book), the adapters in `src/node/sources.ts` fill them, and `scout.ts` copies them into `item.data`. How the Scout searches and chooses does not change.

**Fourteen new types**, each with a schema, a rule, a drawing, an opened view in `drawDetail`, and a sample on `library.html`. With `sheet` in step 3 the total reaches 26.

| Type | Draws | Chosen by rule when |
|---|---|---|
| `facts` | Two to six figures with labels | `data.facts` holds more than one |
| `table` | Up to 5 columns and 6 rows, with a count of the rest | `data.table` |
| `list` | Bullets or tick boxes | `data.items` |
| `breakdown` | Horizontal bars with shares | `data.chart` whose unit is a percent and whose values sum to about 100 |
| `qa` | A question and its answer | `data.question` and `data.answer` |
| `callout` | A caveat or warning, set apart | Never by rule. Model only (step 3) |
| `excerpt` | A passage with its source | `data.excerpt` |
| `definition` | A term and its meaning | `data.term` |
| `idea` | A short thought, set large | Text the user wrote, under 40 characters, with no structure |
| `proscons` | Two columns | `data.pros` and `data.cons` |
| `swatch` | Colour chips with names | `data.colours` |
| `artwork` | Picture with maker, date, medium, holder | A pick of kind artwork with a picture |
| `reference` | A paper or book: authors, year, venue | A pick of kind paper or book |
| `place` | Name, address, optional picture, and a small map once step 5 lands | `data.where` and the item's title names the place |

A photo with a date and a place needs no type of its own: it is an `image` with chips.

`grounded` extends to each new type: every string must appear in the item's content after the existing normalisation, and every number must be written there.

### Step 3: format choice by the model, the assembled card, and the sample set

**The Renderer asks the model more often, about the whole catalogue.** Rules still run first. A rule result is sure, and the model is not asked, when:

- it rests on structured data in `item.data`, or on a fact matched by the existing patterns;
- the item's kind is image, video, code or chat;
- the item's kind is link. A link stays a link card unless intake found structure in the page, in which case the rule above already applies. This keeps page text out of the Renderer's model calls.

Everything else is unsure: items of kind text or file that the rules left as a note or an idea, whether the user wrote them or the Scout picked them. These go to the model, which may choose any type that can be built from text, or `sheet`. The 40 character floor and the caps on items per pass stay. A failed claim drops to the rule result.

**The assembled card (`sheet`).** One to four sections from a closed set: heading, text, figures, list, table, picture, excerpt. Fixed width. Height is the sum of each section's computed height, with a cap; content past the cap moves to the opened view. Each section is checked against the item like any other claim. A dedicated type always wins when one fits.

**A sample set measures format choice.** About 60 sample items across research, brainstorming and memories, each with the format a person would expect.

- The rule path runs in `npm test` with no model.
- A script (`npm run formats`) runs the live model over the set and prints a score and the misses. It needs a key and costs money, so it is not part of `npm test`.
- There is no pass mark. The first run sets a baseline that is written into `docs/libraries.md`; later changes to rules or prompts must not lower it.

### Step 4: new arrangements and the layout grammar

Seven new arrangements, bringing the total to 13.

| Arrangement | Draws | Chosen by |
|---|---|---|
| `ranked` | Members numbered, best first, with a line of reason each | Model |
| `beforeafter` | Two members with the change named between them | Model |
| `lead` | One member alone on the first row under the group title, its support in a row beneath | Model |
| `overview` | Figures in a row above a chart | Plain code: among ungrouped siblings, exactly one `chart` or `breakdown` and two to five `fact` or `facts` |
| `moodboard` | Pictures, swatches and ideas packed in columns at their own differing footprints | Plain code: four or more ungrouped siblings that are all picture-led, `swatch` or `idea`, with at least two pictures and at least one that is not a picture |
| `matrix` | A 2 by 2 with two named axes | Model |
| `layout` | The assembled arrangement (below) | Model, last resort |

The plain-code rules run in this order: `overview`, `moodboard`, `gallery`, `timeline`, `stack`. A pool of only pictures and clips is still a `gallery`, so existing galleries do not change.

**The assembled arrangement (`layout`).** The model describes structure. The client computes positions with the same spacing code the built-in arrangements use.

- Containers are rows, columns and grids, nested up to **4 deep**.
- Each member has a role: lead, normal or minor. A lead takes a row or column to itself and a minor sits last; no role changes a card's footprint.
- A container may carry a short label. Adjacent members in a row or column may be joined by an arrow or a line.
- The model returns a flat list of containers, each naming its parent, because the API rejects recursive shapes. Depth is checked when the list is validated.

Guards:

- Limits in the schema: at most 12 members, 8 containers, depth 4, labels of a few words.
- A container with one child is collapsed before layout.
- After layout the block's shape is checked: within a maximum width and height, and not extremely wide or tall. On failure the group is drawn as a cluster.
- The layout function is plain code. Tests generate many valid structures and assert that no two cards overlap and every card sits inside the frame.
- The prompt lists the built-in arrangements first and says to use `layout` only when none fits. The sample set includes pools where a built-in is the right answer.

The existing composite rules stay: kept with kept and picks with picks, one group per node, no group as the usual answer.

### Step 5: explorable cards, audio and maps

Two more card types and one more arrangement: 28 types and 14 arrangements in all.

**Explorable cards (`explorable`).** For content that explains a concept, the card carries one to three controls that change what it shows.

- *Toggle and segmented control.* They switch between named states. Each state's content is stated in the item and checked like any other claim. Example: a dolly zoom shown as "zoom only", "dolly only", "both".
- *Slider.* It drives one quantity in a formula, and the result is shown as a figure or a chart. Example: field of view against focal length.
- Formulas are written in a small closed language: numbers, named quantities, `+ - * / ^`, brackets, and a short list of functions (`min`, `max`, `round`, `sqrt`, `exp`, `ln`). A small evaluator in shared code runs them. Nothing the model writes is ever executed as code.
- A formula cannot be checked as a substring, so it is checked by result: at the values the content states, it must give the numbers the content states, within a small tolerance. A formula that fails is dropped and the item falls back to its rule result. Values the slider reaches beyond the stated ones are marked as computed.
- On the canvas the card shows its default state and a mark that it can be explored. The controls work in the opened view, because a drag on the canvas moves the card.
- Chosen by the model only, when the content relates quantities or contrasts states. The sample set gains explainer items.

**Audio.** A `transcribe` port already exists for voice commands.

- `audio` joins the item kinds. A dropped audio file is stored as an asset, transcribed, and the transcript is described like any text, so it is searchable and can carry structure.
- The `audio` card shows a play mark, the length, a waveform and the first lines of the transcript. The opened view has the player and the full transcript.
- A Scout pick whose record carries audio (`Found.media`) is drawn the same way.

**Maps.**

- A location comes from a photo's embedded coordinates, read at intake, or from looking up `data.where` with a geocoder. Coordinates are stored in `data.at`. Lookups are cached.
- The `place` card gains a small map. Any card with coordinates shows its place as a chip.
- New arrangement `map`: three or more ungrouped siblings with coordinates at two or more distinct places, chosen by plain code. Numbered pins on a map, members beside it in pin order. It runs before `timeline` in the rule order.
- The map is described to clients as a centre, a zoom and pins. A client draws tiles from the configured provider. The provider sits behind one setting so it can be changed without touching clients.
- Decided by the owner: OpenStreetMap's public tile and lookup servers for now. They need no key but allow light use only and require a visible credit, so a commercial provider replaces them before the product ships.
- Looking up a place sends its name to the geocoder. That is a new kind of data leaving the machine, and it is switched off unless a provider is configured.

## What each step touches

- `src/core/views.ts`: schemas.
- `src/core/roles/renderer.ts`: rules, prompts, reply schemas, checks.
- `src/core/roles/intake/describe.ts`: extraction (step 2).
- `src/core/ports.ts`, `src/node/sources.ts`, `src/core/roles/scout.ts`: the extra record fields (step 2).
- `client/js/components/`, `client/js/composites/`, `client/style.css`: drawing.
- `client/library.html`: a sample of every type and arrangement, plus assembled examples.
- `test/renderer.test.ts`, `test/intake.test.ts`, a new layout test, the sample set.
- `src/core/domain.ts`, `src/core/roles/intake.ts`, `client/js/input.js`: the audio kind (step 5).
- A formula evaluator in `src/core`, shared with the client (step 5).
- A geocoder port in `src/core/ports.ts` with its adapter in `src/node` (step 5).
- `docs/libraries.md`: a section per new entry, and the layout grammar written so a second client can implement it.

## Left to the builder

- Exact visual treatments, sizes, colours and caps.
- The shape of the flat reply schemas, and whether format choice is one model call or two.
- Names of data fields, where this document's names clash with existing ones.
- The numeric thresholds of the shape check.
- Which of the 60 samples to write.

## Calls made by the author, not yet confirmed by the owner

- Explorable controls work in the opened view, not on the canvas card.
- Sliders are driven by a closed formula language, never by model-written code.
- Recording a voice memo in the app is out. Dropped audio files are in.
- Place lookups are off until a map provider is configured.
- Chips are limited to three on one line.
- `lead`, `matrix` and `moodboard` are included though not discussed by name.
- The Scout is changed, but only to pass more record fields through.
- No card is ever scaled inside a group, so `lead` and `moodboard` work by position only.
- Links are never sent to the Renderer's model; only text and file items are.
- The sample set has no pass mark, only a baseline that must not drop.
- The live-model sample run is a script, not part of `npm test`.
- `sheet` is capped at four sections.

