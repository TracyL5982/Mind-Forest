// components/reference.js: a library card. Its kind and year over a rule, then the title, who wrote it and where it appeared.
#include <algorithm>

#include "face.h"
#include "rows.h"

namespace cards {

namespace {

constexpr int WIDTH = 288;
constexpr int COLUMN = WIDTH - SIDES;
/// The line that names the kind and the year, with the rule under it.
constexpr int HEAD = 24;

struct Plan {
    std::string title, authors, venue, label, year;
    int titleLines = 1, authorLines = 0, venueLines = 0;
};

/// words.js's `paper`, `book` and `others`, which `Words` does not hold.
std::string kindWord(const Words& words, bool book) { return words.chinese ? (book ? "图书" : "论文") : (book ? "Book" : "Paper"); }
std::string others(const Words& words) { return words.chinese ? " 等" : " and others"; }

Plan plan(const Item& item, const Json& props) {
    Plan p;
    std::string names;
    for (const Json& name : props["authors"].array()) {
        if (std::string n = trimmed(name); !n.empty()) names += (names.empty() ? "" : ", ") + n;
    }
    p.authors = names.empty() ? "" : names + (props["more"].boolean() ? others(item.words) : "");
    p.venue = trimmed(props["venue"]);
    p.label = kindWord(item.words, text(props["kind"]) == "book");
    p.year = trimmed(props["year"]);
    if (p.year.empty()) p.year = trimmed(item.data["date"]);
    p.title = item.titleOrUntitled();
    p.titleLines = wrap(points(p.title), COLUMN, TITLE_LETTER, 3);
    p.authorLines = p.authors.empty() ? 0 : wrap(points(p.authors), COLUMN, TEXT_LETTER, 2);
    p.venueLines = p.venue.empty() ? 0 : wrap(points(p.venue), COLUMN, TEXT_LETTER, 2);
    return p;
}

/// `.reference-head`: the kind, the year at the far end on the same baseline and cut to the room left, and the rule.
void head(const Pen& pen, const std::string& kind, const std::string& year, float x, float y, float column, bool face = false) {
    // On the small face in meta; on the opened card the kind is a label and the year is read.
    float size = face ? setting::faceLabelSize : setting::labelSize;
    const Setting& said = face ? setting::faceMeta : setting::body;
    label(pen, kind, x, y, palette::ink2, size);
    float room = column - labelWidth(kind, pen.k, size) - 10;
    float w = std::min(pen.width(year, said), room);
    pen.words(year, x + column - w, y, w + 0.5f, 1, said, palette::ink2);
    pen.ctx.setFillColor(palette::line2);
    pen.ctx.fill(pen.px(x, y + TEXT + 6, column, 1));
}


/// A book's cover at the face's left, two by three as a cover stands, with the card's words beside it.
constexpr int COVER_WIDE = 54, COVER_TALL = 81, COVER_GAP = 12;

/// Its cover when it has one, then its kind and year over a rule, the title in two lines, and the first author, beside it.
void lay(Col& c, const Item& item, const Json& props) {
    Plan p = plan(item, props);
    std::string cover = text(props["cover"]);
    if (!cover.empty()) {
        if (c.pen) {
            CGRect box = c.pen->px(face::LEFT, face::TOP, COVER_WIDE, COVER_TALL);
            c.pen->ctx.setFillColor(palette::media);
            c.pen->ctx.fill(box);
            c.pen->picture(cover, box, true, c.words);
            c.pen->mask(box, 3 * c.pen->k, c.look.fill);
        }
        c.x = face::LEFT + COVER_WIDE + COVER_GAP;
        c.width = face::COL - COVER_WIDE - COVER_GAP;
    }
    if (c.pen) head(*c.pen, p.label, p.year, c.x, c.y, c.width, true);
    // Beside a cover the column is narrow, so the rule sits closer and a name may take a second line.
    c.gap(face::META + (cover.empty() ? 14 : 8));
    std::vector<std::string> names;
    for (const Json& a : props["authors"].array()) {
        std::string n = trimmed(a);
        if (!n.empty()) names.push_back(n);
    }
    if (!c.title(p.title)) return;
    if (!names.empty() && c.room() >= face::GAP + face::META) {
        c.gap(face::GAP);
        std::string first = names[0];
        int rest = int(names.size()) - 1 + (props["more"].boolean() ? 1 : 0);
        if (rest > 0) first += c.words.chinese ? " 等 " + std::to_string(rest + 1) + " 人" : " and " + std::to_string(rest) + (rest == 1 ? " other" : " others");
        c.lines(first, Measure::meta, cover.empty() ? 1 : 2, palette::ink2);
    }
    if (c.more) c.cue(cueMore(c.words));
    if (!cover.empty()) c.y = std::max(c.y, float(face::TOP + COVER_TALL));
}

Footprint size(const Item& item, const Json& props) {
    return footprint(item, [&](Col& c) { lay(c, item, props); });
}

void draw(const Pen& pen, const Look& look, const Item& item, const Json& props, float, float) {
    drawFace(pen, look, item, [&](Col& c) { lay(c, item, props); });
}



/// `.detail-reference`: the head again in a box, then the authors and the venue whole, each left out when
/// the opened card's list of sources says it in the same words. A cut list of authors says so, so it stays.
void detail(Sheet& sheet, const Item& item, const Json& props) {
    constexpr Setting line{15, 21, Font::Weight::medium};
    Plan p = plan(item, props);
    // The cover whole, before the head, small enough that the head shows under it in the first view.
    if (std::string cover = text(props["cover"]); !cover.empty()) {
        float aspect = aspectOf(cover).value_or(2.f / 3), tall = std::min(150.f, sheet.most), wide = std::min(Sheet::width, tall * aspect);
        sheet.picture = CGRect{Sheet::left * sheet.k, (sheet.y + (sheet.first ? 0 : Sheet::gap)) * sheet.k, wide * sheet.k, tall * sheet.k};
        Words words = item.words;
        sheet.part(tall, [cover, wide, tall, words](const Pen& pen, float y) {
            CGRect box = pen.px(Sheet::left, y, wide, tall);
            pen.ctx.setFillColor(palette::media);
            pen.ctx.fill(box);
            pen.picture(cover, box, false, words);
            pen.mask(box, 6 * pen.k, palette::glass);
        });
    }
    std::vector<Chip> listed = sources(item);
    auto unlisted = [&](const std::string& s) {
        return std::none_of(listed.begin(), listed.end(), [&](const Chip& chip) { return chip.text == s; }) ? s : "";
    };
    std::string authors = unlisted(p.authors), venue = unlisted(p.venue), kind = p.label, year = p.year;
    float column = Sheet::width - 32;
    float authorsTall = authors.empty() ? 0 : 10 + heightOf(authors, column, 0, line, sheet.k);
    float venueTall = venue.empty() ? 0 : 2 + heightOf(venue, column, 0, line, sheet.k);
    float tall = 1 + 13 + HEAD + authorsTall + venueTall + 13 + 1;
    Look look = sheet.look;
    sheet.part(tall, [=](const Pen& pen, float y) {
        CGRect r = pen.px(Sheet::left, y, Sheet::width, tall);
        pen.ctx.setFillColor(palette::face);
        pen.rounded(r, 12 * pen.k);
        pen.ctx.fillPath();
        float x = Sheet::left + 16, top = y + 14;
        head(pen, kind, year, x, top, column);
        top += HEAD;
        if (!authors.empty()) pen.words(authors, x, top + 10, column, 0, line, palette::ink);
        top += authorsTall;
        if (!venue.empty()) pen.words(venue, x, top + 2, column, 0, line, palette::ink2);
        float edge = pen.k;
        pen.ctx.setStrokeColor(look.accent.withAlphaComponent(0.3f));
        pen.ctx.setLineWidth(edge);
        pen.rounded(CGRect{r.minX() + edge / 2, r.minY() + edge / 2, r.width() - edge, r.height() - edge}, 12 * pen.k - edge / 2);
        pen.ctx.strokePath();
    });
    for (const std::string& s : {kind, year, authors, venue}) {
        if (!s.empty()) sheet.said.push_back(s);
    }
}

std::vector<std::string> pictures(const Json& props) { return {text(props["cover"])}; }

Kind make() {
    Kind k{"reference", size, {"venue", "date", "authors"}, draw, detail, pictures};
    k.opens = Kind::Opens::link;
    return k;
}

const Kind kind = make();
const Registered registered{kind};

}  // namespace

}  // namespace cards
