// Built from src/core/layout.ts by scripts/layout-js.ts. Edit that file and run the script.
/**
 * The assembled arrangement: members laid out by a structure the model describes, in rows, columns and grids nested up to four deep.
 * The model gives the structure as a flat list of parts; `parseFlat` turns it into a tree, `collapse` simplifies the tree, `measure`
 * and `place` set every card from the cards' own footprints, and `shapeOk` says whether the block looks right or should be drawn as
 * a cluster instead. This file is plain code with no imports, and `scripts/layout-js.ts` builds it into `client/js/core/layout.js`,
 * so the service and the web client place cards with the same lines.
 */
export const ROLES = ['lead', 'normal', 'minor'];
export const KINDS = ['row', 'column', 'grid'];
export const JOINS = ['arrow', 'line'];
export const LIMITS = { depth: 4, cards: 12, boxes: 8, least: 3, label: 40 };
/** Spacing in px. A gap is a gallery's; a joined gap is a sequence's, room for its arrow. */
export const SPACE = { gap: 12, joined: 44, label: 24, inset: 10 };
/** The most room the content of a block may take, and the least share of it the cards must fill. */
export const SHAPE = { width: 1100, height: 1000, wide: 4, tall: 1.5, fill: 0.5 };
const isBox = (part) => part.kind !== 'card';
/**
 * The tree the flat parts describe, or why there is none. Each part is a card or a container, and the children of a container are
 * the parts that name it, in the order they come. Every card must be one of `members`.
 */
export function parseFlat(parts, members) {
    const byId = new Map();
    for (const part of parts) {
        if (byId.has(part.id))
            return { why: `it names ${part.id} twice` };
        byId.set(part.id, part);
    }
    const cards = parts.filter((part) => part.kind === 'card');
    const boxes = parts.filter((part) => part.kind !== 'card');
    const stranger = cards.find((card) => !members.has(card.id));
    if (stranger)
        return { why: `${stranger.id} is not one of the siblings` };
    if (cards.length > LIMITS.cards)
        return { why: `it holds ${cards.length} members, more than ${LIMITS.cards}` };
    if (cards.length < LIMITS.least)
        return { why: `it holds ${cards.length} members, fewer than ${LIMITS.least}` };
    if (boxes.length > LIMITS.boxes)
        return { why: `it holds ${boxes.length} containers, more than ${LIMITS.boxes}` };
    for (const part of parts) {
        if (part.parent === '')
            continue;
        const parent = byId.get(part.parent);
        if (!parent)
            return { why: `${part.id} names a parent, ${part.parent}, that is not there` };
        if (parent.kind === 'card')
            return { why: `${part.id} sits inside a card` };
    }
    const outer = parts.filter((part) => part.parent === '');
    if (outer.length !== 1 || outer[0].kind === 'card')
        return { why: 'it has no one outermost container' };
    const children = new Map();
    for (const part of parts)
        if (part.parent !== '')
            children.set(part.parent, [...(children.get(part.parent) ?? []), part]);
    const reached = new Set();
    let deepest = 0;
    const build = (flat, depth) => {
        reached.add(flat.id);
        if (flat.kind === 'card')
            return { kind: 'card', id: flat.id, role: flat.role };
        deepest = Math.max(deepest, depth);
        const label = flat.label.trim();
        const join = flat.join !== 'none' && flat.kind !== 'grid' ? flat.join : undefined;
        const inside = (children.get(flat.id) ?? []).map((child) => build(child, depth + 1)).filter((child) => !isBox(child) || child.children.length > 0);
        return { kind: flat.kind, ...(label ? { label } : {}), ...(join ? { join } : {}), children: inside };
    };
    const tree = build(outer[0], 1);
    // A container that is not reached from the outermost one sits in a loop of containers that name each other.
    if (reached.size < parts.length)
        return { why: 'its containers name each other in a loop' };
    if (deepest > LIMITS.depth)
        return { why: `it nests ${deepest} containers deep, more than ${LIMITS.depth}` };
    return { tree };
}
/** The tree with every container that holds one part and no label replaced by that part. */
export function collapse(tree) {
    const squash = (part) => {
        if (!isBox(part))
            return part;
        const children = part.children.map(squash);
        return children.length === 1 && !part.label ? children[0] : { ...part, children };
    };
    const squashed = squash(tree);
    return isBox(squashed) ? squashed : { ...tree, children: [squashed] };
}
/** The members a tree draws, in the order they are read. */
export function cardsOf(part) {
    return isBox(part) ? split(part).flatMap(cardsOf) : [part.id];
}
/** Whether a tree keeps to the limits the model is given. */
export function withinLimits(tree) {
    const ids = cardsOf(tree);
    const count = (part) => (isBox(part) ? 1 + part.children.reduce((sum, child) => sum + count(child), 0) : 0);
    const depth = (part) => (isBox(part) ? 1 + Math.max(0, ...part.children.map(depth)) : 0);
    return ids.length >= LIMITS.least && ids.length <= LIMITS.cards && new Set(ids).size === ids.length && count(tree) <= LIMITS.boxes && depth(tree) <= LIMITS.depth;
}
/** A container's first lead, and its other parts with each minor moved to the end. */
function split(box) {
    const lead = box.children.find((part) => part.kind === 'card' && part.role === 'lead');
    const rest = box.children.filter((part) => part !== lead);
    const minor = (part) => part.kind === 'card' && part.role === 'minor';
    return [...(lead ? [lead] : []), ...rest.filter((part) => !minor(part)), ...rest.filter(minor)];
}
const squarish = (n) => (n <= 3 ? n : n === 4 ? 2 : 3);
/**
 * Sizes a tree bottom up. A card takes its footprint, rounded up to whole px. A container lays its parts within the width it may
 * take, and a row wraps where the next part would pass it. A lead has a row or a column to itself, first, and a minor comes last.
 * A labelled container puts its label above its parts and, inside the outermost one, a frame around both.
 */
export function measure(tree, size, labelWidth) {
    const sized = (part, room, outermost) => {
        if (!isBox(part)) {
            const [w, h] = size(part.id);
            return { part, w: Math.ceil(w), h: Math.ceil(h), size: [w, h], kids: [], marks: [] };
        }
        const inset = part.label && !outermost ? SPACE.inset : 0;
        const head = part.label ? SPACE.label : 0;
        const inner = room - 2 * inset;
        const gap = part.join ? SPACE.joined : SPACE.gap;
        const parts = split(part);
        const lead = parts[0]?.kind === 'card' && parts[0].role === 'lead' ? parts[0] : undefined;
        const rest = lead ? parts.slice(1) : parts;
        const kids = [];
        const marks = [];
        let w = 0;
        let h = 0;
        /** Lays one line of parts left to right under the lines before it, `step` apart. */
        const line = (row, step, joined) => {
            const top = kids.length > 0 ? h + SPACE.gap : 0;
            let x = 0;
            row.forEach((m, i) => {
                kids.push({ at: { x, y: top }, m });
                const next = row[i + 1];
                if (next && joined && part.join)
                    marks.push({ kind: 'join', at: { x: x + m.w, y: top, w: step, h: Math.min(m.h, next.h) }, join: part.join, across: true });
                x += m.w + step;
            });
            w = Math.max(w, x - step);
            h = top + Math.max(...row.map((m) => m.h));
        };
        if (lead) {
            const ahead = sized(lead, inner, false);
            if (part.kind === 'column') {
                kids.push({ at: { x: 0, y: 0 }, m: ahead });
                [w, h] = [ahead.w, ahead.h];
            }
            else
                line([ahead], gap, false);
        }
        if (part.kind === 'row') {
            const packed = [];
            let across = 0;
            for (const m of rest.map((each) => sized(each, inner, false))) {
                const last = packed[packed.length - 1];
                if (last && across + gap + m.w <= inner) {
                    last.push(m);
                    across += gap + m.w;
                }
                else {
                    packed.push([m]);
                    across = m.w;
                }
            }
            for (const row of packed)
                line(row, gap, true);
        }
        else if (part.kind === 'column' && rest.length > 0) {
            const left = lead ? w + SPACE.gap : 0;
            const stacked = rest.map((each) => sized(each, inner - left, false));
            let y = 0;
            stacked.forEach((m, i) => {
                kids.push({ at: { x: left, y }, m });
                const next = stacked[i + 1];
                if (next && part.join)
                    marks.push({ kind: 'join', at: { x: left, y: y + m.h, w: Math.min(m.w, next.w), h: gap }, join: part.join, across: false });
                y += m.h + gap;
            });
            w = left + Math.max(...stacked.map((m) => m.w));
            h = Math.max(h, y - gap);
        }
        else if (part.kind === 'grid' && rest.length > 0) {
            const cells = rest.map((each) => sized(each, inner, false));
            const cell = Math.max(...cells.map((m) => m.w));
            let columns = squarish(cells.length);
            while (columns > 1 && columns * cell + (columns - 1) * SPACE.gap > inner)
                columns -= 1;
            for (let start = 0; start < cells.length; start += columns) {
                const row = cells.slice(start, start + columns);
                const top = kids.length > 0 ? h + SPACE.gap : 0;
                row.forEach((m, i) => kids.push({ at: { x: i * (cell + SPACE.gap), y: top }, m }));
                h = top + Math.max(...row.map((m) => m.h));
            }
            w = Math.max(w, columns * cell + (columns - 1) * SPACE.gap);
        }
        if (part.label) {
            w = Math.max(w, labelWidth(part.label));
            for (const kid of kids)
                kid.at = { x: kid.at.x + inset, y: kid.at.y + inset + head };
            for (const mark of marks)
                mark.at = { ...mark.at, x: mark.at.x + inset, y: mark.at.y + inset + head };
            marks.push({ kind: 'label', at: { x: inset, y: inset, w, h: head }, text: part.label });
            w += 2 * inset;
            h += head + 2 * inset;
            if (inset)
                marks.push({ kind: 'frame', at: { x: 0, y: 0, w, h } });
        }
        return { part, w, h, kids, marks };
    };
    return sized(tree, SHAPE.width, true);
}
export function place(measured) {
    const cards = new Map();
    const marks = [];
    const walk = (m, x, y) => {
        if (m.part.kind === 'card')
            cards.set(m.part.id, { x, y, w: m.size[0], h: m.size[1] });
        for (const mark of m.marks)
            marks.push({ ...mark, at: { ...mark.at, x: mark.at.x + x, y: mark.at.y + y } });
        for (const kid of m.kids)
            walk(kid.m, x + kid.at.x, y + kid.at.y);
    };
    walk(measured, 0, 0);
    return { w: measured.w, h: measured.h, cards, marks };
}
/** The share of the content that cards cover. */
export function filled(placed) {
    let area = 0;
    for (const card of placed.cards.values())
        area += card.w * card.h;
    return area / (placed.w * placed.h);
}
/** Whether a placed block looks right: within the most room, neither far wider than tall nor far taller than wide, and well filled. */
export function shapeOk(placed) {
    const { w, h } = placed;
    return w <= SHAPE.width && h <= SHAPE.height && w / h <= SHAPE.wide && h / w <= SHAPE.tall && filled(placed) >= SHAPE.fill;
}
