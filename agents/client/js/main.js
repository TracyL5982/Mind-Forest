import { Connection, readToken, saveToken } from './connection.js';
import { Store } from './store.js';
import { Field } from './field.js';
import { Panel } from './panel.js';
import { bindField, bindDump, textDump } from './input.js';
import { Voice, speak, hush } from './voice.js';
import { HandoffSheet, WorkLog, bindGate, bindSettings, caption, showGate, showSettings, showStatus, showTrees, showUndo, toast } from './chrome.js';

const $ = (id) => document.getElementById(id);
const MUTED = 'mind-palace-muted';

const store = new Store();
const conn = new Connection({ onMessage: receive, onStatus: status });
const asset = (url) => conn.withToken(url);
const field = new Field({ root: $('field'), store, asset });
const log = new WorkLog();
const panel = new Panel({ el: $('panel'), store, send, asset, onClose: () => choose([]) });
const handoff = new HandoffSheet({ send, link: asset, choices: handoffChoices });

let selection = [];
/** The tree the view keeps fitted while it grows. Cleared as soon as the user moves the view. */
let following = null;
let drawQueued = false;
let refit = false;
let muted = false;
try { muted = localStorage.getItem(MUTED) === '1'; } catch { /* keeps the default */ }

function send(message) {
  const sent = conn.send(message);
  if (!sent) toast('Not connected. It will retry on its own.');
  return sent;
}

function status(state) {
  showStatus(state);
  if (state === 'no-token') showGate(true);
  else if (state === 'denied') showGate(true, 'That access key was not accepted. Paste the one the service printed when it started.');
  else if (state === 'live') showGate(false);
}

// ---- drawing

function insets() {
  const wide = window.innerWidth >= 760;
  const open = !$('panel').hidden;
  const dock = document.querySelector('.dock').getBoundingClientRect();
  const bar = document.querySelector('.bar').getBoundingClientRect();
  const sheet = open ? $('panel').getBoundingClientRect() : null;
  return {
    top: bar.bottom + 34,
    left: 0,
    right: open && wide ? window.innerWidth - sheet.left : 0,
    bottom: open && !wide ? window.innerHeight - sheet.top : window.innerHeight - dock.top,
  };
}

function draw({ instant = false } = {}) {
  drawQueued = false;
  selection = selection.filter((id) => store.node.has(id));
  field.selection = new Set(selection);
  field.render({ instant });
  panel.selection = new Set(selection);
  panel.refresh();
  const current = currentTree();
  showTrees(store.view.trees, current, goToTree);
  showUndo(store.undoLabel);
  $('empty').hidden = store.view.trees.length > 0;
  if (refit && following && store.tree.has(following)) {
    field.insets = insets();
    field.show(field.treeCards(following), { instant });
  }
  refit = false;
}

function queueDraw() {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => draw());
}

function currentTree() {
  const open = panel.nodeId ?? selection[0];
  return store.node.get(open)?.treeId ?? following ?? field.treeInView();
}

function scene() {
  const treeId = currentTree();
  return { ...(panel.nodeId ? { focus: panel.nodeId } : {}), selection, ...(treeId ? { treeId } : {}) };
}

// ---- messages from the service

function receive(message) {
  switch (message.t) {
    case 'hello': {
      const first = field.cards.size === 0;
      store.replace(message.snapshot, message.undo ?? null);
      store.settings = message.settings;
      showSettings(store.settings);
      log.reset();
      for (const id of field.thinking.keys()) field.thinking.set(id, 0);
      activityNode.clear();
      if (first) {
        following = store.view.trees.at(-1)?.id ?? null;
        refit = true;
        draw({ instant: true });
      } else queueDraw();
      return;
    }
    case 'change': {
      const before = new Set(store.tree.keys());
      store.apply(message.set, message.undo ?? null);
      const made = [...store.tree.keys()].find((id) => !before.has(id));
      if (made) following = made;
      refit = true;
      queueDraw();
      return;
    }
    case 'activity': {
      const { id, state, nodeId } = message.activity;
      log.activity(message.activity);
      if (state === 'start' && nodeId) {
        activityNode.set(id, nodeId);
        field.setThinking(nodeId, 1);
      } else if (state !== 'start' && activityNode.has(id)) {
        field.setThinking(activityNode.get(id), -1);
        activityNode.delete(id);
      }
      return;
    }
    case 'say':
      caption('librarian', message.text);
      if (!muted) speak(message.text);
      return;
    case 'heard':
      caption('you', message.text, { faint: !message.final });
      return;
    case 'navigate':
      if (message.nodeId && store.node.has(message.nodeId)) openCard(message.nodeId, { glide: true });
      else if (message.treeId) goToTree(message.treeId);
      return;
    case 'handoff':
      handoff.done(message);
      return;
    case 'settings':
      store.settings = message.settings;
      showSettings(store.settings);
      return;
    case 'note':
      log.note(message.role, message.message);
      return;
    case 'error':
      toast(message.message);
      return;
  }
}
const activityNode = new Map();

// ---- what the user does

function choose(ids) {
  selection = ids;
  field.select(ids);
  panel.selection = new Set(ids);
}

function openCard(id, { add = false, glide = false } = {}) {
  choose(add ? [...new Set([...selection, id])] : [id]);
  panel.open(id, selection);
  send({ t: 'focus', nodeId: id });
  showTrees(store.view.trees, currentTree(), goToTree);
  if (glide) {
    following = null;
    field.insets = insets();
    field.show([id, ...(store.view.children.get(id) ?? []).map((child) => child.id)], { maxZoom: 1, margin: 120 });
  }
}

function goToTree(treeId) {
  const tree = store.tree.get(treeId);
  if (!tree) return;
  following = treeId;
  choose([tree.rootId]);
  if (panel.nodeId) panel.open(tree.rootId, selection);
  field.insets = insets();
  field.show(field.treeCards(treeId));
  showTrees(store.view.trees, treeId, goToTree);
}

async function dump(what) {
  const dumps = [];
  if (what.text) dumps.push({ kind: 'text', text: what.text });
  if (what.link) dumps.push({ kind: 'link', url: what.link });
  if (what.files) {
    toast(what.files.length === 1 ? `Adding ${what.files[0].name}…` : `Adding ${what.files.length} files…`);
    for (const file of what.files.slice(0, 50)) {
      try {
        const made = await conn.upload(file);
        dumps.push({ kind: 'asset', asset: made.id, mime: made.mime, name: file.name });
      } catch {
        toast(`${file.name} could not be added.`);
      }
    }
  }
  return dumps.length > 0 && send({ t: 'dump', dumps });
}

function utter(text, final) {
  return send({ t: 'utter', text, final, scene: scene() });
}

function handoffChoices() {
  const tree = store.tree.get(currentTree());
  return [
    { key: 'selection', label: selection.length === 1 ? 'The selected card' : `The ${selection.length} selected cards`, disabled: selection.length === 0, scope: { treeIds: [], nodeIds: selection } },
    { key: 'tree', label: tree ? `This tree: ${tree.title}` : 'This tree', disabled: !tree, scope: { treeIds: tree ? [tree.id] : [], nodeIds: [] } },
    { key: 'all', label: 'Everything', disabled: store.tree.size === 0, scope: { treeIds: [], nodeIds: [] } },
  ];
}

bindField(field, store, {
  onCard: (id, { add }) => openCard(id, { add }),
  onBackground: () => panel.close(),
  onUserView: () => { following = null; },
  onMove: (id, target) => send({
    t: 'commands',
    label: 'Move a card',
    commands: [{ type: 'moveNode', id, parent: target, treeId: store.node.get(target).treeId }],
  }),
});

bindDump({ veil: $('veil'), onDump: dump });

$('dump').addEventListener('submit', async (e) => {
  e.preventDefault();
  const what = textDump($('dump-text').value);
  if (what && (await dump(what))) {
    $('dump-text').value = '';
    $('dump-text').style.height = '';
  }
});
$('dump-text').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    $('dump').requestSubmit();
  }
});
$('dump-text').addEventListener('input', (e) => {
  e.target.style.height = '';
  e.target.style.height = `${Math.min(e.target.scrollHeight, 132)}px`;
});
$('file-pick').addEventListener('change', (e) => {
  if (e.target.files.length > 0) dump({ files: [...e.target.files] });
  e.target.value = '';
});

$('talk').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('talk-text').value.trim();
  if (text && utter(text, true)) $('talk-text').value = '';
});

const voice = new Voice({
  onWords: utter,
  onProblem: toast,
  onState: (state) => {
    $('mic').dataset.state = state;
    $('mic').setAttribute('aria-pressed', String(state === 'listening'));
  },
  transcribe: (blob) => conn.transcribe(blob),
});
$('mic').addEventListener('click', () => voice.toggle());

function showMute() {
  $('mute').setAttribute('aria-pressed', String(!muted));
  $('mute').title = muted ? 'The librarian is silent. Tap to hear replies.' : 'The librarian speaks its replies. Tap to silence.';
}
$('mute').addEventListener('click', () => {
  muted = !muted;
  if (muted) hush();
  try { localStorage.setItem(MUTED, muted ? '1' : '0'); } catch { /* lasts for this visit only */ }
  showMute();
});
showMute();

$('undo').addEventListener('click', () => send({ t: 'undo' }));
document.addEventListener('keydown', (e) => {
  const typing = e.target instanceof Element && e.target.closest('input, textarea');
  if (e.key === 'Escape' && !$('handoff').open) {
    if (!$('settings').hidden) $('settings-open').click();
    else panel.close();
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !typing) {
    e.preventDefault();
    send({ t: 'undo' });
  }
});

bindSettings(send);
showSettings(store.settings);
bindGate((token) => {
  saveToken(token);
  showGate(false);
  conn.start(token);
});

draw({ instant: true });
conn.start(readToken());
