// components/person.js: a name tag with a round face.
#include <algorithm>

#include "kind.h"
#include "media.h"

namespace cards {

namespace {

constexpr int WIDTH = 252;
constexpr float FACE = 58;
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

Footprint size(const Item&, const Json&) { return {WIDTH, 88}; }

void draw(const Pen& pen, const Look& look, const Item& item, const Json& props, float width, float body) {
    std::string name = nameOf(item, props), role = text(props["role"]), foot = item.title != name ? item.title : "";
    float top = 14, tall = body - 2 - 26;
    face(pen, look, look.fill, name, text(props["image"]), item.words, 16, top + (tall - FACE) / 2);
    float x = 16 + FACE + 13, column = width - 16 - x;
    float main = (name.empty() ? 0 : TITLE) + (role.empty() ? 0 : TEXT) + (foot.empty() ? 0 : TEXT);
    float y = top + (tall - main) / 2;
    auto line = [&](const std::string& s, const Setting& t, Color color) {
        if (s.empty()) return;
        pen.words(s, x, y, column, 1, t, color);
        y += t.lead;
    };
    line(name, setting::title, palette::ink);
    line(role, setting::text, look.ink2);
    line(foot, setting::text, look.ink3);
}

/// `.detail-person`: the face beside the name and the role, whole.
void detail(Sheet& sheet, const Item& item, const Json& props) {
    std::string name = nameOf(item, props), role = text(props["role"]), src = text(props["image"]);
    float column = Sheet::width - FACE - 12;
    float nameTall = heightOf(name, column, 0, setting::title, sheet.k), roleTall = heightOf(role, column, 0, setting::text, sheet.k);
    float tall = std::max(FACE, nameTall + roleTall);
    // The opened card is no card: its face is the page's, on the panel's glass.
    Look look = sheet.look;
    look.fill = palette::face;
    Words words = item.words;
    sheet.part(tall, [=](const Pen& pen, float y) {
        face(pen, look, palette::glass, name, src, words, Sheet::left, y + (tall - FACE) / 2);
        float x = Sheet::left + FACE + 12, top = y + (tall - nameTall - roleTall) / 2;
        pen.words(name, x, top, column, 0, setting::title, palette::ink);
        pen.words(role, x, top + nameTall, column, 0, setting::text, palette::ink2);
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
