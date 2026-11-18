# The showcase trees

Four whole trees that stand in the walkthrough demo's forest beside the walkthrough's own tree, so the space looks lived in. The demo service plants them when it starts (`agents/src/demo/showcase.ts`).

| Folder | Tree | Its first card |
|---|---|---|
| `paper/` | Paper architecture | What can one folded sheet build? |
| `seed/` | Seed spirals | Why do seeds grow in spirals? |
| `planet/` | Imaginary planet | What would my imaginary planet look like? |
| `constellations/` | Constellations | How do scattered dots become one picture? |

Each folder holds:

- `tree.json`: the tree's `id`, `title` and `topic`, and its `cards`. A card has an `id`, the card it hangs from in `parent` (`root` for the first), a `kind` (picture, artwork, paper, note, link, facts, person or list), an `origin`, a `title`, a `text` of one or two sentences, and where it has them `from`, `href`, `image` with its `w` and `h`, and `licence` and credit.
- `media/`: one picture per card that shows one. These are in Git LFS.

## How they are used

- They are ordinary trees. Opened on the headset, the real Scout answers what you ask on them and Momo is herself. They are not played round by round as the walkthrough's tree is.
- The demo's control page can switch them off for a bare forest, and can stand one whole with every layer (Show whole).
- On the demo server, Share on one of these trees takes it out of the forest and grows it back on the same headset. That is how the film's sharing shot is recorded.

## Checking a tree

```bash
python3 agents/demo/showcase/check.py seed
python3 agents/demo/showcase/check.py seed --sheet
```

The first says what is wrong with a tree, or "ok". The second also writes `seed/sheet.jpg`, a sheet of every card's picture, branch by branch. A tree must branch: 36 to 52 cards, at least eight cards with two or more under them, and lines of thought four layers deep. The service checks the same file when it loads it, leaves out a tree that does not hold together, and says why in its log.

## Rights

The pins are other people's work, of unknown rights. What was found outside Pinterest is public domain or openly licensed, and each card records its licence, credit and page. `agents/demo/docs/showcase-notes.md` lists the details the trees' makers could not confirm. See [the demo's README](../README.md), The showcase trees.
