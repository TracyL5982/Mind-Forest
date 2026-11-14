// components/steps.js: numbers down a rail.
#include <algorithm>

#include "rows.h"

namespace cards {

namespace {

constexpr int WIDTH = 256;
constexpr int SHOWN = 5;
constexpr int ROW = 20;
constexpr int GAP = 8;
/// `.step-n`: its figure, 12.5 px in a line of its own size, set in the middle of the 20 px disc.
constexpr Setting NUMBER{12.5f, ROW, Font::Weight::semibold};

/// `String(step)`.
std::vector<std::string> stepsOf(const Json& props) {
    std::vector<std::string> out;
    for (const Json& step : props["steps"].array()) out.push_back(step.isString() ? step.string() : step.dump());
    return out;
}

Footprint size(const Item&, const Json& props) {
    int n = int(props["steps"].array().size()), rows = std::min(n, SHOWN);
    return {WIDTH, FRAME + TITLE + (rows ? 10 + rows * ROW + (rows - 1) * GAP : 0) + (n > SHOWN ? 8 + TEXT : 0)};
}

/// `.step-n` at (x, y), and the rail up to the step before it.
void number(const Pen& pen, Color accent, int i, float x, float y) {
    if (i > 0) {
        pen.ctx.setFillColor(accent.withAlphaComponent(0.45f));
        pen.ctx.fill(pen.px(x + 9.5f, y - GAP, 1, GAP));
    }
    pen.ctx.setFillColor(accent.withAlphaComponent(0.16f));
    pen.ctx.fillEllipse(pen.px(x, y, ROW, ROW));
    std::string n = std::to_string(i + 1);
    float w = pen.width(n, NUMBER);
    pen.words(n, x + (ROW - w) / 2, y, w + 1, 1, NUMBER, accent);
}

void draw(const Pen& pen, const Look& look, const Item& item, const Json& props, float width, float body) {
    std::vector<std::string> steps = stepsOf(props);
    float x = 16, column = width - 32, y = 14;
    pen.words(item.titleOrUntitled(), x, y, column, 1, setting::title, palette::ink);
    y += TITLE + 10;
    for (int i = 0; i < std::min(int(steps.size()), SHOWN); i++) {
        number(pen, look.accent, i, x, y);
        pen.words(steps[size_t(i)], x + ROW + 10, y + (ROW - TEXT) / 2.f, column - ROW - 10, 1, setting::text, palette::ink);
        y += ROW + GAP;
    }
    if (int(steps.size()) > SHOWN) foot(pen, item.words, int(steps.size()) - SHOWN, body, column, look.ink3);
}

/// `.steps.is-full`: every step whole, at 14 px on 20 px lines, its number at its first line.
void detail(Sheet& sheet, const Item&, const Json& props) {
    constexpr Setting line{14, 20};
    std::vector<std::string> steps = stepsOf(props);
    float column = Sheet::width - ROW - 10;
    std::vector<float> rows;
    float tall = 4;
    for (const std::string& step : steps) {
        rows.push_back(std::max(float(ROW), heightOf(step, column, 0, line, sheet.k)));
        tall += rows.back() + (rows.size() > 1 ? GAP : 0);
    }
    Color accent = sheet.look.accent;
    sheet.part(tall, [=](const Pen& pen, float y) {
        y += 4;
        for (size_t i = 0; i < steps.size(); i++) {
            number(pen, accent, int(i), Sheet::left, y);
            pen.words(steps[i], Sheet::left + ROW + 10, y, column, 0, line, palette::ink);
            y += rows[i] + GAP;
        }
    });
    for (const std::string& step : steps) sheet.said.push_back(step);
}

const Kind kind{"steps", size, {}, draw, detail};
const Registered registered{kind};

}  // namespace

}  // namespace cards
