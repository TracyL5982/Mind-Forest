import { h, put, safeUrl } from './dom.js';
import { chipSources } from './chips.js';
import { drawDetail } from './components/index.js';

const HOW = { paste: 'You pasted this', drop: 'You dropped this in', voice: 'You said this', link: 'A link you added', web: 'Found on the web', instagram: 'Found on Instagram', 'image-gen': 'Made for you as a picture', idea: 'An idea from the librarian' };

function cameFrom(item) {
  const known = HOW[item.source.from];
  if (known) return known;
  if (item.source.from.startsWith('chat-export')) return 'From a chat you exported';
  return item.origin.by === 'agent' ? `Brought by the librarian (${item.source.from})` : `You added this (${item.source.from})`;
}

function when(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

/** The opened card: everything it holds, and what you can do with it. */
export class Panel {
  constructor({ el, store, send, asset, onClose }) {
    Object.assign(this, { el, store, send, asset, onClose });
    this.nodeId = null;
    this.editing = false;
    this.selection = new Set();

    this.badge = h('span', { class: 'badge' });
    this.count = h('span', { class: 'panel-count' });
    this.scroll = h('div', { class: 'panel-scroll' });
    this.actions = h('div', { class: 'panel-actions' });
    this.askText = h('input', { id: 'ask-text', type: 'text', placeholder: 'Ask about this card', 'aria-label': 'Ask about this card', autocomplete: 'off', enterkeyhint: 'send' });
    const ask = h('form', { class: 'panel-ask', onsubmit: (e) => {
      e.preventDefault();
      const need = this.askText.value.trim();
      if (!need || !this.nodeId) return;
      if (this.send({ t: 'ask', nodeId: this.nodeId, need })) this.askText.value = '';
    } }, this.askText, h('button', { class: 'btn', type: 'submit', text: 'Ask' }));
    el.append(
      h('div', { class: 'panel-head' }, this.badge, this.count,
        h('button', { class: 'btn icon', type: 'button', 'aria-label': 'Close', text: '✕', onclick: () => this.close() })),
      this.scroll, this.actions, ask);
  }

  open(nodeId, selection) {
    if (this.nodeId !== nodeId) {
      this.editing = false;
      this.askText.value = '';
      this.scroll.scrollTop = 0;
    }
    this.nodeId = nodeId;
    this.selection = new Set(selection);
    this.el.hidden = false;
    this.refresh();
  }

  close() {
    if (this.nodeId === null) return;
    this.nodeId = null;
    this.editing = false;
    this.el.hidden = true;
    this.onClose();
  }

  refresh() {
    if (this.nodeId === null) return;
    const node = this.store.node.get(this.nodeId);
    const item = node && this.store.item.get(node.itemId);
    if (!item) return this.close();
    const pick = node.status === 'pick';

    this.badge.textContent = pick ? 'Pick from the librarian' : node.parent === null ? 'Start of a tree' : 'Kept';
    this.badge.classList.toggle('is-pick', pick);
    this.el.classList.toggle('is-pick', pick);
    this.el.style.setProperty('--tint', this.store.view.colour.get(node.id) ?? '');
    this.count.textContent = this.selection.size > 1 ? `${this.selection.size} cards selected` : '';

    const picks = [...this.selection].filter((id) => this.store.node.get(id)?.status === 'pick');
    const keep = picks.length > 1 ? picks : pick ? [node.id] : [];
    put(this.actions,
      keep.length > 0 && h('button', { class: 'btn accent', type: 'button', text: keep.length > 1 ? `Keep ${keep.length} picks` : 'Keep', onclick: () => this.send({ t: 'keep', nodeIds: keep }) }),
      h('button', { class: 'btn', type: 'button', text: 'More', title: 'Bring more picks for this card', onclick: () => this.send({ t: 'more', nodeId: node.id }) }),
      h('button', { class: 'btn', type: 'button', text: 'Edit', onclick: () => { this.editing = true; this.refresh(); } }),
      this.deleteButton(node),
    );
    if (this.editing && this.scroll.querySelector('form')) return;

    const url = safeUrl(item.source.url ?? '');
    const parts = this.editing ? [this.editForm(item)] : [
      h('h2', { class: 'panel-title', dir: 'auto', text: item.title || 'Untitled' }),
      node.why && h('p', { class: `panel-why ${pick ? 'is-pick' : ''}` }, h('span', { text: 'Why it is here' }), node.why),
      drawDetail(node, item, { asset: this.asset }),
      item.summary && item.summary !== item.title && h('p', { class: 'panel-summary', dir: 'auto', text: item.summary }),
      item.text && item.text !== item.summary && item.text !== item.title && h('p', { class: 'panel-text', dir: 'auto', text: item.text }),
      item.tags.length > 0 && h('div', { class: 'tags' }, item.tags.map((tag) => h('span', { class: 'tag', text: tag }))),
      h('dl', { class: 'facts' },
        chipSources(item).map(({ kind, label, text }) => [h('dt', { text: label }), h('dd', { data: { chip: kind }, text })]),
        h('dt', { text: 'From' }), h('dd', { text: cameFrom(item) }),
        url && [h('dt', { text: 'Source' }), h('dd', null, h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', text: url.replace(/^https?:\/\//, '') }))],
        when(item.source.capturedAt) && [h('dt', { text: 'Added' }), h('dd', { text: when(item.source.capturedAt) })],
      ),
    ];
    put(this.scroll, parts);
  }

  deleteButton(node) {
    const button = h('button', { class: 'btn danger', type: 'button', text: 'Delete' });
    let armed = false;
    button.addEventListener('click', () => {
      if (!armed) {
        armed = true;
        button.textContent = 'Really delete?';
        setTimeout(() => { armed = false; button.textContent = 'Delete'; }, 3000);
        return;
      }
      const root = node.parent === null;
      this.send({
        t: 'commands',
        label: root ? 'Delete a tree' : 'Delete a card',
        commands: [root ? { type: 'deleteTree', id: node.treeId } : { type: 'deleteNode', id: node.id }],
      });
    });
    return button;
  }

  editForm(item) {
    const title = h('input', { id: 'edit-title', type: 'text', value: item.title, 'aria-label': 'Title' });
    const text = h('textarea', { id: 'edit-text', rows: 8, 'aria-label': 'Text' });
    text.value = item.text;
    const done = () => { this.editing = false; this.refresh(); };
    return h('form', { class: 'panel-edit', onsubmit: (e) => {
      e.preventDefault();
      const patch = {};
      if (title.value.trim() && title.value !== item.title) patch.title = title.value.trim();
      if (text.value !== item.text) patch.text = text.value;
      if (Object.keys(patch).length > 0) this.send({ t: 'commands', label: 'Edit a card', commands: [{ type: 'editItem', id: item.id, patch }] });
      done();
    } },
      h('label', { for: 'edit-title', text: 'Title' }), title,
      h('label', { for: 'edit-text', text: 'Text' }), text,
      h('div', { class: 'panel-edit-row' },
        h('button', { class: 'btn accent', type: 'submit', text: 'Save' }),
        h('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: done })));
  }
}
