const PAN_SLOP = 5;
const DRAG_SLOP = 8;
const HOLD_MS = 350;

/**
 * Pointer input on the field: drag to pan, wheel or pinch to zoom, click a card to open it,
 * drag a card onto another to move it there. With touch, a card is picked up by holding it,
 * so a swipe that starts on a card still pans.
 */
export function bindField(field, store, { onCard, onBackground, onMove, onUserView }) {
  const root = field.root;
  const pointers = new Map();
  let gesture = null;

  const validTarget = (dragged, target) =>
    target && !store.isUnder(target, dragged) && store.node.get(dragged)?.parent !== target ? target : null;

  const spread = () => {
    const [a, b] = [...pointers.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };

  const dropHeld = () => {
    if (gesture?.kind === 'card' && gesture.dragging) {
      field.releaseCard(gesture.id);
      field.setDropTarget(null);
    }
    clearTimeout(gesture?.hold);
  };

  root.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button, a, input, textarea')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    root.setPointerCapture(e.pointerId);
    if (pointers.size === 2) {
      dropHeld();
      gesture = { kind: 'pinch', last: spread() };
      return;
    }
    const id = e.target.closest('.card')?.dataset.id;
    gesture = { kind: id ? 'card' : 'pan', id, x0: e.clientX, y0: e.clientY, lastX: e.clientX, lastY: e.clientY, moved: false, dragging: false, shift: e.shiftKey, canDrag: e.pointerType !== 'touch' };
    if (id) {
      const at = field.toWorld(e.clientX, e.clientY);
      const card = field.cards.get(id);
      gesture.grab = { x: at.x - card.cur.x, y: at.y - card.cur.y };
      if (e.pointerType === 'touch') {
        const held = gesture;
        held.hold = setTimeout(() => {
          if (gesture === held && !held.moved) held.canDrag = true;
        }, HOLD_MS);
      }
    }
  });

  root.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId) || !gesture) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (gesture.kind === 'pinch') {
      if (pointers.size < 2) return;
      const now = spread();
      field.panBy(now.x - gesture.last.x, now.y - gesture.last.y);
      field.zoomAt(now.x, now.y, now.d / Math.max(gesture.last.d, 1));
      gesture.last = now;
      onUserView();
      return;
    }
    const far = Math.hypot(e.clientX - gesture.x0, e.clientY - gesture.y0);
    if (gesture.kind === 'card' && gesture.canDrag) {
      if (!gesture.dragging && far < DRAG_SLOP) return;
      gesture.dragging = true;
      gesture.moved = true;
      const at = field.toWorld(e.clientX, e.clientY);
      field.dragCard(gesture.id, at.x - gesture.grab.x, at.y - gesture.grab.y);
      field.setDropTarget(validTarget(gesture.id, field.cardAt(e.clientX, e.clientY, gesture.id)));
      return;
    }
    if (!gesture.moved && far < PAN_SLOP) return;
    gesture.moved = true;
    field.panBy(e.clientX - gesture.lastX, e.clientY - gesture.lastY);
    gesture.lastX = e.clientX;
    gesture.lastY = e.clientY;
    onUserView();
  });

  const finish = (e, cancelled) => {
    if (!pointers.delete(e.pointerId) || !gesture) return;
    const done = gesture;
    clearTimeout(done.hold);
    if (done.kind === 'pinch') {
      gesture = pointers.size === 0 ? null : gesture;
      return;
    }
    gesture = null;
    if (done.kind === 'card' && done.dragging) {
      const target = cancelled ? null : field.dropTarget;
      field.setDropTarget(null);
      field.releaseCard(done.id);
      if (target) onMove(done.id, target);
      return;
    }
    if (cancelled || done.moved) return;
    if (done.kind === 'card') onCard(done.id, { add: done.shift || e.shiftKey });
    else onBackground();
  };
  root.addEventListener('pointerup', (e) => finish(e, false));
  root.addEventListener('pointercancel', (e) => finish(e, true));

  root.addEventListener('wheel', (e) => {
    e.preventDefault();
    field.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0016)));
    onUserView();
  }, { passive: false });
}

const LINK = /^https?:\/\/\S+$/i;

/** A typed or pasted thought: one bare address is a link, anything else is text. */
export function textDump(raw) {
  const text = raw.trim();
  if (!text) return null;
  return LINK.test(text) ? { link: text } : { text };
}

function carried(data) {
  const files = [...(data?.files ?? [])];
  if (files.length > 0) return { files };
  const address = (data?.getData('text/uri-list') ?? '').split('\n').map((line) => line.trim()).find((line) => line && !line.startsWith('#'));
  if (address && LINK.test(address)) return { link: address };
  return textDump(data?.getData('text/plain') ?? '');
}

/** Anything dropped on the page or pasted outside a text box goes to the mindstorm. */
export function bindDump({ veil, onDump }) {
  let depth = 0;
  const offered = (e) => [...(e.dataTransfer?.types ?? [])].some((type) => type === 'Files' || type.startsWith('text/'));
  const show = (on) => veil.classList.toggle('is-on', on);

  window.addEventListener('dragenter', (e) => {
    if (!offered(e)) return;
    e.preventDefault();
    depth += 1;
    show(true);
  });
  window.addEventListener('dragover', (e) => {
    if (!offered(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (depth === 0) show(false);
  });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    depth = 0;
    show(false);
    const what = carried(e.dataTransfer);
    if (what) onDump(what);
  });
  document.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files ?? [])];
    const typing = e.target instanceof Element && e.target.closest('input, textarea');
    if (files.length === 0 && typing) return;
    const what = carried(e.clipboardData);
    if (!what) return;
    e.preventDefault();
    onDump(what);
  });
}
