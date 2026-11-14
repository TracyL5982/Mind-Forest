const SVG = 'http://www.w3.org/2000/svg';

function fill(el, attrs, kids) {
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') el.setAttribute('class', value);
    else if (key === 'text') el.textContent = value;
    else if (key === 'style') Object.assign(el.style, value);
    else if (key === 'data') Object.assign(el.dataset, value);
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid);
  }
  return el;
}

/** Text only ever enters the page through textContent or append, never as markup. */
export const h = (tag, attrs, ...kids) => fill(document.createElement(tag), attrs, kids);
export const s = (tag, attrs, ...kids) => fill(document.createElementNS(SVG, tag), attrs, kids);

/** Replaces an element's children, skipping the blanks a conditional leaves behind. */
export const put = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter((kid) => kid !== null && kid !== undefined && kid !== false && kid !== ''));

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const ease = (u) => { const t = clamp(u, 0, 1); return t * t * t * (t * (6 * t - 15) + 10); };

export function safeUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}
