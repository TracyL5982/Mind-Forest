// components/quote.js: a serif on a face washed with the tree's colour.
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

Footprint size(const Item& item, const Json& props) {
    return {WIDTH, FRAME + MARK + lines(item, props) * TITLE + (text(props["by"]).empty() ? 0 : 8 + TEXT)};
}

/// `.quote-by`: a short rule, then who said it.
void by(const Pen& pen, const std::string& who, float x, float y, float column, int lines, float ruleDrop) {
    pen.ctx.setFillColor(BY);
    pen.ctx.fill(pen.px(x, y + ruleDrop, 14, 1));
    pen.words(who, x + 22, y, column - 22, lines, setting::text, BY);
}

void draw(const Pen& pen, const Look& look, const Item& item, const Json& props, float width, float body) {
    float x = 20, column = width - 40, y = 14;
    pen.words(OPEN_QUOTE, x, y + MARK_DROP, column, 1, setting::mark, look.accent);
    pen.words(words(item, props), x, y + MARK, column, lines(item, props), setting::quote, palette::ink);
    std::string who = text(props["by"]);
    // Spare room sits between the words and the speaker.
    if (!who.empty()) by(pen, who, x, body - 14 - TEXT, column, 1, 8);
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
