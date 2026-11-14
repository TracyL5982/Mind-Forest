// components/idea.js: a thought set large under a spark, and nothing else.
#include <algorithm>

#include "figures.h"

namespace cards {

namespace {

constexpr int WIDTH = 272;
constexpr int COLUMN = WIDTH - SIDES;
/// The spark over the thought, and the gap under it.
constexpr int MARK = 22;

struct Plan {
    std::string thought;
    Figure size = SMALLEST;
    int lines = 1;
    bool cut = false;
};

/// The thought steps down as it grows: the largest size for up to two lines, the middle size for up to
/// four, then the smallest. A thought too long for five lines there is cut with an ellipsis.
Plan plan(const Item& item) {
    struct Step {
        Figure size;
        int most;
    };
    constexpr Step STEPS[] = {{LARGEST, 2}, {MIDDLE, 4}, {SMALLEST, 5}};
    Plan p;
    p.thought = item.titleOrUntitled();
    Text thought = points(p.thought);
    for (const Step& step : STEPS) {
        int lines = wrap(thought, COLUMN, step.size.letter, step.most + 1);
        p.size = step.size;
        p.lines = std::min(lines, step.most);
        p.cut = lines > step.most;
        if (!p.cut) break;
    }
    return p;
}

Footprint size(const Item& item, const Json&) {
    Plan p = plan(item);
    return {WIDTH, FRAME + MARK + p.lines * p.size.lineHeight};
}

void draw(const Pen& pen, const Look& look, const Item& item, const Json&, float width, float) {
    Plan p = plan(item);
    float x = 16, y = 14, column = width - 32;
    // M7 .6 8.5 5.5 13.4 7 8.5 8.5 7 13.4 5.5 8.5 .6 7 5.5 5.5Z
    const CGPoint spark[] = {{7, .6f}, {8.5f, 5.5f}, {13.4f, 7}, {8.5f, 8.5f}, {7, 13.4f}, {5.5f, 8.5f}, {.6f, 7}, {5.5f, 5.5f}};
    pen.ctx.setFillColor(look.accent);
    for (const CGPoint& c : spark) {
        CGPoint at{(x + c.x) * pen.k, (y + c.y) * pen.k};
        if (&c == spark) pen.ctx.move(at); else pen.ctx.addLine(at);
    }
    pen.ctx.closePath();
    pen.ctx.fillPath();
    // `text-wrap: balance`: the narrowest column that keeps the thought on as many lines.
    float tall = figureHeight(p.thought, column, 0, p.size, pen.k), lo = column / 4, hi = column;
    for (int i = 0; i < 10 && !p.cut; i++) {
        float mid = (lo + hi) / 2;
        (figureHeight(p.thought, mid, 0, p.size, pen.k) > tall ? lo : hi) = mid;
    }
    figure(pen, p.thought, x, y + MARK, p.cut ? column : hi + 0.5f, p.cut ? p.lines : 0, p.size, palette::ink);
}

void detail(Sheet&, const Item&, const Json&) {}

const Kind kind{"idea", size, {}, draw, detail};
const Registered registered{kind};

}  // namespace

}  // namespace cards
