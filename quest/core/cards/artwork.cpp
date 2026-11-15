// components/artwork.js: the work whole on a mat a shade lighter than the card, over a plate that reads
// like a museum label.
#include <algorithm>

#include "face.h"
#include "kind.h"
#include "media.h"

namespace cards {

namespace {

constexpr int WIDTH = 264;
constexpr int COLUMN = WIDTH - SIDES;
/// The mat the work is shown whole on.
constexpr int MAT = 196;
/// The border, the plate's padding above and below its lines, and 2 px to spare.
constexpr int PLATE = 26;
/// `.detail-artwork`
constexpr Setting LABEL{15, 21, Font::Weight::medium};

struct Plan {
    std::string by, medium, holder;
    int titleLines = 1, byLines = 0, mediumLines = 0;
};

Plan plan(const Item& item, const Json& props) {
    Plan p;
    std::string maker = trimmed(props["maker"]), date = trimmed(props["date"]);
    p.by = maker.empty() ? date : date.empty() ? maker : maker + ", " + date;
    p.medium = trimmed(props["medium"]);
    p.holder = trimmed(props["holder"]);
    p.titleLines = wrap(points(item.titleOrUntitled()), COLUMN, TITLE_LETTER, 2);
    p.byLines = p.by.empty() ? 0 : wrap(points(p.by), COLUMN, TEXT_LETTER, 2);
    p.mediumLines = p.medium.empty() ? 0 : wrap(points(p.medium), COLUMN, TEXT_LETTER, 2);
    return p;
}

/// The work's two shadows: a soft dark one cast 6 px down, and a faint light edge.
void lift(const Pen& pen, CGRect r) {
    const int layers = 8;
    for (int i = 0; i < layers; i++) {
        float grow = (12 * (float(i) + 0.5f) / layers - 6) * pen.k;
        pen.ctx.setFillColor(Color::black(0.095f));
        pen.rounded(CGRect{r.minX() - grow, r.minY() + 6 * pen.k - grow, r.width() + 2 * grow, r.height() + 2 * grow}, std::max(0.f, grow + 6 * pen.k));
        pen.ctx.fillPath();
    }
    pen.ctx.setStrokeColor(Color::white(1, 0.3f));
    pen.ctx.setLineWidth(pen.k);
    pen.ctx.stroke(r.insetBy(-pen.k / 2, -pen.k / 2));
}


/// The work whole on a mat a shade lighter, 101 px tall, then its title on a plate.
void lay(Col& c, const Item& item, const Json& props) {
    // The title on the plate under the picture in up to two lines, and the picture gives way to it.
    std::string title = item.titleOrUntitled(), src = text(props["src"]);
    Titled plate = titled(title, face::COL, Measure::title);
    const float box = float(face::H) - 2 - 19 - float(plate.lines * face::TITLE);
    if (c.pen) {
        const Pen& pen = *c.pen;
        CGRect mat = pen.px(1, 1, face::W - 2, box);
        pen.ctx.setFillColor(palette::raised);
        pen.ctx.fill(mat);
        CGRect inside = pen.px(7, 7, face::W - 14, box - 12);
        std::optional<Picture> known = pictureAt(src);
        bool missing = src.empty() || (known && known->missing);
        std::optional<float> aspect = aspectOf(src);
        if (missing) unavailable(pen, inside, item.words);
        else pen.picture(src, aspect ? contained(inside, *aspect) : inside, false, item.words);
    }
    // The plate: 9 px over its line and 10 under it.
    c.y = 1 + box + 1 + 9;
    c.say(plate.said, setting::faceTitle, plate.lines, c.x, c.y, c.width, palette::ink);
    c.y += float(plate.lines * face::TITLE);
    c.y += 10 - face::BOTTOM;
}

Footprint size(const Item& item, const Json& props) {
    return footprint(item, [&](Col& c) { lay(c, item, props); });
}

void draw(const Pen& pen, const Look& look, const Item& item, const Json& props, float, float) {
    drawFace(pen, look, item, [&](Col& c) { lay(c, item, props); });
}



/// The picture whole and the label's lines whole, without the holder when the opened card's list of
/// sources names it.
void detail(Sheet& sheet, const Item& item, const Json& props) {
    Plan p = plan(item, props);
    std::string src = text(props["src"]);
    std::optional<Picture> known = pictureAt(src);
    bool missing = src.empty() || (known && known->missing);
    std::optional<float> aspect = aspectOf(src);
    float tall = missing ? 120 : std::min(Sheet::width / aspect.value_or(1.35f), std::min(420.f, sheet.most));
    sheet.picture = CGRect{Sheet::left * sheet.k, (sheet.y + Sheet::gap) * sheet.k, Sheet::width * sheet.k, tall * sheet.k};
    Words words = item.words;
    sheet.part(tall, [src, tall, words, aspect, missing](const Pen& pen, float y) {
        CGRect box = pen.px(Sheet::left, y, Sheet::width, tall);
        pen.ctx.setFillColor(palette::media);
        pen.ctx.fill(box);
        pen.picture(src, aspect && !missing ? contained(box, *aspect) : box, false, words);
        pen.mask(box, 14 * pen.k, palette::glass);
    });
    std::vector<Chip> listed = sources(item);
    bool named = std::any_of(listed.begin(), listed.end(), [&](const Chip& c) { return c.full == p.holder; });
    float gap = Sheet::gap;
    auto line = [&](const std::string& s, Color color, float margin) {
        if (s.empty()) return;
        paragraph(sheet, s, LABEL, color, gap + margin);
        gap = 0;
    };
    line(p.by, palette::ink, 2);
    line(p.medium, palette::ink2, 0);
    line(named ? "" : p.holder, palette::ink3, 0);
}

std::vector<std::string> pictures(const Json& props) { return {text(props["src"])}; }

Kind make() {
    Kind k{"artwork", size, {"holder", "date"}, draw, detail, pictures};
    k.radius = 4;
    k.opens = Kind::Opens::picture;
    return k;
}

const Kind kind = make();
const Registered registered{kind};

}  // namespace

}  // namespace cards
