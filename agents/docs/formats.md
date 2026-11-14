# The format sample set

The Renderer picks one card type for each item. The sample set says whether a change made that choice better or worse. It holds 167 realistic items, and each item names the card a person would pick for it.

The set has two groups, and every score is given for each group apart.

- The reviewers' 120. Two independent reviewers each wrote sixty items and their keys before the model chose any card.
- The authors' 47. The authors of the model's choice wrote these for the kinds of content that no rule can draw.

On the reviewers' items the model does not beat the rules. Its gain is on the authors' items, which are the content it was added to draw: sheets, callouts, and structure that Intake did not extract. Never add the two groups into one score. The sum says how many items of each kind the set holds, and little about the model.

A change to a rule, to a check or to the Renderer's prompt must not lower the rules' score or the model's score in either group. If a score drops, fix the change.

## What the set holds

The set is `test/fixtures/formats.json`. Each entry has these fields.

| Field | Meaning |
|---|---|
| `key` | A short name. `A-` and `B-` items come from two reviewers who each wrote sixty items. `C` and `D` items were written for the model. |
| `origin` | `reviewers` for the `A-` and `B-` items, `authors` for the `C` and `D` items. |
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

## Score the rules

```
npm test
```

`test/formats.test.ts` draws every sample with `byRule` and counts the samples where the card is the expected one or an accepted one. The test holds the count for each group and activity in `RULES_AGREE`, and the count of samples drawn as the very card a person picked in `RULES_EXACT`. A rule change that lowers a count fails the test. Raise a count when a rule change earns it.

| Rules alone | All | Exactly as picked | Research | Brainstorming | Memories |
|---|---|---|---|---|---|
| Reviewers | 116 of 120 | 112 of 120 | 39 of 40 | 37 of 40 | 40 of 40 |
| Authors | 21 of 47 | 10 of 47 | 5 of 18 | 7 of 15 | 9 of 14 |

The second round of checks had made `B-B12` and `B-M08` notes, because their labels add "per" and "time" to the text's words, and the rules drew 110 of the reviewers' items exactly as picked. The label check now reads a label's words in their other forms and passes over the words that only tie it, and the two are facts and a fact again.

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

## The scores

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

Of the 566 saved replies, 497 now draw a card, against 515 in the second round. 22 that drew then are refused now, each a card that changed what its text says: `A-B15` as a list, steps or a sheet without its conditions in eight replies, `B-B24` and `B-M11` taken apart in ten, `C36` defined from a sentence that does not open with the term in three, and `C24` in one, whose labels "a day there is" and "gravity at the surface is" are pieces cut out of the sentence. 4 that were refused then draw now: `B-R03`'s sheet after "Background:", and `C03`, `C06` and `C24`, whose labels are in other forms of the text's words.

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

A check reads whether words stand in the item and where. It does not read what they mean. These cards pass every check and are still worse than the note, or could be.

- `A-B18`. An assistant's answer drawn as the definition of "Three tiers", from the sentence that opens with it.
- `B-B14`. Open questions drawn as a question and its answer.
- Points for and points against on the wrong sides. Each point is stated.
- A stated value under the label of another value of the same sentence, as in a chart whose numbers are in another order than their months.
- A word for a kind of value on a value of that kind that the text calls something else: "Price" for "The deposit is £900", or "Height" for "30 cm wide".
- A line that ends no sentence runs on into the next, so a heading line with no full stop, as "Weekend in Porto⏎We took the early train", opens no passage after it. 22 of the 167 items hold such a line. No saved reply was refused for it.

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
