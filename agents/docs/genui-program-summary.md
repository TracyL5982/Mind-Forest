# The generative UI card program: what was built

This is a record of one working session on 2026-11-14. It rebuilt Mind Palace's card and arrangement libraries and brought the cards to the Quest 3. Everything described here is on `tracy/agents`.

The goal, in the product owner's words, was that "each info is presented in the best format possible, through our genui system". A second goal came up during the work and became the rule everything else serves: a card never shows something its item does not state, and never changes what the item means.

## What exists now

| Part | Where | What it is |
|---|---|---|
| Card types | `agents/src/core/views.ts` (`COMPONENTS`, `CHECKS`), `agents/client/js/components/` | 28 types |
| Arrangements | `agents/src/core/views.ts` (`COMPOSITES`), `agents/client/js/composites/` | 14 ways to arrange a group of cards |
| Choosing a card | `agents/src/core/roles/renderer.ts`, `agents/src/core/grounding.ts` | Rules first, then the model for items the rules are unsure about |
| Fitting text to a card | `agents/src/core/fitted.ts` | Short titles and summaries, written to fit |
| Quest cards | `quest/core/cards/` | All 28 types drawn natively, with an API for the agent bridge |
| The library page | `agents/client/library.html` | Every type and arrangement, drawn by the live client's code |

The 28 card types are note, quote, fact, image, video, audio, link, chart, person, chat, code, steps, facts, table, list, breakdown, qa, callout, excerpt, definition, idea, proscons, swatch, artwork, reference, place, sheet and explorable.

The 14 arrangements are gallery, timeline, comparison, sequence, cluster, stack, ranked, beforeafter, lead, overview, moodboard, matrix, map and layout. `layout` assembles itself, up to four levels deep, when no other arrangement fits.

To see them all, run `npm run dev:fake` in `agents/` and open `/library.html`. On the headset, launch with `-cards` and no agent, or add `-cardsGallery` when the agent is connected.

## The order of the work

The plan was ten stacked changes, G1 to G10. The design is in `genui-library-design.md` and the plan in `genui-library-plan.md`.

| Step | What it added |
|---|---|
| G1 | A restyle of the existing cards. Card sizes are computed from a letter-width table, never measured |
| G2 | Chips: one line for when, where, who and source |
| G3 | Intake reads structure from what comes in: tables, lists, steps, people, places, quotes |
| G4 | Fourteen more card types, chosen by an ordered rule table |
| G5 | The model may choose a card for items the rules are unsure about, and the `sheet` type |
| G6 | Six more arrangements |
| G7 | The self-assembling `layout` |
| G8 | `explorable`: a toggle, a choice of states or a slider. A slider's formula is kept only when it gives every value the item states, within 1 percent |
| G9 | `audio` |
| G10 | Maps on place cards, and the `map` arrangement with numbered pins. Maps are off unless `MIND_PALACE_MAPS` is set |

After G10 came three pieces that were not in the plan: the whole-item rule, the sizing rule, and the Quest card library.

## The whole-item rule

This took five rounds, and the first four failed an independent check. It is the part of the work most worth understanding.

**What kept failing.** Rounds one to four let a card show a chosen part of its item, then checked with string matching that the part kept the item's meaning. Every round, a checker found cards that misled. Three examples:

- A list under "Don'ts:" was drawn without the heading, so it read as advice.
- "✗ Keep it in the freezer." became a caution card saying "Keep it in the freezer."
- "可以给宝宝喝蜂蜜水" was shown without its next line, "一岁以后".

The cause was the same each time. What governs a line's meaning can sit anywhere outside the line: a heading, a sentence two lines back, a mark, the row a cell belongs to. No list of negative words covers that.

**What replaced it.** Structure changes layout, never selection.

- A structured card shows its whole item, in order.
- The item's own headings and opening lines are drawn above the structure. They arrive in the view props `above` and `heads`.
- A card never draws the model's wording. The model points at lines of the item, and the service draws the item's own characters from those positions, with every sign, number, mark and quotation mark.
- A table cell stays in its own row and column. A figure's label and value are the two sides of its own line.
- Anything that cannot be shown whole stays a note.

**How it was checked.** An independent agent wrote hostile and realistic items in English and Chinese at each round, more than 150 in the last three rounds, and read every card drawn. At the final version, every earlier failure was closed and 16 of 18 everyday items got the card a person would expect. `agents/docs/formats.md` has the measurements and the sample set, `agents/test/fixtures/formats.json`.

**What it cost.** On 120 samples picked by independent reviewers, the rules' card matches the reviewers' pick 109 times, down from 116 before the rule. The cards lost are mostly ones that pulled one sentence or one figure out of prose.

## The sizing rule

Card sizes were first designed for a web page. They were then rederived for the Quest 3, working back from readability at the headset's 1.5 m working distance. Published guidance decided each conflict. The derivation is `quest-card-sizing.md`, and `agents/scripts/quest-sizing.mjs` reproduces its numbers.

| Part | Rule |
|---|---|
| Small card | 210 px wide and at most 146 px tall, which is 21 by 14.6 cm on the headset at 1 mm per px |
| Text | Title 18 px, body 16 px, labels 13.5 px. Medium weight or heavier, near-white on dark |
| Content | Whole lines up to the type's limit, then a cue such as "More", "3 more" or "12 rows". No line is cut |
| Dense types | Chart, code, table, breakdown and pros and cons draw a designed preview, not shrunken text |
| Titles | At most two lines. A longer one ends with an ellipsis, the only one a card draws |
| Chips | On the opened card only |
| Opened card | Holds everything and scrolls |

The small-card box comes from the Quest scene's layout, which places cards round an opened card and cannot take larger ones without overlap. Text sizes come from Microsoft's mixed reality typography guidance, scaled to 1.5 m.

The service writes to fit. `fittedTitle` and `fittedSummary` hold what the model writes to the card's lines. A title from a source, such as a paper or an artwork, is never rewritten: `item.title` stays whole, and `item.data.shortTitle` is added when the whole title does not fit two lines.

## The Quest card library

`quest/core/cards/` draws all 28 types on the headset. Its README has the API.

- **Colours.** Cards use the Ocean's own palette: flat dark faces, white text, the tag tones for chips and marks, and `Art::hot` only for where you are and what you send.
- **Existing content.** Under `-cards`, the ocean's notes, films and works draw as cards.
- **Opening a card.** A card opens to a fixed 46 by 37.2 cm box. Its size is fixed before the layout reads it. This removed a flash, a large push of neighbouring cards, and overlaps, all reported from the headset.
- **Scrolling and marking.** Under `-cards`, a pinch-drag on an opened card scrolls it. A pinch held still for 0.4 s and then dragged marks a passage. A quick pinch still zooms.
- **With the agent.** `quest/tools/agent.sh` launches with `-agent -cards`. The service's trees stand, and library pieces draw as cards. `-cardsGallery` adds the sample gallery.

Its checks are in `quest/core/cards/test/`: `sizes.sh` (every sample inside the size rule), `run.sh` (footprints against the web's) and `pieces.sh` (every note, film and work of the ocean draws).

## What is not built

- Arrangements on the Quest. Cards in a group draw, but the group's layout does not.
- Working explorable controls on the Quest. The small card is drawn, and the opened card writes the states out as text.
- A run of the whole-item prompts against the live model. All measurements used saved replies and scripted ones.

## Known rough edges

- A person mentioned in ordinary prose stays a note, because a person card must show its whole item.
- A quote whose speaker line is itself a sentence is drawn with that sentence as the speaker.
- A callout still writes its own tone word, such as "Caution".
- Choosing cards for 500 items takes about 30 ms, up from about 21 ms.
- One browser check failed once and passed on rerun: a seeded image card was drawn as a note.
- On the web, arrangement labels are still 12.5 px, under the 13.5 px floor for cards.

## How the session was run

One coordinating agent wrote briefs and merged results. Each piece had one owning agent in its own git worktree. Independent agents checked the risky pieces. Three practices are worth keeping.

- **Measure a new rule before building it.** The whole-item rule was first run as a filter over every test set. That showed a first version of the rule, which worked by sections, still failed, before any code was written.
- **Check with someone who did not write the code.** Each of the four failed rounds passed its author's own tests.
- **Report scores in separate groups.** A score on samples the authors wrote looked far better than the score on samples reviewers picked.
