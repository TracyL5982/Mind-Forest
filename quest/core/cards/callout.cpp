// components/callout.js: a band down the left edge in the colour of its tone, the tone named in words
// beside its glyph, the words set as a title, and the item's title as a foot.
#include "kind.h"
#include "text.h"

namespace cards {

namespace {

constexpr int WIDTH = 256;
/// The band down the left edge takes this much of the column.
constexpr int BAND = 6;
constexpr int COLUMN = WIDTH - SIDES - BAND;
/// The band, and where `.c-callout`'s wider padding starts the words.
constexpr float STRIPE = 4;
constexpr float INSET = 22;

/// A tone: its name, its colour (`--danger` for a caution, `--ink-2` for a remark) and its glyph.
struct Tone {
    Fixed name;
    Color colour;
    std::vector<std::vector<CGPoint>> glyph;
};
const Tone& toneOf(const Json& props) {
    static const Tone caution{fixed::caution, Color::hex(0xFF9A92), {{{7, 1.6f}, {13, 12.2f}, {1, 12.2f}, {7, 1.6f}}, {{7, 5.6f}, {7, 8.8f}}, {{7, 10.4f}, {7, 10.6f}}}};
    static const Tone note{fixed::note, palette::ink2, {ring(7, 7, 5.8f), {{7, 6.2f}, {7, 9.8f}}, {{7, 4.1f}, {7, 4.3f}}}};
    return text(props["tone"]) == "caution" ? caution : note;
}

struct Plan {
    std::string words, foot;
    int lines;
};

Plan plan(const Item& item, const Json& props) {
    Text words = trim(points(text(props["text"])));
    std::string said = utf8(words);
    return {said, !item.title.empty() && item.title != said ? item.title : "", wrap(words, COLUMN, TITLE_LETTER, 5)};
}

Footprint size(const Item& item, const Json& props) {
    Plan p = plan(item, props);
    return {WIDTH, FRAME + TEXT + 6 + p.lines * TITLE + (p.foot.empty() ? 0 : 8 + TEXT)};
}

/// `.callout-head`: the glyph, then the tone's name, on a line of text.
void head(const Pen& pen, const Tone& tone, const std::string& name, float x, float y) {
    strokes(pen, x, y + (TEXT - 14) / 2.f, tone.glyph, 1.2f, tone.colour);
    label(pen, name, x + 14 + 6, y, tone.colour);
}

void draw(const Pen& pen, const Look& look, const Item& item, const Json& props, float width, float body) {
    Plan p = plan(item, props);
    const Tone& tone = toneOf(props);
    // The band runs the card's whole height, its chips too. The frame's round corners are cleared after.
    float tall = body + (chips(item, {}).empty() ? 0 : CHIP_LINE);
    pen.ctx.setFillColor(tone.colour);
    pen.ctx.fill(pen.px(1, 1, STRIPE, tall - 2));
    float x = INSET, column = width - INSET - 16, y = 14;
    head(pen, tone, tone.name.in(item.words), x, y);
    pen.words(p.words, x, y + TEXT + 6, column, p.lines, setting::title, palette::ink);
    if (!p.foot.empty()) pen.words(p.foot, x, body - 14 - TEXT, column, 1, setting::text, look.ink3);
}

/// `.detail-callout`: the same in a box whose left edge is the band, the words whole.
void detail(Sheet& sheet, const Item& item, const Json& props) {
    Plan p = plan(item, props);
    const Tone* tone = &toneOf(props);
    std::string name = tone->name.in(item.words);
    float left = Sheet::left + STRIPE + 17, column = Sheet::width - STRIPE - 17 - 15;
    float tall = 13 + TEXT + 6 + heightOf(p.words, column, 0, setting::title, sheet.k) + 13;
    sheet.part(tall, [=](const Pen& pen, float y) {
        CGRect box = pen.px(Sheet::left, y, Sheet::width, tall);
        pen.ctx.setFillColor(palette::face);
        pen.rounded(box, 12 * pen.k);
        pen.ctx.fillPath();
        pen.ctx.saveGState();
        pen.ctx.clip(pen.px(Sheet::left, y, STRIPE, tall));
        pen.ctx.setFillColor(tone->colour);
        pen.rounded(box, 12 * pen.k);
        pen.ctx.fillPath();
        pen.ctx.restoreGState();
        head(pen, *tone, name, left, y + 13);
        pen.words(p.words, left, y + 13 + TEXT + 6, column, 0, setting::title, palette::ink);
    });
    sheet.said.insert(sheet.said.end(), {name, p.words});
}

Kind make() {
    Kind k{"callout", size, {}, draw, detail};
    k.chipInset = 21;
    return k;
}

const Kind kind = make();
const Registered registered{kind};

}  // namespace

}  // namespace cards
