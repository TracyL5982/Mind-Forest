// A lesson of the welcome tree (core/ocean/oceanmodel_guide.cpp): a card the app makes itself, in the look of
// the others. Its stage is where the guide plays the lesson's gesture with the headset's hand drawn in lines:
// small, the top of the face, with the lesson's number on it; opened, the room between the title and the words
// that say what to do. The marking lesson's stage is the picture to mark.
//   props: `step`, its number; `badge`, what its opened card is ("Step 2 of 7"); `tall`, the stage's height, px;
//   or `src`, a picture in place of the stage, and `aspect`, its width over its height.
#include <algorithm>
#include <cmath>
#include <vector>

#include "face.h"
#include "kind.h"

namespace cards {

namespace {

/// The lesson's number on the small face's stage: as large for it as on the stage the guide drew before.
constexpr Setting figure{34, 36, Font::Weight::semibold};  // (smaller, the user: at 50 it stood at the top edge)

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

/// The first lesson's two gestures, set heavier in its words wherever they are asked for (the user's ask, WS103): the
/// longer first, so "Pinch and hold" is not taken for "Pinch". The words themselves are the user's and stay as they are.
const char* const STRONG[] = {"Pinch and hold", "pinch and hold", "Pinch"};
constexpr Setting strongBody{setting::body.size, setting::body.lead, Font::Weight::bold};

/// A paragraph with those phrases heavier. A paragraph of this library has one weight, so it is wrapped here, a word
/// at a time, as the sheet's own paragraph wraps: as many words on a line as its width takes.
void strongParagraph(Sheet& sheet, const std::string& s) {
    if (s.empty()) return;
    std::vector<bool> heavy(s.size(), false);
    for (const char* phrase : STRONG) {
        std::string p = phrase;
        for (size_t at = s.find(p); at != std::string::npos; at = s.find(p, at + 1)) {
            bool starts = at == 0 || s[at - 1] == ' ';
            bool ends = at + p.size() == s.size() || s[at + p.size()] == ' ' || s[at + p.size()] == '.' || s[at + p.size()] == ',';
            bool free = true;
            for (size_t i = at; i < at + p.size(); i++) free = free && !heavy[i];
            if (starts && ends && free) std::fill(heavy.begin() + long(at), heavy.begin() + long(at + p.size()), true);
        }
    }
    struct Word {
        std::string text;
        bool bold;
        float x, line;
    };
    std::vector<Word> words;
    for (size_t at = 0; at < s.size();) {
        size_t end = s.find(' ', at);
        if (end == std::string::npos) end = s.size();
        if (end > at) words.push_back(Word{s.substr(at, end - at), bool(heavy[at]), 0, 0});
        at = end + 1;
    }
    const float k = sheet.k;
    const float space = widthOf("x x", setting::body, k) - widthOf("xx", setting::body, k);
    float x = 0;
    int line = 0;
    for (Word& w : words) {
        float wide = widthOf(w.text, w.bold ? strongBody : setting::body, k);
        if (x > 0 && x + space + wide > Sheet::width) {
            line += 1;
            x = 0;
        } else if (x > 0) {
            x += space;
        }
        w.x = x;
        w.line = float(line);
        x += wide;
    }
    float tall = float(line + 1) * setting::body.lead;
    std::vector<float> breaks;
    for (int n = 1; n <= line; n++) breaks.push_back(float(n) * setting::body.lead);
    sheet.part(tall, [words](const Pen& pen, float y) {
        for (const Word& w : words) {
            const Setting& t = w.bold ? strongBody : setting::body;
            pen.words(w.text, Sheet::left + w.x, y + w.line * t.lead, std::ceil(pen.width(w.text, t)) + 2, 1, t, palette::ink);
        }
    }, breaks);
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
    const bool first = int(number(props["step"])) == 1;
    for (size_t from = 0; from <= said.size();) {
        size_t cut = said.find("\n\n", from);
        std::string paragraph = said.substr(from, cut == std::string::npos ? std::string::npos : cut - from);
        if (first) strongParagraph(sheet, paragraph);
        else sheet.paragraph(paragraph, setting::body, palette::ink);
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
