#!/usr/bin/env node
// Writes quest/core/cards/samples.cpp for the Quest's `-cards` gallery: every card the web library page
// draws (agents/client/library.html and library-samples.js on genui/integration), type by type in the
// page's order, each with the label, status, view and item the page gives it. The page's script is run
// here with its drawing calls stubbed, so its samples are read as the page makes them. Rerun this when
// the web samples change.
//   node quest/tools/cards_samples.mjs <agents/client folder on genui/integration>
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

if (!process.argv[2]) {
  console.error('usage: node quest/tools/cards_samples.mjs <agents/client folder on genui/integration>');
  process.exit(2);
}
const client = resolve(process.argv[2]);
const out = resolve(dirname(fileURLToPath(import.meta.url)), '../core/cards/samples.cpp');

const page = readFileSync(join(client, 'library.html'), 'utf8');
const open = '<script type="module">';
let script = page.slice(page.indexOf(open) + open.length, page.indexOf('</script>'));
const cut = script.indexOf('\nconst note = (title, summary)');
if (cut < 0) throw new Error('library.html changed: the components no longer end before `const note`');
script = script.slice(0, cut);
const edit = (from, to) => {
  if (!script.includes(from)) throw new Error(`library.html changed: no ${from}`);
  script = script.replace(from, to);
};
script = script.replace(/^import \{([^}]*)\} from '\.\/js\/[^']*';$/gm, (_, names) => `const {${names}} = globalThis.__stub;`);
edit("from './library-samples.js'", `from '${pathToFileURL(join(client, 'library-samples.js')).href}'`);
edit('function sample(label, a, b, w = 640, hgt = 440) {',
  'function sample(label, a, b, w = 640, hgt = 440) {\n  const uri = drawSample(label, a, b, w, hgt);\n  globalThis.__params.set(uri, { a, b, w, h: hgt });\n  return uri;\n}\nfunction drawSample(label, a, b, w, hgt) {');
script = script.replace(/^(const STAND_IN = .*;)$/m, '$1\nglobalThis.__pictures = { PIC, STAND_IN };');

const element = (tag, attrs, kids) => ({ tag, attrs: attrs ?? {}, kids, style: { setProperty() {} }, classList: { toggle() {} }, append(...more) { this.kids.push(...more); } });
const h = (tag, attrs, ...kids) => element(tag, attrs, kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false && k !== ''));
const roots = {};
globalThis.__params = new Map();
globalThis.__stub = {
  h,
  drawCard: (node, item) => ({ card: { node, item } }),
  sizeOf: () => [0, 0],
  arrange: () => ({ w: 0, h: 0, at: new Map(), under: new Set(), buried: new Set(), marks: [] }),
  Panel: class { open() {} },
  measure: async () => ({}),
  useMaps: () => {},
};
globalThis.document = { getElementById: (id) => (roots[id] = element('main', { id }, [])) };

const dir = mkdtempSync(join(tmpdir(), 'cards-samples-'));
try {
  writeFileSync(join(dir, 'page.mjs'), script);
  await import(pathToFileURL(join(dir, 'page.mjs')).href);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

const { PIC, STAND_IN } = globalThis.__pictures;
const named = new Map(Object.entries(PIC).map(([name, uri]) => [uri, name]));
const pictures = Object.fromEntries(Object.entries(PIC).map(([name, uri]) => [name, globalThis.__params.get(uri)]));
/** A picture the page draws from a sample stands for `sample:<name>`, which the Quest paints itself. */
const picture = (value) => {
  if (typeof value === 'string') {
    const shown = STAND_IN[value] ?? value;
    return named.has(shown) ? `sample:${named.get(shown)}` : value;
  }
  if (Array.isArray(value)) return value.map(picture);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, picture(v)]));
  return value;
};

const textOf = (node) => (typeof node === 'string' ? node : node.attrs?.text ?? '');
const find = (node, test) => {
  if (!node || typeof node !== 'object') return null;
  if (test(node)) return node;
  for (const kid of node.kids ?? []) {
    const hit = find(kid, test);
    if (hit) return hit;
  }
  return null;
};
const cellsOf = (node, prefix, cards) => {
  if (!node || typeof node !== 'object') return;
  if (node.attrs?.class === 'lib-cell') {
    const label = textOf(node.kids[0]);
    const made = find(node, (n) => n.card)?.card;
    const status = find(node, (n) => /\bcard is-\w+/.test(n.attrs?.class ?? ''))?.attrs.class.match(/is-(\w+)/)[1];
    if (made) {
      const { title, text, summary, tags, data, source, origin } = made.item;
      cards.push({
        label: prefix ? `${prefix}: ${label}` : label,
        status,
        view: { component: made.node.view.component, props: picture(made.node.view.props ?? {}) },
        item: { title, text, summary, tags, data, source, ...(origin && { origin }) },
      });
    }
    return;
  }
  for (const kid of node.kids ?? []) cellsOf(kid, prefix, cards);
};

const types = roots.components.kids.map((section) => {
  const cards = [];
  let prefix = '';
  for (const part of section.kids) {
    if (part.attrs?.class === 'lib-label lib-more') prefix = textOf(part);
    else cellsOf(part, prefix, cards);
  }
  return {
    type: textOf(find(section, (n) => n.tag === 'h3')),
    when: textOf(find(section, (n) => n.attrs?.class === 'lib-when')),
    cards,
  };
});

const json = JSON.stringify({ pictures, types });
const end = ')cards"';
if (json.includes(end)) throw new Error(`a sample holds ${end}`);
writeFileSync(out, `// Written by quest/tools/cards_samples.mjs from the web card library's samples (agents/client/library.html
// and library-samples.js on genui/integration). Do not edit: rerun the script.
#include "gallery.h"

const char* const cards::samplesJson = R"cards(${json})cards";
`);
console.log(`wrote ${out}: ${types.length} types, ${types.reduce((n, t) => n + t.cards.length, 0)} cards, ${json.length} bytes`);
