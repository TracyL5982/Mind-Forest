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

- Each component is one module, `client/js/components/<type>.js`, that exports `size`, `draw`, `detail` and `shows`. `detail` draws the type's part of the opened card, and for the types that count rows it draws every row the card left out. The opened card says what else it prints. Each composite is one module in `client/js/composites/`. The `index.js` in each folder is the registry.
- `size(item, props)` is the card's footprint in px. It is worked out from the content and never measured, so the field can be laid out before anything is drawn. The next section gives the rule. The registry adds 28 px to the height of a card that has chips.
- `shows` lists the chip sources the type already draws, as `item.data` keys. A sheet's `shows` is a function of the item and the props, because what it draws is in its sections. See Chips.
- Text on the field is set in three sizes, named `--type-display`, `--type-title` and `--type-text` in `client/style.css`. A figure that is too long for its card steps down to a middle size, then to the title size. A fact's value, a row of facts, an idea, a term and a place name are figures.
- Each type has its own face, so types can be told apart when zoomed out. A note is plain. A quote is a serif on a face washed with the tree's colour. A fact is one large figure on a darker face. A picture or clip has tight corners and its caption on a plate below. A link sits under an address bar. A chart has gridlines and a scale. A person has a round face beside the name. A chat is speech bubbles. Code is fixed-width with a numbered gutter. Steps are numbers down a rail. Facts are figures two to a row on a fact's darker face. A table is ruled rows with numbers set to the right. A list has a dot or a tick box before each entry. A breakdown is level bars with a share at the end of each. A question and its answer carry a `Q` and an `A`. A callout has a band down its left edge. An excerpt is an upright serif beside a rule. A definition is a large headword over a short rule. An idea is large words under a spark. Pros and cons are two columns of plus and minus marks. A swatch has a band of its colours across the top. An artwork sits whole on a mat a shade lighter than its card, over a label. A reference has its kind and year over a rule. A place has a round pin beside a large name, under a small map when its item knows where it is. A sheet is one card under one title, whose parts are each drawn as the card of their kind draws them and set apart by a hairline, with its picture, when it has one, in a band across the top.
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

The fifteen structured types, from facts to place and the sheet, count lines with `wrap` and never with `fold`. Their columns go down to 119 px, where one long word can leave half a line empty, and `fold` allows for no such thing. `wrap` lays the words out one by one, each as wide as the web client draws it, so it ends a line where the page does.

`wrap` counts in six faces, each named by its letter: the title (93), the text (72), the passage (92), and a figure's largest (210), middle (149) and smallest (105) sizes. The passage is the quote's serif set upright, as an excerpt's passage and a definition's meaning are, and `PASSAGE_LETTER = 92`. With any other letter, `advance(str, letter)` below is `span(str, face) * letter`.

`advance(str, letter)` is a string's width on one line in hundredths of a px. Walk the string by code point:

- A code point from U+0020 to U+007E counts what the table below gives it in the face.
- A code point set with Han counts the face's square: 1591 in the title, 1250 in the text, 1600 in the passage, 3332, 2352 and 1568 in a figure's largest, middle and smallest sizes. These are U+3000 to 30FF, U+3400 to 9FFF, U+FF01 to FF60 and U+FFE0 to FFE6.
- Take every other code point out, in order, as one string `others`. It counts `span(others, face) * letter`, where the face is the title's, the text's, the quote's for the passage, and a fact value's for a figure. So the two rules about U+200D and U+FE0F run over `others` alone.

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

A page may also break in a few places `wrap` does not, such as after a slash, so `wrap` counts at least the lines a page draws. The web client sets the fifteen structured types with kerning off (`font-kerning: none`), so a word is exactly as wide as its characters add up to, and each width in the table is what the character draws in the web client, rounded up, and 2 more. A figure set at 24 px or more, in a facts card, a sheet, an idea, a definition's headword and a place's name, is kerned (`font-kerning: normal`), because pairs such as `Ta`, `Wa` and `Av` gape at that size without it. The table still counts its characters unkerned, and kerning only ever draws a line narrower than that: in the web client no pair of the characters U+0020 to U+007E and none of 6,000 random strings drew wider kerned than unkerned at 34 or 24 px. So the count stays at least the lines a page draws. Measured against the web client on 5,600 strings in each of the title and the text faces, in English and in Chinese, `wrap` never counted fewer lines than were drawn, and counted one more for 1 to 4 strings in a hundred. A client that draws with other fonts keeps these widths for its footprints, and must make sure its own text fits them.

| Character | Code point | Title | Text | Passage | Largest figure | Middle figure | Smallest figure |
|---|---|---|---|---|---|---|---|
| space | U+0020 | 384 | 350 | 447 | 649 | 467 | 358 |
| `!` | U+0021 | 512 | 388 | 542 | 1021 | 719 | 497 |
| `"` | U+0022 | 833 | 596 | 532 | 1493 | 1081 | 825 |
| `#` | U+0023 | 1018 | 786 | 892 | 2125 | 1494 | 1002 |
| `$` | U+0024 | 1018 | 786 | 892 | 2150 | 1508 | 1002 |
| `%` | U+0025 | 1572 | 1155 | 1410 | 2953 | 2126 | 1567 |
| `&` | U+0026 | 1139 | 888 | 1332 | 2341 | 1651 | 1121 |
| `'` | U+0027 | 496 | 370 | 274 | 883 | 634 | 482 |
| `(` | U+0028 | 627 | 476 | 673 | 1239 | 876 | 613 |
| `)` | U+0029 | 627 | 476 | 673 | 1239 | 876 | 613 |
| `*` | U+002A | 731 | 588 | 729 | 1473 | 1038 | 711 |
| `+` | U+002B | 1018 | 786 | 1335 | 2150 | 1508 | 1002 |
| `,` | U+002C | 496 | 370 | 447 | 777 | 573 | 482 |
| `-` | U+002D | 731 | 588 | 563 | 1466 | 1034 | 711 |
| `.` | U+002E | 496 | 370 | 447 | 777 | 573 | 482 |
| `/` | U+002F | 484 | 380 | 740 | 990 | 692 | 467 |
| `0` | U+0030 | 1034 | 786 | 892 | 2150 | 1508 | 1002 |
| `1` | U+0031 | 760 | 579 | 892 | 2150 | 1508 | 1002 |
| `2` | U+0032 | 973 | 753 | 892 | 2150 | 1508 | 1002 |
| `3` | U+0033 | 1014 | 782 | 892 | 2150 | 1508 | 1002 |
| `4` | U+0034 | 1042 | 803 | 892 | 2150 | 1508 | 1002 |
| `5` | U+0035 | 1004 | 771 | 892 | 2150 | 1508 | 1002 |
| `6` | U+0036 | 1035 | 795 | 892 | 2150 | 1508 | 1002 |
| `7` | U+0037 | 914 | 710 | 892 | 2150 | 1508 | 1002 |
| `8` | U+0038 | 1048 | 797 | 892 | 2150 | 1508 | 1002 |
| `9` | U+0039 | 1035 | 795 | 892 | 2150 | 1508 | 1002 |
| `:` | U+003A | 496 | 370 | 447 | 777 | 573 | 482 |
| `;` | U+003B | 496 | 370 | 447 | 777 | 573 | 482 |
| `<` | U+003C | 1018 | 786 | 1335 | 2150 | 1508 | 1002 |
| `=` | U+003D | 1018 | 786 | 1335 | 2150 | 1508 | 1002 |
| `>` | U+003E | 1018 | 786 | 1335 | 2150 | 1508 | 1002 |
| `?` | U+003F | 834 | 640 | 755 | 1763 | 1235 | 819 |
| `@` | U+0040 | 1441 | 1146 | 1602 | 2983 | 2104 | 1420 |
| `A` | U+0041 | 1109 | 841 | 1158 | 2294 | 1617 | 1095 |
| `B` | U+0042 | 1055 | 820 | 998 | 2128 | 1506 | 1039 |
| `C` | U+0043 | 1137 | 894 | 1134 | 2381 | 1672 | 1118 |
| `D` | U+0044 | 1148 | 907 | 1252 | 2341 | 1654 | 1129 |
| `E` | U+0045 | 945 | 743 | 1017 | 1909 | 1349 | 927 |
| `F` | U+0046 | 907 | 714 | 938 | 1826 | 1290 | 888 |
| `G` | U+0047 | 1173 | 932 | 1190 | 2434 | 1712 | 1152 |
| `H` | U+0048 | 1198 | 927 | 1273 | 2437 | 1723 | 1181 |
| `I` | U+0049 | 449 | 333 | 546 | 850 | 604 | 435 |
| `J` | U+004A | 897 | 671 | 534 | 1835 | 1294 | 885 |
| `K` | U+004B | 1075 | 822 | 1111 | 2165 | 1533 | 1060 |
| `L` | U+004C | 901 | 709 | 917 | 1810 | 1279 | 884 |
| `M` | U+004D | 1398 | 1091 | 1459 | 2884 | 2036 | 1381 |
| `N` | U+004E | 1180 | 927 | 1295 | 2394 | 1692 | 1161 |
| `O` | U+004F | 1213 | 963 | 1285 | 2520 | 1774 | 1193 |
| `P` | U+0050 | 1023 | 793 | 945 | 2050 | 1452 | 1006 |
| `Q` | U+0051 | 1213 | 963 | 1285 | 2519 | 1774 | 1193 |
| `R` | U+0052 | 1055 | 815 | 1127 | 2127 | 1505 | 1039 |
| `S` | U+0053 | 1026 | 795 | 868 | 2099 | 1480 | 1010 |
| `T` | U+0054 | 1007 | 791 | 1012 | 2007 | 1422 | 988 |
| `U` | U+0055 | 1168 | 920 | 1262 | 2372 | 1677 | 1149 |
| `V` | U+0056 | 1095 | 841 | 1149 | 2253 | 1589 | 1081 |
| `W` | U+0057 | 1559 | 1209 | 1662 | 3232 | 2281 | 1543 |
| `X` | U+0058 | 1107 | 847 | 1140 | 2274 | 1606 | 1093 |
| `Y` | U+0059 | 1072 | 818 | 1057 | 2205 | 1555 | 1058 |
| `Z` | U+005A | 1037 | 826 | 1070 | 2110 | 1490 | 1017 |
| `[` | U+005B | 627 | 476 | 673 | 1239 | 876 | 613 |
| `\` | U+005C | 484 | 380 | 740 | 990 | 692 | 467 |
| `]` | U+005D | 627 | 476 | 673 | 1239 | 876 | 613 |
| `^` | U+005E | 1018 | 786 | 1602 | 2150 | 1508 | 1002 |
| `_` | U+005F | 947 | 728 | 802 | 1904 | 1347 | 931 |
| `` ` `` | U+0060 | 762 | 624 | 802 | 1674 | 1162 | 739 |
| `a` | U+0061 | 889 | 688 | 772 | 1808 | 1275 | 873 |
| `b` | U+0062 | 988 | 767 | 892 | 1977 | 1401 | 971 |
| `c` | U+0063 | 890 | 698 | 717 | 1801 | 1270 | 872 |
| `d` | U+0064 | 988 | 767 | 902 | 1974 | 1398 | 971 |
| `e` | U+0065 | 910 | 713 | 783 | 1836 | 1297 | 892 |
| `f` | U+0066 | 594 | 451 | 501 | 1154 | 818 | 580 |
| `g` | U+0067 | 979 | 760 | 828 | 1964 | 1390 | 962 |
| `h` | U+0068 | 955 | 734 | 940 | 1934 | 1367 | 939 |
| `i` | U+0069 | 404 | 308 | 477 | 772 | 545 | 388 |
| `j` | U+006A | 404 | 307 | 441 | 770 | 544 | 388 |
| `k` | U+006B | 899 | 677 | 876 | 1773 | 1259 | 886 |
| `l` | U+006C | 416 | 315 | 470 | 775 | 550 | 400 |
| `m` | U+006D | 1426 | 1086 | 1410 | 2875 | 2039 | 1414 |
| `n` | U+006E | 947 | 728 | 937 | 1904 | 1347 | 931 |
| `o` | U+006F | 941 | 737 | 884 | 1898 | 1341 | 923 |
| `p` | U+0070 | 981 | 762 | 899 | 1966 | 1391 | 965 |
| `q` | U+0071 | 981 | 760 | 895 | 1964 | 1390 | 965 |
| `r` | U+0072 | 634 | 475 | 627 | 1179 | 844 | 621 |
| `s` | U+0073 | 850 | 653 | 711 | 1695 | 1200 | 834 |
| `t` | U+0074 | 601 | 453 | 578 | 1151 | 818 | 586 |
| `u` | U+0075 | 947 | 728 | 943 | 1904 | 1347 | 931 |
| `v` | U+0076 | 876 | 676 | 788 | 1743 | 1235 | 861 |
| `w` | U+0077 | 1286 | 967 | 1242 | 2618 | 1853 | 1275 |
| `x` | U+0078 | 866 | 654 | 850 | 1733 | 1227 | 853 |
| `y` | U+0079 | 894 | 677 | 780 | 1776 | 1259 | 881 |
| `z` | U+007A | 856 | 673 | 758 | 1670 | 1186 | 838 |
| `{` | U+007B | 627 | 476 | 673 | 1239 | 876 | 613 |
| `\|` | U+007C | 423 | 322 | 802 | 780 | 556 | 407 |
| `}` | U+007D | 627 | 476 | 673 | 1239 | 876 | 613 |
| `~` | U+007E | 1018 | 786 | 1335 | 2150 | 1508 | 1002 |

### Figures

A figure is set in one of three sizes, each with its line height in px, its letter in tenths of a px, and its digit in hundredths of a px:

| Size | Line height | Letter | Digit |
|---|---|---|---|
| largest | 36 | 210 | 2148 |
| middle | 28 | 149 | 1506 |
| smallest | 21 | 105 | 1001 |

`figureNeed(value, size) = span(value, fact value) * letter - digits * (11 * letter - digit)`, where `digits` is how many of `0` to `9` the value holds. It is the value's width on one line in hundredths of a px. Where a type wraps a figure, it counts the lines with `wrap` and the letter of the figure's size: 210, 149 or 105.

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
| `PASSAGE_LETTER` | 92 | The letter that names the upright serif of a passage |

### Fixed words

A card draws a few words that are not the item's own. Each has an English and a Chinese form. A card uses the Chinese forms when `item.title` and `item.text`, joined by a line feed, hold at least one Han character (Unicode script Han) and no more of the letters `A` to `Z` and `a` to `z` than Han characters, and the English forms otherwise. Web addresses and hex colours are taken out before the count, because they are written in Latin letters in any language: each match of `\b(?:https?:\/\/|www\.)\S*|#[0-9A-Fa-f]{3,8}\b` is replaced by a space. Digits are never counted. A missing title or text counts as empty. A footprint is worked out with the same words the card draws, so `title` below and a reference's line of authors are counted in the card's own language.

| Where | English | Chinese |
|---|---|---|
| The title of an item that has none, on the card and the opened card | `Untitled` | `未命名` |
| Under the rows a card shows, when it holds N more | `and N more` | `还有 N 项` |
| Under a table that leaves out R rows | `and R more rows`, `and 1 more row` | `还有 R 行` |
| Under a table that leaves out C columns | `and C more columns`, `and 1 more column` | `还有 C 列` |
| Under a table that leaves out both | `and R more rows, C more columns` | `还有 R 行、C 列` |
| After a reference's authors when the list is cut | ` and others`, with the space | ` 等`, with the space |
| The two sides of pros and cons | `For`, `Against` | `优点`, `缺点` |
| A reference's kind | `Paper`, `Book` | `论文`, `图书` |
| A callout's tone | `Caution`, `Note` | `注意`, `备注` |
| The two voices of a question and answer | `Q`, `A` | `问`, `答` |
| A link with no site | `link` | `链接` |
| A picture that cannot be loaded | `Picture unavailable` | `图片无法显示` |
| An opened clip with nothing to play | `This clip has no file to play.` | `这段视频没有可播放的文件。` |
| A chart with no values | `No data` | `暂无数据` |
| The label a chip shows on hover | `When`, `Where`, `People`, `Origin` | `时间`, `地点`, `人物`, `来源` |
| What a tick box says to a screen reader | `Done`, `Not done` | `已完成`, `未完成` |
| What a checklist's count says on hover | `2 of 4 done` | `已完成 2/4` |

`client/js/words.js` holds the table. The opened card's own labels, such as `From` and `Added`, are the app's and are not part of it.

### Each type

`title` below is `item.title`, or the fixed word for a missing title when that is empty: `Untitled`, or `未命名` on a Chinese card. `item.title` is never trimmed.

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

The fifteen types below trim the white space from both ends of each string prop before they use it, and a prop "is set" for them when something is left. That holds for a string inside a list or an object too: a fact's label and value, a table's head and cell, an entry, a point, a colour's name and value, an author. To trim is to do what JavaScript's `trim` does: take off U+0009 to 000D, U+0020, U+00A0, U+1680, U+2000 to 200A, U+2028, U+2029, U+202F, U+205F, U+3000 and U+FEFF at both ends. `item.title`, `item.summary` and `item.text` are never trimmed, by any type. They count every line with `wrap`. A prop of the wrong type counts as an empty string or an empty list.

- **facts.** Width 320. The facts are `props.facts` in order, each a `label` and a `value`, both trimmed. A row is 287 px wide and half a row is 135. Walk the facts in order: a fact shares a row with the one after it when there is one and `figureNeed(value, middle) <= 13500` for both values, and has the row to itself otherwise. `room` is 135 for each fact of a shared row and 287 for a fact alone. Every figure of the card is set in one size: the middle size when `figureNeed(value, middle) <= room * 100` for every value on the card, which only a fact alone can fail, and the smallest otherwise. So a long value takes a whole row and the card stays in the middle size, and only a value too long for a whole row at the middle size sets every figure small. A value for which that holds at the size taken has 1 line. Any other has `min(wrap(value, room, 105, 9), 8)` lines, and is cut when `wrap(value, room, 105, 9)` is 9. `labelLines = wrap(label, room, 72, 2)`. A fact's height is `valueLines * lineHeight + 17 * labelLines`, and a row is as tall as its taller fact. `titleLines = wrap(title, 287, 93, 2)`. Height is `30 + 21 * titleLines`, plus 12, the rows and 12 between each two rows when there is a fact, plus 25 when `props.more` is a whole number above 0. The card then writes `and N more` in its fixed words. A value that is not cut is drawn with no line clamp and no ellipsis, like a fact's. A value that is cut is no figure but a passage: it is drawn on eight lines and ends with an ellipsis, the one sign on a facts card that there is more, and the opened card has it whole. The rule table gives no such card, because it leaves an item with a value over 60 characters to its other rows, so only a view sent straight to a client can hold one. A fact takes its direction from its value, so an Arabic figure and its label sit on the same side.
- **table.** The cells are `props.heads` and `props.rows`, and the table has as many columns as it has heads. A row's cell for a column it does not reach is an empty string, and a cell past the last head is not read. The card shows the first 6 rows. A cell is a number when its `textWidth` is at most 160 and it matches `^[-+−–~≈<>≤≥±]?\s?\p{Sc}?\s?\d[\d.,:/\s]*\s?[\p{L}\p{Sc}%°‰µ²³]{0,5}$`: an optional sign, an optional currency sign, a digit, more digits and separators, and at most five letters or unit signs. A head is never a number. For column `i`, over its shown cells: `want` is the widest `textWidth` of the head and of every shown cell. `numbers` is the widest `textWidth` of those that are numbers, and 0 with none. `floor` is `numbers`, except for the first column, which names each row: its `floor` is `max(numbers, min(want, 120))`. The column is a number column when at least one of its shown cells is not empty and every one that is not empty is a number. `least` is `floor` for a number column and `max(floor, min(want, 44))` for any other. `least(count)` is the sum of `least` over the first `count` columns, plus `14 * (count - 1)`. Start with `count = min(columns, 5)` and take 1 off while `count > 1` and `least(count) > 319`. The columns share `spread(want - floor for each, 319 - 14 * (count - 1) - the sum of floor)`, and a column's width is its `floor` plus its share. So a number is never cut, whether its column holds only numbers or words too, the first column has 120 px or all it needs, and words are cut to their column with an ellipsis. When that leaves too little for the last columns, they are dropped and counted. A number column is set to the right, and a number beside words stays on the left with them. Width is `clamp(33 + the widths + 14 * (count - 1), 200, 352)`. `titleLines = wrap(title, width - 33, 93, 2)`. Height is `30 + 21 * titleLines + 8 + 24 * (1 + shown rows)`, plus 25 when rows or columns are left out. The card then counts them in the fixed words of the next section: `and N more rows`, `and N more columns`, or both with a comma between, with `row` and `column` for one.
- **list.** Width 256. The entries are `props.items`. The list is a checklist when it has at least one entry and `props.checked` is as long as `props.items`. A checklist writes `done/count` beside its title, such as `2/4`, where `count` is every entry and `done` every entry whose mark is true, shown or not. `titleLines = wrap(title, 223, 93, 2)`, in a column narrower by `10 + textWidth(tally)` on a checklist. The first 6 entries are shown, each on `wrap(entry, 203, 72, 2)` lines. Height is `30 + 21 * titleLines`, plus 10, 17 for each line and 5 between each two entries when there is an entry, plus 25 when there are more than 6 entries.
- **breakdown.** Width 300. The parts are the first 8 of `props.labels`. The unit is written under the title when `props.unit` is set and is not `%` or `％`. Height is `30 + 21 * wrap(title, 267, 93, 2)`, plus 17 with a unit under the title, plus `10 + 17 * parts + 7 * (parts - 1)` when there is a part. Inside the card, each part is a label, a bar and its share on one line. A share is the value with a comma between thousands and at most six decimals, and `%` straight after it when the unit is a percent sign. The shares take `shares = the widest textWidth of a share`. The labels take `min(the widest textWidth of a label, 128, max(48, 251 - shares - 72))` and are cut with an ellipsis. The bars have what is left, with 8 px either side. A value that is no number or is below 0 draws as 0. A bar's length is its value over the sum of the values of the parts shown, as a share of the room the bars have, so the bars of one card add up to one whole length. A part whose share is written as `0` draws no bar, and no part draws a bar when the sum is 0. A share is never cut.
- **qa.** Width 272. `questionLines = wrap(props.question, 217, 93, 4)` and `answerLines = wrap(props.answer, 217, 72, 6)`. Height is `47 + 21 * questionLines + 17 * answerLines`.
- **callout.** Width 256. `lines = wrap(props.text, 217, 93, 5)`. The foot is `item.title` when it is not empty and differs from the text. Height is `53 + 21 * lines`, plus 25 when there is a foot.
- **excerpt.** Width 288. The passage is `props.text`. The Scout ends the text of a page it picked with a blank line and a line that says who made it, when and where it was found, which the card leaves out: take the values of `item.data.by`, `item.data.date` and `item.data.from` that are strings and not blank once trimmed, each as written, untrimmed, and in that order, drop each that repeats an earlier one, and join them with a comma and a space. When that is not empty and the passage ends with a line feed, a line feed and exactly that, cut it off and trim the passage again. Then turn each run of white space into one space. `lines = wrap(passage, 242, 92, 6)`, in the whole line box of 242 px: the passage is counted without the px to spare that the other columns keep, because a character set with Han draws exactly 16 px in this serif and fifteen of them fill a 240 px line to the last px. Under the passage go `item.title`, when it is not empty, and one line of `props.at` and `props.source`, those that are set, joined by a space, a middle dot (U+00B7) and a space. Height is `30 + 21 * lines`, plus 10 and 17 for each of those two lines when there is either.
- **definition.** Width 272. The term is large when `figureNeed(props.term, middle) <= 23900`, and is then 28 px tall. Otherwise it is `21 * wrap(props.term, 239, 93, 2)` px tall. `lines = wrap(props.definition, 240, 92, 6)`, in the whole line box, as an excerpt's passage is. Height is `40 + the term's height + 21 * lines`.
- **idea.** Width 272. The thought is `title`. It is set in the largest figure size when `wrap(title, 239, 210, 3)` is at most 2, and has that many lines of 36 px. Else it is set in the middle size when `wrap(title, 239, 149, 5)` is at most 4, and has that many lines of 28 px. Else it has `min(wrap(title, 239, 105, 6), 5)` lines of 21 px. Height is `52 + lines * lineHeight`. A longer thought can make a shorter card, because it steps down a size. A thought for which `wrap(title, 239, 105, 6)` is 6 is drawn on five lines and ends with an ellipsis. Any other is drawn with no line clamp.
- **proscons.** Width 320. A side is `props.pros` or `props.cons`, without the points that are empty. Each side shows its first 4 points, each on `wrap(point, 119, 72, 3)` lines. A side's height is 21, plus 17 for each line, plus 5 between each two points, plus 22 when it has more than 4 points. A side with no point is 21 tall. Height is `30 + 21 * wrap(title, 287, 93, 2) + 10`, plus the taller side.
- **swatch.** Width 256. `rows` is the number of `props.colours`, at most 6. Height is `73 + 21 * wrap(title, 223, 93, 2)`, plus `8 + 17 * rows + 5 * (rows - 1)` when there is a colour, plus 25 when there are more than 6. The band across the top is 44 px tall and holds the first 12 colours in equal parts. A client paints a value only when it matches `^(?:#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|[a-z]{1,30})$` in either case, which is what the schema allows, and leaves any other unpainted. A colour's value is never cut. A colour whose name equals its value, as one pasted without a name has, is written once, as its name.
- **artwork.** Width 264. The work is shown whole, never cropped, on a mat 196 px tall, a shade lighter than the card's face. The byline is `props.maker` and `props.date`, those that are set, joined by a comma and a space. `titleLines = wrap(title, 231, 93, 2)`. `byLines = wrap(byline, 231, 72, 2)` and `mediumLines = wrap(props.medium, 231, 72, 2)`, each 0 when there is nothing to write. Height is `222 + 21 * titleLines`, plus `2 + 17 * byLines` with a byline, plus `17 * mediumLines`, plus 17 when `props.holder` is set.
- **reference.** Width 288. The authors are the names in `props.authors` that are not empty, joined by a comma and a space, with the fixed words for a cut list after them when `props.more` is true: ` and others`, or ` 等` on a Chinese card. With no name there is no line of authors, whatever `props.more` is. Height is `62 + 21 * wrap(title, 255, 93, 3)`, plus `6 + 17 * wrap(authors, 255, 72, 2)` when there is a name, plus `2 + 17 * wrap(props.venue, 255, 72, 2)` when `props.venue` is set.
- **place.** Width 256. The name is `props.name`, else `title`. It is large when `figureNeed(name, middle) <= 18500`. `head` is 28 when it is large, and `max(28, 21 * wrap(name, 185, 93, 2))` otherwise. The body is `item.summary`, else `item.text`, as written. It is left out when it is empty or equal to the name or to `item.title`. That is decided first, and then each run of white space in it is turned into one space. `bodyLines = wrap(body, 223, 72, 3)`. Height is `30 + head`, plus 120 when `props.src` is set, which a string of white space is not, plus 112 when `item.data.at` is a point on the earth as Maps says, plus `8 + 17 * bodyLines` when there is a body. The map counts whether or not the service names a tile provider, so a footprint is worked out from the item and the props alone.
- **sheet.** Width 320, and every part has the column of 287 px, but where a part says otherwise. The sections are `props.sections` in order, and an entry that is not an object is passed over. A section's `kind` names it. The card has one title: the `text` of the first section whose kind is `heading`, trimmed, or `title` when that is empty or there is no heading. `titleLines = wrap(that title, 287, 93, 3)`. The `src` of the first section whose kind is `picture`, trimmed, is the card's picture, and when it is set the card leads with it in a band 140 px tall across the whole card. A later heading or picture is not drawn. Every section whose kind is `text`, `figures`, `list`, `table` or `excerpt` is a part, in the order given, laid out as the card of its kind lays it out, and a part with nothing to show is left out:
  - `text`: the words are `text`, trimmed, with each run of white space turned into one space, and the part is left out when they are empty. `lines = wrap(words, 288, 72, 6)`, in the whole line box of 288 px: a character set with Han draws exactly 12.5 px in the text face, so twenty-three of them fill the line to the last half px, and the px to spare that the other columns keep would push the last onto a line of its own. It is `17 * lines` tall, and its lead is 6.
  - `figures`: the facts are `facts`, each label and value trimmed, laid out exactly as a facts card lays out its facts, in rows of 287 and 135 px, every figure in one size. It is as tall as the rows, plus 12 between each two rows, and its lead is 12. It is left out with no fact.
  - `list`: the entries are `items`, each trimmed. The first 8 are shown, each on `wrap(entry, 267, 72, 2)` lines. It is 17 for each line plus 5 between each two entries tall, plus 25 when there are more than 8, and the part then writes `and N more` in its fixed words. Its lead is 10. It is left out with no entry.
  - `table`: `heads` and `rows` laid out by the table rule above, with 287 in place of 319 wherever that rule shares the room among the columns. It is `24 * (1 + shown rows)` tall, plus 25 when it leaves out rows or columns, which it counts as a table card does. Its lead is 8. It is left out with no head.
  - `excerpt`: the passage is `text`, trimmed, with each run of white space turned into one space, and the part is left out when it is empty. `by` is trimmed. `lines = wrap(passage, 274, 92, 5)`, in the whole line box of 274 px, as an excerpt's passage is counted. `byLines = wrap(by, 265, 72, 2)`. It is `21 * lines` tall, plus `4 + 17 * byLines` when `by` is set, and its lead is 10.

  Height is `30 + 21 * titleLines`, plus 140 with a picture, plus the first part's lead and its height, plus 21 and its height for each part after it. The 21 is 10 px above a hairline, the hairline, and 10 px under it. The title, a text, an entry, a passage and `by` are drawn clamped to the lines they were given. A figure and a number in a table are never cut, as on their own cards.

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
| `sheet` | each key whose value, trimmed, is one of the strings the card draws, trimmed: its title, a text part's words, a figure's label or value, an entry or a table head or cell that it shows, a passage or its `by`. A key that holds a list shows when it holds a string that is not blank and each such string is drawn, so a people chip for Ines is left out under words of hers |
| every other type | nothing |

So a link the Scout brought whose origin is its site gets no origin chip, and nothing vaguer stands in for it. One with a `holder` or a `venue` that differs from its site gets that as its origin chip. A museum's work drawn as an artwork and a paper drawn as a reference most often have no chips at all, because the card says everything a chip would. The opened card still lists each source.

**The line.**

- A card with at least one chip is 28 px taller than the same card without. A card with none has the footprint its type gives it, no line, and the same markup as before chips existed.
- The line never wraps. A date is drawn whole, because a date cut short says little. The chips after it share what is left: a card draws fewer than three chips when three would crowd, and clips the text of a chip that is longer than its box. The chip line in the footprint section gives the numbers. `chipsOf(node, item)` returns the chips as drawn, `{ kind, text, width }` and `count` on a people chip that leaves some unnamed, where `text` is whole and `width` is the chip's box in px.
- A hover on a chip shows its label and its text: `Origin: The Metropolitan Museum of Art`. The labels are `When`, `Origin`, `Where` and `People`, or their Chinese forms on a Chinese card. The opened card labels its list in English.
- A chip is 20 px tall and set in the text size. It starts with a glyph for its kind, so the kinds are told apart without colour: a clock for `when`, a pin for `where`, a figure for `people`, a turned arrow for `origin`.
- The glyph takes the card's accent. That is the tree's colour, or amber while the card is a pick. Teal is not used.
- The origin chip follows the item. A museum pick shows `The Metropolitan…` as a pick and after it is kept, at the same size. An item the user added shows no origin chip, whatever its data holds.

**The opened card** lists every source left after step 2 in full, with no limit of three and without leaving out what the type shows: `When`, `Origin` for an item the agents brought, `Where`, and `People` with every name. `chipSources(item)` returns these as `{ kind, label, text }`. A card with an `Origin` leaves out the `From` line that says how the item arrived, because `Found on the web` beside a museum's name says the same thing less well. Its `Source` link stays.

`item.data.at` makes no chip of its own. A card whose item has `at` and `where` shows the `where` chip as any other card does.

**A known limit.** A card in a timeline shows its year on the axis and again on its `when` chip. The chip stays, because a card's footprint is worked out from its item and props alone. If the chip depended on the group, a card would change size when it joined or left a timeline, and the field could not be laid out from footprints.

## Maps

A map is described to a client as a centre, a zoom and pins, and the client draws it from the tiles of the provider the service names. `client/js/map.js` is the whole rule in the web client.

**Where an item is.** `item.data.at` is `{ lat, lon }` in degrees, north and east positive. It is a point on the earth when both are numbers, finite, with `|lat| <= 90` and `|lon| <= 180`. Anything else is no point, and a card draws as if `at` were missing. Intake writes it:

- From a dropped JPEG's own GPS position in its Exif block (`src/core/exif.ts`). This is read on the machine, so it happens whether or not maps are on.
- Otherwise from looking up `data.where`, only when maps are on. The geocoder is the `Geocoder` port in `src/core/ports.ts`. `src/node/geocoder.ts` asks OpenStreetMap's public lookup (Nominatim), at most once a second, and keeps every answer, a place not found included, in `places.json` in the data folder, so a name is asked about once. It takes the first result that is a settlement, a region, a natural feature or a sight, so a café that shares a name is not the place.

**Switching maps on.** Maps are off unless `MIND_PALACE_MAPS` names a provider. The one provider is `openstreetmap`. With maps off no place is looked up and no tile is asked for, so nothing about a place leaves the machine. With maps on, a lookup sends the place's name to the provider's server with a generic client name and nothing about the user, and each map a client draws asks the tile server for the squares around the place.

**The provider.** The `hello` message carries `maps`: `{ tiles, credit, link? }`, or null when maps are off. `tiles` is an address with `{z}`, `{x}` and `{y}` in it, as `https://tile.openstreetmap.org/{z}/{x}/{y}.png`. `credit` is the words every map shows, `© OpenStreetMap contributors`. `link` is where the credit points, in a view where a link can be followed. OpenStreetMap's public servers allow light use only, so a commercial provider replaces them before the product ships, and no client changes when it does.

**Tiles and pins.** Tiles are 256 px squares of the Web Mercator projection. At zoom `z` the world is `world = 256 * 2^z` px across and down. A point is at `x = (lon + 180) / 360 * world` and `y = (0.5 - ln((1 + sin φ) / (1 - sin φ)) / (4π)) * world`, where `φ` is `lat` held between -85.0511287798 and 85.0511287798 degrees, in radians. For a map `width` by `height` px around a centre: `left = round(x - width / 2)` and `top = round(y - height / 2)` of the centre, so the map's corner is on a whole px and tiles meet with no seam. Every column from `floor(left / 256)` while `column * 256 < left + width`, and every row from `floor(top / 256)` while `row * 256 < top + height`, is a tile, at `column * 256 - left`, `row * 256 - top` from the map's corner. A row below 0 or at `2^z` or past has no tile. A column wraps round the world: the tile's `x` is the column modulo `2^z`, never negative, and its `y` is the row. A pin is drawn at the point's `x - left`, `y - top`, with the tip of a drop-shaped marker 22 by 28 px on the point, in the card's accent with a dot of the card's face in it.

**Drawing.** The map is a box of its height on a plain ground (`#20262c`). The tiles and pins sit in a layer `width` by `height` at the middle of the box, so a box a little wider or narrower than the map keeps the centre in the middle. Each tile is drawn only as far as it lies inside the map. A tile that fails to load is taken away and leaves the plain ground, so a map with no tiles still shows its pins. The credit is set in 10 px type on a light plate in the map's bottom-right corner, on every map that draws tiles. With no provider a map draws no tile and no credit: the plain ground and its pins.

**On a place card.** A place whose item has a point draws a map across the card under its picture and over its name: the card's width, 112 px tall, at zoom 12, centred on the point with one pin on it. At zoom 12 the card shows about ten kilometres by four at the equator, a town or a sight with what is around it. That takes at most four tiles. The opened card draws a map 348 by 200 px, also at zoom 12 with one pin, after the picture, with the credit as a link. That takes at most six.

**Samples.** `client/library.html` and the tests draw tiles from `client/samples/tiles/{z}/{x}/{y}.svg`, plain squares in two shades that `scripts/sample-tiles.ts` writes for the points they use, so they ask no tile server for anything.

## The opened card

An opened card says each thing once. From top to bottom it has the item's title, why a pick is here, the type's own opened form, the summary, what is left of the text, the tags, and the list of sources.

`client/js/said.js` is the whole rule for the summary and the text, and has no drawing code. `said` is every string the card has drawn by then: the title, each string the type's opened form writes, and the text of each source in the list.

**The text.** Split it at each line feed and take each line with its runs of white space turned into one space and its ends trimmed. Matching ignores case.

1. A line with no letter or digit is kept as an empty line.
2. A line that is inside one string of `said` is left out.
3. Mark every place in the line where a string of `said` stands as whole words, the longest strings first. A string stands as whole words when the character before it and the character after it are not letters or digits, or are characters of a script written without spaces (U+3040 to 30FF, U+3400 to 9FFF, U+AC00 to D7AF), or the string itself starts or ends with one.
4. `left` is the weight of what is not marked, where a letter or digit weighs 1 and a character of a script written without spaces weighs 2, and `lead` is the weight of what comes before the first marked character. The line is left out when something is marked, `left` equals `lead`, and `lead` is at most 12 and less than the weight of what is marked. So `Solo | $8 | 1`, `[x] passport` and `Definition: …` are left out once the form has drawn their words, and `Table 2. Mean recall (n = 212)` is not, because a letter after the first marked character is never a mark.
5. Any other line is printed. A marked run of 20 characters or more is first cut out of it when the run is a sentence of its own: it starts the line or follows a `.` `!` `?` `:` `;` or their full-width forms, and it ends the line, ends with one of those, or is followed by a closing quote mark, bracket, stop or comma, or by white space and an opening bracket, so `Table 2. Mean recall (n = 212)` under the title `Mean recall` prints `Table 2. (n = 212)`. The quote marks and brackets around the run and the stops after it go with it.

Three or more line feeds in a row become two, and the result is trimmed. Nothing is printed when nothing is left.

**The summary.** It is printed whole, unless the item's text or a string of `said` holds it, or the rule for the text, given the summary and `said` and with 0 in place of the 12 of step 4, leaves nothing of it: every letter and digit of the summary is already drawn. An ellipsis at its end (`…` or `...`) is taken off before it is looked for in a string, and case and runs of white space are ignored.

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
| 5 | `code` | kind | `data.code` holds a source, or the item's kind is `code` and its text is not empty |
| 6 | `breakdown` | catalogue, then structure | `data.chart` is shares of one whole |
| 7 | `chart` | catalogue, then structure | `data.chart` holds at least two labels and as many values |
| 8 | `table` | structure | `data.table` has at least two heads and one row |
| 9 | `proscons` | structure | `data.pros` and `data.cons` each hold a point |
| 10 | `qa` | structure | `data.question` and `data.answer` are both set |
| 11 | `definition` | structure | `data.term` and `data.definition` are both set |
| 12 | `steps` | structure | `data.steps` holds two or more steps |
| 13 | `list` | structure | `data.items` holds two or more entries, none of them empty |
| 14 | `quote` | structure | `data.quote` exists |
| 15 | `person` | structure | `data.person` exists |
| 16 | `swatch` | structure | `data.colours` holds two or more colours |
| 17 | `facts` | structure | `data.facts` holds two or more facts with a label and a value, and no value is over 60 characters |
| 18 | `fact` | structure | `data.facts` holds exactly one, or the text is one short line that reads as a value with a label, and the value is not over 60 characters |
| 19 | `link` | kind | the item's kind is `link` and it has an address |
| 20 | `excerpt` | structure | `data.excerpt` exists |
| 21 | `excerpt` | catalogue | the item is a page the Scout picked: a text pick with an address whose text holds more than its closing line |
| 22 | `place` | text | a short note whose title is the name of the place in `data.where` |
| 23 | `chat` | kind | the item's kind is `chat` and it holds a message |
| 24 | `idea` | text | a short thought the user wrote out |
| 25 | `note` | text | always |

What a source catalogued comes first, because it is a record and no guess. A picture, a recording or a piece of code stays one, whatever was read off it. Then comes the structure Intake extracted, the most particular shape first. Rows 6 and 7 are each two rows: the first holds only for an item the agents brought, and has no floor. A conversation's data is its messages, so an item whose kind is `chat` is tried against rows 23 and 25 alone. A row whose props its schema refuses is passed over.

A fact's value is a figure or a few words. One of more than 60 characters, counted after Unicode NFKC with each run of white space as one space, is a sentence, so rows 17 and 18 do not hold for an item with such a value and it is left to the rows after them.

### The coverage floor

A row that reads structure holds only when its card would show at least 20 percent of what the item says. A list of two words must not stand in for a page of notes.

What the card would show is every string and number of the piece of structure, without the addresses, and for `facts` the first six facts alone. What the item says is its text, when the user made the item, its kind is `text` and the text is not empty. The model wrote that item's title, so the same two lines must not be a list under a short title and a note under a long one. For any other item it is the title and the text together. Both are counted in characters after Unicode NFKC and with each run of white space as one space.

A row whose card names a value or shows a passage or a meaning is also held to the item's own words: its title and text, without its `data`. The role that extracted the piece checked that the item states each value, and not how the values stand together. So the checks `label`, `point`, `whole`, `lead` and `meaning` of the content check below are read for it. A figure, an entry or a row that fails one is dropped from the card. The row is passed over when any other value fails, when the card is no longer valid, or when what is left shows under 20 percent of the item.

### A place

Row 22 holds when the item's kind is `text`, `data.where` is set, the title is not empty, the text is under 280 characters, and the title names the place. The two are compared in one case and one written form, each without the region after its last comma. They match when they are equal. In a script written without spaces (Han, kana, hangul, Thai) with at least two characters each, they also match when the title is the place with a region of two to six characters in front of it, as 杭州西湖 is of 西湖, or when one is the other with one character at its end that names a kind of district: 市 区 县 省 都 镇 乡 村 州 府 道 町 시 도 구.

### An idea

Row 24 holds when the user made the item, its kind is `text`, and it is one phrase: the text, or the title when there is no text. When both are set they must be the same phrase, whatever the case, the white space and the punctuation at the end. The phrase is under 60 characters, or under 24 in a script written without spaces, holds no digit, and is no web address. In a script written without spaces it holds at least 6 letters. In any other it holds at least 3 words with a letter in them, so a chore, a name or a room number stays a note.

### The model

The model is asked only about items the rules are unsure of, and only to choose among cards built from the item's own words. What it answers is a proposal. Every card it proposes is held to the checks below, and where one fails the rules' card stands. `renderer.ts` holds all of this.

**Which items are asked about.** An item whose kind is `text` or `file`, which the rules drew as a note or an idea, and which says enough: its text, or its title when the rules drew an idea and it has no text, is at least 40 characters, or 16 when it holds a character of a script written without spaces (Han, kana, hangul, Thai). Characters are counted after Unicode NFKC, with each run of white space as one space and the ends trimmed. A view the Renderer chose for the item earlier (`view.by` is `renderer`) that still passes the content check is kept without asking again. The one exception is a note or an idea whose item's title, text or data changed since: a note or an idea shows nothing an edit could contradict, so the model is asked again.

**What it is sent.** For each item, its node id, its title, `now: idea` when the rules drew an idea, `picture: yes` when the item has a picture of its own, and its text. A text over 1,200 characters is sent as its first 1,200, with a line that gives its whole length. The prompt names each card and the slots it fills, and says how to choose: a card of its own when its structure is what the item mainly is, at least a fifth of the text; a sheet only when the item has two or more kinds of part worth seeing and no card of its own covers a fifth of it; a note when nothing fits. It also says that every value is copied word for word in the item's language, that a passage is whole sentences or whole lines, that a label is a few words of its value's own sentence, line or table row and at most 40 characters, and that each figure, entry and row is written once.

**What it may answer.** One entry for each item, all in one flat shape: `id`, `component`, and the slots `subject`, `passage`, `by`, `tone`, `lines`, `labels`, `numbers`, `left`, `right`, `unit`, `emphasis` and `sections`, each an empty string or an empty list when the card does not use it. `component` is one of sixteen: `note`, `idea`, `quote`, `fact`, `facts`, `steps`, `list`, `chart`, `breakdown`, `table`, `qa`, `definition`, `proscons`, `callout`, `excerpt` and `sheet`. One builder for each card turns the slots into props.

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

Each list drops its empty lines and any line written twice. An emphasis, a speaker, an excerpt's `at` and a unit that the content does not state are left off, and the card is kept without them.

**The checks.** A card the model proposes is drawn only when all of these hold:

1. The library has it: its props pass the component's schema, and an `idea` is a phrase the user wrote, as An idea above says, but under 60 characters in any script.
2. Everything it shows stands in its item, by the content check below. The label of a figure may be at most 40 characters, and a passage that must be whole at most 400, or 200 in a script written without spaces. A figure, a list entry or a table row that fails is dropped, and the card is drawn without it when it is still a valid card. Any other value that fails refuses the card.
3. The component's own condition holds, such as a fact's value of at most 32 characters or a breakdown's shares that add up to 100.
4. It shows at least 20 percent of the item, counted as the coverage floor counts: every value it shows, once each, without the choices and the item's own addresses. A note and an idea draw the item itself and are not held to this.

Every value dropped and every card refused writes one line to the run log that names the item and the value.

**A sheet.** The sections of a `sheet` answer become a card in four steps.

1. A section that repeats one before it is dropped. More than four sections, two headings, or a heading that is not first, and the answer is refused.
2. The half rule. When one section alone shows at least half of the item, counted as the floor counts, and passes every check above as the card of its own kind, that card is drawn in place of the sheet: figures as a `fact` or a `facts`, a list as a `list`, a table as a `table`, words someone said as a `quote` when they have a speaker the content states and as an `excerpt` when not. When more than one does, the one that shows the most is drawn. A card of its own always wins over a sheet.
3. Otherwise each section is checked alone. A figure, entry or row that fails is dropped, and a section that still fails is left out. Each is then cut to the room a sheet has: a heading to 80 characters and a text to 280, at the end of a word and with an ellipsis, and four figures, eight entries and five rows. A section that is then no longer valid is left out.
4. What is left must be a valid sheet, of two to four sections with at most one heading and that first, two that are no heading, and one that is no text. It must show 20 percent of the item, its heading not counted. A sheet that shows less is still drawn when one of its text parts is the item's own opening: the text begins with it, and it is at least 120 characters, or 60 in a script written without spaces. That is what a sheet is for: a long item's opening beside a key figure or a key line.

**Passes.** One pass of the Renderer asks about at most 24 unsure items, in calls of at most 8 made at once and split evenly, so ten items go in two calls of five. A call that fails or times out is tried once more as two halves. An item the model answered for gets `view.by` set to `renderer`, with the model's card or, when that was refused, the rules' card, and is not asked about again until it changes. An item with no answer, because its call failed, the reply left it out or the pass was full, keeps the rules' card with `view.by` set to `default`. When the pass ends, the pipeline runs another over those items, one pass after another and four at most for one change, so a drop of up to 96 items is answered for. A later pass looks at cards alone, since the first one already looked for arrangements. Past four passes an item keeps its plain card until it is next touched.

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

## Components

Each type below says when a rule chooses it. Beyond those rules, the model may choose any of the sixteen cards that The model lists for an item the rules are unsure of, and the card is drawn when it passes the checks there.

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

- **Chosen when** `item.data.facts` holds exactly one fact with a value of at most 60 characters, or a text item is one short line that reads as a value with a label (`42% of users leave`, `Budget: $1.2M`), or the model finds that a text item is mainly one figure.
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

- **Chosen when** `item.data.code` holds a source, or the item's kind is `code` and its text is not empty.
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

- **Chosen when** `item.data.facts` holds two or more facts that each have a label and a value, no value is over 60 characters, and they pass the coverage floor.
- **Props.** `facts`: the first six, each `{ label, value }`. `more?`: how many further facts the item holds.
- **Drawn as** the title, then the figures two to a row on a fact's darker face, each over its label. Every figure of a card is set in one size, so no card mixes two sizes of figure. Two figures share a row when both fit half of it at the middle size, and a longer one has a row of its own. The card steps down to the smallest size only when a value does not fit a whole row at the middle size, where a long value wraps. A value of up to 60 characters is always whole. A longer one reaches a card only in a view sent straight to a client, and is then cut at eight lines with an ellipsis. The card writes `and N more` for the facts it leaves out, and the opened card lists every fact in `item.data.facts`.
- **Item holds.** `data.facts = [{ label, value }]`.

### table

Rows and columns.

- **Chosen when** `item.data.table` holds at least one row, and it passes the coverage floor.
- **Props.** `heads`: one string for each column, and at least two. `rows`: at least one, and each row has one cell for each head, and a cell may be empty. Every row is in the props. The client shows what fits.
- **Drawn as** the title, then the heads and up to six rows, one line each under a rule, in up to five columns. A column of numbers is set to the right. No number is cut, in a column of numbers or beside words: a column is at least as wide as its widest number, and when the columns no longer fit, the card shows fewer and counts the rest. Words share what is left and are cut with an ellipsis. The card counts the rows and columns it leaves out. The opened card has every cell, with words whole, under heads that stay in place and wrap on whole words. It scrolls both ways inside its own box. Each column is at least as wide as the widest of its first twenty cells, up to 220 px, so a table of many columns scrolls sideways and no cell is squeezed to a word a line. An opened card keeps its scroll place while other cards arrive: a client redraws an opened card only when its node or its item changed.
- **Item holds.** `data.table = { heads, rows }`.

### list

Entries in no particular order, or a checklist.

- **Chosen when** `item.data.items` holds two or more entries, none of them empty, and they pass the coverage floor. An ordered procedure is `steps`, which comes first in the table.
- **Props.** `items`: the entries. `checked?`: one mark for each entry, from `data.checklist` when it is as long as the entries.
- **Drawn as** the title, then up to six entries of up to two lines each, with a dot before each. With `checked`, a tick box stands in place of the dot, filled and ticked when the entry is done, the done entries are dimmer, and the title carries a count such as `2/4`. A tick box shows a mark and takes no click. The card writes `and N more`, and the opened card lists every entry whole. A line of `item.text` that starts with a bullet, a number and `.` `)` or `、`, or a tick box, and then with the entry followed by anything but a letter or digit, stands in for the entry in the opened card, so `- Her ration book from 1946 (two coupons still attached)` is written whole there and once.
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
- **Drawn as** two voices. The question is set as a title beside a `Q`, on up to four lines. Under a rule, the answer is set as text beside an `A`, on up to six. The opened card has both whole, and leaves out the `Q` and the question when the question is the item's title, which the opened card has just written.
- **Item holds.** `data.question` and `data.answer`.

### callout

A caveat or a remark set apart from the rest.

- **Chosen when** the model finds that a text item is mainly a warning, a caveat or a reminder the reader must not miss. No row of the rule table gives it. The stand-in service chooses one for a line that opens `Caution:`, `Warning:` or `Note:`, so clients can be built against it.
- **Props.** `text`: a whole passage of the item's own text. `tone`: `caution` or `note`.
- **Drawn as** a band down the left edge of the card in the colour of the tone, coral for a caution and grey for a remark, a glyph and the tone in words, the text on up to five lines, and the item's title as a foot. The tone is never amber, which is a pick's, or teal, which is a link's.
- **Item holds.** The passage inside `text`.

### excerpt

A passage of a longer source.

- **Chosen when** `item.data.excerpt` exists and passes the coverage floor, or the item is a page the Scout picked: an item the agents brought whose kind is `text`, that has an address, and whose text holds more than the closing line that says who made it and when.
- **Props.** `text`: the passage. For a page the Scout picked it is the item's whole text, which ends with a blank line and that closing line. `at?`: where the passage sits in its source, such as `Chapter 1`. `source?`: `data.site`, else `data.from`.
- **Drawn as** the passage in an upright serif beside a rule, on up to six lines, without the Scout's closing line. Under it are the item's title and one line of `at` and `source`. A quote is a person's words, and is set in italics on a washed face under a quotation mark. The opened card has the whole passage with its line breaks, and under it `item.data.by`, the maker the Scout's closing line named, on a line of its own when the line of `at` and `source` does not hold it.
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
- **Drawn as** the title set large under a small spark, and nothing else. The size steps down as the thought grows, from the largest figure size on up to two lines, to the middle size on up to four, to the smallest on up to five. The rule table gives this card only to a phrase under 60 characters. A longer title, in a view sent straight to a client, is cut at five lines with an ellipsis and never spills.
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
- **Props.** `colours`: each `{ name, value }`. `value` is a hex colour of 3, 4, 6 or 8 digits after its `#`, or a CSS colour name of 1 to 30 letters from `a` to `z` in either case, and nothing else, so it is safe to paint. `name` equals `value` when the content gave the colour no name.
- **Drawn as** a band of the colours across the top of the card, then the title, then one line for each of the first six: a small round dot of the colour, its name, and its value whole at the right, or the value alone when the colour has no other name. No word is set on a colour, so every word reads on any of them. Each dot, and each chip of the opened card, is edged by a black hairline inside and a light grey one (`#b0b0aa`) outside, so its edge holds 3 to 1 whatever its colour: a colour of luminance 0.1 and up against the black, any darker one against the grey, and the grey against every face of a card. A value the client cannot paint leaves hatching in its place. The card writes `and N more`, and the opened card lists every colour.
- **Item holds.** `data.colours = [{ name, value }]`.

### artwork

A work to look at, with what its collection records.

- **Chosen when** `item.data.kind` is `artwork` and the item has a picture: itself when its kind is `image`, a recording's `data.thumbnailUrl`, or a page's `data.image`. This is the first row of the table, so a museum's work is never a plain image.
- **Props.** `src`: the picture. `maker?`: from `data.by`. `date?`. `medium?`. `holder?`.
- **Drawn as** the work whole on a mat, never cropped. The mat is a shade lighter than the card's face, kept or pick, and has a hairline under it, so it reads as a mount and never as a hole in the field. Under it is a plate that reads like a museum label: the title, the maker and the date, the medium, and the holder. A plain image fills its frame and has one caption. The opened card has the picture and the lines of the label whole, without the holder when its list of sources names it. No chip repeats the holder or the date.
- **Item holds.** `data.kind = 'artwork'`, with `data.by`, `data.date`, `data.medium` and `data.holder` as the Scout copied them.

### reference

A paper or a book.

- **Chosen when** `item.data.kind` is `paper` or `book`.
- **Props.** `kind`. `authors`: `data.authors`, else the one name in `data.by`, and it may be empty. `more?`: true when `data.authorsCut` is true and `data.authors` holds at least one name, so the list names only some. It is never set beside the one name from `data.by`. `year?`: the four-digit year in `data.date`. When there is none, the card writes `item.data.date` as it stands, trimmed, in the year's place, so a date such as `late 19th century` is not lost. `venue?`. `url?`: the item's address.
- **Drawn as** a library card: `Paper` or `Book` and the year over a rule, then the title on up to three lines, the authors on up to two with `and others` when the list is cut, and the venue on up to two. The opened card has the kind and the year, and the authors and the venue whole when its list of sources does not say them in the same words. A list of authors that was cut is always written, because only that line says `and others`. No chip repeats the venue, the date or the authors.
- **Item holds.** `data.kind`, with `data.authors`, `data.authorsCut`, `data.venue` and `data.date`.

### place

A place by name.

- **Chosen when** the item is a short note whose title names the place in `data.where`, as A place above says.
- **Props.** `name`: `data.where`. `src?`: the item's picture, from `data.image`.
- **Drawn as** the name set large beside a round pin, with the item's summary or text on up to three lines under it. With `src`, the picture fills a frame 120 px tall across the top of the card. When `item.data.at` is a point, a map 112 px tall with one pin and the provider's credit sits under the picture and over the name, as Maps says. The opened card has the picture whole, a larger map, and the name when neither its own title nor the `Where` of its list of sources is already the name. No chip repeats the place.
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
- **Drawn as** one card of the family, not a stack of small cards. It has one face, the plain face of a note, and one title: the heading, or the item's title when there is none, on up to three lines. Under the title each part is drawn as the card of its own kind draws it, in the order given: the text as a note's text, on up to six lines; figures as a facts card sets them, two to a row while both fit and all in one size, each over its label; a list with a dot before each entry; a table of ruled rows with its numbers whole and to the right; words someone said in the upright serif beside a rule, on up to five lines, with who said them after a short rule. The first part sits under the title as it would on its own card, and each part after it sits under a hairline with 10 px above and below it. Nothing is boxed. A picture leads the card in a band 140 px tall across its top, and the card keeps its corners of 12 px. The opened card has the picture whole, then the heading when the opened card's title is not already it, whatever the case and the white space, then each part whole, in order: a text cut short with an ellipsis is given whole, as the rest of the line of the item's text that it begins; figures as a list of each label beside its value; the list with each entry as the item's text writes it, as an opened list has it; the table as an opened table has it; the words someone said with their line breaks, and who said them. The rule for the opened card then prints only what of the item's text the parts leave unsaid. No chip says a value the card draws, as Chips says.
- **Item holds.** The words the sections are taken from, in `title` and `text`, and the picture for a `picture` section.

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
