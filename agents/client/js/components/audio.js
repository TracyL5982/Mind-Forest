import { h, s, clamp } from '../dom.js';
import { GAP, WIDTH, drawFace, lay, list, say, text, titleRow, wordsIn } from './shared.js';
import { wordsOf } from '../words.js';

/** The strip that holds the play mark, the waveform and the length, with the room above and below it. */
const STRIP = 40;
/** One bar of the waveform and the space after it, in the units of its view box, which is stretched to the room it has. */
const BAR = 2;
const STEP = 3;
const WAVE_HEIGHT = 24;

/** A length in seconds as a clock writes it: 0:20, 12:05, 1:02:03. */
export function clock(seconds) {
  const whole = Math.round(seconds);
  const pad = (n) => String(n).padStart(2, '0');
  const [hours, minutes, rest] = [Math.floor(whole / 3600), Math.floor(whole / 60) % 60, whole % 60];
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`;
}

const lengthOf = (props) => {
  const seconds = Number(props.seconds);
  return Number.isFinite(seconds) && seconds > 0 ? clock(seconds) : '';
};

const peaksOf = (props) => list(props.peaks).map(Number).filter(Number.isFinite).map((peak) => clamp(peak, 0, 1));

const flat = (words) => words.replace(/\s+/g, ' ').trim();

/** The transcript as the card writes it: on one run, without the title when it opens with the title's words. */
function heard(item) {
  const words = flat(text(item.text));
  const heading = flat(text(item.title));
  if (heading && words === heading) return '';
  return heading && words.startsWith(`${heading} `) ? words.slice(heading.length + 1) : words;
}

/** The title on up to two lines, the strip, and the first words of the transcript on as many lines as the face has room for. */
function face(item, props) {
  return lay([
    titleRow(item, { most: 2 }),
    { tall: STRIP, gap: GAP, draw: () => strip(props, lengthOf(props)) },
    { words: heard(item), gap: GAP, draw: wordsIn('card-text') },
  ], { words: wordsOf(item) });
}

export const size = (item, props) => [WIDTH, face(item, props).height];

/** The loudness of each slice as a bar about the middle line, or a flat line when nobody measured it. */
function wave(peaks, cls = '') {
  const wide = Math.max(peaks.length * STEP - (STEP - BAR), 1);
  const bars = peaks.map((peak, i) => {
    const tall = Math.max(1.5, peak * WAVE_HEIGHT);
    return s('rect', { x: i * STEP, y: (WAVE_HEIGHT - tall) / 2, width: BAR, height: tall, rx: 0.6 });
  });
  return s('svg', { class: `audio-wave ${cls}`.trim(), viewBox: `0 0 ${wide} ${WAVE_HEIGHT}`, preserveAspectRatio: 'none', 'aria-hidden': 'true' },
    peaks.length > 0 ? bars : s('rect', { class: 'audio-flat', x: 0, y: WAVE_HEIGHT / 2 - 0.75, width: wide, height: 1.5 }));
}

const strip = (props, length) => h('div', { class: 'audio-strip' },
  h('span', { class: 'audio-play', 'aria-hidden': 'true' }),
  wave(peaksOf(props)),
  length && h('span', { class: 'audio-length', text: length }));

export const draw = (item, props) => drawFace(face(item, props));

/** The waveform fills as the recording plays, and a press on it plays from there. */
function player(src, peaks, ctx) {
  const audio = h('audio', { src: ctx.asset(src), controls: true, preload: 'metadata' });
  if (peaks.length === 0) return audio;
  const track = h('div', { class: 'detail-wave' }, wave(peaks), wave(peaks, 'is-played'));
  audio.addEventListener('timeupdate', () => track.style.setProperty('--played', String(audio.duration > 0 ? audio.currentTime / audio.duration : 0)));
  track.addEventListener('click', (e) => {
    if (!(audio.duration > 0)) return;
    audio.currentTime = clamp((e.clientX - track.getBoundingClientRect().left) / track.clientWidth, 0, 1) * audio.duration;
    void audio.play().catch(() => {});
  });
  return [track, audio];
}

/** The player, and every word of the transcript as it was heard, a line for each stretch of speech. */
export function detail(item, props, ctx) {
  const src = text(props.src).trim();
  const words = text(item.text).trim();
  return [
    h('div', { class: 'detail-audio' }, src ? player(src, peaksOf(props), ctx) : h('div', { class: 'detail-note', text: wordsOf(item).noSound })),
    words && say('p', 'detail-transcript', words),
  ];
}
