// components/definition.js: a headword over a short rule, and its meaning in an upright serif, as a
// dictionary sets them.
#include "face.h"
#include "figures.h"

namespace cards {

namespace {

constexpr int WIDTH = 272;
constexpr int COLUMN = WIDTH - SIDES;
/// The meaning is counted in the whole line box, as a passage is.
constexpr int LINE = WIDTH - PADDING;
/// `.definition-text`: the serif, upright.
constexpr Setting MEANING{16, 21, Font::Weight::regular, true};

struct Plan {
    std::string term, meaning;
    /// The headword is set in a figure's middle size while it fits on one line, and in the title's size
    /// on up to two when it does not.
    bool large = true;
    int termLines = 1, termHeight = 0, lines = 1;
};

Plan plan(const Json& props) {
    Plan p;
    p.term = utf8(trim(points(text(props["term"]))));
    p.meaning = utf8(trim(points(text(props["definition"]))));
    p.large = figureNeed(points(p.term), MIDDLE) <= COLUMN * 100;
    p.termLines = p.large ? 1 : wrap(points(p.term), COLUMN, TITLE_LETTER, 2);
    p.termHeight = p.large ? MIDDLE.lineHeight : p.termLines * TITLE;
    p.lines = wrap(points(p.meaning), LINE, PASSAGE_LETTER, 6);
    return p;
}

/// The headword at (x, y) px, `lines` 0 for all of it; returns how tall it draws.
float headword(const Pen& pen, const Plan& p, float x, float y, float width, int lines) {
    if (p.large) {
        figure(pen, p.term, x, y, width, 0, MIDDLE, palette::ink);
        return figureHeight(p.term, width, 0, MIDDLE, pen.k);
    }
    pen.words(p.term, x, y, width, lines, setting::title, palette::ink);
    return heightOf(p.term, width, lines, setting::title, pen.k);
}


/// The term as a figure, the meaning upright in the serif in whole lines, and the cue.
void lay(Col& c, const Item&, const Json& props) {
    Plan p = plan(props);
    c.gap(10);
    Text term = points(p.term);
    bool large = figureNeed(term, MIDDLE) <= face::COL * 100;
    int termNeed = large ? 1 : wrap(term, face::COL, SMALLEST.letter, 3), termLines = std::min(2, termNeed);
    const Figure& size = large ? MIDDLE : SMALLEST;
    // A term longer than two lines shows its first two, and the cue.
    if (termNeed > 2) c.more = true;
    if (c.pen) c.heldBack = figure(*c.pen, p.term, c.x, c.y, c.width, termLines, size, palette::ink) || c.heldBack;
    c.gap(float(termLines * size.lineHeight));
    c.lines(p.meaning, Measure::passage, 99, c.look.ink2, 0, -1, face::W - 32);
    if (c.more) c.cue(cueMore(c.words));
}

Footprint size(const Item& item, const Json& props) {
    return footprint(item, [&](Col& c) { lay(c, item, props); });
}

void draw(const Pen& pen, const Look& look, const Item& item, const Json& props, float, float) {
    drawFace(pen, look, item, [&](Col& c) { lay(c, item, props); });
}



/// `.detail-definition`: the meaning whole, under the term when the opened card's own title is not
/// already the term.
void detail(Sheet& sheet, const Item& item, const Json& props) {
    constexpr Setting whole{17, 24.65f, Font::Weight::regular, true};
    Plan p = plan(props);
    bool named = p.term == item.title;
    float k = sheet.k;
    float termTall = named ? 0
                     : p.large ? figureHeight(p.term, Sheet::width, 0, MIDDLE, k)
                               : heightOf(p.term, Sheet::width, 0, setting::title, k);
    float tall = (named ? 0 : termTall + RULE) + heightOf(p.meaning, Sheet::width, 0, whole, k);
    Color accent = sheet.look.accent;
    sheet.part(tall, [=](const Pen& pen, float y) {
        if (!named) {
            headword(pen, p, Sheet::left, y, Sheet::width, 0);
            rule(pen, Sheet::left, y + termTall, accent);
            y += termTall + RULE;
        }
        pen.words(p.meaning, Sheet::left, y, Sheet::width, 0, whole, palette::ink);
    });
    if (!named && !p.term.empty()) sheet.said.push_back(p.term);
    if (!p.meaning.empty()) sheet.said.push_back(p.meaning);
}

const Kind kind{"definition", size, {}, draw, detail};
const Registered registered{kind};

}  // namespace

}  // namespace cards
