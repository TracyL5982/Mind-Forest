import { FRAME, SIDES, TEXT, TEXT_LETTER, TITLE, TITLE_LETTER, fold, say, text, title } from './shared.js';

const WIDTH = 240;
const COLUMN = WIDTH - SIDES;

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

export const shows = [];

export function size(item, props) {
  const { emphasis, titleLines, bodyLines } = plan(item, props);
  return [WIDTH, FRAME + titleLines * TITLE + (emphasis ? 6 + TEXT : 0) + (bodyLines ? 6 + bodyLines * TEXT : 0)];
}

export function draw(item, props) {
  const { emphasis, body, titleLines, bodyLines } = plan(item, props);
  return [
    title(item, titleLines),
    emphasis && say('div', 'note-emphasis clamp-1', emphasis),
    body && say('div', `card-text clamp-${bodyLines}`, body),
  ];
}

export const detail = () => [];
