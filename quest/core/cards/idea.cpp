// components/idea.js: a thought set large under a spark, and nothing else.
#include <algorithm>

#include "face.h"
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

/// A spark, then the thought as a figure: two lines at the largest size, three at the middle or the smallest, else the cue.
void lay(Col& c, const Item& item, const Json&) {
    std::string thought = item.titleOrUntitled();
    Text t = points(thought);
    if (c.pen) {
        const Pen& pen = *c.pen;
        const CGPoint spark[] = {{7, .6f}, {8.5f, 5.5f}, {13.4f, 7}, {8.5f, 8.5f}, {7, 13.4f}, {5.5f, 8.5f}, {.6f, 7}, {5.5f, 5.5f}};
        pen.ctx.setFillColor(c.look.accent);
        for (const CGPoint& s : spark) {
            CGPoint at{(c.x + s.x) * pen.k, (c.y + s.y) * pen.k};
            if (&s == spark) pen.ctx.move(at); else pen.ctx.addLine(at);
        }
        pen.ctx.closePath();
        pen.ctx.fillPath();
    }
    c.gap(MARK);
    const Figure* size = &SMALLEST;
    int lines = wrap(t, face::COL, LARGEST.letter, 3);
    if (lines <= 2) size = &LARGEST;
    else if ((lines = wrap(t, face::COL, MIDDLE.letter, 4)) <= 3) size = &MIDDLE;
    else lines = wrap(t, face::COL, SMALLEST.letter, 4);
    if (lines > 3) {
        lines = std::min(3, int(std::floor((c.room() - face::CUE) / float(size->lineHeight))));
        c.more = true;
    }
    if (c.pen) {
        c.say(thought, figureSetting(*size), lines, c.x, c.y, c.width, palette::ink);
    }
    c.gap(float(lines * size->lineHeight));
    if (c.more) c.cue(cueMore(c.words));
}

Footprint size(const Item& item, const Json& props) {
    return footprint(item, [&](Col& c) { lay(c, item, props); });
}

void draw(const Pen& pen, const Look& look, const Item& item, const Json& props, float, float) {
    drawFace(pen, look, item, [&](Col& c) { lay(c, item, props); });
}




void detail(Sheet&, const Item&, const Json&) {}

const Kind kind{"idea", size, {}, draw, detail};
const Registered registered{kind};

}  // namespace

}  // namespace cards
