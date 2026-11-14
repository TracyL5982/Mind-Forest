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
- `size(item, props)` is the card's footprint in px. It is worked out from the content and never measured, so the field can be laid out before anything is drawn. A card whose text is longer gets a taller footprint, up to a cap, and the text is cut with an ellipsis past that.
- Text on the field is set in three sizes, named `--type-display`, `--type-title` and `--type-text` in `client/style.css`.
- Each type has its own face, so types can be told apart when zoomed out. A note is plain. A quote is a serif on a face washed with the tree's colour. A fact is one large figure on a darker face. A picture or clip has square corners and its caption on a plate below. A link sits under an address bar. A chart has gridlines and a scale. A person is a name tag with a round end. A chat is speech bubbles. Code is fixed-width with a numbered gutter. Steps are numbers down a rail.
- A card's marks take its tree's colour. While the card is a pick they are amber and its border is dashed. Teal is used only for links between cards.
- A small badge names the kind where the look alone would leave it unclear: on a group frame, a clip, a chat and a code card.
- A group frame is a faint wash and a hairline.

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
- **Drawn as** bars or a line over gridlines, with a scale down the left side. The marked bar or point is brighter and carries its value. With six values or fewer every value is written. With more than eight, the card writes only the first, last and marked labels, and the opened card writes them all.
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
- **Item holds.** `data.messages = [{ role, text }]`.

The excerpt is the first user message, the longest assistant reply, and the user message just before that reply. System messages are left out.

### code

- **Chosen when** `item.data.code` holds a source, or the item's kind is `code`.
- **Props.** `language`: `text` when unknown. `source`.
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
