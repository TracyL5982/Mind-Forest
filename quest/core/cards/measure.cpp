// A port of the sizing half of agents/client/js/components/shared.js. Keep the two in step: every
// table and rule here is that file's, and test/footprints.cpp checks the result against the web's
// own footprints.
#include "measure.h"

#include <algorithm>
#include <array>
#include <map>

namespace cards {

Text points(const std::string& s) {
    Text out;
    out.reserve(s.size());
    size_t i = 0, n = s.size();
    while (i < n) {
        unsigned char c = (unsigned char)s[i];
        char32_t cp = 0xFFFD;
        int more = c < 0x80 ? 0 : (c >> 5) == 6 ? 1 : (c >> 4) == 14 ? 2 : (c >> 3) == 30 ? 3 : -1;
        if (more == 0) {
            cp = c;
        } else if (more > 0 && i + size_t(more) < n) {
            cp = c & (0x3F >> more);
            bool ok = true;
            for (int k = 1; k <= more; k++) {
                unsigned char d = (unsigned char)s[i + size_t(k)];
                if ((d >> 6) != 2) {
                    ok = false;
                    break;
                }
                cp = (cp << 6) | (d & 0x3F);
            }
            if (!ok) {
                cp = 0xFFFD;
                more = 0;
            }
        } else {
            more = 0;
        }
        out.push_back(cp);
        i += size_t(more) + 1;
    }
    return out;
}

std::string utf8(const Text& text) {
    std::string out;
    out.reserve(text.size());
    for (char32_t c : text) {
        if (c < 0x80) {
            out += char(c);
        } else if (c < 0x800) {
            out += char(0xC0 | (c >> 6));
            out += char(0x80 | (c & 0x3F));
        } else if (c < 0x10000) {
            out += char(0xE0 | (c >> 12));
            out += char(0x80 | ((c >> 6) & 0x3F));
            out += char(0x80 | (c & 0x3F));
        } else {
            out += char(0xF0 | (c >> 18));
            out += char(0x80 | ((c >> 12) & 0x3F));
            out += char(0x80 | ((c >> 6) & 0x3F));
            out += char(0x80 | (c & 0x3F));
        }
    }
    return out;
}

namespace {

using Tenths = std::array<int, 4>;
struct Row {
    char32_t first, last;
    Tenths tenths;
};
constexpr Tenths all(int t) { return {t, t, t, t}; }
constexpr Tenths THIN{6, 6, 7, 6};
constexpr Tenths SMALL{12, 11, 13, 10};
constexpr Tenths SIGN{13, 12, 19, 11};
constexpr Tenths CAPITAL{16, 15, 17, 14};
constexpr Tenths WIDE{19, 20, 21, 18};
constexpr Tenths ARROW{20, 21, 24, 19};
constexpr Tenths EMOJI{22, 23, 26, 21};
constexpr Tenths WIDEST{28, 28, 34, 27};
constexpr Tenths KANA{18, 18, 21, 16};
constexpr Tenths HAN{17, 18, 21, 16};
constexpr Tenths HANGUL{15, 15, 21, 14};
constexpr Tenths CJK{18, 18, 21, 17};
constexpr Tenths LIGATURE{62, 56, 134, 58};
constexpr Tenths OTHER{46, 47, 55, 43};

/// shared.js's WIDTHS, in its order: the first row that holds a code point wins.
const std::vector<Row>& widths() {
    static const std::vector<Row> rows = [] {
        std::vector<Row> r;
        auto add = [&](Tenths t, std::initializer_list<std::pair<char32_t, char32_t>> ranges) {
            for (auto [a, b] : ranges) r.push_back({a, b, t});
        };
        add(all(0), {{0x0300, 0x036f}, {0x0483, 0x0489}, {0x0591, 0x05bd}, {0x064b, 0x065f}, {0x0670, 0x0670}, {0x0900, 0x0902},
                     {0x0941, 0x0948}, {0x094d, 0x094d}, {0x0e31, 0x0e31}, {0x0e34, 0x0e3a}, {0x0e47, 0x0e4d}});
        add(all(0), {{0x200b, 0x200f}, {0x202a, 0x202e}, {0x2060, 0x206f}, {0xfe00, 0xfe0f}, {0x1f3fb, 0x1f3ff}, {0xe0000, 0xe007f}});
        add(all(5), {{0x09, 0x0d}, {0x20, 0x21}, {0x27, 0x27}, {0x2c, 0x2c}, {0x2e, 0x2f}, {0x3a, 0x3b}, {0x5c, 0x5c}, {0x69, 0x6a},
                     {0x6c, 0x6c}, {0x7c, 0x7c}, {0xa0, 0xa0}, {0x2028, 0x2029}, {0x202f, 0x202f}, {0x205f, 0x205f}});
        add(all(7), {{0x28, 0x29}, {0x2d, 0x2d}, {0x5b, 0x5b}, {0x5d, 0x5d}, {0x7b, 0x7b}, {0x7d, 0x7d}, {0x66, 0x66}, {0x72, 0x72},
                     {0x74, 0x74}});
        add(all(11), {{0x30, 0x39}, {0x23, 0x24}, {0x2b, 0x2b}, {0x3c, 0x3e}, {0x5e, 0x5e}, {0x7e, 0x7e}});
        add(all(15), {{0x25, 0x25}, {0x40, 0x40}, {0x4d, 0x4d}, {0x6d, 0x6d}, {0x77, 0x77}});
        add(all(17), {{0x57, 0x57}});
        add(all(12), {{0x26, 0x26}, {0x41, 0x5a}});
        add(all(10), {{0x20, 0x7e}});
        add(THIN, {{0xb7, 0xb7}, {0x2004, 0x2006}, {0x2008, 0x200a}, {0x2018, 0x201b}, {0x2024, 0x2024}, {0x2027, 0x2027},
                   {0x2032, 0x2032}, {0x2035, 0x2035}, {0x2044, 0x2044}});
        add(SMALL, {{0xa1, 0xa1}, {0xa8, 0xa8}, {0xaa, 0xaa}, {0xad, 0xad}, {0xaf, 0xb0}, {0xb2, 0xb4}, {0xb8, 0xba}, {0xbf, 0xbf},
                    {0xdf, 0xe5}, {0xe7, 0xf6}, {0xf8, 0xff}});
        add(SMALL, {{0x2000, 0x2000}, {0x2002, 0x2002}, {0x2010, 0x2011}, {0x2016, 0x2016}, {0x201c, 0x201f}, {0x2020, 0x2023},
                    {0x2033, 0x2033}, {0x2039, 0x203a}, {0x2070, 0x209f}, {0xff61, 0xffdc}});
        add(SIGN, {{0xa2, 0xa7}, {0xab, 0xac}, {0xae, 0xae}, {0xb1, 0xb1}, {0xb5, 0xb6}, {0xbb, 0xbb}, {0xd7, 0xd7}, {0xf7, 0xf7},
                   {0x2007, 0x2007}, {0x2012, 0x2013}});
        add(SIGN, {{0x20a0, 0x20a7}, {0x20ab, 0x20ae}, {0x20b1, 0x20b6}, {0x20b8, 0x20ba}, {0x20bc, 0x20bd}, {0x20bf, 0x20bf},
                   {0x2212, 0x2212}, {0x221a, 0x221a}, {0x2248, 0x2248}, {0x2260, 0x2260}, {0x2264, 0x2265}});
        add(CAPITAL, {{0xc0, 0xc5}, {0xc7, 0xd6}, {0xd8, 0xde}, {0x0100, 0x0151}, {0x0154, 0x0173}, {0x0175, 0x017f}, {0x01cd, 0x01dc},
                      {0x03ac, 0x03ce}, {0x0430, 0x045f}});
        add(WIDE, {{0xa9, 0xa9}, {0xbc, 0xbe}, {0xc6, 0xc6}, {0xe6, 0xe6}, {0x0152, 0x0153}, {0x0174, 0x0174}, {0x0370, 0x03ab},
                   {0x0410, 0x042f}, {0x0530, 0x058f}, {0x05be, 0x05ff}, {0x0900, 0x097f}, {0x1e00, 0x1eff}});
        add(WIDE, {{0x2001, 0x2001}, {0x2003, 0x2003}, {0x2014, 0x2015}, {0x2025, 0x2026}, {0x20a9, 0x20aa}, {0x2122, 0x2122},
                   {0x2126, 0x2126}});
        add(ARROW, {{0x03cf, 0x03ff}, {0x2190, 0x22ff}});
        add(EMOJI, {{0x0600, 0x06ff}, {0x0e00, 0x0e5a}, {0x2300, 0x27bf}, {0xf900, 0xfaff}, {0x1f000, 0x1f6ff}, {0x1f900, 0x1faff}});
        add(WIDEST, {{0x0180, 0x02ff}, {0x0400, 0x052f}, {0x0700, 0x077f}, {0x0e5b, 0x0e7f}, {0x10a0, 0x10ff}, {0x1f00, 0x1fff},
                     {0x2030, 0x205e}, {0x20a0, 0x218f}, {0x27c0, 0x2bff}});
        add(WIDEST, {{0x302e, 0x302f}, {0xfb00, 0xfb4f}, {0xfe70, 0xfeff}});
        add(KANA, {{0x3040, 0x30ff}});
        add(HAN, {{0x3400, 0x9fff}});
        add(HANGUL, {{0xac00, 0xd7af}});
        add(CJK, {{0x2e80, 0x33ff}, {0xfe10, 0xfe6f}, {0xff00, 0xff60}, {0xffe0, 0xffef}});
        add(LIGATURE, {{0xfb50, 0xfdff}});
        return r;
    }();
    return rows;
}

/// Below 0x3400 each face's count of every code point is laid out, so a lookup there is one read.
constexpr char32_t LOW = 0x3400;
const std::array<std::array<uint8_t, LOW>, 4>& low() {
    static const auto table = [] {
        std::array<std::array<uint8_t, LOW>, 4> t{};
        for (int face = 0; face < 4; face++) t[size_t(face)].fill(uint8_t(OTHER[size_t(face)]));
        const std::vector<Row>& rows = widths();
        for (auto it = rows.rbegin(); it != rows.rend(); ++it) {
            for (char32_t cp = it->first; cp <= std::min<char32_t>(it->last, LOW - 1); cp++) {
                for (int face = 0; face < 4; face++) t[size_t(face)][cp] = uint8_t(it->tenths[size_t(face)]);
            }
        }
        return t;
    }();
    return table;
}

int tenthsOf(char32_t cp, int face) {
    if (cp < LOW) return low()[size_t(face)][cp];
    for (const Row& row : widths()) {
        if (cp >= row.first && cp <= row.last) return row.tenths[size_t(face)];
    }
    return OTHER[size_t(face)];
}

constexpr char32_t JOINER = 0x200d;
constexpr char32_t EMOJI_FORM = 0xfe0f;

/// A letter names its face: the title, the text, the quote's serif (and the passage), else a figure.
int faceOf(int letter) {
    switch (letter) {
    case TITLE_LETTER: return 0;
    case TEXT_LETTER: return 1;
    case QUOTE_LETTER:
    case PASSAGE_LETTER: return 2;
    default: return 3;
    }
}

bool anywhere(char32_t c) {
    return (c >= 0x3041 && c <= 0x3096) || (c >= 0x30a1 && c <= 0x30fa) || c == 0x30fc || (c >= 0x3400 && c <= 0x9fff) ||
           (c >= 0xac00 && c <= 0xd7af);
}
bool closer(char32_t c) {
    return c == 0x3001 || c == 0x3002 || c == 0xff0c || c == 0xff1b || c == 0xff1a || c == 0xff1f || c == 0xff01 || c == 0xff09 ||
           c == 0x300b;
}
bool opener(char32_t c) { return c == 0xff08 || c == 0x300a; }
bool latin(char32_t c) { return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z'); }
bool word(char32_t c) { return latin(c) || (c >= '0' && c <= '9'); }

/// Whether a line may end after `chars[i]`, inside a word. (`next` is always there when this is asked.)
bool parts(const Text& chars, size_t i) {
    char32_t before = i > 0 ? chars[i - 1] : 0, ch = chars[i], next = chars[i + 1];
    return ((anywhere(ch) || closer(ch)) && (anywhere(next) || opener(next))) || (anywhere(ch) && word(next)) ||
           (word(ch) && anywhere(next)) || (ch == '-' && latin(before) && latin(next));
}

bool breaksAnywhere(const Text& str) {
    return !str.empty() && std::all_of(str.begin(), str.end(), anywhere);
}

int64_t packed(const Text& str, int64_t room, int letter) {
    int64_t lines = 1, used = 0;
    for (char32_t ch : str) {
        int64_t wide = span(Text(1, ch), letter) * letter;
        if (used > 0 && used + wide > room) {
            lines += 1;
            used = 0;
        }
        used += wide;
    }
    return lines;
}

/// Each character from U+0020 to U+007E, hundredths of a px, in the faces `wrap` counts in.
const std::map<int, std::array<int, 95>>& advances() {
    static const std::map<int, std::array<int, 95>> table{
        {TITLE_LETTER, {384, 512, 833, 1018, 1018, 1572, 1139, 496, 627, 627, 731, 1018, 496, 731, 496, 484, 1034, 760, 973, 1014, 1042, 1004, 1035, 914, 1048, 1035, 496, 496, 1018, 1018, 1018, 834, 1441, 1109, 1055, 1137, 1148, 945, 907, 1173, 1198, 449, 897, 1075, 901, 1398, 1180, 1213, 1023, 1213, 1055, 1026, 1007, 1168, 1095, 1559, 1107, 1072, 1037, 627, 484, 627, 1018, 947, 762, 889, 988, 890, 988, 910, 594, 979, 955, 404, 404, 899, 416, 1426, 947, 941, 981, 981, 634, 850, 601, 947, 876, 1286, 866, 894, 856, 627, 423, 627, 1018}},
        {TEXT_LETTER, {350, 388, 596, 786, 786, 1155, 888, 370, 476, 476, 588, 786, 370, 588, 370, 380, 786, 579, 753, 782, 803, 771, 795, 710, 797, 795, 370, 370, 786, 786, 786, 640, 1146, 841, 820, 894, 907, 743, 714, 932, 927, 333, 671, 822, 709, 1091, 927, 963, 793, 963, 815, 795, 791, 920, 841, 1209, 847, 818, 826, 476, 380, 476, 786, 728, 624, 688, 767, 698, 767, 713, 451, 760, 734, 308, 307, 677, 315, 1086, 728, 737, 762, 760, 475, 653, 453, 728, 676, 967, 654, 677, 673, 476, 322, 476, 786}},
        {PASSAGE_LETTER, {447, 542, 532, 892, 892, 1410, 1332, 274, 673, 673, 729, 1335, 447, 563, 447, 740, 892, 892, 892, 892, 892, 892, 892, 892, 892, 892, 447, 447, 1335, 1335, 1335, 755, 1602, 1158, 998, 1134, 1252, 1017, 938, 1190, 1273, 546, 534, 1111, 917, 1459, 1295, 1285, 945, 1285, 1127, 868, 1012, 1262, 1149, 1662, 1140, 1057, 1070, 673, 740, 673, 1602, 802, 802, 772, 892, 717, 902, 783, 501, 828, 940, 477, 441, 876, 470, 1410, 937, 884, 899, 895, 627, 711, 578, 943, 788, 1242, 850, 780, 758, 673, 802, 673, 1335}},
        {LARGEST.letter, {649, 1021, 1493, 2125, 2150, 2953, 2341, 883, 1239, 1239, 1473, 2150, 777, 1466, 777, 990, 2150, 2150, 2150, 2150, 2150, 2150, 2150, 2150, 2150, 2150, 777, 777, 2150, 2150, 2150, 1763, 2983, 2294, 2128, 2381, 2341, 1909, 1826, 2434, 2437, 850, 1835, 2165, 1810, 2884, 2394, 2520, 2050, 2519, 2127, 2099, 2007, 2372, 2253, 3232, 2274, 2205, 2110, 1239, 990, 1239, 2150, 1904, 1674, 1808, 1977, 1801, 1974, 1836, 1154, 1964, 1934, 772, 770, 1773, 775, 2875, 1904, 1898, 1966, 1964, 1179, 1695, 1151, 1904, 1743, 2618, 1733, 1776, 1670, 1239, 780, 1239, 2150}},
        {MIDDLE.letter, {467, 719, 1081, 1494, 1508, 2126, 1651, 634, 876, 876, 1038, 1508, 573, 1034, 573, 692, 1508, 1508, 1508, 1508, 1508, 1508, 1508, 1508, 1508, 1508, 573, 573, 1508, 1508, 1508, 1235, 2104, 1617, 1506, 1672, 1654, 1349, 1290, 1712, 1723, 604, 1294, 1533, 1279, 2036, 1692, 1774, 1452, 1774, 1505, 1480, 1422, 1677, 1589, 2281, 1606, 1555, 1490, 876, 692, 876, 1508, 1347, 1162, 1275, 1401, 1270, 1398, 1297, 818, 1390, 1367, 545, 544, 1259, 550, 2039, 1347, 1341, 1391, 1390, 844, 1200, 818, 1347, 1235, 1853, 1227, 1259, 1186, 876, 556, 876, 1508}},
        {SMALLEST.letter, {403, 560, 929, 1128, 1128, 1763, 1262, 543, 690, 690, 800, 1128, 543, 800, 543, 526, 1128, 1128, 1128, 1128, 1128, 1128, 1128, 1128, 1128, 1128, 543, 543, 1128, 1128, 1128, 922, 1598, 1232, 1169, 1258, 1271, 1043, 999, 1296, 1329, 490, 996, 1193, 995, 1554, 1307, 1343, 1132, 1343, 1169, 1137, 1112, 1293, 1217, 1736, 1230, 1191, 1145, 690, 526, 690, 1128, 1048, 832, 983, 1093, 981, 1093, 1004, 653, 1083, 1057, 437, 437, 997, 450, 1591, 1048, 1039, 1086, 1086, 699, 939, 660, 1048, 969, 1435, 960, 992, 943, 690, 458, 690, 1128}},
    };
    return table;
}

/// How wide a character set with Han draws in each `advances` face, hundredths of a px.
int em(int letter) {
    switch (letter) {
    case TITLE_LETTER: return 1591;
    case TEXT_LETTER: return 1250;
    case PASSAGE_LETTER: return 1600;
    case LARGEST.letter: return 3332;
    case MIDDLE.letter: return 2352;
    case SMALLEST.letter: return 1764;
    default: return 0;
    }
}

bool square(char32_t c) {
    return (c >= 0x3000 && c <= 0x30ff) || (c >= 0x3400 && c <= 0x9fff) || (c >= 0xff01 && c <= 0xff60) || (c >= 0xffe0 && c <= 0xffe6);
}

}  // namespace

int64_t span(const Text& str, int letter) {
    int face = faceOf(letter);
    int64_t tenths = 0;
    bool joined = false;
    int last = 0;
    for (char32_t cp : str) {
        int add = joined ? 0 : cp == EMOJI_FORM ? std::max(0, EMOJI[size_t(face)] - last) : tenthsOf(cp, face);
        tenths += add;
        if (add > 0) last = add;
        joined = cp == JOINER;
    }
    return tenths;
}

int64_t up(int64_t a, int64_t b) {
    int64_t n = a + b - 1;
    return n >= 0 ? n / b : -((-n + b - 1) / b);
}

int64_t clamp(int64_t v, int64_t lo, int64_t hi) { return std::max(lo, std::min(hi, v)); }

int fold(const Text& str, int width, int letter, int max) {
    int64_t need = span(str, letter) * letter;
    int64_t room = int64_t(width) * 100;
    if (need <= room) return 1;
    return int(clamp(breaksAnywhere(str) ? packed(str, room, letter) : up(need, room - 20 * letter), 1, max));
}

int64_t advance(const Text& str, int letter) {
    auto found = advances().find(letter);
    if (found == advances().end()) return span(str, letter) * letter;
    const std::array<int, 95>& table = found->second;
    int64_t wide = 0;
    Text others;
    for (char32_t cp : str) {
        if (cp >= 0x20 && cp <= 0x7e) wide += table[cp - 0x20];
        else if (square(cp)) wide += em(letter);
        else others += cp;
    }
    return wide + span(others, letter) * letter;
}

int wrap(const Text& str, int width, int letter, int max) {
    int64_t room = int64_t(width) * 100;
    int64_t space = cards::advance(U" ", letter);
    int64_t lines = 1, used = 0;
    auto place = [&](int64_t wide, int64_t gap) {
        if (used > 0 && used + gap + wide > room) {
            lines += 1;
            used = 0;
        }
        used += (used > 0 ? gap : 0) + wide;
    };
    size_t i = 0, n = str.size();
    while (i < n) {
        while (i < n && isSpace(str[i])) i++;
        size_t start = i;
        while (i < n && !isSpace(str[i])) i++;
        if (i == start) continue;
        Text chars = str.substr(start, i - start);
        int64_t gap = space;
        Text unit;
        for (size_t k = 0; k < chars.size(); k++) {
            unit += chars[k];
            if (k + 1 < chars.size() && !parts(chars, k)) continue;
            int64_t wide = cards::advance(unit, letter);
            if (wide <= room) {
                place(wide, gap);
            } else {
                for (size_t p = 0; p < unit.size(); p++) place(cards::advance(Text(1, unit[p]), letter), p == 0 ? room : 0);
            }
            gap = 0;
            unit.clear();
        }
    }
    return int(clamp(lines, 1, max));
}

int64_t figureNeed(const Text& value, Figure size) {
    int64_t digits = std::count_if(value.begin(), value.end(), [](char32_t c) { return c >= '0' && c <= '9'; });
    return span(value, size.letter) * size.letter - digits * (11 * size.letter - size.digit);
}

int textWidth(const Text& str) { return int(up(span(str) * TEXT_LETTER, 100)); }

std::vector<int> spread(const std::vector<int>& needs, int room) {
    std::vector<int> widths(needs.size(), 0);
    std::vector<size_t> open;
    for (size_t i = 0; i < needs.size(); i++) open.push_back(i);
    while (!open.empty()) {
        int each = std::max(0, room / int(open.size()));
        std::vector<size_t> whole;
        for (size_t i : open) {
            if (needs[i] <= each) whole.push_back(i);
        }
        for (size_t i : whole.empty() ? open : whole) {
            widths[i] = whole.empty() ? each : needs[i];
            room -= widths[i];
        }
        if (whole.empty()) break;
        std::vector<size_t> left;
        for (size_t i : open) {
            if (std::find(whole.begin(), whole.end(), i) == whole.end()) left.push_back(i);
        }
        open = left;
    }
    return widths;
}

bool isSpace(char32_t c) {
    return (c >= 0x09 && c <= 0x0d) || c == 0x20 || c == 0xa0 || c == 0x1680 || (c >= 0x2000 && c <= 0x200a) || c == 0x2028 ||
           c == 0x2029 || c == 0x202f || c == 0x205f || c == 0x3000 || c == 0xfeff;
}

Text trim(const Text& str) {
    size_t a = 0, b = str.size();
    while (a < b && isSpace(str[a])) a++;
    while (b > a && isSpace(str[b - 1])) b--;
    return str.substr(a, b - a);
}

Text squash(const Text& str) {
    Text out;
    bool gap = false;
    for (char32_t c : str) {
        if (isSpace(c)) {
            gap = true;
            continue;
        }
        if (gap && !out.empty()) out += U' ';
        gap = false;
        out += c;
    }
    return out;
}

}  // namespace cards
