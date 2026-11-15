// components/fact.js: one large figure on a sunk face, underlined once. The figure is never cut: a
// cut number misleads, so it wraps instead.
#include <algorithm>

#include "face.h"
#include "figures.h"

namespace cards {

namespace {

constexpr int NARROW = 200;
constexpr int WIDE = 320;
constexpr int COLUMN = WIDE - SIDES;
/// The most lines a value is sized for, so a paragraph filed as a value cannot make a tower.
constexpr int MOST_LINES = 8;
constexpr Figure SIZES[] = {LARGEST, MIDDLE, SMALLEST};

struct Plan {
    std::string value, label, foot;
    Figure size = SMALLEST;
    int width = NARROW, lines = 1, labelLines = 0;
};

/// A value takes the largest size that holds it on one line. Past the smallest, it wraps and the card
/// grows with it, up to `MOST_LINES`.
Plan plan(const Item& item, const Json& props) {
    Plan p;
    p.value = text(props["value"]);
    if (p.value.empty()) p.value = "\xE2\x80\x93";
    p.label = text(props["label"]);
    Text value = points(p.value);
    const Figure* step = nullptr;
    for (const Figure& size : SIZES) {
        if (figureNeed(value, size) <= COLUMN * 100) {
            step = &size;
            break;
        }
    }
    p.size = step ? *step : SMALLEST;
    p.lines = step ? 1 : fold(value, COLUMN, SMALLEST.letter, MOST_LINES);
    int valueWidth = p.lines > 1 ? COLUMN : int(up(figureNeed(value, p.size), 100));
    p.width = int(clamp(SIDES + std::max(valueWidth, textWidth(points(p.label))), NARROW, WIDE));
    p.labelLines = p.label.empty() ? 0 : fold(points(p.label), p.width - SIDES, TEXT_LETTER, 2);
    if (!item.title.empty() && item.title != p.value && item.title != p.label) p.foot = item.title;
    return p;
}

/// The value as a figure, whole, its label, and the title as a foot.
void lay(Col& c, const Item& item, const Json& props) {
    std::string value = text(props["value"]), label = text(props["label"]);
    if (value.empty()) value = "\xE2\x80\x93";
    std::string foot = !item.title.empty() && item.title != value && item.title != label ? item.title : "";
    Text v = points(value);
    // The item's lines over the figure, and its heads row, come first.
    if (!(c.above(props) && c.heads(props))) {
        c.cue(cueMore(c.words));
        return;
    }
    if (headsOf(props)) {
        // Under a heads row the label stands under the first head and the value under the second, at the column's end.
        const float half = std::floor((c.width - 17) / 2);
        bool middle = figureNeed(v, MIDDLE) <= int(half) * 100;
        const Figure& size = middle ? MIDDLE : SMALLEST;
        int valueNeed = middle ? 1 : wrap(v, int(half), SMALLEST.letter, 3), valueLines = std::min(2, valueNeed);
        // A value on one line is as wide as it is counted, and the label has the rest of the row.
        float valueWide = valueLines == 1 ? std::min(half, std::ceil(float(figureNeed(v, size)) / 100)) : half;
        float labelWide = c.width - 12 - valueWide;
        int labelNeed = label.empty() ? 0 : counted(label, int(labelWide), Measure::body), labelLines = std::min(2, labelNeed);
        float tall = std::max(float(labelLines * face::BODY), float(valueLines * size.lineHeight));
        if (8 + tall > c.room() - face::CUE) {
            c.more = true;
            c.cue(cueMore(c.words));
            return;
        }
        if (valueNeed > 2 || labelNeed > 2) c.more = true;
        c.gap(8);
        if (c.pen) {
            c.say(label, setting::faceBody, labelLines, c.x, c.y, labelWide, c.look.ink2);
            float w = valueLines == 1 ? std::min(valueWide, std::ceil(widthOf(value, figureSetting(size), c.pen->k)) + 1) : valueWide;
            c.heldBack = figure(*c.pen, value, c.x + c.width - w, c.y, w + 1, valueLines, size, palette::ink) || c.heldBack;
        }
        c.gap(tall);
        if (!foot.empty() && c.room() >= 8 + face::META + (c.more ? face::CUE : 0)) {
            c.gap(8);
            c.lines(foot, Measure::meta, 1, palette::ink2);
        }
        if (c.more) c.cue(cueMore(c.words));
        return;
    }
    const Figure& size = figureNeed(v, LARGEST) <= face::COL * 100 ? LARGEST : figureNeed(v, MIDDLE) <= face::COL * 100 ? MIDDLE : SMALLEST;
    int valueLines = &size == &SMALLEST ? std::min(2, wrap(v, face::COL, SMALLEST.letter, 3)) : 1;
    if (&size == &SMALLEST && wrap(v, face::COL, SMALLEST.letter, 3) > 2) c.more = true;
    if (float(valueLines * size.lineHeight) > c.room() - face::CUE) {
        c.more = true;
        c.cue(cueMore(c.words));
        return;
    }
    if (c.pen) c.heldBack = figure(*c.pen, value, c.x, c.y, c.width, valueLines, size, palette::ink) || c.heldBack;
    c.gap(float(valueLines * size.lineHeight));
    if (!label.empty()) {
        c.gap(4);
        c.lines(label, Measure::body, valueLines == 2 ? 1 : 2, c.look.ink2, foot.empty() ? 0 : 8 + face::META);
    }
    if (!foot.empty() && c.room() >= 8 + face::META) {
        c.gap(8);
        c.lines(foot, Measure::meta, 1, palette::ink2);
    }
    if (c.more) c.cue(cueMore(c.words));
}

Footprint size(const Item& item, const Json& props) {
    return footprint(item, [&](Col& c) { lay(c, item, props); });
}

void draw(const Pen& pen, const Look& look, const Item& item, const Json& props, float, float) {
    drawFace(pen, look, item, [&](Col& c) { lay(c, item, props); });
}




/// `.detail-fact`: the card's sunk face in a box, the value whole at the largest size.
void detail(Sheet& sheet, const Item&, const Json& props) {
    std::string value = text(props["value"]), label = text(props["label"]);
    float column = Sheet::width - 32;
    float valueTall = figureHeight(value, column, 0, LARGEST, sheet.k);
    float tall = 1 + 13 + valueTall + RULE + heightOf(label, column, 0, setting::text, sheet.k) + 13 + 1;
    Color accent = sheet.look.accent;
    sheet.part(tall, [=](const Pen& pen, float y) {
        box(pen, Sheet::left, y, Sheet::width, tall, palette::sunk, accent.withAlphaComponent(0.3f));
        float x = Sheet::left + 16, top = y + 14;
        figure(pen, value, x, top, column, 0, LARGEST, palette::ink);
        rule(pen, x, top + valueTall, accent);
        pen.words(label, x, top + valueTall + RULE, column, 0, setting::text, palette::ink2);
    });
    for (const std::string& s : {value, label}) {
        if (!s.empty()) sheet.said.push_back(s);
    }
}

Kind make() {
    Kind k{"fact", size, {}, draw, detail};
    k.face = Kind::Face::sunk;
    return k;
}

const Kind kind = make();
const Registered registered{kind};

}  // namespace

}  // namespace cards
