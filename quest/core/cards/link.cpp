// components/link.js: a page under its address bar.
#include <algorithm>
#include <cmath>

#include "face.h"
#include "kind.h"
#include "media.h"

namespace cards {

namespace {

constexpr int BAR = 30;
constexpr int THUMB = 64;
/// A film's poster beside the words under the bar, two by three as a poster stands.
constexpr int POSTER_WIDE = 60, POSTER_TALL = 90;
/// A wide picture in a band across the face under the bar, as tall as leaves room for a line of the title and the cue.
constexpr int BAND = 48;
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

/// `.link-site`, `w` px wide with its top-left at (x, y): the site's first letter on a tile, the site, and
/// an arrow out. On the card it has a rule under it; opened, it is a box of its own.
void bar(const Pen& pen, float x, float y, float w, const std::string& site, bool boxed, const Setting& said = setting::body, bool kicked = false) {
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
    // Under a pick's kicker, which stands over the bar's top edge, the row sits low in the bar on a smaller tile.
    float tile = kicked ? 13 : 17, dotTop = kicked ? top + 14.5f : top + (inner - tile) / 2;
    pen.ctx.setFillColor(palette::ink2);
    pen.rounded(pen.px(left, dotTop, tile, tile), 4 * pen.k);
    pen.ctx.fillPath();
    std::string letter = capital(site);
    float letterWidth = pen.width(letter, DOT);
    pen.words(letter, left + (tile - letterWidth) / 2, dotTop + (tile - DOT.lead) / 2, letterWidth + 1, 1, DOT, Art::ink);
    float lineTop = kicked ? top + 12.5f : top + (inner - said.lead) / 2, outWidth = std::ceil(pen.width(OUT, said));
    pen.words(OUT, right - outWidth, lineTop, outWidth + 1, 1, said, palette::ink3);
    float host = left + tile + 8;
    pen.words(site, host, lineTop, right - outWidth - 8 - host, 1, said, palette::ink2);
}


/// Where the picture stands on the small face. One taller than it is wide, a film's poster, stands at the right of the words. Any
/// other, such as a page's own picture at 1.91 to 1, lies in a band under the bar, where the poster's box would show a sliver of its
/// middle. Until the picture is had, a film's is drawn as a poster and any other in the band, so the face keeps its shape when it lands.
enum class Placed { none, poster, band };

Placed placed(const Item& item, const std::string& src) {
    if (src.empty()) return Placed::none;
    std::optional<float> aspect = aspectOf(src);
    bool tall = aspect ? *aspect < 1 : item.data["kind"].string("") == "film";
    return tall ? Placed::poster : Placed::band;
}

/// The address bar across the top, then the title and the description in whole lines, and the cue, beside a portrait picture at the
/// right or under a wide one in a band, when the record has one.
void lay(Col& c, const Item& item, const Json& props) {
    if (c.pen) bar(*c.pen, 1, 1, face::W - 2, siteOf(item, props), false, setting::faceMeta, c.look.dashed);
    c.y = 30 + 13;
    std::string picture = text(props["image"]);
    Placed at = placed(item, picture);
    float foot = at == Placed::poster ? sidePictureRight(c, picture, POSTER_WIDE, POSTER_TALL) : 0;
    if (at == Placed::band) {
        if (c.pen) {
            CGRect box = c.pen->px(1, 31, face::W - 2, BAND);
            c.pen->ctx.setFillColor(palette::media);
            c.pen->ctx.fill(box);
            c.pen->picture(picture, box, true, c.words);
        }
        c.y += BAND;
    }
    std::string about = text(props["description"]);
    if (about.empty()) about = item.summary;
    if (!c.title(item.titleOrUntitled(), -1, -1, at == Placed::band ? 1 : face::TITLE_LINES)) return;
    if (!about.empty() && c.room() >= 4 + face::BODY) {
        c.gap(4);
        c.lines(about, Measure::body, 99, c.look.ink2);
    } else if (!about.empty()) {
        c.more = true;
    }
    if (c.more) c.cue(cueMore(c.words));
    c.y = std::max(c.y, foot);
    c.y += 13 - face::BOTTOM;
}

Footprint size(const Item& item, const Json& props) {
    return footprint(item, [&](Col& c) { lay(c, item, props); });
}

void draw(const Pen& pen, const Look& look, const Item& item, const Json& props, float, float) {
    drawFace(pen, look, item, [&](Col& c) { lay(c, item, props); });
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
        float tall = known && known->missing ? 120 : std::min(Sheet::width / aspect, std::min(420.f, sheet.most));
        sheet.y += GAP - Sheet::gap;
        sheet.picture = CGRect{Sheet::left * sheet.k, (sheet.y + Sheet::gap) * sheet.k, Sheet::width * sheet.k, tall * sheet.k};
        Words words = item.words;
        sheet.part(tall, [image, tall, words](const Pen& pen, float y) {
            CGRect box = pen.px(Sheet::left, y, Sheet::width, tall);
            pen.ctx.setFillColor(palette::media);
            pen.ctx.fill(box);
            pen.picture(image, box, false, words);
            pen.mask(box, 14 * pen.k, palette::glass);
        });
    }
    std::string description = text(props["description"]);
    if (description != item.summary) paragraph(sheet, description, setting::caption, palette::ink2, GAP);
}

std::vector<std::string> pictures(const Json& props) { return {text(props["image"])}; }

Kind make() {
    Kind k{"link", size, {"site"}, draw, detail, pictures};
    k.opens = Kind::Opens::link;
    return k;
}

const Kind kind = make();
const Registered registered{kind};

}  // namespace

}  // namespace cards
