// components/sheet.js: one card assembled from parts under one title, each part drawn as the card of its
// own kind draws it, each after the first under a hairline, and a picture in a band across the top.
#include <algorithm>
#include <cctype>

#include "face.h"
#include "figures.h"
#include "parts.h"

namespace cards {

namespace {

constexpr int WIDTH = 320;
constexpr int COLUMN = WIDTH - SIDES;
/// A picture leads the card in a band this tall, across its whole width.
constexpr int PICTURE = 140;
constexpr int TITLE_LINES = 3;
constexpr int TEXT_LINES = 6;
/// As many entries as a sheet's list may hold. A list sent with more counts the rest.
constexpr int ENTRIES = 8;
constexpr int PASSAGE_LINES = 5;
/// The text counts its lines in the whole line box, without the px to spare (see sheet.js).
constexpr int LINE = WIDTH - PADDING;
/// A passage's line: the whole line box less the rule down its left side and the gap after it.
constexpr int PASSAGE = LINE - 14;
/// The line of who said the words, less the short rule before them and the gap after it.
constexpr int BY = COLUMN - 22;
/// A part after the first is set apart by a hairline, with this much room above it and below it.
constexpr int ABOVE = 10;
constexpr int BELOW = 10;
constexpr int RULED = ABOVE + 1 + BELOW;
/// A list's mark and the gap after it, and the gap between two entries (list.js).
constexpr int MARK = 20;
constexpr int GAP = 5;
constexpr Setting PASSAGE_SET{16, 21, Font::Weight::regular, true};

/// Each run of white space turned into one space, the ends kept (`replace(/\s+/g, ' ')`).
std::string flat(const std::string& s) {
    Text out;
    bool gap = false;
    for (char32_t c : points(s)) {
        if (isSpace(c)) {
            if (!gap) out += U' ';
            gap = true;
        } else {
            out += c;
            gap = false;
        }
    }
    return utf8(out);
}

std::string lowered(std::string s) {
    for (char& c : s) c = char(std::tolower((unsigned char)c));
    return s;
}
std::string saidOf(const std::string& s) { return lowered(utf8(trim(points(flat(s))))); }

/// A text cut short with an ellipsis, as the rest of the line of the item's text that it opens.
std::string whole(const Item& item, const std::string& words) {
    std::string cut = words;
    if (cut.size() >= 3 && cut.compare(cut.size() - 3, 3, "\xE2\x80\xA6") == 0) cut.resize(cut.size() - 3);
    else if (cut.size() >= 3 && cut.compare(cut.size() - 3, 3, "...") == 0) cut.resize(cut.size() - 3);
    Text trimmedEnd = points(cut);
    while (!trimmedEnd.empty() && isSpace(trimmedEnd.back())) trimmedEnd.pop_back();
    cut = utf8(trimmedEnd);
    if (cut == words || cut.empty()) return words;
    size_t start = 0;
    while (start <= item.text.size()) {
        size_t end = std::min(item.text.find('\n', start), item.text.size());
        std::string line = flat(item.text.substr(start, end - start));
        if (size_t at = line.find(cut); at != std::string::npos) return utf8(trim(points(line.substr(at))));
        start = end + 1;
    }
    return words;
}

/// One part of the column, as sheet.js's PARTS plans it.
struct Part {
    enum class Kind { text, figures, list, table, excerpt } kind;
    Json section;
    int lead = 0, height = 0;
    std::string words, passage, by;
    int lines = 0, byLines = 0;
    std::vector<std::string> entries;
    std::vector<int> rows;
    int more = 0;
    /// Every string the part draws on the card.
    std::vector<std::string> says;
};

std::optional<Part> partOf(const Json& section, const Item& item) {
    std::string kind = text(section["kind"]);
    Part p;
    p.section = section;
    if (kind == "text") {
        p.kind = Part::Kind::text;
        p.lead = 6;
        p.words = flat(trimmed(section["text"]));
        if (p.words.empty()) return std::nullopt;
        p.lines = wrap(points(p.words), LINE, TEXT_LETTER, TEXT_LINES);
        p.height = p.lines * TEXT;
        p.says = {p.words};
    } else if (kind == "figures") {
        p.kind = Part::Kind::figures;
        p.lead = 12;
        p.says = figureWords(section);
        if (p.says.empty()) return std::nullopt;
        p.height = figuresHeight(section);
    } else if (kind == "list") {
        p.kind = Part::Kind::list;
        p.lead = 10;
        for (const Json& one : section["items"].array()) p.entries.push_back(trimmed(one));
        for (size_t i = 0; i < std::min(p.entries.size(), size_t(ENTRIES)); i++) p.rows.push_back(wrap(points(p.entries[i]), COLUMN - MARK, TEXT_LETTER, 2));
        if (p.rows.empty()) return std::nullopt;
        p.more = int(p.entries.size() - p.rows.size());
        int stacked = GAP * (int(p.rows.size()) - 1);
        for (int lines : p.rows) stacked += lines * TEXT;
        p.height = stacked + (p.more > 0 ? 8 + TEXT : 0);
        p.says.assign(p.entries.begin(), p.entries.begin() + long(p.rows.size()));
    } else if (kind == "table") {
        p.kind = Part::Kind::table;
        p.lead = 8;
        std::optional<int> tall = tableHeight(item, section, COLUMN);
        if (!tall) return std::nullopt;
        p.height = *tall;
        p.says = tableWords(item, section, COLUMN);
    } else if (kind == "excerpt") {
        p.kind = Part::Kind::excerpt;
        p.lead = 10;
        std::string passage = trimmed(section["text"]);
        p.words = flat(passage);
        if (p.words.empty()) return std::nullopt;
        p.passage = passage;
        p.by = trimmed(section["by"]);
        p.lines = wrap(points(p.words), PASSAGE, PASSAGE_LETTER, PASSAGE_LINES);
        p.byLines = p.by.empty() ? 0 : wrap(points(p.by), BY, TEXT_LETTER, 2);
        p.height = p.lines * TITLE + (p.by.empty() ? 0 : 4 + p.byLines * TEXT);
        p.says = {p.words, p.by};
    } else {
        return std::nullopt;
    }
    return p;
}

struct Plan {
    std::string heading, title, src;
    int titleLines = 1;
    std::vector<Part> parts;
};

Plan plan(const Item& item, const Json& props) {
    Plan p;
    std::vector<const Json*> sections;
    for (const Json& section : props["sections"].array()) {
        if (section.isObject()) sections.push_back(&section);
    }
    auto first = [&](const char* kind, const char* key) -> std::string {
        for (const Json* section : sections) {
            if (text((*section)["kind"]) == kind) return trimmed((*section)[key]);
        }
        return "";
    };
    p.heading = first("heading", "text");
    p.title = !p.heading.empty() ? p.heading : item.titleOrUntitled();
    p.src = first("picture", "src");
    p.titleLines = wrap(points(p.title), COLUMN, TITLE_LETTER, TITLE_LINES);
    for (const Json* section : sections) {
        if (std::optional<Part> part = partOf(*section, item)) p.parts.push_back(*part);
    }
    return p;
}

int aboveOf(const Part& part, size_t i) { return i == 0 ? part.lead : RULED; }

/// The `item.data` keys whose value the card draws as one of its strings, or a list of names when it
/// draws each name, so no chip says it again.
std::vector<std::string> shows(const Item& item, const Json& props) {
    Plan p = plan(item, props);
    std::vector<std::string> drawn;
    auto add = [&](const std::string& s) {
        std::string t = utf8(trim(points(s)));
        if (!t.empty()) drawn.push_back(t);
    };
    add(p.title);
    for (const Part& part : p.parts) {
        for (const std::string& s : part.says) add(s);
    }
    auto isDrawn = [&](const Json& value) { return value.isString() && std::count(drawn.begin(), drawn.end(), utf8(trim(points(value.string())))); };
    std::vector<std::string> out;
    for (const auto& [key, value] : item.data.members()) {
        std::vector<const Json*> names;
        for (const Json& name : value.array()) {
            if (name.isString() && !trim(points(name.string())).empty()) names.push_back(&name);
        }
        bool every = !names.empty() && std::all_of(names.begin(), names.end(), [&](const Json* name) { return isDrawn(*name); });
        if (isDrawn(value) || every) out.push_back(key);
    }
    return out;
}

/// `.sheet-by`: a short rule, then who said it.
void saidBy(const Pen& pen, const std::string& by, float x, float y, float column, int lines) {
    pen.ctx.setFillColor(palette::ink2);
    pen.ctx.fill(pen.px(x, y + 8.5f, 14, 1));
    pen.words(by, x + 22, y, column - 22, lines, setting::body, palette::ink2);
}

void drawPart(const Pen& pen, const Look& look, const Item& item, const Part& part, float x, float y, float column) {
    switch (part.kind) {
    case Part::Kind::text: pen.words(part.words, x, y, column, part.lines, setting::text, look.ink2); break;
    case Part::Kind::figures: drawFigures(pen, look, part.section, x, y, column); break;
    case Part::Kind::list: {
        for (size_t i = 0; i < part.rows.size(); i++) {
            entryMark(pen, x, y + 2.5f, look);
            pen.words(part.entries[i], x + MARK, y, column - MARK, part.rows[i], setting::text, palette::ink);
            y += float(part.rows[i] * TEXT + GAP);
        }
        if (part.more > 0) pen.words(item.words.more(part.more), x, y - GAP + 8, column, 1, setting::text, look.ink3);
        break;
    }
    case Part::Kind::table: drawTable(pen, look, item, part.section, COLUMN, x, y, column); break;
    case Part::Kind::excerpt:
        pen.ctx.setFillColor(look.accent);
        pen.ctx.fill(pen.px(x, y, 2, float(part.lines * TITLE)));
        pen.words(part.words, x + 14, y, column - 14, part.lines, PASSAGE_SET, palette::ink);
        if (!part.by.empty()) saidBy(pen, part.by, x, y + float(part.lines * TITLE + 4), column, part.byLines);
        break;
    }
}


/// The title and the first part as its own preview in at most 68 px, and the cue counting the other parts.
void lay(Col& c, const Item& item, const Json& props) {
    Plan p = plan(item, props);
    if (!c.title(p.title)) return;
    if (!p.parts.empty() && c.above(props)) {
        const Part& part = p.parts.front();
        c.gap(face::GAP);
        float top = c.y, most = std::min(68.f, c.room() - (p.parts.size() > 1 ? face::CUE : 0));
        switch (part.kind) {
        case Part::Kind::text: c.lines(part.words, Measure::body, int(most / face::BODY), c.look.ink2); break;
        case Part::Kind::excerpt: c.lines(part.words, Measure::passage, int(most / face::BODY), palette::ink); break;
        case Part::Kind::list: {
            size_t n = std::min(part.entries.size(), size_t(std::max(0, int((most + 5) / (face::BODY + 5)))));
            for (size_t i = 0; i < n; i++) {
                if (i) c.gap(5);
                if (c.pen) entryMark(*c.pen, c.x, c.y + 5, c.look);
                c.lines(part.entries[i], Measure::body, 1, palette::ink, 0, c.x + MARK, face::COL - MARK);
            }
            if (part.entries.size() > n) c.more = true;
            break;
        }
        case Part::Kind::figures: {
            std::vector<std::string> said = figureWords(part.section);
            size_t n = most >= 28 + face::META ? std::min(said.size() / 2, size_t(2)) : 0;
            const float half = (face::COL - 17) / 2.f;
            for (size_t i = 0; i < n && c.pen; i++) {
                float left = c.x + float(i) * (half + 17);
                c.heldBack = figure(*c.pen, said[2 * i + 1], left, c.y, half, 1, MIDDLE, palette::ink) || c.heldBack;
                c.say(said[2 * i], setting::faceMeta, 1, left, c.y + 28, half, palette::ink2);
            }
            if (n > 0) c.gap(28 + face::META);
            if (said.size() / 2 > n) c.more = true;
            break;
        }
        case Part::Kind::table: {
            std::vector<std::string> said = tableWords(item, part.section, face::COL);
            c.lines(said.empty() ? "" : said[0], Measure::meta, 1, palette::ink2);
            c.more = true;
            break;
        }
        }
        c.y = std::min(c.y, top + most);
    }
    if (c.ended) {
        c.cue(cueParts(c.words, int(p.parts.size())));
    } else if (p.parts.size() > 1) {
        c.more = true;
        c.cue(cueParts(c.words, int(p.parts.size() - 1)));
    } else if (c.more) {
        c.cue(cueMore(c.words));
    }
}

Footprint size(const Item& item, const Json& props) {
    return footprint(item, [&](Col& c) { lay(c, item, props); });
}

void draw(const Pen& pen, const Look& look, const Item& item, const Json& props, float, float) {
    drawFace(pen, look, item, [&](Col& c) { lay(c, item, props); });
}



/// The picture whole, the heading when the opened card's title is not already it, and each part whole, in order.
void detail(Sheet& sheet, const Item& item, const Json& props) {
    Plan p = plan(item, props);
    if (!p.src.empty()) {
        std::string src = p.src;
        std::optional<Picture> known = pictureAt(src);
        bool missing = known && known->missing;
        float aspect = aspectOf(src).value_or(1.35f);
        float tall = missing ? 120 : std::min(Sheet::width / aspect, std::min(420.f, sheet.most));
        sheet.picture = CGRect{Sheet::left * sheet.k, (sheet.y + (sheet.first ? 0 : Sheet::gap)) * sheet.k, Sheet::width * sheet.k, tall * sheet.k};
        Words words = item.words;
        sheet.part(tall, [src, tall, words](const Pen& pen, float y) {
            CGRect box = pen.px(Sheet::left, y, Sheet::width, tall);
            pen.ctx.setFillColor(palette::media);
            pen.ctx.fill(box);
            pen.picture(src, box, false, words);
            pen.mask(box, 14 * pen.k, palette::glass);
        });
    }
    if (!p.heading.empty() && saidOf(p.heading) != saidOf(item.title)) sheet.paragraph(p.heading, setting::title, palette::ink);
    for (const Part& part : p.parts) {
        switch (part.kind) {
        case Part::Kind::text: sheet.paragraph(whole(item, part.words), setting::body, palette::ink); break;
        case Part::Kind::figures: listFigures(sheet, part.section); break;
        case Part::Kind::list: listEntries(sheet, item, part.entries); break;
        case Part::Kind::table: listTable(sheet, part.section); break;
        case Part::Kind::excerpt: {
            constexpr Setting passage{17, 24.65f, Font::Weight::regular, true};
            std::string said = part.passage, by = part.by;
            float column = Sheet::width - 14, k = sheet.k;
            float passageTall = heightOf(said, column, 0, passage, k);
            float byTall = by.empty() ? 0 : 4 + heightOf(by, Sheet::width - 22, 0, setting::body, k);
            Color accent = sheet.look.accent;
            sheet.part(passageTall + byTall, [=](const Pen& pen, float y) {
                pen.ctx.setFillColor(accent);
                pen.ctx.fill(pen.px(Sheet::left, y, 2, passageTall));
                pen.words(said, Sheet::left + 14, y, column, 0, passage, palette::ink);
                if (!by.empty()) saidBy(pen, by, Sheet::left, y + passageTall + 4, Sheet::width, 0);
            });
            sheet.said.push_back(said);
            if (!by.empty()) sheet.said.push_back(by);
            break;
        }
        }
    }
}

std::vector<std::string> pictures(const Json& props) {
    for (const Json& section : props["sections"].array()) {
        if (section.isObject() && text(section["kind"]) == "picture") return {trimmed(section["src"])};
    }
    return {};
}

Kind make() {
    Kind k{"sheet", size, {}, draw, detail, pictures};
    k.showsOf = shows;
    return k;
}

const Kind kind = make();
const Registered registered{kind};

}  // namespace

}  // namespace cards
