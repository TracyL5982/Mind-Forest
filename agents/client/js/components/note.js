import { h } from '../dom.js';
import { FRAME, TEXT, TEXT_LETTER, TITLE, TITLE_LETTER, fold, text, title } from './shared.js';

const WIDTH = 240;
const COLUMN = WIDTH - 33;

function plan(item, props) {
  const emphasis = text(props.emphasis);
  const body = item.summary || item.text;
  const shown = body && body !== item.title ? body : '';
  return {
    emphasis,
    body: shown,
    titleLines: fold(item.title || 'Untitled', COLUMN, TITLE_LETTER, 2),
    bodyLines: shown ? fold(shown, COLUMN, TEXT_LETTER, emphasis ? 2 : 3) : 0,
  };
}

export function size(item, props) {
  const { emphasis, titleLines, bodyLines } = plan(item, props);
  return [WIDTH, FRAME + titleLines * TITLE + (emphasis ? 6 + TEXT : 0) + (bodyLines ? 6 + bodyLines * TEXT : 0)];
}

export function draw(item, props) {
  const { emphasis, body, titleLines, bodyLines } = plan(item, props);
  return [
    title(item, titleLines),
    emphasis && h('div', { class: 'note-emphasis clamp-1', text: emphasis }),
    body && h('div', { class: `card-text clamp-${bodyLines}`, text: body }),
  ];
}

export const detail = () => [];
