// components/table.js: ruled rows under their heads. A column of numbers is set to the right, no number
// is cut, and the card counts the rows and columns it leaves out.
#include <algorithm>
#include <cmath>
#include <numeric>
#include <string_view>

#include "kind.h"
#include "text.h"

namespace cards {

namespace {

constexpr int NARROW = 200;
constexpr int WIDE = 352;
constexpr int ROOM = WIDE - SIDES;
constexpr int BETWEEN = 14;
constexpr int MOST_COLUMNS = 5;
constexpr int MOST_ROWS = 6;
constexpr int ROW = 24;
/// What a column of words is left with at least, when the columns are counted.
constexpr int WORDS_FLOOR = 44;
/// What the first column, which names each row, is given at least, or all it needs when that is less.
constexpr int FIRST_FLOOR = 120;

// MARK: - What is a number

using Ranges = std::initializer_list<std::pair<char32_t, char32_t>>;
bool within(char32_t c, Ranges ranges) {
    return std::any_of(ranges.begin(), ranges.end(), [c](const auto& r) { return c >= r.first && c <= r.second; });
}

/// `\p{Sc}`.
bool currency(char32_t c) {
    return within(c, {{0x24, 0x24},     {0xa2, 0xa5},     {0x58f, 0x58f},   {0x60b, 0x60b},   {0x7fe, 0x7ff},   {0x9f2, 0x9f3},
                      {0x9fb, 0x9fb},   {0xaf1, 0xaf1},   {0xbf9, 0xbf9},   {0xe3f, 0xe3f},   {0x17db, 0x17db}, {0x20a0, 0x20c0},
                      {0xa838, 0xa838}, {0xfdfc, 0xfdfc}, {0xfe69, 0xfe69}, {0xff04, 0xff04}, {0xffe0, 0xffe1}, {0xffe5, 0xffe6},
                      {0x11fdd, 0x11fe0}, {0x1e2ff, 0x1e2ff}, {0x1ecb0, 0x1ecb0}});
}

/// `\p{L}`, near enough: the letters of the scripts a table is written in.
bool letter(char32_t c) {
    return within(c, {{0x41, 0x5a},       {0x61, 0x7a},       {0xaa, 0xaa},       {0xb5, 0xb5},       {0xba, 0xba},
                      {0xc0, 0xd6},       {0xd8, 0xf6},       {0xf8, 0x2c1},      {0x2c6, 0x2d1},     {0x2e0, 0x2e4},
                      {0x370, 0x374},     {0x376, 0x377},     {0x37a, 0x37d},     {0x37f, 0x37f},     {0x386, 0x386},
                      {0x388, 0x38a},     {0x38c, 0x38c},     {0x38e, 0x3a1},     {0x3a3, 0x3f5},     {0x3f7, 0x481},
                      {0x48a, 0x52f},     {0x531, 0x556},     {0x560, 0x588},     {0x5d0, 0x5ea},     {0x5ef, 0x5f2},
                      {0x620, 0x64a},     {0x671, 0x6d3},     {0x904, 0x939},     {0x958, 0x961},     {0xe01, 0xe30},
                      {0xe40, 0xe46},     {0x10a0, 0x10ff},   {0x1100, 0x11ff},   {0x1e00, 0x1fbc},   {0x1fc2, 0x1ffc},
                      {0x2071, 0x2071},   {0x207f, 0x207f},   {0x2090, 0x209c},   {0x2102, 0x2102},   {0x2107, 0x2107},
                      {0x210a, 0x2113},   {0x2115, 0x2115},   {0x2119, 0x211d},   {0x2124, 0x2124},   {0x2126, 0x2126},
                      {0x2128, 0x2128},   {0x212a, 0x212d},   {0x212f, 0x2139},   {0x2c00, 0x2ce4},   {0x3005, 0x3006},
                      {0x3031, 0x3035},   {0x3041, 0x3096},   {0x309d, 0x309f},   {0x30a1, 0x30fa},   {0x30fc, 0x30ff},
                      {0x3105, 0x312f},   {0x3131, 0x318e},   {0x3400, 0x4dbf},   {0x4e00, 0x9fff},   {0xa000, 0xa48c},
                      {0xac00, 0xd7a3},   {0xf900, 0xfa6d},   {0xfa70, 0xfad9},   {0xfb00, 0xfb06},   {0xfb1d, 0xfdfb},
                      {0xfe70, 0xfefc},   {0xff21, 0xff3a},   {0xff41, 0xff5a},   {0xff66, 0xffbe},   {0x20000, 0x323af}});
}

bool digit(char32_t c) { return c >= '0' && c <= '9'; }
bool capital(char32_t c) { return c >= 'A' && c <= 'Z'; }
bool unit(char32_t c) { return letter(c) || currency(c) || std::u32string_view(U"°µ²³/").find(c) != std::u32string_view::npos; }

/// table.js's NUMERAL, `^(?:[-+−–~≈<>≤≥±]\s?)?(?:[A-Z]{0,3}\p{Sc}\s?|[A-Z]{3}\s)?[-+−–]?\d[\d,'’:/\s]*
/// (?:\.\d[\d,'’:/\s]*)?[%％‰]?(?:\s?[\p{L}\p{Sc}°µ²³/]+(?:\s[\p{L}\p{Sc}°µ²³/]+)?)?$`. No part can give back
/// what it took to let a later part match, so taking each part greedily matches as the expression does.
bool numeral(const Text& s) {
    size_t i = 0, n = s.size();
    auto is = [&](auto test) { return i < n && test(s[i]); };
    auto oneOf = [&](std::u32string_view set) {
        if (i >= n || set.find(s[i]) == std::u32string_view::npos) return false;
        i++;
        return true;
    };
    if (oneOf(U"-+−–~≈<>≤≥±") && is(isSpace)) i++;
    size_t caps = 0;
    while (caps < 3 && i + caps < n && capital(s[i + caps])) caps++;
    if (i + caps < n && currency(s[i + caps])) {
        i += caps + 1;
        if (is(isSpace)) i++;
    } else if (caps == 3 && i + 3 < n && isSpace(s[i + 3])) {
        i += 4;
    }
    oneOf(U"-+−–");
    if (!is(digit)) return false;
    auto grouped = [](char32_t c) { return digit(c) || isSpace(c) || std::u32string_view(U",'’:/").find(c) != std::u32string_view::npos; };
    auto run = [&] {
        while (is(grouped)) i++;
    };
    i++;
    run();
    if (i + 1 < n && s[i] == '.' && digit(s[i + 1])) {
        i += 2;
        run();
    }
    oneOf(U"%％‰");
    auto word = [&] {
        size_t from = i;
        while (is(unit)) i++;
        return i > from;
    };
    size_t before = i;
    if (is(isSpace)) i++;
    if (!word()) {
        i = before;
    } else if (is(isSpace)) {
        size_t first = i++;
        if (!word()) i = first;
    }
    return i == n;
}

/// The px a column gives a cell: its count and 1 px more, because a string can draw up to 0.4 px wider than it counts.
int cellWidth(const Text& cell) { return textWidth(cell) + 1; }
/// A number is never cut, so one too wide to stand beside a first column of words is read as words.
bool isNumber(const Text& cell) { return numeral(cell) && cellWidth(cell) <= ROOM - BETWEEN - WORDS_FLOOR; }

// MARK: - The plan

using Row = std::vector<Text>;
const Text& cellOf(const Row& row, size_t i) {
    static const Text none;
    return i < row.size() ? row[i] : none;
}

struct Grid {
    Row heads;
    std::vector<Row> rows;
};
Grid grid(const Json& props) {
    Grid g;
    for (const Json& head : props["heads"].array()) g.heads.push_back(trim(points(text(head))));
    for (const Json& row : props["rows"].array()) {
        Row cells;
        for (const Json& cell : row.array()) cells.push_back(trim(points(text(cell))));
        g.rows.push_back(cells);
    }
    return g;
}

/// A column holds numbers when every cell of it that says something is a number.
bool numeric(const std::vector<Row>& rows, size_t column) {
    bool said = false;
    for (const Row& row : rows) {
        const Text& cell = cellOf(row, column);
        if (cell.empty()) continue;
        if (!isNumber(cell)) return false;
        said = true;
    }
    return said;
}

struct Plan {
    Row heads;
    std::vector<Row> rows;
    std::vector<bool> numbers;
    std::vector<int> widths;
    int width = NARROW, titleLines = 1;
    std::string foot;
};

/// The first rows and columns, as many as fit, each column as wide as table.js's `plan` gives it.
Plan plan(const Item& item, const Json& props) {
    Grid g = grid(props);
    std::vector<Row> shown(g.rows.begin(), g.rows.begin() + long(std::min(g.rows.size(), size_t(MOST_ROWS))));
    struct Column {
        bool number;
        int want, numbers, floor = 0, least = 0;
    };
    std::vector<Column> columns;
    for (size_t i = 0; i < g.heads.size(); i++) {
        Column c{numeric(shown, i), cellWidth(g.heads[i]), 0};
        for (const Row& row : shown) {
            const Text& cell = cellOf(row, i);
            c.want = std::max(c.want, cellWidth(cell));
            if (isNumber(cell)) c.numbers = std::max(c.numbers, cellWidth(cell));
        }
        columns.push_back(c);
    }
    auto leastOf = [](const Column& c, int floor) { return c.number ? floor : std::max(floor, std::min(c.want, WORDS_FLOOR)); };
    int second = columns.size() > 1 ? leastOf(columns[1], columns[1].numbers) : 0;
    for (size_t i = 0; i < columns.size(); i++) {
        Column& c = columns[i];
        c.floor = i == 0 ? std::max(c.numbers, std::min({c.want, FIRST_FLOOR, std::max(WORDS_FLOOR, ROOM - BETWEEN - second)})) : c.numbers;
        c.least = leastOf(c, c.floor);
    }
    auto least = [&](int count) {
        int sum = BETWEEN * (count - 1);
        for (int i = 0; i < count; i++) sum += columns[size_t(i)].least;
        return sum;
    };
    int count = std::min(int(columns.size()), MOST_COLUMNS);
    while (count > 1 && least(count) > ROOM) count -= 1;
    int floors = 0;
    std::vector<int> wants;
    for (int i = 0; i < count; i++) {
        floors += columns[size_t(i)].floor;
        wants.push_back(columns[size_t(i)].want - columns[size_t(i)].floor);
    }
    std::vector<int> extra = spread(wants, ROOM - BETWEEN * (count - 1) - floors);
    Plan p;
    for (int i = 0; i < count; i++) {
        p.heads.push_back(g.heads[size_t(i)]);
        p.numbers.push_back(columns[size_t(i)].number);
        p.widths.push_back(columns[size_t(i)].floor + extra[size_t(i)]);
    }
    for (const Row& row : shown) {
        Row kept;
        for (int i = 0; i < count; i++) kept.push_back(cellOf(row, size_t(i)));
        p.rows.push_back(kept);
    }
    int used = std::accumulate(p.widths.begin(), p.widths.end(), BETWEEN * (count - 1));
    p.width = int(clamp(SIDES + used, NARROW, WIDE));
    p.titleLines = wrap(points(item.titleOrUntitled()), p.width - SIDES, TITLE_LETTER, 2);
    int moreRows = int(g.rows.size() - shown.size()), moreColumns = int(g.heads.size()) - count;
    if (moreRows > 0 || moreColumns > 0) p.foot = moreOf(item.words, moreRows, moreColumns);
    return p;
}

Footprint size(const Item& item, const Json& props) {
    Plan p = plan(item, props);
    return {p.width, FRAME + p.titleLines * TITLE + 8 + ROW * (1 + int(p.rows.size())) + (p.foot.empty() ? 0 : 8 + TEXT)};
}

// MARK: - The small face

/// `.table`: 12.5 px words on a line of 23 px, over the rule that ends each 24 px row.
constexpr Setting CELL{12.5f, 23};

/// A cell in its column. A number is never cut: it is drawn whole, to the right in a column of numbers.
/// Words are cut to the column with an ellipsis, and stand at the right when they fit a column of numbers.
void cell(const Pen& pen, const Text& said, float left, float wide, float top, bool right, bool number, const Setting& t, Color color) {
    if (said.empty()) return;
    std::string s = utf8(said);
    float drawn = pen.width(s, t);
    bool fits = drawn <= wide;
    float x = right && fits ? left + wide - drawn : left;
    pen.words(s, x, top, number || fits ? drawn + 1 : wide, 1, t, color);
}

void draw(const Pen& pen, const Look& look, const Item& item, const Json& props, float width, float body) {
    Plan p = plan(item, props);
    float x = 16, column = width - 32, y = 14;
    pen.words(item.titleOrUntitled(), x, y, column, p.titleLines, setting::title, palette::ink);
    y += float(p.titleLines * TITLE + 8);
    pen.ctx.setFillColor(palette::line);
    for (size_t r = 0; r <= p.rows.size(); r++) pen.ctx.fill(pen.px(x, y + float(ROW * r) + 23, column, 1));
    // `justify-content: space-between` shares what the columns leave of the line among the gaps.
    size_t count = p.widths.size();
    float used = float(std::accumulate(p.widths.begin(), p.widths.end(), 0));
    float gap = count > 1 ? (column - used) / float(count - 1) : 0;
    float left = x;
    for (size_t i = 0; i < count; i++) {
        float wide = float(p.widths[i]);
        cell(pen, p.heads[i], left, wide, y, p.numbers[i], false, CELL, look.ink2);
        for (size_t r = 0; r < p.rows.size(); r++) {
            const Text& said = p.rows[r][i];
            cell(pen, said, left, wide, y + float(ROW * (r + 1)), p.numbers[i], isNumber(said), CELL, palette::ink);
        }
        left += wide + gap;
    }
    if (!p.foot.empty()) pen.words(p.foot, x, body - 14 - TEXT, column, 1, setting::text, look.ink3);
}

// MARK: - The opened card

/// `.detail-table`: 13 px words on 18 px lines, in cells padded 6 px by 12.
constexpr Setting OPEN_CELL{13, 18};
constexpr float PAD_X = 12, PAD_Y = 6;
/// The box is at most 46 % of a view tall, as image.cpp's picture is, and shows what fits of a longer table.
constexpr float MOST_TALL = 420;
/// A column is at least as wide as its widest early cell, up to this, so its words are not set one to a line.
constexpr size_t EARLY_ROWS = 20;
constexpr int EARLY_MOST = 220;

/// The widest word of `s` drawn alone, px.
float widestWord(const std::string& s, const Setting& t, float k) {
    float widest = 0;
    Text all = points(s);
    size_t i = 0;
    while (i < all.size()) {
        while (i < all.size() && isSpace(all[i])) i++;
        size_t start = i;
        while (i < all.size() && !isSpace(all[i])) i++;
        if (i > start) widest = std::max(widest, widthOf(utf8(all.substr(start, i - start)), t, k));
    }
    return widest;
}

/// Every row and column under heads that wrap on whole words, the columns shared out as a browser's
/// automatic table layout shares them. The web's box scrolls both ways; here it shows its top left.
void detail(Sheet& sheet, const Item&, const Json& props) {
    Grid g = grid(props);
    size_t n = g.heads.size();
    float k = sheet.k;
    std::vector<bool> right(n);
    std::vector<float> least(n), most(n);
    for (size_t i = 0; i < n; i++) {
        right[i] = numeric(g.rows, i);
        int early = 0;
        for (size_t r = 0; r < std::min(g.rows.size(), EARLY_ROWS); r++) early = std::max(early, (textWidth(cellOf(g.rows[r], i)) * 26 + 24) / 25);
        std::string head = utf8(g.heads[i]);
        float narrow = std::max(float(std::min(early, EARLY_MOST)), widestWord(head, OPEN_CELL, k));
        float widest = widthOf(head, OPEN_CELL, k);
        for (const Row& row : g.rows) {
            const Text& said = cellOf(row, i);
            float whole = widthOf(utf8(said), OPEN_CELL, k);
            widest = std::max(widest, whole);
            // A number is set on one line; other words may break anywhere (`overflow-wrap: anywhere`).
            if (isNumber(said)) narrow = std::max(narrow, whole);
        }
        least[i] = std::ceil(narrow) + 2 * PAD_X;
        most[i] = std::max(least[i], std::ceil(widest) + 2 * PAD_X);
    }
    float room = Sheet::width - 2;
    float sumLeast = std::accumulate(least.begin(), least.end(), 0.f), sumMost = std::accumulate(most.begin(), most.end(), 0.f);
    std::vector<float> widths(n);
    for (size_t i = 0; i < n; i++) {
        if (sumMost <= room) widths[i] = most[i] + (room - sumMost) * most[i] / std::max(1.f, sumMost);
        else if (sumLeast >= room) widths[i] = least[i];
        else widths[i] = least[i] + (room - sumLeast) * (most[i] - least[i]) / (sumMost - sumLeast);
    }
    std::vector<Row> lines{g.heads};
    lines.insert(lines.end(), g.rows.begin(), g.rows.end());
    std::vector<float> talls;
    float tall = 2;
    for (size_t r = 0; r < lines.size(); r++) {
        float line = OPEN_CELL.lead;
        for (size_t i = 0; i < n; i++) {
            const Text& said = cellOf(lines[r], i);
            if (r > 0 && isNumber(said)) continue;
            line = std::max(line, heightOf(utf8(said), widths[i] - 2 * PAD_X, 0, OPEN_CELL, k));
        }
        talls.push_back(line + 2 * PAD_Y + (r + 1 < lines.size() ? 1 : 0));
        tall += talls.back();
    }
    tall = std::min(tall, MOST_TALL);
    for (const Row& row : lines) {
        for (const Text& said : row) {
            if (!said.empty()) sheet.said.push_back(utf8(said));
        }
    }
    sheet.part(tall, [=](const Pen& pen, float y) {
        CGRect box = pen.px(Sheet::left, y, Sheet::width, tall);
        pen.ctx.setFillColor(palette::face);
        pen.rounded(box, 12 * pen.k);
        pen.ctx.fillPath();
        pen.ctx.saveGState();
        pen.ctx.clip(pen.px(Sheet::left + 1, y + 1, Sheet::width - 2, tall - 2));
        float top = y + 1;
        for (size_t r = 0; r < lines.size() && top < y + tall; r++) {
            float left = Sheet::left + 1;
            for (size_t i = 0; i < n; i++) {
                const Text& said = cellOf(lines[r], i);
                bool number = r > 0 && isNumber(said);
                std::string s = utf8(said);
                float column = widths[i] - 2 * PAD_X, drawn = pen.width(s, OPEN_CELL);
                float x = right[i] && drawn <= column ? left + PAD_X + column - drawn : left + PAD_X;
                pen.words(s, x, top + PAD_Y, number ? drawn + 1 : column, 0, OPEN_CELL, r == 0 ? palette::ink2 : palette::ink);
                left += widths[i];
            }
            top += talls[r];
            if (r + 1 < lines.size()) {
                pen.ctx.setFillColor(r == 0 ? palette::line2 : palette::line);
                pen.ctx.fill(pen.px(Sheet::left + 1, top - 1, std::max(Sheet::width - 2, left - Sheet::left - 1), 1));
            }
        }
        pen.ctx.restoreGState();
        pen.mask(box, 12 * pen.k, palette::glass);
        float line = pen.k;
        pen.ctx.setStrokeColor(palette::line);
        pen.ctx.setLineWidth(line);
        pen.rounded(CGRect{box.minX() + line / 2, box.minY() + line / 2, box.width() - line, box.height() - line}, 12 * pen.k - line / 2);
        pen.ctx.strokePath();
    });
}

Kind make() {
    Kind k{"table", size, {}, draw, detail};
    k.opens = Kind::Opens::chart;
    return k;
}

const Kind kind = make();
const Registered registered{kind};

}  // namespace

}  // namespace cards
