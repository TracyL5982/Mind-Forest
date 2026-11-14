// components/link.js: a page under its address bar.
#include <algorithm>
#include <cmath>

#include "kind.h"
#include "media.h"

namespace cards {

namespace {

constexpr int BAR = 30;
constexpr int THUMB = 64;
constexpr const char* OUT = "\xE2\x86\x97";
constexpr Setting DOT{11, 11, Font::Weight::bold};

std::string siteOf(const Item& item, const Json& props) {
    std::string site = text(props["site"]);
    return !site.empty() ? site : item.words.chinese ? "链接" : "link";
}

struct Plan {
    std::string thumb, about;
    int width = 0, titleLines = 1, aboutLines = 0;
};

Plan plan(const Item& item, const Json& props) {
    Plan p;
    p.thumb = text(props["image"]);
    std::string description = text(props["description"]);
    p.about = !description.empty() ? description : item.summary;
    p.width = p.thumb.empty() ? 272 : 316;
    int column = p.width - SIDES - (p.thumb.empty() ? 0 : 96);
    p.titleLines = fold(points(item.titleOrUntitled()), column, TITLE_LETTER, 2);
    p.aboutLines = p.about.empty() ? 0 : fold(points(p.about), column, TEXT_LETTER, 2);
    return p;
}

Footprint size(const Item& item, const Json& props) {
    Plan p = plan(item, props);
    int main = p.titleLines * TITLE + (p.aboutLines ? 4 + p.aboutLines * TEXT : 0);
    return {p.width, 3 + BAR + 10 + std::max(main, p.thumb.empty() ? 0 : THUMB) + 13};
}

/// `.link-site`, `w` px wide with its top-left at (x, y): the site's first letter on a tile, the site, and
/// an arrow out. On the card it has a rule under it; opened, it is a box of its own.
void bar(const Pen& pen, float x, float y, float w, const std::string& site, bool boxed) {
    CGRect r = pen.px(x, y, w, BAR);
    pen.ctx.setFillColor(Color::white(1, 0.025f));
    float inner = boxed ? BAR - 2 : BAR - 1, top = boxed ? y + 1 : y;
    if (boxed) {
        pen.rounded(r, 8 * pen.k);
        pen.ctx.fillPath();
        float line = pen.k;
        pen.ctx.setStrokeColor(palette::line);
        pen.ctx.setLineWidth(line);
        pen.rounded(r.insetBy(line / 2, line / 2), 8 * pen.k - line / 2);
        pen.ctx.strokePath();
    } else {
        pen.ctx.fill(r);
        pen.ctx.setFillColor(palette::line);
        pen.ctx.fill(pen.px(x, y + BAR - 1, w, 1));
    }
    float left = x + (boxed ? 1 : 0) + 15, right = x + w - (boxed ? 1 : 0) - 12;
    float dotTop = top + (inner - 17) / 2;
    pen.ctx.setFillColor(palette::ink2);
    pen.rounded(pen.px(left, dotTop, 17, 17), 4 * pen.k);
    pen.ctx.fillPath();
    std::string letter = capital(site);
    float letterWidth = pen.width(letter, DOT);
    pen.words(letter, left + (17 - letterWidth) / 2, dotTop + 3, letterWidth + 1, 1, DOT, Color::hex(0x0B0D11));
    float lineTop = top + (inner - TEXT) / 2, outWidth = std::ceil(pen.width(OUT, setting::text));
    pen.words(OUT, right - outWidth, lineTop, outWidth + 1, 1, setting::text, palette::ink3);
    float host = left + 17 + 8;
    pen.words(site, host, lineTop, right - outWidth - 8 - host, 1, setting::text, palette::ink2);
}

void draw(const Pen& pen, const Look& look, const Item& item, const Json& props, float width, float body) {
    Plan p = plan(item, props);
    bar(pen, 1, 1, width - 2, siteOf(item, props), false);
    float x = 16, y = 1 + BAR + 10, column = width - 32 - (p.thumb.empty() ? 0 : 84 + 12);
    std::string title = item.titleOrUntitled();
    pen.words(title, x, y, column, p.titleLines, setting::title, palette::ink);
    float titleTall = heightOf(title, column, p.titleLines, setting::title, pen.k);
    if (p.aboutLines) pen.words(p.about, x, y + titleTall + 4, column, p.aboutLines, setting::text, look.ink2);
    if (p.thumb.empty()) return;
    CGRect thumb = pen.px(width - 16 - 84, y, 84, body - 1 - BAR - 10 - 13 - 1);
    pen.picture(p.thumb, thumb, true, item.words);
    pen.mask(thumb, 6 * pen.k, look.fill);
}

/// `.detail-link`: the address bar in a box, the picture whole when the page has an address, and the description.
void detail(Sheet& sheet, const Item& item, const Json& props) {
    constexpr float GAP = 10;
    std::string site = siteOf(item, props), url = text(props["url"]), image = text(props["image"]);
    sheet.part(BAR, [site](const Pen& pen, float y) { bar(pen, Sheet::left, y, Sheet::width, site, true); });
    sheet.said.insert(sheet.said.end(), {capital(site), site, OUT});
    bool page = url.rfind("https://", 0) == 0 || url.rfind("http://", 0) == 0;
    if (page && !image.empty()) {
        std::optional<Picture> known = pictureAt(image);
        float aspect = aspectOf(image).value_or(1.35f);
        float tall = known && known->missing ? 120 : std::min(Sheet::width / aspect, 420.f);
        sheet.y += GAP - Sheet::gap;
        sheet.picture = CGRect{Sheet::left * sheet.k, (sheet.y + Sheet::gap) * sheet.k, Sheet::width * sheet.k, tall * sheet.k};
        Words words = item.words;
        sheet.part(tall, [image, tall, words](const Pen& pen, float y) {
            CGRect box = pen.px(Sheet::left, y, Sheet::width, tall);
            pen.ctx.setFillColor(Color::hex(0x0F1115));
            pen.ctx.fill(box);
            pen.picture(image, box, false, words);
            pen.mask(box, 14 * pen.k, palette::glass);
        });
    }
    std::string description = text(props["description"]);
    if (description != item.summary) paragraph(sheet, description, setting::caption, palette::ink2, GAP);
}

std::vector<std::string> pictures(const Json& props) { return {text(props["image"])}; }

const Kind kind{"link", size, {"site"}, draw, detail, pictures};
const Registered registered{kind};

}  // namespace

}  // namespace cards
