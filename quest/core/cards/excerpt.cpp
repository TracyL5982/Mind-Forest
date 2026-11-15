// components/excerpt.js: a passage in an upright serif beside a rule, over the name of what it is from.
#include <algorithm>

#include "face.h"
#include "kind.h"

namespace cards {

namespace {

constexpr int WIDTH = 288;
/// The rule down the passage's left side and the gap after it.
constexpr int RULE = 14;
constexpr int LINE = WIDTH - PADDING - RULE;
constexpr int MOST_LINES = 6;
/// `.excerpt-text`: the quote's serif, set upright.
constexpr Setting PASSAGE{16, 21, Font::Weight::regular, true};

std::string joined(const std::vector<std::string>& parts, const char* between) {
    std::string out;
    for (const std::string& part : parts) out += (out.empty() ? "" : between) + part;
    return out;
}

/// The line the Scout ends a page's text with: who made it, when, and the source it searched. Each part
/// as written, once.
std::string closing(const Item& item) {
    std::vector<std::string> parts;
    for (const char* key : {"by", "date", "from"}) {
        const Json& part = item.data[key];
        if (!part.isString() || trim(points(part.string())).empty()) continue;
        if (std::find(parts.begin(), parts.end(), part.string()) == parts.end()) parts.push_back(part.string());
    }
    return joined(parts, ", ");
}

/// The passage without that line, which the chips and the source line say again.
Text passage(const Item& item, const Json& props) {
    Text whole = trim(points(text(props["text"])));
    Text ending = points(closing(item));
    Text tail = U"\n\n" + ending;
    bool ends = !ending.empty() && whole.size() >= tail.size() && whole.compare(whole.size() - tail.size(), tail.size(), tail) == 0;
    return ends ? trim(whole.substr(0, whole.size() - ending.size())) : whole;
}

/// `at` and `source`, those that are set and are not the title again.
std::string whereOf(const Item& item, const Json& props) {
    std::string title = utf8(trim(points(item.title)));
    std::vector<std::string> parts;
    for (const char* key : {"at", "source"}) {
        std::string part = utf8(trim(points(text(props[key]))));
        if (!part.empty() && part != title) parts.push_back(part);
    }
    return joined(parts, " · ");
}

struct Plan {
    std::string words, where;
    int lines;
};

Plan plan(const Item& item, const Json& props) {
    Text words = squash(passage(item, props));
    return {utf8(words), whereOf(item, props), wrap(words, LINE, PASSAGE_LETTER, MOST_LINES)};
}

/// The passage upright in the serif beside a rule, then where it is from in meta, and the cue.
void lay(Col& c, const Item& item, const Json& props) {
    Plan p = plan(item, props);
    std::string from = !p.where.empty() ? p.where : item.title;
    if (!c.above(props)) {
        c.cue(cueMore(c.words));
        return;
    }
    // The source, often the title, is whole up to three lines, and the passage gives way to it.
    int fromNeed = from.empty() ? 0 : counted(from, face::COL, Measure::meta), fromLines = std::min(face::TITLE_LINES, fromNeed);
    float under = from.empty() ? 0 : 10 + float(fromLines * face::META) + (fromNeed > fromLines ? face::CUE : 0);
    float top = c.y;
    int quoted = c.lines(p.words, Measure::passage, 99, palette::ink, under, c.x + RULE, face::W - 46, c.width - RULE);
    if (c.pen) {
        c.pen->ctx.setFillColor(c.look.accent);
        c.pen->ctx.fill(c.pen->px(c.x, top, 2, c.y - top));
    }
    if (quoted > 0 && fromLines > 0) {
        c.gap(10);
        c.say(from, setting::faceMeta, fromLines, c.x, c.y, c.width, palette::ink2);
        c.y += float(fromLines * face::META);
        c.inked = c.y;
        if (fromNeed > fromLines) c.more = true;
    }
    if (c.more) c.cue(cueMore(c.words));
}

Footprint size(const Item& item, const Json& props) {
    return footprint(item, [&](Col& c) { lay(c, item, props); });
}

void draw(const Pen& pen, const Look& look, const Item& item, const Json& props, float, float) {
    drawFace(pen, look, item, [&](Col& c) { lay(c, item, props); });
}




/// `.detail-excerpt`: the passage whole, with its line breaks, and under it the maker the Scout's
/// closing line named, on a line of its own when the line of `at` and `source` does not hold it.
void detail(Sheet& sheet, const Item& item, const Json& props) {
    constexpr Setting whole{17, 24.65f, Font::Weight::regular, true};
    std::string said = utf8(passage(item, props)), where = whereOf(item, props);
    std::string by = utf8(trim(points(text(item.data["by"]))));
    if (where.find(by) != std::string::npos) by = "";
    float column = Sheet::width - RULE, k = sheet.k;
    float tall = heightOf(said, column, 0, whole, k);
    float byTall = by.empty() ? 0 : std::max(setting::body.lead, heightOf(by, Sheet::width, 0, setting::body, k));
    float whereTall = where.empty() ? 0 : std::max(setting::body.lead, heightOf(where, Sheet::width, 0, setting::body, k));
    float from = by.empty() && where.empty() ? 0 : 10 + byTall + whereTall;
    Color accent = sheet.look.accent;
    sheet.part(tall + from, [=](const Pen& pen, float y) {
        pen.ctx.setFillColor(accent);
        pen.ctx.fill(pen.px(Sheet::left, y, 2, tall));
        pen.words(said, Sheet::left + RULE, y, column, 0, whole, palette::ink);
        pen.words(by, Sheet::left, y + tall + 10, Sheet::width, 0, setting::body, palette::ink);
        pen.words(where, Sheet::left, y + tall + 10 + byTall, Sheet::width, 0, setting::body, palette::ink3);
    });
    for (const std::string& s : {said, by, where}) {
        if (!s.empty()) sheet.said.push_back(s);
    }
}

Kind make() { return Kind{"excerpt", size, {"site", "from"}, draw, detail}; }

const Kind kind = make();
const Registered registered{kind};

}  // namespace

}  // namespace cards
