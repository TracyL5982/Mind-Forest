// components/swatch.js: the colours in a band across the top, then each by name with its value.
#include <algorithm>
#include <map>

#include "kind.h"
#include "media.h"

namespace cards {

namespace {

constexpr int WIDTH = 256;
constexpr int COLUMN = WIDTH - SIDES;
/// The band of colours across the top of the card.
constexpr int STRIP = 44;
constexpr size_t STRIP_MOST = 12;
/// The border, the padding above and below what is under the band, and 2 px to spare.
constexpr int FRAME_UNDER = 29;
constexpr int SHOWN = 6;
constexpr int GAP = 5;
/// `.swatch-rows.is-full`
constexpr Setting FULL{14, 20};

struct Colour {
    std::string name, value;
};

std::vector<Colour> colours(const Json& props) {
    std::vector<Colour> all;
    for (const Json& colour : props["colours"].array()) all.push_back({trimmed(colour["name"]), trimmed(colour["value"])});
    return all;
}

int hexDigit(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    return -1;
}

/// The colour `value` paints: a hex colour of 3, 4, 6 or 8 digits, or a colour name the web library's
/// samples use, in either case. Any other value is left unpainted, as the web leaves a name it does not know.
std::optional<Color> paint(const std::string& value) {
    static const std::map<std::string, uint32_t> names{{"black", 0x000000}, {"ivory", 0xFFFFF0}, {"lightgoldenrodyellow", 0xFAFAD2}};
    std::string v = value;
    std::transform(v.begin(), v.end(), v.begin(), [](unsigned char c) { return char(std::tolower(c)); });
    if (auto named = names.find(v); named != names.end()) return Color::hex(named->second);
    if (v.size() < 2 || v[0] != '#') return std::nullopt;
    size_t n = v.size() - 1;
    if (!(n == 3 || n == 4 || n == 6 || n == 8)) return std::nullopt;
    std::vector<float> parts;
    int each = n <= 4 ? 1 : 2;
    for (size_t i = 1; i < v.size(); i += size_t(each)) {
        int hi = hexDigit(v[i]), lo = each == 1 ? hi : hexDigit(v[i + 1]);
        if (hi < 0 || lo < 0) return std::nullopt;
        parts.push_back(float(hi * 16 + lo) / 255);
    }
    return Color{parts[0], parts[1], parts[2], parts.size() == 4 ? parts[3] : 1};
}

int titleLines(const Item& item) { return wrap(points(item.titleOrUntitled()), COLUMN, TITLE_LETTER, 2); }

Footprint size(const Item& item, const Json& props) {
    int all = int(colours(props).size()), rows = std::min(all, SHOWN);
    return {WIDTH, STRIP + FRAME_UNDER + titleLines(item) * TITLE + (rows ? 8 + rows * TEXT + (rows - 1) * GAP : 0) + (all > SHOWN ? 8 + TEXT : 0)};
}

/// `.swatch-dot`: the colour, edged by a black hairline inside and a light grey one outside. `box` is in pixels.
void dot(const Pen& pen, CGRect box, float radius, const std::string& value) {
    float line = pen.k;
    if (std::optional<Color> colour = paint(value)) {
        pen.ctx.setFillColor(*colour);
        pen.rounded(box, radius);
        pen.ctx.fillPath();
    }
    pen.ctx.setLineWidth(line);
    pen.ctx.setStrokeColor(Color::black());
    pen.rounded(box.insetBy(line / 2, line / 2), radius - line / 2);
    pen.ctx.strokePath();
    pen.ctx.setStrokeColor(palette::ink3);
    pen.rounded(box.insetBy(-line / 2, -line / 2), radius + line / 2);
    pen.ctx.strokePath();
}

/// One colour by name with its value at the right, or its value alone when it has no other name. `size`
/// is the dot's, `gap` the room on each side of the name.
void row(const Pen& pen, const Colour& colour, float x, float y, float width, int lines, const Setting& t, float size, float radius,
          float gap, float dotDrop) {
    dot(pen, pen.px(x, y + dotDrop, size, size), radius * pen.k, colour.value);
    bool both = colour.name != colour.value;
    float valueWidth = both ? pen.width(colour.value, t) : 0;
    float name = x + size + gap, room = x + width - name - gap - valueWidth;
    pen.words(colour.name, name, y, room, lines, t, palette::ink);
    if (both) pen.words(colour.value, x + width - valueWidth, y, valueWidth + 1, 1, t, palette::ink2);
}

void draw(const Pen& pen, const Look& look, const Item& item, const Json& props, float width, float) {
    std::vector<Colour> all = colours(props);
    CGRect strip = pen.px(1, 1, width - 2, STRIP);
    hatch(pen, strip, Art::ink, Art::panel, 6);
    pen.ctx.setFillColor(palette::line);
    pen.ctx.fill(pen.px(1, STRIP, width - 2, 1));
    size_t blocks = std::min(all.size(), STRIP_MOST);
    for (size_t i = 0; i < blocks; i++) {
        std::optional<Color> colour = paint(all[i].value);
        if (!colour) continue;
        float w = strip.width() / float(blocks);
        pen.ctx.setFillColor(*colour);
        pen.ctx.fill(CGRect{strip.minX() + float(i) * w, strip.minY(), w, strip.height()});
    }
    float x = 16, y = 1 + STRIP + 12, column = width - 32;
    std::string title = item.titleOrUntitled();
    int lines = titleLines(item);
    pen.words(title, x, y, column, lines, setting::title, palette::ink);
    y += heightOf(title, column, lines, setting::title, pen.k);
    if (all.empty()) return;
    y += 8;
    for (size_t i = 0; i < all.size() && int(i) < SHOWN; i++) {
        row(pen, all[i], x, y, column, 1, setting::text, 10, 5, 8, 3.5f);
        y += TEXT + GAP;
    }
    if (int(all.size()) > SHOWN) pen.words(item.words.more(int(all.size()) - SHOWN), x, y - GAP + 8, column, 1, setting::text, look.ink3);
}

/// Every colour, its dot larger and its name whole.
void detail(Sheet& sheet, const Item&, const Json& props) {
    constexpr float SIZE = 20, BETWEEN = 9;
    std::vector<Colour> all = colours(props);
    std::vector<float> rows;
    float tall = 0;
    for (const Colour& colour : all) {
        float valueWidth = colour.name != colour.value ? widthOf(colour.value, FULL, sheet.k) : 0;
        rows.push_back(std::max(SIZE, heightOf(colour.name, Sheet::width - SIZE - 20 - valueWidth, 0, FULL, sheet.k)));
        tall += rows.back() + (tall > 0 ? BETWEEN : 0);
        sheet.said.push_back(colour.name);
        if (colour.name != colour.value) sheet.said.push_back(colour.value);
    }
    sheet.part(tall, [all, rows](const Pen& pen, float y) {
        for (size_t i = 0; i < all.size(); i++) {
            row(pen, all[i], Sheet::left, y, Sheet::width, 0, FULL, SIZE, 5, 10, 0);
            y += rows[i] + BETWEEN;
        }
    });
}

const Kind kind{"swatch", size, {}, draw, detail};
const Registered registered{kind};

}  // namespace

}  // namespace cards
