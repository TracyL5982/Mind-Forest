// A lesson of the welcome tree (core/ocean/oceanmodel_guide.cpp): a card the app makes itself, in the look of
// the others. Its stage is where the guide plays the lesson's gesture with the headset's hand drawn in lines:
// small, the top of the face, with the lesson's number on it; opened, the room between the title and the words
// that say what to do. The marking lesson's stage is the picture to mark.
//   props: `step`, its number; `badge`, what its opened card is ("Step 2 of 7"); `tall`, the stage's height, px;
//   or `src`, a picture in place of the stage, and `aspect`, its width over its height.
#include <algorithm>
#include <cmath>

#include "face.h"
#include "kind.h"

namespace cards {

namespace {

/// The lesson's number on the small face's stage: as large for it as on the stage the guide drew before.
constexpr Setting figure{50, 50, Font::Weight::semibold};

/// The title's plate always has room for two lines, so every lesson's face is laid out alike: the same stage, the
/// number at the same place on it, and the title starting at the same height, whether it takes one line or two (WS103).
constexpr int PLATE_LINES = 2;

/// The stage to the face's edges with the number in its middle, then the title on a plate under it.
void lay(Col& c, const Item& item, const Json& props) {
    Titled plate = titled(item.titleOrUntitled(), face::COL, Measure::title);
    int room = std::max(PLATE_LINES, plate.lines);
    float under = 19 + float(room * face::TITLE);
    float tall = float(face::H) - 2 - under;
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
    c.y += float(room * face::TITLE) + 10 - face::BOTTOM;
}

Footprint size(const Item& item, const Json& props) {
    return footprint(item, [&](Col& c) { lay(c, item, props); });
}

void draw(const Pen& pen, const Look& look, const Item& item, const Json& props, float, float) {
    drawFace(pen, look, item, [&](Col& c) { lay(c, item, props); });
}

/// The stage as wide as the sheet, then the words that say what to do. The opened card is as tall as both
/// (`Kind::premade`), so the stage never gives way and nothing scrolls.
void detail(Sheet& sheet, const Item& item, const Json& props) {
    std::string src = text(props["src"]);
    double given = number(props["tall"]), aspect = number(props["aspect"]);
    float top = sheet.y + (sheet.first ? 0 : Sheet::gap);
    float tall = given > 0 ? float(given) : Sheet::width / float(aspect > 0 ? aspect : 1.35);
    sheet.picture = CGRect{Sheet::left * sheet.k, top * sheet.k, Sheet::width * sheet.k, tall * sheet.k};
    Words words = item.words;
    sheet.part(tall, [src, tall, words](const Pen& pen, float y) {
        CGRect box = pen.px(Sheet::left, y, Sheet::width, tall);
        pen.ctx.setFillColor(palette::media);
        pen.ctx.fill(box);
        if (!src.empty()) pen.picture(src, box, false, words);
        pen.mask(box, 14 * pen.k, palette::glass);
    });
    // (Its words in paragraphs where they have a blank line between: the user's for the first lesson, WS101. The break may come
    // as the two characters of its escape, the way the ocean's notes reach the card library.)
    std::string said = item.summary;
    for (size_t at; (at = said.find("\\n")) != std::string::npos;) said.replace(at, 2, "\n");
    for (size_t from = 0; from <= said.size();) {
        size_t cut = said.find("\n\n", from);
        sheet.paragraph(said.substr(from, cut == std::string::npos ? std::string::npos : cut - from), setting::body, palette::ink);
        if (cut == std::string::npos) break;
        from = cut + 2;
    }
    // (Said, whole, so what the card library adds of words not yet said leaves it be.)
    sheet.said.push_back(item.summary);
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
