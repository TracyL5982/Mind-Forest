/**
 * Draws Round 3's three made diagrams, By time, By branches and By depth, in every state the user steps them through with the
 * pills under each card (the `states` of their cards in demo/script.json). Each state is the same diagram with another part lit,
 * so a pill that swaps the picture reads as the diagram moving. The first state of each is the picture the card lands with.
 *
 *   node --no-warnings --import tsx scripts/demo-diagrams.ts [--out <folder>]
 *
 * It writes 800 x 640 JPEGs into demo/media, or the folder named, drawn as SVG by the browser the screenshot scripts use.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { browserPath } from '../test/stage.ts';

const W = 800;
const H = 640;
const FONT = `'Helvetica Neue', Helvetica, Arial, sans-serif`;
const LIT = '#f9d990';
const GOLD = '#f3c669';

type Box = [x: number, y: number, w: number, h: number];

const page = (body: string, defs = '') => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
<radialGradient id="bg" cx="0.64" cy="0.4" r="0.78"><stop offset="0" stop-color="#171c2a"/><stop offset="1" stop-color="#0b0e15"/></radialGradient>
<filter id="glow" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="22"/></filter>
<filter id="soft" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="7"/></filter>
${defs}
</defs>
<rect width="${W}" height="${H}" fill="url(#bg)"/>
${body}
</svg>`;

const rect = ([x, y, w, h]: Box, fill: string, rx = 7, extra = '') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" ${extra}/>`;
const text = (x: number, y: number, words: string, fill: string, size = 30, anchor = 'middle') =>
  `<text x="${x}" y="${y}" fill="${fill}" font-family="${FONT}" font-size="${size}" text-anchor="${anchor}">${words}</text>`;
/** A soft light behind what is lit: the same shapes, blurred. */
const halo = (shapes: string, opacity = 0.55) => `<g filter="url(#glow)" opacity="${opacity}">${shapes}</g>`;

// ---- By time: three asks along a line, the one picked lit, the rest faded

const ASKS = [
  { pill: 'first ask', x: 170, dot: 6, cards: [[140, 246, 40, 28], [166, 276, 40, 28], [118, 292, 40, 28], [190, 312, 34, 24]] as Box[], rx: 5, top: 338 },
  { pill: 'then', x: 390, dot: 7.5, cards: [[294, 204, 46, 32], [352, 182, 54, 38], [386, 226, 54, 38], [322, 250, 54, 38], [418, 274, 48, 34]] as Box[], rx: 6, top: 308 },
  { pill: 'now', x: 620, dot: 9.5, cards: [[500, 140, 60, 42], [574, 120, 72, 50], [664, 112, 56, 40], [534, 204, 72, 50], [618, 176, 72, 50], [660, 238, 62, 44]] as Box[], rx: 8, top: 280 },
];

/** `lit` is the ask that is lit. With it the latest, the others step back by age, as the card lands; otherwise they all fade. */
function byTime(lit: number): string {
  const latest = lit === ASKS.length - 1;
  const out: string[] = [];
  out.push(`<line x1="69" y1="430" x2="738" y2="430" stroke="#3a4152" stroke-width="2.5"/>`);
  out.push(`<polyline points="716,417 739,430 716,443" fill="none" stroke="#3a4152" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`);
  ASKS.forEach((ask, n) => {
    const on = n === lit;
    // As the card lands: the older an ask, the further it fades. A step back in time fades every other ask alike.
    const card = on ? LIT : latest ? (n === 1 ? '#9498a3' : '#4f535e') : '#4a4e59';
    const line = on ? GOLD : latest ? (n === 1 ? '#7d8396' : '#4c5366') : '#454b5c';
    const words = on ? GOLD : latest ? '#8a90a4' : '#6c7285';
    const dot = on ? GOLD : latest ? (n === 1 ? '#838999' : '#555d72') : '#4f5668';
    const shapes = ask.cards.map((box) => rect(box, card, ask.rx)).join('');
    if (on) {
      // One light round the whole ask, and a closer one round each card.
      const xs = ask.cards.flatMap(([x, , w]) => [x, x + w]);
      const ys = ask.cards.flatMap(([, y, , h]) => [y, y + h]);
      const box: Box = [Math.min(...xs) - 6, Math.min(...ys) - 6, Math.max(...xs) - Math.min(...xs) + 12, Math.max(...ys) - Math.min(...ys) + 12];
      out.push(halo(rect(box, GOLD, 24), 0.22), halo(ask.cards.map((card) => rect(card, GOLD, ask.rx)).join(''), 0.6));
    }
    out.push(shapes);
    out.push(`<line x1="${ask.x}" y1="${ask.top}" x2="${ask.x}" y2="${430 - ask.dot - 3}" stroke="${line}" stroke-width="2" stroke-dasharray="2 5" stroke-linecap="round"/>`);
    if (on) out.push(`<circle cx="${ask.x}" cy="430" r="${ask.dot + 8}" fill="${GOLD}" opacity="0.35" filter="url(#soft)"/>`);
    out.push(`<circle cx="${ask.x}" cy="430" r="${on ? 9.5 : ask.dot}" fill="${dot}"/>`);
    out.push(text(ask.x, 492, ask.pill, words));
  });
  return page(out.join('\n'));
}

// ---- By branches: a question forks the path; the branch picked is lit from the question to its tip

interface Branch {
  name: string;
  colour: string;
  paths: { d: string; colour?: string }[];
  cards: { box: Box; colour?: string }[];
  joints?: [number, number][];
}

const BRANCHES: Branch[] = [
  {
    name: 'teal',
    colour: '#55cfc4',
    paths: [{ d: 'M398 384 C390 356 368 338 334 327 C300 300 288 280 264 253 C236 222 214 192 196 149' }],
    cards: [{ box: [166, 128, 60, 42] }, { box: [234, 232, 60, 42] }, { box: [304, 306, 60, 42] }],
  },
  {
    name: 'gold',
    colour: '#f3c669',
    paths: [{ d: 'M400 383 C401 300 402 200 401 95' }],
    cards: [{ box: [370, 74, 60, 42] }, { box: [372, 188, 60, 42] }, { box: [372, 282, 60, 42] }],
  },
  {
    name: 'violet',
    colour: '#b79bf2',
    paths: [
      { d: 'M403 384 C414 350 438 330 464 325 C500 306 530 285 557 267 C582 250 600 220 610 196' },
      { d: 'M610 196 C598 160 582 122 558 83', colour: '#9d88d3' },
      { d: 'M610 196 C642 160 690 142 716 95', colour: '#9d88d3' },
    ],
    cards: [{ box: [434, 304, 60, 42] }, { box: [527, 246, 60, 42] }, { box: [532, 64, 52, 38], colour: '#a28cd4' }, { box: [690, 76, 52, 38], colour: '#a993dc' }],
    joints: [[610, 196]],
  },
];

function branch(b: Branch): { lines: string; shapes: string } {
  const lines = b.paths.map((p) => `<path d="${p.d}" fill="none" stroke="${p.colour ?? b.colour}" stroke-width="3" stroke-linecap="round"/>`).join('');
  const joints = (b.joints ?? []).map(([x, y]) => `<circle cx="${x}" cy="${y}" r="12.5" fill="#0b0c1e" stroke="${b.colour}" stroke-width="2.5"/>`).join('');
  const shapes = b.cards.map((c) => rect(c.box, c.colour ?? b.colour, 8)).join('') + joints;
  return { lines, shapes };
}

/** `lit` is the branch lit, or null for every branch as the card lands. */
function byBranches(lit: string | null): string {
  const out: string[] = [];
  // The trunk: what was asked before the question.
  out.push(`<line x1="400" y1="425" x2="400" y2="540" stroke="#7e8796" stroke-width="3"/>`);
  out.push(rect([370, 452, 60, 42], '#d9dfeb', 8), rect([366, 536, 68, 48], '#d9dfeb', 8));
  const drawn = BRANCHES.map((b) => ({ b, ...branch(b) }));
  for (const { b, lines, shapes } of drawn) {
    if (lit && b.name !== lit) out.push(`<g opacity="0.2">${lines}${shapes}</g>`);
  }
  for (const { b, lines, shapes } of drawn) {
    if (lit && b.name !== lit) continue;
    if (b.name === lit) out.push(halo(lines.replaceAll('stroke-width="3"', 'stroke-width="9"') + shapes, 0.55));
    out.push(lines, shapes);
  }
  // The question the path forks at, glowing as it does on the card.
  out.push(`<circle cx="400" cy="404" r="30" fill="${GOLD}" opacity="0.28" filter="url(#soft)"/>`);
  out.push(`<circle cx="400" cy="404" r="20.5" fill="#0d1019" stroke="#e8ebf2" stroke-width="3"/>`);
  out.push(`<text x="400" y="413.5" fill="#f4f6fa" font-family="${FONT}" font-size="26" font-weight="700" text-anchor="middle">?</text>`);
  return page(out.join('\n'));
}

// ---- By depth: layers stacked, the one in front lit; the earlier layer can be brought forward

interface Frame {
  box: Box;
  fill: string;
  stroke: string;
  card: string;
  rx: number;
}

/** The places in the stack, front first, and what each looks like there. */
const PLACES: Frame[] = [
  { box: [96, 318, 430, 272], fill: '#1d2538', stroke: GOLD, card: LIT, rx: 14 },
  { box: [244, 222, 368, 236], fill: 'rgba(28,34,50,0.62)', stroke: '#a3a9b8', card: '#9ca2ae', rx: 13 },
  { box: [352, 140, 316, 200], fill: 'rgba(24,29,43,0.55)', stroke: '#5e6474', card: '#5c6270', rx: 12 },
  { box: [452, 70, 268, 170], fill: 'rgba(20,24,36,0.5)', stroke: '#3c414f', card: '#393d49', rx: 12 },
];

/** Each layer's cards, newest first, as parts of its frame: x, y, width and height, 0 to 1. */
const LAYERS: Box[][] = [
  [[132, 360, 84, 58], [236, 400, 84, 58], [346, 352, 84, 58], [150, 474, 76, 54], [418, 444, 76, 54]].map((b) => part(b as Box, PLACES[0]!.box)),
  [[276, 258, 60, 42], [446, 254, 60, 42], [356, 292, 60, 42], [524, 306, 60, 42]].map((b) => part(b as Box, PLACES[1]!.box)),
  [[380, 170, 50, 36], [524, 166, 50, 36], [448, 198, 50, 36], [590, 214, 50, 36]].map((b) => part(b as Box, PLACES[2]!.box)),
  [[476, 96, 42, 30], [596, 92, 42, 30], [532, 118, 42, 30], [650, 140, 42, 30]].map((b) => part(b as Box, PLACES[3]!.box)),
];

function part([x, y, w, h]: Box, [fx, fy, fw, fh]: Box): Box {
  return [(x - fx) / fw, (y - fy) / fh, w / fw, h / fh];
}

function within([px, py, pw, ph]: Box, [fx, fy, fw, fh]: Box): Box {
  return [fx + px * fw, fy + py * fh, pw * fw, ph * fh];
}

/** `order` is which layer stands in each place, front first: [0, 1, 2, 3] as the card lands, the newest in front. */
function byDepth(order: number[], front: string, behind: string): string {
  const out: string[] = [];
  for (let place = PLACES.length - 1; place >= 0; place--) {
    const frame = PLACES[place]!;
    const layer = LAYERS[order[place]!]!;
    const [x, y, w, h] = frame.box;
    if (place === 0) out.push(halo(rect(frame.box, 'none', frame.rx, `stroke="${GOLD}" stroke-width="6"`), 0.7));
    out.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${frame.rx}" fill="${frame.fill}" stroke="${frame.stroke}" stroke-width="${place === 0 ? 2.5 : 1.5}"/>`);
    const rx = place === 0 ? 8 : place === 1 ? 7 : 5;
    out.push(layer.map((card) => rect(within(card, frame.box), frame.card, rx)).join(''));
  }
  out.push(text(733, 53, behind, '#868b9e', 30, 'end'));
  out.push(text(112, 620, front, GOLD, 30, 'start'));
  return page(out.join('\n'));
}

/** Every picture, by its file in demo/media. The first of each card is the one it lands with. */
export const DIAGRAMS: Record<string, () => string> = {
  'gen-idea-time.jpg': () => byTime(2),
  'gen-idea-time-first.jpg': () => byTime(0),
  'gen-idea-time-then.jpg': () => byTime(1),
  'gen-idea-branches.jpg': () => byBranches(null),
  'gen-idea-branches-teal.jpg': () => byBranches('teal'),
  'gen-idea-branches-gold.jpg': () => byBranches('gold'),
  'gen-idea-branches-violet.jpg': () => byBranches('violet'),
  'gen-idea-depth.jpg': () => byDepth([0, 1, 2, 3], 'in front: now', 'behind: earlier'),
  'gen-idea-depth-earlier.jpg': () => byDepth([1, 0, 2, 3], 'in front: earlier', 'behind: now and older'),
};

if (import.meta.main ?? process.argv[1] === import.meta.filename) {
  const at = process.argv.indexOf('--out');
  const out = at > 0 ? process.argv[at + 1]! : join(import.meta.dirname, '../demo/media');
  mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ executablePath: browserPath() });
  try {
    const tab = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    for (const [file, draw] of Object.entries(DIAGRAMS)) {
      await tab.setContent(`<!doctype html><html><body style="margin:0;background:#0b0e15">${draw()}</body></html>`);
      await tab.screenshot({ path: join(out, file), type: 'jpeg', quality: 92, clip: { x: 0, y: 0, width: W, height: H } });
      console.log(join(out, file));
    }
  } finally {
    await browser.close();
  }
}
