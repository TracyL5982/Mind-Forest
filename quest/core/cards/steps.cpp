// components/steps.js: numbers down a rail.
#include <algorithm>

#include "face.h"
#include "rows.h"

namespace cards {

namespace {

constexpr int WIDTH = 256;
constexpr int SHOWN = 5;
constexpr int ROW = 20;
constexpr int GAP = 8;
/// `.step-n`: its figure, 12.5 px in a line of its own size, set in the middle of the 20 px disc.
constexpr Setting NUMBER{13.5f, ROW, Font::Weight::semibold};

/// `String(step)`.
std::vector<std::string> stepsOf(const Json& props) {
    std::vector<std::string> out;
    for (const Json& step : props["steps"].array()) out.push_back(step.isString() ? step.string() : step.dump());
    return out;
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


/// The title, then numbered steps down a rail, each whole: two of one line, or the first in two, and the cue.
void lay(Col& c, const Item& item, const Json& props) {
    std::vector<std::string> steps = stepsOf(props);
    c.lines(item.titleOrUntitled(), Measure::title, 2, palette::ink, steps.empty() ? 0 : 10 + face::BODY);
    bool open = c.above(props);
    c.gap(10);
    const int column = face::COL - 32;
    size_t i = 0;
    for (; open && i < steps.size(); i++) {
        int need = counted(steps[i], column, Measure::body);
        int shown = std::min(need, i == 0 ? 2 : 1);
        if (i > 0 && need > 1) break;
        bool after = i + 1 < steps.size() || need > shown;
        float tall = (i > 0 ? 8.f : 0.f) + float(shown * face::BODY);
        if (tall + (after ? face::CUE : 0) > c.room()) break;
        if (need > shown) c.more = true;
        if (i > 0) c.gap(8);
        if (c.pen) {
            number(*c.pen, c.look.accent, int(i), c.x, c.y);
            c.say(steps[i], setting::faceBody, shown, c.x + 32, c.y, float(column), palette::ink);
        }
        c.gap(float(shown * face::BODY));
    }
    if (i < steps.size()) c.more = true;
    if (c.more) c.cue(i < steps.size() ? cueCount(c.words, int(steps.size() - i)) : cueMore(c.words));
}

Footprint size(const Item& item, const Json& props) {
    return footprint(item, [&](Col& c) { lay(c, item, props); });
}

void draw(const Pen& pen, const Look& look, const Item& item, const Json& props, float, float) {
    drawFace(pen, look, item, [&](Col& c) { lay(c, item, props); });
}



/// `.steps.is-full`: every step whole, at 14 px on 20 px lines, its number at its first line.
void detail(Sheet& sheet, const Item&, const Json& props) {
    constexpr Setting line{15, 21, Font::Weight::medium};
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
