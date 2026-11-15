// components/facts.js: figures two to a row on a fact's sunk face, each over its label, all of one card
// in one size.
#include <algorithm>
#include <cmath>

#include "face.h"
#include "figures.h"
#include "parts.h"

namespace cards {

namespace {

constexpr int WIDTH = 320;
constexpr int COLUMN = WIDTH - SIDES;
constexpr int BETWEEN = 17;
constexpr int HALF = (COLUMN - BETWEEN) / 2;
constexpr int ROW_GAP = 12;
/// The most lines a value is given at the middle size, on a row of its own, before the card steps down.
constexpr int MIDDLE_LINES = 2;
/// The most lines a value is given at the smallest size, as on a fact card.
constexpr int MOST_LINES = 8;

struct Fact {
    std::string label, value;
};

std::vector<Fact> pairs(const Json& props) {
    std::vector<Fact> out;
    for (const Json& fact : props["facts"].array()) out.push_back({trimmed(fact["label"]), trimmed(fact["value"])});
    return out;
}

bool fits(const Figure& size, int room, const std::string& value) { return figureNeed(points(value), size) <= room * 100; }

struct Cell {
    Fact fact;
    int lines = 1, labelLines = 1;
    /// A value too long for `MOST_LINES` is no figure but a passage, cut there with an ellipsis.
    bool cut = false;
};
struct Row {
    int room;
    std::vector<Cell> cells;
};
struct Grid {
    Figure size = MIDDLE;
    std::vector<Row> rows;
    int height = 0;
};

/// Facts sit two to a row when both values fit half a row at the middle size; any other has the whole
/// row. Every figure of a card is set in one size: the middle while each value fits its room there in
/// `MIDDLE_LINES`, the smallest when one needs more.
Grid grid(const std::vector<Fact>& facts) {
    Grid g;
    for (size_t i = 0; i < facts.size(); i += g.rows.back().cells.size()) {
        bool paired = i + 1 < facts.size() && fits(MIDDLE, HALF, facts[i].value) && fits(MIDDLE, HALF, facts[i + 1].value);
        Row row{paired ? HALF : COLUMN, {}};
        for (size_t j = i; j < i + (paired ? 2 : 1); j++) row.cells.push_back({facts[j]});
        g.rows.push_back(row);
    }
    bool middle = std::all_of(g.rows.begin(), g.rows.end(), [](const Row& row) {
        return std::all_of(row.cells.begin(), row.cells.end(), [&](const Cell& c) {
            return fits(MIDDLE, row.room, c.fact.value) || wrap(points(c.fact.value), row.room, MIDDLE.letter, MIDDLE_LINES + 1) <= MIDDLE_LINES;
        });
    });
    g.size = middle ? MIDDLE : SMALLEST;
    for (Row& row : g.rows) {
        int tallest = 0;
        for (Cell& c : row.cells) {
            int needs = fits(g.size, row.room, c.fact.value) ? 1 : wrap(points(c.fact.value), row.room, g.size.letter, MOST_LINES + 1);
            c.lines = std::min(needs, MOST_LINES);
            c.cut = needs > MOST_LINES;
            c.labelLines = wrap(points(c.fact.label), row.room, TEXT_LETTER, 2);
            tallest = std::max(tallest, c.lines * g.size.lineHeight + c.labelLines * TEXT);
        }
        g.height += tallest;
    }
    g.height += std::max(0, int(g.rows.size()) - 1) * ROW_GAP;
    return g;
}

struct Plan {
    std::string title;
    Grid grid;
    int more = 0, titleLines = 1;
};

Plan plan(const Item& item, const Json& props) {
    Plan p;
    p.title = item.titleOrUntitled();
    p.grid = grid(pairs(props));
    double more = props["more"].number(0);
    if (props["more"].isNumber() && more == std::floor(more) && more > 0) p.more = int(std::min(more, 1e9));
    p.titleLines = wrap(points(p.title), COLUMN, TITLE_LETTER, 2);
    return p;
}

/// The rows of figures with their top-left at (x, y) px. Each row is as tall as its taller figure and
/// label as drawn, as a grid row is.
void figuresAt(const Pen& pen, const Look& look, const Grid& grid, float x, float y, float column) {
    float half = (column - BETWEEN) / 2;
    for (const Row& row : grid.rows) {
        float tallest = 0;
        for (size_t i = 0; i < row.cells.size(); i++) {
            const Cell& c = row.cells[i];
            float left = x + float(i) * (half + BETWEEN), room = row.cells.size() == 1 ? column : half;
            int lines = c.cut ? MOST_LINES : 0;
            float valueTall = figureHeight(c.fact.value, room, lines, grid.size, pen.k);
            figure(pen, c.fact.value, left, y, room, lines, grid.size, palette::ink);
            pen.words(c.fact.label, left, y + valueTall, room, c.labelLines, setting::text, look.ink2);
            tallest = std::max(tallest, valueTall + heightOf(c.fact.label, room, c.labelLines, setting::text, pen.k));
        }
        y += tallest + ROW_GAP;
    }
}


/// `.detail-figures`: each label beside its value, whole.
void listed(Sheet& sheet, const std::vector<Fact>& facts) {
    constexpr Setting label{15, 21, Font::Weight::medium};
    constexpr Setting value{15, 21, Font::Weight::bold};
    float k = sheet.k, inner = Sheet::width - 32, labels = 0;
    for (const Fact& f : facts) labels = std::max(labels, std::ceil(widthOf(f.label, label, k)));
    // `minmax(0, max-content) minmax(40%, 1fr)`, 16 px apart.
    labels = std::min(labels, inner - 16 - 0.4f * inner);
    float values = inner - 16 - labels;
    std::vector<float> rows;
    float tall = 1 + 13 + 13 + 1 + 8 * float(std::max(0, int(facts.size()) - 1));
    for (const Fact& f : facts) {
        rows.push_back(std::max(heightOf(f.label, labels, 0, label, k), heightOf(f.value, values, 0, value, k)));
        tall += rows.back();
    }
    Color accent = sheet.look.accent;
    sheet.part(tall, [=](const Pen& pen, float y) {
        box(pen, Sheet::left, y, Sheet::width, tall, palette::sunk, accent.withAlphaComponent(0.3f));
        float x = Sheet::left + 16, top = y + 14;
        for (size_t i = 0; i < facts.size(); i++) {
            pen.words(facts[i].label, x, top, labels, 0, label, palette::ink2);
            pen.words(facts[i].value, x + labels + 16, top, values, 0, value, palette::ink);
            top += rows[i] + 8;
        }
    });
    for (const Fact& f : facts) {
        sheet.said.push_back(f.label);
        sheet.said.push_back(f.value);
    }
}

/// The title, one row of figures: two when both fit half the row at the middle size, else one, and the cue.
void lay(Col& c, const Item& item, const Json& props) {
    std::vector<Fact> facts = pairs(props);
    if (facts.empty()) {
        c.lines(item.titleOrUntitled(), Measure::title, 2, palette::ink);
        c.above(props);
        if (c.more) c.cue(cueMore(c.words));
        return;
    }
    if (headsOf(props)) {
        // Under a heads row each fact is a row: its label under the first head, its value under the second at
        // the column's end. The title, the item's lines and the heads row come first, and the rows that fit whole.
        c.lines(item.titleOrUntitled(), Measure::title, 2, palette::ink, face::GAP + face::META + 5 + 8 + face::BODY);
        bool open = c.above(props) && c.heads(props);
        const float half = std::floor((c.width - 17) / 2);
        size_t i = 0;
        for (; open && i < facts.size(); i++) {
            Text v = points(facts[i].value);
            bool middle = figureNeed(v, MIDDLE) <= int(half) * 100;
            const Figure& size = middle ? MIDDLE : SMALLEST;
            int valueLines = middle ? 1 : wrap(v, int(half), SMALLEST.letter, 3);
            // A value on one line is as wide as it is counted, and the label has the rest of the row.
            float valueWide = valueLines == 1 ? std::min(half, std::ceil(float(figureNeed(v, size)) / 100)) : half;
            float labelWide = c.width - 12 - valueWide;
            int labelLines = counted(facts[i].label, int(labelWide), Measure::body);
            float tall = std::max(float(labelLines * face::BODY), float(valueLines * size.lineHeight)), before = i == 0 ? 8.f : 6.f;
            if (labelLines > 2 || valueLines > 2 || before + tall + (i + 1 < facts.size() ? face::CUE : 0) > c.room()) break;
            c.gap(before);
            if (c.pen) {
                c.say(facts[i].label, setting::faceBody, labelLines, c.x, c.y, labelWide, c.look.ink2);
                float w = valueLines == 1 ? std::min(valueWide, std::ceil(widthOf(facts[i].value, figureSetting(size), c.pen->k)) + 1) : valueWide;
                c.heldBack = figure(*c.pen, facts[i].value, c.x + c.width - w, c.y, w + 1, valueLines, size, palette::ink) || c.heldBack;
            }
            c.gap(tall);
        }
        if (i < facts.size()) c.more = true;
        if (c.more) c.cue(i < facts.size() ? cueCount(c.words, int(facts.size() - i)) : cueMore(c.words));
        return;
    }
    // Two figures side by side when both fit half the column at the middle size; else the first alone, at the
    // middle size or on as many lines at the smallest as it needs. The title gives way to them.
    const int half = (face::COL - 17) / 2;
    auto fits = [](const std::string& value, int room) { return figureNeed(points(value), MIDDLE) <= room * 100; };
    size_t shown = facts.size() > 1 && fits(facts[0].value, half) && fits(facts[1].value, half) ? 2 : 1;
    const Figure& size = shown == 2 || fits(facts[0].value, face::COL) ? MIDDLE : SMALLEST;
    int need = &size == &SMALLEST ? wrap(points(facts[0].value), face::COL, SMALLEST.letter, 3) : 1, valueLines = std::min(2, need);
    // A value on two lines stands 8 px under the title, so a title line, the value and the cue all fit.
    float row = float(valueLines * size.lineHeight + face::META), over = valueLines == 2 ? 8 : 12;
    bool left = facts.size() > shown;
    // What is left out is known before the title, which then keeps the cue's row free.
    if (left || need > 2) c.more = true;
    c.lines(item.titleOrUntitled(), Measure::title, 2, palette::ink, over + row);
    // The item's lines over the figures come first; the row of figures follows when it still fits whole.
    if (!c.above(props) || over + row > c.room() - (c.more ? face::CUE : 0)) {
        c.more = true;
        c.cue(cueCount(c.words, int(facts.size())));
        return;
    }
    c.gap(over);
    float room = shown == 2 ? float(half) : float(face::COL);
    if (c.pen) {
        for (size_t i = 0; i < shown; i++) {
            float x = c.x + float(i) * (float(half) + 17);
            c.heldBack = figure(*c.pen, facts[i].value, x, c.y, room, valueLines, size, palette::ink) || c.heldBack;
            c.say(facts[i].label, setting::faceMeta, 1, x, c.y + float(valueLines * size.lineHeight), room, palette::ink2);
        }
    }
    c.gap(row);
    if (c.more) c.cue(left ? cueCount(c.words, int(facts.size() - shown)) : cueMore(c.words));
}

Footprint size(const Item& item, const Json& props) {
    return footprint(item, [&](Col& c) { lay(c, item, props); });
}

void draw(const Pen& pen, const Look& look, const Item& item, const Json& props, float, float) {
    drawFace(pen, look, item, [&](Col& c) { lay(c, item, props); });
}



/// Every fact the item holds, when the card shows only the first of them.
void detail(Sheet& sheet, const Item& item, const Json& props) {
    std::vector<Fact> held;
    for (const Json& fact : item.data["facts"].array()) {
        Fact f{trimmed(fact["label"]), trimmed(fact["value"])};
        if (!f.label.empty() && !f.value.empty()) held.push_back(f);
    }
    std::vector<Fact> shown = pairs(props);
    listed(sheet, held.size() > shown.size() ? held : shown);
}

Kind make() {
    Kind k{"facts", size, {}, draw, detail};
    k.face = Kind::Face::sunk;
    k.opens = Kind::Opens::chart;
    return k;
}

const Kind kind = make();
const Registered registered{kind};

}  // namespace

int figuresHeight(const Json& section) { return grid(pairs(section)).height; }

std::vector<std::string> figureWords(const Json& section) {
    std::vector<std::string> out;
    for (const Fact& f : pairs(section)) {
        out.push_back(f.label);
        out.push_back(f.value);
    }
    return out;
}

void drawFigures(const Pen& pen, const Look& look, const Json& section, float x, float y, float column) {
    figuresAt(pen, look, grid(pairs(section)), x, y, column);
}

void listFigures(Sheet& sheet, const Json& section) { listed(sheet, pairs(section)); }

}  // namespace cards
