import { h } from './dom.js';

const $ = (id) => document.getElementById(id);
const STATUS = { connecting: 'Connecting', live: 'Live', offline: 'Offline, retrying', denied: 'Key not accepted', 'no-token': 'No access key' };

let toastTimer = 0;
export function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-on'), 4200);
}

export function showStatus(state) {
  $('status').dataset.state = state;
  $('status').lastElementChild.textContent = STATUS[state] ?? state;
}

/** Asks for the access key when the address did not carry one, or the service refused it. */
export function bindGate(onToken) {
  $('gate-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const raw = $('gate-token').value.trim();
    const token = raw.includes('token=') ? raw.split('token=').pop() : raw;
    if (token) onToken(token);
  });
  $('status').addEventListener('click', () => {
    if ($('status').dataset.state !== 'live') showGate($('gate').hidden, 'Paste the access key the service printed when it started.');
  });
}

export function showGate(on, why) {
  $('gate').hidden = !on;
  if (why) $('gate-why').textContent = why;
  if (on) $('gate-token').focus();
}

/** The two lines above the input bar: what was heard, and what the librarian said. */
export function caption(who, text, { faint = false } = {}) {
  const box = $('caption');
  let line = box.querySelector(`[data-who="${who}"]`);
  if (!line) {
    line = h('p', { data: { who } }, h('b', { text: who === 'you' ? 'You' : 'Librarian' }), h('span'));
    if (who === 'you') box.prepend(line);
    else box.append(line);
  }
  line.lastElementChild.textContent = text;
  line.classList.toggle('is-faint', faint);
  clearTimeout(line.timer);
  line.timer = setTimeout(() => line.remove(), 9000);
}

/** The work log: which of the librarian's roles is doing what. */
export class WorkLog {
  constructor() {
    this.list = $('log-list');
    this.running = new Map();
    $('log-open').addEventListener('click', () => {
      const open = this.list.hidden;
      this.list.hidden = !open;
      $('log-open').setAttribute('aria-expanded', String(open));
      if (open) this.list.scrollTop = this.list.scrollHeight;
    });
  }

  line(role, message, state) {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const el = h('li', { data: { state } }, h('i'), h('b', { text: role }), h('span', { text: message }), h('time', { text: time }));
    const pinned = this.list.scrollTop + this.list.clientHeight >= this.list.scrollHeight - 8;
    this.list.append(el);
    while (this.list.childElementCount > 200) this.list.firstElementChild.remove();
    if (pinned) this.list.scrollTop = this.list.scrollHeight;
    return el;
  }

  activity({ id, role, state, message }) {
    if (state === 'start') {
      this.running.set(id, this.line(role, message, 'start'));
    } else {
      const el = this.running.get(id) ?? this.line(role, message, state);
      this.running.delete(id);
      el.dataset.state = state;
      if (state === 'error') el.querySelector('span').textContent = message;
    }
    this.ticker();
  }

  note(role, message) {
    this.line(role, message, 'note');
    this.ticker();
  }

  /** Work that was running when the connection dropped will never report back. */
  reset() {
    for (const el of this.running.values()) el.dataset.state = 'done';
    this.running.clear();
    this.ticker();
  }

  ticker() {
    const busy = this.running.size > 0;
    const el = busy ? [...this.running.values()].pop() : this.list.lastElementChild;
    $('log').classList.toggle('is-busy', busy);
    $('log-latest').textContent = el ? `${el.querySelector('b').textContent}: ${el.querySelector('span').textContent}` : 'The librarian is idle';
  }
}

export function showTrees(trees, current, onPick) {
  const known = $('kb-list').childElementCount;
  const chip = known > 0 && h('button', {
    class: 'kb-chip', type: 'button', 'aria-controls': 'kb', 'aria-expanded': String(!$('kb').hidden),
    title: 'What you dropped that no tree holds yet', text: `Knowledge base ${known}`, onclick: () => toggleKnowledge($('kb').hidden),
  });
  $('trees').replaceChildren(...[chip, ...trees.map((tree) =>
    h('button', { class: `tree-chip ${tree.id === current ? 'is-current' : ''}`, type: 'button', title: tree.digest || tree.title, text: tree.title || 'Untitled', onclick: () => onPick(tree.id) }))].filter(Boolean));
}

/** The list of what no tree holds. Call before showTrees, whose first chip opens it and counts it. */
export function showKnowledge(items) {
  $('kb-list').replaceChildren(...items.map((item) =>
    h('li', null, h('b', { text: item.title || item.summary || 'Untitled' }), h('span', { text: [item.kind, item.summary].filter(Boolean).join(' · ') }))));
  if (items.length === 0) toggleKnowledge(false);
}

function toggleKnowledge(open) {
  $('kb').hidden = !open;
  document.querySelector('.kb-chip')?.setAttribute('aria-expanded', String(open));
}

document.addEventListener('pointerdown', (e) => {
  if (!$('kb').hidden && !e.target.closest('#kb, .kb-chip')) toggleKnowledge(false);
});

export function showUndo(label) {
  $('undo-label').textContent = label ? `Undo: ${label}` : 'Undo';
}

export function bindSettings(send) {
  const pop = $('settings');
  const toggle = (open) => {
    pop.hidden = !open;
    $('settings-open').setAttribute('aria-expanded', String(open));
  };
  $('settings-open').addEventListener('click', () => toggle(pop.hidden));
  document.addEventListener('pointerdown', (e) => {
    if (!pop.hidden && !e.target.closest('#settings, #settings-open')) toggle(false);
  });
  for (const button of pop.querySelectorAll('[data-mode]')) {
    button.addEventListener('click', () => send({ t: 'settings', patch: { picksMode: button.dataset.mode } }));
  }
  const step = (by) => {
    const next = Math.max(1, Math.min(8, Number($('picks-count').value) + by));
    send({ t: 'settings', patch: { picksPerRun: next } });
  };
  $('picks-less').addEventListener('click', () => step(-1));
  $('picks-more').addEventListener('click', () => step(1));
}

export function showSettings(settings) {
  for (const button of $('settings').querySelectorAll('[data-mode]')) {
    button.setAttribute('aria-checked', String(button.dataset.mode === settings.picksMode));
  }
  $('picks-count').value = settings.picksPerRun;
}

/** The handoff sheet: choose what to package, then the download and a preview of what was written. */
export class HandoffSheet {
  constructor({ send, link, choices }) {
    Object.assign(this, { send, link, choices });
    this.dialog = $('handoff');
    $('handoff-open').addEventListener('click', () => this.open());
    $('handoff-go').addEventListener('click', () => this.go());
  }

  open() {
    const options = this.choices();
    const first = options.find((option) => !option.disabled);
    $('handoff-scope').replaceChildren(
      h('legend', { text: 'What to package' }),
      ...options.map((option) => h('label', { class: `choice ${option.disabled ? 'is-off' : ''}` },
        h('input', { type: 'radio', name: 'scope', value: option.key, disabled: option.disabled, checked: option === first }),
        h('span', { text: option.label }))));
    this.options = options;
    $('handoff-result').hidden = true;
    $('handoff-go').disabled = false;
    $('handoff-go').textContent = 'Package';
    if (!this.dialog.open) this.dialog.showModal();
  }

  go() {
    const picked = this.dialog.querySelector('input[name="scope"]:checked')?.value;
    const option = this.options.find((candidate) => candidate.key === picked);
    if (!option) return;
    const note = $('handoff-note').value.trim();
    if (!this.send({ t: 'handoff', scope: option.scope, ...(note ? { note } : {}) })) return;
    $('handoff-go').disabled = true;
    $('handoff-go').textContent = 'Packaging…';
  }

  done({ name, url, markdown, files }) {
    if (!this.dialog.open) this.open();
    $('handoff-go').disabled = false;
    $('handoff-go').textContent = 'Package again';
    $('handoff-link').href = this.link(url);
    $('handoff-link').download = `${name}.zip`;
    $('handoff-link').textContent = `Download ${name}.zip`;
    $('handoff-files').textContent = `${files.length} ${files.length === 1 ? 'file' : 'files'} inside. This is the summary:`;
    $('handoff-preview').textContent = markdown;
    $('handoff-result').hidden = false;
  }
}
