// The page that goes to any round of the walkthrough: the chart of the tree, the rounds in recording order, and the round
// that is picked, with what to say and do in it, and that round's take: one Play button, a bar to move through it, and what
// Momo says in it. It asks the service's /api/demo for everything. It keeps one thing itself: a copy of the lines the user
// wrote over Momo's, to send again to a service that lost them when it started again.
import { readToken } from './connection.js';

const token = readToken();
const $ = (id) => document.getElementById(id);
const el = (tag, attrs = {}, ...kids) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const kid of kids.flat()) if (kid) node.append(kid);
  return node;
};

async function api(path, body) {
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, ...(body !== undefined && { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(res.status === 401 ? 'This page needs the address the service printed, with its #token.' : `The service answered ${res.status}.`);
  return res.json();
}

let outline = null;
let status = null;
let voice = false;
/** Whether the service can start the headset's app again itself (on a Mac with the headset on adb), or the user must. */
let restarts = true;
/** The round the right-hand column shows. */
let picked = null;
/** The set-up the page asked for, so the bar says where it is going. */
let asked = null;

/** A round's short name: its panel's title without the part of the board it stood in. */
const short = (title) => title.replace(/^(Free-form|Build|Added|From Round 2) · /, '');
const roundAt = (id) => outline.rounds.find((r) => r.id === id);
const indexOf = (id) => outline.rounds.findIndex((r) => r.id === id);
const stateOf = (id) => status?.rounds.find((r) => r.id === id)?.state ?? 'waiting';
const nextId = () => outline.rounds[status?.armed ?? 0]?.id ?? null;
const busy = () => Boolean(status?.busy);

// ---- the rounds in order

function drawOrder() {
  const rows = [];
  const parts = { r1: 'The three scripted rounds', f1: 'Free-form', fb: 'How do we build this', f15: 'Naming and after' };
  outline.rounds.forEach((round, n) => {
    if (parts[round.id]) rows.push(el('div', { class: 'order-part', text: parts[round.id] }));
    rows.push(el('button', {
      class: 'row', type: 'button', 'data-state': stateOf(round.id), 'data-next': String(nextId() === round.id), 'aria-current': String(picked === round.id),
      title: round.title, onclick: () => pick(round.id), ondblclick: () => go(round.id),
    }, el('span', { class: 'row-n', text: String(n + 1) }), el('span', { class: 'row-name', text: short(round.title) }), el('i', { class: 'dot' })));
  });
  // The showcase trees, below the rounds: a press stands one on the headset with every layer open.
  const shown = status.showcase ?? { on: false, trees: [] };
  if (shown.on && shown.trees.length > 0) {
    rows.push(el('div', { class: 'order-part', text: 'Other trees in the forest' }));
    for (const tree of shown.trees) {
      rows.push(el('button', {
        class: 'row tree-row', type: 'button', disabled: busy() || !status.devices,
        title: status.devices ? `Stand "${tree.title}" on the headset with every layer open (${tree.cards} cards)` : 'Join a headset to show a tree on it',
        onclick: () => show(tree.id),
      }, el('span', { class: 'row-n', text: String(tree.cards) }), el('span', { class: 'row-name', text: tree.title }), el('span', { class: 'row-do', text: 'Show whole' })));
    }
  }
  $('order').replaceChildren(...rows);
}

// ---- the chart

/**
 * Where each block of the chart stands: the tree as the board draws it, left to right, laid out afresh so every block has a
 * line of its own. A block's first arrow gives its parent; its other arrows are joins, drawn dashed. Blocks keep the board's
 * order from top to bottom.
 */
function layout(chart) {
  const COLUMN = 160;
  const ROW = 46;
  const byId = new Map(chart.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  const joins = [];
  for (const [a, b] of chart.edges) {
    if (!byId.has(a) || !byId.has(b)) continue;
    if (parent.has(b)) joins.push([a, b]);
    else parent.set(b, a);
  }
  const kids = new Map(chart.nodes.map((n) => [n.id, []]));
  for (const [child, of] of parent) kids.get(of).push(child);
  for (const list of kids.values()) list.sort((a, b) => byId.get(a).y - byId.get(b).y);
  const at = new Map();
  let line = 0;
  let deepest = 0;
  const place = (id, depth) => {
    deepest = Math.max(deepest, depth);
    const below = kids.get(id);
    let y;
    if (below.length === 0) y = line++ * ROW;
    else {
      const ys = below.map((kid) => place(kid, depth + 1));
      y = (ys[0] + ys.at(-1)) / 2;
    }
    at.set(id, { x: depth * COLUMN, y });
    return y;
  };
  for (const root of chart.nodes.filter((n) => !parent.has(n.id)).sort((a, b) => a.y - b.y)) place(root.id, 0);
  return { at, parent, joins, width: deepest * COLUMN + NODE.w, height: Math.max(1, line) * ROW };
}

const NODE = { w: 142, h: 34 };

function drawChart() {
  const chart = outline.chart;
  const space = $('chart-space');
  if (!chart) {
    $('chart').hidden = true;
    return;
  }
  const { at, parent, joins, width, height } = layout(chart);
  space.style.width = `${width}px`;
  space.style.height = `${height}px`;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const arrow = (a, b, also) => {
    const [from, to] = [at.get(a), at.get(b)];
    if (!from || !to) return;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const [x1, y1, x2, y2] = [from.x + NODE.w, from.y + NODE.h / 2, to.x, to.y + NODE.h / 2];
    const bend = x2 > x1 ? (x2 - x1) / 2 : 40;
    path.setAttribute('d', `M${x1} ${y1} C${x1 + bend} ${y1} ${x2 - bend} ${y2} ${x2} ${y2}`);
    if (also) path.setAttribute('class', 'also');
    svg.append(path);
  };
  for (const [child, of] of parent) arrow(of, child, false);
  for (const [a, b] of joins) arrow(a, b, true);
  const nodes = chart.nodes.map((n) => {
    const round = n.phase ? roundAt(n.phase) : null;
    const place = at.get(n.id);
    return el('button', {
      class: 'node', type: 'button', style: `left:${place.x}px;top:${place.y}px;width:${NODE.w}px;height:${NODE.h}px`,
      'data-kind': n.kind, 'data-state': round ? stateOf(round.id) : 'waiting', 'data-next': String(Boolean(round) && nextId() === round.id),
      'aria-current': String(Boolean(round) && picked === round.id), title: n.text.replace(/\s+/g, ' '), disabled: !round,
      onclick: () => round && pick(round.id), ondblclick: () => round && go(round.id),
    }, round ? el('span', { class: 'node-n', text: String(indexOf(round.id) + 1) }) : null, el('span', { class: 'node-name', text: round ? short(round.title) : n.text }));
  });
  space.replaceChildren(svg, ...nodes);
}

// ---- the round that is picked

function drawDetail() {
  const round = picked ? roundAt(picked) : null;
  if (!round) return $('detail-top').replaceChildren(), $('detail-rest').replaceChildren();
  const n = indexOf(round.id);
  const state = stateOf(round.id);
  const isNext = nextId() === round.id;
  const sticky = outline.chart?.nodes.find((node) => node.phase === round.id)?.text;
  const stateName = state === 'playing' ? 'Playing now' : state === 'played' ? 'Played' : state === 'built' ? 'Built' : isNext ? 'Next up' : 'Not built';
  const headCard = round.head ? outline.rounds.flatMap((r) => r.cards).find((c) => c.id === round.head.id) : null;
  const thumb = (card, cls = '') => (card?.image ? el('img', { class: cls, src: card.image, alt: '', loading: 'lazy' }) : el('div', { class: `blank ${cls}`, text: card ? card.kind : '' }));
  const part = (name, ...kids) => el('section', { class: 'part' }, el('div', { class: 'part-name', text: name }), ...kids);

  const kids = [
    el('div', { class: 'kicker' }, el('span', { text: `Round ${n + 1} of ${outline.rounds.length}` }), el('span', { class: 'state', 'data-state': isNext && state === 'waiting' ? 'next' : state, text: stateName })),
    el('div', { class: 'name', text: short(round.title) }),
    sticky && sticky !== short(round.title) ? el('div', { class: 'sticky', text: `On your chart: ${sticky.replace(/\s+/g, ' ')}` }) : null,
    el('div', { class: 'actions' },
      el('button', { class: 'btn primary wide', type: 'button', disabled: busy(), onclick: () => go(round.id), text: isNext && state === 'waiting' ? 'Set this round up again' : 'Go to this round' }),
      el('div', { class: 'hint', text: isNext
        ? 'The tree stands as it was just before this round. Ask as written below, or in your own words: whatever you ask next brings this round.'
        : n === 0 ? 'Going here takes the tree away, so the round can start it.'
        : `Going here builds the ${n} round${n === 1 ? '' : 's'} before it${status?.devices ? ', one after another on the headset' : ''}, and leaves this one to be played.` }),
      // A headset keeps a tree it has standing even when the service deletes it: only starting the app again clears its stage.
      n === 0 && status?.devices ? (restarts
        ? el('div', { class: 'hint' }, 'A headset keeps showing a tree that is gone, so going here also starts the app again on it (a couple of seconds). To do that by hand, from the repository:', el('code', { class: 'cmd', text: 'agents/demo/headset.sh restart' }))
        : el('div', { class: 'hint', text: 'A headset keeps showing a tree that is gone, and this service cannot reach the headset to start its app again. After going here, close the app on the headset and open it: it joins again by itself, with nothing standing.' })) : null),
  ];
  $('detail-top').replaceChildren(...kids.filter(Boolean));
  kids.length = 0;
  if (round.do.length > 0) kids.push(part('You do', el('ol', { class: 'steps' }, round.do.map((step) => el('li', { text: step })))));
  if (round.say) kids.push(part('You say', el('div', { class: 'say', text: round.say }), ...round.sayAlso.map((line) => el('div', { class: 'also', text: `Or: ${line}` }))));
  else if (round.ask) kids.push(part('You pick', el('div', { class: 'say', text: round.ask })));
  kids.push(part('Asked from', el('div', { class: 'head' }, thumb(headCard), el('div', {},
    el('div', { class: 'head-name', text: round.head ? round.head.title : 'Nothing yet: this round starts the tree' }),
    el('div', { class: 'head-from', text: round.head ? `A card of ${short(outline.rounds.find((r) => r.cards.some((c) => c.id === round.head.id))?.title ?? 'an earlier round')}` : `Its first card will read "${outline.topic}"` })))));
  if (round.cards.length > 0) {
    kids.push(part(`${round.cards.length} card${round.cards.length === 1 ? '' : 's'} arrive`,
      el('div', { class: 'cards' }, round.cards.map((card) => el('div', { class: 'card', 'data-origin': card.origin, title: card.text }, thumb(card), el('div', { class: 'card-name', text: card.title })))),
      el('div', { class: 'legend' }, el('span', { class: 'ocean', text: 'Yours' }), el('span', { text: 'Found outside' }), el('span', { class: 'generated', text: 'Made by the agents' }))));
  } else {
    kids.push(part('Nothing arrives', el('div', { class: 'momo', text: 'Momo answers aloud from the open card.' })));
  }
  if (round.offers.length > 0) kids.push(part('Momo offers under the card', el('div', { class: 'offers' }, round.offers.map((q) => el('span', { class: 'offer', text: q })))));
  if (round.note) kids.push(part('About this round', el('div', { class: 'note', text: round.note })));
  $('detail-rest').replaceChildren(...kids.filter(Boolean));
}

// ---- the round's take: Play, the bar, and what Momo says

/** The take the panel shows, as the service gave it, and the round it is of. */
let take = null;
/** Where the bar is, as the service last said: the take's own ms, when that was heard, and whether it was running. */
let heard = { at: 0, when: 0, playing: false };
/** A drag of the bar: where it is, and whether the take was running when it began. */
let drag = null;
/** The newest moment asked for while a move is still being answered: only it is sent next. */
let moveNext = null;
let moving = false;

const clock = (ms) => `${Math.floor(ms / 60000)}:${(Math.floor(ms / 1000) % 60).toString().padStart(2, '0')}`;
const kept = () => {
  try {
    return JSON.parse(localStorage.getItem('mp-demo-lines') ?? '{}');
  } catch {
    return {};
  }
};
const keep = (round, line, text) => {
  const all = kept();
  all[round] = { ...all[round] };
  if (text === null) delete all[round][line];
  else all[round][line] = text;
  if (Object.keys(all[round]).length === 0) delete all[round];
  try {
    localStorage.setItem('mp-demo-lines', JSON.stringify(all));
  } catch {
    // The copy is a convenience: without it, a restart of a service with no volume loses the user's words.
  }
};

/** Where the take is now: the drag, or what the service said, run on by the page's own clock while it plays. */
function position() {
  if (!take) return 0;
  if (drag) return drag.at;
  return Math.min(take.ms, heard.playing ? heard.at + (performance.now() - heard.when) : heard.at);
}

async function loadTake() {
  const round = picked;
  if (!round) return;
  try {
    const got = await api(`/api/demo/take?round=${encodeURIComponent(round)}`);
    if (round !== picked) return;
    take = got;
    drawTake();
    // A line still being recorded is asked after again, since the take's length follows its recording's.
    if (voice && take.lines.some((line) => line.text && !line.recorded)) setTimeout(() => picked === round && !document.activeElement?.matches?.('.line textarea') && loadTake(), 1500);
  } catch (err) {
    $('take').replaceChildren(el('div', { class: 'hint', text: err.message }));
  }
}

const LINE_NAME = { answer: 'Her answer, as the search starts', first: 'As the first card lands', more: 'As more cards land', wrap: 'Her wrap-up, when the search is over' };

function drawTake() {
  if (!take || take.round !== picked) return;
  const round = roundAt(picked);
  const titles = new Map(round.cards.map((card) => [card.id, card.title]));
  const pct = (ms) => `${(100 * ms) / take.ms}%`;
  const span = (cls, at, ms, title) => el('i', { class: cls, style: `left:${pct(at)};width:${pct(Math.max(ms, take.ms / 300))}`, title });
  const bar = el('div', { class: 'bar', id: 'bar', role: 'slider', tabindex: '0', 'aria-label': 'Where the take is', 'aria-valuemin': '0', 'aria-valuemax': String(Math.round(take.ms / 1000)) },
    el('div', { class: 'lane lane-momo' }, take.lines.filter((line) => line.ms > 0).map((line) => span('mark-line', line.at, line.ms, `Momo, ${clock(line.at)}: ${line.text}`))),
    el('div', { class: 'lane lane-steps' }, take.steps.map((step) => span('mark-step', step.at, step.end - step.at, `${step.label}, ${clock(step.at)} to ${clock(step.end)}`))),
    el('div', { class: 'lane lane-cards' }, take.drops.map((drop) => span('mark-drop', drop.at, 0, `${clock(drop.at)}: ${drop.cards.map((id) => titles.get(id) ?? id).join(', ')}`))),
    el('div', { class: 'bar-fill', id: 'bar-fill' }),
    el('div', { class: 'bar-head', id: 'bar-head' }));
  bar.addEventListener('pointerdown', grab);
  bar.addEventListener('keydown', (event) => {
    const step = event.key === 'ArrowRight' ? 1000 : event.key === 'ArrowLeft' ? -1000 : 0;
    if (!step) return;
    event.preventDefault();
    const at = Math.max(0, Math.min(take.ms, position() + step));
    heard = { at, when: performance.now(), playing: false };
    move(at);
  });
  const lines = take.lines.map((line) => {
    const about = line.kind === 'first' || line.kind === 'more' ? line.cards.map((id) => titles.get(id) ?? id).join(', ') : '';
    const box = el('textarea', { rows: String(Math.max(2, Math.ceil(line.text.length / 44))), 'data-line': line.id, 'aria-label': LINE_NAME[line.kind], spellcheck: 'true' });
    box.value = line.text;
    box.addEventListener('change', () => write(line.id, box.value));
    return el('div', { class: 'line', 'data-edited': String(line.edited) },
      el('div', { class: 'line-name' }, el('button', { class: 'line-at', type: 'button', title: 'Move the take to this line', onclick: () => jump(line.at), text: clock(line.at) }), el('span', { text: LINE_NAME[line.kind] }), about ? el('span', { class: 'line-about', title: about, text: about }) : null),
      box,
      el('div', { class: 'line-foot' },
        el('span', { text: !line.text.trim() ? 'Empty: Momo says nothing here.' : line.recorded ? `${(line.ms / 1000).toFixed(1)} s, said exactly as written` : voice ? 'Recording these words…' : "Momo's voice is off, so this line is not heard" }),
        line.edited ? el('button', { class: 'link', type: 'button', title: line.written, onclick: () => write(line.id, null), text: 'Back to Momo’s own words' }) : null));
  });
  $('take').replaceChildren(
    el('div', { class: 'part-name', text: 'The take' }),
    el('div', { class: 'take-top' },
      el('button', { class: 'btn primary play', id: 'play', type: 'button', onclick: toggle }),
      el('div', { class: 'take-time', id: 'take-time' })),
    bar,
    el('div', { class: 'bar-legend' }, el('span', { class: 'k-line', text: 'Momo speaks' }), el('span', { class: 'k-step', text: 'Agents at work' }), el('span', { class: 'k-drop', text: 'Cards land' })),
    el('div', { class: 'hint', id: 'take-hint' }),
    lines.length > 0 ? el('div', { class: 'part-name lines-name', text: 'What Momo says, in order. Write over any line and she says your words.' }) : el('div', { class: 'hint', text: 'This round has no lines of Momo’s written down yet (agents/demo/lines.json), so its take plays without her.' }),
    ...lines);
  tick();
}

/** The bar's head, the clock and the button, drawn each frame from where the take is. */
function tick() {
  if (!take || !$('bar-head')) return;
  const at = position();
  $('bar-head').style.left = $('bar-fill').style.width = `${(100 * at) / take.ms}%`;
  $('bar').setAttribute('aria-valuenow', String(Math.round(at / 1000)));
  $('take-time').textContent = `${clock(at)} of ${clock(take.ms)}`;
  const playing = heard.playing && !drag;
  const play = $('play');
  play.textContent = playing ? 'Pause' : at >= take.ms - 50 ? 'Play again' : at > 0 ? 'Play from here' : 'Play';
  play.disabled = busy();
  const now = take.lines.find((line) => line.ms > 0 && line.at <= at && at < line.at + line.ms);
  for (const node of document.querySelectorAll('.line')) node.dataset.now = String(Boolean(now) && node.querySelector('textarea').dataset.line === now.id);
  $('take-hint').textContent = status?.devices
    ? `Plays this round on the headset at the pace of a real one: the scene, Momo and the agents' labels together, ${Math.round(take.ms / 1000)} s in all. Saying the line in the headset starts the same take.`
    : 'No headset is joined: the take still runs here, and the tree follows it.';
}
function frames() {
  tick();
  requestAnimationFrame(frames);
}

async function toggle() {
  if (busy() || !take) return;
  const at = position();
  if (heard.playing) status = await api('/api/demo/pause', {});
  else {
    heard = { at: at >= take.ms - 50 ? 0 : at, when: performance.now(), playing: true };
    status = await api('/api/demo/play', { round: picked, at: at >= take.ms - 50 ? 0 : Math.round(at) });
  }
  hear();
  draw();
  watch(true);
}

/** Moves the take on the headset. While one move is being answered, only the newest moment asked for waits behind it. */
async function move(at) {
  moveNext = Math.round(at);
  if (moving) return;
  moving = true;
  try {
    while (moveNext !== null) {
      const to = moveNext;
      moveNext = null;
      status = await api('/api/demo/seek', { round: picked, at: to });
      // A drag is followed about four times a second, which is as fast as a headset hangs cards and takes them away.
      if (drag) await new Promise((done) => setTimeout(done, 220));
    }
  } finally {
    moving = false;
  }
  if (!drag) {
    hear();
    draw();
  }
}

function grab(event) {
  if (!take || busy()) return;
  const bar = $('bar');
  const where = (e) => {
    const box = bar.getBoundingClientRect();
    return Math.max(0, Math.min(take.ms, ((e.clientX - box.left) / box.width) * take.ms));
  };
  drag = { at: where(event), was: heard.playing };
  bar.setPointerCapture(event.pointerId);
  move(drag.at);
  const onMove = (e) => {
    drag.at = where(e);
    move(drag.at);
  };
  const onUp = async (e) => {
    bar.removeEventListener('pointermove', onMove);
    bar.removeEventListener('pointerup', onUp);
    bar.removeEventListener('pointercancel', onUp);
    const { at, was } = drag;
    heard = { at, when: performance.now(), playing: false };
    drag = null;
    // The headset settles on exactly this moment, and a take that was running goes on from it.
    await move(at);
    while (moving) await new Promise((done) => setTimeout(done, 30));
    if (was && at < take.ms - 50) {
      heard = { at, when: performance.now(), playing: true };
      status = await api('/api/demo/play', { round: picked, at: Math.round(at) });
      hear();
      watch(true);
    }
    void e;
  };
  bar.addEventListener('pointermove', onMove);
  bar.addEventListener('pointerup', onUp);
  bar.addEventListener('pointercancel', onUp);
}

function jump(at) {
  if (busy()) return;
  heard = { at, when: performance.now(), playing: false };
  move(at);
}

/** Writes the user's words over a line, or with `null` goes back to Momo's own. The service records them, and the take is drawn again. */
async function write(line, text) {
  const round = picked;
  try {
    take = await api('/api/demo/line', { round, line, text });
    const now = take.lines.find((l) => l.id === line);
    keep(round, line, now?.edited ? now.text : null);
    if (round === picked) drawTake();
    if (voice && take.lines.some((l) => l.text && !l.recorded)) setTimeout(() => picked === round && loadTake(), 1500);
  } catch (err) {
    $('problem').hidden = false;
    $('problem').textContent = `The line was not saved: ${err.message}`;
  }
}

/** What the service says of the take, taken as the bar's place: only for the round the panel shows, and never over a drag. */
function hear() {
  if (drag || moving) return;
  const told = status?.take && status.take.round === picked ? status.take : null;
  heard = { at: told ? told.at : 0, when: performance.now(), playing: Boolean(told?.playing) };
}

/** A service that holds none of the user's lines, while this page has a copy of some, lost them on starting again: they are sent again. */
async function restoreLines() {
  const mine = kept();
  if (status.lines?.edited !== 0 || Object.keys(mine).length === 0) return;
  let sent = 0;
  for (const [round, lines] of Object.entries(mine)) {
    for (const [line, text] of Object.entries(lines)) {
      try {
        await api('/api/demo/line', { round, line, text });
        sent++;
      } catch {
        keep(round, line, null);
      }
    }
  }
  if (sent > 0) {
    $('problem').hidden = false;
    $('problem').textContent = `The service started again and had lost your ${sent} edited line${sent === 1 ? '' : 's'}. This page sent ${sent === 1 ? 'it' : 'them'} again, and Momo is recording ${sent === 1 ? 'it' : 'them'}.`;
  }
}

// ---- the bar

function drawBar() {
  $('title').textContent = outline.title;
  const built = status.rounds.filter((r) => r.state === 'built' || r.state === 'played').length;
  const next = outline.rounds[status.armed];
  $('sub').textContent = status.busy ?? (next ? `${built} of ${outline.rounds.length} rounds built. Next: ${short(next.title)}` : 'The whole tree is built');
  const headset = $('chip-headset');
  headset.dataset.state = status.devices > 0 ? 'on' : 'off';
  headset.lastElementChild.textContent = status.devices > 1 ? `${status.devices} headsets joined` : status.devices === 1 ? 'Headset joined' : 'No headset joined';
  const speaks = $('chip-voice');
  speaks.dataset.state = voice ? 'on' : 'warn';
  speaks.lastElementChild.textContent = voice ? 'Momo is live' : "Momo's voice off";
  $('scripted').checked = status.scripted;
  // The showcase trees: whole trees that stand in the forest beside the walkthrough's.
  const shown = status.showcase ?? { on: false, trees: [] };
  $('showcase-switch').hidden = shown.trees.length === 0;
  $('showcase').checked = shown.on;
  $('showcase').disabled = busy();
  $('showcase-name').textContent = shown.trees.length === 1 ? '1 other tree in the forest' : `${shown.trees.length} other trees in the forest`;
  $('showcase-switch').title = `${shown.trees.map((tree) => `${tree.title} (${tree.cards} cards)`).join(', ')}. Off: the forest holds the walkthrough's tree alone, and a headset is started again to let go of them.`;
  for (const id of ['go-start', 'go-end']) $(id).disabled = busy();
  const progress = /round (\d+) of (\d+)/.exec(status.busy ?? '');
  $('progress').hidden = !status.busy;
  $('progress-text').textContent = status.busy ?? '';
  $('progress-fill').style.width = progress ? `${(100 * (Number(progress[1]) - 1)) / Number(progress[2])}%` : '4%';
  $('problem').hidden = !status.problem;
  $('problem').textContent = status.problem ?? '';
}

function draw() {
  if (!outline || !status) return;
  drawBar();
  drawOrder();
  drawChart();
  drawDetail();
}

// ---- what the page does

function pick(id) {
  picked = id;
  take = null;
  $('take').replaceChildren();
  hear();
  draw();
  loadTake();
}

async function go(id) {
  if (busy()) return;
  asked = id;
  picked = id === 'end' ? picked : id;
  status = await api('/api/demo/goto', { round: id });
  hear();
  draw();
  if (take?.round !== picked) {
    take = null;
    $('take').replaceChildren();
    loadTake();
  }
  watch(true);
}

async function show(tree) {
  if (busy()) return;
  status = await api('/api/demo/show', { tree });
  draw();
  watch(true);
}

let timer = null;
/** The status is read once a second, and four times a second while something is under way. */
function watch(soon = false) {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    try {
      // Where the take is changes every time it is read: the bar follows it by itself, and the rest is drawn when it changes.
      const rest = (s) => JSON.stringify({ ...s, take: s?.take && { round: s.take.round, playing: s.take.playing, ms: s.take.ms } });
      const before = rest(status);
      status = await api('/api/demo/status');
      hear();
      if (rest(status) !== before) {
        draw();
        if (take && status.take?.round === take.round && status.take.ms !== take.ms && !document.activeElement?.matches?.('.line textarea')) loadTake();
      }
    } catch (err) {
      $('problem').hidden = false;
      $('problem').textContent = `The service is not answering: ${err.message}`;
    }
    watch();
  }, soon || busy() || status?.take?.playing || status?.rounds.some((r) => r.state === 'playing') ? 250 : 1000);
}

$('go-start').addEventListener('click', () => go(outline.rounds[0].id));
$('go-end').addEventListener('click', () => go('end'));
$('scripted').addEventListener('change', async (event) => {
  status = await api('/api/demo/scripted', { on: event.target.checked });
  draw();
});
$('showcase').addEventListener('change', async (event) => {
  status = await api('/api/demo/showcase', { on: event.target.checked });
  draw();
  watch(true);
});
window.addEventListener('resize', () => outline && drawChart());

try {
  const all = await api('/api/demo');
  outline = all.outline;
  status = all.status;
  voice = all.voice;
  restarts = all.restarts !== false;
  picked = status.take?.round ?? nextId() ?? outline.rounds[0].id;
  hear();
  draw();
  await restoreLines();
  loadTake();
  frames();
  watch();
  void asked;
} catch (err) {
  $('sub').textContent = err.message;
}
