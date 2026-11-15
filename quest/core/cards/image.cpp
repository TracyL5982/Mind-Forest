// components/image.js: a print. Tight corners, the picture to the edge, the caption on a plate below.
#include <algorithm>
#include <cmath>

#include "face.h"
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

/// The picture to the edges, then its caption on a plate in whole lines, and the cue under one line.
void lay(Col& c, const Item& item, const Json& props) {
    // The caption is the title: on the plate in up to two lines, and the picture gives way to it.
    std::string said = caption(item, props), src = text(props["src"]);
    Titled plate = titled(said, face::COL, Measure::body);
    float under = said.empty() ? 0 : 19 + float(plate.lines * face::BODY);
    double given = number(props["aspect"]);
    float aspect = aspectOf(src).value_or(given > 0 ? float(given) : 1.35f);
    float tall = std::min(float(face::H) - 2 - under, std::max(81.f, std::round(float(face::W) / aspect)));
    if (c.pen) {
        CGRect frame = c.pen->px(1, 1, face::W - 2, tall);
        c.pen->ctx.setFillColor(palette::media);
        c.pen->ctx.fill(frame);
        c.pen->picture(src, frame, true, item.words);
    }
    c.y = 1 + tall + 1;
    if (!said.empty()) {
        c.y += 9;
        c.say(plate.said, setting::faceBody, plate.lines, c.x, c.y, c.width, palette::ink);
        c.y += float(plate.lines * face::BODY);
        c.y += 10;
    }
    c.y -= face::BOTTOM;
}

Footprint size(const Item& item, const Json& props) {
    return footprint(item, [&](Col& c) { lay(c, item, props); });
}

void draw(const Pen& pen, const Look& look, const Item& item, const Json& props, float, float) {
    drawFace(pen, look, item, [&](Col& c) { lay(c, item, props); });
}




/// `.detail-media`: the picture whole, as wide as the sheet and at most 46 % of a view tall.
void detail(Sheet& sheet, const Item& item, const Json& props) {
    std::string src = text(props["src"]);
    std::optional<Picture> known = pictureAt(src);
    bool missing = src.empty() || (known && known->missing);
    float given = float(number(props["aspect"]));
    float aspect = aspectOf(src).value_or(given > 0 ? given : 1.35f);
    float tall = missing ? 120 : std::min(Sheet::width / aspect, std::min(420.f, sheet.most));
    float top = sheet.y + (sheet.first ? 0 : Sheet::gap);
    sheet.picture = CGRect{Sheet::left * sheet.k, top * sheet.k, Sheet::width * sheet.k, tall * sheet.k};
    Words words = item.words;
    sheet.part(tall, [src, tall, words](const Pen& pen, float y) {
        CGRect box = pen.px(Sheet::left, y, Sheet::width, tall);
        pen.ctx.setFillColor(palette::media);
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
    k.opens = Kind::Opens::picture;
    return k;
}

const Kind kind = make();
const Registered registered{kind};

}  // namespace

}  // namespace cards
