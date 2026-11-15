// components/proscons.js: the points for and against, side by side under their names, with a rule
// between them. A plus or a minus marks each point, so the sides are told apart without colour.
#include <algorithm>
#include <array>

#include "face.h"
#include "kind.h"
#include "text.h"

namespace cards {

namespace {

constexpr int WIDTH = 320;
constexpr int COLUMN = WIDTH - SIDES;
/// The room between the two sides, with the rule that parts them.
constexpr int BETWEEN = 17;
/// A plus or a minus and the gap after it.
constexpr int MARK = 16;
constexpr int SIDE = (COLUMN - BETWEEN) / 2 - MARK;
constexpr size_t SHOWN = 4;
constexpr int GAP = 5;
/// The line that names a side, and the gap under it.
constexpr int HEAD = TEXT + 4;

/// What a side is: its prop, its name, and its mark in a 10 px box, stroked in the card's colour for the points for.
struct Way {
    const char* key;
    Fixed name;
    std::vector<std::vector<CGPoint>> mark;
    bool accent;
};
const std::array<Way, 2>& ways() {
    static const std::array<Way, 2> all{{{"pros", fixed::pros, {{{5, 1.5f}, {5, 8.5f}}, {{1.5f, 5}, {8.5f, 5}}}, true},
                                         {"cons", fixed::cons, {{{1.5f, 5}, {8.5f, 5}}}, false}}};
    return all;
}

/// A side's points that say something, and how the card shows them: the first few, each on its lines.
struct Side {
    std::vector<std::string> points;
    std::vector<int> lines;
    int rest = 0, height = HEAD;
};

Side sideOf(const Json& given) {
    Side side;
    for (const Json& point : given.array()) {
        Text said = trim(points(text(point)));
        if (said.empty()) continue;
        if (side.lines.size() < SHOWN) side.lines.push_back(wrap(said, SIDE, TEXT_LETTER, 3));
        side.points.push_back(utf8(said));
    }
    side.rest = int(side.points.size() - side.lines.size());
    for (int lines : side.lines) side.height += lines * TEXT;
    side.height += std::max(0, int(side.lines.size()) - 1) * GAP + (side.rest ? GAP + TEXT : 0);
    return side;
}

struct Plan {
    std::array<Side, 2> sides;
    int titleLines;
};

Plan plan(const Item& item, const Json& props) {
    return {{sideOf(props[ways()[0].key]), sideOf(props[ways()[1].key])}, wrap(points(item.titleOrUntitled()), COLUMN, TITLE_LETTER, 2)};
}

/// A point: its mark, then its words beside it.
void point(const Pen& pen, const Way& way, Color accent, Color ink2, const std::string& said, float x, float y, float markDrop, float width,
           int lines, const Setting& t) {
    strokes(pen, x, y + markDrop, way.mark, 1.6f, way.accent ? accent : ink2);
    pen.words(said, x + MARK, y, width - MARK, lines, t, palette::ink);
}


/// The title, the first point of each side when it is whole on one line, and the cue that counts them.
void lay(Col& c, const Item& item, const Json& props) {
    Plan p = plan(item, props);
    c.lines(item.titleOrUntitled(), Measure::title, 2, palette::ink, 10 + face::BODY + 5 + face::BODY + face::CUE);
    c.gap(10);
    const int column = face::COL - 20;
    bool first = true;
    for (size_t s = 0; s < 2; s++) {
        const Side& side = p.sides[s];
        if (side.points.empty() || counted(side.points[0], column, Measure::body) > 1) continue;
        if (!first) c.gap(5);
        first = false;
        if (c.pen) {
            strokes(*c.pen, c.x, c.y + 6, ways()[s].mark, 1.6f, ways()[s].accent ? c.look.accent : palette::ink2);
            c.say(side.points[0], setting::faceBody, 1, c.x + 20, c.y, float(column), palette::ink);
        }
        c.gap(face::BODY);
    }
    c.more = true;
    c.cue(cueForAgainst(c.words, int(p.sides[0].points.size()), int(p.sides[1].points.size())));
}

Footprint size(const Item& item, const Json& props) {
    return footprint(item, [&](Col& c) { lay(c, item, props); });
}

void draw(const Pen& pen, const Look& look, const Item& item, const Json& props, float, float) {
    drawFace(pen, look, item, [&](Col& c) { lay(c, item, props); });
}



/// `.detail-proscons`: every point whole, one side under the other.
void detail(Sheet& sheet, const Item& item, const Json& props) {
    constexpr Setting open{15, 21, Font::Weight::medium};
    Plan p = plan(item, props);
    std::array<std::vector<float>, 2> talls;
    float tall = 14;
    for (size_t s = 0; s < 2; s++) {
        tall += HEAD;
        for (const std::string& said : p.sides[s].points) {
            talls[s].push_back(std::max(15.f, heightOf(said, Sheet::width - MARK, 0, open, sheet.k)));
            tall += talls[s].back();
        }
        tall += float(std::max(0, int(talls[s].size()) - 1) * 7);
        sheet.said.push_back(ways()[s].name.in(item.words));
        sheet.said.insert(sheet.said.end(), p.sides[s].points.begin(), p.sides[s].points.end());
    }
    Words words = item.words;
    Color accent = sheet.look.accent;
    sheet.part(tall, [=](const Pen& pen, float y) {
        for (size_t s = 0; s < 2; s++) {
            const Way& way = ways()[s];
            label(pen, way.name.in(words), Sheet::left, y, palette::ink2);
            y += HEAD;
            for (size_t i = 0; i < talls[s].size(); i++) {
                point(pen, way, accent, palette::ink2, p.sides[s].points[i], Sheet::left, y, 5, Sheet::width, 0, open);
                y += talls[s][i] + 7;
            }
            y += 14 - (talls[s].empty() ? 0 : 7);
        }
    });
}

const Kind kind{"proscons", size, {}, draw, detail};
const Registered registered{kind};

}  // namespace

}  // namespace cards
