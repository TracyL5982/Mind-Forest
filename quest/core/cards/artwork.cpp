// components/artwork.js: the work whole on a mat a shade lighter than the card, over a plate that reads
// like a museum label.
#include <algorithm>

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
constexpr Setting LABEL{13.5f, 19};

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

Footprint size(const Item& item, const Json& props) {
    Plan p = plan(item, props);
    return {WIDTH, MAT + PLATE + p.titleLines * TITLE + (p.byLines ? 2 + p.byLines * TEXT : 0) + p.mediumLines * TEXT +
                       (p.holder.empty() ? 0 : TEXT)};
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

void draw(const Pen& pen, const Look& look, const Item& item, const Json& props, float width, float) {
    Plan p = plan(item, props);
    pen.ctx.setFillColor(mix(Color::white(), 0.07f, look.fill));
    pen.ctx.fill(pen.px(1, 1, width - 2, MAT));
    pen.ctx.setFillColor(palette::line);
    pen.ctx.fill(pen.px(1, MAT, width - 2, 1));
    std::string src = text(props["src"]);
    CGRect box = pen.px(15, 15, width - 30, MAT - 28);
    std::optional<Picture> known = pictureAt(src);
    std::optional<float> aspect = aspectOf(src);
    if (src.empty() || (known && known->missing)) {
        pen.picture(src, box, false, item.words);
    } else if (aspect) {
        CGRect work = contained(box, *aspect);
        lift(pen, work);
        pen.picture(src, work, false, item.words);
    }
    float x = 16, y = 1 + MAT + 10, column = width - 32;
    auto line = [&](const std::string& s, int lines, const Setting& t, Color color) {
        pen.words(s, x, y, column, lines, t, color);
        y += heightOf(s, column, lines, t, pen.k);
    };
    line(item.titleOrUntitled(), p.titleLines, setting::title, palette::ink);
    y += p.byLines ? 2 : 0;
    if (p.byLines) line(p.by, p.byLines, setting::text, palette::ink);
    if (p.mediumLines) line(p.medium, p.mediumLines, setting::text, look.ink2);
    if (!p.holder.empty()) line(p.holder, 1, setting::text, look.ink3);
}

/// The picture whole and the label's lines whole, without the holder when the opened card's list of
/// sources names it.
void detail(Sheet& sheet, const Item& item, const Json& props) {
    Plan p = plan(item, props);
    std::string src = text(props["src"]);
    std::optional<Picture> known = pictureAt(src);
    bool missing = src.empty() || (known && known->missing);
    std::optional<float> aspect = aspectOf(src);
    float tall = missing ? 120 : std::min(Sheet::width / aspect.value_or(1.35f), 420.f);
    sheet.picture = CGRect{Sheet::left * sheet.k, (sheet.y + Sheet::gap) * sheet.k, Sheet::width * sheet.k, tall * sheet.k};
    Words words = item.words;
    sheet.part(tall, [src, tall, words, aspect, missing](const Pen& pen, float y) {
        CGRect box = pen.px(Sheet::left, y, Sheet::width, tall);
        pen.ctx.setFillColor(Color::hex(0x0F1115));
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
    return k;
}

const Kind kind = make();
const Registered registered{kind};

}  // namespace

}  // namespace cards
