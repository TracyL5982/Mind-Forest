import { h, s, clamp } from '../dom.js';
import { wordsOf } from '../words.js';

/**
 * The line heights and card padding in style.css, in px. A card's footprint is worked out from
 * these and never measured, so they change together with `--lead-*` and `.card-body`.
 */
export const DISPLAY = 36;
export const TITLE = 21;
export const TEXT = 17;
/** Top and bottom padding plus the border of a padded card, and 2 px to spare. */
export const FRAME = 30;
/** Left and right padding plus the border of a padded card, and 1 px to spare. */
export const SIDES = 33;
/**
 * The same without the px to spare: a passage in the serif counts its lines in the whole line box,
 * because a character set with Han draws exactly 16 px there, so fifteen of them fill a 240 px line
 * to the last px and a px held back would push the fifteenth onto a line of its own.
 */
export const PADDING = 32;
/** What a card with chips adds to its height: the line of chips and the gap above it. */
export const CHIP_LINE = 28;

export const text = (value) => (typeof value === 'string' ? value : '');
export const list = (value) => (Array.isArray(value) ? value : []);

/**
 * How wide each character is, in tenths of an average lowercase letter. Rows are
 * `[first code point, last code point, tenths]` and the first row that holds a code point wins.
 * Tenths given as four counts are for the title face, the text face, the quote's serif and a fact's
 * value. Past the letters, digits and signs of English, a row's count is the widest any of its
 * characters was measured drawing in that face, so text is never given less room than it takes.
 * docs/libraries.md repeats this table for other clients, and test/footprints.json holds the
 * footprints it must give.
 */
const THIN = [6, 6, 7, 6];
const SMALL = [12, 11, 13, 10];
const SIGN = [13, 12, 19, 11];
const CAPITAL = [16, 15, 17, 14];
const WIDE = [19, 20, 21, 18];
const ARROW = [20, 21, 24, 19];
const EMOJI = [22, 23, 26, 21];
const WIDEST = [28, 28, 34, 27];
const KANA = [18, 18, 21, 16];
const HAN = [17, 18, 21, 16];
const HANGUL = [15, 15, 21, 14];
const CJK = [18, 18, 21, 17];
const LIGATURE = [62, 56, 134, 58];
/** A code point in no row: as wide as the widest character outside the rows was measured drawing. */
const OTHER = [46, 47, 55, 43];
const rows = (tenths, ...ranges) => ranges.map((range) => (typeof range === 'number' ? [range, range, tenths] : [...range, tenths]));
const WIDTHS = [
  // Marks that join or change the character before them take no room.
  ...rows(0, [0x0300, 0x036f], [0x0483, 0x0489], [0x0591, 0x05bd], [0x064b, 0x065f], 0x0670, [0x0900, 0x0902], [0x0941, 0x0948], 0x094d, 0x0e31, [0x0e34, 0x0e3a], [0x0e47, 0x0e4d]),
  ...rows(0, [0x200b, 0x200f], [0x202a, 0x202e], [0x2060, 0x206f], [0xfe00, 0xfe0f], [0x1f3fb, 0x1f3ff], [0xe0000, 0xe007f]),
  // Spaces, thin punctuation, and i j l.
  ...rows(5, [0x09, 0x0d], [0x20, 0x21], 0x27, 0x2c, [0x2e, 0x2f], [0x3a, 0x3b], 0x5c, [0x69, 0x6a], 0x6c, 0x7c, 0xa0, [0x2028, 0x2029], 0x202f, 0x205f),
  // Brackets, the hyphen, and f r t.
  ...rows(7, [0x28, 0x29], 0x2d, 0x5b, 0x5d, 0x7b, 0x7d, 0x66, 0x72, 0x74),
  // Digits and the signs set as wide as a digit.
  ...rows(11, [0x30, 0x39], [0x23, 0x24], 0x2b, [0x3c, 0x3e], 0x5e, 0x7e),
  // The widest letters and signs of English.
  ...rows(15, 0x25, 0x40, 0x4d, 0x6d, 0x77),
  ...rows(17, 0x57),
  // Capitals and the ampersand.
  ...rows(12, 0x26, [0x41, 0x5a]),
  // The other small letters and signs of English.
  ...rows(10, [0x20, 0x7e]),
  // Thin spaces, single quotes, the middle dot and primes.
  ...rows(THIN, 0xb7, [0x2004, 0x2006], [0x2008, 0x200a], [0x2018, 0x201b], 0x2024, 0x2027, 0x2032, 0x2035, 0x2044),
  // Accented small letters, raised and lowered figures, double quotes, daggers, bullets, half-width kana and hangul.
  ...rows(SMALL, 0xa1, 0xa8, 0xaa, 0xad, [0xaf, 0xb0], [0xb2, 0xb4], [0xb8, 0xba], 0xbf, [0xdf, 0xe5], [0xe7, 0xf6], [0xf8, 0xff]),
  ...rows(SMALL, 0x2000, 0x2002, [0x2010, 0x2011], 0x2016, [0x201c, 0x201f], [0x2020, 0x2023], 0x2033, [0x2039, 0x203a], [0x2070, 0x209f], [0xff61, 0xffdc]),
  // Currency signs and the signs of arithmetic.
  ...rows(SIGN, [0xa2, 0xa7], [0xab, 0xac], 0xae, 0xb1, [0xb5, 0xb6], 0xbb, 0xd7, 0xf7, 0x2007, [0x2012, 0x2013]),
  ...rows(SIGN, [0x20a0, 0x20a7], [0x20ab, 0x20ae], [0x20b1, 0x20b6], [0x20b8, 0x20ba], [0x20bc, 0x20bd], 0x20bf, 0x2212, 0x221a, 0x2248, 0x2260, [0x2264, 0x2265]),
  // Accented capitals and the rest of European Latin, the tone letters of pinyin, small Greek and small Cyrillic.
  ...rows(CAPITAL, [0xc0, 0xc5], [0xc7, 0xd6], [0xd8, 0xde], [0x0100, 0x0151], [0x0154, 0x0173], [0x0175, 0x017f], [0x01cd, 0x01dc], [0x03ac, 0x03ce], [0x0430, 0x045f]),
  // Dashes, the ellipsis, fractions, joined letters, Greek and Cyrillic capitals, Armenian, Hebrew, Devanagari and Vietnamese.
  ...rows(WIDE, 0xa9, [0xbc, 0xbe], 0xc6, 0xe6, [0x0152, 0x0153], 0x0174, [0x0370, 0x03ab], [0x0410, 0x042f], [0x0530, 0x058f], [0x05be, 0x05ff], [0x0900, 0x097f], [0x1e00, 0x1eff]),
  ...rows(WIDE, 0x2001, 0x2003, [0x2014, 0x2015], [0x2025, 0x2026], [0x20a9, 0x20aa], 0x2122, 0x2126),
  // Arrows and the signs of mathematics.
  ...rows(ARROW, [0x03cf, 0x03ff], [0x2190, 0x22ff]),
  // Arabic, Thai, symbols, emoji and the second forms of Han.
  ...rows(EMOJI, [0x0600, 0x06ff], [0x0e00, 0x0e5a], [0x2300, 0x27bf], [0xf900, 0xfaff], [0x1f000, 0x1f6ff], [0x1f900, 0x1faff]),
  // Letters that stand for a word or a unit, such as the per mille and degree signs, Roman numerals, and other alphabets.
  ...rows(WIDEST, [0x0180, 0x02ff], [0x0400, 0x052f], [0x0700, 0x077f], [0x0e5b, 0x0e7f], [0x10a0, 0x10ff], [0x1f00, 0x1fff], [0x2030, 0x205e], [0x20a0, 0x218f], [0x27c0, 0x2bff]),
  ...rows(WIDEST, [0x302e, 0x302f], [0xfb00, 0xfb4f], [0xfe70, 0xfeff]),
  ...rows(KANA, [0x3040, 0x30ff]),
  ...rows(HAN, [0x3400, 0x9fff]),
  ...rows(HANGUL, [0xac00, 0xd7af]),
  // The punctuation and symbols set with Han, and full-width forms.
  ...rows(CJK, [0x2e80, 0x33ff], [0xfe10, 0xfe6f], [0xff00, 0xff60], [0xffe0, 0xffef]),
  // Arabic words and phrases drawn as one character.
  ...rows(LIGATURE, [0xfb50, 0xfdff]),
];
const JOINER = 0x200d;
const EMOJI_FORM = 0xfe0f;
const FACE_COUNT = 4;
/** Below `LOW` each face has its count for every code point laid out, so a lookup there is one read. */
const LOW = 0x3400;
const low = Array.from({ length: FACE_COUNT }, (_, face) => new Uint8Array(LOW).fill(OTHER[face]));
const high = WIDTHS.filter(([, last]) => last >= LOW);
const count = (tenths, face) => (typeof tenths === 'number' ? tenths : tenths[face]);
for (const [first, last, tenths] of [...WIDTHS].reverse()) {
  for (let face = 0; face < FACE_COUNT; face++) low[face].fill(count(tenths, face), first, Math.min(last, LOW - 1) + 1);
}
function tenthsOf(cp, face) {
  if (cp < LOW) return low[face][cp];
  const row = high.find(([first, last]) => cp >= first && cp <= last);
  return row ? count(row[2], face) : OTHER[face];
}

/**
 * How wide one average lowercase letter is at the title size, at the text size and in a quote's
 * serif, in tenths of a px. Each is the widest ratio of drawn width to `span` over a set of sample
 * strings, so most strings run short. `span` times one of these is a width in hundredths of a px.
 */
export const TITLE_LETTER = 93;
export const TEXT_LETTER = 72;
export const QUOTE_LETTER = 78;
/** One letter of the same serif set upright, as a passage and a definition are. It counts in the quote's column. */
export const PASSAGE_LETTER = 92;

/** A letter width names its face. Any letter but these is one of a figure's sizes. */
const FACES = [[TITLE_LETTER], [TEXT_LETTER], [QUOTE_LETTER, PASSAGE_LETTER]];
const FACE_OF = new Map(FACES.flatMap((letters, face) => letters.map((letter) => [letter, face])));
const faceOf = (letter) => FACE_OF.get(letter) ?? FACES.length;

/**
 * A string's width in tenths of an average lowercase letter, always a whole number, in the face
 * whose letter is `letter`. A code point that follows a zero-width joiner counts nothing, so a
 * joined emoji counts once. U+FE0F draws the character before it as an emoji, so it counts
 * whatever brings the last code point that took room up to an emoji's count.
 */
export function span(str, letter = TEXT_LETTER) {
  const face = faceOf(letter);
  let tenths = 0;
  let joined = false;
  let last = 0;
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    const add = joined ? 0 : cp === EMOJI_FORM ? Math.max(0, EMOJI[face] - last) : tenthsOf(cp, face);
    tenths += add;
    if (add > 0) last = add;
    joined = cp === JOINER;
  }
  return tenths;
}

/** a / b rounded up, for whole numbers. */
export const up = (a, b) => Math.floor((a + b - 1) / b);

/**
 * The sizes a figure can be set in, largest first: the class that sets it, its line height in px,
 * one letter in tenths of a px, and one digit in hundredths of a px. A letter here is the widest
 * any one character runs, because a figure cut short would mislead. Digits are all one width, so
 * each is counted at exactly that.
 */
export const FIGURES = [['', 36, 210, 2148], ['is-mid', 28, 149, 1506], ['is-small', 21, 105, 1001]];
const DIGIT = 11;

/** A figure's width on one line in hundredths of a px, at one of `FIGURES`. */
export const figureNeed = (value, [, , letter, digit]) => span(value, letter) * letter - (value.match(/[0-9]/g)?.length ?? 0) * (DIGIT * letter - digit);

/** The px a string is given at the text size. Most strings draw a little narrower. */
export const textWidth = (str) => up(span(str) * TEXT_LETTER, 100);

/**
 * Han, hangul syllables and kana letters. A line may end after any of them, so a string made only
 * of these fills each line to the last character that fits.
 */
const BREAKS_ANYWHERE = /^[\u3041-\u3096\u30a1-\u30fa\u30fc\u3400-\u9fff\uac00-\ud7af]+$/;

/** The lines `str` takes when each line holds every character that fits in `room` hundredths of a px. */
function packed(str, room, letter) {
  let lines = 1;
  let used = 0;
  for (const ch of str) {
    const wide = span(ch, letter) * letter;
    if (used > 0 && used + wide > room) {
      lines += 1;
      used = 0;
    }
    used += wide;
  }
  return lines;
}

/**
 * How many lines a string is given in a column `width` px wide, when one letter is `letter` tenths
 * of a px wide. A card draws the string clamped to this many lines, so a wrong guess shows an
 * ellipsis or a blank line and never spills. Two letters a line are allowed for breaking between
 * words, except in a string that can break anywhere. Every step is in whole hundredths of a px.
 */
export function fold(str, width, letter, max) {
  const need = span(str, letter) * letter;
  const room = width * 100;
  if (need <= room) return 1;
  return clamp(BREAKS_ANYWHERE.test(str) ? packed(str, room, letter) : up(need, room - 20 * letter), 1, max);
}

const ANYWHERE = /[\u3041-\u3096\u30a1-\u30fa\u30fc\u3400-\u9fff\uac00-\ud7af]/;
/** Punctuation set with Han that a line may end after, and the brackets one may start with. */
const CLOSER = /[\u3001\u3002\uff0c\uff1b\uff1a\uff1f\uff01\uff09\u300b]/;
const OPENER = /[\uff08\u300a]/;
const WORD = /[0-9A-Za-z]/;
const LATIN = /[A-Za-z]/;
/**
 * Whether a line may end after `chars[i]`, inside a word: between two characters that can each end
 * a line, after a comma or a stop set with Han, before a bracket set with Han, between a Han
 * character and a Latin letter or digit, and after a hyphen that joins two Latin letters.
 */
function parts(chars, i) {
  const [before, ch, next] = [chars[i - 1] ?? '', chars[i], chars[i + 1]];
  return ((ANYWHERE.test(ch) || CLOSER.test(ch)) && (ANYWHERE.test(next) || OPENER.test(next)))
    || (ANYWHERE.test(ch) && WORD.test(next)) || (WORD.test(ch) && ANYWHERE.test(next))
    || (ch === '-' && LATIN.test(before) && LATIN.test(next));
}

/**
 * How wide each character from U+0020 to U+007E draws, in hundredths of a px, in the faces `wrap`
 * counts in: the title, the text, the upright serif of a passage, and a figure's three sizes.
 * `WIDTHS` weighs these characters for a whole sentence. Here each has its own width, so a line
 * counted word by word ends where the page ends it. Each is the width the character draws with
 * kerning off, rounded up, and 0.02 px more. style.css sets the fourteen structured types without
 * kerning, so a word is exactly as wide as its characters. docs/libraries.md repeats the table.
 */
export const ADVANCES = new Map([
  [TITLE_LETTER, [384, 512, 833, 1018, 1018, 1572, 1139, 496, 627, 627, 731, 1018, 496, 731, 496, 484, 1034, 760, 973, 1014, 1042, 1004, 1035, 914, 1048, 1035, 496, 496, 1018, 1018, 1018, 834, 1441, 1109, 1055, 1137, 1148, 945, 907, 1173, 1198, 449, 897, 1075, 901, 1398, 1180, 1213, 1023, 1213, 1055, 1026, 1007, 1168, 1095, 1559, 1107, 1072, 1037, 627, 484, 627, 1018, 947, 762, 889, 988, 890, 988, 910, 594, 979, 955, 404, 404, 899, 416, 1426, 947, 941, 981, 981, 634, 850, 601, 947, 876, 1286, 866, 894, 856, 627, 423, 627, 1018]],
  [TEXT_LETTER, [350, 388, 596, 786, 786, 1155, 888, 370, 476, 476, 588, 786, 370, 588, 370, 380, 786, 579, 753, 782, 803, 771, 795, 710, 797, 795, 370, 370, 786, 786, 786, 640, 1146, 841, 820, 894, 907, 743, 714, 932, 927, 333, 671, 822, 709, 1091, 927, 963, 793, 963, 815, 795, 791, 920, 841, 1209, 847, 818, 826, 476, 380, 476, 786, 728, 624, 688, 767, 698, 767, 713, 451, 760, 734, 308, 307, 677, 315, 1086, 728, 737, 762, 760, 475, 653, 453, 728, 676, 967, 654, 677, 673, 476, 322, 476, 786]],
  [PASSAGE_LETTER, [447, 542, 532, 892, 892, 1410, 1332, 274, 673, 673, 729, 1335, 447, 563, 447, 740, 892, 892, 892, 892, 892, 892, 892, 892, 892, 892, 447, 447, 1335, 1335, 1335, 755, 1602, 1158, 998, 1134, 1252, 1017, 938, 1190, 1273, 546, 534, 1111, 917, 1459, 1295, 1285, 945, 1285, 1127, 868, 1012, 1262, 1149, 1662, 1140, 1057, 1070, 673, 740, 673, 1602, 802, 802, 772, 892, 717, 902, 783, 501, 828, 940, 477, 441, 876, 470, 1410, 937, 884, 899, 895, 627, 711, 578, 943, 788, 1242, 850, 780, 758, 673, 802, 673, 1335]],
  [FIGURES[0][2], [649, 1021, 1493, 2125, 2150, 2953, 2341, 883, 1239, 1239, 1473, 2150, 777, 1466, 777, 990, 2150, 2150, 2150, 2150, 2150, 2150, 2150, 2150, 2150, 2150, 777, 777, 2150, 2150, 2150, 1763, 2983, 2294, 2128, 2381, 2341, 1909, 1826, 2434, 2437, 850, 1835, 2165, 1810, 2884, 2394, 2520, 2050, 2519, 2127, 2099, 2007, 2372, 2253, 3232, 2274, 2205, 2110, 1239, 990, 1239, 2150, 1904, 1674, 1808, 1977, 1801, 1974, 1836, 1154, 1964, 1934, 772, 770, 1773, 775, 2875, 1904, 1898, 1966, 1964, 1179, 1695, 1151, 1904, 1743, 2618, 1733, 1776, 1670, 1239, 780, 1239, 2150]],
  [FIGURES[1][2], [467, 719, 1081, 1494, 1508, 2126, 1651, 634, 876, 876, 1038, 1508, 573, 1034, 573, 692, 1508, 1508, 1508, 1508, 1508, 1508, 1508, 1508, 1508, 1508, 573, 573, 1508, 1508, 1508, 1235, 2104, 1617, 1506, 1672, 1654, 1349, 1290, 1712, 1723, 604, 1294, 1533, 1279, 2036, 1692, 1774, 1452, 1774, 1505, 1480, 1422, 1677, 1589, 2281, 1606, 1555, 1490, 876, 692, 876, 1508, 1347, 1162, 1275, 1401, 1270, 1398, 1297, 818, 1390, 1367, 545, 544, 1259, 550, 2039, 1347, 1341, 1391, 1390, 844, 1200, 818, 1347, 1235, 1853, 1227, 1259, 1186, 876, 556, 876, 1508]],
  [FIGURES[2][2], [358, 497, 825, 1002, 1002, 1567, 1121, 482, 613, 613, 711, 1002, 482, 711, 482, 467, 1002, 1002, 1002, 1002, 1002, 1002, 1002, 1002, 1002, 1002, 482, 482, 1002, 1002, 1002, 819, 1420, 1095, 1039, 1118, 1129, 927, 888, 1152, 1181, 435, 885, 1060, 884, 1381, 1161, 1193, 1006, 1193, 1039, 1010, 988, 1149, 1081, 1543, 1093, 1058, 1017, 613, 467, 613, 1002, 931, 739, 873, 971, 872, 971, 892, 580, 962, 939, 388, 388, 886, 400, 1414, 931, 923, 965, 965, 621, 834, 586, 931, 861, 1275, 853, 881, 838, 613, 407, 613, 1002]],
]);
/** How wide a character set with Han draws in each of those faces, in hundredths of a px: the size the face is set in, less its letter spacing. */
const EM = new Map([[TITLE_LETTER, 1591], [TEXT_LETTER, 1250], [PASSAGE_LETTER, 1600], [FIGURES[0][2], 3332], [FIGURES[1][2], 2352], [FIGURES[2][2], 1568]]);
const SQUARE = /[\u3000-\u30ff\u3400-\u9fff\uff01-\uff60\uffe0-\uffe6]/;

/**
 * A string's width on one line in hundredths of a px, counted for `wrap`: each character from
 * U+0020 to U+007E by `ADVANCES`, each character set with Han by `EM`, and the rest of the string,
 * with those taken out, by `span`.
 */
export function advance(str, letter) {
  const widths = ADVANCES.get(letter);
  if (!widths) return span(str, letter) * letter;
  let wide = 0;
  let others = '';
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    if (cp >= 0x20 && cp <= 0x7e) wide += widths[cp - 0x20];
    else if (SQUARE.test(ch)) wide += EM.get(letter);
    else others += ch;
  }
  return wide + span(others, letter) * letter;
}

/**
 * How many lines a string is given in a column too narrow for `fold`, where one long word can
 * leave half a line empty. The words are laid out one by one, each as wide as `advance` counts it.
 * A line may end at white space and where `parts` says a word parts, and nowhere else, which is at
 * most where a page breaks. A word wider than a line starts a line of its own and is broken
 * wherever a line ends.
 */
export function wrap(str, width, letter, max) {
  const room = width * 100;
  const space = advance(' ', letter);
  let lines = 1;
  let used = 0;
  const place = (wide, gap) => {
    if (used > 0 && used + gap + wide > room) {
      lines += 1;
      used = 0;
    }
    used += (used > 0 ? gap : 0) + wide;
  };
  for (const word of str.split(/\s+/).filter(Boolean)) {
    let gap = space;
    let unit = '';
    const chars = [...word];
    chars.forEach((ch, i) => {
      unit += ch;
      const next = chars[i + 1];
      if (next !== undefined && !parts(chars, i)) return;
      const wide = advance(unit, letter);
      if (wide <= room) place(wide, gap);
      else [...unit].forEach((part, k) => place(advance(part, letter), k === 0 ? room : 0));
      gap = 0;
      unit = '';
    });
  }
  return clamp(lines, 1, max);
}

const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

/** A string as the characters a reader sees, so a cut never lands inside an emoji or an accent. */
export function graphemes(str) {
  if (segmenter) return Array.from(segmenter.segment(str), (part) => part.segment);
  const parts = [];
  let joined = false;
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    if (parts.length > 0 && (joined || tenthsOf(cp, 1) === 0)) parts[parts.length - 1] += ch;
    else parts.push(ch);
    joined = cp === JOINER;
  }
  return parts;
}

/** The string, or as much of its start as fits `room` px with an ellipsis, counted like `fold`. */
export function cut(str, room, letter) {
  if (span(str, letter) * letter <= room * 100) return str;
  const budget = room * 100 - span('…') * letter;
  let used = 0;
  let kept = '';
  for (const part of graphemes(str)) {
    used += span(part, letter) * letter;
    if (used > budget && kept) break;
    kept += part;
  }
  return `${kept.trimEnd()}…`;
}

export const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => graphemes(word)[0].toUpperCase()).join('') || '?';

/** Text in its own element. `dir` lets Arabic and Hebrew align and shorten from their own side. */
export const say = (tag, cls, str) => h(tag, { class: cls, dir: 'auto', text: str });

/** What a card writes under the rows it shows when it holds more. */
export const andMore = (count, item) => h('div', { class: 'card-foot', text: wordsOf(item).more(count) });

/**
 * Shares `room` px among columns that need `needs`. A column that needs no more than an equal
 * share of what is left takes what it needs, and the others share the rest equally.
 */
export function spread(needs, room) {
  const widths = needs.map(() => 0);
  let open = needs.map((_, i) => i);
  while (open.length > 0) {
    const each = Math.max(0, Math.floor(room / open.length));
    const whole = open.filter((i) => needs[i] <= each);
    for (const i of whole.length > 0 ? whole : open) {
      widths[i] = whole.length > 0 ? needs[i] : each;
      room -= widths[i];
    }
    open = whole.length > 0 ? open.filter((i) => !whole.includes(i)) : [];
  }
  return widths;
}

/** The item's title, or the word for one that is missing. */
export const titleOf = (item) => item.title || wordsOf(item).untitled;

export const title = (item, lines = 2) => say('div', `card-title clamp-${lines}`, titleOf(item));

/** A short label that names what a card is: a language, where a chat came from, a kind of group. */
export const kind = (label) => h('span', { class: /\p{Script=Han}/u.test(label) ? 'kind is-han' : 'kind', text: label });

/** A picture. When it fails to load, `missing()` is drawn in its place. `ctx.words` are the fixed words of the card it is on. */
export function picture(src, alt, ctx, missing = () => h('div', { class: 'media-missing', text: (ctx.words ?? wordsOf()).noPicture })) {
  const img = h('img', { src: ctx.asset(src), alt, loading: 'lazy', draggable: 'false' });
  img.addEventListener('error', () => img.replaceWith(missing()));
  return img;
}

/** A picture or poster at a fixed height, with its caption, when it has one, on a plate below. */
export const framed = (height, caption, lines, media) => [
  h('div', { class: 'media-frame', style: { height: `${height}px` } }, media),
  caption && h('div', { class: 'media-plate' }, say('div', `media-caption clamp-${lines}`, caption)),
];

/** The height `framed` takes: the picture and the border, and the plate's padding and caption. */
export const framedHeight = (height, lines) => height + 2 + (lines ? 19 + lines * TEXT : 0);

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumSignificantDigits: 3 });
const short = (value) => compact.format(value);

/** Round gridline values that cover min to max in about three steps. */
function gridValues(min, max) {
  if (max === min) max = min + 1;
  const rough = (max - min) / 3;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((size) => size >= rough);
  const first = Math.floor(min / step);
  const last = Math.ceil(max / step);
  return Array.from({ length: last - first + 1 }, (_, i) => Number(((first + i) * step).toPrecision(12)));
}

/** What a chart holds, as numbers and the label of each. A value that is not a number is left out. */
export function series(props) {
  const values = list(props.values).map(Number).filter(Number.isFinite);
  const given = list(props.labels);
  const labels = values.map((_, i) => (given[i] === undefined || given[i] === null ? '' : String(given[i])));
  const mark = Number.isInteger(props.mark) && props.mark >= 0 && props.mark < values.length ? props.mark : -1;
  return { values, labels, mark };
}

/**
 * A bar or line chart with gridlines and a scale. Labels and values are written level, in short
 * form, and only where they fit. Six points or fewer each keep their label, cut to the slot. With
 * more, when a slot is narrower than the labels, or than 44 px for long labels, every nth label is
 * written, the marked, first and last ones before the rest, and a label longer than its slots is
 * cut. On a card, values are written for six points or fewer. `whole` says every label and value
 * is on the plot in full.
 */
export function plot(props, width, height, { opened = false, words = wordsOf() } = {}) {
  const { values, labels, mark } = series(props);
  const n = values.length;
  const root = s('svg', { class: 'chart', viewBox: `0 0 ${width} ${height}`, width, height, role: 'img', 'aria-label': words.chart });
  if (n === 0) {
    root.append(s('text', { class: 'chart-empty', x: width / 2, y: height / 2 + 4, 'text-anchor': 'middle', text: words.noData }));
    return { el: root, whole: true };
  }
  const line = props.chart === 'line';
  const grid = gridValues(Math.min(...values, 0), Math.max(...values, 0));
  const lo = grid[0];
  const hi = grid.at(-1);
  const gridText = grid.map(short);

  const left = 10 + Math.max(...gridText.map(textWidth));
  const right = 4;
  const top = 20;
  const bottom = 22;
  const step = (width - left - right) / n;
  const y = (v) => top + (height - top - bottom) * (1 - (v - lo) / (hi - lo));
  const x = (i) => left + step * (i + 0.5);
  const is = (i) => (i === mark ? ' is-marked' : '');

  grid.forEach((v, i) => {
    root.append(
      s('line', { class: v === 0 ? 'chart-axis' : 'chart-grid', x1: left, x2: width - right, y1: y(v), y2: y(v) }),
      s('text', { class: 'chart-tick', x: left - 6, y: y(v) + 4, 'text-anchor': 'end', text: gridText[i] }),
    );
  });
  if (line && mark >= 0) root.append(s('line', { class: 'chart-guide', x1: x(mark), x2: x(mark), y1: y(values[mark]), y2: y(lo) }));
  if (line && n > 1) root.append(s('polyline', { class: 'chart-line', points: values.map((v, i) => `${x(i)},${y(v)}`).join(' ') }));
  values.forEach((v, i) => {
    if (line) {
      if (i === mark || n <= 16) root.append(s('circle', { class: `chart-dot${is(i)}`, cx: x(i), cy: y(v), r: i === mark ? 4.5 : 2.5 }));
    } else {
      const barWidth = clamp(step * 0.62, 3, 44);
      root.append(s('rect', { class: `chart-bar${is(i)}`, x: x(i) - barWidth / 2, y: Math.min(y(v), y(0)), width: barWidth, height: Math.max(2, Math.abs(y(v) - y(0))), rx: 2 }));
    }
  });

  /** Writes `str` centred on `at` and pulled inside `from` and `to`, unless it would touch a string already in `row`. */
  const write = (row, cls, str, at, from, to, baseline) => {
    const wide = textWidth(str);
    const ideal = at - wide / 2;
    const start = clamp(ideal, from, Math.max(from, to - wide));
    if (row.some(([a, b]) => start < b + 6 && a < start + wide + 6)) return false;
    row.push([start, start + wide]);
    const [anchor, ax] = start > ideal ? ['start', from] : start < ideal ? ['end', to] : ['middle', at];
    root.append(s('text', { class: cls, x: ax, y: baseline, 'text-anchor': anchor, text: str }));
    return true;
  };
  const markedFirst = [...new Set([mark, 0, n - 1, ...values.keys()])].filter((i) => i >= 0);

  /** On a line, a point lower than both its neighbours has the line above it, so its value goes below. */
  const dips = (i) => line && n > 1 && (values[i - 1] ?? Infinity) > values[i] && (values[i + 1] ?? Infinity) > values[i] && y(values[i]) + 22 <= height - bottom;
  const valueText = values.map(short);
  const allFit = Math.max(...valueText.map(textWidth)) <= step - 4;
  const valued = values.map((_, i) => i === mark || (allFit && (opened || n <= 6)));
  const valueRow = [];
  for (const i of markedFirst) {
    if (valued[i]) write(valueRow, `chart-value${is(i)}`, valueText[i], x(i), left, width, dips(i) ? y(values[i]) + 18 : Math.max(12, Math.min(y(values[i]), y(0)) - (line ? 9 : 6)));
  }

  const widest = Math.max(...labels.map(textWidth));
  const stride = n <= 6 ? 1 : Math.max(1, Math.ceil((Math.min(widest, 44) + 6) / step));
  const room = Math.floor(stride * step - 6);
  const labelRow = [];
  const written = new Set(markedFirst
    .filter((i) => labels[i] && (i % stride === 0 || i === mark || i === n - 1))
    .filter((i) => write(labelRow, `chart-label${is(i)}`, cut(labels[i], room, TEXT_LETTER), x(i), 0, width, height - 5)));

  const whole = values.every((v, i) => valued[i] && Number(v.toPrecision(3)) === v && (!labels[i] || (written.has(i) && span(labels[i]) * TEXT_LETTER <= room * 100)));
  return { el: root, whole };
}
