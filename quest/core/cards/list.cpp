// components/list.js: entries in no order, each after a dot, or a checklist with a tick box for each and its tally by the title.
#include <algorithm>
#include <optional>

#include "face.h"
#include "parts.h"
#include "rows.h"

namespace cards {

namespace {

constexpr int WIDTH = 256;
constexpr int COLUMN = WIDTH - SIDES;
constexpr int SHOWN = 6;
/// A mark and the gap after it.
constexpr int MARK = 20;
constexpr int GAP = 5;

/// JavaScript's `Boolean(value)`.
bool truthy(const Json& value) {
    switch (value.type()) {
    case Json::Type::null: return false;
    case Json::Type::boolean: return value.boolean();
    case Json::Type::number: return value.number() != 0;
    case Json::Type::string: return !value.string().empty();
    default: return true;
    }
}

struct Plan {
    std::vector<std::string> entries;
    /// One mark for each entry, on a checklist.
    std::optional<std::vector<bool>> checked;
    std::string title, tally;
    int titleLines = 1;
    std::vector<int> rows;
};

Plan plan(const Item& item, const Json& props) {
    Plan p;
    for (const Json& entry : props["items"].array()) p.entries.push_back(trimmed(entry));
    const std::vector<Json>& marks = props["checked"].array();
    if (marks.size() == p.entries.size() && !p.entries.empty()) {
        p.checked.emplace();
        for (const Json& mark : marks) p.checked->push_back(truthy(mark));
        p.tally = std::to_string(std::count(p.checked->begin(), p.checked->end(), true)) + "/" + std::to_string(p.entries.size());
    }
    p.title = item.titleOrUntitled();
    p.titleLines = wrap(points(p.title), COLUMN - (p.tally.empty() ? 0 : 10 + textWidth(points(p.tally))), TITLE_LETTER, 2);
    for (size_t i = 0; i < std::min(p.entries.size(), size_t(SHOWN)); i++) p.rows.push_back(wrap(points(p.entries[i]), COLUMN - MARK, TEXT_LETTER, 2));
    return p;
}

/// `.list-dot`, or `.list-box` filled and ticked for a done entry, 12 px square at (x, y).
void mark(const Pen& pen, std::optional<bool> done, float x, float y, Color accent, Color ink3, Color face) {
    float k = pen.k;
    if (!done) {
        pen.ctx.setFillColor(accent);
        pen.ctx.fillEllipse(pen.px(x + 4, y + 4, 4, 4));
        return;
    }
    pen.rounded(pen.px(x + 0.75f, y + 0.75f, 10.5f, 10.5f), 2.5f * k);
    if (*done) {
        pen.ctx.setFillColor(accent);
        pen.ctx.fillPath();
        pen.rounded(pen.px(x + 0.75f, y + 0.75f, 10.5f, 10.5f), 2.5f * k);
    }
    pen.ctx.setStrokeColor(*done ? accent : ink3);
    pen.ctx.setLineWidth(1.2f * k);
    pen.ctx.strokePath();
    if (!*done) return;
    pen.ctx.setStrokeColor(face);
    pen.ctx.setLineWidth(1.6f * k);
    pen.ctx.setLineCap(Canvas::LineCap::round);
    pen.ctx.setLineJoin(Canvas::LineJoin::round);
    pen.ctx.move(CGPoint{(x + 3.2f) * k, (y + 6.2f) * k});
    pen.ctx.addLine(CGPoint{(x + 5.2f) * k, (y + 8.2f) * k});
    pen.ctx.addLine(CGPoint{(x + 8.9f) * k, (y + 4) * k});
    pen.ctx.strokePath();
}

std::optional<bool> doneAt(const Plan& p, size_t i) { return p.checked ? std::optional((*p.checked)[i]) : std::nullopt; }


/// `[\p{L}\p{N}]`, near enough: what is not white space, a mark, punctuation or a symbol.
bool wordy(char32_t c) {
    if (c < 0x80) return (c >= '0' && c <= '9') || (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z');
    if (isSpace(c)) return false;
    static const std::pair<char32_t, char32_t> signs[] = {
        {0x80, 0xa9},     {0xab, 0xb1},     {0xb4, 0xb4},     {0xb6, 0xb8},     {0xbb, 0xbb},     {0xbf, 0xbf},     {0xd7, 0xd7},
        {0xf7, 0xf7},     {0x300, 0x36f},   {0x2000, 0x206f}, {0x20a0, 0x20cf}, {0x2190, 0x2bff}, {0x3000, 0x3004}, {0x3008, 0x3020},
        {0x3030, 0x3030}, {0x303d, 0x303f}, {0xfe10, 0xfe6f}, {0xff01, 0xff0f}, {0xff1a, 0xff20}, {0xff3b, 0xff40}, {0xff5b, 0xff65},
        {0x1f000, 0x1faff}};
    return std::none_of(std::begin(signs), std::end(signs), [c](auto range) { return c >= range.first && c <= range.second; });
}

/// How long the run of bullets, numbers and tick boxes that starts `line` is: `^(?:(?:[-*•·]|\d+[.)、]|\[[ xX]\])\s*)+`.
size_t bullet(const Text& line) {
    size_t i = 0, n = line.size();
    for (;;) {
        size_t j = i;
        auto digit = [&](size_t at) { return at < n && line[at] >= '0' && line[at] <= '9'; };
        if (j < n && (line[j] == '-' || line[j] == '*' || line[j] == 0x2022 || line[j] == 0xb7)) {
            j++;
        } else if (digit(j)) {
            while (digit(j)) j++;
            if (j < n && (line[j] == '.' || line[j] == ')' || line[j] == 0x3001)) j++;
            else return i;
        } else if (j + 2 < n && line[j] == '[' && (line[j + 1] == ' ' || line[j + 1] == 'x' || line[j + 1] == 'X') && line[j + 2] == ']') {
            j += 3;
        } else {
            return i;
        }
        while (j < n && isSpace(line[j])) j++;
        i = j;
    }
}

/// list.js's `written`: each entry as a bulleted line of the item's text writes it, when that line starts with the
/// entry as a whole word and says more, so the opened list says it whole and once.
std::vector<std::string> written(const Item& item, const std::vector<std::string>& entries) {
    std::vector<Text> lines;
    Text all = points(item.text);
    for (size_t start = 0; start <= all.size();) {
        size_t end = std::min(all.find(U'\n', start), all.size());
        Text line = trim(all.substr(start, end - start));
        if (size_t b = bullet(line)) lines.push_back(trim(line.substr(b)));
        start = end + 1;
    }
    std::vector<std::string> out;
    for (const std::string& entry : entries) {
        Text label = points(entry);
        auto found = std::find_if(lines.begin(), lines.end(), [&](const Text& line) {
            return line.size() > label.size() && line.compare(0, label.size(), label) == 0 && !wordy(line[label.size()]);
        });
        bool whole = label.empty() || std::find(lines.begin(), lines.end(), label) != lines.end();
        out.push_back(whole || found == lines.end() ? entry : utf8(*found));
    }
    return out;
}

/// `.list.is-full`: every entry whole, at 14 px on 20 px lines, 8 px apart.
void entriesDetail(Sheet& sheet, const Item& item, const std::vector<std::string>& entries, const std::optional<std::vector<bool>>& checked) {
    constexpr Setting line{15, 21, Font::Weight::medium};
    std::vector<std::string> labels = written(item, entries);
    float column = Sheet::width - MARK;
    std::vector<float> rows;
    float tall = 0;
    for (const std::string& label : labels) {
        rows.push_back(std::max(16.f, heightOf(label, column, 0, line, sheet.k)));
        tall += rows.back() + (rows.size() > 1 ? 8 : 0);
    }
    Color accent = sheet.look.accent;
    sheet.part(tall, [=](const Pen& pen, float y) {
        for (size_t i = 0; i < labels.size(); i++) {
            std::optional<bool> done = checked ? std::optional((*checked)[i]) : std::nullopt;
            mark(pen, done, Sheet::left, y + 4, accent, palette::ink3, palette::face);
            pen.words(labels[i], Sheet::left + MARK, y, column, 0, line, done.value_or(false) ? palette::ink2 : palette::ink);
            y += rows[i] + 8;
        }
    });
    for (const std::string& label : labels) sheet.said.push_back(label);
}

/// The title with a checklist's tally, then entries after their marks, each whole, and the cue.
void lay(Col& c, const Item& item, const Json& props) {
    Plan p = plan(item, props);
    float tally = p.tally.empty() ? 0 : std::ceil(float(textWidth(points(p.tally)))) + 10;
    c.width -= tally;
    c.lines(p.title, Measure::title, 2, palette::ink, p.entries.empty() ? 0 : 10 + face::BODY);
    c.width += tally;
    if (c.pen && !p.tally.empty()) c.say(p.tally, setting::faceMeta, 1, c.x + c.width - tally + 10, face::TOP + 3, tally, palette::ink2);
    c.gap(10);
    const int column = face::COL - MARK;
    size_t i = 0;
    for (; i < p.entries.size(); i++) {
        int need = counted(p.entries[i], column, Measure::body);
        int shown = std::min(need, 2);
        bool after = i + 1 < p.entries.size() || need > shown;
        float tall = (i > 0 ? float(GAP) : 0.f) + float(shown * face::BODY);
        if (tall + (after ? face::CUE : 0) > c.room()) break;
        if (need > shown) c.more = true;
        if (i > 0) c.gap(GAP);
        if (c.pen) {
            mark(*c.pen, doneAt(p, i), c.x, c.y + 5, c.look.accent, palette::ink2, c.look.fill);
            c.say(p.entries[i], setting::faceBody, shown, c.x + MARK, c.y, float(column), palette::ink);
        }
        c.gap(float(shown * face::BODY));
    }
    if (i < p.entries.size()) c.more = true;
    if (c.more) c.cue(i < p.entries.size() ? cueCount(c.words, int(p.entries.size() - i)) : cueMore(c.words));
}

Footprint size(const Item& item, const Json& props) {
    return footprint(item, [&](Col& c) { lay(c, item, props); });
}

void draw(const Pen& pen, const Look& look, const Item& item, const Json& props, float, float) {
    drawFace(pen, look, item, [&](Col& c) { lay(c, item, props); });
}



void detail(Sheet& sheet, const Item& item, const Json& props) {
    Plan p = plan(item, props);
    entriesDetail(sheet, item, p.entries, p.checked);
}

const Kind kind{"list", size, {}, draw, detail};
const Registered registered{kind};

}  // namespace

void entryMark(const Pen& pen, float x, float y, const Look& look) { mark(pen, std::nullopt, x, y, look.accent, look.ink3, look.fill); }

void listEntries(Sheet& sheet, const Item& item, const std::vector<std::string>& entries) { entriesDetail(sheet, item, entries, std::nullopt); }

}  // namespace cards
