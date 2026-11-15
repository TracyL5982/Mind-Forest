# The component and composite libraries

This page is for the people who draw Mind Palace content in the headset. It lists every way one item can be drawn (a component) and every way several sibling nodes can be drawn together (a composite).

The schemas live in `src/core/views.ts`. The Renderer role in `src/core/roles/renderer.ts` chooses among them. A client never chooses. It draws what the node's `view` and the tree's groups say.

## How a view reaches the client

1. A node is created with the card the rules choose for its item (`view.by` is `default`), so it arrives at once in the look it keeps. The rules are the Renderer's `byRule`: a picture, a recording, a book, a chart or a list a source carried is drawn as such the moment the node exists.
2. When the rules cannot tell, because the item is the user's own text of some length that they drew as a note or an idea, the model is asked. The node is then created composing (`view.composing` is `true`), with the rules' note or idea as its component. A client that reads `composing` draws an in-progress card in its place; one that does not draws the note.
3. The pipeline hands the new or changed nodes to the Renderer. A composing node gets one `setView` within 12 s: the model's card, or the rules' card when the answer was refused, did not come or came late. It has `view.by` set to `renderer` and no `composing`, and it is final: a card never turns into another after it lands, unless its item is edited. An edited card the model is asked about again composes first.
4. The Renderer returns `setGroup` or `removeGroup` for composites, and the client swaps the view in place.

An idea the Scout writes lands as it is written: the model is not asked about it.

A view is `{ component, props, by, composing? }`. Props carry only what the item does not already hold. Draw from the item plus the props. The title always comes from `item.title`.

A group is `{ id, treeId, anchor, composite, title, members, props }`. `anchor` is the parent node. `members` are node ids, in drawing order. `title` may be empty.

## How the web client draws them

`client/library.html` draws every component and composite from sample data with the live client's code. Open it to see the current look. Under each sample it states the type name and the footprint.

- Each component is one module, `client/js/components/<type>.js`, that exports `size`, `draw` and `detail`. `detail` draws the type's part of the opened card, and for the types that count rows it draws every row the card left out. The opened card says what else it prints. Each composite is one module in `client/js/composites/`. The `index.js` in each folder is the registry.
- `size(item, props)` is the card's footprint in px: 210 wide and at most 146 tall for every type. It is worked out from the content and never measured, so the field can be laid out before anything is drawn. The next section gives the rule. A card's sources (its date, place, people and origin) are listed on the opened card and never on the small face, so they add nothing to a footprint.
- A small face is set in four sizes, named in `client/style.css`: a figure (`--type-display`, 34 px on 36, and `--type-display-2`, 24 px on 28), a title (`--type-title`, 18 px on 24), body text (`--type-body`, 16 px on 22) and a meta line (`--type-meta`, 13.5 px on 18). These are comfortably read on the headset at 1.5 m, where a face px is a mm. Body and meta lines are white at 0.82 (`--face-ink`) and weight 500 or more. A quotation, a passage and a meaning are an upright serif at the body size. Nothing on a face is italic, and nothing read is under 13.5 px but the map's credit. A figure too long for its face steps down to the middle size, then to the title size. A fact's value, a row of facts, an idea, a term and a place name are figures. The arrangements' words and the field around the cards keep `--type-text`, 12.5 px on 17.
- Each type has its own face, so types can be told apart when zoomed out. A note is plain. A quote is a serif on a face washed with the tree's colour. A fact is one large figure on a darker face. A picture or clip has tight corners and its caption on a plate below. A recording has a round play mark beside its waveform and its length, over the first words of its transcript. A link sits under an address bar. A chart is the shape of its values over a count of its points, and opens to gridlines and a scale. A person has a round face beside the name. A chat is speech bubbles. Code says how many lines it has in what language, and opens to its source in a fixed-width face. Steps are numbers down a rail. Facts are figures two to a row on a fact's darker face. A table names its heads and counts its rows, and opens to ruled rows with numbers set to the right. A list has a dot or a tick box before each entry. A breakdown is one bar split into its parts, and opens to level bars with a share at the end of each. A question and its answer carry a `Q` and an `A`. A callout has a band down its left edge. An excerpt is an upright serif beside a rule. A definition is a large headword over a short rule. An idea is large words under a spark. Pros and cons are a row for each side, under the heading its item gives it. A swatch has a band of its colours across the top. An artwork sits whole on a mat a shade lighter than its card, over a label. A reference has its kind and year over a rule. A place has a round pin beside a large name, over a small map when its item knows where it is. A sheet is one card under one title, whose first part is drawn as the card of its kind previews it, and whose opened card has every part.
- A card's marks take its tree's colour. While the card is a pick they are amber, its border is dashed and its face is darker. A pick's face is never see-through.
- Amber is also the three dots on a card the agents are working on. Teal is the links between cards, and the ring on the card that a dragged card would land under. No card type uses either for anything else. A caution callout is coral, and a remark is grey.
- Every card has corners of 12 px, and 4 px when it leads with a picture: an image, a video, an artwork.
- A card shows its whole item and nothing its item does not say. The item's own headings, labels and opening prose that stand over a card's structure are drawn over it, as dark and as large as the structure, so `Don'ts:` reads before the list under it. The heads row of a table that figures or bars come from is drawn over them. A mark the item writes, such as `✓`, `✗`, `▲`, `▼`, `>` or a speaker's `A:`, is drawn on its line as written, and a list draws a tick box only when the view gives it `checked`. See Lines over a structure.
- No colour is the only sign of anything. A tick box is filled and ticked, the two sides of pros and cons are named in their item's own words, and a callout names its tone in words.
- A small label in capitals names what the look alone cannot: a group frame's kind, a code card's language when it is known, and where a chat came from. A clip and a recording are named by their play marks and a chat by its bubbles, so none of them carries a label for its type.
- A group frame is a faint wash and a hairline.
- The field draws a pick at 0.86 of its footprint and the first card of a tree at 1.12. Every other card is drawn at 1. A selected card keeps its scale. Selecting adds a ring outside the card and changes no size.
- A card's drawn size is its footprint times its scale, kept as a fraction: a 210 by 54 pick is 180.6 by 46.44. Layout works on drawn sizes and card centres in IEEE doubles and rounds nothing on the way, so equal footprints give equal positions. The web client rounds once, when it writes a card's top-left corner to the page, to one decimal place of a px. The one exception is inside a gallery, a cluster and an opened stack, where the cell sizes are rounded up as that section says.

## How a card's footprint is worked out

A second client must give every card the same footprint as the web client, because the field is laid out from footprints alone. This section is the whole rule. `test/footprints.json` holds sample cards with the footprint each must get, as the web client counts them. `npm test` checks the web client against it, and a second client should run the same file through its own code.

The Quest client counts lines with the host's own font layout, not with the width tables below. It does not need the three faces the web measured to keep inside 146 px, because the box, the line heights, the rows and their order are the same in both clients. `footprints.json` is the web's count, and the Quest's own count of the same sample may differ by a line where the two fonts break a line differently.

All arithmetic is in whole numbers. `up(a, b)` is `a / b` rounded up. `clamp(v, lo, hi)` holds `v` between `lo` and `hi`. A prop that is not a string counts as an empty string. A prop "is set" when it is a string that is not empty, so a string of spaces is set. A card whose component is unknown is sized as a note with no props. `textWidth(str)` is `up(span(str) * 72, 100)`, the px a string is given at the text size.

### The face

Every small face is `WIDTH = 210` px wide and at most `HEIGHT = 146` px tall. That is the box the ring of cards round an opened card holds on the headset without overlap, at one face px to one mm at 1.5 m, and the Quest client draws the same face. A picture-led face could be narrower, but none is.

A face is an ordered list of rows, top to bottom, which `lay(rows, { words, cue, more, frame })` in `client/js/components/shared.js` sets out. `size` is `[210, lay(...).height]`, and `draw` draws the same rows, so the two cannot disagree. A row is one of two shapes:

- A row of words: `{ words, measure, column, most, gap, pad, unit, keep }`. It stands on whole lines, `fit(words, column, measure, most)` of them: all its lines when they number `most` or fewer, else its first `most` lines, which is the string up to where its last whole line ends, counted by `wrap` below. Its height is its lines times the measure's line height, and `pad` more for a box drawn round the words, as a chat's bubble is.
- A row of `tall` px, which is whole. It may say `whole: false` when it left something out inside itself, as a person's name cut to two lines does.

Each row has `gap` px above it. `frame` is the px of padding and border above and below the rows, `FRAME` for a padded face. Then:

```
need = frame + the sum of gap + height over the rows
need <= 146, more is false and no row left anything out:  every row shows, and there is no cue
otherwise:  room = 146 - frame - CUE - the gap + height of every keep row
            for each row in order:
              a keep row shows
              after a row that did not fit, the row is left out
              a row whose gap + height fits room shows, and room drops by it
              a row of words that is no unit and does not fit shows the whole lines that fit in room - gap - pad, if any
              any other row that does not fit is left out
            height = frame + the gap + height of every row shown + CUE
```

So a face always shows the start of the card, in order, and a later row never stands in for an earlier one. A `unit`, one of what the cue counts, such as a list's entry, is whole or left out. A `keep` row, such as a quote's speaker, is shown whatever is left out above it.

**The cue** is the last row, `CUE = 18` px, in meta and the card's accent colour, at the start of the row. It says what is left out: `cue(units)` given how many units were left out, as `3 more`, `12 rows` or `2 parts`, or the fixed word `More` when it gives nothing, as when words were cut. The words are under Fixed words. `more` says the item holds something no row shows, such as the facts past the ones a view gives, so the face ends with the cue though every row fits.

**Whole lines only.** A face draws exactly the words `fit` gives each row and sets each row at the height it counted. Nothing is clamped or clipped, and no line is cut. The one ellipsis on a face is a title's, below.

**A title on the face.** A title, or a name that stands for one, takes at most `TITLE_LINES = 2` lines at the title's size. One that needs more shows its first two lines cut where a word ends, at a hyphen that joins two words, or after any character of a script written without spaces, without the marks that joined it to the rest, and ends with an ellipsis, `…`. The ellipsis says what is left out, so the cut brings no cue, and the rest of the face follows as it would. `fit(str, column, measure, most, ellipsis)` gives it. The opened card shows the whole title.

**Two titles of an item.** `item.title` is the item's whole title. A title the model writes, for Intake's items, a chat's takeaways, the Scout's directions and the Renderer's groups, is held to the face's two lines when it is made, by `fittedTitle` in `src/core/fitted.ts`: its first whole clause that fits and says something, else its first whole words, or characters where a script has no spaces, with no ellipsis. The prompts ask for about 26 characters in English or 18 in Chinese. A title from a source, a paper's, a work's, a film's, a page's, a file's name, or one a person wrote, is never rewritten. `item.data.shortTitle` holds what a small face shows of it, `fittedTitle(title)`, and is there only when the whole title does not fit two lines. `makeItem` sets it for every item, and an `editItem` that changes the title sets it again or takes it away. A face shows `item.data.shortTitle` when it is there, else `item.title`, cut as above. The opened card and search use `item.title`. The spec's 12 px fade above the cue is not drawn: under whole lines it could only lie over letters, and over the bare face it shows nothing. The Quest client leaves it out for the same reason. `scripts/faces.ts` draws every sample in `test/footprints.json` in a real browser and prints any face that breaks this rule, and the browser test runs the same check.

### The width of a string

`span(str, face)` is the string's width in tenths of an average lowercase letter, in one of four faces: the title, the text, the quote's serif, and a fact's value. Walk the string by code point and add each code point's tenths from the table, in the column of the face. The first row that holds the code point wins. A code point in no row counts 46 in the title face, 47 in the text face, 55 in the quote face and 43 in a fact value: an unknown character is given the room of the widest one measured, so it is never cut.

Two code points count by what comes before them:

- A code point that comes directly after U+200D counts 0, so a joined emoji counts once.
- U+FE0F draws the character before it as an emoji. It counts the emoji row's count for the face, less the count of the last code point before it that counted more than 0. When that leaves less than 0 it counts 0, and when no code point before it counted more than 0 it counts the whole emoji row's count. So `©` followed by U+FE0F counts as one emoji, a heart followed by U+FE0F counts no more than the heart, and a person joined to a sign that ends in U+FE0F still counts once.

| Code points | Title | Text | Quote | Fact value | What they are |
|---|---|---|---|---|---|
| U+0300 to 036F, U+0483 to 0489, U+0591 to 05BD, U+064B to 065F, U+0670, U+0900 to 0902, U+0941 to 0948, U+094D, U+0E31, U+0E34 to 0E3A, U+0E47 to 0E4D, U+200B to 200F, U+202A to 202E, U+2060 to 206F, U+FE00 to FE0F, U+1F3FB to 1F3FF, U+E0000 to E007F | 0 | 0 | 0 | 0 | Marks that join or change the character before them |
| U+0009 to 000D, U+0020, `!` `'` `,` `.` `/` `:` `;` `\` `\|` `i` `j` `l`, U+00A0, U+2028, U+2029, U+202F, U+205F | 5 | 5 | 5 | 5 | Spaces, line ends, thin punctuation and letters |
| `(` `)` `-` `[` `]` `{` `}` `f` `r` `t` | 7 | 7 | 7 | 7 | |
| `0` to `9`, `#` `$` `+` `<` `=` `>` `^` `~` | 11 | 11 | 11 | 11 | Digits and signs as wide as a digit |
| `%` `@` `M` `m` `w` | 15 | 15 | 15 | 15 | |
| `W` | 17 | 17 | 17 | 17 | |
| `&`, `A` to `Z` | 12 | 12 | 12 | 12 | Capitals |
| U+0020 to 007E | 10 | 10 | 10 | 10 | The other small letters and signs of English |
| U+00B7, U+2004 to 2006, U+2008 to 200A, U+2018 to 201B, U+2024, U+2027, U+2032, U+2035, U+2044 | 6 | 6 | 7 | 6 | Thin spaces, single quotes, the middle dot and primes |
| U+00A1, U+00A8, U+00AA, U+00AD, U+00AF to 00B0, U+00B2 to 00B4, U+00B8 to 00BA, U+00BF, U+00DF to 00E5, U+00E7 to 00F6, U+00F8 to 00FF, U+2000, U+2002, U+2010 to 2011, U+2016, U+201C to 201F, U+2020 to 2023, U+2033, U+2039 to 203A, U+2070 to 209F, U+FF61 to FFDC | 12 | 11 | 13 | 10 | Accented small letters, the degree sign, raised and lowered figures, double quotes, daggers, bullets, half-width kana and hangul |
| U+00A2 to 00A7, U+00AB to 00AC, U+00AE, U+00B1, U+00B5 to 00B6, U+00BB, U+00D7, U+00F7, U+2007, U+2012 to 2013, U+20A0 to 20A7, U+20AB to 20AE, U+20B1 to 20B6, U+20B8 to 20BA, U+20BC to 20BD, U+20BF, U+2212, U+221A, U+2248, U+2260, U+2264 to 2265 | 13 | 12 | 19 | 11 | Currency signs such as `£` `¥` `€`, the en dash, and the signs of arithmetic |
| U+00C0 to 00C5, U+00C7 to 00D6, U+00D8 to 00DE, U+0100 to 0151, U+0154 to 0173, U+0175 to 017F, U+01CD to 01DC, U+03AC to 03CE, U+0430 to 045F | 16 | 15 | 17 | 14 | Accented capitals, the rest of European Latin, the tone letters of pinyin, small Greek and small Cyrillic |
| U+00A9, U+00BC to 00BE, U+00C6, U+00E6, U+0152 to 0153, U+0174, U+0370 to 03AB, U+0410 to 042F, U+0530 to 058F, U+05BE to 05FF, U+0900 to 097F, U+1E00 to 1EFF, U+2001, U+2003, U+2014 to 2015, U+2025 to 2026, U+20A9 to 20AA, U+2122, U+2126 | 19 | 20 | 21 | 18 | The em dash, the ellipsis, fractions, `™`, `₩`, joined letters, Greek and Cyrillic capitals, Armenian, Hebrew, Devanagari and Vietnamese |
| U+03CF to 03FF, U+2190 to 22FF | 20 | 21 | 24 | 19 | Arrows and the signs of mathematics |
| U+0600 to 06FF, U+0E00 to 0E5A, U+2300 to 27BF, U+F900 to FAFF, U+1F000 to 1F6FF, U+1F900 to 1FAFF | 22 | 23 | 26 | 21 | Emoji, symbols, Arabic, Thai and the second forms of Han. This is the emoji row. |
| U+0180 to 02FF, U+0400 to 052F, U+0700 to 077F, U+0E5B to 0E7F, U+10A0 to 10FF, U+1F00 to 1FFF, U+2030 to 205E, U+20A0 to 218F, U+27C0 to 2BFF, U+302E to 302F, U+FB00 to FB4F, U+FE70 to FEFF | 28 | 28 | 34 | 27 | Signs that stand for a word or a unit, such as `‰` `℃` `№`, Roman numerals, and other alphabets |
| U+3040 to 30FF | 18 | 18 | 21 | 16 | Kana |
| U+3400 to 9FFF | 17 | 18 | 21 | 16 | Han |
| U+AC00 to D7AF | 15 | 15 | 21 | 14 | Hangul |
| U+2E80 to 33FF, U+FE10 to FE6F, U+FF00 to FF60, U+FFE0 to FFEF | 18 | 18 | 21 | 17 | The punctuation and symbols set with Han, and full-width forms |
| U+FB50 to FDFF | 62 | 56 | 134 | 58 | Arabic words and phrases drawn as one character |

The rows for English, from `!` to the row of U+0020 to 007E, are weights: a letter may draw a little wider than its count, and the letter widths below are set so that words and sentences still fit. Every count in the other rows is the widest any character of the row draws in that face in the web client, rounded up to a whole tenth, so a string is never given less room than it takes. A client that draws with other fonts keeps these counts for its footprints, and must make sure its own text fits them.

One letter is `TITLE_LETTER = 93` tenths of a px in the title face, `TEXT_LETTER = 72` in the text face, and `QUOTE_LETTER = 78` in the quote face. A fact's value has a letter for each of its three sizes, given under fact, and all three use the fact value face. `span(str, face) * letter` is a width in hundredths of a px. Below, a `fold` with a letter of 93 counts in the title face, 72 in the text face and 78 in the quote face.

`fold(str, width, letter, max)` is how many lines a string is given in a column `width` px wide:

```
need = span(str, face) * letter
room = width * 100
fold = 1                                            when need <= room
fold = clamp(packed(str), 1, max)                   when str can break anywhere
fold = clamp(up(need, room - 20 * letter), 1, max)  otherwise
```

A string can break anywhere when every one of its code points is a kana letter, a Han character or a hangul syllable: U+3041 to 3096, U+30A1 to 30FA, U+30FC, U+3400 to 9FFF, or U+AC00 to D7AF. A line may end after any of these, so each line holds every character that fits. `packed(str)` counts those lines. Start with one line that holds nothing. For each code point in order, take its width, `span` of that code point alone times `letter`. When the line already holds something and its width plus this one is more than `room`, start a new line that holds nothing. Then add the width to the line. `packed` is the number of lines at the end. Thirty Han characters in a quote are 1638 each in a room of 24700, so fifteen fit a line and the quote is given two lines.

For any other string, the `20 * letter` allows two letters a line for breaking between words. Punctuation, spaces, digits and Latin letters all make a string one of these, because a line may not start with a comma or split a word.

No small face uses `fold`. It counts the words an arrangement sets beside its cards, which are clamped to `max` lines, as a comparison's cells are.

### Lines counted word by word

Every small face counts its lines with `wrap`, through `fit` and `linesOf`. `wrap` lays the words out one by one, each as wide as the web client draws it, so it ends a line where the page does.

`wrap` counts in nine faces, each named by its letter: the title at 16 px (93), the text at 12.5 px (72), the passage (92), a figure's largest (210), middle (149) and smallest (119) sizes, and the three faces a small face draws its words in: the title at 18 px (`TITLE_FACE = 104`), body text at 16 px in medium (`BODY_FACE = 94`) and a meta line at 13.5 px in medium (`META_FACE = 80`). The passage is the quote's serif set upright, as a quotation, an excerpt's passage and a definition's meaning are, and `PASSAGE_LETTER = 92`. With any other letter, `advance(str, letter)` below is `span(str, face) * letter`.

A face counts each kind of line in the face it is drawn in, `MEASURES` in `shared.js`:

| Measure | Counts in | Line height | For |
|---|---|---|---|
| `title` | 104 | 24 | A title, a question, a callout's words, a term or a name that steps down to the title's size |
| `head` | 93 | 22 | A heading over a structure, set in the title's weight at the body size, and a side of pros and cons |
| `body` | 94 | 22 | Body text, entries, steps, messages, captions, an answer |
| `meta` | 80 | 18 | A meta line: a speaker, a source, a count, a table's heads, a first author |
| `passage` | 92 | 22 | A quotation, a passage, a meaning |
| `display`, `middle`, `figure` | 210, 149, 119 | 36, 28, 24 | A figure at 34, 24 and 18 px |

`linesOf(str, column, measure)` is `wrap(str, column, letter, infinity)` in the measure's face. `scripts/advances.ts` measured the three new faces in Chromium with the client's font stack, the same way the 16 px title face was measured. They are measured because the faces cannot be counted in each other: a 13.5 px meta line in medium draws about 1% wider than the 16 px title face scaled to 13.5 px, so counting it so could put a line on a row too few, and the title at 18 px draws about 2% narrower than that face scaled up, which left blank lines under titles. The smallest figure's widths are its 16 px widths scaled by 18 / 16 and rounded up.

`advance(str, letter)` is a string's width on one line in hundredths of a px. Walk the string by code point:

- A code point from U+0020 to U+007E counts what the table below gives it in the face.
- A code point set with Han counts the face's square: 1591 in the title, 1250 in the text, 1600 in the passage, 3332, 2352 and 1764 in a figure's largest, middle and smallest sizes, and 1790, 1600 and 1350 in the title at 18 px, the body and a meta line. Each is the size the face is set in, less its letter spacing, rounded up. These are U+3000 to 30FF, U+3400 to 9FFF, U+FF01 to FF60 and U+FFE0 to FFE6.
- Take every other code point out, in order, as one string `others`. It counts `span(others, face) * letter`, where the face is the title's for the title, the three faces a small face draws in, the text's for the text, the quote's for the passage, and a fact value's for a figure. So the two rules about U+200D and U+FE0F run over `others` alone.

`advance` is the sum of the three.

`wrap(str, width, letter, max)`:

```
room = width * 100
space = advance(' ', letter)
```

Split the string at each run of white space, as JavaScript's `\s` reads it, and drop the empty pieces. Each piece is a word. Split a word into units: walk its code points, and end a unit after a code point when it is the last of the word, or when the word parts after it. With `ch` the code point, `next` the one after it and `before` the one before it in the word, a word parts after `ch` in four cases:

1. `ch` can end a line, by the list under `fold`, or is one of `、` `。` `，` `；` `：` `？` `！` `）` `》` (U+3001, 3002, FF0C, FF1B, FF1A, FF1F, FF01, FF09, 300B), and `next` can end a line or is `（` or `《` (U+FF08, 300A).
2. `ch` can end a line and `next` is one of `0` to `9`, `A` to `Z`, `a` to `z`.
3. `ch` is one of `0` to `9`, `A` to `Z`, `a` to `z` and `next` can end a line.
4. `ch` is `-` (U+002D), and `before` and `next` are each one of `A` to `Z`, `a` to `z`. A hyphen that starts a word has no `before` and parts nothing.

So `记忆宫殿` is four units, `state-of-the-art` is four, `AI记忆` is three, and `re-entry` is two.

Start with `lines = 1` and `used = 0`. To place something `wide` after a `gap`: when `used > 0` and `used + gap + wide > room`, add 1 to `lines` and set `used` to 0. Then add `wide` to `used`, and `gap` too when `used` was more than 0 before this addition. So `used` is read twice, each time as it stands before `wide` is added, and a gap is never counted at the start of a line.

Place each unit in order. Its width is `advance(unit, letter)`. Its gap is `space` when it is the first unit of its word and 0 otherwise. A unit no wider than `room` is placed whole. A wider unit is placed one code point at a time, each `advance` of that code point alone, however wide it is, the first with a gap of `room`, which starts a new line whenever the line holds anything, and the rest with a gap of 0. `wrap` is `clamp(lines, 1, max)`.

A page may also break in a few places `wrap` does not, such as after a slash, so `wrap` counts at least the lines a page draws. The web client sets the structured types and the lines over a structure with kerning off (`font-kerning: none`), so a word is exactly as wide as its characters add up to, and each width in the table is what the character draws in the web client, rounded up, and 2 more, or 3 more for the three faces `scripts/advances.ts` measured, whose way of measuring gives the 16 px title face up to 0.01 px less than this table holds for it. A figure set at 24 px or more, in a facts card, a sheet, an explorable, an idea, a definition's headword and a place's name, is kerned (`font-kerning: normal`), because pairs such as `Ta`, `Wa` and `Av` gape at that size without it. The table still counts its characters unkerned, and kerning only ever draws a line narrower than that: in the web client no pair of the characters U+0020 to U+007E and none of 6,000 random strings drew wider kerned than unkerned at 34 or 24 px. So the count stays at least the lines a page draws. Measured against the web client on 5,600 strings in each of the title and the text faces, in English and in Chinese, `wrap` never counted fewer lines than were drawn, and counted one more for 1 to 4 strings in a hundred. A client that draws with other fonts keeps these widths for its footprints, and must make sure its own text fits them.

| Character | Code point | Title | Text | Passage | Largest figure | Middle figure | Smallest figure | Title at 18 px | Body | Meta |
|---|---|---|---|---|---|---|---|---|---|---|
| space | U+0020 | 384 | 350 | 447 | 649 | 467 | 403 | 419 | 410 | 363 |
| `!` | U+0021 | 512 | 388 | 542 | 1021 | 719 | 560 | 566 | 494 | 433 |
| `"` | U+0022 | 833 | 596 | 532 | 1493 | 1081 | 929 | 922 | 785 | 678 |
| `#` | U+0023 | 1018 | 786 | 892 | 2125 | 1494 | 1128 | 1135 | 1002 | 861 |
| `$` | U+0024 | 1018 | 786 | 892 | 2150 | 1508 | 1128 | 1136 | 1002 | 861 |
| `%` | U+0025 | 1572 | 1155 | 1410 | 2953 | 2126 | 1763 | 1749 | 1511 | 1291 |
| `&` | U+0026 | 1139 | 888 | 1332 | 2341 | 1651 | 1262 | 1271 | 1128 | 969 |
| `'` | U+0027 | 496 | 370 | 274 | 883 | 634 | 543 | 546 | 475 | 418 |
| `(` | U+0028 | 627 | 476 | 673 | 1239 | 876 | 690 | 694 | 608 | 530 |
| `)` | U+0029 | 627 | 476 | 673 | 1239 | 876 | 690 | 694 | 608 | 530 |
| `*` | U+002A | 731 | 588 | 729 | 1473 | 1038 | 800 | 811 | 735 | 636 |
| `+` | U+002B | 1018 | 786 | 1335 | 2150 | 1508 | 1128 | 1136 | 1002 | 861 |
| `,` | U+002C | 496 | 370 | 447 | 777 | 573 | 543 | 543 | 475 | 418 |
| `-` | U+002D | 731 | 588 | 563 | 1466 | 1034 | 800 | 811 | 735 | 636 |
| `.` | U+002E | 496 | 370 | 447 | 777 | 573 | 543 | 543 | 475 | 418 |
| `/` | U+002F | 484 | 380 | 740 | 990 | 692 | 526 | 535 | 475 | 418 |
| `0` | U+0030 | 1034 | 786 | 892 | 2150 | 1508 | 1128 | 1153 | 1010 | 868 |
| `1` | U+0031 | 760 | 579 | 892 | 2150 | 1508 | 1128 | 846 | 741 | 641 |
| `2` | U+0032 | 973 | 753 | 892 | 2150 | 1508 | 1128 | 1085 | 960 | 825 |
| `3` | U+0033 | 1014 | 782 | 892 | 2150 | 1508 | 1128 | 1130 | 999 | 858 |
| `4` | U+0034 | 1042 | 803 | 892 | 2150 | 1508 | 1128 | 1163 | 1025 | 882 |
| `5` | U+0035 | 1004 | 771 | 892 | 2150 | 1508 | 1128 | 1119 | 986 | 847 |
| `6` | U+0036 | 1035 | 795 | 892 | 2150 | 1508 | 1128 | 1155 | 1016 | 874 |
| `7` | U+0037 | 914 | 710 | 892 | 2150 | 1508 | 1128 | 1018 | 902 | 777 |
| `8` | U+0038 | 1048 | 797 | 892 | 2150 | 1508 | 1128 | 1169 | 1024 | 880 |
| `9` | U+0039 | 1035 | 795 | 892 | 2150 | 1508 | 1128 | 1155 | 1016 | 874 |
| `:` | U+003A | 496 | 370 | 447 | 777 | 573 | 543 | 543 | 475 | 418 |
| `;` | U+003B | 496 | 370 | 447 | 777 | 573 | 543 | 543 | 475 | 418 |
| `<` | U+003C | 1018 | 786 | 1335 | 2150 | 1508 | 1128 | 1136 | 1002 | 861 |
| `=` | U+003D | 1018 | 786 | 1335 | 2150 | 1508 | 1128 | 1136 | 1002 | 861 |
| `>` | U+003E | 1018 | 786 | 1335 | 2150 | 1508 | 1128 | 1136 | 1002 | 861 |
| `?` | U+003F | 834 | 640 | 755 | 1763 | 1235 | 922 | 930 | 816 | 705 |
| `@` | U+0040 | 1441 | 1146 | 1602 | 2983 | 2104 | 1598 | 1611 | 1446 | 1236 |
| `A` | U+0041 | 1109 | 841 | 1158 | 2294 | 1617 | 1232 | 1236 | 1082 | 928 |
| `B` | U+0042 | 1055 | 820 | 998 | 2128 | 1506 | 1169 | 1175 | 1044 | 897 |
| `C` | U+0043 | 1137 | 894 | 1134 | 2381 | 1672 | 1258 | 1269 | 1132 | 971 |
| `D` | U+0044 | 1148 | 907 | 1252 | 2341 | 1654 | 1271 | 1282 | 1146 | 983 |
| `E` | U+0045 | 945 | 743 | 1017 | 1909 | 1349 | 1043 | 1052 | 939 | 810 |
| `F` | U+0046 | 907 | 714 | 938 | 1826 | 1290 | 999 | 1008 | 902 | 777 |
| `G` | U+0047 | 1173 | 932 | 1190 | 2434 | 1712 | 1296 | 1308 | 1174 | 1007 |
| `H` | U+0048 | 1198 | 927 | 1273 | 2437 | 1723 | 1329 | 1336 | 1182 | 1013 |
| `I` | U+0049 | 449 | 333 | 546 | 850 | 604 | 490 | 494 | 428 | 377 |
| `J` | U+004A | 897 | 671 | 534 | 1835 | 1294 | 996 | 999 | 868 | 747 |
| `K` | U+004B | 1075 | 822 | 1111 | 2165 | 1533 | 1193 | 1197 | 1053 | 905 |
| `L` | U+004C | 901 | 709 | 917 | 1810 | 1279 | 995 | 1003 | 896 | 772 |
| `M` | U+004D | 1398 | 1091 | 1459 | 2884 | 2036 | 1554 | 1563 | 1388 | 1188 |
| `N` | U+004E | 1180 | 927 | 1295 | 2394 | 1692 | 1307 | 1316 | 1174 | 1007 |
| `O` | U+004F | 1213 | 963 | 1285 | 2520 | 1774 | 1343 | 1355 | 1214 | 1041 |
| `P` | U+0050 | 1023 | 793 | 945 | 2050 | 1452 | 1132 | 1139 | 1010 | 868 |
| `Q` | U+0051 | 1213 | 963 | 1285 | 2519 | 1774 | 1343 | 1355 | 1214 | 1041 |
| `R` | U+0052 | 1055 | 815 | 1127 | 2127 | 1505 | 1169 | 1175 | 1039 | 894 |
| `S` | U+0053 | 1026 | 795 | 868 | 2099 | 1480 | 1137 | 1143 | 1013 | 871 |
| `T` | U+0054 | 1007 | 791 | 1012 | 2007 | 1422 | 1112 | 1121 | 1000 | 861 |
| `U` | U+0055 | 1168 | 920 | 1262 | 2372 | 1677 | 1293 | 1303 | 1164 | 999 |
| `V` | U+0056 | 1095 | 841 | 1149 | 2253 | 1589 | 1217 | 1221 | 1075 | 924 |
| `W` | U+0057 | 1559 | 1209 | 1662 | 3232 | 2281 | 1736 | 1743 | 1543 | 1318 |
| `X` | U+0058 | 1107 | 847 | 1140 | 2274 | 1606 | 1230 | 1235 | 1086 | 932 |
| `Y` | U+0059 | 1072 | 818 | 1057 | 2205 | 1555 | 1191 | 1196 | 1049 | 902 |
| `Z` | U+005A | 1037 | 826 | 1070 | 2110 | 1490 | 1145 | 1155 | 1039 | 893 |
| `[` | U+005B | 627 | 476 | 673 | 1239 | 876 | 690 | 694 | 608 | 530 |
| `\` | U+005C | 484 | 380 | 740 | 990 | 692 | 526 | 535 | 475 | 418 |
| `]` | U+005D | 627 | 476 | 673 | 1239 | 876 | 690 | 694 | 608 | 530 |
| `^` | U+005E | 1018 | 786 | 1602 | 2150 | 1508 | 1128 | 1136 | 1002 | 861 |
| `_` | U+005F | 947 | 728 | 802 | 1904 | 1347 | 1048 | 1053 | 930 | 800 |
| `` ` `` | U+0060 | 762 | 624 | 802 | 1674 | 1162 | 832 | 849 | 772 | 668 |
| `a` | U+0061 | 889 | 688 | 772 | 1808 | 1275 | 983 | 989 | 875 | 755 |
| `b` | U+0062 | 988 | 767 | 892 | 1977 | 1401 | 1093 | 1100 | 975 | 839 |
| `c` | U+0063 | 890 | 698 | 717 | 1801 | 1270 | 981 | 989 | 883 | 761 |
| `d` | U+0064 | 988 | 767 | 902 | 1974 | 1398 | 1093 | 1099 | 975 | 839 |
| `e` | U+0065 | 910 | 713 | 783 | 1836 | 1297 | 1004 | 1013 | 902 | 777 |
| `f` | U+0066 | 594 | 451 | 501 | 1154 | 818 | 653 | 657 | 577 | 502 |
| `g` | U+0067 | 979 | 760 | 828 | 1964 | 1390 | 1083 | 1089 | 968 | 832 |
| `h` | U+0068 | 955 | 734 | 940 | 1934 | 1367 | 1057 | 1063 | 938 | 807 |
| `i` | U+0069 | 404 | 308 | 477 | 772 | 545 | 437 | 444 | 389 | 344 |
| `j` | U+006A | 404 | 307 | 441 | 770 | 544 | 437 | 443 | 389 | 344 |
| `k` | U+006B | 899 | 677 | 876 | 1773 | 1259 | 997 | 999 | 872 | 752 |
| `l` | U+006C | 416 | 315 | 470 | 775 | 550 | 450 | 455 | 400 | 353 |
| `m` | U+006D | 1426 | 1086 | 1410 | 2875 | 2039 | 1591 | 1593 | 1397 | 1196 |
| `n` | U+006E | 947 | 728 | 937 | 1904 | 1347 | 1048 | 1053 | 930 | 800 |
| `o` | U+006F | 941 | 737 | 884 | 1898 | 1341 | 1039 | 1047 | 933 | 803 |
| `p` | U+0070 | 981 | 762 | 899 | 1966 | 1391 | 1086 | 1093 | 969 | 833 |
| `q` | U+0071 | 981 | 760 | 895 | 1964 | 1390 | 1086 | 1093 | 968 | 833 |
| `r` | U+0072 | 634 | 475 | 627 | 1179 | 844 | 699 | 700 | 611 | 532 |
| `s` | U+0073 | 850 | 653 | 711 | 1695 | 1200 | 939 | 944 | 833 | 719 |
| `t` | U+0074 | 601 | 453 | 578 | 1151 | 818 | 660 | 664 | 580 | 507 |
| `u` | U+0075 | 947 | 728 | 943 | 1904 | 1347 | 1048 | 1053 | 930 | 800 |
| `v` | U+0076 | 876 | 676 | 788 | 1743 | 1235 | 969 | 974 | 861 | 743 |
| `w` | U+0077 | 1286 | 967 | 1242 | 2618 | 1853 | 1435 | 1435 | 1250 | 1072 |
| `x` | U+0078 | 866 | 654 | 850 | 1733 | 1227 | 960 | 963 | 841 | 725 |
| `y` | U+0079 | 894 | 677 | 780 | 1776 | 1259 | 992 | 994 | 871 | 750 |
| `z` | U+007A | 856 | 673 | 758 | 1670 | 1186 | 943 | 950 | 850 | 733 |
| `{` | U+007B | 627 | 476 | 673 | 1239 | 876 | 690 | 694 | 608 | 530 |
| `\|` | U+007C | 423 | 322 | 802 | 780 | 556 | 458 | 464 | 408 | 361 |
| `}` | U+007D | 627 | 476 | 673 | 1239 | 876 | 690 | 694 | 608 | 530 |
| `~` | U+007E | 1018 | 786 | 1335 | 2150 | 1508 | 1128 | 1136 | 1002 | 861 |

### Figures

A figure is set in one of three sizes, each with its line height in px, its letter in tenths of a px, and its digit in hundredths of a px:

| Size | Line height | Letter | Digit |
|---|---|---|---|
| largest, 34 px | 36 | 210 | 2148 |
| middle, 24 px | 28 | 149 | 1506 |
| smallest, 18 px | 24 | 119 | 1127 |

The smallest size is the title's. Its letter and digit are those of the 16 px size it replaced, 105 and 1001, scaled by 18 / 16 and rounded up, and so are its widths in the table above.

`figureNeed(value, size) = span(value, fact value) * letter - digits * (11 * letter - digit)`, where `digits` is how many of `0` to `9` the value holds. It is the value's width on one line in hundredths of a px. Where a type wraps a figure, it counts the lines with `wrap` and the letter of the figure's size: 210, 149 or 119.

### Constants

| Name | Value | Meaning |
|---|---|---|
| `WIDTH` | 210 | Every small face's width, in px |
| `HEIGHT` | 146 | The most a small face is tall |
| `TITLE` | 24 | Line height of a title |
| `TEXT` | 22 | Line height of body text |
| `META` | 18 | Line height of a meta line |
| `CUE` | 18 | The cue's row |
| `GAP` | 6 | Under a title, and between the lines over a structure and what they follow |
| `FRAME` | 30 | Top and bottom padding and border of a padded face, with 2 px to spare |
| `SIDES` | 33 | Left and right padding and border of a padded face, with 1 px to spare |
| `COLUMN` | 177 | The text column of a padded face, `WIDTH - SIDES` |
| `PASSAGE_LETTER` | 92 | The letter that names the upright serif of a passage |

### Fixed words

A card draws a few words that are not the item's own. Each has an English and a Chinese form. A card uses the Chinese forms when `item.title` and `item.text`, joined by a line feed, hold at least one Han character (Unicode script Han) and no more of the letters `A` to `Z` and `a` to `z` than Han characters, and the English forms otherwise. Web addresses and colour values are taken out before the count, because they are written in Latin letters in any language: each match of `\b(?:https?:\/\/|www\.)\S*|#[0-9A-Fa-f]{3,8}\b|\b(?:rgba?|hsla?)\([^)]*\)`, in either case, is replaced by a space. So a hex code, `rgb(228, 87, 46)` and `hsl(178 75% 42%)` count no letter. Digits are never counted. A missing title or text counts as empty. A footprint is worked out with the same words the card draws, so `title` below and a reference's line of authors are counted in the card's own language.

| Where | English | Chinese |
|---|---|---|
| The title of an item that has none, on the card and the opened card | `Untitled` | `未命名` |
| The cue, when a face leaves words out | `More` | `更多` |
| The cue of a list, steps, a chat, facts or a swatch that leaves N entries out | `N more` | `还有 N 项` |
| The cue of a table of R rows | `R rows`, `1 row` | `R 行` |
| The cue of a chart of N points, and its count line, with its first and last labels when they fit | `N points`, `N points, A to B` | `N 个数据点`, `N 个数据点，A 至 B` |
| The cue of a breakdown of N parts, and of a sheet with N parts after its first | `N parts`, `1 part` | `N 部分` |
| A code card's line, with its language when it is known | `N lines of L`, `1 line` | `N 行 L`, `N 行代码` |
| The cue of pros and cons with P for and C against | `P for, C against` | `P 条优点，C 条缺点` |
| The cue of an explorable with N controls | `N controls`, `1 control` | `N 个控件` |
| A reference's first author, when it names N others or its list was cut | `A and N others`, `A and 1 other`, `A and others` | `A 等` |
| After the opened reference's authors when the list is cut | ` and others`, with the space | ` 等`, with the space |
| The two sides of pros and cons, in a view that names no heads | `For`, `Against` | `优点`, `缺点` |
| A reference's kind | `Paper`, `Book` | `论文`, `图书` |
| A callout's tone | `Caution`, `Note` | `注意`, `备注` |
| The two voices of a question and answer | `Q`, `A` | `问`, `答` |
| A link with no site | `link` | `链接` |
| A picture that cannot be loaded | `Picture unavailable` | `图片无法显示` |
| An opened clip with nothing to play | `This clip has no file to play.` | `这段视频没有可播放的文件。` |
| An opened recording with nothing to play | `This recording has no file to play.` | `这段录音没有可播放的文件。` |
| A chart with no values | `No data` | `暂无数据` |
| What a tick box says to a screen reader | `Done`, `Not done` | `已完成`, `未完成` |
| What a checklist's count says on hover | `2 of 4 done` | `已完成 2/4` |
| The mark on a card that can be explored | `Explore` | `可探索` |
| Beside a result an explorable's formula gave, where the item states none | `computed` | `计算值` |

`client/js/words.js` holds the table. The opened card's own labels, such as `From` and `Added`, are the app's and are not part of it.

### Lines over a structure

Fifteen types may carry `props.above`: quote, fact, facts, chart, breakdown, steps, list, table, qa, callout, excerpt, definition, proscons, sheet and explorable. It holds the item's own headings, labels and opening prose that stand over the card's structure, each one line of the item as the item writes it, such as `Don'ts:`, `Results` or a sentence that opens the item. They are what keeps a list under `Don'ts:` from reading as advice.

The entries are the strings of `props.above` in order, each trimmed, without the empty ones. An entry wrapped in `**` or `__` with no `*` or `_` inside, and a `:` or `：` after the closing pair or none, as `**Don'ts:**` is, is drawn without the pair, as `Don'ts:`. An entry is a head when it was so wrapped, or when it ends with `:`, `：`, a letter or a digit. A head is set in the title's weight at the body size and counted in the `head` measure, and any other entry in the `body` measure. Each entry is a row of words of its own, in the full colour of the structure, the first `GAP` px under what comes before it.

**Order on a small face.** A face shows the item's lines in order from the top: first the title where the type has one, then the `above` lines, then the `heads` row, then the entries of its structure, up to the height limit, then the cue. An `above` or `heads` line is never skipped to make room for an entry. If the `above` lines alone fill the face, the face is the title, those lines and the cue. This follows `lay`'s rule, since each line is a row before the structure's rows. A quote, a fact, a question and answer, a callout, an excerpt and a definition have no title on the face, so their lines come first, over the quotation mark, the value, the question, the tone, the passage and the headword. An explorable's lines come after its mark and its title. A sheet's own label of its first part, as `Best:`, stands over that part as a line over a structure.

This takes the place of the spec's line that the lines over a structure go to the opened card only: on the small face they would be left out exactly where they say what the entries are.

**The heads row.** A fact, facts, a chart and a breakdown may carry `props.heads`, the heads row of the table of two columns their figures come from, such as `Metric` and `Change`. There is a heads row when `props.heads` is a list of two strings and one of them, trimmed, is not empty. It is one row: each head in meta in half the column less 17 px, `half = floor((177 - 17) / 2) = 80`, whole on up to 2 lines, the first at the start and the second at the end, over 4 px and a hairline. Its height is `18 * max(lines of the two) + 5`, and it is `GAP` px under what comes before it. A head that needs more than 2 lines shows 2 and the face ends with the cue.

### Each type

`title` below is `item.title`, or the fixed word for a missing title when that is empty: `Untitled`, or `未命名` on a Chinese card. `item.title` is never trimmed. Every type is 210 wide and its height is what `lay` gives the rows named, at most 146. A face is padded (`FRAME` 30, column 177) unless its line says otherwise. "The title" is a row of the title measure in the face's column, `item.data.shortTitle` else `title`, whole on up to 2 lines, else cut with an ellipsis as A title on the face says. Each row's `gap` is the px above it. "Above" is the lines over a structure, and "heads" the heads row, each as the previous section gives them. Under a title of 1 line, a face holds about 3 lines of body text, 20 to 25 letters or 11 Chinese characters a line.

- **note.** The title, then the body at the body measure, gap 6. The body is `item.summary`, else `item.text`, and `item.text`, else `item.summary`, when `props.emphasis` is set. It is left out when it is empty or equal to `item.title`. Under a title of 2 lines it holds 2 lines, and under a title of 1 line, 3. A note that sets words apart marks them where they stand, in colour alone. When the lines the face gives the body from its start do not reach the end of the marked words, the body starts where they start, and the face ends with the cue.
- **quote.** Padded 13 by 19 px, so its column is 169. Above, gap 0 for the first. The quotation mark, 22 px tall, gap 6 under any line over it. The quotation, `props.text`, else `item.text`, else `item.title`, in the passage measure, upright. The speaker, `props.by`, in meta after a 14 px dash and 8 px, in a column of 147, whole on up to 2 lines, gap 8, kept. So it holds 3 lines and the speaker, or 2, the speaker and the cue.
- **fact.** Above, gap 0. Heads, gap 6 under a line over it. Without heads: the value, `props.value` trimmed, else `–`, gap 6 under anything over it, at the largest size that holds it on one line in 177 px, 34, 24 or 18 px, its row that size's line height; past that at 18 px on its whole lines, up to 4, its row 24 px a line. A value is never cut: a longer one shows 4 lines and the face ends with the cue. Then a rule 2 px tall, gap 1, and the label, `props.label`, in the body measure on up to 2 lines, gap 1. With heads: one headed row of figures, as facts sets them. Last, the title in meta on up to 2 lines, gap 8, when it is not the value or the label.
- **image.** Picture-led, with no padding. The caption is `props.caption`, else `item.title`. With a caption, the frame is the 2 px border and 10 px under the caption. The picture is `clamp(round(210 / aspect), 81, room)` px tall, where `aspect` is `props.aspect` or 1.35 and `room` is 144 less the plate: 9 px, the caption's lines, at most 2, or 1 when it needs more, 10 px, and the cue's 18 px when it needs more. The caption is a row of the body measure, gap 9, on up to 2 lines. So the picture is 103 px under a caption of 1 line, 81 under 2, and 85 over 1 line and the cue. Without a caption the frame is 2 and the picture stands alone.
- **video.** As an image, with the poster at 16:9: `min(118, room)` px tall and 16 / 9 as wide, rounded, centred on a dark band when it is narrower than the face, with its play mark. So 183 by 103 under a caption of 1 line, 144 by 81 under 2.
- **audio.** The title on up to 2 lines. The strip, 40 px, gap 6: the play mark, the waveform and the length. The transcript, `item.text` with its runs of white space made one, without the title when it opens with the title's words, in the body measure, gap 6. So a title of 1 line leaves 1 line of transcript, and a title of 2 lines the strip and the cue.
- **link.** The address bar, 30 px, then a part padded 10 above and 13 below, so the frame is 56. The title, then what the page is about, `props.description`, else `item.summary`, in the body measure, gap 4. No thumbnail: the opened card has it. So a title of 1 line has 2 lines under it, and a title of 2 lines has 1 when that is all, else the cue.
- **chart.** A designed preview, because no label or value reads at the face's sizes. The title, above, heads, then the shape of the values with no text, `clamp(146 - the height of the rows over it - 6 - 6 - 18, 38, 62)` px tall, gap 6, and one meta line, gap 6: the count of points with the first and last labels, `12 points, 2015 to 2026`, when that fits one line, else the count alone, or `No data`. When the face has no room for the shape, that line is the cue.
- **person.** One row: a round face 48 px across, then 12 px, then the name, `props.name`, else `item.title`, at the title measure, cut as a title is past 2 lines, and the role, `props.role`, in the body measure whole on up to 2 lines, the cue after it when it needs more, both in a column of 117. The row is as tall as the larger of 48 and the lines.
- **chat.** The title, then each message, `props.messages`, in its bubble: a unit of the body measure in a column of 132, at most 86% of the column less 20 px of padding, whole on up to 2 lines, its row 12 px more than its lines, gap 8 for the first and 6 after. The cue counts the messages left out.
- **code.** The title, then one meta line, gap 6: how many lines the source has and in what language, `24 lines of Python`. A line of source at 16 px holds about 18 characters, so the face shows none. The language is `props.language`, unless it is `text`. The opened card has the source.
- **steps.** The title, above, then each step a unit of the body measure in a column of 145 beside its 22 px number, whole on up to 2 lines, gap 6 for the first and 8 after. The cue counts the steps left out.
- **facts.** The title, above, heads, then the figures a row at a time, each row a unit, the first 4 px under the title, or 6 under heads, and 12 px between rows. Two facts share a row when both values fit 80 px at 24 px; any other has the row. A value is set at 24 px when it fits its room on one line, else at 18 px on whole lines, up to 4; its label is under it in meta on up to 2. Every figure of a face is one size. Under heads each row is headed: the label under the first head, the value under the second. The first row, when it is taller than the room the face leaves it, shows the most lines of its value that leave a line of its label. The cue counts the facts left out and `props.more`.
- **table.** A designed preview. The title, above, the heads in meta joined by a middle dot as far as they stand whole on one line, with `+N` for the rest after them, gap 6, on up to 2 lines when the first head alone is longer, then 4 px, then the cue, which counts the rows: `12 rows`. A table with no rows has no cue.
- **list.** The title, in the column less a checklist's tally and 10 px, the tally beside it in meta. Above. Then each entry a unit of the body measure in a column of 157 beside its dot or tick box, whole on up to 2 lines, gap 10 for the first and 5 after. So it holds 3 entries of 1 line, or 2 and the cue. The cue counts the entries left out.
- **breakdown.** A designed preview. The title, above, heads, one 16 px bar split into the parts by their shares, gap 6, then the largest part as one line of the body measure, its label and its share as the item writes them, `Rent 42%`, with a unit other than a percent sign after, gap 6, on up to 2 lines. The cue always counts the parts: `6 parts`.
- **qa.** Above, gap 0. The question, `props.question`, at the title measure in a column of 155 beside its letter, gap 6 under a line over it. The answer, `props.answer`, in the body measure in the same column, 17 px under it, with the rule in the middle of that. So under a question of 1 line it holds 3 lines of answer, or 2 and the cue, and under a question of 2 lines, 2, or 1 and the cue.
- **callout.** Padded 21 px on the left for its band, so its column is 171. Above, gap 0. Its tone in meta beside its glyph, 18 px, gap 6 under a line over it. Its words, `props.text`, at the title measure, gap 6. So it holds 3 lines, and the cue when there are more.
- **excerpt.** Above, gap 0. The passage, `props.text` without the Scout's closing line, with its runs of white space made one, in the passage measure in a column of 164, gap 6 under a line over it. Then one meta line, gap 10, kept: the item's title and where it is from, `props.at` and `props.source`, joined by a middle dot, without a part that is the title, whole on 1 line, without a dot left at its end. So it holds 4 lines and the source, or 3, the source and the cue.
- **definition.** Above, gap 0. The headword, `props.term`, at 24 px when it fits 177 px on one line, else at the title measure, cut as a title is past 2 lines, over a short rule, its row the term's lines and 10 px. The meaning, `props.definition`, in the passage measure in a column of 178. So under a headword of 1 line it holds 3 lines of meaning, or 2 and the cue, and under a headword of 2 lines, 2, or 1 and the cue.
- **idea.** The spark, 22 px. The thought, `title`, as a figure: at 34 px when it stands on 2 lines, else at 24 px on 3, else at 18 px on 3, where a longer thought shows its first 3 lines and the cue.
- **proscons.** A designed preview. The title, above, then each side that holds a point as one row of the `head` measure on up to 2 lines: the side's head, the item's own, `props.heads`, else `For` or `Against`, in the title's weight, running into its first point after a space, or straight after a stop set with Han. Gap 6 for the first and 0 after. The card adds no sign of its own, so in place of the spec's `+` and `−` each side is named in its item's words. The cue counts both sides, `3 for, 2 against`, when either side holds more than one point.
- **swatch.** A band 44 px tall of up to 12 of its colours, then the rest padded 12 above and 13 below, so the frame is 73. The title, then each colour a unit: its dot, its name in the body measure whole on up to 2 lines, and its value in meta at the end of the row when the name is not the value, gap 8 for the first and 5 after. The cue counts the colours left out.
- **artwork.** Picture-led, with no padding. The work whole on a 6 px mat, as large as the plate leaves room for: `146 - 2 - (10 + 24 * titleLines + 9)`, 101 px under a title of 1 line and 77 under 2. The title, gap 10. The maker, the date, the medium and the holder are on the opened card.
- **reference.** Its kind and year in meta over a rule, a row of 32 px. The title on up to 2 lines. The first author in meta on 1 line, gap 6: `A. Vaswani and 7 others`, or `A. Vaswani and others` when the list was cut. The venue and every author are on the opened card.
- **place.** The name, `props.name` trimmed, else the face's title, beside a round 28 px pin: at 24 px when it fits 139 px on one line, else at the title measure, cut as a title is past 2 lines, its row the larger of 28 and its lines. With a point on the earth, the face is padded only above the name, so its frame is 17, and under the name, 13 px down, a map 210 by 88. Without one, the face is padded and the words about the place, `item.summary`, else `item.text`, unless they are the name or the title, are under the name in the body measure, gap 8.
- **sheet.** The title is its heading section's text, else `item.title`. The title, above, then its first part as that part's own preview, each in the room the face leaves: a text's lines (gap 6), a row of figures as facts sets it (4 px under the title), entries as a list sets them (10 px under), a table's heads and the count of its rows (gap 6), or a passage in the passage measure in a column of 163 over who said it, which it keeps. The part's own label, as `Best:`, stands over it. Under a title of 1 line that room is 68 px. The cue counts the other parts, its picture among them: `2 parts`.
- **explorable.** The explore mark, 22 px. The title. Above. Then what the controls change, in the body measure on up to 2 lines, gap 6: the first state's words for an output of words, else the output's label. The cue counts the controls: `2 controls`. The controls are on the opened card.

### Text cut to a width

No small face cuts a string. `cut(str, room, letter)` shortens a label of the opened chart's plot, and nothing else, to as much of its start as fits `room` px with an ellipsis, counted in the text face: `cut = str` when `span(str) * 72 <= room * 100`, else the longest run of whole grapheme clusters whose `span` fits `room * 100 - span('…') * 72`, then `…`. The opened chart lists every label and value whole in its table whenever its plot cut, thinned or rounded one.

## Chips

A card's sources are short facts about its item: when, where it came from, where, and who. The small face draws none of them, so they add nothing to a footprint, and the opened card lists every one in full. They are read from the item alone. They never come from `view.props`, so the Renderer and the model have no part in them, and they do not depend on the node, so a pick lists the same sources once it is kept. `chipSources(item)` in `client/js/chips.js` is the whole rule.

**Sources, in this order.**

| Kind | Label | Read from | Text |
| --- | --- | --- | --- |
| `when` | `When` | The first of `item.data.when` and `item.data.date` that is a source | The string. |
| `origin` | `Origin` | The first of `item.data.holder`, `item.data.venue`, `item.data.site` and `item.data.from` that is a source. Only when the agents brought the item, which is `item.origin.by === 'agent'`. | The string. |
| `where` | `Where` | `item.data.where` | The string. |
| `people` | `People` | The first of `item.data.people` and `item.data.authors` that holds a name, each an array of strings. | Every name, joined by a comma and a space. |

A value is trimmed of the white space at both ends. A string is a source only when something is left after that, so an empty string, a string of spaces and a value of another type are passed over, and the next key is tried. A name that is not a string, or is empty once trimmed, is passed over. A source whose text is exactly the text of a source before it is left out, so a work whose one author is its holder names it once.

The Scout writes `date`, `site` and `from` on what it brings, and `holder`, `venue` and `authors` when its source gives them. It also writes `by`, which no source reads: it is a maker for a museum work, and for other sources a site's name, a score or a cuisine.

What the user made has no origin, so its order is when, where, people. What the agents brought says where it came from straight after its date.

`item.data.at` makes no source of its own.

## Maps

A map is described to a client as a centre, a zoom and pins, and the client draws it from the tiles of the provider the service names. `client/js/map.js` is the whole rule in the web client.

**Where an item is.** `item.data.at` is `{ lat, lon }` in degrees, north and east positive. It is a point on the earth when both are numbers, finite, with `|lat| <= 90` and `|lon| <= 180`. Anything else is no point, and a card draws as if `at` were missing. Intake writes it:

- From a dropped JPEG's own GPS position in its Exif block (`src/core/exif.ts`). This is read on the machine, so it happens whether or not maps are on.
- Otherwise from looking up `data.where`, only when maps are on. The geocoder is the `Geocoder` port in `src/core/ports.ts`. `src/node/geocoder.ts` asks OpenStreetMap's public lookup (Nominatim), at most once a second, and keeps every answer, a place not found included, in `places.json` in the data folder, so a name is asked about once. It takes the first result that is a settlement, a region, a natural feature or a sight, so a café that shares a name is not the place.

**Switching maps on.** Maps are off unless `MIND_PALACE_MAPS` names a provider. The one provider is `openstreetmap`. With maps off no place is looked up and no tile is asked for, so nothing about a place leaves the machine. With maps on, a lookup sends the place's name to the provider's server with a generic client name and nothing about the user, and each map a client draws asks the tile server for the squares around the place.

**The provider.** The `hello` message carries `maps`: `{ tiles, credit, link? }`, or null when maps are off. `tiles` is an address with `{z}`, `{x}` and `{y}` in it, as `https://tile.openstreetmap.org/{z}/{x}/{y}.png`. `credit` is the words every map shows, `© OpenStreetMap contributors`. `link` is where the credit points, in a view where a link can be followed. OpenStreetMap's public servers allow light use only, so a commercial provider replaces them before the product ships, and no client changes when it does.

**Tiles and pins.** Tiles are 256 px squares of the Web Mercator projection. At zoom `z` the world is `world = 256 * 2^z` px across and down. A point is at `x = (lon + 180) / 360 * world` and `y = (0.5 - ln((1 + sin φ) / (1 - sin φ)) / (4π)) * world`, where `φ` is `lat` held between -85.0511287798 and 85.0511287798 degrees, in radians. For a map `width` by `height` px around a centre: `left = round(x - width / 2)` and `top = round(y - height / 2)` of the centre, so the map's corner is on a whole px and tiles meet with no seam. Every column from `floor(left / 256)` while `column * 256 < left + width`, and every row from `floor(top / 256)` while `row * 256 < top + height`, is a tile, at `column * 256 - left`, `row * 256 - top` from the map's corner. A row below 0 or at `2^z` or past has no tile. A column wraps round the world: the tile's `x` is the column modulo `2^z`, never negative, and its `y` is the row. A pin is drawn at the point's `x - left`, `y - top`, with the tip of a drop-shaped marker 22 by 28 px on the point, in the card's accent with a dot of the card's face in it.

**Drawing.** The map is a box of its height on a plain ground (`#20262c`). The tiles and pins sit in a layer `width` by `height` at the middle of the box, so a box a little wider or narrower than the map keeps the centre in the middle. The tiles are drawn only as far as they lie inside the map. A tile that fails to load leaves the plain ground, so a map with no tiles still shows its pins. Where two tiles meet at a fraction of a device px, as they do on a card drawn at 1.12 or 0.86 or at a fractional position, each covers the px they share only in part and the ground shows through as a hairline. So each tile is drawn a second time under all the tiles, 1 px to the right and 1 px down, which fills that px and moves nothing. The credit is set in 10 px type on a light plate in the map's bottom-right corner, on every map while the service names a provider, whether or not its tiles load. With no provider a map asks for no tile and draws no credit: the plain ground and its pins.

**On a place card.** A place whose item has a point draws a map across the face under its name: 210 by 88 px, at zoom 12, centred on the point with one pin on it, in place of the words about the place. At zoom 12 the card shows about ten kilometres by four at the equator, a town or a sight with what is around it. That takes at most four tiles. The opened card draws a map 348 by 200 px, also at zoom 12 with one pin, after the picture, with the credit as a link. That takes at most six.

**In a map arrangement.** The `map` composite draws a map 400 by 320 px with a numbered pin for each place, as its section says. A pin there carries its number in its head in place of the dot, in 11 px figures of weight 700 in the colour of the card's face. At most nine tiles cover it.

**Samples.** `client/library.html` and the tests draw tiles from `client/samples/tiles/{z}/{x}/{y}.svg`, plain squares in two shades that `scripts/sample-tiles.ts` writes for the points and the sample maps they use, so they ask no tile server for anything.

## The opened card

An opened card holds everything its small face leaves out, and scrolls inside its panel. Its title is 21 px, every line that is read is 15 px, and its labels, tags and the map's credit are at least 11.5 px. On the headset it opens to 46 by 37.2 cm.

An opened card says each thing once. From top to bottom it has the item's title, why a pick is here, the type's own opened form, the summary, what is left of the text, the tags, and the list of sources.

`client/js/said.js` is the whole rule for the summary and the text, and has no drawing code. `said` is every string the card has drawn by then: the title, each string the type's opened form writes, and the text of each source in the list.

**The text.** Split it at each line feed and take each line with its runs of white space turned into one space and its ends trimmed. Matching ignores case.

1. A line with no letter or digit is kept as an empty line.
2. A line that is inside one string of `said` is left out.
3. Mark every place in the line where a string of `said` stands as whole words, the longest strings first. A string stands as whole words when the character before it and the character after it are not letters or digits, or are characters of a script written without spaces (U+3040 to 30FF, U+3400 to 9FFF, U+AC00 to D7AF), or the string itself starts or ends with one.
4. When something is marked, take what is not marked, with each marked run turned into a line feed, and take its marks out of it: a bullet, number or tick box at its start (`-` `*` `•` `·` `+`, digits followed by `.` `)` or `、`, or `[ ]`, `[x]`, `[X]` or `[✓]`, as often as they repeat, with the white space around them); then each label, a letter followed by letters, digits and spaces, up to white space and a colon (`:` or `：`), that weighs at most 16, where a letter or digit weighs 1 and a character of a script written without spaces weighs 2; then the joining words `and`, `or`, `和`, `与` and `以及`, as whole runs of letters and digits, whatever their case. The line is left out when no letter or digit is left: what the card did not draw is only marks, punctuation and brackets. So `Solo | $8 | 1`, `[x] passport`, `Definition: …`, `Pros: no data races. Cons: slow builds` and `Palette: ember (#E4572E) and lagoon (#17BEBB)` are left out once the form has drawn their words, and `Table 2. Mean recall (n = 212)` is not, because `Table 2` and `n = 212` are words that are not marks.
5. Any other line is printed. A marked run of 20 characters or more is first cut out of it when the run is a sentence of its own: it starts the line or follows a `.` `!` `?` `:` `;` or their full-width forms, and it ends the line, ends with one of those, or is followed by a closing quote mark, bracket, stop or comma, or by white space and an opening bracket, so `Table 2. Mean recall (n = 212)` under the title `Mean recall` prints `Table 2. (n = 212)`. The quote marks and brackets around the run and the stops after it go with it.

Three or more line feeds in a row become two, and the result is trimmed. Nothing is printed when nothing is left.

**The summary.** It is printed whole, unless the item's text or a string of `said` holds it, or the rule for the text, given the summary and `said` and taking no marks out in step 4, leaves nothing of it: every letter and digit of the summary is already drawn. An ellipsis at its end (`…` or `...`) is taken off before it is looked for in a string, and case and runs of white space are ignored.

So an opened table shows its grid and not the pasted rows again, a page the Scout picked shows its passage once, and a paragraph beside a small table is still printed. A summary made without the model is the start of the text, cut with an ellipsis, so the text holds it and only the text's unsaid lines are printed.

A type's opened form leaves to the list of sources what the list says in the same words: an artwork its holder, a reference its venue, and its authors when the list is not cut short.

## Rules the Renderer follows

Rules in plain code choose first, from one ordered table in `renderer.ts`. The model is asked only about what the rules leave as a note or an idea.

### The rule table

The first row that holds draws the item. Each row reads one of four things: what a source's catalogue recorded, the item's kind, structure that Intake extracted into `item.data`, or the item's own words.

| # | Component | Reads | Holds when |
|---|---|---|---|
| 1 | `artwork` | catalogue | `data.kind` is `artwork` and the item has a picture |
| 2 | `reference` | catalogue | `data.kind` is `paper` or `book` |
| 3 | `image` | kind | the item's kind is `image` and it has a source |
| 4 | `video` | kind | the item's kind is `video` and it has a source |
| 5 | `audio` | kind | the item's kind is `audio` and it has a file or an address to play |
| 6 | `code` | kind | `data.code` holds a source, or the item's kind is `code` and its text is not empty |
| 7 | `breakdown` | catalogue, then structure | `data.chart` is shares of one whole |
| 8 | `chart` | catalogue, then structure | `data.chart` holds at least two labels and as many values |
| 9 | `table` | structure | `data.table` has at least two heads and one row |
| 10 | `proscons` | structure | `data.pros` and `data.cons` each hold a point |
| 11 | `qa` | structure | `data.question` and `data.answer` are both set |
| 12 | `definition` | structure | `data.term` and `data.definition` are both set |
| 13 | `steps` | structure | `data.steps` holds two or more steps |
| 14 | `list` | structure | `data.items` holds two or more entries, none of them empty |
| 15 | `quote` | structure | `data.quote` exists |
| 16 | `person` | structure | `data.person` exists |
| 17 | `swatch` | structure | `data.colours` holds two or more colours |
| 18 | `facts` | structure | `data.facts` holds two or more facts with a label and a value, and no value is over 60 characters |
| 19 | `fact` | structure | `data.facts` holds exactly one, or the text is one short line that reads as a value with a label, and the value is not over 60 characters |
| 20 | `link` | kind | the item's kind is `link` and it has an address |
| 21 | `excerpt` | structure | `data.excerpt` exists |
| 22 | `excerpt` | catalogue | the item is a page the Scout picked: a text pick with an address whose text holds more than its closing line |
| 23 | `place` | text | a short note whose title is the name of the place in `data.where` |
| 24 | `chat` | kind | the item's kind is `chat` and it holds a message |
| 25 | `idea` | text | a short thought the user wrote out |
| 26 | `note` | text | always |

What a source catalogued comes first, because it is a record and no guess. A picture, a recording or a piece of code stays one, whatever was read off it. Then comes the structure Intake extracted, the most particular shape first. Rows 7 and 8 are each two rows: the first holds only for an item the agents brought, and has no floor. A conversation's data is its messages, so an item whose kind is `chat` is tried against rows 24 and 26 alone. A recording is its sound, and what Intake reads off its transcript is for its chips and for search, so an item whose kind is `audio` is tried against rows 5 and 26 alone: with nothing to play it is a note. A row whose props its schema refuses is passed over.

A fact's value is a figure or a few words. One of more than 60 characters, counted after Unicode NFKC with each run of white space as one space, is a sentence, so rows 18 and 19 do not hold for an item with such a value and it is left to the rows after them.

### The coverage floor

A row that reads structure holds only when its card would show at least 20 percent of what the item says. A list of two words must not stand in for a page of notes.

What the card would show is every string and number of the piece of structure, without the addresses, and for `facts` the first six facts alone. What the item says is its text, when the user made the item, its kind is `text` and the text is not empty. The model wrote that item's title, so the same two lines must not be a list under a short title and a note under a long one. For any other item it is the title and the text together. Both are counted in characters after Unicode NFKC and with each run of white space as one space.

A row whose card names a value or shows a passage or a meaning is also held to the item's own words: its title and text, without its `data`. The role that extracted the piece checked that the item states each value, and not how the values stand together. So the checks `label`, `point`, `whole`, `lead` and `meaning` of the content check below are read for it. A figure, an entry or a row that fails one is dropped from the card. The row is passed over when any other value fails, when the card is no longer valid, or when what is left shows under 20 percent of the item.

### A place

Row 23 holds when the item's kind is `text`, `data.where` is set, the title is not empty, the text is under 280 characters, and the title names the place. The two are compared in one case and one written form, each without the region after its last comma. They match when they are equal. In a script written without spaces (Han, kana, hangul, Thai) with at least two characters each, they also match when the title is the place with a region of two to six characters in front of it, as 杭州西湖 is of 西湖, or when one is the other with one character at its end that names a kind of district: 市 区 县 省 都 镇 乡 村 州 府 道 町 시 도 구.

### An idea

Row 25 holds when the user made the item, its kind is `text`, and it is one phrase: the text, or the title when there is no text. When both are set they must be the same phrase, whatever the case, the white space and the punctuation at the end. The phrase is under 60 characters, or under 24 in a script written without spaces, holds no digit, and is no web address. In a script written without spaces it holds at least 6 letters. In any other it holds at least 3 words with a letter in them, so a chore, a name or a room number stays a note.

### The model

The model is asked only about items the rules are unsure of, and only to choose among cards built from the item's own words. What it answers is a proposal. Every card it proposes is held to the checks below, and where one fails the rules' card stands. `renderer.ts` holds all of this.

**Which items are asked about.** An item whose kind is `text` or `file`, which the rules drew as a note or an idea, and which says enough: its text, or its title when the rules drew an idea and it has no text, is at least 40 characters, or 16 when it holds a character of a script written without spaces (Han, kana, hangul, Thai). Characters are counted after Unicode NFKC, with each run of white space as one space and the ends trimmed. A view the Renderer chose for the item earlier (`view.by` is `renderer`) that still passes the content check is kept without asking again. The one exception is a note or an idea whose item's title, text or data changed since: a note or an idea shows nothing an edit could contradict, so the model is asked again.

**What it is sent.** For each item, its node id, its title, `now: idea` when the rules drew an idea, `picture: yes` when the item has a picture of its own, and its text. A text over 1,200 characters is sent as its first 1,200, with a line that gives its whole length. The prompt names each card and the slots it fills, and says how to choose: a card of its own when its structure is what the item mainly is, at least a fifth of the text; a sheet only when the item has two or more kinds of part worth seeing and no card of its own covers a fifth of it; a note when nothing fits. It also says that every value is copied word for word in the item's language, that a passage is whole sentences or whole lines, that a label is a few words of its value's own sentence, line or table row and at most 40 characters, and that each figure, entry and row is written once.

**What it may answer.** One entry for each item, all in one flat shape: `id`, `component`, and the slots `subject`, `passage`, `by`, `tone`, `lines`, `labels`, `numbers`, `left`, `right`, `unit`, `emphasis`, `sections`, `controls` and `formula`, each an empty string or an empty list when the card does not use it. `component` is one of seventeen: `note`, `idea`, `quote`, `fact`, `facts`, `steps`, `list`, `chart`, `breakdown`, `table`, `qa`, `definition`, `proscons`, `callout`, `excerpt`, `sheet` and `explorable`. One builder for each card turns the slots into props. The prompt asks for an explorable when the item explains how something works by relating quantities or by contrasting states, so a reader learns more by changing it.

| Card | Built from |
|---|---|
| `note` | `emphasis`, when it is at most 120 characters |
| `idea` | nothing |
| `quote` | `passage` without the quote marks at its ends, and `by` |
| `fact` | `passage` as the value and `subject` as the label |
| `facts` | the first six of `lines`, each written `label \| value` |
| `steps`, `list` | `lines`, one step or entry each |
| `chart`, `breakdown` | `labels`, `numbers` and `unit`. A chart is a line when every label is a year or a full date and they ascend |
| `table` | `lines`, the heads first, with `\|` between cells |
| `qa`, `definition` | `subject` as the question or the term, and `passage` as the answer or the meaning |
| `proscons` | `left` as the points for and `right` as the points against |
| `callout` | `passage`, with the tone `note` when `tone` says so and `caution` otherwise |
| `excerpt` | `passage` without the quote marks at its ends, `by` as `at`, and `data.site`, else `data.from`, as `source` |
| `sheet` | `sections`, each `{ kind, text, by, lines }`: a heading's, a text's and an excerpt's words in `text`, who said an excerpt in `by`, and figures, entries and table rows in `lines` as for the cards above. A picture is the item's own picture |
| `explorable` | `controls`, each `{ kind, label, states, texts, name, unit, min, max, values }`. A `toggle` or a `segmented` takes `label`, and a state for each of `states`, named so, whose text is the same place of `texts` without the quote marks at its ends. A `slider` takes `name`, `label`, `unit` when it stands against `values`, and `values`, and runs from the lesser of `min` and its values to the greater of `max` and them, in the coarsest step of 1, 2 or 5 times a power of ten, from 5,000,000 down to 0.000001, that gives at least 40 steps and lands on both ends and on every value; one that would need more than 1,000 steps has none and is refused. With a slider, `formula` is read into a program, `subject` is the result's label, `unit` its unit when it stands against `numbers`, and `numbers` the results the item states, one for each value of each slider. A result stated at three values or more is drawn as a `chart`, and at two as a `figure` |

Each list drops its empty lines and any line written twice. An emphasis, a speaker, an excerpt's `at` and a unit that the content does not state are left off, and the card is kept without them.

**The checks.** A card the model proposes is drawn only when all of these hold:

1. The library has it: its props pass the component's schema, and an `idea` is a phrase the user wrote, as An idea above says, but under 60 characters in any script.
2. Everything it shows stands in its item, by the content check below. The label of a figure may be at most 40 characters, and a passage that must be whole at most 400, or 200 in a script written without spaces. A figure, a list entry or a table row that fails is dropped, and the card is drawn without it when it is still a valid card. Any other value that fails refuses the card.
3. The component's own condition holds, such as a fact's value of at most 32 characters or a breakdown's shares that add up to 100.
4. It shows at least 20 percent of the item, counted as the coverage floor counts: every value it shows, once each, without the choices and the item's own addresses. A note and an idea draw the item itself and are not held to this, and nor is an explorable with a slider, whose result has a value at every step.

An explorable's formula is checked before the rest. One that cannot be read, that misses a result the item states by more than 1 percent of it, or that has no value at a step of a slider refuses the card, and the run log says which: `has a formula that cannot be read: it calls the unknown function "atan2"`, `has a formula that gives 77.43 at focal length 24, where the item states 73.7`, `has a formula that has no value at focal length 0`.

Every value dropped and every card refused writes one line to the run log that names the item and the value.

**A sheet.** The sections of a `sheet` answer become a card in four steps.

1. A section that repeats one before it is dropped. More than four sections, two headings, or a heading that is not first, and the answer is refused.
2. The half rule. When one section alone shows at least half of the item, counted as the floor counts, and passes every check above as the card of its own kind, that card is drawn in place of the sheet: figures as a `fact` or a `facts`, a list as a `list`, a table as a `table`, words someone said as a `quote` when they have a speaker the content states and as an `excerpt` when not. When more than one does, the one that shows the most is drawn. A card of its own always wins over a sheet.
3. Otherwise each section is checked alone. A figure, entry or row that fails is dropped, and a section that still fails is left out. Each is then cut to the room a sheet has: a heading to 80 characters and a text to 280, at the end of a word and with an ellipsis, and four figures, eight entries and five rows. A section that is then no longer valid is left out.
4. What is left must be a valid sheet, of two to four sections with at most one heading and that first, two that are no heading, and one that is no text. It must show 20 percent of the item, its heading not counted. A sheet that shows less is still drawn when one of its text parts is the item's own opening: the text begins with it, and it is at least 120 characters, or 60 in a script written without spaces. That is what a sheet is for: a long item's opening beside a key figure or a key line.

**Passes.** One pass of the Renderer asks about at most 24 unsure items, in calls of at most 8 made at once and split evenly, so ten items go in two calls of five. A call answered unreadably is tried once more as two halves. Every card the pass asks about lands within 12 s with `view.by` set to `renderer`: the model's card, or the rules' card when the answer was refused, did not come or came after 12 s, or when the item was past the 24 of the pass. A landed card is not asked about again until its item changes, so no later pass turns it into another card.

### The content check

A card the model proposes is kept only when everything it shows stands in its item, and the stand-in service's choices pass the same checks. `CHECKS` in `src/core/views.ts` names a check for every prop of every component, and its type refuses a component or a prop with no entry. A sheet's sections have a check for each kind. The content is the item's title and text and the values of its `data`, without the addresses. For an item the agents brought, the series in `data.chart` is read as rows of a table after the text, because a source's record is no guess. Words are compared after Unicode NFKC, whatever their case, their spacing and the quote marks and punctuation between them. A number matches any way its written form may be read, and a character of a script written without spaces matches anywhere in a word.

| Check | The value stands when |
|---|---|
| `says` | the content states these words, inside one table cell, one list item and, in a script written without spaces, one sentence |
| `cell` | the same, or it is empty, and it holds no `\|` or tab |
| `quotes` | the content holds this passage as one stretch, with no sentence end or empty line inside it |
| `whole` | the same, and it begins where a sentence, a line, a table cell or quoted words begin and ends where one ends |
| `lead` | it is whole, or it ends with an ellipsis and what comes before it is a stretch that begins where a sentence, a line, a cell or quoted words begin |
| `meaning` | it is whole and the content gives it as the meaning of the `term` beside it: the term stands in its sentence or the one next to it, or it follows the term with nothing between them but punctuation or a linking word |
| `writes` | the content writes this number, with the unit beside it when the unit scales it, as 万 and k do |
| `unit` | the content states these words, or writes them against one of the values |
| `paints` | the content writes this colour: a hex value whole, or a colour name as words |
| `own` | it is one of the item's own values, whole or cut short with an ellipsis: an address, a site, a source, the summary, the text, a value in `data` |
| `label` | every word of it stands in the sentence, the line or the table row that holds the `value` beside it, or in the head of that value's column. When the content does not state the value at all, the value fails its own check instead |
| `point` | the same, for the number at the same place in the `values` beside it |
| `choice` | always. It says how to draw, not what to show |
| `computes` | always. It is a token of a formula, which the component's own condition holds to the item by what it gives |

| Component | Checks |
|---|---|
| `note` | `emphasis` says |
| `quote` | `text` is whole, `by` says |
| `fact` | `value` says and is at most 32 characters, `label` is a label |
| `image`, `video`, `link`, `chat`, `code` | every prop is the item's own, but `aspect` and `language`, which are choices |
| `chart` | `labels` are points, `values` write, `unit` is a unit, and there are at least two labels and as many values |
| `person` | `name` and `role` say, `image` is the item's own |
| `steps` | each step says, and there are at least two |
| `facts` | each `value` says, each `label` is a label, and `more` is the number of facts in `data.facts` past those shown |
| `table` | every head and cell is a cell |
| `list` | each entry says, and each mark is the one the text carries on that entry's line or `data.checklist` holds for it |
| `breakdown` | `labels` are points, `values` write, `unit` is a unit, and the values add up to 100, give or take 1 |
| `qa` | `question` and `answer` say |
| `callout` | `text` is whole, `tone` is a choice |
| `excerpt` | `text` is whole, `at` says, `source` is the item's own |
| `definition` | `term` says, `definition` is its meaning |
| `idea` | nothing to check |
| `proscons` | each point says |
| `swatch` | each `name` says, each `value` paints |
| `artwork` | `src` is the item's own, and `maker`, `date`, `medium` and `holder` say |
| `reference` | `kind` and `url` are the item's own, `authors`, `year` and `venue` say, and `more` is set only when `data.authorsCut` is true and `data.authors` holds a name |
| `place` | `name` says, `src` is the item's own |
| `sheet` | a heading says, a text is a lead, each figure's `value` says and `label` is a label, each entry says, every table head and cell is a cell, a picture is the item's own, and an excerpt's `text` is whole and its `by` says |
| `explorable` | each control's `label` and each state's `name` say, and each state's `text` is whole. A slider's `values` write and its `unit` is a unit, and its `name`, `min`, `max` and `step` are choices. The result's `label` says, its `unit` is a unit, its `values` write and its `formula` computes: at each set of values the item states, it gives the result the item states there within 1 percent of it, and it has a value at every step of each slider, the others on their first values |

## Components

Each type below says when a rule chooses it. Beyond those rules, the model may choose any of the seventeen cards that The model lists for an item the rules are unsure of, and the card is drawn when it passes the checks there.

A structured card is held to its whole item: its structure changes how the item is laid out and never what of it is shown. So fifteen types also carry `above?`, one to six lines of the item's own headings, labels and opening prose that stand over the structure, which the Renderer sets and no model writes: quote, fact, facts, chart, breakdown, steps, list, table, qa, callout, excerpt, definition, proscons, sheet and explorable. A fact, facts, a chart and a breakdown drawn from a table of two columns also carry `heads?`, that table's heads row. Lines over a structure says how a client draws both.

### note

The fallback. A title and a few lines of text.

- **Chosen when** nothing else fits.
- **Props.** `emphasis?`: one or more whole sentences or lines of the text to set apart, ending within its first 180 characters, or 90 in a script written without spaces. Only the model sets it.
- **Drawn as** the title and the body, on the whole lines Each type gives them. With an emphasis the body is the item's own text, with the words marked where they stand. When the lines from its start do not reach them, the body starts where they start. The note never sets them apart over itself.
- **The summary is held to the face.** Intake asks the model for one short sentence, about 30 to 45 characters in English or 22 to 33 in Chinese, and `fittedSummary` in `src/core/fitted.ts` holds it to the lines a note's face gives it under its title, counted by this page's rule: `floor((146 - 30 - 24 * titleLines - 6) / 22)`, where `titleLines` is the face title's, at most 2, which is 3 under a title of 1 line and 2 under a title of 2. A longer summary keeps its first whole sentences that fit, else its first whole clause that fits and says something, three words or six Han characters, without the mark that ends the clause. When neither fits it is dropped, and the note shows the item's own first lines. It never ends in an ellipsis. A takeaway from a chat is held the same way. The opened card shows the item's text whole either way.
- **Item holds.** `title`, and `text` or `summary`.

### quote

Someone's words, upright in a serif.

- **Chosen when** `item.data.quote` exists, or the model finds that a text item is mainly a quotation.
- **Props.** `text`: the words, without quote marks. `by?`: the speaker.
- **Item holds.** `data.quote = { text, by? }`, or the quotation inside `text`.

### fact

One number or short value with its label.

- **Chosen when** `item.data.facts` holds exactly one fact with a value of at most 60 characters, or a text item is one short line that reads as a value with a label (`42% of users leave`, `Budget: $1.2M`), or the model finds that a text item is mainly one figure.
- **Props.** `value`: the figure as written, such as `42%`. `label`: what it measures. `above?`. `heads?`: the heads row of the table of two columns the figure comes from, under which the card sets its label beside its value.
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

### audio

- **Chosen when** the item's kind is `audio` and it has a file or an address to play. Without one it is a note.
- **Props.** `src`: the stored file, else `data.mediaUrl`, the address a source gave. `seconds?`: how long it plays. `peaks?`: up to 64 numbers from 0 to 1, how loud each equal slice of it is, the loudest 1. Both come from `data.sound`, and the content check holds each to that: they are values the item holds.
- **Drawn as** the title on up to two lines, then a strip 40 px tall: a round play mark 32 px across in the accent, the waveform, and the length. The waveform takes the room the mark and the length leave, 10 px from each, and is 24 px tall: one bar for each peak, as tall as its peak and at least 1.5 px, set about the middle line, every bar as wide as the others with a gap of half a bar after it, stretched to fill the room. With no peaks it is a flat line 1.5 px thick. The length is `seconds` rounded to a whole second and written as a clock writes it, `m:ss` under an hour and `h:mm:ss` from an hour, such as `0:20`, `42:00` and `1:02:05`, in meta with figures of one width, and it is left out with no `seconds`. Under the strip go the first whole lines of the transcript the face has room for. The play mark is a mark and no control: a press on the card opens it, as on any card. The opened card has the player, and when there are peaks the waveform 56 px tall over it, which fills with the accent as the recording plays, and a press on it plays from that point. Under the player go `item.text` whole, trimmed, with its line breaks, so every word that was heard is there once. With no `src` the opened card says so in the fixed words.
- **Item holds.** `source.asset`, the file a person dropped, or `data.mediaUrl`, the address a source gave, such as a podcast episode. `data.sound = { seconds, peaks? }`: for a dropped file the client measured both, and a source may give the length alone. `text`: the transcript, which may be empty when transcription failed, or what a source wrote of the recording. Intake describes a transcript as it describes a text, so `data` may also hold a date, a place or people for the chips.
- **Measured when dropped.** The service never decodes sound. A client that drops a recording decodes it once and sends `sound` with the dump: `seconds` is the decoded length to the millisecond, and `peaks` is 48 numbers, the loudest sample of each of 48 equal slices over every channel, each divided by the loudest of the 48 and rounded to two places, or all 0 for silence. The web client decodes at 8000 samples a second, which keeps the loudness of a voice and is quick for an hour of sound. A file the client cannot decode is sent with no `sound`, and Intake files it by name as a `file`, because it would not play in that client either.

### link

A web page preview.

- **Chosen when** the item's kind is `link` and `source.url` exists.
- **Props.** `url`. `site`: from `data.site`, else the host name. `description?`: the item's summary. `image?`: from `data.image`.
- **Item holds.** `source.url`.

### chart

- **Chosen when** `item.data.chart` holds at least two labels and as many values and is no breakdown, or the model finds several comparable numbers in a text item.
- **Props.** `chart`: `bar` or `line`. `labels`. `values`. `unit?`. `mark?`: index of a bar or point to call out, not set today. `above?`. `heads?`: the heads row of the table the points come from, drawn over the plot.
- **Drawn as** a designed preview on the small face: the shape of the bars or the line with no text, the marked one in the accent, over one meta line that counts the points with the first and last labels. No label or value of a chart reads at the face's sizes. The opened card draws bars or a line over gridlines, with a scale down the left side. Numbers on the scale and on the plot are written short, to three figures, such as `1.61M` and `0.004`. The marked bar or point is brighter and always carries its value. Every value is written that fits above its own bar or point. With six bars or points or fewer, every label is written, cut to the width of one bar's step less 6 px. With more, when the labels do not fit side by side, every nth label is written, the marked, first and last ones before the rest, and a label longer than 44 px may be cut. When the plot had to thin, cut or round anything, the opened card adds a table of every label with its full value. With no values it says `No data`.
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
- **Drawn as** the title, then the messages as bubbles, yours on the right, each whole on up to two lines, as many as the face has room for, and the cue counts the rest. The opened card shows up to 40 messages in full and the source below them.
- **Item holds.** `data.messages = [{ role, text }]`.

The excerpt is the first user message, the longest assistant reply, and the user message just before that reply. System messages are left out.

### code

- **Chosen when** `item.data.code` holds a source, or the item's kind is `code` and its text is not empty.
- **Props.** `language`: `text` when unknown. `source`.
- **Drawn as** the title over one meta line that says how many lines the source has and in what language, `24 lines of Python`, unless the language is `text`. A line of source at the face's size holds about 18 characters, so the small face shows none. The opened card has the source whole in a fixed-width face.
- **Item holds.** `data.code = { language?, source? }`, or the code as `text`.

### steps

An ordered list of short steps.

- **Chosen when** `item.data.steps` holds two or more steps, or the model finds an ordered procedure in a text item.
- **Props.** `steps`: the steps in order, without numbers or bullets.
- **Item holds.** `data.steps = string[]`, or the procedure inside `text`.

### facts

Two to six figures about one thing, each with its label.

- **Chosen when** `item.data.facts` holds two or more facts that each have a label and a value, no value is over 60 characters, and they pass the coverage floor.
- **Props.** `facts`: the first six, each `{ label, value }`. `more?`: how many further facts the item holds. `above?`. `heads?`: the heads row of the table of two columns the facts come from, such as `Metric` and `Change`. Under it the card sets each figure beside its label, one to a row, so a value such as `▼ 12%` reads under `Change`.
- **Drawn as** the title, then the figures two to a row on a fact's darker face, each over its label in meta, a row at a time, as many rows as the face has room for. Every figure of a card is set in one size, so no card mixes two sizes of figure. Two figures share a row when both fit half of it at the middle size, and a longer one has a row of its own. The card steps down to the smallest size when a value needs more than a line at the middle size, where a long value wraps on whole lines. A value is never cut: one too long for the room the face leaves shows the whole lines that leave a line of its label, and the cue says there is more. The cue counts the facts the face leaves out, and the opened card lists every fact in `item.data.facts`.
- **Item holds.** `data.facts = [{ label, value }]`.

### table

Rows and columns.

- **Chosen when** `item.data.table` holds at least one row, and it passes the coverage floor.
- **Props.** `heads`: one string for each column, and at least two. `rows`: at least one, and each row has one cell for each head, and a cell may be empty. Every row is in the props. The client shows what fits.
- **Drawn as** a designed preview on the small face: the title, then the heads in meta as far as they stand whole on a line with a count of the rest, and the cue, which counts the rows, `12 rows`. No cell of a table reads at the face's sizes. The opened card has every cell, with words whole, under heads that stay in place and wrap on whole words. A column of numbers is set to the right, and a number is never wrapped, so it is never cut. It scrolls both ways inside its own box. Each column is at least as wide as the widest of its first twenty cells, up to 220 px, so a table of many columns scrolls sideways and no cell is squeezed to a word a line. An opened card keeps its scroll place while other cards arrive: a client redraws an opened card only when its node or its item changed.
- **Item holds.** `data.table = { heads, rows }`.

### list

Entries in no particular order, or a checklist.

- **Chosen when** `item.data.items` holds two or more entries, none of them empty, and they pass the coverage floor. An ordered procedure is `steps`, which comes first in the table.
- **Props.** `items`: the entries. `checked?`: one mark for each entry, from `data.checklist` when it is as long as the entries.
- **Drawn as** the title, then the entries, each whole on up to two lines with a dot before it, as many as the face has room for, and the cue counts the rest. With `checked`, a tick box stands in place of the dot, filled and ticked when the entry is done, the done entries are dimmer, and the title carries a count such as `2/4`. A tick box shows a mark and takes no click. The opened card lists every entry whole. A line of `item.text` that starts with a bullet, a number and `.` `)` or `、`, or a tick box, and then with the entry followed by anything but a letter or digit, stands in for the entry in the opened card, so `- Her ration book from 1946 (two coupons still attached)` is written whole there and once.
- **Item holds.** `data.items = string[]`, and `data.checklist = boolean[]` for a checklist.

### breakdown

The parts of one whole.

- **Chosen when** `item.data.chart` is shares of one whole: at most eight values, none below 0, a unit of `%`, `％`, `percent`, `pct` or `百分比`, and a sum from 99 to 101. For what the user made it must also pass the coverage floor. Any other chart data is a `chart`.
- **Props.** `labels`: two to eight. `values`: one for each label, none below 0. `unit?`. `above?`. `heads?`: the heads row of the table the parts come from, its second head over the shares.
- **Drawn as** a designed preview on the small face: the title, one 16 px bar split into the parts by their shares, the largest in the accent, then the largest part as the item writes its label and its share, and the cue, which counts the parts. Never a pie. The opened card draws one line for each part: its label whole, a level bar as long as its part's share of the whole, so 45 percent fills 45 percent of the room and the bars together fill it once, and its share written whole at the end. A percent sign is written on each share. Any other unit is written once, over the bars, and each share of the total is written beside a value that is no percentage.
- **Item holds.** `data.chart = { labels, values, unit }`.

### qa

One question and its answer.

- **Chosen when** `item.data.question` and `item.data.answer` are both set, and they pass the coverage floor.
- **Props.** `question`. `answer`.
- **Drawn as** two voices. The question is set as a title beside a `Q`, and under a rule the answer is set as body text beside an `A`, each on the whole lines the face has room for. The opened card has both whole, and leaves out the `Q` and the question when the question is the item's title, which the opened card has just written.
- **Item holds.** `data.question` and `data.answer`.

### callout

A caveat or a remark set apart from the rest.

- **Chosen when** the model finds that a text item is mainly a warning, a caveat or a reminder the reader must not miss. No row of the rule table gives it. The stand-in service chooses one for a line that opens `Caution:`, `Warning:` or `Note:`, so clients can be built against it.
- **Props.** `text`: a whole passage of the item's own text. `tone`: `caution` or `note`.
- **Drawn as** a band down the left edge of the card in the colour of the tone, coral for a caution and grey for a remark, a glyph and the tone in words, then the text at the title's size on up to three lines. The tone is never amber, which is a pick's, or teal, which is a link's.
- **Item holds.** The passage inside `text`.

### excerpt

A passage of a longer source.

- **Chosen when** `item.data.excerpt` exists and passes the coverage floor, or the item is a page the Scout picked: an item the agents brought whose kind is `text`, that has an address, and whose text holds more than the closing line that says who made it and when.
- **Props.** `text`: the passage. For a page the Scout picked it is the item's whole text, which ends with a blank line and that closing line. `at?`: where the passage sits in its source, such as `Chapter 1`. `source?`: `data.site`, else `data.from`.
- **Drawn as** the passage in an upright serif beside a rule, on up to four lines, without the Scout's closing line. Under it, one meta line holds the item's title and `at` and `source`, without either when it is the title again. A quote is a person's words, and is set upright too, on a washed face under a quotation mark. The opened card has the whole passage with its line breaks, and under it `item.data.by`, the maker the Scout's closing line named, on a line of its own when the line of `at` and `source` does not hold it.
- **Item holds.** `data.excerpt = { text, at? }`, or the passage as `text`.

### definition

One term and what it means.

- **Chosen when** `item.data.term` and `item.data.definition` are both set, and they pass the coverage floor.
- **Props.** `term`. `definition`.
- **Drawn as** a dictionary entry: the term as a headword, large while it fits one line, over a short rule, then the meaning in an upright serif on up to three lines. The opened card has the meaning whole, under the term when its own title is not already the term.
- **Item holds.** `data.term` and `data.definition`.

### idea

A short thought.

- **Chosen when** the item is a phrase the user wrote out, as An idea above says.
- **Props.** None. The client draws `item.title`.
- **Drawn as** the title set large under a small spark, and nothing else. The size steps down as the thought grows, from the largest figure size on up to two lines, to the middle size on up to three, to the smallest on up to three. The rule table gives this card only to a phrase under 60 characters. A longer title, in a view sent straight to a client, shows its first three lines at the smallest size and the cue.
- **Item holds.** `title`, and `text` when it says the same.

### proscons

The points for and the points against.

- **Chosen when** `item.data.pros` and `item.data.cons` each hold at least one point, and they pass the coverage floor.
- **Props.** `pros`. `cons`. At least one of each. `heads`: the item's own heading or label for each side, as the item writes it, such as `For going now:` and `Against:`, or `好处：` and `坏处：`. `above?`.
- **Drawn as** a designed preview on the small face: the title, then each side as one row, its head in the title's weight running into its first point, so the sides are told apart by the item's own words. The card writes no sign of its own, and only a view with no heads names its sides `For` and `Against`. The cue counts both sides, `3 for, 2 against`, when either holds more than one point. The opened card lists every point whole under its head, each with a plain dot, one side under the other.
- **Item holds.** `data.pros = string[]` and `data.cons = string[]`.

### swatch

Colours with their names.

- **Chosen when** `item.data.colours` holds two or more colours, and they pass the coverage floor.
- **Props.** `colours`: each `{ name, value }`. `value` is a hex colour of 3, 4, 6 or 8 digits after its `#`, or a CSS colour name of 1 to 30 letters from `a` to `z` in either case, and nothing else, so it is safe to paint. `name` equals `value` when the content gave the colour no name.
- **Drawn as** a band of up to twelve of the colours across the top of the card, then the title, then a row for each colour the face has room for: a small round dot of the colour, its name, and its value whole at the right in meta, or the value alone when the colour has no other name. The cue counts the rest. No word is set on a colour, so every word reads on any of them. Each dot, and each chip of the opened card, is edged by a black hairline inside and a light grey one (`#b0b0aa`) outside, so its edge holds 3 to 1 whatever its colour: a colour of luminance 0.1 and up against the black, any darker one against the grey, and the grey against every face of a card. A value the client cannot paint leaves hatching in its place. The opened card lists every colour.
- **Item holds.** `data.colours = [{ name, value }]`.

### artwork

A work to look at, with what its collection records.

- **Chosen when** `item.data.kind` is `artwork` and the item has a picture: itself when its kind is `image`, a recording's `data.thumbnailUrl`, or a page's `data.image`. This is the first row of the table, so a museum's work is never a plain image.
- **Props.** `src`: the picture. `maker?`: from `data.by`. `date?`. `medium?`. `holder?`.
- **Drawn as** the work whole on a 6 px mat, never cropped. The mat is a shade lighter than the card's face, kept or pick, and has a hairline under it, so it reads as a mount and never as a hole in the field. Under it is a plate with the title on up to two lines. A plain image fills its frame and has one caption. The opened card has the picture and the lines of the label whole: the maker and the date, the medium, and the holder, without the holder when its list of sources names it.
- **Item holds.** `data.kind = 'artwork'`, with `data.by`, `data.date`, `data.medium` and `data.holder` as the Scout copied them.

### reference

A paper or a book.

- **Chosen when** `item.data.kind` is `paper` or `book`.
- **Props.** `kind`. `authors`: `data.authors`, else the one name in `data.by`, and it may be empty. `more?`: true when `data.authorsCut` is true and `data.authors` holds at least one name, so the list names only some. It is never set beside the one name from `data.by`. `year?`: the four-digit year in `data.date`. When there is none, the card writes `item.data.date` as it stands, trimmed, in the year's place, so a date such as `late 19th century` is not lost. `venue?`. `url?`: the item's address.
- **Drawn as** a library card: `Paper` or `Book` and the year over a rule, then the title on up to two lines, and the first author with how many others, `A. Vaswani and 7 others`, or `and others` when the list was cut. The opened card has the kind and the year, and the authors and the venue whole when its list of sources does not say them in the same words. A list of authors that was cut is always written, because only that line says `and others`.
- **Item holds.** `data.kind`, with `data.authors`, `data.authorsCut`, `data.venue` and `data.date`.

### place

A place by name.

- **Chosen when** the item is a short note whose title names the place in `data.where`, as A place above says.
- **Props.** `name`: `data.where`. `src?`: the item's picture, from `data.image`.
- **Drawn as** the name set large beside a round pin. When `item.data.at` is a point, a map 210 by 88 px with one pin and the provider's credit runs under it to the face's edges, as Maps says. Otherwise the item's summary or text is under the name on the whole lines the face has room for. The opened card has the picture whole when there is `src`, a larger map, and the name when neither its own title nor the `Where` of its list of sources is already the name.
- **Item holds.** `data.where`, `data.image` for a picture, and `data.at` for the map.

### sheet

A card assembled from parts, for an item with more than one kind of thing worth seeing that no card of its own covers: a long note's opening beside its key figures, a list of what was decided, a small table, or a line someone said.

- **Chosen when** the model answers `sheet` and its sections pass the steps under A sheet in The model. No rule gives it. The stand-in service assembles one from a text whose first line is its heading, with a sentence and lines that each set a figure or a list after a label, as in `Cost: €240` and `Best: the bridge; the bookshop`.
- **Props.** `sections`: two to four, in reading order, a heading counted. At most one is a heading, and it comes first. At least two are no heading, and at least one is no text. Each has a `kind`:
  - `heading`: `text`, a few words of the item that name it, at most 80 characters.
  - `text`: `text`, a whole passage of the item or its opening words cut short with an ellipsis, at most 280 characters.
  - `figures`: `facts`, one to four `{ label, value }`, each label at most 40 characters.
  - `list`: `items`, two to eight entries.
  - `table`: `heads` and `rows`, two to four columns and one to five rows, each row with one cell for each head.
  - `picture`: `src`, the item's own picture.
  - `excerpt`: `text`, words the item quotes, whole and at most 400 characters or 200 in a script written without spaces, and `by?`, who said them or where they stand.
- **Drawn as** one card of the family, not a stack of small cards. Its small face is the plain face of a note with one title, the heading, or the item's title when there is none, and under it its first part as that part's own card previews it: the text as a note's text, figures as a facts card sets them, entries as a list sets them, a table's heads and the count of its rows, or words someone said in the upright serif over who said them. The part's own label stands over it. The cue counts the other parts, a picture among them. The opened card has the picture whole, then the heading when the opened card's title is not already it, whatever the case and the white space, then each part whole, in order: a text cut short with an ellipsis is given whole, as the rest of the line of the item's text that it begins; figures as a list of each label beside its value; the list with each entry as the item's text writes it, as an opened list has it; the table as an opened table has it; the words someone said with their line breaks, and who said them. The rule for the opened card then prints only what of the item's text the parts leave unsaid.
- **Item holds.** The words the sections are taken from, in `title` and `text`, and the picture for a `picture` section.

### explorable

A card a reader changes to see how a concept works: a dolly zoom shot three ways, or the field of view as the focal length changes.

- **Chosen when** the model answers `explorable` for an item that relates quantities or contrasts states, and the card passes the checks in The model. No rule gives it. The stand-in service makes one of two forms. A text whose lines after the first are two to four of a name, a colon and a sentence that ends with a stop, as `Zoom only: the lens zooms in….`, gives a toggle for two and a segmented control for more, labelled by the first line, and each state's text is its whole line, the name and colon included, because a card shows only whole units of its item. A text with a formula in backticks that names one quantity, as `` `2 * atan(18 / f) * 57.2958` ``, gives a slider when it names the quantity and its unit as in `for a focal length f in mm`, names the result as in ``the field of view is `…` ``, and has two or more sentences that each write a value and its result, as `At 24 mm the field of view is 73.7°.`. Its slider runs from half the least value to half as much again as the most.
- **Props.** `controls`, one to three, and `output`. Either every control is a `toggle` or a `segmented` and `output` is `{ kind: 'text' }`, or every control is a `slider` and `output` is a `figure` or a `chart`.
  - `toggle`: `label`, and `states`, exactly two `{ name, text }`.
  - `segmented`: `label`, and `states`, two to four `{ name, text }`. The names of one control differ. A label and a name are at most 40 characters, and a text is at most 400 characters, or 200 in a script written without spaces.
  - `slider`: `name`, the quantity it sets in the formula: a letter, then up to fifteen letters, digits or `_`, and no name the language below gives a step. `label`, `unit?`, and `min`, `max` and `step`, where `min < max` and `(max - min) / step` is a whole number of at most 1,000. The value at step n is `min + n * step` rounded to twelve significant digits. `values` are two to eight values the item states, each between the ends and on a step.
  - `output` for sliders: `kind`, `figure` or `chart`; `label`; `unit?`; `formula`, a program in the language below, which reads the sliders' names and no other, each slider with its own; and `values`, the results the item states, as many as each slider has values. The nth result is the item's at each slider's nth value.
- **The formula language.** A formula is written in a closed language and carried as a program, so a client steps through a list and never runs anything the model wrote. `src/core/formula.ts` reads the written form, and a client only evaluates programs.
  - The written form has numbers (`12`, `0.5`, `.5`, `6e-3`), names (a letter or `_`, then letters, digits or `_`), `+ - * / ^`, round brackets, commas between arguments, and seven functions: `min` and `max` of two or more arguments, and `round`, `sqrt`, `exp`, `ln` and `atan` of one. White space is passed over. Nothing else is read, and a formula over 300 characters is refused. `^` binds tightest and to the right, then a sign before a value, then `*` and `/`, then `+` and `-`, each of those to the left. So `-2^2` is -4 and `2^3^2` is 512.
  - The program is a list of numbers and strings in postfix order. A number pushes itself. Each of `+ - * /` and `^` takes two values off the stack, the one pushed last on its right, and pushes its result. `neg` takes one and pushes it negated. `min` and `max` take two and push the lesser or the greater, so a `min` of three is two `min` in a row. `round`, `sqrt`, `exp`, `ln` and `atan` take one. Any other string pushes the value of the slider of that name. One value is left at the end, the result. `2 * atan(18 / f) * 57.2958` is `[2, 18, "f", "/", "atan", "*", 57.2958, "*"]`.
  - In IEEE doubles. `round(x)` is `floor(x + 0.5)`, and `atan` is in radians. A result has no value where any step has none: a division by zero, the root of a negative number, the log of a number not above zero, a power with no real value, a name that is no slider, a step short of its arguments, or any step whose result is not a finite number. So `1 / (1 / f)` has no value at `f = 0`.
- **Written values.** A number is written with a comma between thousands and a fixed number of decimals, and its unit after it: after a space when the unit starts with a letter or a digit that is not of a script written without spaces (U+3040 to 30FF, U+3400 to 9FFF, U+AC00 to D7AF), and straight after it otherwise, as in `50 mm`, `39.6°`, `45%` and `50毫米`. A value has as many decimals as its shortest form in JavaScript has after its point, at most six. Where every slider stands on the values the item states together, the result is the value the item states there, written with its own decimals. Anywhere else it is the formula's value, with as many decimals as the most any stated result has, and it is computed. Where the formula has no value it is `–` (U+2013).
- **Drawn as** a plain card. Under a mark of two sliders and the word `Explore`, or `可探索` on a Chinese card, in small capitals, the title, then what the controls change: the first state's words for an output of words, else the output's label, on up to two lines. The cue counts the controls, `2 controls`. Nothing on the card takes a click: a drag on the field moves the card, and the opened card has the controls.
- **The opened card** has every control working, and over them, for sliders, what they change. A control's label is written over it unless it is the item's title. A segmented control is a row of radio buttons with the chosen one filled, which the arrow keys move along, Home and End to the ends. A toggle is a switch that names the state it is in. A slider is a range input, with its value and unit beside it, that the arrow keys move a step at a time. Each is at least 44 px tall and fits the opened card's width. The text of every state is in the view and only the chosen state's shows, so the rule for the opened card prints none of them again. A result is written large, with `computed` (`计算值`) after it when it is computed, over its label and, for a chart, the curve 300 by 150, scaled to the width, with the ring moving as the slider does.
- **Item holds.** `title` and `text`, which state each state's text, each slider's values and each result.

## Composites

A composite groups siblings under one parent. These rules hold for all of them.

- Kept nodes group only with kept nodes. Picks group only with picks. A composite never mixes the two.
- A node belongs to at most one group.
- A composite needs at least 3 members. A comparison or a beforeafter needs 2 to 4, a matrix exactly 4, and a layout 3 to 12.
- No group is the usual answer. Most siblings stay ungrouped.
- A group whose members are unchanged is left alone and keeps its id. When membership changes, the old group is removed and a new one with a new id is set in the same change set.
- When the user keeps one pick from a group of picks, the group no longer holds. The Renderer removes it on its next pass.
- No card is drawn larger or smaller inside a group than outside it. An arrangement places cards. It never scales them.

The service holds every group to these rules. It refuses a `setGroup` whose composite it does not know, whose props its schema does not take, whose member count is outside the bounds above, that mixes picks with kept cards, or that names a node another group already holds. Setting a group again under its own id is how a group is changed.

**Plain-code arrangements.** Six arrangements are made by plain code, from one ordered table in `renderer.ts`: `map`, `overview`, `moodboard`, `gallery`, `timeline`, `stack`. Each looks at the siblings no group the model made has taken, and an earlier one goes first. An earlier one may take a sibling out of a group a later one made, and that later group is then made again from what is left, or removed. A plain-code group whose rule no longer holds, such as an overview after a second chart arrives, is removed. The stack runs after the model's groups are made, so it piles only what no group took. The others run before the model is asked.

The model is asked about a parent only when changed siblings are among at least 4 ungrouped ones, or when a sibling's `why` hints at structure (words such as "alternative", "versus", "step 2"). It may propose `timeline`, `comparison`, `sequence`, `cluster`, `ranked`, `beforeafter`, `lead` and `matrix`, and `layout` last, only when none of those fits.

**Words the model sets beside a member.** A ranked member's reason and the change between two states must each be a whole sentence or a whole line of the member's content, as the content check's `whole` reads it, and at most 140 characters, or 70 in a script written without spaces. The content is the member's title, text, summary and `data.when`. A reason is read against its own member, and a change against either of the two states it joins. One that fails is left empty, and the group still stands. A matrix member's line is held to the same rule as a ranked reason. A matrix's axis name is at most 32 characters and must be words, as `says` reads them, of at least two of its four members. A matrix whose axis name fails is not made.

**Layout.** In every arrangement `PAD = 18` is the frame's padding on the left, right and bottom, and `HEAD = 40` is the band at the top that holds the frame's kind and title. The frame has a 1 px border, and every position on this page, of a card or of a mark such as a label, an axis or an arrow, is measured from the frame's outer edge, so a client that places marks inside the border moves them 1 px up and left. Cards are placed by their drawn size, which is a pick's footprint times 0.86. A line of words an arrangement sets beside a card is drawn at the text size, without kerning, and is given `wrap(words, floor(width), 72, no limit)` lines of 17 px: the same count the structured cards use, so it is never cut. Arrangements that set words this way are `ranked`, `beforeafter` and `matrix`.

### gallery

Pictures and clips side by side.

- **Chosen when** 3 or more siblings are drawn as `image`, `video` or `artwork`. Plain code.
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
- **Drawn closed as** the first member with the edges of up to two more behind it, each 7 px further down and to the right. The block is sized from the first member's drawn size alone. Each member behind it is drawn at the first member's drawn size with its content hidden, so a taller or wider card behind a smaller one shows only that edge. A fourth member and any after it are not drawn.

### ranked

Picks that each answer one question, best first.

- **Chosen when** the model finds 3 or more picks that answer the same question. Never for kept cards.
- **Props.** `reasons`: a map from member node id to one line of why it stands there. An empty string means none.
- **Members.** Best first.
- **Drawn as** the members side by side, 16 px apart, under a band 30 px tall that holds each one's number, 1 first, in a 22 px circle at its card's left edge. The first number is filled. Each reason sits 8 px under the row of cards, at its card's left edge and as wide as the card, so all reasons start on one line. The frame is `HEAD + 30 + tallest card + PAD`, and with any reason `8 + 17 * (the most lines any reason takes)` more.

### beforeafter

One thing in two to four states, in order, with the change that led to each named between them.

- **Chosen when** the model finds members that are one thing at different times or in different states.
- **Props.** `changes`: a map from each member after the first to the change that led to it. An empty string means the arrow stands alone.
- **Members.** In order, earliest first.
- **Drawn as** the members side by side, with a step 148 px wide between each two. A step holds an arrow on a line of 24 px and, under it, the change, centred, in a column of 124 px. A step is as tall as `24 + 17 * its lines` and sits in the middle of the shorter of the two cards it joins, or from the top of the row when it is taller than that card. The frame is `HEAD + PAD` plus the tallest card or the lowest step bottom, whichever is more.

### lead

One member that the others support, explain or give evidence for.

- **Chosen when** the model finds such a member among 3 or more.
- **Props.** None.
- **Members.** The lead first, then its support in sibling order.
- **Drawn as** the lead alone on the first row, and its support in rows of up to 4 beneath it, 16 px apart. The space between the lead and the first support row is 28 px, with a hairline across its middle. A row is as tall as its tallest card rounded up to a whole px. The block's inner width is the wider of the lead and the widest row, and the lead and each row are centred in it.

### overview

Figures in a row above one chart.

- **Chosen when**, among the siblings no group has taken, exactly one is drawn as a `chart` or `breakdown` and two to five as `fact` or `facts`. Plain code. Every one of them goes in.
- **Props.** None.
- **Members.** The figures in sibling order, then the chart last.
- **Drawn as** the figures side by side, 12 px apart, and the chart under them at the left, 12 px below the tallest figure rounded up to a whole px. The block is as wide as the wider of the row and the chart.

### moodboard

Pictures, swatches and ideas, packed in columns, each at its own size.

- **Chosen when**, among the siblings no group has taken, four or more are drawn as `image`, `video`, `artwork`, `swatch` or `idea`, at least two of them are pictures (`image`, `video`, `artwork`) and at least one is not. Plain code. Every one of them goes in. Pictures and clips alone are a gallery, so a gallery that gains an idea becomes a moodboard.
- **Props.** None.
- **Members.** In sibling order.
- **Drawn as** columns: 2 for up to 4 members, 3 for up to 9, 4 past that. Take the members in order and put each under the column whose height so far is least, the leftmost of equals. A card adds its height rounded up to a whole px and 12 px to its column. A column is as wide as its widest card rounded up, and columns are 12 px apart. Each card sits at the left of its column.

### matrix

Four members on a 2 by 2 with two named axes, each with a line of why it sits in its corner.

- **Chosen when** the model finds 4 members that differ along two measures.
- **Props.** `x`: the name of the measure that grows to the right. `y`: the one that grows upwards. Each 1 to 32 characters. `reasons`: a map from member node id to one line of why it sits in its corner. An empty string means none.
- **Members.** Exactly 4, in the order top left, top right, bottom left, bottom right.
- **Drawn as** a grid of two columns and two rows, 20 px apart. A member's line sits 8 px under its card, at the card's left edge and as wide as it, so a member stands `card height + 8 + 17 * lines` tall, or its card height with no line. A column is as wide as its wider card and a row as tall as its taller member, each rounded up to a whole px, and each card and its line sit together in the middle of their cell. A hairline runs down the middle of the gap between the columns and across the middle of the gap between the rows. The grid starts `PAD + 24` from the left, which leaves a gutter for the upright axis, and `HEAD + 23` from the top when `y` is set, which leaves a line of 17 px and 6 px for its name. The upright axis runs up the middle of the gutter from 9 px under the grid to the grid's top, with an arrowhead there, and `y` is set above it at the left. The level axis runs from the same corner to the grid's right edge, with an arrowhead there, and `x` is set 18 px under the grid, ending at the grid's right edge, or starting at `PAD` when it is wider than the gutter and the grid together. Each name is one line `textWidth(name)` wide. The block's inner width is the most of `24 + grid width`, `textWidth(x)` and `textWidth(y)`, and its height is `grid bottom + 18 + PAD`, and 17 more when `x` is set.

### map

Members at two or more places, on a map with a numbered pin for each place, and beside it in pin order.

- **Chosen when**, among the siblings no group has taken, 3 or more have `item.data.at` that is a point on the earth, as Maps reads it, and they stand at 2 or more places. Plain code, first in the table, so photos that carry where they were taken are a map before they are a gallery or a moodboard, and dated, located notes are a map before they are a timeline. Every located sibling goes in. Three photos taken at one place are no map, and the rules after it take them.
- **Props.** `centre`: `{ lat, lon }`, the point at the middle of the map. `zoom`: a whole number from 0 to 14. `pins`: 2 or more of `{ lat, lon, members }`, in order, where pin `n + 1` is `pins[n]` and `members` are the node ids at its place. The service fits `centre` and `zoom` for a map of 400 by 320 px, so a client draws the map at that size.
- **Members.** In pin order: the members of pin 1, then of pin 2, and so on. The members are first put in date order when every one of them has a `data.when` the timeline can read, and in sibling order otherwise, and the pins are numbered in the order their first member comes.

**Fitting the map.** `src/core/map.ts` holds the rule. Each point is placed on the world's map as a share of its width and height, `x = (lon + 180) / 360` and `y = 0.5 - ln((1 + sin φ) / (1 - sin φ)) / (4π)`, as in Maps. The zoom is the largest from 14 down to 0 at which the points' extent, `(max x - min x) * 256 * 2^zoom` across and the same down, is at most `400 - 2 * 24` px across and `320 - 2 * 36` px down, and 0 when none is. This leaves 24 px at each side and 36 at the top and the bottom, so a pin's head and the credit stay on the map. The centre is the middle of the extent, `x = (min x + max x) / 2` and the same for `y`, turned back into degrees, `lon = x * 360 - 180` and `lat = atan(sinh(π (1 - 2y)))`, each rounded to 6 decimal places. Then, in member order, each member joins the first pin less than 28 px from its point at that zoom, measured straight across, or starts a new pin at its own point. So pins are at least 28 px apart, a pin stands at its first member's point, and two photos on one street share a pin on a map of a whole country. At zoom 14 a place is about 200 m across at the latitude of Lisbon, which is what makes several photos taken around one square one place. A map that crosses the line of 180° longitude is fitted the long way round.

- **Drawn as** the map at the top left, 400 by 320 px at `(PAD, HEAD)`, with corners of 12 px and a hairline round it, drawn as Maps says from `centre`, `zoom` and the pins, in the tree's colour, or amber for picks, with each pin's number in its head and the provider's credit in the bottom-right corner. The members sit 24 px to its right, in rows of 2, or of 3 when there are more than 4, left to right and then down. A column is as wide as the widest member's drawn width rounded up to a whole px, and the columns are 16 px apart. Each row has a band 30 px tall above its cards that holds each member's pin number, in a filled 22 px circle at the top of the band at the card's left edge, and its cards sit at the top left of their cells under the band. A row is `30 + its tallest card rounded up` tall, and the rows are 16 px apart. The block is `PAD + 400 + 24 + columns * column + (columns - 1) * 16 + PAD` wide, where `columns` is the number in the first row, and `max(HEAD + 320, the last row's bottom) + PAD` tall. With maps off, or when the tiles fail, the map is the plain ground with its numbered pins, and with maps off it has no credit.

### layout

Members set out by a structure the model describes, when no arrangement above fits: rows, columns and grids, nested up to 4 deep. The model describes structure only. Every position comes from the members' footprints by the rule below, which `src/core/layout.ts` holds and the web client runs as the built copy `client/js/core/layout.js` (`scripts/layout-js.ts` builds it, and `npm test` fails while the copy is stale).

- **Chosen when** the model proposes it, last of the arrangements it is offered and only when none of the others fits. The stand-in Renderer of `npm run dev:fake` proposes one for kept siblings whose titles open with a facet, as `Eat: grilled sardines` and `See: Tram 28 at dawn` do: a row with one labelled column for each facet that two siblings or more open with. Siblings with no shared facet stay out.
- **Props.** `tree`: the outermost container. A part is a member, `{ kind: 'card', id, role }`, where `id` is the member's node id and `role` is `lead`, `normal` or `minor`, or a container, `{ kind, label?, join?, children }`, where `kind` is `row`, `column` or `grid`, `label` is 1 to 40 characters, `join` is `arrow` or `line`, and `children` holds at least one part. A tree holds 3 to 12 members, each once, and at most 8 containers, and no member sits under more than 4 containers. `isValidGroup` refuses any other tree.
- **Members.** In the order the tree is read: in each container, its lead first, then its other parts in order, then its minors.

**What the model gives.** The model's reply schema cannot nest, so it gives `parts`, a flat list in which every part names the container it sits in. A part has `id`, `parent`, `kind` (`card`, `row`, `column` or `grid`), `role`, `label` and `join` (`none`, `arrow` or `line`). A card's `id` is a member's node id. A container's `id` is any name the model makes up. The outermost container has `parent` `""`. The children of a container are the parts that name it, in the order they come in the list. The Renderer turns the list into a tree, and sets the group aside with a note in the work log when:

- two parts share an id,
- a card is not one of the siblings the model was asked about, or is in another group,
- there are more than 12 members, fewer than 3, or more than 8 containers,
- a part names a parent that is not there, or a card,
- there is not exactly one outermost part, or it is a card,
- containers name each other in a loop, so some part cannot be reached from the outermost one,
- or containers nest more than 4 deep.

A container with no parts is dropped. A `join` on a grid is dropped, because a grid's neighbours have no order. A label then stands only when one member under its container states the label, or when every member under its container states each of its words, by the matcher in `grounding.ts` reading the member's title, text, summary and `data.when`. A label longer than 40 characters, or one that does not stand, is dropped. Last, the tree is collapsed: a container that holds one part and has no label is replaced by that part, from the innermost up, so a card wrapped in three bare containers sits directly in the nearest labelled one.

**Placing.** Positions are worked out bottom up, each part in a room of the width it may take, in px from the top left of the block's content. The block's frame is then the content with 18 px on each side, 40 px above for the head and 18 px below, as for every arrangement. The spacing is:

```
GAP    = 12    between parts, and between lines
JOINED = 44    between the parts of a row or a column that has a join
LABEL  = 24    the line a label takes above its container's parts
INSET  = 10    the inset of a labelled container's frame, on each side
ROOM   = 1100  the width the outermost container may take
```

- A **card** takes its footprint with each side rounded up to a whole px. The card is drawn at its own footprint at the top left of that room, and never scaled.
- A **container** gives its parts `room - 2 * inset`, where `inset` is `INSET` for a labelled container that is not the outermost and 0 otherwise. `step` is `JOINED` when it has a join and `GAP` otherwise. Its parts are taken in reading order: its first lead, then the rest with each minor moved to the end. A second lead is drawn as a normal part.
- A **row** lays its lead, when it has one, alone on the first line. It lays the rest left to right, `step` apart, top aligned, starting a new line before a part that would take the line past the room. Lines stack `GAP` apart, each as tall as its tallest part. The row is as wide as its widest line.
- A **column** stacks its parts top to bottom, `step` apart, left aligned. With a lead, the lead stands alone at the top left, and the rest stack in a second column `GAP` to its right, in the room left beside it. The column is as tall as the taller of the two.
- A **grid** lays its lead, when it has one, alone on the first line, then the rest in rows of `columns` cells, the lines `GAP` apart. A cell is as wide as the widest of the rest and a line as tall as its tallest part, and each part sits at the top left of its cell. `columns` starts at 1, 2 or 3 for 1, 2 or 3 parts, 2 for 4, and 3 for more, and drops by one while `columns * cell + (columns - 1) * GAP` is wider than the room. The grid is as wide as the wider of its lead and its cells.
- A **labelled** container makes itself at least as wide as `textWidth(label)`, moves its parts down by `LABEL` and both ways by `inset`, and adds `2 * inset` to its width and `LABEL + 2 * inset` to its height. Its label sits at `(inset, inset)`, as wide as its content and `LABEL` tall, in the text face, on one line. A labelled container other than the outermost draws a frame over its whole size.
- A **join** sits in each gap between neighbours on one line of a row, and between neighbours in a column, never from one line to the next and never beside a lead. In a row it fills the gap's width and is as tall as the shorter neighbour, from the line's top. In a column it fills the gap's height and is as wide as the narrower neighbour, from the column's left. An `arrow` draws → or ↓ in its middle, and a `line` a hairline across it.

No part's room overlaps another's, and every mark sits in the gaps or above the parts, so nothing overlaps by construction. `test/layout.test.ts` places 5,000 generated structures and checks it.

**The shape check.** After placing, the block is drawn as a `cluster` of the same members, labelled `Cluster`, unless its content is at most 1100 px wide and 1000 px tall, at most 4 times as wide as tall, at most 1.5 times as tall as wide, and the cards fill at least half of it. The fill is the cards' footprints added up, over the content's area less each label's line and each frame's inset ring, `w * h - (w - 20) * (h - 20)` for a frame of `w` by `h`. Labels and frames take that room by design, so a hole counts against the fill and a frame does not. A tree that names a card that is not a member, or leaves a member out, is drawn as a cluster too.

The limits were set from 30 structures written the way the model writes them, over real footprints: facets side by side, a lead and its support, steps joined by arrows, labelled sets in sets three and four deep, a single column, a long row, and three sheets side by side. Each was drawn and judged by eye. The three judged plainly ragged, with a large hole beside a tall card or a part left alone on a wrapped line, have a fill of 0.38, 0.46 and 0.48. Every other one has 0.52 or more, so the threshold is 0.5. Two of those, nested three and four deep, leave a hole under a shorter column and still pass at 0.52: the threshold does not catch every hole in a nested block. Counting the frames' room as empty instead put all four structures three and four deep below 0.5, though two of them looked right. A single column of five notes passed every other limit at 1.95 times as tall as wide, and a column of four at 2.29, so a block may be at most 1.5 times as tall as wide. With these limits 23 of the 30 are drawn as laid out.

## Adding to a library

Add the schema to `COMPONENTS` or `COMPOSITES` in `src/core/views.ts` and a check to `CHECKS`, add a rule or a model option in `renderer.ts`, add a test in `test/renderer.test.ts`, and add a section here and a line under Each type. For the web client, add a module to `client/js/components/` or `client/js/composites/`, list it in that folder's `index.js` in the order of `views.ts`, and add a sample to `client/library.html`. A component module lays its face out with `lay` and gets an entry in `CHIPS` in `library.html`, so it is opened once with its sources. Add at least four samples to `test/footprints.json`, one of them in Chinese and one at each limit its face has, run `scripts/footprints.ts` to fill in their sizes, and run `scripts/faces.ts` to see every face drawn and checked in a browser. For a structured type, add a sample to `src/core/samples.ts` and run `scripts/samples.ts`, which writes the file the library page draws from, and add a run of samples to `test/client-types.test.ts`. `npm test` fails when a component in `views.ts` lacks its client module, its content check or either part of this page. `isValidView` and `isValidGroup` reject anything a schema does not describe, so the client can trust the props it receives.
