// A lesson of the welcome tree (core/ocean/oceanmodel_guide.cpp): a card the app makes itself, in the look of
// the others. Its stage is where the guide plays the lesson's gesture with the headset's hand drawn in lines:
// small, the top of the face, with the lesson's number on it; opened, the room between the title and the one
// line that says what to do. The marking lesson's stage is the picture to mark.
//   props: `step`, its number; `badge`, what its opened card is ("Step 2 of 7"); `aspect`, the stage's width
//   over its height; and `src`, a picture in place of the stage.
#include <algorithm>
#include <cmath>

#include "face.h"
#include "kind.h"

namespace cards {

namespace {

/// The lesson's number on the small face's stage: as large for it as on the stage the guide drew before.
constexpr Setting figure{50, 50, Font::Weight::semibold};

float stageAspect(const Json& props) {
    double given = number(props["aspect"]);
    return given > 0 ? float(given) : 1.35f;
}

/// The stage to the face's edges with the number in its middle, then the title on a plate under it.
void lay(Col& c, const Item& item, const Json& props) {
    Titled plate = titled(item.titleOrUntitled(), face::COL, Measure::title);
    float under = 19 + float(plate.lines * face::TITLE);
    float tall = std::min(float(face::H) - 2 - under, std::round(float(face::W) / stageAspect(props)));
    if (c.pen) {
        const Pen& pen = *c.pen;
        pen.ctx.setFillColor(palette::media);
        pen.ctx.fill(pen.px(1, 1, face::W - 2, tall));
        std::string n = std::to_string(int(number(props["step"])));
        float w = std::ceil(pen.width(n, figure));
        pen.words(n, (float(face::W) - w) / 2, 1 + (tall - figure.lead) / 2, w + 1, 1, figure, Color::white(1, 0.92f));
    }
    c.y = 1 + tall + 1 + 9;
    c.say(plate.said, setting::faceTitle, plate.lines, c.x, c.y, c.width, palette::ink);
    c.y += float(plate.lines * face::TITLE) + 10 - face::BOTTOM;
}

Footprint size(const Item& item, const Json& props) {
    return footprint(item, [&](Col& c) { lay(c, item, props); });
}

void draw(const Pen& pen, const Look& look, const Item& item, const Json& props, float, float) {
    drawFace(pen, look, item, [&](Col& c) { lay(c, item, props); });
}

/// The stage as wide as the sheet and as tall as the first view leaves it over the line that says what to do:
/// the card is whole in view and never scrolls.
void detail(Sheet& sheet, const Item& item, const Json& props) {
    std::string line = item.summary, src = text(props["src"]);
    float top = sheet.y + (sheet.first ? 0 : Sheet::gap);
    float under = line.empty() ? 0 : Sheet::gap + heightOf(line, Sheet::width, 0, setting::body, sheet.k);
    float tall = std::min(Sheet::width / stageAspect(props), sheet.fits - under - top);
    sheet.picture = CGRect{Sheet::left * sheet.k, top * sheet.k, Sheet::width * sheet.k, tall * sheet.k};
    Words words = item.words;
    sheet.part(tall, [src, tall, words](const Pen& pen, float y) {
        CGRect box = pen.px(Sheet::left, y, Sheet::width, tall);
        pen.ctx.setFillColor(palette::media);
        pen.ctx.fill(box);
        if (!src.empty()) pen.picture(src, box, false, words);
        pen.mask(box, 14 * pen.k, palette::glass);
    });
    sheet.paragraph(line, setting::body, palette::ink);
}

std::vector<std::string> pictures(const Json& props) { return {text(props["src"])}; }

Kind make() {
    Kind k{"lesson", size, {}, draw, detail, pictures};
    k.opens = Kind::Opens::picture;
    k.premade = true;
    return k;
}

const Kind kind = make();
const Registered registered{kind};

}  // namespace

}  // namespace cards
