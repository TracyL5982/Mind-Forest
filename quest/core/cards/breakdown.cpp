// components/breakdown.js: the parts of one whole as level bars, each share written whole at the end
// of its bar. Never a pie.
#include <algorithm>
#include <cmath>

#include "face.h"
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


/// The title, one bar split into the parts by share, the largest part in words, and the count of the parts.
void lay(Col& c, const Item& item, const Json& props) {
    Parts p = parts(props);
    c.lines(item.titleOrUntitled(), Measure::title, 2, palette::ink, face::GAP + 16 + 8 + face::BODY + 4 + face::CUE);
    c.gap(face::GAP);
    if (c.pen) {
        const Pen& pen = *c.pen;
        pen.ctx.setFillColor(Color::white(1, 0.06f));
        pen.rounded(pen.px(c.x, c.y, c.width, 16), 3 * pen.k);
        pen.ctx.fillPath();
        float left = c.x;
        for (size_t i = 0; i < p.rows.size(); i++) {
            float wide = float(p.rows[i].bar) * c.width;
            if (wide <= 0) continue;
            pen.ctx.setFillColor(i == 0 ? c.look.accent : i % 2 ? palette::bar : Color::white(1, 0.55f));
            pen.ctx.fill(pen.px(left, c.y, std::max(1.f, wide - 2), 16));
            left += wide;
        }
    }
    c.gap(16 + 8);
    if (!p.rows.empty()) {
        const Part* largest = &p.rows.front();
        for (const Part& row : p.rows) {
            if (row.value > largest->value) largest = &row;
        }
        std::string share = p.total > 0 ? std::to_string(int(std::lround(largest->value / p.total * 100))) + "%" : largest->written;
        c.lines(largest->label + " " + share, Measure::body, 1, c.look.ink2);
    }
    c.gap(4);
    c.more = true;
    c.cue(cueParts(c.words, int(props["labels"].array().size())));
}

Footprint size(const Item& item, const Json& props) {
    return footprint(item, [&](Col& c) { lay(c, item, props); });
}

void draw(const Pen& pen, const Look& look, const Item& item, const Json& props, float, float) {
    drawFace(pen, look, item, [&](Col& c) { lay(c, item, props); });
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
