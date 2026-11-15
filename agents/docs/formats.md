# The format sample set

The Renderer picks one card type for each item. The sample set says whether a change made that choice better or worse. It holds 167 realistic items, and each item names the card a person would pick for it.

The set has two groups, and every score is given for each group apart.

- The reviewers' 120. Two independent reviewers each wrote sixty items and their keys before the model chose any card.
- The authors' 47. The authors of the model's choice wrote these for the kinds of content that no rule can draw.

On the reviewers' items the model does not beat the rules. Its gain is on the authors' items, which are the content it was added to draw: sheets, callouts, and structure that Intake did not extract. Never add the two groups into one score. The sum says how many items of each kind the set holds, and little about the model.

A change to a rule, to a check or to the Renderer's prompt must not lower the rules' score or the model's score in either group. If a score drops, fix the change. The one exception is a card that changes what its item says: [the fourth round](#the-fourth-round-whole-units) lowered both scores to refuse every such card, and its numbers are the floor now.

## What the set holds

The set is `test/fixtures/formats.json`. Each entry has these fields.

| Field | Meaning |
|---|---|
| `key` | A short name. `A-` and `B-` items come from two reviewers who each wrote sixty items. `C`, `D` and `E` items were written for the model. |
| `origin` | `reviewers` for the `A-` and `B-` items, `authors` for the `C`, `D` and `E` items. |
| `activity` | `research`, `brainstorming` or `memories`. |
| `language` | `en` or `zh`. |
| `what` | What the user did to make the item. |
| `expect` | The card a person would pick. |
| `accept` | Other cards a person would not mind. |
| `item` | The item as Intake or the Scout built it. |

Each `item` was built once, by passing a scripted model reply through the real `structure()` and `labels()`. The fixture stores the result, so no test needs a model.

To add a sample, append an entry to `scripts/formats-add.ts` and run it. Write the expected card before any model sees the item.

```
node --no-warnings --import tsx scripts/formats-add.ts
```

The script builds its entries the same way and puts them in the fixture. It holds the ten `D` items. The script that built the first 157 was not kept, so those items exist only in the fixture.

Intake keeps a figure only under a label whose words stand on the line, in the sentence or in the table row of its value, in any of their forms. Two stored items, `B-B12` and `B-M08`, were built before that check and carry labels in other forms of the text's words: "One-to-one, per hour" for "£40 an hour for one-to-one", and "Finish time" for "Finished … in 1:52:40". They stay as they are, because they hold the Renderer to the same check on an item an older Intake made.

The 167 items split as follows.

| | Items | Research | Brainstorming | Memories | English | Chinese |
|---|---|---|---|---|---|---|
| Reviewers | 120 | 40 | 40 | 40 | 78 | 42 |
| Authors | 47 | 18 | 15 | 14 | 24 | 23 |

The 47 items written for the model are of five kinds:

- Nine long items with a small structure worth showing, such as a report with three key figures. The expected card is `sheet`.
- Six cautions. The expected card is `callout`.
- Thirteen paragraphs that hold a definition, a question and its answer, points for and against, a list, figures, a series or a quotation that Intake did not extract.
- Nine pieces of prose where `note` is right and the model must not find a structure.
- Ten Chinese texts of 21 to 33 characters, the `D` items: three cautions, two definitions, two questions with their answers and three ideas. Intake extracted nothing from any of them. A rule cannot tell them apart, so the model must.

Beside the items, `pools` holds ten sets of siblings under one parent, each with the arrangement a person would draw them as: an `overview` in English and in Chinese, a `moodboard`, a `gallery`, a `ranked` set of picks, a Chinese `matrix`, and four where no group is right. `npm test` runs each through the real Renderer with a model that proposes no group, and checks that the rules make the expected arrangement where plain code makes it and no group anywhere else. The `ranked` and `matrix` pools are the model's to arrange. `npm run formats` does not score pools yet.

Six more, the `E` items, were written with the explorable card on 14 November 2026, after every run this page reports, so the counts and scores here are of the 167 before them and no live run has scored them yet. They are explainers, one for each activity in each language: a value that follows from another by a formula, as the field of view follows the focal length, or one thing in two to four states, as a dolly zoom shot three ways. The expected card is `explorable`. Intake extracted nothing from any of them, so the rules draw each as a note.

## Score the rules

```
npm test
```

`test/formats.test.ts` draws every sample with `byRule` and counts the samples where the card is the expected one or an accepted one. The test holds the count for each group and activity in `RULES_AGREE`, and the count of samples drawn as the very card a person picked in `RULES_EXACT`. A rule change that lowers a count fails the test. Raise a count when a rule change earns it.

| Rules alone | All | Exactly as picked | Research | Brainstorming | Memories |
|---|---|---|---|---|---|
| Reviewers | 109 of 120 | 102 of 120 | 39 of 40 | 35 of 40 | 35 of 40 |
| Authors | 26 of 53 | 10 of 53 | 6 | 9 | 11 |

Since the fifth round a structured card shows its whole item, so a card of part of one is a note. Against the fourth round's 112 and 105, five of the reviewers' are notes now: the steps of `A-M06` and `B-B05` beside a list of ingredients, and of `B-M20` above a closing line; the quotes of `B-M06` and `B-M18`, whose speaker Intake gave as a name where the text says more of who and where; and the eight figures of `B-M21`, past the six a facts card shows. Three definitions the text gives whole, `A-R12`, `B-R07` and `B-R19`, are drawn now. See [the fifth round](#the-fifth-round-the-whole-item).

Before the fourth round the rules drew 116 of the reviewers' as a person would and 112 exactly as picked. The fourth round holds what Intake read off the samples to whole units too, so seven of the reviewers' are notes now: the definitions `A-R12`, `B-R07` and `B-R19`, whose meaning is the rest of a sentence after its term; the pros and cons of `A-B05` and the list of `B-B13`, cut out of one sentence; the steps of `B-M05`, beside a step that says "do not"; and the fact of `B-M08`, whose label "Finish time" adds a word its sentence does not write. The first four were agreements. See [the fourth round](#the-fourth-round-whole-units).

## Score the Renderer with the live model

```
npm run formats
```

The script runs the real Renderer over the set with the live model. It needs `MODEL_API_KEY` in `~/.muse-garden.env`. One run makes 9 model calls, spends about 48,000 tokens, and its slowest call takes under a minute.

The script prints:

- for each group, agreement for the rules alone and with the model, overall and by activity and language, and how many cards the model changed there: right, wrong or neither by the key
- agreement by expected card, over both groups
- each card the model changed, with its group
- each answer a check refused, with the reason, and each figure, list entry, table row or section that a card was drawn without
- each miss, with its group, the expected card, the card drawn and what the model said
- the calls, the tokens, the time of each call and the slowest call

Three options help.

- `npm run formats -- --fake` runs the same script with the fake model. Use it to see that the script works. Its score means nothing.
- `npm run formats -- --save out.json` also writes each sample's rule card, the model's reply, the verdict on the reply and the card drawn.
- `npm run formats -- --replay out.json` puts the replies that a run saved through the Renderer as it is now, with no model. Use it to see what a change to a check makes of answers the model already gave. A sample the saved run did not ask about gets no answer.

The Renderer asks the model only about text that the rules drew as a `note` or an `idea`, with at least 40 characters, or at least 16 in a script written without spaces. That is 70 of the 167 samples: 23 of the reviewers' and all 47 of the authors'.

## The fifth round: the whole item

Four rounds checked the part of an item a card shows, and each verifier found cards that changed what the item says. The last found 76 leaks in 86 probes of the fourth round. Every round had assumed the same thing: that a card may show a chosen part of its item, and that a check on strings can tell whether the part it leaves out changes the meaning of the part it shows. What governs a part may stand anywhere in the item: a heading, a heading over that heading, a sentence two before, the paragraph before, a cross before a line, the row a cell sits in, the sentence that names a speaker, the question an answer answers, a condition on the next line, a sign before a number. No table of words closes that. The verifier built a card for each of 76 negations that no table held.

Since 14 November 2026 a structured card shows its whole item. Its structure changes how the item is laid out and which part is set apart, and never what of it is shown.

- A card's words, read in its order, are every word and mark of its item's text, in the item's order. Steps, entries, rows and states are compared by position, never found by searching for their words, so a repeated sentence elsewhere cannot stand in for them and a step out of order is refused.
- The card draws the item's headings, the labels that open its lines and up to 280 characters of opening prose (140 in a script written without spaces) over its structure, at most six lines, each as the item writes it. `Grounding.shows` finds them and the Renderer sets them as `above`; no model writes them. So "Don'ts:" stands over the list under it, and "Three claims about colds that are all false." over the claims.
- Every mark is a word of its line: ✗, ✓, ❌, ✅, ▼, ▲, ↓, ↑, brackets, signs, the minus sign "−" with a space after it, a question mark, quotation marks inside a passage, ">" and a speaker's "A:". A check box is read off its line for a checklist, and a tick or a cross written on a line is never a check box.
- A card never draws the string a reply gave. The reply points at the item, the words are matched in their plain form, and the card draws the slice of the item they stand on, by position, in the item's own characters: its case, its stops, its signs and the quotation marks around the slice. A list line `- "Vaccines cause autism."` keeps its marks. A quote card draws its own marks, so it leaves out a pair the item sets around the words, and never one mark of the pair.
- The item's numbers are the card's to draw only when its numbered lines count 1, 2, 3 and on, in order, as a steps card counts them. A countdown, years such as "2019. We moved to Leeds." and a list that starts again keep their numbers as words of their lines, so a list draws them as written and a steps card is refused. A steps card is refused too when some of its steps are numbered lines and others are not, as a "PS:" after three numbered steps. An entry of a list, a step or a point stands on one line: a heading under it is never a part of it.
- A table is every row and every cell of one table, each cell at its own row and column, an empty one too. A label or a value stands in one cell, or on one line. A facts grid or a chart drawn from a table of two columns reads across the row, the label first, and carries the table's heads row as `heads`, drawn over it.
- A value is one whole number with its sign: no label ends in the sign word or mark of the value after it ("minus", "negative", 负, 零下, "▼"), on the value's line or the line over it, and no label and value share one number, as "1/2 tablet" or "4,5 mg" would.
- A label is the item's own words beside its value, as its line or row writes them. A card's slots may stand for the marks that say the same: a question and answer card for "Q:" and "A:", an excerpt for a ">" before its passage and a line that says "At:", a quote for the words that say who spoke, and a pros and cons card for the item's own heading or label of each side, which it draws as `heads` over each column.
- A meaning opens with its whole term, which ends where a word does (in Chinese, before a mark or a word that says what it is, as 是, 指 and 就是 do), or the term labels the line it opens: a term on a line of its own may head the meaning of another word. 病毒 is no term of "病毒性肺炎是…".
- A quote's speaker said the words: they stand inside a pair of the item's quotation marks, or apart from the speaker by a colon, a comma or a dash, or on a line of their own. "Mum said nothing at all. Dad said, …" quotes nothing of Mum's.
- A question and answer card holds one question and its answer, never an answer that runs on into the next question.
- An explorable's state is named by the label of its own line: the state's words open with the name and a colon, or the name labels or heads the line they are on. Names read off an "A vs B" line, or swapped against the lines they label, are refused.
- A note may set apart a whole sentence, line or cell among its first 180 characters (90), and draws it where it stands. A person card shows its whole item, the name and the line that says who they are, or the item is a note: a role line never hides "Struck off in March 2026…" under it.
- A member's line in an arrangement, the reason a ranked or matrix member stands where it does or the change between two states, is that member's whole text, drawn as the member writes it.
- Values that are tokens, such as numbers, dates, names, the labels of an arrangement's members, a timeline's dates, a map's places and an explorable's stated values, keep the check that their words stand in the item. A number there is one token with its sign: a comparison cell "3%" of a member that says "Margin: -3%" is refused.
- A sheet's figures, list or table may stand under the item's own label for them, as `label`, so a list stands under "Best:".
- What does not fit a card's room is drawn as a note, which shows the whole item. No section, entry, row or passage is cut to fit.

Deleted with the premise: the reversing-word table and the test of the units beside and over a passage, the rules that joined a line to the next, the quotation and speech-verb heuristics, the label words read in their other forms, the floor of a sheet's opening, the share a card must show of its item (a palette, which shows the colours of its item and not its words, keeps it), and the dropping of a figure, an entry or a row that fails. Kept for token values: the number reader with its sign, brackets around money and magnitudes, which the comparison cell above needs.

### What it measured

The premise was first measured as a filter after the fourth round's checks, before any code changed, over every probe set, 11 probes written against the premise itself, the verifier's 76 negations as cards, and three saved runs. A form of it that let a card show one section of its item under the section's headings leaked 8 of the 11, because what governs a section may stand in another. The whole item held all of them.

After the change no probe in any set reaches a view with a meaning its item does not have. Every card drawn for a hostile probe shows its whole item, with the lines over its structure drawn above it.

| Saved run | Reviewers, rules | Reviewers, with the model | Authors, rules | Authors, with the model |
|---|---|---|---|---|
| Third round, first live run | 109 | 109 | 26 | 39 |
| Third round, second live run | 109 | 108 | 26 | 40 |
| First verifier's run | 109 | 109 | 26 | 41 |

### What a card still sets large

A card shows its whole item, and its layout still chooses what to set large. These pass every check:

- A reply that gave a structure without the lead that denies it is drawn with the lead over it: "False:" over the callout "antibiotics cure the flu.", "Don't:" over the list. The words are all there, in order, and the structure is set larger than the line over it.
- A callout draws its tone, "Caution" or "Note" and their Chinese, beside its text. That word is the one label a card still writes itself.
- A fact card may set one figure of two large, with the other in the line over it: "Staff turnover | 4%" under "Profit margin: -3%.".
- A note sets apart a whole sentence where it stands, which may be a turn of a dialogue only when the dialogue's speakers are no labels.

Against the integration head before this round, the reviewers' fall from 112 to 109 on the rules and from 112, 111 and 112 to 109, 108 and 109 with the model. The authors' with the model go from 41, 41 and 40 to 39, 40 and 41. What the model loses: callouts of one sentence out of two (`C10`, `C14`, `C15`), sheets that pick figures out of a long item (`C03`, `C05`), and facts under labels the model wrote (`C24`). Gained: definitions the text gives whole (`C26`, `D04`). No live run was allowed, so the new prompts are unmeasured; the saved replies were written to the old ones.

## The fourth round: whole units

Three rounds of checks each let through a card that changed what its item says, and each was found by the next verifier. The last found 34 in 50 fresh probes, such as "Do not take ibuprofen with warfarin." shown as the list entry "take ibuprofen with warfarin". Every round had assumed the same thing: that a card may show part of a sentence, a passage without its lead, or a label word the text does not write, and that a check on strings can tell when that part keeps the item's meaning. It cannot. "take ibuprofen with warfarin", "You can" of "You can, unless…", a sentence the next one calls false, and "3%" of "-3%" each pass any reasonable test of substrings.

Since 14 November 2026 every text a card shows, on the model's path and in what Intake keeps, is whole units of its item, as the text writes them once white space is folded.

- A unit is one whole sentence, one list line without its bullet or number, one table cell, or a line that stands by itself. A line with no end punctuation ends its unit at the line break, unless the next line opens in lower case or with a joining word, or the line opens with a condition or ends with a word that ties. A short line that stands by itself is a heading. A line that ends in a colon labels the lines under it.
- A full stop after an abbreviation ends a sentence only before a capital that opens no other abbreviation. "Dr." and "e.g." end none. After a number and its unit, a full stop ends a sentence before a capital, a digit or a CJK character.
- A callout, an excerpt, a list entry, a step, a question's answer, a sheet's text and a quote are refused when the unit before them or after them in the same paragraph, or the heading or label they sit under, holds a word of the table `REVERSING` in `grounding.ts`. The table has one list for English and one for Chinese, and each word is tested. It over-refuses on purpose. A refused card falls back to the rules' card.
- A meaning is whole sentences, the first of which opens with its term. A quote may also be the whole of a quotation inside a sentence that says no more than who said it.
- A point for or against and the words a note sets large are whole units too, whatever stands beside them.
- A label stands only in words of its value's own unit, or in the head of a table cell's column, in their other forms. It may not open or end with a word that ties, an article included. No word for a kind of value is allowed in its place: "Height" names no "330 m long".
- A minus sign, "负", "零下", "minus", brackets around money and a magnitude word after the number belong to the number. "3%" is not stated by "-3%", "£1.3m" not by "(£1.3m)", and "800" not by "800 thousand".
- A figure, a list entry or a row that fails is left out and the card is kept if it still stands. A callout, a meaning or an answer that fails sends the card back to the rules'.

The model's prompt and Intake's now ask for whole sentences and lines. No live run was allowed in this round, so the prompts are unmeasured.

### What it closed and what it cost

The replacement was first measured as a filter after the third round's checks, over every probe set and saved reply, before any code changed. In the round-three verifier's probes it closed 41 of 42 leaks. The one left drew a note without the emphasis that dropped "not", which is the note itself. It refused 4 honest probes there, each a callout given without its "Results:" or "NB:".

After the change, no probe in any set reaches a view with a meaning its item does not have. The first verifier's hostile set draws 11 cards, against 13 before. Two are the accepted class of a stated value under the wrong label of one sentence (`H19`, `H20`). The swapped pros and cons of `H28` are refused now. Two probes found leaks in the brief's line rule, "You may drive⏎only after the drowsiness has passed." and "服药期间请勿⏎饮酒…". The line rule now joins such lines, and 勿 is in the table. Honest probes refused by design: passages given without their marker, meanings given as the rest of a sentence, lists cut out of one sentence, and labels that relied on a word for a kind of value.

Three saved runs were replayed: the two live runs of the third round and the first verifier's run.

| Saved run | Reviewers, rules | Reviewers, with the model | Authors, rules | Authors, with the model |
|---|---|---|---|---|
| Third round, first live run | 112 | 112 | 21 | 36 |
| Third round, second live run | 112 | 111 | 21 | 35 |
| First verifier's run | 112 | 112 | 21 | 36 |

The model's score on the reviewers' 120 is below the 116 the rules drew before this round. It is not below the rules' 112 now, except by one card in one run. The rules' card is the fallback, so the drop is a safe outcome, and it is a drop. On the authors' 47 the model falls from 45 to 47 to 35 or 36, because the saved replies give meanings as the rest of a sentence, lists and points cut out of one, quotes without their speaker's sentence, and callouts without their marker. A live run with the new prompt is the next measure.

Intake keeps 32 of 55 honest figures in the 40 replies of `/tmp/swarm-g5/a-round2-worker-1b/s/intake.mts`, against 44 before. The labels it loses are synonyms or add a word for a kind of value. All 12 charts are kept.

One option was measured and not adopted: when a figure's label fails, take the words just before its value in its unit as the label. It restored five of the six cards the verifier found worse than before G5, with good labels in Chinese (月租, 利润, 半马用时). In English it built labels out of verb phrases whose trimmed word carried the sense, "bill went up | £82" from "went up from £82", and labels that say nothing, "It | 1,149 m".

`C24` draws no facts card in two of the three runs: two of its three labels end with "is", which ties, and one figure is no facts card. Its card falls back to the note, as before this round.

## The scores before the fourth round

Measured on 14 November 2026 with `muse-spark-1.3`, in two runs of the same code, after the third round of checks.

| Reviewers' 120 | All | Research | Brainstorming | Memories | English | Chinese |
|---|---|---|---|---|---|---|
| Rules alone | 116 of 120 | 39 of 40 | 37 of 40 | 40 of 40 | 75 of 78 | 41 of 42 |
| With the model, first run | 116 of 120 | 39 of 40 | 37 of 40 | 40 of 40 | 75 of 78 | 41 of 42 |
| With the model, second run | 114 of 120 | 39 of 40 | 35 of 40 | 40 of 40 | 73 of 78 | 41 of 42 |

| Authors' 47 | All | Research | Brainstorming | Memories | English | Chinese |
|---|---|---|---|---|---|---|
| Rules alone | 21 of 47 | 5 of 18 | 7 of 15 | 9 of 14 | 13 of 24 | 8 of 23 |
| With the model, first run | 46 of 47 | 17 of 18 | 15 of 15 | 14 of 14 | 23 of 24 | 23 of 23 |
| With the model, second run | 45 of 47 | 17 of 18 | 14 of 15 | 14 of 14 | 22 of 24 | 23 of 23 |

| | First run | Second run |
|---|---|---|
| Asked and answered | 70 and 70 | 70 and 70 |
| Cards the model changed, reviewers | 6: 0 right, 0 wrong, 6 neither | 5: 0 right, 2 wrong, 3 neither |
| Cards the model changed, authors | 35: 25 right, 0 wrong, 10 neither | 36: 25 right, 1 wrong, 10 neither |
| Answers a check refused | 4 | 4 |
| Figures, entries, rows and sections left out of a card | 14 | 9 |
| Calls | 9 | 9 |
| Tokens | 48,447 | 47,435 |
| Slowest call | 44.8 seconds | 49.8 seconds |

### What the scores show

On the reviewers' 120 the rules agree with a person on 116 items. With the model the first run also gives 116, and the second 114. The model's two wrong cards there, in the second run, are `A-B07`, a plan drawn as steps where the key accepts a list, and `A-B18`, an assistant's answer drawn as a definition of "Three tiers" from the term's own sentence. Every other card it changed there is one the key accepts beside the rule's card. The model's gain is all on the authors' 47, from 21 to 46 and 45.

Two runs of the same code differ by up to 3 in a group. Treat such a difference as noise, and run twice before you conclude that a change helped or hurt.

### The misses in the two runs

| Samples | Group | Expected | Drawn | Runs | Why |
|---|---|---|---|---|---|
| `A-R17`, `A-B16` | Reviewers | `code` | `note` | Both | Intake did not mark the paste as code, and the model cannot choose `code`. |
| `B-B24` | Reviewers | `chat` | `note` | Both | Intake did not read the paste as a conversation. In the second run the model drew it as a question and its answer, which is refused, since its turns open with a name and a colon. |
| `A-B19` | Reviewers | `note` | `excerpt` | Both | A rule draws a page the Scout picked as its passage. |
| `A-B07`, `A-B18` | Reviewers | `note` or `list` | `steps`, `definition` | Second | See above. |
| `C24` | Authors | `facts` | `note` | Both | The model labelled two of the three figures "a day there is" and "gravity at the surface is". A label that ends with a word that only ties is a piece cut out of the sentence, so two figures are left out, and one figure is no facts card. |
| `C32` | Authors | `note` | `list` | Second | A musing drawn as a sheet, of which the list alone is half and so is drawn as its own card. |

The model writes a label as the words just before its value. In both runs it wrote labels that end with "is", "was", "by", "是" or "在" in five or six sheets of the authors' and in `C24`, and most of the 14 and 9 parts left out above are those. The prompt does not yet ask for a label that opens and ends with a word that names something. That change is not measured, so it is not made.

### What the third round of checks did to answers the model gave before

The checks changed again on 14 November 2026, after a verifier showed that the second round let a card turn a text around: "Wrong: store the vaccine in the freezer." became a caution that says to store it in the freezer.

- A passage opens after a colon only where the words before the colon are a marker that says what follows matters: Caution, Note, Warning, Important, Reminder, Tip, 注意, 提醒, 小心, 警告, 提示, and the parts of a paper's abstract, such as Background and Results. "Wrong:", "Myth:", "Don't:", "禁止：" and "错误：" open none.
- A passage opens at a quotation mark only as someone's words, on a quote card, and only when the quoted words are a sentence of their own: opened after a colon, a comma or at a sentence start, closed by a full stop or before a comma, and not the rest of a quotation the sentence broke.
- A line break is a passage edge only after a sentence end or a list item, before a list item, or at an empty line, so "Do not⏎take ibuprofen" is one sentence. A label and its value stand on one line all the same.
- A full stop after a number, its unit or its ordinal ends a sentence before a capital, a digit, a CJK character or the end of the text: "due on the 1st. The deposit".
- A meaning is the sentence that opens with its term, or the rest of it after a link. A sentence that opens with someone else's view, as "Some say" and "有人说" do, opens with no term.
- A label's words stand in their other forms: "slept" for "sleep", "Jan" for "January", "one" for "1". A label need not hold the words that only tie it ("of", "per", "的"), may add a word for its kind of value where the value is of that kind ("Weight" for "1.3 kg", not for "88 cm"), and may not open or end with a word that ties: "of the five-day group" and "成本却要" are pieces cut out of a phrase.
- An entry out of a sentence that opens with If, When, Unless, 如果 or 要是 is left out, and a text whose lines open with names and colons keeps its note.

`--replay` put the replies of nine saved runs through these checks. The first seven were saved with the first round's prompt, the last two with the second round's. Both columns of each group use the key as it is now.

| Saved run | Reviewers, second round | Reviewers, now | Authors, second round | Authors, now | Refused now |
|---|---|---|---|---|---|
| 1 | 115 | 116 | 47 | 47 | 8 |
| 2 | 115 | 116 | 34 | 35 | 9 |
| 3 | 115 | 116 | 34 | 34 | 5 |
| 4 | 113 | 115 | 35 | 35 | 5 |
| 5 | 115 | 116 | 34 | 34 | 10 |
| 6 | 115 | 116 | 44 | 46 | 11 |
| 7 | 114 | 116 | 46 | 47 | 8 |
| 8 | 115 | 116 | 46 | 47 | 7 |
| 9 | 115 | 116 | 47 | 46 | 6 |

Runs 2 to 5 hold answers for 31 of the authors' 47, so their authors' column is low in both rounds. On the reviewers' items the model now matches the rules in eight runs of nine. It makes a reviewers' card worse in one saved reply, `B-B14` drawn as a question and its answer. The second round let twelve through: `A-B15` in eight, `B-M11` in three and `B-B14` in one.

Of the 566 saved replies, 497 now draw a card, against 515 in the second round. 22 that drew then are refused now. 21 are cards that changed what their text says: `A-B15` as a list, steps or a sheet without its conditions in eight replies, `B-B24` and `B-M11` taken apart in ten, and `C36` defined from a sentence that does not open with the term in three. The 22nd, `C24` in one reply, was stated: its labels "a day there is" and "gravity at the surface is" end with a word that ties, so two of its three figures are left out, and one figure is no facts card. 4 that were refused then draw now: `B-R03`'s sheet after "Background:", and `C03`, `C06` and `C24`, whose labels are in other forms of the text's words.

The second round refused 19 stated cards, counting each saved reply once. 4 of them draw now. 4 are sheets of `C09` that the verifiers judged bad, which the floor below still refuses, and 2 are sheets of `C03` whose text opens after "总体的感受是，" and are under the floor without it. 9 stated cards are still refused. Three are refused by a check: `C11`, whose caution follows "Reminder for whoever is on call:", a lead that is no marker; `C01` in one run, whose labels are the model's own words ("increase", "weekly", "before"); and `C07` in one run, whose text opens after a comma. Six are sheets under a fifth of their item whose opening is too short at every floor tried below: `C07` in four runs opens with 13 characters, and `C04` with its second sentence. `C06` in one run opens with 83, and only a floor of 60 or less draws it.

Of the 12 cards the second round drew without a stated part, 10 now keep it. The two that do not are `C05`, whose text follows "先说结论：", a lead that is no marker.

### The floor of a sheet's opening

Under a fifth of its item, a sheet stands only when it opens with the item's own opening, of at least `ROOM.opening` characters. The nine saved runs were replayed at four floors.

| Floor, spaced and spaceless | Reviewers, summed over nine runs | Authors, summed over nine runs | Sheets drawn | Sheets refused as small |
|---|---|---|---|---|
| 40 and 20 | 1,033 of 1,080 | 371 of 423 | 58 | 17 |
| 60 and 30 | 1,033 of 1,080 | 371 of 423 | 58 | 17 |
| 90 and 45 | 1,033 of 1,080 | 371 of 423 | 56 | 19 |
| 120 and 60 | 1,034 of 1,080 | 371 of 423 | 55 | 20 |

Three sheets depend on the floor. `C06` and `C09` in one run each are refused from 90 up, and `A-R11`, a paragraph and a passing number that the reviewers expect as a note, only at 120. The floor stays at 120 and 60, the lowest that refuses both sheets the verifiers judged bad.

### A rule that was measured and not added

One more rule was tried on the saved replies of the second round: a card from the model takes the place of a note only when it shows at least half of the item, a sheet excepted. It changed no card of the reviewers' in any of the three runs it was tried on, because the three cards that still made a reviewers' item worse each showed more than half of it or were sheets. It refused right cards of the authors' that are small by nature, a chart, a facts card and two callouts, and took 1 or 2 off the authors' score in each run. The rule is not in the code.

### What no check can tell

The fourth round's list of what no check could tell is closed by the fifth: a unit denied in words no table holds, a quotation attributed in a word no table holds, a stated value under another value's label, and points on the wrong sides all fail the whole item. Which card suits an item is still the model's judgment. In the three replays the model's definition and list of `A-B18`, an assistant's answer, are refused as parts of it, and its list of `B-B14`, open questions, shows the whole item as a list a person would accept.

## The earlier scores

The scores below were measured on 14 November 2026 before the third round of checks.

| | Rules alone | Second round, first run | Second round, second run |
|---|---|---|---|
| Reviewers' 120 | 116 | 115 | 115 |
| Authors' 47 | 21 | 46 | 47 |

In those two runs the model changed nine of the reviewers' cards in each. One, `A-B15`, made a hit a miss. Seven are cards the key accepts beside the rule's card, and one, `B-B24` drawn as a question and its answer, was a miss before and after.

The second round of checks was replayed then on three runs saved before it. It refused the 1,000-character letter `A-M16` drawn as a quote, in the two of the three runs that drew it so, the sheet of `A-R11`, and the quote `D07`. It left 1, 3 and 6 figures, entries and sections out of cards that still stood. A verifier later replayed it on all nine saved runs and found that it also refused 19 stated cards, most of them sheets under the floor and cards with labels in other forms of the text's words. On the rule path it made `B-B12` and `B-M08` notes, so the rules drew 110 of the reviewers' items exactly as picked, against 112.

The first two live runs of all, before any of these checks, are given by group here. The page used to give them as one sum, 156 and 159 of 167 against 129 by rule, and all of that gain was on the authors' samples.

| | Rules alone | First run | Second run | A third, independent run |
|---|---|---|---|---|
| Reviewers' 120 | 116 | 115 | 113 | 113 |
| Authors' 47 | 13 | 41 | 46 | 44 |

The first baseline of all was measured the same day on the first 157 samples, 120 of the reviewers' and 37 of the authors'. Then the rules drew any Chinese text of under 60 characters as an `idea`, the model was asked about 53 samples in calls of twelve, and it could not answer `idea`. With the model the sum was 145 of 157 against 128 by rule.

## Change the key

Change `expect` or `accept` only where a person would agree, and record the change here. Do not change the key to match what the model said.

| Sample | Change | When | Why |
|---|---|---|---|
| `A-R10`, `B-R03`, `B-M03` | `accept` gains `sheet` | Before the first live run | Each is a long item with a key figure or one remembered line. The reviewers wrote the key before `sheet` existed. |
| `A-B07` | `accept` gains `list` | After three live runs | The model drew the plan as a list each time. The list holds every sentence of the plan. |
| `A-B18` | `accept` gains `list` | After three live runs | The model drew the three tiers as a list each time. The list holds all three under the title "Three tiers". |
| `C01` | `accept` gains `note` | After an independent review | A 1,000-character summary of a study. `B-R03`, an abstract of the same kind in the reviewers' set, expects `note`. |
| `C02` | `accept` gains `note` | After an independent review | An 850-character write-up of an interview. A note of it is the write-up. |
| `C04` | `accept` gains `note` | After an independent review | 900 characters of meeting notes in prose. A note shows their opening, as the notes were written. |
| `C06` | `accept` gains `note` | After an independent review | A 930-character journal entry. `B-M03`, a journal entry in the reviewers' set, expects `note`, and `C09` already accepts it. |
| `C07` | `accept` gains `note` | After an independent review | A 280-character journal entry in Chinese, of the same kind as `C06`. |
| `D07` | `accept` gains `note` | After an independent review | A question and what the father said, in 32 characters. A note shows every word. |
| `D09`, `D10` | `accept` gains `note` | After an independent review | An idea of 33 characters. A note shows every word, and the reviewers' own ideas of that length, `A-B03`, `B-B01` and `B-B18`, accept `note`. |

All eight make the key harder on the model: the rules draw each of the eight as a note, so the rules' score on the authors' samples rose from 13 to 21 and the model's did not.
