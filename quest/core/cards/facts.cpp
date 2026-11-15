// components/facts.js: figures two to a row on a fact's sunk face, each over its label, all of one card
// in one size.
#include <algorithm>
#include <cmath>

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

Footprint size(const Item& item, const Json& props) {
    Plan p = plan(item, props);
    return {WIDTH, FRAME + p.titleLines * TITLE + (p.grid.rows.empty() ? 0 : 12 + p.grid.height) + (p.more ? 8 + TEXT : 0)};
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

void draw(const Pen& pen, const Look& look, const Item& item, const Json& props, float width, float body) {
    Plan p = plan(item, props);
    float x = 16, column = width - 32, y = 14;
    pen.words(p.title, x, y, column, p.titleLines, setting::title, palette::ink);
    figuresAt(pen, look, p.grid, x, y + float(p.titleLines * TITLE + 12), column);
    if (p.more) pen.words(item.words.more(p.more), x, body - 14 - TEXT, column, 1, setting::text, look.ink3);
}

/// `.detail-figures`: each label beside its value, whole.
void listed(Sheet& sheet, const std::vector<Fact>& facts) {
    constexpr Setting label{14, 20};
    constexpr Setting value{14, 20, Font::Weight::bold};
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
