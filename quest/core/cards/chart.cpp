// components/chart.js, and the plot of components/shared.js: bars or a line over gridlines, a scale
// down the side, and one value called out.
#include <algorithm>
#include <array>
#include <cmath>
#include <set>

#include "figures.h"

namespace cards {

namespace {

constexpr int WIDTH = 300;
constexpr int PLOT = 136;

/// What a chart holds, as numbers and the label of each. A value that is not a number is left out.
struct Series {
    std::vector<double> values;
    std::vector<std::string> labels;
    int mark = -1;
};

Series series(const Json& props) {
    Series s;
    for (const Json& v : props["values"].array()) {
        if (double n = number(v); std::isfinite(n)) s.values.push_back(n);
    }
    const std::vector<Json>& given = props["labels"].array();
    for (size_t i = 0; i < s.values.size(); i++) {
        const Json& label = i < given.size() ? given[i] : Json();
        s.labels.push_back(label.isNull() ? "" : label.isString() ? label.string() : label.dump());
    }
    const Json& mark = props["mark"];
    double m = mark.number(-1);
    if (mark.isNumber() && m == std::floor(m) && m >= 0 && m < double(s.values.size())) s.mark = int(m);
    return s;
}

/// `Intl.NumberFormat('en', {notation: 'compact', maximumSignificantDigits: 3})`: 950, 1.2K, 3.4M.
std::string compact(double value) {
    static const char* const SUFFIX[] = {"", "K", "M", "B", "T"};
    Decimal d = significant(value, 3);
    int group = d.digits.empty() || d.exponent < 3 ? 0 : std::min(d.exponent / 3, 4);
    d.exponent -= 3 * group;
    return written(d, 5) + SUFFIX[group];
}

/// Round gridline values that cover `lo` to `hi` in about three steps.
std::vector<double> gridValues(double lo, double hi) {
    if (hi == lo) hi = lo + 1;
    double rough = (hi - lo) / 3;
    double power = std::pow(10.0, std::floor(std::log10(rough)));
    double step = 10 * power;
    for (double m : {1.0, 2.0, 2.5, 5.0, 10.0}) {
        if (m * power >= rough) {
            step = m * power;
            break;
        }
    }
    double first = std::floor(lo / step), last = std::ceil(hi / step);
    std::vector<double> out;
    for (double i = 0; i < last - first + 1; i++) {
        char buf[40];
        snprintf(buf, sizeof buf, "%.11e", (first + i) * step);
        out.push_back(strtod(buf, nullptr));
    }
    return out;
}


/// What a string on the plot is, which sets its colour and weight.
enum class Role { tick, value, markedValue, label, markedLabel, empty };
struct Writing {
    std::string text;
    float x, baseline;
    /// -1 its start at `x`, 0 its middle, 1 its end.
    int anchor;
    Role role;
};

/// The plot laid out in its own px, from its top-left corner, as shared.js's `plot` lays its SVG out.
struct Plot {
    float width = 0, height = 0, left = 0, right = 4;
    struct Rule {
        float y;
        bool axis;
    };
    std::vector<Rule> rules;
    std::optional<std::array<float, 3>> guide;
    std::vector<CGPoint> line;
    struct Dot {
        CGPoint at;
        bool marked;
    };
    std::vector<Dot> dots;
    struct Bar {
        float x, y, width, height;
        bool marked;
    };
    std::vector<Bar> bars;
    std::vector<Writing> writings;
    /// Every label and value is on the plot in full.
    bool whole = true;
};

/// Labels and values are written level, in short form, and only where they fit. Six points or fewer
/// each keep their label, cut to the slot. With more, every nth label is written, the marked, first and
/// last ones before the rest. On a card, values are written for six points or fewer.
Plot plot(const Json& props, double width, double height, bool opened, const Words& words) {
    Plot p;
    p.width = float(width);
    p.height = float(height);
    Series s = series(props);
    const std::vector<double>& values = s.values;
    const std::vector<std::string>& labels = s.labels;
    int n = int(values.size()), mark = s.mark;
    if (n == 0) {
        p.writings.push_back({words.chinese ? "暂无数据" : "No data", float(width / 2), float(height / 2 + 4), 0, Role::empty});
        return p;
    }
    bool line = text(props["chart"]) == "line";
    std::vector<double> grid = gridValues(std::min(0.0, *std::min_element(values.begin(), values.end())),
                                          std::max(0.0, *std::max_element(values.begin(), values.end())));
    double lo = grid.front(), hi = grid.back();
    std::vector<std::string> gridText;
    int widestTick = 0;
    for (double v : grid) {
        gridText.push_back(compact(v));
        widestTick = std::max(widestTick, textWidth(points(gridText.back())));
    }
    double left = 10 + widestTick, right = 4, top = 20, bottom = 22;
    double step = (width - left - right) / n;
    auto y = [&](double v) { return top + (height - top - bottom) * (1 - (v - lo) / (hi - lo)); };
    auto x = [&](int i) { return left + step * (i + 0.5); };
    p.left = float(left);

    for (size_t i = 0; i < grid.size(); i++) {
        p.rules.push_back({float(y(grid[i])), grid[i] == 0});
        p.writings.push_back({gridText[i], float(left - 6), float(y(grid[i]) + 4), 1, Role::tick});
    }
    if (line && mark >= 0) p.guide = {float(x(mark)), float(y(values[size_t(mark)])), float(y(lo))};
    if (line && n > 1) {
        for (int i = 0; i < n; i++) p.line.push_back(CGPoint{float(x(i)), float(y(values[size_t(i)]))});
    }
    for (int i = 0; i < n; i++) {
        double v = values[size_t(i)];
        if (line) {
            if (i == mark || n <= 16) p.dots.push_back({CGPoint{float(x(i)), float(y(v))}, i == mark});
        } else {
            double bar = std::max(3.0, std::min(44.0, step * 0.62));
            p.bars.push_back({float(x(i) - bar / 2), float(std::min(y(v), y(0))), float(bar), float(std::max(2.0, std::abs(y(v) - y(0)))), i == mark});
        }
    }

    using Row = std::vector<std::pair<double, double>>;
    // Writes `str` centred on `at` and pulled inside `from` and `to`, unless it would touch a string already in `row`.
    auto write = [&](Row& row, Role role, const std::string& str, double at, double from, double to, double baseline) {
        double wide = textWidth(points(str));
        double ideal = at - wide / 2;
        double start = std::max(from, std::min(std::max(from, to - wide), ideal));
        for (auto [a, b] : row) {
            if (start < b + 6 && a < start + wide + 6) return false;
        }
        row.push_back({start, start + wide});
        int anchor = start > ideal ? -1 : start < ideal ? 1 : 0;
        p.writings.push_back({str, float(anchor < 0 ? from : anchor > 0 ? to : at), float(baseline), anchor, role});
        return true;
    };
    std::vector<int> markedFirst;
    for (int i : std::initializer_list<int>{mark, 0, n - 1}) {
        if (i >= 0 && std::find(markedFirst.begin(), markedFirst.end(), i) == markedFirst.end()) markedFirst.push_back(i);
    }
    for (int i = 0; i < n; i++) {
        if (std::find(markedFirst.begin(), markedFirst.end(), i) == markedFirst.end()) markedFirst.push_back(i);
    }

    // On a line, a point lower than both its neighbours has the line above it, so its value goes below.
    auto dips = [&](int i) {
        double before = i > 0 ? values[size_t(i - 1)] : INFINITY, after = i + 1 < n ? values[size_t(i + 1)] : INFINITY;
        return line && n > 1 && before > values[size_t(i)] && after > values[size_t(i)] && y(values[size_t(i)]) + 22 <= height - bottom;
    };
    std::vector<std::string> valueText;
    int widestValue = 0;
    for (double v : values) {
        valueText.push_back(compact(v));
        widestValue = std::max(widestValue, textWidth(points(valueText.back())));
    }
    bool allFit = widestValue <= step - 4;
    std::vector<bool> valued;
    for (int i = 0; i < n; i++) valued.push_back(i == mark || (allFit && (opened || n <= 6)));
    Row valueRow;
    for (int i : markedFirst) {
        if (!valued[size_t(i)]) continue;
        double v = values[size_t(i)];
        write(valueRow, i == mark ? Role::markedValue : Role::value, valueText[size_t(i)], x(i), left, width,
              dips(i) ? y(v) + 18 : std::max(12.0, std::min(y(v), y(0)) - (line ? 9 : 6)));
    }

    int widest = 0;
    for (const std::string& label : labels) widest = std::max(widest, textWidth(points(label)));
    int stride = n <= 6 ? 1 : std::max(1, int(std::ceil((std::min(widest, 44) + 6) / step)));
    double room = std::floor(stride * step - 6);
    Row labelRow;
    std::set<int> writtenLabels;
    for (int i : markedFirst) {
        if (labels[size_t(i)].empty() || !(i % stride == 0 || i == mark || i == n - 1)) continue;
        if (write(labelRow, i == mark ? Role::markedLabel : Role::label, cut(labels[size_t(i)], room), x(i), 0, width, height - 5)) {
            writtenLabels.insert(i);
        }
    }

    for (int i = 0; i < n; i++) {
        double v = values[size_t(i)];
        char buf[40];
        snprintf(buf, sizeof buf, "%.2e", v);
        const std::string& label = labels[size_t(i)];
        bool full = label.empty() || (writtenLabels.count(i) && double(span(points(label)) * TEXT_LETTER) <= room * 100);
        p.whole = p.whole && valued[size_t(i)] && strtod(buf, nullptr) == v && full;
    }
    return p;
}

/// Text standing on a baseline at `x`, as an SVG `text` stands with its `text-anchor`.
void stand(const Pen& pen, const Writing& w, const Setting& t, Color color) {
    TextAttributes a = attributes(t, color, pen.k);
    float wide = widthOf(w.text, t, pen.k);
    float left = w.anchor < 0 ? w.x : w.anchor > 0 ? w.x - wide : w.x - wide / 2;
    pen.ctx.drawText(w.text, CGPoint{left * pen.k, (w.baseline - t.lead) * pen.k + a.font.metrics().descent}, a, INFINITY, 1);
}

/// The plot with its top-left at (x, y) px. `look.fill` is the face it is drawn on, which a value's halo
/// takes, so a gridline under a value stops short of it.
void paint(const Pen& pen, const Plot& p, float x, float y, const Look& look) {
    Canvas& ctx = pen.ctx;
    float k = pen.k;
    auto at = [&](float px, float py) { return CGPoint{(x + px) * k, (y + py) * k}; };
    for (const Plot::Rule& r : p.rules) {
        ctx.setFillColor(r.axis ? palette::line2 : palette::line);
        ctx.fill(pen.px(x + p.left, y + r.y - 0.5f, p.width - p.right - p.left, 1));
    }
    ctx.setLineCap(Canvas::LineCap::butt);
    if (p.guide) {
        auto [gx, from, to] = *p.guide;
        ctx.setStrokeColor(palette::line2);
        ctx.setLineWidth(k);
        ctx.setLineDash(0, {2 * k, 3 * k});
        ctx.move(at(gx, from));
        ctx.addLine(at(gx, to));
        ctx.strokePath();
        ctx.setLineDash(0, {});
    }
    if (!p.line.empty()) {
        ctx.setStrokeColor(palette::bar);
        ctx.setLineWidth(2 * k);
        ctx.setLineCap(Canvas::LineCap::round);
        ctx.setLineJoin(Canvas::LineJoin::round);
        ctx.move(at(p.line[0].x, p.line[0].y));
        for (size_t i = 1; i < p.line.size(); i++) ctx.addLine(at(p.line[i].x, p.line[i].y));
        ctx.strokePath();
    }
    for (const Plot::Bar& b : p.bars) {
        ctx.setFillColor(b.marked ? look.accent : palette::bar);
        pen.rounded(pen.px(x + b.x, y + b.y, b.width, b.height), 2 * k);
        ctx.fillPath();
    }
    for (const Plot::Dot& d : p.dots) {
        float r = d.marked ? 4.5f : 2.5f;
        CGRect disc{(x + d.at.x - r) * k, (y + d.at.y - r) * k, 2 * r * k, 2 * r * k};
        ctx.setFillColor(d.marked ? look.accent : palette::ink);
        ctx.fillEllipse(disc);
        if (!d.marked) continue;
        ctx.setStrokeColor(look.accent);
        ctx.setLineWidth(2 * k);
        ctx.strokeEllipse(disc);
    }
    for (Writing w : p.writings) {
        Setting t = setting::text;
        Color color = look.ink2;
        switch (w.role) {
        case Role::tick: color = look.ink3; break;
        case Role::markedValue: t.weight = Font::Weight::bold; [[fallthrough]];
        case Role::markedLabel: color = palette::ink; break;
        default: break;
        }
        w.x += x;
        w.baseline += y;
        if (w.role == Role::value || w.role == Role::markedValue) {
            // `paint-order: stroke` with a 4 px stroke of the face: a halo round the words.
            for (int i = 0; i < 8; i++) {
                Writing halo = w;
                halo.x += 2 * std::cos(float(i) * float(M_PI) / 4);
                halo.baseline += 2 * std::sin(float(i) * float(M_PI) / 4);
                stand(pen, halo, t, look.fill);
            }
        }
        stand(pen, w, t, color);
    }
}

Footprint size(const Item&, const Json& props) { return {WIDTH, FRAME + TITLE + (text(props["unit"]).empty() ? 0 : TEXT) + 8 + PLOT}; }

void draw(const Pen& pen, const Look& look, const Item& item, const Json& props, float width, float) {
    float x = 16, column = width - 32, y = 14;
    pen.words(item.titleOrUntitled(), x, y, column, 1, setting::title, palette::ink);
    y += TITLE;
    if (std::string unit = text(props["unit"]); !unit.empty()) {
        pen.words(unit, x, y, column, 1, setting::text, look.ink3);
        y += TEXT;
    }
    paint(pen, plot(props, WIDTH - SIDES, PLOT, false, item.words), x, y + 8, look);
}

/// `.detail-chart`: the plot larger, every value that fits written, and when the plot had to thin, cut
/// or round anything, a table of every label with its full value.
void detail(Sheet& sheet, const Item& item, const Json& props) {
    constexpr float W = 324, H = 200;
    std::string unit = text(props["unit"]);
    Plot p = plot(props, W, H, true, item.words);
    float inner = Sheet::width - 24, scale = inner / W, k = sheet.k;
    float unitTall = heightOf(unit, inner, 0, setting::text, k);

    struct Line {
        std::string label, value;
        bool marked;
        float tall;
    };
    std::vector<Line> table;
    float valueWidth = 0, tableTall = 0;
    if (!p.whole) {
        Series s = series(props);
        Setting bold = setting::text;
        bold.weight = Font::Weight::bold;
        for (size_t i = 0; i < s.values.size(); i++) {
            bool marked = int(i) == s.mark;
            Line row{s.labels[i].empty() ? std::to_string(i + 1) : s.labels[i], exact(s.values[i]), marked, 0};
            valueWidth = std::max(valueWidth, std::ceil(widthOf(row.value, marked ? bold : setting::text, k)));
            table.push_back(row);
        }
        for (Line& row : table) {
            Setting t = row.marked ? bold : setting::text;
            row.tall = std::max(float(TEXT), heightOf(row.label, inner - valueWidth - 14 - (row.marked ? 14 : 0), 0, t, k));
            tableTall += 1 + 4 + row.tall + 4;
        }
    }
    float tall = 12 + (unit.empty() ? 0 : unitTall + 6) + H * scale + (table.empty() ? 0 : 12 + tableTall) + 12;
    // A page may end under the plot and between any two rows of the values, never inside one.
    std::vector<float> breaks;
    float row = 12 + (unit.empty() ? 0 : unitTall + 6) + H * scale + 12;
    for (const Line& line : table) {
        breaks.push_back(row);
        row += 1 + 4 + line.tall + 4;
    }
    Look look = sheet.look;
    look.fill = palette::sunk;
    look.ink2 = palette::ink2;
    look.ink3 = palette::ink3;
    sheet.part(tall, [=](const Pen& pen, float y) {
        box(pen, Sheet::left, y, Sheet::width, tall, palette::sunk, std::nullopt);
        float x = Sheet::left + 12, top = y + 12;
        if (!unit.empty()) {
            pen.words(unit, x, top, inner, 0, setting::text, palette::ink3);
            top += unitTall + 6;
        }
        paint(Pen{pen.ctx, pen.k * scale}, p, x / scale, top / scale, look);
        top += H * scale + 12;
        for (const Line& row : table) {
            pen.ctx.setFillColor(palette::line);
            pen.ctx.fill(pen.px(x, top, inner, 1));
            Setting t = setting::text;
            if (row.marked) t.weight = Font::Weight::bold;
            Color ink = row.marked ? palette::ink : palette::ink2;
            float indent = 0;
            if (row.marked) {
                FontMetrics m = attributes(t, ink, pen.k).font.metrics();
                float baseline = top + 5 + (TEXT - (m.ascent + m.descent) / pen.k) / 2 + m.ascent / pen.k;
                pen.ctx.setFillColor(look.accent);
                pen.rounded(pen.px(x, baseline - 7, 7, 7), 2 * pen.k);
                pen.ctx.fillPath();
                indent = 14;
            }
            pen.words(row.label, x + indent, top + 5, inner - valueWidth - 14 - indent, 0, t, ink);
            float wide = pen.width(row.value, t);
            pen.words(row.value, x + inner - wide, top + 5, wide + 1, 1, t, palette::ink);
            top += 1 + 4 + row.tall + 4;
        }
    }, breaks);
    if (!unit.empty()) sheet.said.push_back(unit);
    for (const Writing& w : p.writings) sheet.said.push_back(w.text);
    for (const Line& row : table) {
        sheet.said.push_back(row.label);
        sheet.said.push_back(row.value);
    }
}

Kind make() {
    Kind k{"chart", size, {}, draw, detail};
    k.opens = Kind::Opens::chart;
    return k;
}

const Kind kind = make();
const Registered registered{kind};

}  // namespace

/// shared.js's `cut`: the string, or as much of its start as fits `room` px with an ellipsis. A mark
/// that takes no room stays with the letter before it.
std::string cut(const std::string& s, double room) {
    Text str = points(s);
    if (double(span(str) * TEXT_LETTER) <= room * 100) return s;
    double budget = room * 100 - double(span(U"…") * TEXT_LETTER);
    std::vector<Text> parts;
    bool joined = false;
    for (char32_t c : str) {
        if (!parts.empty() && (joined || span(Text(1, c)) == 0)) parts.back() += c;
        else parts.push_back(Text(1, c));
        joined = c == 0x200d;
    }
    double used = 0;
    Text kept;
    for (const Text& part : parts) {
        used += double(span(part) * TEXT_LETTER);
        if (used > budget && !kept.empty()) break;
        kept += part;
    }
    while (!kept.empty() && isSpace(kept.back())) kept.pop_back();
    return utf8(kept) + "…";
}

}  // namespace cards
