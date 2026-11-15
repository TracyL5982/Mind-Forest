import { h, s, clamp } from '../dom.js';
import { wordsOf } from '../words.js';

/**
 * Every small face is `WIDTH` px wide and at most `HEIGHT` px tall, the box the ring of cards round an opened card holds on the
 * headset, where one px is one mm at 1.5 m. A face is worked out from these and the line heights in style.css and never measured,
 * so they change together with `--lead-*` and `.card-body`.
 */
export const WIDTH = 210;
export const HEIGHT = 146;
export const TITLE = 24;
export const TEXT = 22;
/** A meta line: a label, a count, a source, a speaker. */
export const META = 18;
/** The last row of a face that leaves something out, which says what is left. */
export const CUE = 18;
/** Under a title. */
export const GAP = 6;
/** Top and bottom padding plus the border of a padded card, and 2 px to spare. */
export const FRAME = 30;
/** Left and right padding plus the border of a padded card, and 1 px to spare. */
export const SIDES = 33;
/** The text column of a padded face. */
export const COLUMN = WIDTH - SIDES;

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
/**
 * The faces a small face draws in, measured by scripts/advances.ts: the title at 18 px, body text at 16 px in medium, and a meta
 * line at 13.5 px in medium. Each is counted with its own widths. A meta line draws wider for its size than the title face does,
 * so neither is counted in the other. Body text is one more than the title face's letter only so that each face has its own.
 */
export const TITLE_FACE = 104;
export const BODY_FACE = 94;
export const META_FACE = 80;

/** A letter width names its face. Any letter but these is one of a figure's sizes. */
const FACES = [[TITLE_LETTER, TITLE_FACE, BODY_FACE, META_FACE], [TEXT_LETTER], [QUOTE_LETTER, PASSAGE_LETTER]];
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
export const FIGURES = [['', 36, 210, 2148], ['is-mid', 28, 149, 1506], ['is-small', 24, 119, 1127]];
const DIGIT = 11;
/** The smallest size is the title's, 18 px. Its widths are those measured at 16 px, scaled by 18 / 16 and rounded up. */
const toSmall = (hundredths) => Math.ceil((hundredths * 18) / 16);

/** A figure's width on one line in hundredths of a px, at one of `FIGURES`. */
export const figureNeed = (value, [, , letter, digit]) => span(value, letter) * letter - (value.match(/[0-9]/g)?.length ?? 0) * (DIGIT * letter - digit);

/** The px a string is given at the text size. Most strings draw a little narrower. */
export const textWidth = (str) => up(span(str) * TEXT_LETTER, 100);

/** The px a string is given on one meta line, counted as `MEASURES.meta` counts it. */
export const metaWidth = (str) => up(advance(str, META_FACE), 100);

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
  [FIGURES[2][2], [358, 497, 825, 1002, 1002, 1567, 1121, 482, 613, 613, 711, 1002, 482, 711, 482, 467, 1002, 1002, 1002, 1002, 1002, 1002, 1002, 1002, 1002, 1002, 482, 482, 1002, 1002, 1002, 819, 1420, 1095, 1039, 1118, 1129, 927, 888, 1152, 1181, 435, 885, 1060, 884, 1381, 1161, 1193, 1006, 1193, 1039, 1010, 988, 1149, 1081, 1543, 1093, 1058, 1017, 613, 467, 613, 1002, 931, 739, 873, 971, 872, 971, 892, 580, 962, 939, 388, 388, 886, 400, 1414, 931, 923, 965, 965, 621, 834, 586, 931, 861, 1275, 853, 881, 838, 613, 407, 613, 1002].map(toSmall)],
  [TITLE_FACE, [419, 566, 922, 1135, 1136, 1749, 1271, 546, 694, 694, 811, 1136, 543, 811, 543, 535, 1153, 846, 1085, 1130, 1163, 1119, 1155, 1018, 1169, 1155, 543, 543, 1136, 1136, 1136, 930, 1611, 1236, 1175, 1269, 1282, 1052, 1008, 1308, 1336, 494, 999, 1197, 1003, 1563, 1316, 1355, 1139, 1355, 1175, 1143, 1121, 1303, 1221, 1743, 1235, 1196, 1155, 694, 535, 694, 1136, 1053, 849, 989, 1100, 989, 1099, 1013, 657, 1089, 1063, 444, 443, 999, 455, 1593, 1053, 1047, 1093, 1093, 700, 944, 664, 1053, 974, 1435, 963, 994, 950, 694, 464, 694, 1136]],
  [BODY_FACE, [410, 494, 785, 1002, 1002, 1511, 1128, 475, 608, 608, 735, 1002, 475, 735, 475, 475, 1010, 741, 960, 999, 1025, 986, 1016, 902, 1024, 1016, 475, 475, 1002, 1002, 1002, 816, 1446, 1082, 1044, 1132, 1146, 939, 902, 1174, 1182, 428, 868, 1053, 896, 1388, 1174, 1214, 1010, 1214, 1039, 1013, 1000, 1164, 1075, 1543, 1086, 1049, 1039, 608, 475, 608, 1002, 930, 772, 875, 975, 883, 975, 902, 577, 968, 938, 389, 389, 872, 400, 1397, 930, 933, 969, 968, 611, 833, 580, 930, 861, 1250, 841, 871, 850, 608, 408, 608, 1002]],
  [META_FACE, [363, 433, 678, 861, 861, 1291, 969, 418, 530, 530, 636, 861, 418, 636, 418, 418, 868, 641, 825, 858, 882, 847, 874, 777, 880, 874, 418, 418, 861, 861, 861, 705, 1236, 928, 897, 971, 983, 810, 777, 1007, 1013, 377, 747, 905, 772, 1188, 1007, 1041, 868, 1041, 894, 871, 861, 999, 924, 1318, 932, 902, 893, 530, 418, 530, 861, 800, 668, 755, 839, 761, 839, 777, 502, 832, 807, 344, 344, 752, 353, 1196, 800, 803, 833, 833, 532, 719, 507, 800, 743, 1072, 725, 750, 733, 530, 361, 530, 861]],
]);
/** How wide a character set with Han draws in each of those faces, in hundredths of a px: the size the face is set in, less its letter spacing. */
const EM = new Map([[TITLE_FACE, 1790], [BODY_FACE, 1600], [META_FACE, 1350], [TITLE_LETTER, 1591], [TEXT_LETTER, 1250], [PASSAGE_LETTER, 1600], [FIGURES[0][2], 3332], [FIGURES[1][2], 2352], [FIGURES[2][2], toSmall(1568)]]);
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
 * Where each line of a string ends, as an index into it, in a column `width` px wide. The words are laid out one by one, each as
 * wide as `advance` counts it. A line may end at white space and where `parts` says a word parts, and nowhere else, which is at
 * most where a page breaks. A word wider than a line starts a line of its own and is broken wherever a line ends.
 */
function ends(str, width, letter) {
  const room = width * 100;
  const space = advance(' ', letter);
  const lines = [];
  let used = 0;
  let at = 0;
  const place = (wide, gap, end) => {
    if (used > 0 && used + gap + wide > room) {
      lines.push(at);
      used = 0;
    }
    used += (used > 0 ? gap : 0) + wide;
    at = end;
  };
  for (const { 0: word, index } of str.matchAll(/\S+/gu)) {
    let gap = space;
    let unit = '';
    let end = index;
    const chars = [...word];
    chars.forEach((ch, i) => {
      unit += ch;
      end += ch.length;
      const next = chars[i + 1];
      if (next !== undefined && !parts(chars, i)) return;
      const wide = advance(unit, letter);
      if (wide <= room) place(wide, gap, end);
      else {
        let from = end - unit.length;
        [...unit].forEach((part, k) => place(advance(part, letter), k === 0 ? room : 0, (from += part.length)));
      }
      gap = 0;
      unit = '';
    });
  }
  lines.push(at);
  return lines;
}

/** How many lines a string takes in a column `width` px wide, as `ends` lays it out, from 1 to `max`. */
export const wrap = (str, width, letter, max) => clamp(ends(str, width, letter).length, 1, max);

/**
 * How each kind of line on a small face is counted, in the widths of the face it is drawn in, and how tall its line is. A heading
 * over a structure is the title's semibold at the body size, which is the 16 px title face. A passage, a quotation and a meaning
 * are the upright serif. A figure's three sizes are 34, 24 and 18 px.
 */
export const MEASURES = {
  title: { letter: TITLE_FACE, lead: TITLE },
  head: { letter: TITLE_LETTER, lead: TEXT },
  body: { letter: BODY_FACE, lead: TEXT },
  meta: { letter: META_FACE, lead: META },
  passage: { letter: PASSAGE_LETTER, lead: TEXT },
  display: { letter: FIGURES[0][2], lead: FIGURES[0][1] },
  middle: { letter: FIGURES[1][2], lead: FIGURES[1][1] },
  figure: { letter: FIGURES[2][2], lead: FIGURES[2][1] },
};
const counted = (column, measure) => [column, MEASURES[measure].letter];

/** The lines a string takes on a face in a column `column` px wide, counted as `measure` counts it. */
export const linesOf = (str, column, measure) => ends(str, ...counted(column, measure)).length;

/** What a cut leaves at its end that only joins it to what was cut. */
const JOINING = /[\s,;:，；：、–—-]+$/u;

/**
 * The start of a string that stands on `most` lines with an ellipsis after it: cut where a word ends, at a hyphen that joins two
 * words, or after any character of a script written without spaces, and without the marks that only joined it to the rest. A word longer than the lines is cut
 * between the characters a reader sees.
 */
function shortened(str, width, letter, most) {
  const fits = (words) => ends(`${words}…`, width, letter).length <= most;
  const cuts = [...str.matchAll(/\S(?=\s)|[A-Za-z](?=-[A-Za-z])|[\u3041-\u3096\u30a1-\u30fa\u30fc\u3400-\u9fff\uac00-\ud7af]|[\u3001\u3002\uff0c\uff1b\uff1a\uff1f\uff01\uff09\u300b]/gu)]
    .map((m) => str.slice(0, m.index + m[0].length).replace(JOINING, '')).filter(Boolean).reverse();
  let kept = cuts.find(fits);
  if (kept === undefined) {
    kept = '';
    for (const part of graphemes(str)) {
      if (!fits(kept + part)) break;
      kept += part;
    }
  }
  return `${kept}…`;
}

/**
 * The most of a string that stands on `most` whole lines of a column: all of it when it fits, else its first words, to where its
 * last whole line ends. `whole` says nothing was left out. A face draws exactly these words, so it never cuts a line, clamps one
 * or ends one with an ellipsis. A title is the one exception: `ellipsis` cuts one that needs more than `most` lines at a whole
 * word and ends it with an ellipsis, which says what is left out, so it counts as whole and brings no cue.
 */
export function fit(str, column, measure, most = Infinity, ellipsis = false) {
  if (!str) return { words: '', lines: 0, whole: true };
  const [width, letter] = counted(column, measure);
  const lines = ends(str, width, letter);
  if (lines.length <= most) return { words: str, lines: lines.length, whole: true };
  if (ellipsis && most > 0) {
    const words = shortened(str, width, letter, most);
    return { words, lines: ends(words, width, letter).length, whole: true };
  }
  return { words: most > 0 ? str.slice(0, lines[most - 1]).trimEnd() : '', lines: Math.max(0, most), whole: false };
}

/**
 * A small face, laid out from its rows top to bottom. A row of `words` stands on whole lines, as many as it needs up to `most`;
 * any other row is `tall` px and whole. Each takes `gap` px above it. A row the face has no room for is left out, and every row
 * after it, so what shows is always the start of the card; a row of words that does not fit whole shows the whole lines that do,
 * unless it is a `unit`, one of what the cue counts, such as a list's entry, which is whole or left out. A `keep` row is shown
 * whatever is left out above it, as a quote's speaker is.
 *
 * When anything is left out, the last row is the cue, `CUE` px: `cue(units)` says what is left, given the units left out, or
 * "More" when it gives nothing, as when words were cut. `more` says the item holds something no row shows. The face is `HEIGHT`
 * px at most, and a row's `draw(row)` is handed the row with the `words` and `lines` it shows. A row of words that draws a box
 * round them, as a chat's bubble does, adds the box's `pad` px to its lines. `frame` is the px of padding and border above and
 * below the rows.
 */
export function lay(rows, { words: said = wordsOf(), cue = () => '', more = false, frame = FRAME } = {}) {
  const lead = (row) => MEASURES[row.measure ?? 'body'].lead;
  const shownIn = (row, most) => {
    const shown = fit(row.words, row.column ?? COLUMN, row.measure ?? 'body', most, row.ellipsis);
    return { ...row, ...shown, height: shown.lines * lead(row) + (row.pad ?? 0) };
  };
  const sized = rows.filter(Boolean).map((row) => (row.words === undefined ? { ...row, gap: row.gap ?? 0, height: row.tall } : shownIn({ ...row, gap: row.gap ?? 0 }, row.most)));
  const need = sized.reduce((sum, row) => sum + row.gap + row.height, frame);
  if (!more && need <= HEIGHT && sized.every((row) => row.whole !== false)) return { rows: sized, height: need, cue: '' };

  let room = HEIGHT - frame - CUE - sized.filter((row) => row.keep).reduce((sum, row) => sum + row.gap + row.height, 0);
  const shown = [];
  let units = 0;
  let stopped = false;
  for (const row of sized) {
    if (row.keep) {
      shown.push(row);
      continue;
    }
    if (stopped || row.gap + row.height > room) {
      const lines = Math.floor((room - row.gap - (row.pad ?? 0)) / lead(row));
      if (!stopped && row.words !== undefined && !row.unit && lines > 0) shown.push(shownIn(row, lines));
      stopped = true;
      if (row.unit) units += 1;
      continue;
    }
    shown.push(row);
    room -= row.gap + row.height;
  }
  const height = shown.reduce((sum, row) => sum + row.gap + row.height, frame) + CUE;
  return { rows: shown, height, cue: cue(units) || said.cue.more };
}

/** A face as `lay` sets it out: each row at its own height with its gap above it, and the cue last. */
export const drawFace = ({ rows, cue }) => [
  rows.map((row) => h('div', { class: 'face-row', style: { marginTop: `${row.gap}px`, height: `${row.height}px` } }, row.draw(row))),
  cue && h('div', { class: 'face-cue', text: cue }),
];

/** A row of words drawn as they are shown, in an element of `cls`. */
export const wordsIn = (cls) => (row) => say('div', cls, row.words);

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

/** A line set in bold as the item writes it, with `**` or `__`, which the card draws bold without them. */
const STRONG = /^(\*\*|__)([^*_]+)\1([:：]?)$/u;
/** A line that heads what is under it: one that ends with a colon, or with a letter or a digit and no stop. */
const HEADING = /[:：\p{L}\p{N}]$/u;

/** The lines over a card's structure, each with whether it heads what is under it. */
function overOf(props) {
  return list(props.above).map((line) => text(line).trim()).filter(Boolean).map((line) => {
    const strong = STRONG.exec(line);
    const words = strong ? `${strong[2]}${strong[3]}` : line;
    return { words, head: strong !== null || HEADING.test(words) };
  });
}

/**
 * The item's own headings, labels and opening prose that a structured card draws over its structure, as rows of its face: each
 * line on lines of its own, in the body face and the full colour of the structure, a heading or a label in the title's weight.
 * They come first, so the face shows them before any of the structure they head, and none is left out to make room for it.
 * `gap` is the px above the first.
 */
export const aboveRows = (props, { column = COLUMN, gap = GAP } = {}) => overOf(props).map((line, i) => ({
  words: line.words, measure: line.head ? 'head' : 'body', column, gap: i === 0 ? gap : 0,
  draw: wordsIn(line.head ? 'face-above is-head' : 'face-above'),
}));

/** The most lines each head of a heads row is given. */
const HEAD_LINES = 2;

/**
 * The heads row of the two columns a card's figures or bars come from, `props.heads`, as a row of its face: each head in meta in
 * half the column less 17 px between them, the first at the start and the second at the end, over 4 px and a hairline. None when
 * the view has no heads.
 */
export function headsRow(props, { column = COLUMN, gap = GAP } = {}) {
  const heads = list(props.heads).map((head) => text(head).trim());
  if (heads.length !== 2 || heads.every((head) => !head)) return null;
  const shown = heads.map((head) => fit(head, Math.floor((column - 17) / 2), 'meta', HEAD_LINES));
  return {
    tall: Math.max(...shown.map((head) => head.lines)) * META + 5, gap, whole: shown.every((head) => head.whole),
    draw: () => h('div', { class: 'face-heads' }, shown.map((head) => say('div', '', head.words))),
  };
}

/** The item's title, or the word for one that is missing. */
export const titleOf = (item) => item.title || wordsOf(item).untitled;

/** The most lines a title, or a name that stands for it, takes on a small face. */
export const TITLE_LINES = 2;

/**
 * The title a small face shows: `item.data.shortTitle`, the start of a source's own title the service gives it, else the title. The
 * opened card shows the whole title.
 */
export const faceTitleOf = (item) => text(item.data?.shortTitle).trim() || titleOf(item);

/** The title as a row of a face: whole on up to two lines, else its first two cut at a whole word and ended with an ellipsis. */
export const titleRow = (item, { column = COLUMN, gap = 0 } = {}) => ({ words: faceTitleOf(item), measure: 'title', column, most: TITLE_LINES, ellipsis: true, gap, draw: wordsIn('card-title') });

/** A short label that names what a card is: a language, where a chat came from, a kind of group. */
export const kind = (label) => h('span', { class: /\p{Script=Han}/u.test(label) ? 'kind is-han' : 'kind', text: label });

/** A picture. When it fails to load, `missing()` is drawn in its place. `ctx.words` are the fixed words of the card it is on. */
export function picture(src, alt, ctx, missing = () => h('div', { class: 'media-missing', text: (ctx.words ?? wordsOf()).noPicture })) {
  const img = h('img', { src: ctx.asset(src), alt, loading: 'lazy', draggable: 'false' });
  img.addEventListener('error', () => img.replaceWith(missing()));
  return img;
}

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
