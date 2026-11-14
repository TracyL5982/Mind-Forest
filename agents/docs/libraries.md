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

- Each component is one module, `client/js/components/<type>.js`, that exports `size`, `draw`, `detail` and `shows`. `detail` draws the opened card, and for the types that count rows it draws every row the card left out. Each composite is one module in `client/js/composites/`. The `index.js` in each folder is the registry.
- `size(item, props)` is the card's footprint in px. It is worked out from the content and never measured, so the field can be laid out before anything is drawn. The next section gives the rule. The registry adds 28 px to the height of a card that has chips.
- `shows` lists the chip sources the type already draws, as `item.data` keys. See Chips.
- Text on the field is set in three sizes, named `--type-display`, `--type-title` and `--type-text` in `client/style.css`. A figure that is too long for its card steps down to a middle size, then to the title size. A fact's value, a row of facts, an idea, a term and a place name are figures.
- Each type has its own face, so types can be told apart when zoomed out. A note is plain. A quote is a serif on a face washed with the tree's colour. A fact is one large figure on a darker face. A picture or clip has tight corners and its caption on a plate below. A link sits under an address bar. A chart has gridlines and a scale. A person has a round face beside the name. A chat is speech bubbles. Code is fixed-width with a numbered gutter. Steps are numbers down a rail. Facts are figures two to a row on a fact's darker face. A table is ruled rows with numbers set to the right. A list has a dot or a tick box before each entry. A breakdown is level bars with a share at the end of each. A question and its answer carry a `Q` and an `A`. A callout has a band down its left edge. An excerpt is an upright serif beside a rule. A definition is a large headword over a short rule. An idea is large words under a spark. Pros and cons are two columns of plus and minus marks. A swatch has a band of its colours across the top. An artwork sits whole on a dark mat over a label. A reference has its kind and year over a rule. A place has a round pin beside a large name.
- A card's marks take its tree's colour. While the card is a pick they are amber, its border is dashed and its face is darker. A pick's face is never see-through.
- Amber is also the three dots on a card the agents are working on. Teal is the links between cards, and the ring on the card that a dragged card would land under. No card type uses either for anything else. A caution callout is coral, and a remark is grey.
- Every card has corners of 12 px, and 4 px when it leads with a picture: an image, a video, an artwork.
- No colour is the only sign of anything. A tick box is filled and ticked, a point for or against has a plus or a minus, and a callout names its tone in words.
- A small label in capitals names what the look alone cannot: a group frame's kind, a code card's language when it is known, and where a chat came from. A clip is named by its play mark and a chat by its bubbles, so neither carries a label for its type.
- A group frame is a faint wash and a hairline.
- The field draws a pick at 0.86 of its footprint and the first card of a tree at 1.12. Every other card is drawn at 1. A selected card keeps its scale. Selecting adds a ring outside the card and changes no size.
- A card's drawn size is its footprint times its scale, kept as a fraction: a 240 by 51 pick is 206.4 by 43.86. Layout works on drawn sizes and card centres in IEEE doubles and rounds nothing on the way, so equal footprints give equal positions. The web client rounds once, when it writes a card's top-left corner to the page, to one decimal place of a px. The one exception is inside a gallery, a cluster and an opened stack, where the cell sizes are rounded up as that section says.

## How a card's footprint is worked out

A second client must give every card the same footprint as the web client, because the field is laid out from footprints alone. This section is the whole rule. `test/footprints.json` holds sample cards with the footprint each must get. `npm test` checks the web client against it, and a second client should run the same file through its own code.

All arithmetic is in whole numbers. `up(a, b)` is `a / b` rounded up. `clamp(v, lo, hi)` holds `v` between `lo` and `hi`. A prop that is not a string counts as an empty string. A prop "is set" when it is a string that is not empty, so a string of spaces is set. A card whose component is unknown is sized as a note with no props. `textWidth(str)` is `up(span(str) * 72, 100)`, the px a string is given at the text size.

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

A string that needs more lines than `max` is drawn cut with an ellipsis. A fact's value is the one exception, given under fact.

### Lines counted word by word

The fourteen structured types, from facts to place, count lines with `wrap` and never with `fold`. Their columns go down to 119 px, where one long word can leave half a line empty, and `fold` allows for no such thing.

`wrap(str, width, letter, max)` lays the words out:

```
room = width * 100 - 10 * letter   for the title, text, quote and passage letters
room = width * 100                 for a figure's letter
space = span(' ', face) * letter
```

Split the string at each run of white space, as JavaScript's `\s` reads it, and drop the empty pieces. Each piece is a word. Split a word into units: walk its code points, and end a unit after a code point when it is the last of the word, or when it and the code point after it can each end a line, by the list under `fold`. So `记忆宫殿` is four units and `state-of-the-art` is one.

Start with `lines = 1` and `used = 0`. To place something `wide` after a `gap`: when `used > 0` and `used + gap + wide > room`, add 1 to `lines` and set `used` to 0. Then add `wide` to `used`, and `gap` too when `used` was more than 0 before this addition.

Place each unit in order. Its width is `span(unit, face) * letter`. Its gap is `space` when it is the first unit of its word and 0 otherwise. A unit no wider than `room` is placed whole. A wider unit is placed one code point at a time, each with its own width, the first with a gap of `room`, which starts a new line whenever the line holds anything, and the rest with a gap of 0. `wrap` is `clamp(lines, 1, max)`.

A page may also break after a hyphen or between a Han character and a Latin letter. `wrap` never does, so it counts at least the lines a page draws. The 10 letters in `room` are one spare letter a line, because a short word can draw a little wider than it counts. A figure's letter is already the widest any character runs, so it keeps nothing spare.

`PASSAGE_LETTER = 92` is one letter of the quote's serif set upright, as an excerpt's passage and a definition's meaning are. It counts in the quote face's column of the table.

### Figures

A figure is set in one of three sizes, each with its line height in px, its letter in tenths of a px, and its digit in hundredths of a px:

| Size | Line height | Letter | Digit |
|---|---|---|---|
| largest | 36 | 210 | 2148 |
| middle | 28 | 149 | 1506 |
| smallest | 21 | 105 | 1001 |

`figureNeed(value, size) = span(value, fact value) * letter - digits * (11 * letter - digit)`, where `digits` is how many of `0` to `9` the value holds. It is the value's width on one line in hundredths of a px. The smallest size is the title's size set 0.32 px tighter a character, so where a type wraps a figure at that size it counts the lines in the title face, with a letter of 93.

### Sharing a width

`spread(needs, room)` shares `room` px among columns that need `needs`. Start with every column open and nothing given. Repeat: `each = max(0, floor(room / open columns))`. Every open column whose need is no more than `each` is given its need, `room` drops by that, and the column closes. When no open column is that small, every open column is given `each` and the rule ends. It also ends when no column is open.

### Constants

| Name | Value | Meaning |
|---|---|---|
| `DISPLAY` | 36 | Line height of a figure, in px |
| `TITLE` | 21 | Line height of a title |
| `TEXT` | 17 | Line height of text |
| `FRAME` | 30 | Top and bottom padding and border of a padded card, with 2 px to spare |
| `SIDES` | 33 | Left and right padding and border of a padded card, with 1 px to spare |
| `PASSAGE_LETTER` | 92 | One letter of the upright serif, in tenths of a px |

### Each type

`title` below is `item.title`, or `Untitled` when that is empty.

- **note.** Width 240. `titleLines = fold(title, 207, 93, 2)`. The body is `item.summary`, else `item.text`, and is left out when it is empty or equal to `item.title`. `bodyLines = fold(body, 207, 72, 2)` when `props.emphasis` is set and `fold(body, 207, 72, 3)` when it is not. Height is `30 + 21 * titleLines`, plus 23 when `props.emphasis` is set, plus `6 + 17 * bodyLines` when there is a body.
- **quote.** Width 288. The words are `props.text`, else `item.text`, else `item.title`. `lines = fold(words, 247, 78, 5)`. Height is `52 + 21 * lines`, plus 25 when `props.by` is set. When the words draw in fewer lines than they were given, the spare room sits between the words and the speaker.
- **fact.** The value is `props.value`, or `–` (U+2013) when that is empty. It is set in the first of three sizes that fits it on one line of 287 px. The sizes are a line height of 36 with a letter of 210 and a digit of 2148, 28 with 149 and 1506, and 21 with 105 and 1001. A digit is the drawn width of each of `0` to `9` in hundredths of a px, and replaces the 11 tenths the table gives it: `need = span(value, fact value) * letter - digits * (11 * letter - digit)`, where `digits` is how many of `0` to `9` the value holds. A size fits when `need <= 28700`. When none fits, it takes the last size and `valueLines = fold(value, 287, 105, 8)`, which counts in the fact value face and counts a digit as the table does. The card grows a line of 21 px for each line the value needs at that size, up to eight lines. Otherwise `valueLines = 1`. `valueWidth` is 287 when `valueLines` is more than 1 and `up(need, 100)` at the size taken otherwise. `labelWidth = up(span(props.label, text) * 72, 100)`. Width is `clamp(33 + max(valueWidth, labelWidth), 200, 320)`. `labelLines = fold(props.label, width - 33, 72, 2)`, or 0 with no label. The foot is `item.title` when it is not empty and differs from the value and from the label. Height is `40 + valueLines * lineHeight + 17 * labelLines`, plus 25 when there is a foot. A value's letter is the widest any one character of English other than a digit runs, digits are all one width, and every other character counts the widest it draws, so a value fits the lines it is given. A client must never cut a fact's value or end it with an ellipsis, because a figure cut short misleads. A client draws the value with no line clamp. If the value still draws wider than it was counted, it wraps onto a further line, breaking inside a word where it must, and stays whole. The card keeps the size given here. Eight lines is the ceiling, so that a paragraph filed as a value cannot make a tower. A value that needs more than eight lines at the smallest size is the one value a card may hide the end of: it runs past the bottom of the card and the card's edge clips it, still with no ellipsis. The opened view draws every value whole at any length, and scrolls when it is taller than the view.
- **image.** Width 240. The picture is `clamp(round(240 / aspect), 130, 260)` px tall, where `aspect` is `Number(props.aspect)`, or 1.35 when that is zero or not a number, the division is in IEEE doubles, and `round` is `floor(x + 0.5)`. The caption is `props.caption`, else `item.title` as written, so an empty title gives no caption and never `Untitled`. `captionLines = fold(caption, 207, 72, 2)`, or 0 with no caption. Height is the picture plus 2, plus `19 + 17 * captionLines` when there is a caption.
- **video.** Width 272. The poster is 153 px tall. The caption is as for image, with `captionLines = fold(caption, 239, 72, 2)`. Height is 155, plus `19 + 17 * captionLines` when there is a caption.
- **link.** Width is 316 when `props.image` is set and 272 when it is not. The text column is 187 px with a picture and 239 without. `titleLines = fold(title, column, 93, 2)`. The description is `props.description`, else `item.summary`. `aboutLines = fold(description, column, 72, 2)`, or 0 with none. `main = 21 * titleLines`, plus `4 + 17 * aboutLines` when there is a description. Height is `56 + main`, and at least 120 with a picture.
- **chart.** 300 by 195, or 300 by 212 when `props.unit` is set.
- **person.** 252 by 88.
- **chat.** Width 288. The first 3 messages are shown. Each bubble is `12 + 17 * fold(message.text, 199, 72, 2)` px tall. Height is 51, plus 2 when there is a message, plus 6 and the bubble's height for each bubble, plus 23 when `props.source` is set.
- **code.** Width 304. The lines are `props.source` split at each line feed. Height is `59 + 17 * clamp(lineCount, 1, 7)`.
- **steps.** Width 256. `rows` is the number of steps, at most 5. Height is 51, plus `10 + 20 * rows + 8 * (rows - 1)` when there is a step, plus 25 when there are more than 5 steps.

The fourteen types below trim the white space from both ends of each string prop before they use it, and a prop "is set" for them when something is left. They count every line with `wrap`. A prop of the wrong type counts as an empty string or an empty list.

- **facts.** Width 320. The facts are `props.facts` in order, each a `label` and a `value`. A row is 287 px wide and half a row is 135. A fact is long when `wrap(value, 135, 93, 3)` is more than 2. Walk the facts in order: a fact shares a row with the one after it when there is one and neither is long, and has the row to itself otherwise. `room` is 135 for each fact of a shared row and 287 for a fact alone. A row is set in the first of the middle and the smallest figure sizes at which `figureNeed(value, size) <= room * 100` for every value in it, and then each value has 1 line. When neither fits, the row is set in the smallest size and each value has `wrap(value, room, 93, 8)` lines. `labelLines = wrap(label, room, 72, 2)`. A fact's height is `valueLines * lineHeight + 17 * labelLines`, and a row is as tall as its taller fact. `titleLines = wrap(title, 287, 93, 2)`. Height is `30 + 21 * titleLines`, plus 12, the rows and 12 between each two rows when there is a fact, plus 25 when `props.more` is a whole number above 0. The card then writes `and N more`. A value is drawn with no line clamp and no ellipsis, like a fact's. One that needs more than eight lines is clipped at eight by its own box.
- **table.** The cells are `props.heads` and `props.rows`. The card shows the first 6 rows. For column `i`, `cells` is the widest `textWidth` of its shown cells, and 0 with none. A cell is a number when it is at most 14 characters, counted as extended grapheme clusters, its `textWidth` is at most 120, and it matches `^[-+−–~≈<>≤≥±]?\s?\p{Sc}?\s?\d[\d.,:/\s]*\s?[\p{L}\p{Sc}%°‰µ²³]{0,5}$`: an optional sign, an optional currency sign, a digit, more digits and separators, and at most five letters or unit signs. A column is a number column when at least one of its shown cells is not empty and every one that is not empty is a number. `floor` is `cells` for a number column and 0 for any other. `want = max(textWidth(head), cells)`. `least(count)` is the sum over the first `count` columns of `floor` for a number column and `min(want, 44)` for any other, plus `14 * (count - 1)`. Start with `count = min(columns, 5)` and take 1 off while `count > 2` and `least(count) > 319`. The columns share `spread(want - floor for each, 319 - 14 * (count - 1) - the sum of floor)`, and a column's width is its `floor` plus its share. So a number is never cut, and words are cut to their column with an ellipsis. Width is `clamp(33 + the widths + 14 * (count - 1), 200, 352)`. `titleLines = wrap(title, width - 33, 93, 2)`. Height is `30 + 21 * titleLines + 8 + 24 * (1 + shown rows)`, plus 25 when rows or columns are left out. The card then writes `and N more rows`, `and N more columns`, or both with a comma between, with `row` and `column` for one.
- **list.** Width 256. The entries are `props.items`. The list is a checklist when `props.checked` is as long as `props.items`. A checklist writes `done/count` beside its title, such as `2/4`. `titleLines = wrap(title, 223, 93, 2)`, in a column narrower by `10 + textWidth(tally)` on a checklist. The first 6 entries are shown, each on `wrap(entry, 203, 72, 2)` lines. Height is `30 + 21 * titleLines`, plus 10, 17 for each line and 5 between each two entries when there is an entry, plus 25 when there are more than 6 entries.
- **breakdown.** Width 300. The parts are the first 8 of `props.labels`. The unit is written under the title when `props.unit` is set and is not `%` or `％`. Height is `30 + 21 * wrap(title, 267, 93, 2)`, plus 17 with a unit under the title, plus `10 + 17 * parts + 7 * (parts - 1)` when there is a part. Inside the card, each part is a label, a bar and its share on one line. A share is the value with a comma between thousands and at most six decimals, and `%` straight after it when the unit is a percent sign. The shares take `shares = the widest textWidth of a share`. The labels take `min(the widest textWidth of a label, 128, max(48, 251 - shares - 72))` and are cut with an ellipsis. The bars have what is left, with 8 px either side. A value that is no number or is below 0 draws as 0. A bar's length is its value over the sum of the values of the parts shown, as a share of the room the bars have, so the bars of one card add up to one whole length. A part whose share is written as `0` draws no bar, and no part draws a bar when the sum is 0. A share is never cut.
- **qa.** Width 272. `questionLines = wrap(props.question, 217, 93, 3)` and `answerLines = wrap(props.answer, 217, 72, 6)`. Height is `47 + 21 * questionLines + 17 * answerLines`.
- **callout.** Width 256. `lines = wrap(props.text, 217, 93, 5)`. The foot is `item.title` when it is not empty and differs from the text. Height is `53 + 21 * lines`, plus 25 when there is a foot.
- **excerpt.** Width 288. The passage is `props.text`. The Scout ends the text of a page it picked with a blank line and a line that says who made it, when and where it was found, which the card leaves out: take the values of `item.data.by`, `item.data.date` and `item.data.from` that are strings with something in them, as written and in that order, drop each that repeats an earlier one, and join them with a comma and a space. When that is not empty and the passage ends with a line feed, a line feed and exactly that, cut it off and trim the passage again. Then turn each run of white space into one space. `lines = wrap(passage, 241, 92, 6)`. Under the passage go `item.title`, when it is not empty, and one line of `props.at` and `props.source`, those that are set, joined by a space, a middle dot (U+00B7) and a space. Height is `30 + 21 * lines`, plus 10 and 17 for each of those two lines when there is either.
- **definition.** Width 272. The term is large when `figureNeed(props.term, middle) <= 23900`, and is then 28 px tall. Otherwise it is `21 * wrap(props.term, 239, 93, 2)` px tall. `lines = wrap(props.definition, 239, 92, 6)`. Height is `40 + the term's height + 21 * lines`.
- **idea.** Width 272. The thought is `title`. It is set in the largest figure size when `wrap(title, 239, 210, 3)` is at most 2, and has that many lines of 36 px. Else it is set in the middle size when `wrap(title, 239, 149, 5)` is at most 4, and has that many lines of 28 px. Else it has `min(wrap(title, 239, 93, 6), 5)` lines of 21 px. Height is `52 + lines * lineHeight`. A longer thought can make a shorter card, because it steps down a size.
- **proscons.** Width 320. A side is `props.pros` or `props.cons`, without the points that are empty. Each side shows its first 4 points, each on `wrap(point, 119, 72, 3)` lines. A side's height is 21, plus 17 for each line, plus 5 between each two points, plus 22 when it has more than 4 points. Height is `30 + 21 * wrap(title, 287, 93, 2) + 10`, plus the taller side.
- **swatch.** Width 256. `rows` is the number of `props.colours`, at most 6. Height is `73 + 21 * wrap(title, 223, 93, 2)`, plus `8 + 17 * rows + 5 * (rows - 1)` when there is a colour, plus 25 when there are more than 6. The band across the top is 44 px tall and holds the first 12 colours in equal parts. A colour's value is never cut.
- **artwork.** Width 264. The work is shown whole, never cropped, on a mat 196 px tall. The byline is `props.maker` and `props.date`, those that are set, joined by a comma and a space. `titleLines = wrap(title, 231, 93, 2)`. `byLines = wrap(byline, 231, 72, 2)` and `mediumLines = wrap(props.medium, 231, 72, 2)`, each 0 when there is nothing to write. Height is `222 + 21 * titleLines`, plus `2 + 17 * byLines` with a byline, plus `17 * mediumLines`, plus 17 when `props.holder` is set.
- **reference.** Width 288. The authors are the names in `props.authors` that are not empty, joined by a comma and a space, with ` and others` after them when `props.more` is true. Height is `62 + 21 * wrap(title, 255, 93, 3)`, plus `6 + 17 * wrap(authors, 255, 72, 2)` when there is a name, plus `2 + 17 * wrap(props.venue, 255, 72, 2)` when `props.venue` is set.
- **place.** Width 256. The name is `props.name`, else `title`. It is large when `figureNeed(name, middle) <= 18500`. `head` is 28 when it is large, and `max(28, 21 * wrap(name, 185, 93, 2))` otherwise. The body is `item.summary`, else `item.text`, left out when it is empty or equal to the name or to `item.title`, with each run of white space turned into one space. `bodyLines = wrap(body, 223, 72, 3)`. Height is `30 + head`, plus 120 when `props.src` is set, plus `8 + 17 * bodyLines` when there is a body.

### The chip line

A card's footprint is its type's footprint, and 28 px taller when the card has at least one chip. The width never changes, and neither does the height with the number of chips. Whether the node is a pick or kept changes nothing. The Chips section says which chips an item has, and that rule gives at most three, in order. Call them the candidates. A card has chips when it has at least one candidate.

The line draws some of the candidates, each in a box of a width worked out here. This changes what is drawn and never the footprint. No text is cut by this rule. A chip is given its whole text and the width of its box, and the client's own text engine clips the text inside the box.

`room` is the card's width less 40 for a quote, less 26 for an image or a video, less 44 for a callout, and less 32 for every other type. That is the card's 1 px border and the margin each side of the line: 19, 12, 21 and 15 px. Chips are 6 px apart.

`text(chip) = textWidth(chip.text)`. `pad(chip)` is 28, the chip's glyph and padding, and for a people chip with a `count` it is `28 + textWidth(' +N')`, where ` +N` is a space, a plus sign and the count in decimal digits. `need(chip) = pad(chip) + text(chip)`.

1. **The date first.** When the first candidate's kind is `when`, it is drawn and its width is `min(need, room)`. Then `rest = room - that width - 6`, and steps 2 and 3 run on the other candidates with `rest`. With no `when` candidate, `rest = room` and steps 2 and 3 run on every candidate.
2. **How many of the others are drawn.** Walk the others in order with `left = rest + 6`. For each, `left = left - 6 - pad - min(44, text)`. One is drawn only when `left >= 0` after its own step. One that is left out still takes its step, so no later one is drawn. On a card with no `when` candidate the first is always drawn, whatever `left` is, so a card with chips never has an empty line. The 44 is a floor of 72 px for a chip, less the 28 of its glyph and padding. The opened card lists what the line leaves out.
3. **How wide each of the others is.** Start with `free = rest - 6 * (drawn others - 1) - the sum of their pads`, and each of them without a share. Repeat: `each = floor(free / chips without a share)`. Every chip without a share whose `text <= each` gets its `text` as its share, and `free` drops by that. When no chip does, every chip without a share gets `each`, and the rule ends. It also ends when every chip has a share. A chip's width is its `pad` plus its share.

So the widths on a line and the gaps between them never add up to more than `room`, a chip beside a date has at least 72 px or its whole text, and a people chip always has room for its count.

**Drawing a chip in its box.** A client draws the chip's glyph, then `chip.text` on one line, then for a people chip with a `count` the count as `+N`, 4 px after the names. It clips `chip.text` to what the box leaves, with an ellipsis, by its own text engine. The count is never clipped: three authors whose second name does not fit read `T. Screech, M. For… +1`. The exact characters that survive the clip are the client's own and are not part of this rule.

The widths are counted from the table, and a string nearly always draws narrower than it counts, so a date is whole unless it alone is wider than the line. A client may close a box up to its text when the text draws narrower than counted, and may let a clipped chip take the px that frees, as the web client does. It must never give a chip less than its width here when its text is clipped, and the chips and gaps must stay inside `room`.

On a note, where `room` is 208: `12 May 1958` has a box of 108 and `Bodega Bay` the 94 left. `Early September 1958` takes 165 and leaves 37, so `Bodega Bay` is left out. A date of 60 letters has the whole line and nothing is drawn beside it.

A sample in `test/footprints.json` whose item has `data` lists in `chips` each chip its card draws, in order: `kind`, the whole `text`, the `width` of its box and, on a people chip that leaves some unnamed, `count`. `origin` in a sample's item is `item.origin`.

### Text cut to a width

Where the web client shortens a string itself, as it does for a chart's labels, `cut(str, room)` gives the string, or as much of its start as fits `room` px with an ellipsis. It is only used at the text size, so every `span` below is in the text face and the letter is 72. Chips are not cut this way.

```
cut = str                        when span(str) * 72 <= room * 100
budget = room * 100 - span('…') * 72
```

Otherwise split the string into the characters a reader sees, which are the extended grapheme clusters of Unicode Annex 29, and walk them in order with `used = 0` and nothing kept. For each cluster, add `span(cluster) * 72` to `used`, where the cluster is counted alone as a string of its own. When `used` is now more than `budget` and at least one cluster is already kept, stop without keeping this one. Otherwise keep it. So the first cluster is always kept, even when it alone is over the budget. The result is the kept clusters joined, with the white space at its end removed, then `…` (U+2026). White space here is what JavaScript's `trimEnd` removes: U+0009 to 000D, U+0020, U+00A0, U+1680, U+2000 to 200A, U+2028, U+2029, U+202F, U+205F, U+3000 and U+FEFF. When only white space was kept, the result is `…` alone.

A cluster is counted alone, so the rule about U+200D applies inside a cluster and not across two. An emoji joined from several is one cluster and counts once. A letter that follows a U+200D which ended the cluster before it starts a new cluster, and counts its own width. A cut never lands inside an emoji or between a letter and its accent. The first letter on a link's address bar and a person's initials are whole clusters too.

## Chips

Any card may show one line of chips under its content. A chip is a short fact about the item: when, where it came from, where, or who. A photo with a date and a place reads as a memory without a card type of its own.

Chips are read from the item alone. They never come from `view.props`, so the Renderer and the model have no part in them, and they do not depend on the node, so a card keeps its chips and its size when a pick is kept. `client/js/chips.js` is the whole rule for which chips an item has and has no drawing code. `client/js/components/index.js` fits them to a card.

**Sources, in this order.**

| Kind | Read from | Text on the chip |
| --- | --- | --- |
| `when` | The first of `item.data.when` and `item.data.date` that is a source | The string. |
| `origin` | The first of `item.data.holder`, `item.data.venue`, `item.data.site` and `item.data.from` that is a source. Only when the agents brought the item, which is `item.origin.by === 'agent'`. | The string. |
| `where` | `item.data.where` | The string. |
| `people` | The first of `item.data.people` and `item.data.authors` that holds a name, each an array of strings. | The first two names joined by a comma and a space. With more than two names the chip also has `count`, how many it leaves unnamed. |

A value is trimmed of the white space at both ends. A string is a source only when something is left after that, so an empty string, a string of spaces and a value of another type are passed over, and the next key is tried. A name that is not a string, or is empty once trimmed, is skipped, and an array with no name left is no source.

The Scout writes `date`, `site` and `from` on what it brings, and `holder`, `venue` and `authors` when its source gives them. It also writes `by`, which no chip reads: it is a maker for a museum work, and for other sources a site's name, a score or a cuisine, and a wrong person on a card is worse than none. `when`, `where` and `people` are for what the user makes. The origin keys run from the most exact to the least: the museum that holds a work, the journal a paper is in, the site a page is on, and last the name of the source the Scout searched, such as `The web`.

What the user made has no origin, so its order is when, where, people. What the agents brought says where it came from straight after its date, before a place or people, so a paper keeps its journal when the line has no room for its authors.

**Which chips a card has.**

1. Take the sources the item holds, in the order above.
2. Drop each one whose text is exactly the text of a source before it. A work whose one author is its holder names it once.
3. Drop each one whose `item.data` key the card's type already shows, and each one whose text is exactly the trimmed value of such a key. The table below lists these.
4. Keep the first three. `chips(item, shown)` returns these as `{ kind, text }`, and a people chip that leaves some unnamed also has `count`.

**What each type already shows.**

| Type | Shows |
| --- | --- |
| `link` | `site`, in its address bar |
| `excerpt` | `site` and `from`, in the line under its passage |
| `artwork` | `holder` and `date`, on its plate |
| `reference` | `venue`, `date` and `authors` |
| `place` | `where`, as its name |
| every other type | nothing |

So a link the Scout brought whose origin is its site gets no origin chip, and nothing vaguer stands in for it. One with a `holder` or a `venue` that differs from its site gets that as its origin chip. A museum's work drawn as an artwork and a paper drawn as a reference most often have no chips at all, because the card says everything a chip would. The opened card still lists each source.

**The line.**

- A card with at least one chip is 28 px taller than the same card without. A card with none has the footprint its type gives it, no line, and the same markup as before chips existed.
- The line never wraps. A date is drawn whole, because a date cut short says little. The chips after it share what is left: a card draws fewer than three chips when three would crowd, and clips the text of a chip that is longer than its box. The chip line in the footprint section gives the numbers. `chipsOf(node, item)` returns the chips as drawn, `{ kind, text, width }` and `count` on a people chip that leaves some unnamed, where `text` is whole and `width` is the chip's box in px.
- A hover on a chip shows its label and its text: `Origin: The Metropolitan Museum of Art`. The labels are `When`, `Origin`, `Where` and `People`, the same as on the opened card.
- A chip is 20 px tall and set in the text size. It starts with a glyph for its kind, so the kinds are told apart without colour: a clock for `when`, a pin for `where`, a figure for `people`, a turned arrow for `origin`.
- The glyph takes the card's accent. That is the tree's colour, or amber while the card is a pick. Teal is not used.
- The origin chip follows the item. A museum pick shows `The Metropolitan…` as a pick and after it is kept, at the same size. An item the user added shows no origin chip, whatever its data holds.

**The opened card** lists every source left after step 2 in full, with no limit of three and without leaving out what the type shows: `When`, `Origin` for an item the agents brought, `Where`, and `People` with every name. `chipSources(item)` returns these as `{ kind, label, text }`. A card with an `Origin` leaves out the `From` line that says how the item arrived, because `Found on the web` beside a museum's name says the same thing less well. Its `Source` link stays.

**A known limit.** A card in a timeline shows its year on the axis and again on its `when` chip. The chip stays, because a card's footprint is worked out from its item and props alone. If the chip depended on the group, a card would change size when it joined or left a timeline, and the field could not be laid out from footprints.

## Rules the Renderer follows

Rules in plain code choose first, from one ordered table in `renderer.ts`. The model is asked only about what the rules leave as a note.

### The rule table

The first row that holds draws the item. Each row reads one of four things: what a source's catalogue recorded, the item's kind, structure that Intake extracted into `item.data`, or the item's own words.

| # | Component | Reads | Holds when |
|---|---|---|---|
| 1 | `artwork` | catalogue | `data.kind` is `artwork` and the item has a picture |
| 2 | `reference` | catalogue | `data.kind` is `paper` or `book` |
| 3 | `image` | kind | the item's kind is `image` and it has a source |
| 4 | `video` | kind | the item's kind is `video` and it has a source |
| 5 | `code` | kind | `data.code` holds a source, or the item's kind is `code` |
| 6 | `breakdown` | catalogue, then structure | `data.chart` is shares of one whole |
| 7 | `chart` | catalogue, then structure | `data.chart` holds at least two labels and as many values |
| 8 | `table` | structure | `data.table` has at least one row |
| 9 | `proscons` | structure | `data.pros` and `data.cons` each hold a point |
| 10 | `qa` | structure | `data.question` and `data.answer` are both set |
| 11 | `definition` | structure | `data.term` and `data.definition` are both set |
| 12 | `steps` | structure | `data.steps` holds two or more steps |
| 13 | `list` | structure | `data.items` holds two or more entries, none of them empty |
| 14 | `quote` | structure | `data.quote` exists |
| 15 | `person` | structure | `data.person` exists |
| 16 | `swatch` | structure | `data.colours` holds two or more colours |
| 17 | `facts` | structure | `data.facts` holds two or more facts with a label and a value |
| 18 | `fact` | structure | `data.facts` holds exactly one, or the text is one short line that reads as a value with a label |
| 19 | `link` | kind | the item's kind is `link` and it has an address |
| 20 | `excerpt` | structure | `data.excerpt` exists |
| 21 | `excerpt` | catalogue | the item is a page the Scout picked: a text pick with an address whose text holds more than its closing line |
| 22 | `place` | text | a short note whose title is the name of the place in `data.where` |
| 23 | `chat` | kind | the item's kind is `chat` and it holds a message |
| 24 | `idea` | text | a short thought the user wrote out |
| 25 | `note` | text | always |

What a source catalogued comes first, because it is a record and no guess. A picture, a recording or a piece of code stays one, whatever was read off it. Then comes the structure Intake extracted, the most particular shape first. Rows 6 and 7 are each two rows: the first holds only for an item the agents brought, and has no floor. A conversation's data is its messages, so an item whose kind is `chat` is tried against rows 23 and 25 alone. A row whose props its schema refuses is passed over.

### The coverage floor

A row that reads structure holds only when its card would show at least 20 percent of what the item says. A list of two words must not stand in for a page of notes.

What the card would show is every string and number of the piece of structure, without the addresses, and for `facts` the first six facts alone. What the item says is its text, when the user made the item, its kind is `text` and the text is not empty. The model wrote that item's title, so the same two lines must not be a list under a short title and a note under a long one. For any other item it is the title and the text together. Both are counted in characters after Unicode NFKC and with each run of white space as one space.

### A place

Row 22 holds when the item's kind is `text`, `data.where` is set, the title is not empty, the text is under 280 characters, and the title names the place. The two are compared in one case and one written form, each without the region after its last comma. They match when they are equal. In a script written without spaces (Han, kana, hangul, Thai) with at least two characters each, they also match when the title is the place with a region of two to six characters in front of it, as 杭州西湖 is of 西湖, or when one is the other with one character at its end that names a kind of district: 市 区 县 省 都 镇 乡 村 州 府 道 町 시 도 구.

### An idea

Row 24 holds when the user made the item, its kind is `text`, and it is one phrase: the text, or the title when there is no text. When both are set they must be the same phrase, whatever the case, the white space and the punctuation at the end. The phrase is under 60 characters, holds no digit, and is no web address. In a script written without spaces it holds at least 6 letters. In any other it holds at least 3 words with a letter in them, so a chore, a name or a room number stays a note.

### The model

- The model is asked about an item whose kind is `text`, whose text is 40 characters or more, and that the rules left as a note. A view the Renderer chose earlier that still stands in the item is kept without asking again.
- It may choose `quote`, `fact`, `steps` or `chart`, or leave the note and give it an emphasis. It is offered none of the fourteen structured types.
- When the model fails, the rule-based result is returned and a line goes to the run log.

### The content check

A view the model proposes is kept only when everything it shows stands in its item, and the stand-in service checks the callout it draws the same way. `CHECKS` in `src/core/views.ts` names a check for every prop of every component, and its type refuses a component or a prop with no entry. The content is the item's title and text and the values of its `data`, without the addresses.

| Check | The value stands when |
|---|---|
| `says` | the content states these words |
| `cell` | the same, and it may be empty, and it holds no `\|` or tab |
| `quotes` | the content holds this passage as one stretch |
| `writes` | the content writes this number, with the unit beside it when the unit scales it, as 万 and k do |
| `unit` | the content states these words, or writes them against one of the values |
| `paints` | the content writes this colour: a hex value whole, or a colour name as words |
| `own` | it is one of the item's own values, whole or cut short with an ellipsis: an address, a site, a source, the summary, the text, a value in `data` |
| `label` | it is not empty. It names a value beside it and is not checked against the content |
| `choice` | always. It says how to draw, not what to show |

| Component | Checks |
|---|---|
| `note` | `emphasis` says |
| `quote` | `text` quotes, `by` says |
| `fact` | `value` says and is at most 32 characters, `label` is a label |
| `image`, `video`, `link`, `chat`, `code` | every prop is the item's own, but `aspect` and `language`, which are choices |
| `chart` | `labels` say, `values` write, `unit` is a unit, and there are at least two labels and as many values |
| `person` | `name` and `role` say, `image` is the item's own |
| `steps` | each step says, and there are at least two |
| `facts` | each `value` says, each `label` is a label, and `more` is the number of facts in `data.facts` past those shown |
| `table` | every head and cell is a cell |
| `list` | each entry says, and each mark is the one the text carries on that entry's line or `data.checklist` holds for it |
| `breakdown` | `labels` say, `values` write, `unit` is a unit |
| `qa` | `question` and `answer` say |
| `callout` | `text` quotes, `tone` is a choice |
| `excerpt` | `text` quotes, `at` says, `source` is the item's own |
| `definition` | `term` and `definition` say |
| `idea` | nothing to check |
| `proscons` | each point says |
| `swatch` | each `name` says, each `value` paints |
| `artwork` | `src` is the item's own, and `maker`, `date`, `medium` and `holder` say |
| `reference` | `kind` and `url` are the item's own, `authors`, `year` and `venue` say, and `more` is set only when `data.authorsCut` is true |
| `place` | `name` says, `src` is the item's own |

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

- **Chosen when** `item.data.chart` holds at least two labels and as many values and is no breakdown, or the model finds several comparable numbers in a text item.
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

### facts

Two to six figures about one thing, each with its label.

- **Chosen when** `item.data.facts` holds two or more facts that each have a label and a value, and they pass the coverage floor.
- **Props.** `facts`: the first six, each `{ label, value }`. `more?`: how many further facts the item holds.
- **Drawn as** the title, then the figures two to a row on a fact's darker face, each over its label. A row is set in the largest size that holds its values, so short numbers stay large beside each other and a name or a phrase is set smaller. A long value has a row of its own. No value is cut. The card writes `and N more` for the facts it leaves out, and the opened card lists every fact in `item.data.facts`.
- **Item holds.** `data.facts = [{ label, value }]`.

### table

Rows and columns.

- **Chosen when** `item.data.table` holds at least one row, and it passes the coverage floor.
- **Props.** `heads`: one string for each column. `rows`: each row has one cell for each head, and a cell may be empty. Every row is in the props. The client shows what fits.
- **Drawn as** the title, then the heads and up to six rows, one line each under a rule, in up to five columns. A column of numbers is set to the right and is as wide as its widest number, so no number is cut. Columns of words share the rest and are cut with an ellipsis. The card counts the rows and columns it leaves out. The opened card has every cell, with words whole, under heads that stay in place while it scrolls both ways.
- **Item holds.** `data.table = { heads, rows }`.

### list

Entries in no particular order, or a checklist.

- **Chosen when** `item.data.items` holds two or more entries, none of them empty, and they pass the coverage floor. An ordered procedure is `steps`, which comes first in the table.
- **Props.** `items`: the entries. `checked?`: one mark for each entry, from `data.checklist` when it is as long as the entries.
- **Drawn as** the title, then up to six entries of up to two lines each, with a dot before each. With `checked`, a tick box stands in place of the dot, filled and ticked when the entry is done, the done entries are dimmer, and the title carries a count such as `2/4`. A tick box shows a mark and takes no click. The card writes `and N more`, and the opened card lists every entry whole.
- **Item holds.** `data.items = string[]`, and `data.checklist = boolean[]` for a checklist.

### breakdown

The parts of one whole.

- **Chosen when** `item.data.chart` is shares of one whole: at most eight values, none below 0, a unit of `%`, `％`, `percent`, `pct` or `百分比`, and a sum from 99 to 101. For what the user made it must also pass the coverage floor. Any other chart data is a `chart`.
- **Props.** `labels`: two to eight. `values`: one for each label, none below 0. `unit?`.
- **Drawn as** the title, then one line for each part: its label, a level bar, and its share written whole at the end. A bar is as long as its part's share of the whole, so 45 percent fills 45 percent of the room and the bars together fill it once. Never a pie. A percent sign is written on each share. Any other unit is written once, under the title. The opened card draws the same bars with every label whole, and writes each share of the total beside a value that is no percentage.
- **Item holds.** `data.chart = { labels, values, unit }`.

### qa

One question and its answer.

- **Chosen when** `item.data.question` and `item.data.answer` are both set, and they pass the coverage floor.
- **Props.** `question`. `answer`.
- **Drawn as** two voices. The question is set as a title beside a `Q`, on up to three lines. Under a rule, the answer is set as text beside an `A`, on up to six. The opened card has both whole.
- **Item holds.** `data.question` and `data.answer`.

### callout

A caveat or a remark set apart from the rest.

- **Chosen when** nothing chooses it yet. It has a schema and a content check, no row of the rule table gives it, and the model's reply cannot name it. The stand-in service draws one from a line that opens `Caution:`, `Warning:` or `Note:`, so clients can be built against it.
- **Props.** `text`: a passage of the item's own text. `tone`: `caution` or `note`.
- **Drawn as** a band down the left edge of the card in the colour of the tone, coral for a caution and grey for a remark, a glyph and the tone in words, the text on up to five lines, and the item's title as a foot. The tone is never amber, which is a pick's, or teal, which is a link's.
- **Item holds.** The passage inside `text`.

### excerpt

A passage of a longer source.

- **Chosen when** `item.data.excerpt` exists and passes the coverage floor, or the item is a page the Scout picked: an item the agents brought whose kind is `text`, that has an address, and whose text holds more than the closing line that says who made it and when.
- **Props.** `text`: the passage. For a page the Scout picked it is the item's whole text, which ends with a blank line and that closing line. `at?`: where the passage sits in its source, such as `Chapter 1`. `source?`: `data.site`, else `data.from`.
- **Drawn as** the passage in an upright serif beside a rule, on up to six lines, without the Scout's closing line. Under it are the item's title and one line of `at` and `source`. A quote is a person's words, and is set in italics on a washed face under a quotation mark. The opened card has the whole passage with its line breaks.
- **Item holds.** `data.excerpt = { text, at? }`, or the passage as `text`.

### definition

One term and what it means.

- **Chosen when** `item.data.term` and `item.data.definition` are both set, and they pass the coverage floor.
- **Props.** `term`. `definition`.
- **Drawn as** a dictionary entry: the term as a headword, large while it fits one line, over a short rule, then the meaning in an upright serif on up to six lines. The opened card has the meaning whole, under the term when its own title is not already the term.
- **Item holds.** `data.term` and `data.definition`.

### idea

A short thought.

- **Chosen when** the item is a phrase the user wrote out, as An idea above says.
- **Props.** None. The client draws `item.title`.
- **Drawn as** the title set large under a small spark, and nothing else. The size steps down as the thought grows, from the largest figure size on up to two lines, to the middle size on up to four, to the title's size.
- **Item holds.** `title`, and `text` when it says the same.

### proscons

The points for and the points against.

- **Chosen when** `item.data.pros` and `item.data.cons` each hold at least one point, and they pass the coverage floor.
- **Props.** `pros`. `cons`. At least one of each.
- **Drawn as** the title, then two columns named `For` and `Against` with a rule between them. Each point has a plus or a minus before it, so the sides are told apart without colour. A column shows four points of up to three lines and counts the rest. The opened card lists every point whole, one side under the other.
- **Item holds.** `data.pros = string[]` and `data.cons = string[]`.

### swatch

Colours with their names.

- **Chosen when** `item.data.colours` holds two or more colours, and they pass the coverage floor.
- **Props.** `colours`: each `{ name, value }`. `value` is a hex colour or a CSS colour name, and is safe to paint.
- **Drawn as** a band of the colours across the top of the card, then the title, then one line for each of the first six: a small chip of the colour, its name, and its value whole at the right. No word is set on a colour, so every word reads on any of them. A value the client cannot paint leaves hatching in its place. The card writes `and N more`, and the opened card lists every colour.
- **Item holds.** `data.colours = [{ name, value }]`.

### artwork

A work to look at, with what its collection records.

- **Chosen when** `item.data.kind` is `artwork` and the item has a picture: itself when its kind is `image`, a recording's `data.thumbnailUrl`, or a page's `data.image`. This is the first row of the table, so a museum's work is never a plain image.
- **Props.** `src`: the picture. `maker?`: from `data.by`. `date?`. `medium?`. `holder?`.
- **Drawn as** the work whole on a dark mat, never cropped, over a plate that reads like a museum label: the title, the maker and the date, the medium, and the holder. A plain image fills its frame and has one caption. The opened card has the picture and each line of the label whole. No chip repeats the holder or the date.
- **Item holds.** `data.kind = 'artwork'`, with `data.by`, `data.date`, `data.medium` and `data.holder` as the Scout copied them.

### reference

A paper or a book.

- **Chosen when** `item.data.kind` is `paper` or `book`.
- **Props.** `kind`. `authors`: `data.authors`, else the one name in `data.by`, and it may be empty. `more?`: true when `data.authorsCut` is true, so the list names only some. `year?`: the four-digit year in `data.date`. `venue?`. `url?`: the item's address.
- **Drawn as** a library card: `Paper` or `Book` and the year over a rule, then the title on up to three lines, the authors on up to two with `and others` when the list is cut, and the venue on up to two. The opened card has the authors and the venue whole. No chip repeats the venue, the date or the authors.
- **Item holds.** `data.kind`, with `data.authors`, `data.authorsCut`, `data.venue` and `data.date`.

### place

A place by name.

- **Chosen when** the item is a short note whose title names the place in `data.where`, as A place above says.
- **Props.** `name`: `data.where`. `src?`: the item's picture, from `data.image`.
- **Drawn as** the name set large beside a round pin, with the item's summary or text on up to three lines under it. With `src`, the picture fills a frame 120 px tall across the top of the card. The opened card has the picture whole, and the name when its own title is not already the name. No chip repeats the place.
- **Item holds.** `data.where`, and `data.image` for a picture.

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

## Adding to a library

Add the schema to `COMPONENTS` or `COMPOSITES` in `src/core/views.ts` and a check to `CHECKS`, add a rule or a model option in `renderer.ts`, add a test in `test/renderer.test.ts`, and add a section here and a line under Each type. For the web client, add a module to `client/js/components/` or `client/js/composites/`, list it in that folder's `index.js` in the order of `views.ts`, and add a sample to `client/library.html`. A component module also exports `shows`, and gets an entry in `CHIPS` in `library.html` so it is drawn once with chips. Add at least four samples to `test/footprints.json`, one of them in Chinese and one at an extreme, and run `scripts/footprints.ts` to fill in their sizes. For a structured type, add a sample to `src/core/samples.ts` and run `scripts/samples.ts`, which writes the file the library page draws from, and add a growing run to `test/client-types.test.ts`. `npm test` fails when a component in `views.ts` lacks its client module, its content check or either part of this page. `isValidView` and `isValidGroup` reject anything a schema does not describe, so the client can trust the props it receives.
