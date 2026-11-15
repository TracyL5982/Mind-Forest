// components/image.js: a print. Tight corners, the picture to the edge, the caption on a plate below.
#include <algorithm>
#include <cmath>

#include "kind.h"

namespace cards {

namespace {

constexpr int WIDTH = 240;

int pictureHeight(const Json& props) {
    double aspect = number(props["aspect"]);
    if (aspect == 0 || std::isnan(aspect)) aspect = 1.35;
    return int(clamp(int64_t(std::floor(double(WIDTH) / aspect + 0.5)), 130, 260));
}

std::string caption(const Item& item, const Json& props) {
    std::string given = text(props["caption"]);
    return !given.empty() ? given : item.title;
}

int captionLines(const Item& item, const Json& props) {
    std::string c = caption(item, props);
    return c.empty() ? 0 : fold(points(c), WIDTH - SIDES, TEXT_LETTER, 2);
}

Footprint size(const Item& item, const Json& props) {
    int lines = captionLines(item, props);
    return {WIDTH, pictureHeight(props) + 2 + (lines ? 19 + lines * TEXT : 0)};
}

void draw(const Pen& pen, const Look&, const Item& item, const Json& props, float width, float) {
    float tall = float(pictureHeight(props));
    CGRect frame = pen.px(1, 1, width - 2, tall);
    pen.ctx.setFillColor(palette::media);
    pen.ctx.fill(frame);
    pen.picture(text(props["src"]), frame, true, item.words);
    if (int lines = captionLines(item, props)) pen.words(caption(item, props), 16, 1 + tall + 9, width - 32, lines, setting::text, palette::ink);
}

/// `.detail-media`: the picture whole, as wide as the sheet and at most 46 % of a view tall.
void detail(Sheet& sheet, const Item& item, const Json& props) {
    std::string src = text(props["src"]);
    std::optional<Picture> known = pictureAt(src);
    bool missing = src.empty() || (known && known->missing);
    float given = float(number(props["aspect"]));
    float aspect = aspectOf(src).value_or(given > 0 ? given : 1.35f);
    float tall = missing ? 120 : std::min(Sheet::width / aspect, 420.f);
    float top = sheet.y + (sheet.first ? 0 : Sheet::gap);
    sheet.picture = CGRect{Sheet::left * sheet.k, top * sheet.k, Sheet::width * sheet.k, tall * sheet.k};
    Words words = item.words;
    sheet.part(tall, [src, tall, words](const Pen& pen, float y) {
        CGRect box = pen.px(Sheet::left, y, Sheet::width, tall);
        pen.ctx.setFillColor(Color::hex(0x0F1115));
        pen.ctx.fill(box);
        pen.picture(src, box, false, words);
        pen.mask(box, 14 * pen.k, palette::glass);
    });
    std::string c = text(props["caption"]);
    if (!c.empty() && c != item.title && c != item.summary) sheet.paragraph(c, setting::caption, palette::ink2);
}

std::vector<std::string> pictures(const Json& props) { return {text(props["src"])}; }

Kind make() {
    Kind k{"image", size, {}, draw, detail, pictures};
    k.radius = 4;
    k.chipInset = 12;
    k.chipBottom = 10;
    return k;
}

const Kind kind = make();
const Registered registered{kind};

}  // namespace

}  // namespace cards
