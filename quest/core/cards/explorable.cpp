// components/explorable.js, its small face: under a mark that says it can be explored, the title, what
// the controls change in their first state, and a row for each control as it stands. The opened card
// writes the states and the result out; its working controls are not drawn on the Quest yet.
#include <algorithm>
#include <cmath>
#include <map>

#include "figures.h"

namespace cards {

namespace {

constexpr int WIDTH = 288;
constexpr int COLUMN = WIDTH - SIDES;
/// The mark that says the card can be explored, and the room under it.
constexpr int MARK = TEXT + 4;
/// The room above what the controls change, and above each control's row.
constexpr int OUT_GAP = 10;
constexpr int ROW_GAP = 8;
/// A control's row on the card: its states as pills, or a slider's reading beside its track.
constexpr int ROW = 28;
constexpr int PILL_GAP = 4;
constexpr int PILL_PAD = 12;
constexpr int TRACK = 96;
/// Each state's text on the card, and the room between two controls' texts.
constexpr int STATE_LINES = 4;
constexpr int TEXT_GAP = 6;
/// A result's label, the room under its figure, and the curve under that.
constexpr int LABEL_LINES = 2;
constexpr int FIGURE_GAP = 2;
constexpr int PLOT = 96;
constexpr int PLOT_GAP = 8;
constexpr int VALUE_LINES = 3;

struct State {
    std::string name, text;
};
struct Control {
    enum class Kind { toggle, segmented, slider } kind;
    std::string name, label, unit;
    std::vector<State> states;
    double min = 0, max = 0, step = 0;
    std::vector<double> values;
};
struct Output {
    enum class Kind { text, figure, chart } kind = Kind::text;
    std::string label, unit;
    Json formula;
    std::vector<double> values;
};

std::vector<double> numbers(const Json& value) {
    std::vector<double> out;
    for (const Json& n : value.array()) {
        if (n.isNumber() && std::isfinite(n.number())) out.push_back(n.number());
    }
    return out;
}

std::vector<Control> controlsOf(const Json& props) {
    std::vector<Control> out;
    for (const Json& c : props["controls"].array()) {
        if (!c.isObject()) continue;
        std::string kind = text(c["kind"]);
        Control control{Control::Kind::toggle};
        control.label = trimmed(c["label"]);
        if (kind == "toggle" || kind == "segmented") {
            control.kind = kind == "toggle" ? Control::Kind::toggle : Control::Kind::segmented;
            for (const Json& s : c["states"].array()) {
                if (s.isObject()) control.states.push_back({trimmed(s["name"]), trimmed(s["text"])});
            }
            if (control.states.size() >= 2) out.push_back(control);
        } else if (kind == "slider") {
            control.kind = Control::Kind::slider;
            control.name = text(c["name"]);
            control.unit = trimmed(c["unit"]);
            control.values = numbers(c["values"]);
            control.min = number(c["min"]);
            control.max = number(c["max"]);
            control.step = number(c["step"]);
            if (!control.values.empty() && control.min < control.max && control.step > 0) out.push_back(control);
        }
    }
    return out;
}

Output outputOf(const Json& props) {
    const Json& o = props["output"];
    std::string kind = text(o["kind"]);
    Output out;
    if (kind != "figure" && kind != "chart") return out;
    out.kind = kind == "figure" ? Output::Kind::figure : Output::Kind::chart;
    out.label = trimmed(o["label"]);
    out.unit = trimmed(o["unit"]);
    out.formula = o["formula"];
    out.values = numbers(o["values"]);
    return out;
}

/// A formula's value where its quantities have these values, or nothing where it has none.
std::optional<double> evaluate(const Json& program, const std::map<std::string, double>& values) {
    static const std::map<std::string, int> arity{{"+", 2}, {"-", 2}, {"*", 2}, {"/", 2}, {"^", 2}, {"neg", 1}, {"min", 2},
                                                  {"max", 2}, {"round", 1}, {"sqrt", 1}, {"exp", 1}, {"ln", 1}, {"atan", 1}};
    std::vector<double> stack;
    for (const Json& token : program.array()) {
        double value = NAN;
        if (token.isNumber()) {
            value = token.number();
        } else if (token.isString() && arity.count(token.string())) {
            const std::string& op = token.string();
            size_t n = size_t(arity.at(op));
            if (stack.size() >= n) {
                double a = stack[stack.size() - n], b = n == 2 ? stack.back() : 0;
                stack.resize(stack.size() - n);
                if (op == "+") value = a + b;
                else if (op == "-") value = a - b;
                else if (op == "*") value = a * b;
                else if (op == "/") value = b == 0 ? NAN : a / b;
                else if (op == "^") value = std::pow(a, b);
                else if (op == "neg") value = -a;
                else if (op == "min") value = std::min(a, b);
                else if (op == "max") value = std::max(a, b);
                else if (op == "round") value = std::floor(a + 0.5);
                else if (op == "sqrt") value = std::sqrt(a);
                else if (op == "exp") value = std::exp(a);
                else if (op == "ln") value = a > 0 ? std::log(a) : NAN;
                else if (op == "atan") value = std::atan(a);
            } else {
                stack.clear();
            }
        } else if (token.isString() && values.count(token.string())) {
            value = values.at(token.string());
        }
        if (!std::isfinite(value)) return std::nullopt;
        stack.push_back(value);
    }
    return stack.size() == 1 ? std::optional(stack[0]) : std::nullopt;
}

/// How many decimals JavaScript's `String(Math.abs(value))` writes, at most six.
int decimalsOf(double value) {
    char buf[40];
    for (int precision = 1; precision <= 17; precision++) {
        snprintf(buf, sizeof buf, "%.*g", precision, std::fabs(value));
        if (strtod(buf, nullptr) == std::fabs(value)) break;
    }
    std::string s = buf;
    if (size_t e = s.find('e'); e != std::string::npos) s.resize(e);
    size_t dot = s.find('.');
    return dot == std::string::npos ? 0 : std::min(6, int(s.size() - dot - 1));
}

bool startsUnspaced(const std::string& unit) {
    Text t = points(unit);
    if (t.empty()) return false;
    char32_t c = t[0];
    bool cjk = (c >= 0x3040 && c <= 0x30ff) || (c >= 0x3400 && c <= 0x9fff) || (c >= 0xac00 && c <= 0xd7af);
    bool letter = (c >= '0' && c <= '9') || (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= 0xc0 && !isSpace(c) && c != 0xd7 && c != 0xf7 &&
                                                                                                   !(c >= 0x2000 && c <= 0x2bff));
    return cjk || !letter;
}

/// A number with `decimals` places and a comma between thousands, and its unit after a space when the unit starts with a letter.
std::string writtenOut(double value, int decimals, const std::string& unit) {
    std::string number = written(fixed(value, decimals), 4);
    size_t dot = number.find('.');
    int have = dot == std::string::npos ? 0 : int(number.size() - dot - 1);
    if (decimals > have) number += (have == 0 ? "." : "") + std::string(size_t(decimals - have), '0');
    if (unit.empty()) return number;
    return startsUnspaced(unit) ? number + unit : number + " " + unit;
}

std::string reading(const Control& slider, double value) { return writtenOut(value, decimalsOf(value), slider.unit); }

/// The result where every slider stands on its first stated value: the value the item states, or the formula's.
std::string shownAt(const std::vector<Control>& sliders, const Output& output) {
    if (!output.values.empty()) return writtenOut(output.values[0], decimalsOf(output.values[0]), output.unit);
    std::map<std::string, double> at;
    for (const Control& s : sliders) at[s.name] = s.values[0];
    std::optional<double> value = evaluate(output.formula, at);
    return value ? writtenOut(*value, 0, output.unit) : "\xE2\x80\x93";
}

struct Plan {
    std::vector<Control> controls;
    Output output;
    int titleLines = 1, height = 0;
    std::vector<std::pair<std::string, int>> texts;
    std::string shown;
    bool mid = true;
    int valueLines = 1, labelLines = 0;
};

Plan plan(const Item& item, const Json& props) {
    Plan p;
    std::vector<Control> all = controlsOf(props), sliders, switches;
    for (const Control& c : all) (c.kind == Control::Kind::slider ? sliders : switches).push_back(c);
    p.output = outputOf(props);
    p.titleLines = wrap(points(item.titleOrUntitled()), COLUMN, TITLE_LETTER, 2);
    if (p.output.kind == Output::Kind::text || sliders.empty()) {
        p.controls = switches;
        p.output = Output{};
        for (const Control& c : switches) {
            int lines = wrap(points(c.states[0].text), COLUMN, TEXT_LETTER, STATE_LINES);
            p.texts.push_back({c.states[0].text, lines});
            p.height += lines * TEXT;
        }
        p.height += TEXT_GAP * std::max(0, int(p.texts.size()) - 1);
        return p;
    }
    p.controls = sliders;
    p.shown = shownAt(sliders, p.output);
    p.mid = figureNeed(points(p.shown), MIDDLE) <= COLUMN * 100;
    p.valueLines = p.mid ? 1 : wrap(points(p.shown), COLUMN, SMALLEST.letter, VALUE_LINES);
    p.labelLines = p.output.label.empty() ? 0 : wrap(points(p.output.label), COLUMN, TEXT_LETTER, LABEL_LINES);
    p.height = p.valueLines * (p.mid ? MIDDLE : SMALLEST).lineHeight + FIGURE_GAP + p.labelLines * TEXT +
               (p.output.kind == Output::Kind::chart ? PLOT_GAP + PLOT : 0);
    return p;
}

Footprint size(const Item& item, const Json& props) {
    Plan p = plan(item, props);
    return {WIDTH, FRAME + MARK + p.titleLines * TITLE + OUT_GAP + p.height + int(p.controls.size()) * (ROW_GAP + ROW)};
}

/// The curve of the result across the first slider, with a dot at each stated value and a ring where it stands now.
void curve(const Pen& pen, const Look& look, const std::vector<Control>& sliders, const Output& output, float left0, float top0, float width, float height) {
    const Control& first = sliders.front();
    std::map<std::string, double> at;
    for (const Control& s : sliders) at[s.name] = s.values[0];
    int steps = int(std::min(std::round((first.max - first.min) / first.step), 120.0));
    std::vector<std::pair<double, double>> points;
    for (int n = 0; n <= steps; n++) {
        double x = first.min + (first.max - first.min) * n / std::max(1, steps);
        std::map<std::string, double> here = at;
        here[first.name] = x;
        if (std::optional<double> y = evaluate(output.formula, here)) points.push_back({x, *y});
    }
    double lo = 0, hi = -INFINITY;
    for (const auto& [x, y] : points) lo = std::min(lo, y), hi = std::max(hi, y);
    for (double v : output.values) lo = std::min(lo, v), hi = std::max(hi, v);
    if (!std::isfinite(hi)) hi = lo;
    const float left = 4, right = 4, top = 8, bottom = 20;
    auto X = [&](double v) { return left0 + left + float((width - left - right) * (v - first.min) / (first.max - first.min)); };
    auto Y = [&](double v) { return top0 + top + float((height - top - bottom) * (1 - (v - lo) / (hi - lo == 0 ? 1 : hi - lo))); };
    pen.ctx.setFillColor(palette::line2);
    pen.ctx.fill(pen.px(left0 + left, Y(lo), width - left - right, 1));
    pen.ctx.setStrokeColor(palette::bar);
    pen.ctx.setLineWidth(1.6f * pen.k);
    for (size_t i = 0; i < points.size(); i++) {
        CGPoint q{X(points[i].first) * pen.k, Y(points[i].second) * pen.k};
        if (i == 0) pen.ctx.move(q); else pen.ctx.addLine(q);
    }
    if (points.size() > 1) pen.ctx.strokePath();
    pen.ctx.setFillColor(palette::ink);
    for (size_t i = 0; i < first.values.size() && i < output.values.size(); i++) {
        pen.ctx.fillEllipse(pen.px(X(first.values[i]) - 2.5f, Y(output.values[i]) - 2.5f, 5, 5));
    }
    std::optional<double> now = evaluate(output.formula, at);
    pen.ctx.setFillColor(look.accent);
    float nx = X(first.values[0]), ny = now ? Y(std::clamp(*now, lo, hi)) : Y(lo);
    pen.ctx.fillEllipse(pen.px(nx - 4.5f, ny - 4.5f, 9, 9));
    std::string from = reading(first, first.min), to = reading(first, first.max);
    pen.words(from, left0 + left, top0 + height - 17, width / 2, 1, setting::text, look.ink3);
    float w = pen.width(to, setting::text);
    pen.words(to, left0 + width - right - w, top0 + height - 17, w + 1, 1, setting::text, look.ink3);
}

void draw(const Pen& pen, const Look& look, const Item& item, const Json& props, float width, float) {
    Plan p = plan(item, props);
    float x = 16, column = width - 32, y = 14;
    // `.explore-mark`: the glyph, then the word, in the text's line.
    pen.ctx.setStrokeColor(look.accent);
    pen.ctx.setLineWidth(1.4f * pen.k);
    pen.ctx.setLineCap(Canvas::LineCap::round);
    float gy = y + 1.5f;
    for (auto [x0, y0, x1, y1] : {std::array<float, 4>{1.5f, 4, 12.5f, 4}, {1.5f, 10, 12.5f, 10}, {4.5f, 2.2f, 4.5f, 5.8f}, {9.5f, 8.2f, 9.5f, 11.8f}}) {
        pen.ctx.move(CGPoint{(x + x0) * pen.k, (gy + y0) * pen.k});
        pen.ctx.addLine(CGPoint{(x + x1) * pen.k, (gy + y1) * pen.k});
        pen.ctx.strokePath();
    }
    label(pen, item.words.chinese ? "可探索" : "Explore", x + 20, y, look.ink2);
    y += MARK;
    pen.words(item.titleOrUntitled(), x, y, column, p.titleLines, setting::title, palette::ink);
    y += float(p.titleLines * TITLE + OUT_GAP);
    if (p.output.kind == Output::Kind::text) {
        for (const auto& [words, lines] : p.texts) {
            pen.words(words, x, y, column, lines, setting::text, palette::ink);
            y += float(lines * TEXT + TEXT_GAP);
        }
        y += p.texts.empty() ? 0 : -TEXT_GAP;
    } else {
        const Figure& size = p.mid ? MIDDLE : SMALLEST;
        figure(pen, p.shown, x, y, column, 0, size, palette::ink);
        y += float(p.valueLines * size.lineHeight + FIGURE_GAP);
        pen.words(p.output.label, x, y, column, p.labelLines, setting::text, look.ink2);
        y += float(p.labelLines * TEXT);
        if (p.output.kind == Output::Kind::chart) {
            curve(pen, look, p.controls, p.output, x, y + PLOT_GAP, column, PLOT);
            y += PLOT_GAP + PLOT;
        }
    }
    for (const Control& c : p.controls) {
        y += ROW_GAP;
        if (c.kind == Control::Kind::slider) {
            double share = (c.values[0] - c.min) / (c.max - c.min);
            std::string words = utf8(trim(points(c.label + " " + reading(c, c.values[0]))));
            pen.words(cut(words, COLUMN - TRACK - 8), x, y + (ROW - TEXT) / 2.f, column - TRACK - 8, 1, setting::text, look.ink2);
            float tx = x + column - TRACK;
            pen.ctx.setFillColor(palette::line2);
            pen.rounded(pen.px(tx, y + ROW / 2.f - 2, TRACK, 4), 2 * pen.k);
            pen.ctx.fillPath();
            pen.ctx.setFillColor(look.accent);
            float kx = tx + float(share) * TRACK;
            pen.ctx.fillEllipse(pen.px(kx - 6, y + ROW / 2.f - 6, 12, 12));
        } else {
            int n = int(c.states.size());
            float pill = std::floor((float(COLUMN) - PILL_GAP * float(n - 1)) / float(n));
            for (int i = 0; i < n; i++) {
                float left = x + float(i) * (pill + PILL_GAP);
                bool on = i == 0;
                CGRect r = pen.px(left + 0.5f, y + 0.5f, pill - 1, ROW - 1);
                if (on) {
                    pen.ctx.setFillColor(mix(look.accent, 0.2f, look.fill));
                    pen.rounded(r, 13.5f * pen.k);
                    pen.ctx.fillPath();
                }
                pen.ctx.setStrokeColor(on ? look.accent : palette::line2);
                pen.ctx.setLineWidth(pen.k);
                pen.rounded(r, 13.5f * pen.k);
                pen.ctx.strokePath();
                std::string name = cut(c.states[size_t(i)].name, pill - PILL_PAD);
                float w = pen.width(name, setting::text);
                pen.words(name, left + (pill - w) / 2, y + (ROW - TEXT) / 2.f, w + 1, 1, setting::text, on ? palette::ink : look.ink2);
            }
        }
        y += ROW;
    }
}

/// The opened card writes out what the controls change: each control's states with their words, or the
/// result where the sliders stand first, with each slider's reading.
void detail(Sheet& sheet, const Item& item, const Json& props) {
    Plan p = plan(item, props);
    if (p.output.kind == Output::Kind::text) {
        for (const Control& c : p.controls) {
            sheet.paragraph(c.label, setting::caption, palette::ink2);
            for (const State& s : c.states) sheet.paragraph(s.name.empty() ? s.text : s.name + ": " + s.text, setting::body, palette::ink);
        }
        return;
    }
    std::string result = p.output.label.empty() ? p.shown : p.shown + ", " + p.output.label;
    sheet.paragraph(result, setting::heading, palette::ink);
    for (const Control& c : p.controls) sheet.paragraph(utf8(trim(points(c.label + " " + reading(c, c.values[0])))), setting::body, palette::ink2);
}

const Kind kind{"explorable", size, {}, draw, detail};
const Registered registered{kind};

}  // namespace

}  // namespace cards
