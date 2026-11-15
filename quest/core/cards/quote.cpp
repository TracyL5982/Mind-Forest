// components/quote.js: a serif on a face washed with the tree's colour.
#include "face.h"
#include "kind.h"

namespace cards {

namespace {

constexpr int WIDTH = 288;
/// The quote's wider side padding and the border, and 1 px to spare.
constexpr int COLUMN = WIDTH - 41;
constexpr int MARK = 22;
constexpr const char* OPEN_QUOTE = "\xE2\x80\x9C";
/// A quote's `--ink-2`.
constexpr Color BY = palette::meta;
/// The host's serif stands its large mark higher in the line than a browser does.
constexpr float MARK_DROP = 4;

std::string words(const Item& item, const Json& props) {
    std::string given = text(props["text"]);
    return !given.empty() ? given : !item.text.empty() ? item.text : item.title;
}

int lines(const Item& item, const Json& props) { return fold(points(words(item, props)), COLUMN, QUOTE_LETTER, 5); }

/// `.quote-by`: a short rule, then who said it.
void by(const Pen& pen, const std::string& who, float x, float y, float column, int lines, float ruleDrop) {
    pen.ctx.setFillColor(BY);
    pen.ctx.fill(pen.px(x, y + ruleDrop, 14, 1));
    pen.words(who, x + 22, y, column - 22, lines, setting::text, BY);
}


/// The mark, the quotation upright in the serif, the speaker under a short rule, and the cue.
void lay(Col& c, const Item& item, const Json& props) {
    if (!c.above(props)) {
        c.cue(cueMore(c.words));
        return;
    }
    c.x = 20;
    c.width = face::W - 40;
    std::string said = words(item, props), who = text(props["by"]);
    // The mark stands only over at least one line of the words.
    if (float(MARK + face::BODY) + (who.empty() ? 0.f : 8.f + face::META) > c.room() - face::CUE) {
        c.more = true;
        c.cue(cueMore(c.words));
        return;
    }
    if (c.pen) c.say(OPEN_QUOTE, setting::mark, 1, c.x, c.y + MARK_DROP, c.width, c.look.accent);
    c.gap(MARK);
    int quoted = c.lines(said, Measure::passage, 99, palette::ink, who.empty() ? 0 : 8 + face::META, -1, face::W - 41, c.width);
    // The speaker only under the words they said.
    if (quoted > 0 && !who.empty() && c.room() >= 8 + face::META + (c.more ? face::CUE : 0)) {
        c.gap(8);
        if (c.pen) {
            c.pen->ctx.setFillColor(BY);
            c.pen->ctx.fill(c.pen->px(c.x, c.y + 9, 14, 1));
        }
        c.lines(who, Measure::meta, 1, BY, 0, c.x + 22, c.width - 22);
    }
    if (c.more) c.cue(cueMore(c.words));
}

Footprint size(const Item& item, const Json& props) {
    return footprint(item, [&](Col& c) { lay(c, item, props); });
}

void draw(const Pen& pen, const Look& look, const Item& item, const Json& props, float, float) {
    drawFace(pen, look, item, [&](Col& c) { lay(c, item, props); });
}



/// `.detail-quote`: the same face in a box, the words larger and whole.
void detail(Sheet& sheet, const Item& item, const Json& props) {
    constexpr Setting big{19, 26.22f, Font::Weight::regular, true, true};
    std::string said = words(item, props), who = text(props["by"]);
    float column = Sheet::width - 40;
    float wordsTall = heightOf(said, column, 0, big, sheet.k);
    float byTall = who.empty() ? 0 : 8 + heightOf(who, column - 22, 0, setting::text, sheet.k);
    float tall = 1 + 13 + MARK + wordsTall + byTall + 13 + 1;
    Look look = sheet.look;
    sheet.part(tall, [=](const Pen& pen, float y) {
        Look box = look;
        box.radius = 12;
        box.edgeWidth = 1;
        box.dashed = false;
        box.fill = mix(look.accent, 0.14f, palette::face);
        box.edge = look.accent.withAlphaComponent(0.44f);
        CGRect r = pen.px(Sheet::left, y, Sheet::width, tall);
        pen.ctx.setFillColor(box.fill);
        pen.rounded(r, 12 * pen.k);
        pen.ctx.fillPath();
        float x = Sheet::left + 20, top = y + 14;
        pen.words(OPEN_QUOTE, x, top + MARK_DROP, column, 1, setting::mark, look.accent);
        pen.words(said, x, top + MARK, column, 0, big, palette::ink);
        if (!who.empty()) by(pen, who, x, top + MARK + wordsTall + 8, column, 0, 8);
        float line = pen.k;
        pen.ctx.setStrokeColor(box.edge);
        pen.ctx.setLineWidth(line);
        pen.rounded(CGRect{r.minX() + line / 2, r.minY() + line / 2, r.width() - line, r.height() - line}, 12 * pen.k - line / 2);
        pen.ctx.strokePath();
    });
    sheet.said.push_back(said);
    if (!who.empty()) sheet.said.push_back(who);
}

Kind make() {
    Kind k{"quote", size, {}, draw, detail};
    k.face = Kind::Face::wash;
    k.chipInset = 19;
    return k;
}

const Kind kind = make();
const Registered registered{kind};

}  // namespace

}  // namespace cards
