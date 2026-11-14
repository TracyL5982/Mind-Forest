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

Intake now keeps a figure only under a label whose words stand in the sentence, line or table row of its value. Two stored items, `B-B12` and `B-M08`, were built before that and carry labels that Intake would drop today. They stay as they are, because they hold the Renderer to the same check on an item an older Intake made.

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

Six more, the `E` items, were written with the explorable card on 14 November 2026, after every run this page reports, so the counts and scores here are of the 167 before them and no live run has scored them yet. They are explainers, one for each activity in each language: a value that follows from another by a formula, as the field of view follows the focal length, or one thing in two to four states, as a dolly zoom shot three ways. The expected card is `explorable`. Intake extracted nothing from any of them, so the rules draw each as a note.

## Score the rules

```
npm test
```

`test/formats.test.ts` draws every sample with `byRule` and counts the samples where the card is the expected one or an accepted one. The test holds the count for each group and activity in `RULES_AGREE`. A rule change that lowers a count fails the test. Raise a count when a rule change earns it.

| Rules alone | All | Research | Brainstorming | Memories |
|---|---|---|---|---|
| Reviewers | 116 of 120 | 39 of 40 | 37 of 40 | 40 of 40 |
| Authors | 21 of 47 | 5 of 18 | 7 of 15 | 9 of 14 |

## Score the Renderer with the live model

```
npm run formats
```

The script runs the real Renderer over the set with the live model. It needs `MODEL_API_KEY` in `~/.muse-garden.env`. One run makes 9 model calls, spends about 54,000 tokens and takes about 80 seconds.

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

The Renderer asks the model only about text that the rules drew as a `note` or an `idea`, with at least 40 characters, or at least 16 in a script written without spaces. That is 72 of the 167 samples: 25 of the reviewers' and all 47 of the authors'.

## The scores

Measured on 14 November 2026 with `muse-spark-1.3`, in two runs of the same code.

| Reviewers' 120 | All | Research | Brainstorming | Memories | English | Chinese |
|---|---|---|---|---|---|---|
| Rules alone | 116 of 120 | 39 of 40 | 37 of 40 | 40 of 40 | 75 of 78 | 41 of 42 |
| With the model, first run | 115 of 120 | 39 of 40 | 36 of 40 | 40 of 40 | 74 of 78 | 41 of 42 |
| With the model, second run | 115 of 120 | 39 of 40 | 36 of 40 | 40 of 40 | 74 of 78 | 41 of 42 |

| Authors' 47 | All | Research | Brainstorming | Memories | English | Chinese |
|---|---|---|---|---|---|---|
| Rules alone | 21 of 47 | 5 of 18 | 7 of 15 | 9 of 14 | 13 of 24 | 8 of 23 |
| With the model, first run | 46 of 47 | 17 of 18 | 15 of 15 | 14 of 14 | 23 of 24 | 23 of 23 |
| With the model, second run | 47 of 47 | 18 of 18 | 15 of 15 | 14 of 14 | 24 of 24 | 23 of 23 |

| | First run | Second run |
|---|---|---|
| Asked and answered | 72 and 72 | 72 and 72 |
| Cards the model changed, reviewers | 9: 0 right, 1 wrong, 8 neither | 9: 0 right, 1 wrong, 8 neither |
| Cards the model changed, authors | 37: 26 right, 1 wrong, 10 neither | 36: 26 right, 0 wrong, 10 neither |
| Answers a check refused | 4 | 3 |
| Figures, entries, rows and sections left out of a card | 1 | 2 |
| Tokens | 54,444 | 50,215 |
| Slowest call | 78 seconds | 48 seconds |

### What the scores show

On the reviewers' 120 the rules agree with a person on 116 items and the model on 115 in both runs. The model changed nine of the 25 cards it was asked about there, in each run. No change turned a miss into a hit, and one turned a hit into a miss, `A-B15`. Eight are cards the key accepts beside the rule's card, such as a list of a plan the reviewers expected as a note. The model's gain is all on the authors' 47, from 21 to 46 and 47.

Two runs of the same code differ by up to 3 in a group. Treat such a difference as noise, and run twice before you conclude that a change helped or hurt.

### The misses in the two runs

| Samples | Group | Expected | Drawn | Runs | Why |
|---|---|---|---|---|---|
| `A-R17`, `A-B16` | Reviewers | `code` | `note` | Both | Intake did not mark the paste as code, and the model cannot choose `code`. |
| `B-B24` | Reviewers | `chat` | `qa` | Both | Intake did not read the paste as a conversation, and the model drew its first question and answer. |
| `A-B19` | Reviewers | `note` | `excerpt` | Both | A rule draws a page the Scout picked as its passage. |
| `A-B15` | Reviewers | `note` | `list`, `sheet` | Both | The model made a list, and then a sheet, of a plan with a condition. This is the one card of the reviewers' that the model made worse. |
| `C36` | Authors | `note` | `definition` | First | The model drew a term that an essay explains in passing, with the term's own sentence as its meaning. |

### What the checks did to answers the model gave before

The checks changed on 14 November 2026. A card now names a value only in words of the value's sentence, line or table row. A callout, a quote, an excerpt and a meaning are whole passages. A quote, an excerpt or a callout is at most 400 characters, or 200 in a script written without spaces. A sheet shows a fifth of its item, or opens with the item's opening.

Three runs were saved before that change, with a prompt that let the model write a label in its own words. `--replay` put their replies through the new checks. Both columns use the key as it is now.

| Saved run | Reviewers, then | Reviewers, replayed | Authors, then | Authors, replayed | Answers refused in the replay |
|---|---|---|---|---|---|
| First | 115 | 115 | 45 | 44 | 9: 6 small, 1 label, 1 cut, 1 not an idea |
| Second | 113 | 114 | 46 | 46 | 8: 5 small, 2 cut, 1 long |
| Third | 113 | 115 | 47 | 47 | 6: 5 small, 1 long |

The replay refused these cards that made an item worse: the 1,000-character letter `A-M16` drawn as a quote, in all three runs, the sheet of `A-R11` that showed one sentence and a passing number, and the quote `D07` that dropped the question it answered. It left 8, 14 and 8 figures, entries and sections out of cards that still stood, most of them labels in the model's own words. With the prompt as it is now, the first live run left out 1.

### A rule that was measured and not added

One more rule was tried on the saved replies: a card from the model takes the place of a note only when it shows at least half of the item, a sheet excepted. It changed no card of the reviewers' in any of the three runs, because the three cards that still make a reviewers' item worse each show more than half of it or are sheets. It refused right cards of the authors' that are small by nature, a chart, a facts card and two callouts, and took 1 or 2 off the authors' score in each run. The rule is not in the code.

### What no check can tell

A check reads whether words stand in the item. It does not read what they mean. These cards pass every check and are still worse than the note.

- `A-B15`. A plan with a condition, "If she agrees" and "If she does not", drawn as a list or as steps. Every entry is stated, and the conditions are gone.
- `B-B24`. A pasted conversation of four turns, drawn as its first question and first answer. The advice of the last turn is not on the card.
- `B-M11`. A family message thread drawn as a sheet, with the speakers gone. One saved run of three.
- `C36`. An essay that explains a term in passing, drawn as a definition of that term.
- Points for and points against on the wrong sides. Each point is stated.
- A stated value under the label of another value of the same sentence, as in a chart whose numbers are in another order than their years.

## The earlier scores

The scores below were measured on 14 November 2026 before the checks changed, with the key as it was then. They are given by group here. The page used to give them as one sum, 156 and 159 of 167 against 129 by rule, and all of that gain was on the authors' samples.

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
