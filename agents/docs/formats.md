# The format sample set

The Renderer picks one card type for each item. The sample set says whether a change made that choice better or worse. It holds 157 realistic items, and each item names the card a person would pick for it.

A change to a rule or to the Renderer's prompt must not lower either score below. If a score drops, fix the rule or the prompt.

## What the set holds

The set is `test/fixtures/formats.json`. Each entry has these fields.

| Field | Meaning |
|---|---|
| `key` | A short name. `A-` and `B-` items come from two reviewers who each wrote sixty items. Items with no prefix were written for the model. |
| `activity` | `research`, `brainstorming` or `memories`. |
| `language` | `en` or `zh`. |
| `what` | What the user did to make the item. |
| `expect` | The card a person would pick. |
| `accept` | Other cards a person would not mind. |
| `item` | The item as Intake or the Scout built it. |

Each `item` was built once, by passing a scripted model reply through the real `structure()` and `labels()`. The fixture stores the result, so no test needs a model. To add a sample, build its item the same way and append the entry.

The 157 items split as follows.

| | Research | Brainstorming | Memories | English | Chinese |
|---|---|---|---|---|---|
| Items | 55 | 51 | 51 | 102 | 55 |

The 37 items written for the model are of four kinds:

- Nine long items with a small structure worth showing, such as a report with three key figures. The expected card is `sheet`.
- Six cautions. The expected card is `callout`.
- Thirteen paragraphs that hold a definition, a question and its answer, points for and against, a list, figures, a series or a quotation that Intake did not extract.
- Nine pieces of prose where `note` is right and the model must not find a structure.

## Score the rules

```
npm test
```

`test/formats.test.ts` draws every sample with `byRule` and counts the samples where the card is the expected one or an accepted one. The test holds the count for each activity in `RULES_AGREE`. A rule change that lowers a count fails the test. Raise a count when a rule change earns it.

## Score the Renderer with the live model

```
npm run formats
```

The script runs the real Renderer over the set with the live model. It needs `MODEL_API_KEY` in `~/.muse-garden.env`. One run makes 5 model calls, spends about 33,000 tokens and takes about 70 seconds.

The script prints:

- agreement for the rules alone and with the model, overall and by activity, language and expected card
- each card the model changed, and whether the change is right, wrong or neither by the key
- each answer the content check refused, with the reason
- each miss, with the expected card, the card drawn and what the model said
- the calls, the tokens and the time of each call

Two options help.

- `npm run formats -- --fake` runs the same script with the fake model. Use it to see that the script works. Its score means nothing.
- `npm run formats -- --save out.json` also writes each sample's rule card, the model's reply, the verdict on the reply and the card drawn.

The Renderer asks the model only about text that the rules drew as a `note`, with at least 40 characters. That is 53 of the 157 samples.

## The baseline

Measured on 14 November 2026 with `muse-spark-1.3`.

| | All | Research | Brainstorming | Memories | English | Chinese |
|---|---|---|---|---|---|---|
| Rules alone | 128 of 157 | 42 of 55 | 41 of 51 | 45 of 51 | 84 of 102 | 44 of 55 |
| With the model | 145 of 157 | 51 of 55 | 46 of 51 | 48 of 51 | 97 of 102 | 48 of 55 |

In the baseline run the model answered for all 53 samples it was asked about, and no answer was invalid. The model changed 27 cards. By the key, 18 changes are right, 1 is wrong and 8 are neither. The content check refused 3 answers, each because the card would show under a fifth of its item.

A second run of the same prompt also scored 145, with 19 right changes and 2 wrong ones. Three runs of other wordings of the prompt scored 142 to 143. Treat a difference of 2 between two runs as noise, and run twice before you conclude that a prompt change helped.

## The misses in the baseline run

| Samples | Expected | Drawn | Why |
|---|---|---|---|
| `A-R17`, `A-B16` | `code` | `note` | Intake did not mark the paste as code, and the model cannot choose `code`. |
| `B-B24` | `chat` | `qa` | Intake did not read the paste as a conversation. |
| `A-B19` | `note` | `excerpt` | A rule draws a page the Scout picked as its passage. |
| `C12`, `C13`, `C14`, `C17`, `C19`, `C21` | `callout`, `definition`, `qa`, `proscons` | `idea` | The rules draw a Chinese text of under 60 characters as an `idea`, so the model is never asked. `C12` is also under 40 characters. |
| `B-M11` | `note` | `sheet` | The model made a sheet of a family message thread. |
| `C02` | `sheet` | `note` | The model chose `quote` for one quoted line in a long interview. The line is under a fifth of the item, so the note stayed. |

## Change the key

Change `expect` or `accept` only where a person would agree, and record the change here. Do not change the key to match what the model said.

| Sample | Change | When | Why |
|---|---|---|---|
| `A-R10`, `B-R03`, `B-M03` | `accept` gains `sheet` | Before the first live run | Each is a long item with a key figure or one remembered line. The reviewers wrote the key before `sheet` existed. |
| `A-B07` | `accept` gains `list` | After three live runs | The model drew the plan as a list each time. The list holds every sentence of the plan. |
| `A-B18` | `accept` gains `list` | After three live runs | The model drew the three tiers as a list each time. The list holds all three under the title "Three tiers". |
