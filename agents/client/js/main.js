import { Connection, readToken, saveToken } from './connection.js';
import { Store } from './store.js';
import { Field } from './field.js';
import { Panel } from './panel.js';
import { useMaps } from './map.js';
import { bindField, bindDump, isSound, measure, textDump } from './input.js';
import { Voice, speak, hush, watchReplies } from './voice.js';
import { Cues, HandsFree, wakeProblem } from './wake.js';
import { LiveVoice } from './live.js';
import { Turn } from './turn.js';
import { HandoffSheet, WorkLog, bindGate, bindSettings, bindTelegram, caption, showDoing, showGate, showKnowledge, showSettings, showStatus, showTrees, showUndo, toast } from './chrome.js';

const $ = (id) => document.getElementById(id);
const MUTED = 'mind-palace-muted';

const store = new Store();
const conn = new Connection({ onMessage: receive, onStatus: status });
const asset = (url) => conn.withToken(url);
const field = new Field({ root: $('field'), store, asset });
const log = new WorkLog();
const panel = new Panel({ el: $('panel'), store, send: (message) => (message.t === 'ask' ? ask(message) : send(message)), asset, onClose: () => choose([]) });
const handoff = new HandoffSheet({ send, link: asset, choices: handoffChoices });

let selection = [];
/** The tree the view keeps fitted while it grows. Cleared as soon as the user moves the view. */
let following = null;
let drawQueued = false;
let refit = false;
let muted = false;
let voiced = false;
/** Momo's live voice, once the service is reached: it speaks every reply itself while it is ready. */
let live = null;
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
  showKnowledge(store.view.unplaced);
  showTrees(store.view.trees, current, goToTree);
  showUndo(store.undoLabel);
  $('empty').hidden = store.view.trees.length + store.view.unplaced.length > 0;
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
      useMaps(message.maps ?? null);
      store.replace(message.snapshot, message.undo ?? null);
      store.settings = message.settings;
      handsFree.rename(agentName());
      showMic();
      voiced = message.voice === true;
      voice.serviceHears = message.hearing === 'service';
      if (message.live) live ??= new LiveVoice({
        token: conn.token,
        connection: message.connection,
        name: agentName,
        onReady: (on) => handsFree.stream(on),
        onOver: () => {
          handsFree.over();
          turn.over();
        },
        onHeard: (text, final) => caption('you', text, { faint: !final }),
        onQuiet: () => {
          handsFree.over();
          turn.quiet();
        },
        onNotNamed: () => {
          handsFree.over();
          turn.quiet();
        },
        onSpeaking: momoHeard,
        onText: (text) => caption('librarian', text),
      });
      if (live) {
        live.muted = muted;
        live.link(message.connection);
      }
      showSettings(store.settings);
      log.reset();
      turn.reset();
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
      // A drop that no tree takes would otherwise seem to vanish, so the user is told where it went.
      const added = new Set((message.set.patches ?? []).filter((p) => p.entity === 'item' && p.before === null && p.after).map((p) => p.id));
      const loose = store.view.unplaced.filter((item) => added.has(item.id));
      if (loose.length > 0 && !message.set.undoes) toast(loose.length === 1 ? `“${loose[0].title}” is in your knowledge base` : `${loose.length} things are in your knowledge base`);
      refit = true;
      queueDraw();
      return;
    }
    case 'activity': {
      const { id, state, nodeId } = message.activity;
      log.activity(message.activity);
      turn.activity(message.activity);
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
      turn.said(muted && !live?.ready);
      if (!muted) reply(message.text);
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
      handsFree.rename(agentName());
      showMic();
      showSettings(store.settings);
      return;
    case 'note':
      log.note(message.role, message.message);
      return;
    case 'error':
      toast(message.message);
      return;
    case 'questions':
      panel.offer(message.nodeId, message.questions);
      return;
  }
}
const activityNode = new Map();

// ---- what the user does

function choose(ids) {
  selection = ids;
  field.select(ids);
  panel.selection = new Set(ids);
  const about = ids.length > 0;
  $('dump-text').placeholder = about ? 'Ask for something about this card, or paste to add' : 'Type or paste a thought or a link';
}

/** With a card chosen, a short typed line is about that card, so the librarian reads it. Anything else is a new thought. */
function aboutChosen(what) {
  return selection.length > 0 && what.text && what.text.length <= 280 && !what.text.includes('\n');
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
        const [made, sound] = await Promise.all([conn.upload(file), isSound(file) ? measure(file) : null]);
        dumps.push({ kind: 'asset', asset: made.id, mime: made.mime, name: file.name, ...(sound && { sound }) });
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

/** A question typed or picked goes straight to the agent: sent, then thinking. */
function asked(sent) {
  if (!sent) return false;
  cues.unlock();
  turn.over(true);
  return true;
}

function ask(message) {
  return asked(send(message));
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
  if (what && (aboutChosen(what) ? asked(utter(what.text, true)) : await dump(what))) {
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
  if (text && asked(utter(text, true))) $('talk-text').value = '';
});

// ---- the microphone: hands-free when the page can listen for the agent's name, a tap per recording when it cannot

const agentName = () => (store.settings?.agentName ?? 'momo').trim().replace(/(^|\s)(\p{L})/gu, (_, gap, letter) => gap + letter.toUpperCase());
/** null when the page can listen for the name, otherwise why not. Undefined until the microphone is first pressed. */
let cannotListen;
/** The microphone itself: off, starting, waiting for the name, or idle (a tap per recording). The turn's state shows over it. */
let listener = 'off';

const MIC = {
  off: () => [`Listen for "Hey ${agentName()}"`, 'Ask or tell the librarian'],
  starting: () => ['Starting to listen', 'Starting to listen…'],
  waiting: () => [`Listening for "Hey ${agentName()}". Tap to stop.`, `Say "Hey ${agentName()}", or type`],
  idle: () => [cannotListen ? `Tap to talk. Hands-free listening is off because ${cannotListen}.` : 'Talk', 'Ask or tell the librarian'],
  listening: () => ['Hearing you. Tap to stop.', 'Hearing you…'],
  sent: () => ['Sent', 'Sent'],
  thinking: () => [`${agentName()} is thinking`, `${agentName()} is thinking…`],
  responding: () => [`${agentName()} is speaking`, `${agentName()} is speaking…`],
  working: () => [`${agentName()} is working: ${turn.step}`, `${turn.step}…`],
};

/** The short line under the question, for the states that have one. */
const DOING = {
  sent: () => 'Thinking…',
  thinking: () => 'Thinking…',
  working: () => `${turn.step}…`,
};

function showMic() {
  const state = turn.state === 'waiting' ? listener : turn.state;
  const [label, prompt] = MIC[state]();
  $('mic').dataset.state = state;
  $('mic').setAttribute('aria-pressed', String(listener === 'starting' || listener === 'waiting' || turn.state === 'listening'));
  $('mic').setAttribute('aria-label', label);
  $('mic').title = label;
  $('talk-text').placeholder = prompt;
}

const cues = new Cues();
cues.mute(muted);
const turn = new Turn((state, from) => {
  if (state === 'sent' && from !== 'sent') cues.sent();
  cues.thinking(state === 'thinking');
  if (state === 'listening' && from !== 'listening') caption('you', null);
  showDoing(DOING[state]?.() ?? null);
  showMic();
});

/** Momo started or stopped being heard, by the live voice or the page's own. Muted nothing echoes, so the name is still listened for. */
function momoHeard(playing, interruptible = false) {
  handsFree.replyPlaying(playing, muted || interruptible);
  turn.speaking(playing);
}

const voice = new Voice({
  onWords: (text, final) => {
    utter(text, final);
    if (final && turn.state === 'listening') turn.over();
  },
  onProblem: toast,
  onState: (state) => {
    listener = 'idle';
    if (state === 'listening') turn.listen();
    else if (state === 'working') turn.over();
    else if (turn.state === 'listening') turn.quiet();
    showMic();
  },
  transcribe: (blob) => conn.transcribe(blob, currentTree()),
});

/** A reply that arrives while the user is being recorded waits until the recording ends, so it is not recorded into what they say. */
let waitingReply = null;
function reply(text) {
  if (live?.ready) return;
  if (handsFree.state === 'hearing') waitingReply = text;
  else speak(text, voiced ? conn.speechUrl(text) : null);
}

const handsFree = new HandsFree({
  cues,
  onState: (state) => {
    listener = state === 'off' || state === 'starting' ? state : 'waiting';
    if (state === 'hearing') turn.listen();
    else if (state === 'working') turn.over();
    else if (state === 'off' && turn.state === 'listening') turn.quiet();
    showMic();
    if (state === 'hearing' || waitingReply === null) return;
    const text = waitingReply;
    waitingReply = null;
    if (!muted) reply(text);
  },
  onProblem: toast,
  onRecorded: async (blob) => {
    try {
      // The recording began with what the spotter took for the name, and the service checks that it was.
      const text = (await conn.transcribe(blob, currentTree(), { woke: true })).trim();
      if (text) utter(text, true);
      else {
        toast('Nothing was heard after the name.');
        turn.quiet();
      }
    } catch {
      toast('That recording could not be turned into text.');
      turn.quiet();
    }
    handsFree.done();
  },
  onWoke: (sound) => live?.named(sound),
  onStart: () => live?.start(scene()),
  onPiece: (pcm) => live?.audio(pcm),
  onEnd: (said) => {
    if (said) return live?.end();
    live?.cancel();
    turn.quiet();
  },
});
watchReplies((playing) => momoHeard(playing));
/** For scripts/wake-check.ts, which measures how hard the listener works. */
window.handsFreeBusy = () => handsFree.busy();

$('mic').addEventListener('click', async () => {
  if (cannotListen === undefined) {
    cannotListen = await wakeProblem();
    // The press asked for hands-free listening, not a recording, so it only says why that is off.
    if (cannotListen) {
      listener = 'idle';
      showMic();
      return toast(`This page cannot listen for "Hey ${agentName()}": ${cannotListen}. Tap the microphone again to talk once.`);
    }
  }
  live?.unlock();
  cues.unlock();
  if (cannotListen === null) return handsFree.on ? handsFree.stop() : handsFree.start(agentName());
  voice.toggle();
});

function showMute() {
  $('mute').setAttribute('aria-pressed', String(!muted));
  $('mute').title = muted ? 'The librarian is silent. Tap to hear replies.' : 'The librarian speaks its replies. Tap to silence.';
}
$('mute').addEventListener('click', () => {
  muted = !muted;
  if (muted) hush();
  if (live) live.muted = muted;
  if (muted) live?.stop();
  cues.mute(muted);
  cues.thinking(turn.state === 'thinking');
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
bindTelegram((method, path) => conn.api(method, path));
showSettings(store.settings);
bindGate((token) => {
  saveToken(token);
  showGate(false);
  conn.start(token);
});

draw({ instant: true });
conn.start(readToken());
