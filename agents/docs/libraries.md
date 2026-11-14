# The component and composite libraries

This page is for the people who draw Mind Palace content in the headset. It lists every way one item can be drawn (a component) and every way several sibling nodes can be drawn together (a composite).

The schemas live in `src/core/views.ts`. The Renderer role in `src/core/roles/renderer.ts` chooses among them. A client never chooses. It draws what the node's `view` and the tree's groups say.

## How a view reaches the client

1. A node is created with a default view (`view.by` is `default`). The default comes from the item's kind alone, so it arrives at once.
2. The pipeline hands the new or changed nodes to the Renderer.
3. The Renderer returns `setView` for each node whose view should change, and `setGroup` or `removeGroup` for composites. A view it chose has `view.by` set to `renderer`.
4. The client swaps the view in place.

A view is `{ component, props, by }`. Props carry only what the item does not already hold. Draw from the item plus the props. The title always comes from `item.title`.

A group is `{ id, treeId, anchor, composite, title, members, props }`. `anchor` is the parent node. `members` are node ids, in drawing order. `title` may be empty.

## How the web client draws them

`client/library.html` draws every component and composite from sample data with the live client's code. Open it to see the current look. Under each sample it states the type name and the footprint.

- Each component is one module, `client/js/components/<type>.js`, that exports `size`, `draw` and `detail`. Each composite is one module in `client/js/composites/`. The `index.js` in each folder is the registry.
- `size(item, props)` is the card's footprint in px. It is worked out from the content and never measured, so the field can be laid out before anything is drawn. The next section gives the rule.
- Text on the field is set in three sizes, named `--type-display`, `--type-title` and `--type-text` in `client/style.css`. A fact's value that is too long for its card steps down to a middle size, then to the title size.
- Each type has its own face, so types can be told apart when zoomed out. A note is plain. A quote is a serif on a face washed with the tree's colour. A fact is one large figure on a darker face. A picture or clip has tight corners and its caption on a plate below. A link sits under an address bar. A chart has gridlines and a scale. A person has a round face beside the name. A chat is speech bubbles. Code is fixed-width with a numbered gutter. Steps are numbers down a rail.
- A card's marks take its tree's colour. While the card is a pick they are amber, its border is dashed and its face is darker. A pick's face is never see-through.
- Amber is also the three dots on a card the agents are working on. Teal is the links between cards, and the ring on the card that a dragged card would land under.
- A small label in capitals names what the look alone cannot: a group frame's kind, a code card's language when it is known, and where a chat came from. A clip is named by its play mark and a chat by its bubbles, so neither carries a label for its type.
- A group frame is a faint wash and a hairline.
- The field draws a pick at 0.86 of its footprint and the first card of a tree at 1.12. Every other card is drawn at 1. A selected card keeps its scale. Selecting adds a ring outside the card and changes no size.
- A card's drawn size is its footprint times its scale, kept as a fraction: a 240 by 51 pick is 206.4 by 43.86. Layout works on drawn sizes and card centres in IEEE doubles and rounds nothing on the way, so equal footprints give equal positions. The web client rounds once, when it writes a card's top-left corner to the page, to one decimal place of a px. The one exception is inside a gallery, a cluster and an opened stack, where the cell sizes are rounded up as that section says.

## How a card's footprint is worked out

A second client must give every card the same footprint as the web client, because the field is laid out from footprints alone. This section is the whole rule. `test/footprints.json` holds sample cards with the footprint each must get. `npm test` checks the web client against it, and a second client should run the same file through its own code.

All arithmetic is in whole numbers. `up(a, b)` is `a / b` rounded up. `clamp(v, lo, hi)` holds `v` between `lo` and `hi`. A prop that is not a string counts as an empty string. A prop "is set" when it is a string that is not empty, so a string of spaces is set. A card whose component is unknown is sized as a note with no props.

### The width of a string

`span(str, face)` is the string's width in tenths of an average lowercase letter, in one of four faces: the title, the text, the quote's serif, and a fact's value. Walk the string by code point and add each code point's tenths from the table. The last two rows count differently in each face, because those characters are as wide as the type is tall while the letter differs. Every other row counts the same in all four. The first row that holds the code point wins. A code point in no row counts 10. A code point that comes directly after U+200D counts 0, so a joined emoji counts once.

| Code points | Tenths | What they are |
|---|---|---|
| U+0300 to 036F, U+200B to 200F, U+2060 to 2064, U+FE00 to FE0F, U+1F3FB to 1F3FF, U+E0000 to E007F | 0 | Marks that join or change the character before them |
| U+0009 to 000D, U+0020, U+00A0, U+2000 to 200A, U+2028, U+2029, U+202F, U+205F | 5 | Spaces and line ends |
| `!` `'` `,` `.` `/` `:` `;` `\` `\|` `i` `j` `l`, U+2018, U+2019 | 5 | Thin punctuation and letters |
| `(` `)` `-` `[` `]` `{` `}` `f` `r` `t` | 7 | |
| `0` to `9`, `#` `$` `+` `<` `=` `>` `^` `~`, U+00A3, U+00D7, U+20AC | 11 | Digits and signs as wide as a digit |
| `%` `@` `M` `m` `w`, U+2014, U+2026 | 15 | |
| `W` | 17 | |
| `&`, `A` to `Z` other than `M` and `W` | 12 | Capitals |
| U+2190 to 2BFF | 22 | Arrows and symbols |
| U+1F1E6 to 1F1FF | 11 | Regional indicators. Two draw one flag. |
| U+1F000 to 1FAFF | 22 | Emoji |
| U+3040 to 30FF | title 18, text 18, quote 21, fact value 16 | Kana |
| U+2E80 to 10FFFF | title 17, text 18, quote 21, fact value 16 | Han, hangul, full-width forms, and everything above them |

One letter is `TITLE_LETTER = 93` tenths of a px in the title face, `TEXT_LETTER = 72` in the text face, and `QUOTE_LETTER = 78` in the quote face. A fact's value has a letter for each of its three sizes, given under fact, and all three use the fact value face. `span(str, face) * letter` is a width in hundredths of a px. Below, a `fold` with a letter of 93 counts in the title face, 72 in the text face and 78 in the quote face.

`fold(str, width, letter, max)` is how many lines a string is given in a column `width` px wide:

```
need = span(str, face) * letter
room = width * 100
fold = 1                                          when need <= room
fold = clamp(up(need, room - 20 * letter), 1, max)  otherwise
```

The `20 * letter` allows two letters a line for breaking between words. A string that needs more lines than `max` is drawn cut with an ellipsis.

### Constants

| Name | Value | Meaning |
|---|---|---|
| `DISPLAY` | 36 | Line height of a figure, in px |
| `TITLE` | 21 | Line height of a title |
| `TEXT` | 17 | Line height of text |
| `FRAME` | 30 | Top and bottom padding and border of a padded card, with 2 px to spare |
| `SIDES` | 33 | Left and right padding and border of a padded card, with 1 px to spare |

### Each type

`title` below is `item.title`, or `Untitled` when that is empty.

- **note.** Width 240. `titleLines = fold(title, 207, 93, 2)`. The body is `item.summary`, else `item.text`, and is left out when it is empty or equal to `item.title`. `bodyLines = fold(body, 207, 72, 2)` when `props.emphasis` is set and `fold(body, 207, 72, 3)` when it is not. Height is `30 + 21 * titleLines`, plus 23 when `props.emphasis` is set, plus `6 + 17 * bodyLines` when there is a body.
- **quote.** Width 288. The words are `props.text`, else `item.text`, else `item.title`. `lines = fold(words, 247, 78, 5)`. Height is `52 + 21 * lines`, plus 25 when `props.by` is set. When the words draw in fewer lines than they were given, the spare room sits between the words and the speaker.
- **fact.** The value is `props.value`, or `–` (U+2013) when that is empty. It is set in the first of three sizes that fits it on one line of 287 px. The sizes are a line height of 36 with a letter of 210 and a digit of 2148, 28 with 149 and 1506, and 21 with 105 and 1001. A digit is the drawn width of each of `0` to `9` in hundredths of a px, and replaces the 11 tenths the table gives it: `need = span(value, fact value) * letter - digits * (11 * letter - digit)`, where `digits` is how many of `0` to `9` the value holds. A size fits when `need <= 28700`. When none fits, it takes the last size and `valueLines = fold(value, 287, 105, 2)`, which counts in the fact value face and counts a digit as the table does. Otherwise `valueLines = 1`. `valueWidth` is 287 when `valueLines` is 2 and `up(need, 100)` at the size taken otherwise. `labelWidth = up(span(props.label, text) * 72, 100)`. Width is `clamp(33 + max(valueWidth, labelWidth), 200, 320)`. `labelLines = fold(props.label, width - 33, 72, 2)`, or 0 with no label. The foot is `item.title` when it is not empty and differs from the value and from the label. Height is `40 + valueLines * lineHeight + 17 * labelLines`, plus 25 when there is a foot. A value's letter is the widest any one character other than a digit runs, and digits are all one width, so a value is never cut before two lines at the smallest size.
- **image.** Width 240. The picture is `clamp(round(240 / aspect), 130, 260)` px tall, where `aspect` is `Number(props.aspect)`, or 1.35 when that is zero or not a number, the division is in IEEE doubles, and `round` is `floor(x + 0.5)`. The caption is `props.caption`, else `item.title` as written, so an empty title gives no caption and never `Untitled`. `captionLines = fold(caption, 207, 72, 2)`, or 0 with no caption. Height is the picture plus 2, plus `19 + 17 * captionLines` when there is a caption.
- **video.** Width 272. The poster is 153 px tall. The caption is as for image, with `captionLines = fold(caption, 239, 72, 2)`. Height is 155, plus `19 + 17 * captionLines` when there is a caption.
- **link.** Width is 316 when `props.image` is set and 272 when it is not. The text column is 187 px with a picture and 239 without. `titleLines = fold(title, column, 93, 2)`. The description is `props.description`, else `item.summary`. `aboutLines = fold(description, column, 72, 2)`, or 0 with none. `main = 21 * titleLines`, plus `4 + 17 * aboutLines` when there is a description. Height is `56 + main`, and at least 120 with a picture.
- **chart.** 300 by 195, or 300 by 212 when `props.unit` is set.
- **person.** 252 by 88.
- **chat.** Width 288. The first 3 messages are shown. Each bubble is `12 + 17 * fold(message.text, 199, 72, 2)` px tall. Height is 51, plus 2 when there is a message, plus 6 and the bubble's height for each bubble, plus 23 when `props.source` is set.
- **code.** Width 304. The lines are `props.source` split at each line feed. Height is `59 + 17 * clamp(lineCount, 1, 7)`.
- **steps.** Width 256. `rows` is the number of steps, at most 5. Height is 51, plus `10 + 20 * rows + 8 * (rows - 1)` when there is a step, plus 25 when there are more than 5 steps.

### Text cut to a width

Where the web client shortens a string itself, as it does for a chart's labels, it keeps whole characters (grapheme clusters) while `span(kept + '…') * letter <= room * 100` and adds the ellipsis. It never cuts inside an emoji or between a letter and its accent. The first letter on a link's address bar and a person's initials are whole characters too.

## Rules the Renderer follows

- Rules in plain code run first. Structured data in `item.data` outranks the item's kind.
- The model is asked only about plain text items of 40 characters or more that the rules left as a note. It may choose `quote`, `fact`, `steps`, `chart`, or leave the note.
- Every value the model returns must appear in the item's own title or text. A quote, a fact value, each step, each chart label and the chart unit are checked as substrings after whitespace, case and curly quotes are normalised. Each chart value must be a number written in the text. A claim that fails the check is dropped and the item stays a note.
- When the model fails, the rule-based result is returned and a line goes to the run log.

## Components

### note

The fallback. A title and a few lines of text.

- **Chosen when** nothing else fits.
- **Props.** `emphasis?`: one short phrase from the text to set apart. Only the model sets it.
- **Item holds.** `title`, and `text` or `summary`.

### quote

Someone's words, set large.

- **Chosen when** `item.data.quote` exists, or the model finds that a text item is mainly a quotation.
- **Props.** `text`: the words, without quote marks. `by?`: the speaker.
- **Item holds.** `data.quote = { text, by? }`, or the quotation inside `text`.

### fact

One number or short value with its label.

- **Chosen when** `item.data.facts` holds exactly one fact, or a text item is one short line that reads as a value with a label (`42% of users leave`, `Budget: $1.2M`), or the model finds that a text item is mainly one figure.
- **Props.** `value`: the figure as written, such as `42%`. `label`: what it measures.
- **Item holds.** `data.facts = [{ label, value }]`, or the figure inside `text`.

A leading number counts only when it carries a currency sign, a percent sign, or a magnitude such as `k` or `million`. `12 Angry Men` stays a note.

### image

- **Chosen when** the item's kind is `image` and a source exists.
- **Props.** `src`: the address to load. `caption?`: the item's summary when it is 140 characters or fewer. `aspect?`: not set today.
- **Item holds.** `source.asset`, or `data.mediaUrl` (Instagram picks), or `source.url`. They are tried in that order.

### video

- **Chosen when** the item's kind is `video` and a source exists.
- **Props.** `src`. `poster?`: from `data.thumbnailUrl`. `caption?`: as for image.
- **Item holds.** The same sources as image.

### link

A web page preview.

- **Chosen when** the item's kind is `link` and `source.url` exists.
- **Props.** `url`. `site`: from `data.site`, else the host name. `description?`: the item's summary. `image?`: from `data.image`.
- **Item holds.** `source.url`.

### chart

- **Chosen when** `item.data.chart` holds at least two labels and as many values, or the model finds several comparable numbers in a text item.
- **Props.** `chart`: `bar` or `line`. `labels`. `values`. `unit?`. `mark?`: index of a bar or point to call out, not set today.
- **Drawn as** bars or a line over gridlines, with a scale down the left side. Numbers on the scale and on the plot are written short, to three figures, such as `1.61M` and `0.004`. The marked bar or point is brighter and always carries its value. On a card every value is written when there are six or fewer and each fits above its own bar or point. With six bars or points or fewer, every label is written, cut to the width of one bar's step less 6 px. With more, when the labels do not fit side by side, every nth label is written, the marked, first and last ones before the rest, and a label longer than 44 px may be cut. The opened card writes every value that fits on the plot, and when the plot had to thin, cut or round anything it adds a table of every label with its full value. With no values the card says `No data`.
- **Item holds.** `data.chart = { labels, values, unit? }`, or the numbers inside `text`.

The chart is a `line` when every label is a year or a full date and they ascend. Otherwise it is a `bar`.

### person

- **Chosen when** `item.data.person` exists.
- **Props.** `name`. `role?`. `image?`: from `data.person.image`, else `data.image`.
- **Item holds.** `data.person = { name, role?, image? }`.

### chat

A short excerpt of a conversation.

- **Chosen when** the item's kind is `chat` and `data.messages` holds at least one message with text.
- **Props.** `messages`: at most 4 of `{ role, text }`, each cut to 280 characters, in conversation order. `source?`: where the chat came from, such as `claude`.
- **Drawn as** the title on its own line, the first 3 messages as bubbles of at most two lines, and the source below them. The opened card shows up to 40 messages in full and the source below them.
- **Item holds.** `data.messages = [{ role, text }]`.

The excerpt is the first user message, the longest assistant reply, and the user message just before that reply. System messages are left out.

### code

- **Chosen when** `item.data.code` holds a source, or the item's kind is `code`.
- **Props.** `language`: `text` when unknown. `source`.
- **Drawn as** at most 7 lines with a numbered gutter. The language is written beside the title unless it is `text`.
- **Item holds.** `data.code = { language?, source? }`, or the code as `text`.

### steps

An ordered list of short steps.

- **Chosen when** `item.data.steps` holds two or more steps, or the model finds an ordered procedure in a text item.
- **Props.** `steps`: the steps in order, without numbers or bullets.
- **Item holds.** `data.steps = string[]`, or the procedure inside `text`.

### Order of the rules

The first match wins: chart, steps, quote, person, code, fact, image or video, link, chat, note.

## Composites

A composite groups siblings under one parent. These rules hold for all of them.

- Kept nodes group only with kept nodes. Picks group only with picks. A composite never mixes the two.
- A node belongs to at most one group.
- A composite needs at least 3 members. A comparison needs 2 to 4.
- No group is the usual answer. Most siblings stay ungrouped.
- A group whose members are unchanged is left alone and keeps its id. When membership changes, the old group is removed and a new one with a new id is set in the same change set.
- When the user keeps one pick from a group of picks, the group no longer holds. The Renderer removes it on its next pass.

The model is asked about a parent only when changed siblings are among at least 4 ungrouped ones, or when a sibling's `why` hints at structure (words such as "alternative", "versus", "step 2").

### gallery

Pictures and clips side by side.

- **Chosen when** 3 or more siblings are drawn as `image` or `video`. Plain code.
- **Props.** `columns?`: not set today. The client lays out.
- **Drawn as** rows of equal columns. A column is as wide as the widest member's drawn width, rounded up to a whole px. A row is as tall as its tallest member's drawn height, rounded up. Each card sits at the top left of its cell, so cards of different widths share a left edge with the frame's label, and each cell starts on a whole px. A cluster and an opened stack are laid out the same way.
- **Members.** In sibling order.

### timeline

Members along a time axis.

- **Chosen when** 3 or more siblings' items carry `data.when` (plain code), or the model finds a date or period in each member's content.
- **Props.** `labels`: a map from member node id to its date or period, such as `1958`.
- **Members.** In time order.

A label the model gives must appear in that member's title, text, summary or `data.when`. A member whose label fails is left out.

### comparison

Members as columns, criteria as rows.

- **Chosen when** the model finds 2 to 4 alternatives worth weighing. Scout picks that answer one question are the common case.
- **Drawn as** the members side by side with one row per criterion below them. A row is as tall as its longest cell needs, one line or two. The frame ends 18 px under the last row, as it does under the cards of any other frame.
- **Props.** `criteria`: 2 to 4 row labels. `cells`: a map from member node id to one short string per criterion, in the order of `criteria`. An empty string means the member's content does not say.
- **Members.** The alternatives, at most 4.

Cells are worded by the model from each member's summary. A cell that holds a number absent from the member's content is blanked.

### sequence

Members in a meaningful order: steps, an argument, a walkthrough.

- **Chosen when** the model finds an order that means something.
- **Props.** None.
- **Members.** In that order. Draw them connected, first to last.

### cluster

Members that share a theme, drawn close together under a label.

- **Chosen when** the model finds 3 or more siblings that share a theme the others lack.
- **Props.** `theme`: a label of 1 to 3 words.
- **Members.** No particular order.

### stack

Many similar members, piled so only the top shows until opened.

- **Chosen when** more than 9 ungrouped siblings share one component. Plain code. The 6 most important stay out. The rest go in the stack.
- **Props.** None. `title` reads like `5 more`.
- **Members.** Most important first.

## Adding to a library

Add the schema to `COMPONENTS` or `COMPOSITES` in `src/core/views.ts`, add a rule or a model option in `renderer.ts`, add a test in `test/renderer.test.ts`, and add a section here. For the web client, add a module to `client/js/components/` or `client/js/composites/`, list it in that folder's `index.js`, and add a sample to `client/library.html`. `isValidView` and `isValidGroup` reject anything a schema does not describe, so the client can trust the props it receives.
