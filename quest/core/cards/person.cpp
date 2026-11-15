// components/person.js: a name tag with a round face.
#include <algorithm>

#include "face.h"
#include "kind.h"
#include "media.h"

namespace cards {

namespace {

constexpr int WIDTH = 252;
constexpr float FACE = 48;
constexpr Setting INITIALS{16, 21, Font::Weight::semibold};

std::string nameOf(const Item& item, const Json& props) {
    std::string name = text(props["name"]);
    return !name.empty() ? name : item.title;
}

/// The first letter of each of the first two words, or `?`.
std::string initials(const std::string& name) {
    Text all = points(name);
    std::string out;
    int words = 0;
    for (size_t i = 0; i < all.size() && words < 2;) {
        while (i < all.size() && isSpace(all[i])) i++;
        size_t start = i;
        while (i < all.size() && !isSpace(all[i])) i++;
        if (i == start) break;
        out += capital(utf8(all.substr(start, i - start)));
        words++;
    }
    return out.empty() ? "?" : out;
}

bool drawsInitials(const std::string& src) {
    std::optional<Picture> known = pictureAt(src);
    return src.empty() || (known && known->missing);
}

/// `.person-face` at (x, y) px on `ground`: the picture cut to a circle, or the initials when there is
/// none or it could not be had.
void face(const Pen& pen, const Look& look, Color ground, const std::string& name, const std::string& src, const Words& words,
          float x, float y) {
    CGRect box = pen.px(x, y, FACE, FACE);
    disc(pen, look, box);
    if (drawsInitials(src)) {
        std::string letters = initials(name);
        float w = pen.width(letters, INITIALS);
        pen.words(letters, x + FACE / 2 - w / 2, y + (FACE - INITIALS.lead) / 2, w + 1, 1, INITIALS, look.accent);
        return;
    }
    pen.picture(src, box, true, words);
    pen.mask(box, box.width() / 2, ground);
    ring(pen, look, box);
}

/// A round face of 48 px beside the name and the role, each in whole lines.
void lay(Col& c, const Item& item, const Json& props) {
    std::string name = nameOf(item, props), role = text(props["role"]);
    float top = c.y;
    if (c.pen) face(*c.pen, c.look, c.look.fill, name, text(props["image"]), item.words, c.x, top);
    c.x += 48 + 12;
    c.width -= 48 + 12;
    if (!c.title(name)) return;
    c.lines(role, Measure::body, 2, c.look.ink2);
    c.y = std::max(c.y, top + 48);
    c.x = face::LEFT;
    c.width = face::COL;
    if (c.more) c.cue(cueMore(c.words));
}

Footprint size(const Item& item, const Json& props) {
    return footprint(item, [&](Col& c) { lay(c, item, props); });
}

void draw(const Pen& pen, const Look& look, const Item& item, const Json& props, float, float) {
    drawFace(pen, look, item, [&](Col& c) { lay(c, item, props); });
}




/// `.detail-person`: the face beside the name and the role, whole.
void detail(Sheet& sheet, const Item& item, const Json& props) {
    std::string name = nameOf(item, props), role = text(props["role"]), src = text(props["image"]);
    float column = Sheet::width - FACE - 12;
    float nameTall = heightOf(name, column, 0, setting::title, sheet.k), roleTall = heightOf(role, column, 0, setting::body, sheet.k);
    float tall = std::max(FACE, nameTall + roleTall);
    // The opened card is no card: its face is the page's, on the panel's glass.
    Look look = sheet.look;
    look.fill = palette::face;
    Words words = item.words;
    sheet.part(tall, [=](const Pen& pen, float y) {
        face(pen, look, palette::glass, name, src, words, Sheet::left, y + (tall - FACE) / 2);
        float x = Sheet::left + FACE + 12, top = y + (tall - nameTall - roleTall) / 2;
        pen.words(name, x, top, column, 0, setting::title, palette::ink);
        pen.words(role, x, top + nameTall, column, 0, setting::body, palette::ink2);
    });
    if (drawsInitials(src)) sheet.said.push_back(initials(name));
    sheet.said.push_back(name);
    if (!role.empty()) sheet.said.push_back(role);
}

std::vector<std::string> pictures(const Json& props) { return {text(props["image"])}; }

const Kind kind{"person", size, {}, draw, detail, pictures};
const Registered registered{kind};

}  // namespace

}  // namespace cards
