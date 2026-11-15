// components/breakdown.js: the parts of one whole as level bars, each share written whole at the end
// of its bar. Never a pie.
#include <algorithm>
#include <cmath>

#include "figures.h"

namespace cards {

namespace {

constexpr int WIDTH = 300;
constexpr int COLUMN = WIDTH - SIDES;
constexpr int MOST = 8;
constexpr int GAP = 7;
/// The gap either side of a bar, the least a bar is left, and the least and the most a label may take.
constexpr int BESIDE = 8;
constexpr int BAR = 72;
constexpr int LABEL_LEAST = 48, LABEL_MOST = 128;

bool percentSign(const std::string& unit) { return unit == "%" || unit == "\xEF\xBC\x85"; }

struct Part {
    std::string label, written;
    double value;
    /// Its share of the whole, from 0 to 1: the bars of a card add up to one full track.
    double bar = 0;
};
struct Parts {
    std::vector<Part> rows;
    /// A unit written once under the title: any but a percent sign, which each share carries.
    std::string unit;
    double total = 0;
};

/// A part whose share is written as 0 has no bar, and so has every part when the whole is 0.
Parts parts(const Json& props) {
    Parts p;
    std::string unit = trimmed(props["unit"]);
    bool percent = percentSign(unit);
    p.unit = percent ? "" : unit;
    const std::vector<Json>& labels = props["labels"].array();
    for (size_t i = 0; i < labels.size() && i < MOST; i++) {
        double given = props["values"][i].number(0);
        double v = std::isfinite(given) && given > 0 ? given : 0;
        p.rows.push_back({trimmed(labels[i]), exact(v) + (percent ? "%" : ""), v});
        p.total += v;
    }
    for (Part& row : p.rows) row.bar = exact(row.value) == "0" ? 0 : row.value / p.total;
    return p;
}

int titleLines(const Item& item) { return wrap(points(item.titleOrUntitled()), COLUMN, TITLE_LETTER, 2); }

Footprint size(const Item& item, const Json& props) {
    int rows = int(std::min(props["labels"].array().size(), size_t(MOST)));
    return {WIDTH, FRAME + titleLines(item) * TITLE + (parts(props).unit.empty() ? 0 : TEXT) + (rows ? 10 + rows * TEXT + (rows - 1) * GAP : 0)};
}

/// One line for each part from `top`: its label in `labels` px, its bar, its share at the right edge.
/// `labelLines` 1 cuts a label with an ellipsis; 0 wraps it, and a row is then as tall as its label.
float bars(const Pen& pen, const std::vector<Part>& rows, float x, float top, float width, float labels, float shares, int labelLines,
           const Look& look) {
    float track = width - labels - shares - 2 * BESIDE;
    for (const Part& row : rows) {
        pen.words(row.label, x, top, labels, labelLines, setting::text, look.ink2);
        float left = x + labels + BESIDE;
        pen.ctx.setFillColor(Color::white(1, 0.06f));
        pen.rounded(pen.px(left, top + 4.5f, track, 8), 4 * pen.k);
        pen.ctx.fillPath();
        if (row.bar > 0) {
            pen.ctx.setFillColor(palette::bar);
            pen.rounded(pen.px(left, top + 4.5f, std::max(2.f, float(row.bar) * track), 8), 4 * pen.k);
            pen.ctx.fillPath();
        }
        float wide = pen.width(row.written, setting::text);
        pen.words(row.written, x + width - wide, top, wide + 1, 1, setting::text, palette::ink);
        float tall = labelLines ? TEXT : std::max(float(TEXT), heightOf(row.label, labels, 0, setting::text, pen.k));
        top += tall + GAP;
    }
    return top;
}

/// Every share is written whole, so the labels give way first and then the bars.
void draw(const Pen& pen, const Look& look, const Item& item, const Json& props, float width, float) {
    Parts p = parts(props);
    int lines = titleLines(item);
    float x = 16, column = width - 32, y = 14;
    pen.words(item.titleOrUntitled(), x, y, column, lines, setting::title, palette::ink);
    y += float(lines * TITLE);
    if (!p.unit.empty()) {
        pen.words(p.unit, x, y, column, 1, setting::text, look.ink3);
        y += TEXT;
    }
    int shares = 0, labels = 0;
    for (const Part& row : p.rows) {
        shares = std::max(shares, textWidth(points(row.written)));
        labels = std::max(labels, textWidth(points(row.label)));
    }
    labels = std::min({labels, LABEL_MOST, std::max(LABEL_LEAST, COLUMN - 2 * BESIDE - shares - BAR)});
    bars(pen, p.rows, x, y + 10, column, float(labels), float(shares), 1, look);
}

/// `.detail-breakdown`: the same bars with every label whole, and each share of the whole beside a value
/// that is no percentage.
void detail(Sheet& sheet, const Item&, const Json& props) {
    Parts p = parts(props);
    bool percent = std::any_of(p.rows.begin(), p.rows.end(), [](const Part& row) { return row.written.back() == '%'; });
    if (!percent) {
        for (Part& row : p.rows) row.written += " \xC2\xB7 " + written(toFixed(row.value / (p.total ? p.total : 1) * 100, 1), 4) + "%";
    }
    float k = sheet.k, inner = Sheet::width - 24, labels = 0, shares = 0;
    for (const Part& row : p.rows) {
        labels = std::max(labels, std::ceil(widthOf(row.label, setting::text, k)));
        shares = std::max(shares, std::ceil(widthOf(row.written, setting::text, k)));
    }
    // `fit-content(45%) minmax(48px, 1fr) auto`, 8 px apart.
    labels = std::min({labels, 0.45f * inner, inner - 2 * BESIDE - shares - 48});
    float unitTall = heightOf(p.unit, inner, 0, setting::text, k), rowsTall = 0;
    for (const Part& row : p.rows) rowsTall += std::max(float(TEXT), heightOf(row.label, labels, 0, setting::text, k));
    rowsTall += float(GAP * std::max(0, int(p.rows.size()) - 1));
    float tall = 12 + (p.unit.empty() ? 0 : unitTall + 6) + rowsTall + 12;
    Look look = sheet.look;
    look.fill = palette::sunk;
    look.ink2 = palette::ink2;
    sheet.part(tall, [=](const Pen& pen, float y) {
        box(pen, Sheet::left, y, Sheet::width, tall, palette::sunk, std::nullopt);
        float x = Sheet::left + 12, top = y + 12;
        if (!p.unit.empty()) {
            pen.words(p.unit, x, top, inner, 0, setting::text, palette::ink3);
            top += unitTall + 6;
        }
        bars(pen, p.rows, x, top, inner, labels, shares, 0, look);
    });
    if (!p.unit.empty()) sheet.said.push_back(p.unit);
    for (const Part& row : p.rows) {
        sheet.said.push_back(row.label);
        sheet.said.push_back(row.written);
    }
}

Kind make() {
    Kind k{"breakdown", size, {}, draw, detail};
    k.opens = Kind::Opens::chart;
    return k;
}

const Kind kind = make();
const Registered registered{kind};

}  // namespace

}  // namespace cards
