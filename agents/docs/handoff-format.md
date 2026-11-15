# Handoff bundle format

A handoff bundle carries part of a mindstorm out of Mind Palace so that another agent can continue the work. The receiving agent has no access to the app. The bundle holds everything the agent gets.

The Packager role builds the bundle in `src/core/roles/packager.ts`. This page describes format version 1.

## Files

The Packager returns a `name`, such as `dolly-zoom-handoff-2026-11-13`. The host in `src/node/server.ts` writes `<name>.zip`, which unpacks to one folder:

| File | Contents |
| --- | --- |
| `<name>/handoff.md` | The handoff as Markdown. Paste this file into the receiving agent. |
| `<name>/handoff.json` | The same content as data, for an agent or a script that parses the handoff. |
| `<name>/assets/<id>` | One file for each image, video, or document in the handoff. |

The host also writes a copy of the Markdown file as `<name>.md` beside the zip file.

The Markdown file and the JSON file hold the same nodes, links, sources, and assets. Both files refer to an asset by the path `assets/<id>`.

## Labels

Every node has one of three labels. The label tells the receiving agent how much the user stands behind the node.

| JSON `label` | Markdown text | Meaning |
| --- | --- | --- |
| `own` | the user's own | The user added this content. |
| `kept` | agent pick, kept by the user | An agent found this content, and the user chose to keep it. |
| `suggestion` | agent suggestion, not kept | An agent found this content, and the user has not accepted it. |

## Markdown file

The Markdown file has these sections, in this order:

1. **Title and brief.** One paragraph says what the file is and what the user was exploring. If the user gave an instruction for the receiving agent, the instruction follows as a block quote.
2. **What to do next.** A prompt for the receiving agent.
3. **Outline.** One `###` heading for each tree, then the tree as a nested list. A bold list entry is a node. The node line gives the title, the label, the kind, and the node id. The plain entries under a node are its fields: `why it is here`, `summary`, `url`, `file`, `text`, and `messages`. A field appears only when the node has it.
4. **Connections.** The links between two nodes that are both in the handoff, each with its reason.
5. **Open questions.** Three to six questions that the material raises. The file has no such section when the model call fails.
6. **Sources.** Every URL in the handoff, listed once, with the title of the first node that uses the URL.
7. **Attached files.** Every asset path, with the file name and the MIME type.

A handoff can hold one branch of a tree. In that case, a sentence under the tree heading names the nodes above the branch.

## JSON file

```ts
interface Handoff {
	format: 'mind-palace-handoff';
	version: 1;
	createdAt: string;            // ISO 8601
	note: string | null;          // the user's instruction for the receiving agent
	brief: string;
	nextPrompt: string;
	openQuestions: string[];      // empty when the model call failed
	trees: HandoffTree[];
	links: { id: string; a: string; b: string; why: string; strength: number }[];
	sources: { url: string; title: string }[];
	assets: { id: string; file: string; mime: string; name: string }[];
}

interface HandoffTree {
	id: string;                   // the id of the tree in the mindstorm
	title: string;
	whole: boolean;               // false when root is a branch and not the root of the tree
	path: string[];               // titles from the root of the tree down to the parent of root
	root: HandoffNode;
}

interface HandoffNode {
	id: string;                   // the node id that links use
	itemId: string;
	label: 'own' | 'kept' | 'suggestion';
	kind: 'text' | 'image' | 'video' | 'link' | 'chat' | 'file' | 'code';
	title: string;
	why: string;                  // why the node sits under its parent
	summary: string;
	text: string | null;
	textTrimmed: boolean;
	url: string | null;
	asset: string | null;         // 'assets/<id>'
	tags: string[];
	data: Record<string, unknown>;
	from: string;                 // how the item arrived, such as 'paste', 'web', or 'voice'
	children: HandoffNode[];
}
```

`links[].a` and `links[].b` are node ids. `strength` runs from 0 to 1.

`data` holds structured content when the item has it. A chat item keeps its conversation in `data.messages` as `{ role, text }` objects. Every key is optional. The known keys are:

| Key | Shape | Holds |
| --- | --- | --- |
| `chart` | `{ labels: string[], values: number[], unit?: string }` | A numeric series, one value for each label. |
| `steps` | `string[]` | The ordered steps of a procedure. |
| `messages` | `{ role, text }[]` | The conversation of a chat item. |
| `facts` | `{ label: string, value: string }[]` | Figures or attributes. |
| `person` | `{ name: string, role?: string }` | The one person the item is about. |
| `quote` | `{ text: string, by?: string }` | A quotation and who said it. |
| `code` | `{ language?: string, source: string }` | A piece of code. A pasted text has it when the text is one fenced block, a JSON object or array written over three lines or more, a terminal transcript that opens with a `$ ` prompt, or lines that read as code. `language` is the name on the fence, `json` for the JSON and `sh` for the transcript. It is absent when the fence has none and for other code with no fence. YAML, HTML and code on one line are code only inside a fence. |
| `when` | `string` | A date or time, as the content writes it. |
| `site` | `string` | The host name of a link or of a pick's source. |
| `where` | `string` | The place the item is about. |
| `people` | `string[]` | The people the content names. |
| `pros`, `cons` | `string[]` | The points for and the points against. Either can be present without the other. |
| `table` | `{ heads: string[], rows: string[][] }` | A table. Every row has one cell for each head, and a cell can be an empty string. |
| `question`, `answer` | `string` | A question and its answer. The two are always present together. |
| `term`, `definition` | `string` | A term and its definition. The two are always present together. |
| `items` | `string[]` | An unordered list of at least two entries. |
| `checklist` | `boolean[]` | Present only with `items` and of the same length. `true` marks an item as done. |
| `colours` | `{ name: string, value: string }[]` | Colours. `value` is a hex colour or a CSS colour name. `name` equals `value` when the content gives no name. |
| `excerpt` | `{ text: string, at?: string }` | A passage of a longer source and where it sits in that source. |
| `kind` | `'artwork'`, `'paper'` or `'book'` | What a pick is, as its source catalogues it. |
| `medium` | `string` | What an artwork is made of. |
| `holder` | `string` | The museum or collection that holds an artwork. |
| `authors` | `string[]` | The authors of a paper or a book, in order. |
| `authorsCut` | `true` | Present when the source cut `authors` short, so the work has more authors than the list. |
| `venue` | `string` | The journal, conference or repository of a paper. |
| `by`, `date`, `from` | `string` | The maker, the date and the source of a pick, as the source gives them. |
| `fromChat` | `string` | On a takeaway the agents drew from an imported conversation: the id of the chat item it came from. |
| `embed` | `string` | The address of the player for a video pick, to show in a frame. |
| `mediaUrl` | `string` | The address of the picture or recording itself, for a pick that is one. |
| `thumbnailUrl` | `string` | The address of a small still picture for a video or media pick. |

For an item the user brought in, a value in `chart`, `facts`, `person`, `quote`, `when` and the keys from `where` to `excerpt` is kept only when the content of the item states it. For a picture or a video, the content is the description in `text` and the file name. The labels of `facts` and `chart`, the unit of `chart`, the wording of `steps`, `quote.by` and `person.role` are not checked. A `chart` value is a number the content writes. When the unit scales the values, as `万`, `亿`, `千`, `k`, `M` and `bn` do, each value is the number the content writes before that unit: `2189` with the unit `万` for "2189万".

If two branches of one tree are in the handoff, `trees` has two entries with the same `id`.

## Limits

- `text` holds at most 3,000 characters for an `own` node and at most 600 characters for the other labels. `textTrimmed` is `true` when the original text is longer, and the Markdown file marks the text as trimmed.
- The Markdown file shows at most 40 messages for each chat item and at most 500 characters for each message. The JSON `data.messages` array is complete.
- A link appears only when both of its nodes are in the handoff.
- An asset has the MIME type `application/octet-stream` when the host cannot find the bytes of the asset.

## How a receiving agent reads the bundle

1. Read the brief and the user's instruction. The instruction comes from the user and overrides the generated prompt where the two differ.
2. Read "What to do next" for the task.
3. Read the outline. Treat `own` nodes as what the user thinks, `kept` nodes as material the user accepted, and `suggestion` nodes as leads to check.
4. Read "Connections" for relations that cross branches or trees.
5. Open a source URL or a file in `assets/` when the task needs the original and not the summary.
6. Refer to a node by its title and its id when you report back, so that the user can find the node in the app.

An agent that parses `handoff.json` must check that `format` is `mind-palace-handoff` and that `version` is `1` before it reads the other fields.
