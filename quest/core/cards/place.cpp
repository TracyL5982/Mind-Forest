// components/place.js: a name set large beside a round pin, under its picture when it has one, and
// under a map when the item holds a point.
#include <algorithm>
#include <cmath>

#include "figures.h"

namespace cards {

namespace {

constexpr int WIDTH = 256;
constexpr int COLUMN = WIDTH - SIDES;
constexpr int PICTURE = 120;
/// The map across the card under its picture, and in the opened card: a few kilometres around the place.
struct Map {
    int width, height, zoom;
};
constexpr Map MAP{WIDTH, 112, 12};
constexpr Map OPENED_MAP{348, 200, 12};
/// The round pin beside the name, and the gap after it.
constexpr int PIN = 28;
constexpr int NAME = COLUMN - PIN - 10;
/// `.map`: the plain ground a map is when no tile provider is named, as on the headset today.
constexpr Color GROUND = Art::well;

struct Point {
    double lat, lon;
};

/// map.js's `atOf`: `item.data.at` when it is a point on the earth.
std::optional<Point> atOf(const Json& value) {
    auto inRange = [](const Json& v, double most) { return v.isNumber() && std::isfinite(v.number()) && std::abs(v.number()) <= most; };
    if (!inRange(value["lat"], 90) || !inRange(value["lon"], 180)) return std::nullopt;
    return Point{value["lat"].number(), value["lon"].number()};
}

/// Each run of white space turned into one space, the ends kept (`replace(/\s+/g, ' ')`).
std::string spaced(const std::string& s) {
    Text out;
    bool gap = false;
    for (char32_t c : points(s)) {
        if (isSpace(c) && !gap) out += U' ';
        if (!isSpace(c)) out += c;
        gap = isSpace(c);
    }
    return utf8(out);
}

struct Plan {
    std::string name, about, src;
    std::optional<Point> at;
    /// The name is set in a figure's middle size while it fits on one line, and in the title's size on
    /// up to two when it does not.
    bool large = true;
    int nameLines = 1, headHeight = PIN, aboutLines = 0;
};

Plan plan(const Item& item, const Json& props) {
    Plan p;
    p.name = trimmed(props["name"]);
    if (p.name.empty()) p.name = item.titleOrUntitled();
    p.large = figureNeed(points(p.name), MIDDLE) <= NAME * 100;
    p.nameLines = p.large ? 1 : wrap(points(p.name), NAME, TITLE_LETTER, 2);
    const std::string& said = !item.summary.empty() ? item.summary : item.text;
    if (!said.empty() && said != p.name && said != item.title) p.about = spaced(said);
    p.src = trimmed(props["src"]);
    p.at = atOf(item.data["at"]);
    p.headHeight = std::max(PIN, p.large ? MIDDLE.lineHeight : p.nameLines * TITLE);
    p.aboutLines = p.about.empty() ? 0 : wrap(points(p.about), COLUMN, TEXT_LETTER, 3);
    return p;
}

Footprint size(const Item& item, const Json& props) {
    Plan p = plan(item, props);
    return {WIDTH, (p.src.empty() ? 0 : PICTURE) + (p.at ? MAP.height : 0) + FRAME + p.headHeight + (p.aboutLines ? 8 + p.aboutLines * TEXT : 0)};
}

/// A pin's outline, as map.js's PIN and the where glyph draw it in their own units: a drop pointing
/// down to `tip`, round at the top, its right side the mirror of its left.
struct Drop {
    CGPoint tip, c1, c2;
    float radius, middle;
};
constexpr Drop MAP_PIN{{11, 27}, {5.2f, 19.9f}, {2, 15.1f}, 9, 10.6f};
constexpr Drop GLYPH{{6, 10.8f}, {3.9f, 8.6f}, {2.7f, 6.8f}, 3.3f, 5.1f};

/// The drop as the current path, its units `scale` pixels from `origin` (pixels).
void trace(Canvas& ctx, const Drop& d, CGPoint origin, float scale) {
    auto to = [&](float x, float y) { return CGPoint{origin.x + x * scale, origin.y + y * scale}; };
    auto cubic = [&](CGPoint a, CGPoint b, CGPoint c, CGPoint e) {
        for (int i = 1; i <= 16; i++) {
            float t = float(i) / 16, u = 1 - t;
            ctx.addLine(to(u * u * u * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t * t * t * e.x,
                           u * u * u * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t * t * t * e.y));
        }
    };
    float cx = d.tip.x, r = d.radius;
    ctx.move(to(d.tip.x, d.tip.y));
    cubic(d.tip, d.c1, d.c2, {cx - r, d.middle});
    for (int i = 1; i <= 24; i++) {
        float a = float(M_PI) * (1 + float(i) / 24);
        ctx.addLine(to(cx + r * std::cos(a), d.middle + r * std::sin(a)));
    }
    cubic({cx + r, d.middle}, {2 * cx - d.c2.x, d.c2.y}, {2 * cx - d.c1.x, d.c1.y}, d.tip);
    ctx.closePath();
}

/// map.js's `project`: where a point falls on the whole world's map at a zoom, px.
std::pair<double, double> project(Point at, int zoom) {
    constexpr double EDGE = 85.0511287798;
    double world = 256 * std::pow(2.0, zoom);
    double sin = std::sin(std::max(-EDGE, std::min(EDGE, at.lat)) * M_PI / 180);
    return {(at.lon + 180) / 360 * world, (0.5 - std::log((1 + sin) / (1 - sin)) / (4 * M_PI)) * world};
}

/// map.js's `drawMap` with no tiles, in a box at (x, y) px `box` wide and the map's height: the plain
/// ground, and the pin at the centre, where `layout` puts it once the map's corner is on a whole px.
void map(const Pen& pen, float x, float y, float box, const Map& m, Point centre, Color accent, Color face) {
    Canvas& ctx = pen.ctx;
    ctx.setFillColor(GROUND);
    ctx.fill(pen.px(x, y, box, float(m.height)));
    auto [mx, my] = project(centre, m.zoom);
    double left = std::floor(mx - m.width / 2.0 + 0.5), top = std::floor(my - m.height / 2.0 + 0.5);
    float tipX = x + (box - float(m.width)) / 2 + float(mx - left), tipY = y + float(my - top);
    CGPoint origin{(tipX - 11) * pen.k, (tipY - 27) * pen.k};
    // `drop-shadow(0 2px 2px rgba(0, 0, 0, 0.45))`
    ctx.setFillColor(Color::black(0.3f));
    trace(ctx, MAP_PIN, CGPoint{origin.x, origin.y + 2 * pen.k}, pen.k);
    ctx.fillPath();
    ctx.setFillColor(accent);
    trace(ctx, MAP_PIN, origin, pen.k);
    ctx.fillPath();
    ctx.setStrokeColor(Color::black(0.6f));
    ctx.setLineWidth(1.2f * pen.k);
    ctx.setLineJoin(Canvas::LineJoin::miter);
    trace(ctx, MAP_PIN, origin, pen.k);
    ctx.strokePath();
    ctx.setFillColor(face);
    ctx.fillEllipse(CGRect{origin.x + (11 - 3.4f) * pen.k, origin.y + (10.5f - 3.4f) * pen.k, 6.8f * pen.k, 6.8f * pen.k});
}

/// `.place-head`: the round pin and the name beside it, in the middle of each other, from `top`; returns
/// how tall it draws. `lines` 0 for all of the name.
float head(const Pen& pen, const Plan& p, float x, float top, float width, int lines, Color accent, Color face) {
    float room = width - PIN - 10;
    float nameTall = p.large ? figureHeight(p.name, room, 0, MIDDLE, pen.k) : heightOf(p.name, room, lines, setting::title, pen.k);
    float tall = std::max(float(PIN), nameTall);
    float pinTop = top + (tall - PIN) / 2;
    Canvas& ctx = pen.ctx;
    CGRect disc = pen.px(x, pinTop, PIN, PIN);
    ctx.setFillColor(mix(accent, 0.18f, face));
    ctx.fillEllipse(disc);
    ctx.setStrokeColor(accent.withAlphaComponent(0.5f));
    ctx.setLineWidth(pen.k);
    ctx.strokeEllipse(pen.px(x - 0.5f, pinTop - 0.5f, PIN + 1, PIN + 1));
    float scale = 16.f / 12 * pen.k;
    CGPoint origin{(x + 6) * pen.k, (pinTop + 6) * pen.k};
    ctx.setStrokeColor(accent);
    ctx.setLineWidth(1.2f * scale);
    ctx.setLineCap(Canvas::LineCap::round);
    ctx.setLineJoin(Canvas::LineJoin::round);
    trace(ctx, GLYPH, origin, scale);
    ctx.strokePath();
    ctx.strokeEllipse(CGRect{origin.x + 5 * scale, origin.y + 4.1f * scale, 2 * scale, 2 * scale});
    float nameTop = top + (tall - nameTall) / 2;
    if (p.large) figure(pen, p.name, x + PIN + 10, nameTop, room, 0, MIDDLE, palette::ink);
    else pen.words(p.name, x + PIN + 10, nameTop, room, lines, setting::title, palette::ink);
    return tall;
}

void draw(const Pen& pen, const Look& look, const Item& item, const Json& props, float width, float) {
    Plan p = plan(item, props);
    float y = 1;
    if (!p.src.empty()) {
        CGRect frame = pen.px(1, 1, width - 2, PICTURE);
        pen.ctx.setFillColor(palette::media);
        pen.ctx.fill(frame);
        pen.picture(p.src, frame, true, item.words);
        y += PICTURE;
    }
    if (p.at) {
        map(pen, 1, y, width - 2, MAP, *p.at, look.accent, look.fill);
        // `.place-map`'s inset rule along its foot.
        pen.ctx.setFillColor(palette::line);
        pen.ctx.fill(pen.px(1, y + float(MAP.height) - 1, width - 2, 1));
        y += float(MAP.height);
    }
    y += 13 + head(pen, p, 16, y + 13, width - 32, p.nameLines, look.accent, look.fill);
    if (p.aboutLines) pen.words(p.about, 16, y + 8, width - 32, p.aboutLines, setting::text, look.ink2);
}

/// The picture whole, a larger map, and the name when neither the opened card's own title nor its
/// `Where` source is already the name.
void detail(Sheet& sheet, const Item& item, const Json& props) {
    Plan p = plan(item, props);
    if (!p.src.empty()) {
        std::optional<Picture> known = pictureAt(p.src);
        float tall = known && known->missing ? 120 : std::min(Sheet::width / aspectOf(p.src).value_or(1.35f), std::min(420.f, sheet.most));
        float top = sheet.y + (sheet.first ? 0 : Sheet::gap);
        sheet.picture = CGRect{Sheet::left * sheet.k, top * sheet.k, Sheet::width * sheet.k, tall * sheet.k};
        std::string src = p.src;
        Words words = item.words;
        sheet.part(tall, [src, tall, words](const Pen& pen, float y) {
            CGRect box = pen.px(Sheet::left, y, Sheet::width, tall);
            pen.ctx.setFillColor(palette::media);
            pen.ctx.fill(box);
            pen.picture(src, box, false, words);
            pen.mask(box, 14 * pen.k, palette::glass);
        });
    }
    Color accent = sheet.look.accent;
    if (p.at) {
        Point at = *p.at;
        sheet.part(float(OPENED_MAP.height), [at, accent](const Pen& pen, float y) {
            map(pen, Sheet::left, y, Sheet::width, OPENED_MAP, at, accent, palette::face);
            pen.mask(pen.px(Sheet::left, y, Sheet::width, float(OPENED_MAP.height)), 14 * pen.k, palette::glass);
        });
    }
    if (p.name == item.title || p.name == trimmed(item.data["where"])) return;
    float room = Sheet::width - PIN - 10;
    float nameTall = p.large ? figureHeight(p.name, room, 0, MIDDLE, sheet.k) : heightOf(p.name, room, 0, setting::title, sheet.k);
    sheet.part(std::max(float(PIN), nameTall), [p, accent](const Pen& pen, float y) { head(pen, p, Sheet::left, y, Sheet::width, 0, accent, palette::face); });
    sheet.said.push_back(p.name);
}

std::vector<std::string> pictures(const Json& props) { return {trimmed(props["src"])}; }

Kind make() {
    Kind k{"place", size, {"where"}, draw, detail, pictures};
    k.opens = Kind::Opens::picture;
    return k;
}

const Kind kind = make();
const Registered registered{kind};

}  // namespace

}  // namespace cards
