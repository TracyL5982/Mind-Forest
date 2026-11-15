/**
 * Measures the faces a small card face is drawn in, in Chromium with the client's own font stack, and prints the rows that
 * components/shared.js holds for them: each printable ASCII character's width in hundredths of a px with kerning off, rounded up
 * and 0.03 px more; the width of a character set with Han, which shared.js holds as the face's size less its letter spacing
 * when that is wider; and the face's letter, the widest ratio of a lowercase letter to the same letter in the 16 px title face,
 * times that face's letter, rounded up. It first measures the 16 px title face the same way and says how far that comes from the
 * row shared.js holds for it, which was given 0.02 px more: the extra 0.01 px covers that difference.
 *
 * Run: node --no-warnings --import tsx scripts/advances.ts
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { bootFake, browserPath } from '../test/stage.ts';

type Shared = { ADVANCES: Map<number, number[]>; TITLE_LETTER: number };
const { ADVANCES, TITLE_LETTER } = (await import(new URL('../client/js/components/shared.js', import.meta.url).href)) as Shared;

type Face = { name: string; size: number; weight: number; spacing: number };
const FACES: Face[] = [
  { name: 'title at 16 px, as held', size: 16, weight: 620, spacing: -0.006 },
  { name: 'TITLE_FACE, the title at 18 px', size: 18, weight: 620, spacing: -0.006 },
  { name: 'BODY_FACE, body text at 16 px', size: 16, weight: 500, spacing: 0 },
  { name: 'META_FACE, a meta line at 13.5 px', size: 13.5, weight: 500, spacing: 0 },
];
const ASCII = Array.from({ length: 0x7f - 0x20 }, (_, i) => String.fromCharCode(0x20 + i));

const run = await bootFake({ dataDir: mkdtempSync(join(tmpdir(), 'mp-advances-')) });
const browser = await chromium.launch({ executablePath: browserPath() });
try {
  const page = await browser.newPage();
  await page.goto(`${run.url}/library.html`);
  const widths = (await page.evaluate(`((faces, chars) => faces.map((face) => {
    const el = document.createElement('span');
    el.style.cssText = 'position:absolute;white-space:pre;font-kerning:none;font-size:' + face.size + 'px;font-weight:' + face.weight + ';letter-spacing:' + face.spacing + 'em';
    document.body.append(el);
    const out = chars.map((ch) => { el.textContent = ch; return el.getBoundingClientRect().width; });
    el.textContent = '水';
    out.push(el.getBoundingClientRect().width);
    el.remove();
    return out;
  }))(${JSON.stringify(FACES)}, ${JSON.stringify(ASCII)})`)) as number[][];
  const rows = widths.map((face) => face.slice(0, ASCII.length).map((w) => Math.ceil(w * 100 - 1e-6) + 3));
  const held = ADVANCES.get(TITLE_LETTER)!;
  const most = Math.max(...rows[0]!.map((w, i) => Math.abs(w - 1 - held[i]!)));
  console.log(`16 px title face, measured as shared.js held it: within ${most / 100} px of the row it holds`);
  const lower = Array.from({ length: 26 }, (_, i) => 0x61 - 0x20 + i);
  FACES.slice(1).forEach((face, k) => {
    const row = rows[k + 1]!;
    const ratio = Math.max(...lower.map((code) => row[code]! / held[code]!));
    console.log(`\n// ${face.name}`);
    console.log(`letter ${Math.ceil(TITLE_LETTER * ratio)}, Han ${Math.ceil(widths[k + 1]!.at(-1)! * 100 - 1e-6)}`);
    console.log(`[${row.join(', ')}]`);
  });
} finally {
  await browser.close();
  await run.close();
}
