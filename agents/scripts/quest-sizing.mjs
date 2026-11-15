#!/usr/bin/env node
// Every number in quest-card-sizing.md, worked out again.
//   node derive.mjs [<agents>/client/js/components/]
// It reads the web card library's letter widths and line counters (shared.js) and changes nothing.

const LIB = process.argv[2] ?? new URL('../client/js/components/', import.meta.url).pathname;
const { wrap, figureNeed, FIGURES, TITLE_LETTER, PASSAGE_LETTER } = await import(LIB + 'shared.js');

const D = 1500;                                   // mm: Stage::focus
const PPD = 25;                                   // Quest 3, Meta's device page
const SF = { x: 1040 / 2048, cap: 1443 / 2048 };  // SFNS.ttf OS/2 sxHeight and sCapHeight over unitsPerEm
const deg = (mm) => (2 * Math.atan(mm / 2 / D) * 180) / Math.PI;
const mmOfDeg = (d) => 2 * D * Math.tan((d * Math.PI) / 360);
const qpx = (mm) => deg(mm) * PPD;
const K_OPEN = (0.46 * 1000) / 384;               // ocean.h openScale: the 384 px panel is the 46 cm open note

const f1 = (v) => v.toFixed(1);
const f2 = (v) => v.toFixed(2);
const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
const out = [];
const say = (s = '') => out.push(s);

// The headset face. One web px is one mm at 1.5 m, so its px are the Quest's mm.
const W = 210, H = 146, FRAME = 30, SIDES = 33, COL = W - SIDES;
const TITLE = { px: 18, line: 24 }, BODY = { px: 16, line: 22 }, META = { px: 13.5, line: 18 }, CUE = 18, GAP = 6;

// Lines are counted with the web's `wrap`. Body and meta are counted in the title face (semibold, measured at 16 px),
// which is never narrower than the medium they are drawn in, so a count is never short. Another size scales the column.
const faces = {
  title: (col) => [Math.floor((col * 16) / TITLE.px), TITLE_LETTER],
  body: (col) => [col, TITLE_LETTER],
  meta: (col) => [Math.floor((col * 16) / META.px), TITLE_LETTER],
  passage: (col) => [col, PASSAGE_LETTER],
};
const count = (s, col, face) => { const [c, letter] = faces[face](col); return wrap(s, c, letter, 99); };

const EN = [
  'The old town sits on a bend of the river, and every house in it faces the water. Barges carry the grain out and the news in, so the road behind the houses is used only by locals. Only the red house at the end of the lane turned its back on the river, and nobody now remembers why it was built that way. The bridge was rebuilt twice after floods, each time a little higher than before, and the second time the town paid for it with a tax on salt.',
  'Spaced repetition works because forgetting is predictable. Each time you recall a fact just before you would have lost it, the next interval can be longer. A deck of a few hundred cards takes ten minutes a day, and after a year most of it is still there. The hard part is writing cards that ask one thing and only one thing, because a card that asks two things is remembered by its easier half.',
  'Light from the north window falls across the table in the afternoon, which is why the painter moved her easel twice before settling on the corner by the stove. The paintings from that winter are smaller than the rest, mostly interiors, and almost all of them show the same blue jug on the same white cloth. A letter to her sister complains about the price of canvas and the damp.',
];
const ZH = [
  '老城建在河湾上，每一座房子都朝着水。驳船把粮食运出去，把消息带进来，所以房子后面的路只有本地人走。只有巷子尽头的红房子背对着河，现在已经没有人记得当初为什么这样建。那座桥在洪水之后重建过两次，每次都比原来高一点。',
  '间隔重复之所以有效，是因为遗忘是可以预测的。每次在快要忘记之前把一个事实回想起来，下一次的间隔就可以更长。几百张卡片每天只要十分钟，一年以后大部分内容还记得。难的是写出只问一件事的卡片。',
  '下午，北窗的光落在桌子上，所以画家把画架挪了两次，最后放在炉子旁边的角落里。那个冬天的画比其他时候的小，大多是室内，几乎每一幅都画着同一块白布上的同一个蓝色水罐。她写给姐姐的信里抱怨画布太贵。',
];
// Each sample runs on into the next, so a long column never runs out of words.
for (const xs of [EN, ZH]) { const first = [...xs]; xs.forEach((_, i) => { xs[i] = first[i] + (xs === EN ? ' ' : '') + first[(i + 1) % first.length]; }); }
const enPrefix = (s, n) => s.split(' ').slice(0, n).join(' ');
const zhPrefix = (s, n) => Array.from(s).slice(0, n).join('');
function longest(s, fits, prefix, size) {
  let lo = 0, hi = size(s);
  while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (fits(prefix(s, mid))) lo = mid; else hi = mid - 1; }
  return lo;
}
const words = (t) => t.split(' ').length, chars = (t) => Array.from(t).length;
/** What `lines` lines of a column hold: the least over the samples, and the middle one. */
function holds(col, face, lines) {
  const fits = (s) => count(s, col, face) <= lines;
  const en = EN.map((s) => longest(s, fits, enPrefix, words)), zh = ZH.map((s) => longest(s, fits, zhPrefix, chars));
  const enChars = EN.map((s, i) => enPrefix(s, en[i]).length);
  const mid = (xs) => [...xs].sort((a, b) => a - b)[1];
  return { words: Math.min(...en), chars: Math.min(...enChars), han: Math.min(...zh), wordsMid: mid(en), hanMid: mid(zh), charsMid: mid(enChars) };
}
const about = (h) => `about ${h.wordsMid} words or ${h.hanMid} Chinese characters`;
const perLine = (col, face) => { const h = holds(col, face, 1); return `about ${h.charsMid} letters or ${h.hanMid} Chinese`; };

// 1. Viewing model and the thresholds.
say('## 1. Viewing model');
say(`At 1.5 m, 1° is ${f1(mmOfDeg(1))} mm; 1 mm is ${f2(qpx(1))} Quest 3 display px at ${PPD} PPD.`);
say(table(['Threshold', 'As published', 'At 1.5 m'], [
  ['Microsoft, minimum legible', '0.35 to 0.4°', `${f1(mmOfDeg(0.35))} to ${f1(mmOfDeg(0.4))} mm`],
  ['Microsoft, comfortably legible', '0.6 to 0.75°', `${f1(mmOfDeg(0.6))} to ${f1(mmOfDeg(0.75))} mm`],
  ['Hoffmann et al. 2019, legibility, scaled from 13.8 to 25 PPD', '45 arcmin', `${f2((0.75 * 13.8) / PPD)}°, ${f1(mmOfDeg((0.75 * 13.8) / PPD))} mm`],
  ['Hoffmann et al. 2019, comfort, scaled', '70.2 arcmin', `${f2((1.17 * 13.8) / PPD)}°, ${f1(mmOfDeg((1.17 * 13.8) / PPD))} mm`],
  ['Android XR, 14 dp at 0.868 dmm a dp', '12.2 dmm', `${f2(deg(14 * 0.868 * 1.5))}°, ${f1(14 * 0.868 * 1.5)} mm`],
]));
say();

// 2. The type scale.
say('## 2. Type scale');
const row = (name, px, k, weight) => { const mm = px * k; return [name, px, f1(mm), f2(deg(mm)), f1(qpx(mm)), f1(qpx(mm) * SF.x), weight]; };
say(table(['Small face', 'Web px', 'mm', 'Degrees', 'Quest 3 px, em', 'x-height px', 'Weight'], [
  row('Title', TITLE.px, 1, 'semibold 620'), row('Body', BODY.px, 1, 'medium 500'), row('Meta and cue', META.px, 1, 'medium 500'),
  row('Figure, large', 34, 1, 'semibold 650'), row('Figure, middle', 24, 1, 'semibold 650'),
]));
say();
say(table(['Opened card', 'Web px', 'mm', 'Degrees', 'Quest 3 px, em', 'x-height px', 'Weight'], [
  row('Title', 21, K_OPEN, 'semibold 650'), row('Body and all reading text', 15, K_OPEN, 'medium 500'), row('Labels, tags, chips, credit', 11.5, K_OPEN, 'medium 500'),
]));
say();
say(`Columns of the small face: ${COL} px. A line holds ${perLine(COL, 'body')} at the body size, ${perLine(COL, 'title')} at the title size.`);
say(`Opened card: the 346 px column at 15 px holds ${perLine(Math.round((346 * 16) / 15), 'body')}.`);
say();

// 3. Contrast on the face.
const lum = (rgb) => { const c = rgb.map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const over = (a, bg) => bg.map((b) => 255 * a + b * (1 - a));
const ratio = (fg, bg) => { const [x, y] = [lum(fg), lum(bg)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const face = hex('#1b1d23');
say('## 3. Contrast on the face #1b1d23');
say(table(['Ink', 'Ratio'], [['white at 0.82', f1(ratio(over(0.82, face), face))], ['white at 1', f1(ratio([255, 255, 255], face))], ['#a3a39c, the web card text today', f1(ratio(hex('#a3a39c'), face))], ['#909089, the web foot today', f1(ratio(hex('#909089'), face))]]));
say();

// 4. Placement: the ring round the open card (Tree::ring, Tree::spot, Tree::ringAngles).
const ANGLES = [20, 60, 100, 140, 180, 220, 260, 300, 340];
const slots = (openH, spread) => { const a = 0.72, b = openH / 2 + 0.23; return ANGLES.map((t) => { const r = (t * Math.PI) / 180; return [(0.09 + a * Math.cos(r)) * spread, b * Math.sin(r) * spread]; }); };
const clear = (openH, spread, w, h) => { const s = slots(openH, spread), m = 0.05 * spread + 0.015; return s.every((p, i) => { const q = s[(i + 1) % s.length]; return Math.abs(p[0] - q[0]) >= w + m || Math.abs(p[1] - q[1]) >= h + m; }); };
const OPEN = [['Link', 0.218], ['Text', 0.27], ['Chart, and every text kind here', 0.372], ['Film with caption', 0.374], ['Our artwork before f024f86', 0.87]];
say('## 4. Placement');
say(table(['Open box, 46 cm wide', 'Height cm', 'Tallest neighbour 17 to 25 cm wide', 'Widest neighbour at 14.6 cm'], OPEN.map(([n, oh]) => {
  let h = 0; while (clear(oh, 1, 0.21, h + 0.001)) h += 0.001;
  let w = 0; while (clear(oh, 1, w + 0.001, 0.146)) w += 0.001;
  return [n, f1(oh * 100), f1(h * 100), f1(w * 100)];
})));
say('With 1.5 cm of air in the worst jitter, on the open ring.');
say();

// 5. The open motion (OceanModel::openReach and nudge) and the grow (CardView::update).
function motion(up, down, small) {
  const lo = { x: -0.23 - 0.05 - small[0] / 2, y: -down - 0.13 - 0.05 - small[1] / 2 }, hi = { x: 0.23 + 0.05 + small[0] / 2, y: up + 0.05 + small[1] / 2 };
  let sum = 0, n = 0, worst = 0;
  for (let x = lo.x; x <= hi.x; x += 0.005) for (let y = lo.y; y <= hi.y; y += 0.005) { const d = Math.min(x - lo.x, hi.x - x, y - lo.y, hi.y - y); sum += d; n += 1; worst = Math.max(worst, d); }
  return { area: (hi.x - lo.x) * (hi.y - lo.y), mean: sum / n, worst };
}
const base = motion(0.135, 0.135, [0.21, 0.117]);
say('## 5. Open motion');
say(table(['Opening', 'Room cleared m²', 'Mean move cm', 'Longest move cm', 'Motion'], [
  ['Ocean text note, 21 × 11.7 small', 0.135, 0.135, [0.21, 0.117]], ['Ocean text box, 21 × 14.6 small', 0.135, 0.135, [0.21, 0.146]],
  ['Ocean film with caption, 17 × 14.6 small', 0.129, 0.245, [0.17, 0.146]], ['46 × 37.2, 21 × 14.6 small', 0.186, 0.186, [0.21, 0.146]],
  ['46 × 87, 21 × 33 small (before f024f86)', 0.435, 0.435, [0.21, 0.33]],
].map(([n, up, down, small]) => { const m = motion(up, down, small); return [n, f2(m.area), f1(m.mean * 100), f1(m.worst * 100), `${f2((m.area * m.mean) / (base.area * base.mean))}×`]; })));
const g = 0.46 / 0.21;
say(`Growth ${f2(g)}. Tallest 21 cm small face inside the open box while growing: link ${f1((21 * 21.8) / 46)} cm, text ${f1((21 * 27) / 46)} cm, 37.2 cm box ${f1((21 * 37.2) / 46)} cm.`);
say();

// 6. Each type's small face, in px (= mm). Each recipe returns the tallest face it can draw; a check below holds it to H.
const rows = [], tallest = [];
const put = (type, face, limit, web, tall) => { rows.push([type, face, limit, web]); tallest.push([type, tall]); };
const cueRoom = (used) => H - used;   // what is left under the parts above
const lines = (room, each) => Math.max(0, Math.floor(room / each));
{ // note
  const two = lines(H - FRAME - 2 * TITLE.line - GAP - CUE, BODY.line), one = lines(H - FRAME - TITLE.line - GAP - CUE, BODY.line);
  out.note = { two: holds(COL, 'body', two), one: holds(COL, 'body', one), twoLines: two, oneLines: one };
  put('note', `Title, ${two} or ${one} body lines, cue`, `Title 2 lines and ${two} body lines (${about(out.note.two)}), or title 1 line and ${one} (${about(out.note.one)})`, 'Title 2, body 3 at 240 px', FRAME + 2 * TITLE.line + GAP + two * BODY.line + CUE);
}
{ // quote
  const qc = W - 41, full = lines(H - FRAME - 22 - 8 - META.line, BODY.line), more = lines(H - FRAME - 22 - 8 - META.line - CUE, BODY.line);
  put('quote', 'Quotation mark, quotation in upright serif, speaker, cue', `${full} lines and the speaker when that is all; ${more} lines, the speaker and the cue when there is more (${about(holds(qc, 'passage', more))})`, '5 lines at 288 px, cut', FRAME + 22 + more * BODY.line + 8 + META.line + CUE);
}
{ // fact
  const big = Math.floor((COL * 100) / FIGURES[0][3]), mid = Math.floor((COL * 100) / FIGURES[1][3]);
  put('fact', 'Value as a figure, label, title as a foot', `Value whole: up to ${big} digits at 34 px, ${mid} at 24 px, else at 18 px on 2 lines; label 2 lines, 1 when the value takes 2; any value up to the Renderer's 32 characters`, 'Value up to 8 lines, 200 to 320 px', FRAME + 36 + 4 + 2 * BODY.line + 8 + META.line);
}
{ // image
  const p1 = H - 2 - 19 - BODY.line, p2 = H - 2 - 19 - 2 * BODY.line, pc = H - 2 - 19 - BODY.line - CUE;
  put('image', 'Picture, caption plate', `Picture ${W} px wide and ${p2} to ${p1} px tall; caption 2 lines (${about(holds(COL, 'body', 2))}), else 1 line and the cue over a picture ${pc} px tall`, 'Picture 130 to 260 px, caption 2 lines, 240 px', p2 + 2 + 19 + 2 * BODY.line);
}
{ // video
  const p1 = H - 2 - 19 - BODY.line, p2 = H - 2 - 19 - 2 * BODY.line;
  put('video', 'Poster at 16:9 with its play mark, caption plate', `Poster ${Math.round((p1 * 16) / 9)} × ${p1} px under a 1-line caption, ${Math.round((p2 * 16) / 9)} × ${p2} under 2`, 'Poster 272 × 153 px, caption 2 lines', p2 + 2 + 19 + 2 * BODY.line);
}
{ // audio
  const one = lines(H - FRAME - TITLE.line - GAP - 40 - GAP - CUE, BODY.line);
  put('audio', 'Title, play strip, transcript, cue', `Title 1 line, the strip and ${one} transcript line (${about(holds(COL, 'body', one))}); a 2-line title leaves the strip and the cue`, 'Title 2, transcript 3 at 272 px', FRAME + TITLE.line + GAP + 40 + GAP + one * BODY.line + CUE);
}
{ // link
  const d1 = lines(H - 30 - 26 - TITLE.line - 4 - CUE, BODY.line), d2 = lines(H - 30 - 26 - 2 * TITLE.line - 4, BODY.line);
  put('link', 'Site bar, title, description, cue', `Title 1 line and ${d1} description lines (${about(holds(COL, 'body', d1))}), or title 2 lines and ${d2}; no thumbnail small`, 'Title 2, description 2, 272 or 316 px', 30 + 26 + TITLE.line + 4 + d1 * BODY.line + CUE);
}
{ // chart, a designed preview
  const s1 = H - FRAME - TITLE.line - GAP - GAP - META.line, s2 = H - FRAME - 2 * TITLE.line - GAP - GAP - META.line;
  put('chart', 'Designed: title, the shape with no labels, one meta line', `Title, the bars or line drawn ${s2} to ${s1} px tall with no text, and one meta line: the count and the first and last labels, such as "12 points, 2015 to 2026"`, '300 × 195 px with labels and values', FRAME + 2 * TITLE.line + GAP + s2 + GAP + META.line);
}
{ // person
  const nc = W - SIDES - 48 - 12;
  put('person', 'Face 48 px, name, role', `Name 2 lines (${perLine(nc, 'title')} a line), role 2 lines`, '252 × 88 px, each cut to 1 line', FRAME + 2 * TITLE.line + 2 * BODY.line + CUE);
}
{ // chat
  const bc = Math.floor(COL * 0.86) - 20;
  put('chat', 'Title, bubbles, cue', `2 messages of 1 line (${perLine(bc, 'body')}) when that is all; else the first message whole in up to 2 lines and the cue`, '3 messages of 2 lines, 288 px', FRAME + TITLE.line + 2 + 6 + 12 + 2 * BODY.line + CUE);
}
{ // code, a designed preview
  put('code', 'Designed: title, one meta line', 'Title, and "24 lines of Python" in meta: a code line at 16 px holds 18 characters, so no line of source is shown', '7 lines at 304 px, faded at the edge', FRAME + 2 * TITLE.line + GAP + META.line);
}
{ // steps
  const sc = COL - 32, n1 = Math.floor((H - FRAME - TITLE.line - 10 - CUE + 8) / (BODY.line + 8));
  put('steps', 'Title, numbered steps, cue', `${n1} steps of 1 line (${perLine(sc, 'body')} each), or the first step whole in 2 lines; the cue counts the rest`, '5 steps, cut to 1 line', FRAME + TITLE.line + 10 + n1 * BODY.line + (n1 - 1) * 8 + CUE);
}
{ // facts
  const half = Math.floor((COL - 17) / 2), d = Math.floor((half * 100) / FIGURES[1][3]);
  put('facts', 'Title, one row of two figures, cue', `2 figures, values up to ${d} digits at 24 px, labels 1 meta line (${perLine(half, 'meta')}); a longer value takes the row alone`, '6 facts, 320 px', FRAME + TITLE.line + 12 + 28 + META.line + CUE);
}
{ // table, a designed preview
  put('table', 'Designed: title, the heads, a count', 'Title 2 lines, the heads in meta joined by a middle dot as far as they fit whole with "+N" after, and a count such as "12 rows"', '6 rows × 5 columns, 200 to 352 px', FRAME + 2 * TITLE.line + GAP + META.line + 4 + META.line);
}
{ // list
  const ec = COL - 20, n = Math.floor((H - FRAME - TITLE.line - 10 - CUE + 5) / (BODY.line + 5)), all = Math.floor((H - FRAME - TITLE.line - 10 + 5) / (BODY.line + 5));
  put('list', 'Title, entries, cue', `${all} entries of 1 line when that is all, else ${n} and the cue (${perLine(ec, 'body')} an entry); a checklist keeps its tally`, '6 entries of 2 lines, 256 px', FRAME + TITLE.line + 10 + all * BODY.line + (all - 1) * 5);
}
{ // breakdown, a designed preview
  put('breakdown', 'Designed: title, one bar of all the parts, the largest part, cue', 'Title, a 16 px bar split into the parts with no labels, the largest part as one body line such as "Rent 42%", and the cue "6 parts"', '8 parts, 300 px', FRAME + TITLE.line + GAP + 16 + 8 + BODY.line + 4 + CUE);
}
{ // qa
  const qc = W - 55, a1 = lines(H - FRAME - 8 - TITLE.line - GAP - CUE, BODY.line), a2 = lines(H - FRAME - 8 - 2 * TITLE.line - GAP - CUE, BODY.line);
  put('qa', 'Question, answer, cue', `Question 1 line and ${a1} answer lines (${about(holds(qc, 'body', a1))}), or 2 and ${a2}`, 'Question 4, answer 6, 272 px', FRAME + 8 + TITLE.line + GAP + a1 * BODY.line + CUE);
}
{ // callout
  const l = lines(H - FRAME - 24 - CUE, TITLE.line);
  put('callout', 'Tone row, text at the title size, cue', `${l} lines (${about(holds(W - 39, 'title', l))})`, '5 lines, 256 px', FRAME + 24 + l * TITLE.line + CUE);
}
{ // excerpt
  const full = lines(H - FRAME - 10 - META.line, BODY.line), more = lines(H - FRAME - 10 - META.line - CUE, BODY.line);
  put('excerpt', 'Passage in upright serif, source line, cue', `${full} lines and the source when that is all, else ${more} and the cue (${about(holds(W - 46, 'passage', more))})`, '6 lines, 288 px', FRAME + full * BODY.line + 10 + META.line);
}
{ // definition
  const more = lines(H - FRAME - 10 - 28 - CUE, BODY.line), full = lines(H - FRAME - 10 - 28, BODY.line);
  put('definition', 'Term as a figure, meaning in upright serif, cue', `Term on 1 line at 24 px (2 at 18 px when longer); meaning ${full} lines when that is all, else ${more} and the cue (${about(holds(W - 32, 'passage', more))})`, 'Meaning 6 lines, 272 px', FRAME + 10 + 28 + full * BODY.line);
}
{ // idea
  const h = holds(COL, 'title', 3);
  put('idea', 'Spark, the thought as a figure', `2 lines at 34 px, 3 at 24 px, or 3 at 18 px (${h.chars} to ${h.charsMid} characters, ${h.han} Chinese); a longer one ends with the cue`, 'Under 60 characters, 272 px', 52 + 3 * 28);
}
{ // proscons, a designed preview
  put('proscons', 'Designed: title, the first point of each side, cue', `Title, the first point for (+) and the first against (−) when each is whole on 1 line (${perLine(COL - 20, 'body')}), and the cue "3 for, 2 against" in the item's own words`, '4 points a side, 320 px', FRAME + TITLE.line + 10 + BODY.line + 5 + BODY.line + CUE);
}
{ // swatch
  put('swatch', 'Band of up to 12 colours, title, one named row, cue', 'The band, the title and 1 named row; the cue counts the rest', '6 rows, 256 px', 44 + 29 + TITLE.line + 8 + BODY.line + CUE);
}
{ // artwork
  const p = H - 2 - 19 - TITLE.line;
  put('artwork', 'The work whole on a 6 px mat, title plate', `Picture box ${W} × ${p} px, the work contained; title 1 line; maker, date, medium and holder on the opened card`, 'Mat 196 px and up to 7 plate lines, 264 px', p + 2 + 19 + TITLE.line);
}
{ // reference
  put('reference', 'Kind and year, rule, title, first author, cue', 'Kind and year in meta, the title in 2 lines, and the first author with "and N others" in meta; the venue on the opened card', 'Title 3, authors 2, venue 2, 288 px', FRAME + META.line + 14 + 2 * TITLE.line + GAP + META.line);
}
{ // place
  const map = H - FRAME - 28, full = lines(H - FRAME - 28 - 8, BODY.line), more = lines(H - FRAME - 28 - 8 - CUE, BODY.line);
  put('place', 'Name as a figure, then a map or words', `With a point: the name and a map ${W} × ${map} px. Without: the name and ${full} lines of words, or ${more} and the cue (${about(holds(COL, 'body', more))})`, 'Picture 120 px, map 112 px, words 3 lines, 256 px', FRAME + 28 + map);
}
{ // sheet
  const part = H - FRAME - TITLE.line - GAP - CUE;
  put('sheet', 'Title, the first part as its own preview, cue', `The first part in ${part} px: ${lines(part, BODY.line)} text lines, a row of two figures, or 2 entries; the cue counts the other parts`, 'Every part, a 140 px picture band, 320 px', FRAME + TITLE.line + GAP + part + CUE);
}
{ // explorable
  put('explorable', 'Explore mark, title, the output\'s label, cue', 'The mark, the title in 1 line, the output\'s label as 1 body line, and the cue "2 controls"; the controls on the opened card', 'Every control and the output, 288 px', FRAME + 22 + TITLE.line + 10 + BODY.line + CUE);
}
say(`## 6. Each type's small face, ${W} × ${H} px (px are mm at 1.5 m)`);
say(table(['Type', 'Face', 'Holds', 'Web today'], rows));
say();
const over_ = tallest.filter(([, t]) => t > H);
say(`Check: the tallest face of each type is at most ${H} px: ${over_.length === 0 ? 'yes, all 28' : `NO for ${over_.map(([t, h]) => `${t} (${h})`).join(', ')}`}. Each grows into the 46 × 37.2 cm box without overhang, since ${H} × ${f2(g)} = ${Math.round(H * g)} px ≤ 372.`);
say();

// 7. The note summary the service may write.
const n = out.note;
say('## 7. Note summary');
say(`Under a 2-line title: ${n.twoLines} lines, ${n.two.words} words or ${n.two.chars} English characters at the least, ${n.two.han} Chinese characters.`);
say(`Under a 1-line title: ${n.oneLines} lines, ${n.one.words} words or ${n.one.chars} English characters at the least, ${n.one.han} Chinese characters.`);
say();

// 8. The opened card.
say('## 8. Opened card');
const px = 372 / K_OPEN, room = px - 16 - 17 - 22 - 2 * 25.6 - 13, bl = Math.floor(room / 21);
const ob = holds(Math.round((346 * 16) / 15), 'body', bl);
say(`46 × 37.2 cm is 384 × ${Math.round(px)} px and ${f1(deg(460))}° × ${f1(deg(372))}°. Under a 2-line title the first view holds ${bl} lines of body: ${ob.words} words or ${ob.han} Chinese characters at the least.`);

console.log(out.join('\n'));
