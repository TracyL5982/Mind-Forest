// The page that goes to any round of the walkthrough: the chart of the tree, the rounds in recording order, and the round
// that is picked, with what to say and do in it. It asks the service's /api/demo for everything and keeps nothing itself.
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
  if (!round) return $('detail').replaceChildren();
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
      isNext && round.cards.length > 0 ? el('button', { class: 'btn wide', type: 'button', disabled: busy() || state === 'playing', onclick: play, text: 'Play it now, without a word' }) : null,
      el('div', { class: 'hint', text: isNext
        ? 'The tree stands as it was just before this round. Ask as written below, or in your own words: whatever you ask next brings this round.'
        : n === 0 ? 'Going here takes the tree away, so the round can start it.'
        : `Going here builds the ${n} round${n === 1 ? '' : 's'} before it${status?.devices ? ', one after another on the headset' : ''}, and leaves this one to be played.` }),
      // A headset keeps a tree it has standing even when the service deletes it: only starting the app again clears its stage.
      n === 0 && status?.devices ? el('div', { class: 'hint' }, 'A headset keeps showing a tree that is gone, so going here also starts the app again on it (a couple of seconds). To do that by hand, from the repository:', el('code', { class: 'cmd', text: 'agents/demo/headset.sh restart' })) : null),
  ];
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
  if (round.momo) kids.push(part('What Momo might say', el('div', { class: 'momo', text: round.momo }), el('div', { class: 'hint', text: voice ? 'A stand-in from the board. Momo finds her own words.' : 'A stand-in from the board. Momo is not speaking: the service has no OPENAI_API_KEY.' })));
  if (round.note) kids.push(part('About this round', el('div', { class: 'note', text: round.note })));
  $('detail').replaceChildren(...kids.filter(Boolean));
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
  draw();
}

async function go(id) {
  if (busy()) return;
  asked = id;
  picked = id === 'end' ? picked : id;
  status = await api('/api/demo/goto', { round: id });
  draw();
  watch(true);
}

async function play() {
  if (busy()) return;
  status = await api('/api/demo/play', {});
  draw();
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
      const before = JSON.stringify(status);
      status = await api('/api/demo/status');
      if (JSON.stringify(status) !== before) draw();
    } catch (err) {
      $('problem').hidden = false;
      $('problem').textContent = `The service is not answering: ${err.message}`;
    }
    watch();
  }, soon || busy() || status?.rounds.some((r) => r.state === 'playing') ? 250 : 1000);
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
  picked = nextId() ?? outline.rounds[0].id;
  draw();
  watch();
  void asked;
} catch (err) {
  $('sub').textContent = err.message;
}
