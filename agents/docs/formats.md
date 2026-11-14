# The format sample set

The Renderer picks one card type for each item. The sample set says whether a change made that choice better or worse. It holds 167 realistic items, and each item names the card a person would pick for it.

A change to a rule or to the Renderer's prompt must not lower either score below. If a score drops, fix the rule or the prompt.

## What the set holds

The set is `test/fixtures/formats.json`. Each entry has these fields.

| Field | Meaning |
|---|---|
| `key` | A short name. `A-` and `B-` items come from two reviewers who each wrote sixty items. `C` and `D` items were written for the model. |
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

The 167 items split as follows.

| | Research | Brainstorming | Memories | English | Chinese |
|---|---|---|---|---|---|
| Items | 58 | 55 | 54 | 102 | 65 |

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

`test/formats.test.ts` draws every sample with `byRule` and counts the samples where the card is the expected one or an accepted one. The test holds the count for each activity in `RULES_AGREE`. A rule change that lowers a count fails the test. Raise a count when a rule change earns it.

## Score the Renderer with the live model

```
npm run formats
```

The script runs the real Renderer over the set with the live model. It needs `MODEL_API_KEY` in `~/.muse-garden.env`. One run makes 9 model calls, spends about 51,000 tokens and takes about 70 seconds.

The script prints:

- agreement for the rules alone and with the model, overall and by activity, language and expected card
- each card the model changed, and whether the change is right, wrong or neither by the key
- each answer the content check refused, with the reason
- each miss, with the expected card, the card drawn and what the model said
- the calls, the tokens, the time of each call and the slowest call

Two options help.

- `npm run formats -- --fake` runs the same script with the fake model. Use it to see that the script works. Its score means nothing.
- `npm run formats -- --save out.json` also writes each sample's rule card, the model's reply, the verdict on the reply and the card drawn.

The Renderer asks the model only about text that the rules drew as a `note` or an `idea`, with at least 40 characters, or at least 16 in a script written without spaces. That is 70 of the 167 samples.

## The baseline

Measured on 14 November 2026 with `muse-spark-1.3`, in two runs of the same code.

| | All | Research | Brainstorming | Memories | English | Chinese |
|---|---|---|---|---|---|---|
| Rules alone | 129 of 167 | 42 of 58 | 42 of 55 | 45 of 54 | 84 of 102 | 45 of 65 |
| With the model, first run | 156 of 167 | 54 of 58 | 51 of 55 | 51 of 54 | 94 of 102 | 62 of 65 |
| With the model, second run | 159 of 167 | 57 of 58 | 51 of 55 | 51 of 54 | 96 of 102 | 63 of 65 |

In both runs the model answered for all 70 samples it was asked about, and no call failed.

| | First run | Second run |
|---|---|---|
| Cards the model changed | 41 | 46 |
| Right, wrong, neither by the key | 29, 2, 10 | 33, 3, 10 |
| Answers the content check refused | 4 | 1 |
| Tokens | 50,299 | 51,827 |
| Slowest call | 54 seconds | 66 seconds |

The two runs differ by 3. Treat a difference of 3 between two runs as noise, and run twice before you conclude that a prompt change helped.

A call takes longer the more it writes: in the first run the shortest reply took 18 seconds for 4,301 tokens and the longest 54 seconds for 8,071.

### The earlier baseline

The first baseline was measured the same day on the first 157 samples. Then the rules drew any Chinese text of under 60 characters as an `idea`, the model was asked about 53 samples in calls of twelve, and it could not answer `idea`.

| | All | Research | Brainstorming | Memories | English | Chinese |
|---|---|---|---|---|---|---|
| Rules alone | 128 of 157 | 42 of 55 | 41 of 51 | 45 of 51 | 84 of 102 | 44 of 55 |
| With the model, then | 145 of 157 | 51 of 55 | 46 of 51 | 48 of 51 | 97 of 102 | 48 of 55 |
| With the model, now, first run | 148 of 157 | 51 of 55 | 47 of 51 | 50 of 51 | 94 of 102 | 54 of 55 |
| With the model, now, second run | 150 of 157 | 54 of 55 | 47 of 51 | 49 of 51 | 96 of 102 | 54 of 55 |

The rules alone score the same on these 157. The six Chinese samples the idea rule used to take now go to the model, which drew all six as expected in both runs.

English is 1 and 3 lower than it was. One of the three is the label limit, on `C01` in the first run. The others are samples whose answer also changed from run to run before this change: `A-B15`, `A-M16`, `C06` and `C36`.

## The misses in the two runs

| Samples | Expected | Drawn | Runs | Why |
|---|---|---|---|---|
| `A-R17`, `A-B16` | `code` | `note` | Both | Intake did not mark the paste as code, and the model cannot choose `code`. |
| `B-B24` | `chat` | `qa` | Both | Intake did not read the paste as a conversation. |
| `A-B19` | `note` | `excerpt` | Both | A rule draws a page the Scout picked as its passage. |
| `A-B15` | `note` | `sheet` | Both | The model made a sheet of a plan that names one person. |
| `D07` | `qa` | `quote` | Both | The answer is what the father said, and the model drew his words as a quote. |
| `C01` | `sheet` | `note` | First | The model wrote a figure label of 41 characters. The limit is 40, so the figures were left out and one section is no sheet. In the second run the same label was left out and the sheet stood on its other sections. |
| `C02`, `C06` | `sheet` | `note` | First | The model answered `note`. |
| `C36` | `note` | `definition` | First | The model drew a term that an essay explains in passing. |
| `D10` | `idea` | `note` | First | The model answered `note` for a wish of 33 characters. |
| `A-M16` | `note` | `quote` | Second | The model drew one line of a long letter. In the first run the same answer was refused as under a fifth of the item. |
| `B-M11` | `note` | `sheet` | Second | The model made a sheet of a family message thread. |

## Change the key

Change `expect` or `accept` only where a person would agree, and record the change here. Do not change the key to match what the model said.

| Sample | Change | When | Why |
|---|---|---|---|
| `A-R10`, `B-R03`, `B-M03` | `accept` gains `sheet` | Before the first live run | Each is a long item with a key figure or one remembered line. The reviewers wrote the key before `sheet` existed. |
| `A-B07` | `accept` gains `list` | After three live runs | The model drew the plan as a list each time. The list holds every sentence of the plan. |
| `A-B18` | `accept` gains `list` | After three live runs | The model drew the three tiers as a list each time. The list holds all three under the title "Three tiers". |
