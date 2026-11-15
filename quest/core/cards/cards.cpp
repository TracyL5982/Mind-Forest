// The cards notes show, their footprints, and their faces small and opened.
#include "cards.h"

#include <algorithm>
#include <cmath>
#include <ctime>
#include <map>

#include "said.h"

namespace cards {

namespace {

/// A view resolved: its type, and the props that type reads. An unknown component is a note with no props.
struct Resolved {
    const Kind* kind;
    Json props;
};
Resolved resolve(const Json& view) {
    if (const Kind* kind = kindNamed(text(view["component"]))) return {kind, view["props"].isObject() ? view["props"] : Json::object()};
    return {&note(), Json::object()};
}

struct Sized {
    Footprint size;
    /// The chips as the line draws them.
    std::vector<Chip> line;
};
Sized sized(const Kind& kind, const Item& item, const Json& props) {
    Footprint f = kind.size(item, props);
    std::vector<Chip> all = chips(item, kind.shows);
    if (all.empty()) return {f, {}};
    return {{f.width, f.height + CHIP_LINE}, fit(all, f.width - 2 - 2 * kind.chipInset)};
}

/// The opened card laid out once, for the page and picture heights it was asked for.
struct Laid {
    float k, pageTall, pictureTall;
    std::vector<Block> blocks;
    std::vector<Run> runs;
    std::optional<CGRect> picture;
    std::vector<Span> pages;
    bool cut = false;
};

struct Entry {
    std::string signature;
    Resolved view;
    Item item;
    Node node;
    Sized sized;
    int revision = 0;
    int generation = 0;
    /// Kept until the card is put again: a picture that comes later is drawn into it, and changes no size.
    std::optional<Laid> laid;
    /// Its first picture's width over its height, as known when its sizes were first asked for.
    std::optional<float> aspect;
};

std::map<std::string, Entry>& store() {
    static std::map<std::string, Entry> all;
    return all;
}
int revisions = 0, generations = 0;

std::string signature(const Json& view, const Json& item, const Node& node) {
    char tail[32];
    snprintf(tail, sizeof tail, "|%d%d|%d|", int(node.pick), int(node.root), int(node.tone));
    return view.dump() + "\x1f" + item.dump() + tail + node.why;
}

Look lookOf(const Entry& e) {
    const Kind& kind = *e.view.kind;
    const Node& node = e.node;
    Look look;
    look.accent = ::color(node.tone);
    look.radius = kind.radius;
    Color ground = node.pick ? palette::sunk : node.root ? palette::raised : palette::face;
    switch (kind.face) {
    case Kind::Face::plain: look.fill = ground; break;
    case Kind::Face::sunk: look.fill = palette::sunk; break;
    case Kind::Face::wash:
        look.fill = mix(look.accent, 0.14f, ground);
        look.ink2 = palette::meta;
        break;
    }
    look.edge = kind.face == Kind::Face::wash ? look.accent.withAlphaComponent(0.44f) : palette::line;
    if (node.root) look.edge = Color::white(1, 0.5f);
    if (node.pick) {
        look.edge = palette::pick;
        look.edgeWidth = 1.5f;
        look.dashed = true;
    }
    return look;
}

// MARK: - The opened card (panel.js)

const char* cameFrom(const Item& item, std::string& made) {
    static const std::map<std::string, const char*> how{{"paste", "You pasted this"},
                                                         {"drop", "You dropped this in"},
                                                         {"voice", "You said this"},
                                                         {"link", "A link you added"},
                                                         {"web", "Found on the web"},
                                                         {"instagram", "Found on Instagram"},
                                                         {"image-gen", "Made for you as a picture"},
                                                         {"idea", "An idea from the librarian"}};
    if (auto it = how.find(item.sourceFrom); it != how.end()) return it->second;
    if (item.sourceFrom.rfind("chat-export", 0) == 0) return "From a chat you exported";
    made = (item.agent ? "Brought by the librarian (" : "You added this (") + item.sourceFrom + ")";
    return made.c_str();
}

/// `toLocaleString([], {dateStyle: 'medium', timeStyle: 'short'})` of an ISO time, or "".
std::string when(const std::string& iso) {
    int y, mo, d, h = 0, mi = 0;
    double s = 0;
    if (sscanf(iso.c_str(), "%d-%d-%dT%d:%d:%lf", &y, &mo, &d, &h, &mi, &s) < 3) return "";
    std::tm t{};
    t.tm_year = y - 1900;
    t.tm_mon = mo - 1;
    t.tm_mday = d;
    t.tm_hour = h;
    t.tm_min = mi;
    t.tm_sec = int(s);
    time_t at = timegm(&t);
    std::tm local{};
    localtime_r(&at, &local);
    static const char* months[] = {"Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"};
    int hour = local.tm_hour % 12 == 0 ? 12 : local.tm_hour % 12;
    char out[64];
    snprintf(out, sizeof out, "%s %d, %d, %d:%02d %s", months[local.tm_mon], local.tm_mday, local.tm_year + 1900, hour, local.tm_min,
             local.tm_hour < 12 ? "AM" : "PM");
    return out;
}

const char* label(Chip::Kind kind) {
    switch (kind) {
    case Chip::Kind::when: return "When";
    case Chip::Kind::origin: return "Origin";
    case Chip::Kind::where: return "Where";
    case Chip::Kind::people: return "People";
    }
    return "";
}

constexpr float WIDTH = 384, TOP = 16, FOOT = 17, MARK = 22;
/// The least a picture is shrunk to so it stays on the first page, px.
constexpr float LEAST = 140;

/// The panel `end` px long cut into pages `tall` px tall: each page ends where a part does, or between two
/// lines of one. Only a part with no such place that is taller than a page is cut, and `cut` says so.
std::vector<Span> paginate(const std::vector<Block>& blocks, float end, float tall, bool& cut) {
    if (end + FOOT <= tall) return {Span{0, end}};
    std::vector<float> ends;
    for (const Block& b : blocks) {
        ends.push_back(b.top + b.height);
        for (float at : b.breaks) ends.push_back(b.top + at);
    }
    std::sort(ends.begin(), ends.end());
    std::vector<Span> pages;
    float from = 0;
    while (from < end) {
        float room = tall - (pages.empty() ? 0 : TOP) - FOOT - MARK, limit = from + room;
        if (end <= limit) {
            pages.push_back({from, end});
            break;
        }
        float to = from;
        for (float at : ends) {
            if (at > from + 1 && at <= limit) to = at;
        }
        if (to <= from) {
            to = limit;
            cut = true;
        }
        pages.push_back({from, to});
        from = to;
        // The gap between two parts starts no page.
        for (const Block& b : blocks) {
            if (b.top >= from - 0.5f) {
                from = std::max(from, std::min(b.top, end));
                break;
            }
        }
    }
    return pages;
}

/// The web's panel (panel.js) laid out top to bottom, its badge first.
Laid layOut(const Entry& e, float k, float pageTall, float pictureTall) {
    const Kind& kind = *e.view.kind;
    const Item& item = e.item;
    Look look = lookOf(e);
    Sheet sheet{k, look, item.words};
    bool pick = e.node.pick;

    // `.panel-head`: the badge.
    std::string badge = pick ? "Pick from the librarian" : e.node.root ? "Start of a tree" : "Kept";
    float badgeWidth = std::ceil(widthOf(badge, setting::badge, k)) + 22, badgeTall = 16.8f + 10;
    sheet.y = 1 + 10 + badgeTall + 6 + 4;
    sheet.blocks.push_back(Block{0, sheet.y, [=](const Pen& pen, float y) {
                                     Canvas& ctx = pen.ctx;
                                     ctx.setStrokeColor(pick ? palette::pick : palette::line2);
                                     ctx.setLineWidth(pen.k);
                                     if (pick) ctx.setLineDash(0, {3 * pen.k, 2.4f * pen.k});
                                     pen.rounded(pen.px(19.5f, y + 11.5f, badgeWidth - 1, badgeTall - 1), 10 * pen.k);
                                     ctx.strokePath();
                                     if (pick) ctx.setLineDash(0, {});
                                     pen.words(badge, 19 + 11, y + 11 + 5, badgeWidth, 1, setting::badge, palette::ink2);
                                 }});

    std::string title = item.titleOrUntitled();
    sheet.paragraph(title, setting::heading, palette::ink);
    if (!e.node.why.empty()) {
        std::string why = e.node.why;
        float tall = 16.1f + heightOf(why, Sheet::width, 0, setting::why, k);
        sheet.part(tall, [why, pick](const Pen& pen, float y) {
            pen.words("Why it is here", Sheet::left, y, Sheet::width, 1, setting::whyLabel, palette::ink3);
            pen.words(why, Sheet::left, y + 16.1f, Sheet::width, 0, setting::why, pick ? palette::ink2 : palette::ink);
        });
    }
    // A picture is no taller than what the first page has left under the title, or, when that is too little
    // to show one, than a page.
    float under = pageTall - FOOT - MARK - sheet.y - Sheet::gap;
    sheet.most = std::min(pictureTall, under >= LEAST ? under : pageTall - TOP - FOOT - MARK);
    kind.detail(sheet, item, e.view.props);

    // The sources, in full, as `chipSources` lists them.
    std::vector<std::pair<std::string, std::string>> facts;
    bool origin = false;
    for (const Chip& chip : sources(item)) {
        facts.push_back({label(chip.kind), chip.full});
        origin = origin || chip.kind == Chip::Kind::origin;
    }
    std::vector<std::string> said = sheet.said;
    said.insert(said.begin(), title);
    for (const auto& fact : facts) said.push_back(fact.second);
    Leftover left = leftover(item, said);
    sheet.paragraph(left.summary, setting::body, palette::ink);
    sheet.paragraph(left.text, setting::body, palette::ink2);

    if (!item.tags.empty()) {
        std::vector<std::pair<std::string, float>> pills;
        for (const std::string& tag : item.tags) pills.push_back({tag, std::ceil(widthOf(tag, setting::tag, k)) + 20});
        float x = 0, rows = 1;
        std::vector<float> breaks;
        float rowTall = 17.5f + 6;
        for (const auto& [tag, w] : pills) {
            if (x > 0 && x + w > Sheet::width) {
                breaks.push_back(rows * (rowTall + 6) - 3);
                rows += 1;
                x = 0;
            }
            x += w + 6;
        }
        sheet.part(
            rows * rowTall + (rows - 1) * 6,
            [pills, rowTall](const Pen& pen, float y) {
                float x = 0;
                for (const auto& [tag, w] : pills) {
                    if (x > 0 && x + w > Sheet::width) {
                        x = 0;
                        y += rowTall + 6;
                    }
                    pen.ctx.setFillColor(Color::white(1, 0.07f));
                    pen.rounded(pen.px(Sheet::left + x, y, w, rowTall), 10 * pen.k);
                    pen.ctx.fillPath();
                    pen.words(tag, Sheet::left + x + 10, y + 3, w - 19, 1, setting::tag, palette::ink2);
                    x += w + 6;
                }
            },
            breaks);
    }

    // `.facts`: a rule, then label and value in two columns.
    std::string made;
    if (!origin) facts.push_back({"From", cameFrom(item, made)});
    if (!item.url.empty()) {
        std::string shown = item.url;
        for (const char* scheme : {"https://", "http://"}) {
            if (shown.rfind(scheme, 0) == 0) shown = shown.substr(std::char_traits<char>::length(scheme));
        }
        facts.push_back({"Source", shown});
    }
    if (std::string added = when(item.capturedAt); !added.empty()) facts.push_back({"Added", added});
    float labels = 0;
    for (const auto& fact : facts) labels = std::max(labels, std::ceil(widthOf(fact.first, setting::fact, k)));
    float valueWidth = Sheet::width - labels - 14;
    std::vector<float> rows, breaks;
    float tall = 1 + 12;
    for (const auto& fact : facts) {
        if (!rows.empty()) breaks.push_back(tall - 3);
        rows.push_back(std::max(18.2f, heightOf(fact.second, valueWidth, 0, setting::fact, k)));
        tall += rows.back() + 6;
    }
    tall -= 6;
    sheet.part(
        tall,
        [facts, rows, labels, valueWidth, look](const Pen& pen, float y) {
            pen.ctx.setFillColor(palette::line);
            pen.ctx.fill(pen.px(Sheet::left, y, Sheet::width, 1));
            y += 13;
            for (size_t i = 0; i < facts.size(); i++) {
                pen.words(facts[i].first, Sheet::left, y, labels + 1, 1, setting::fact, look.ink3);
                pen.words(facts[i].second, Sheet::left + labels + 14, y, valueWidth, 0, setting::fact, look.ink2);
                y += rows[i] + 6;
            }
        },
        breaks);

    Laid laid{k, pageTall, pictureTall, std::move(sheet.blocks), std::move(sheet.runs), sheet.picture, {}, false};
    laid.pages = paginate(laid.blocks, sheet.y, pageTall, laid.cut);
    return laid;
}

Opened open(const std::string& noteID, const Entry& e) {
    const Laid& laid = *e.laid;
    float k = laid.k, width = WIDTH, height = laid.pageTall;
    int count = int(laid.pages.size());
    Opened out;
    out.key = "card-o:" + noteID + "#" + std::to_string(e.revision);
    out.size = CGSize{std::ceil(width * k), std::ceil(height * k)};
    out.cut = laid.cut;
    for (int i = 0; i < count; i++) {
        Span span = laid.pages[size_t(i)];
        float pad = i == 0 ? 0 : TOP, shift = (pad - span.from) * k;
        Opened::Page page;
        for (const Run& run : laid.runs) {
            float top = run.at.y / k;
            if (top + 1 < span.from || top >= span.to) continue;
            Run moved = run;
            moved.at.y += shift;
            page.runs.push_back(moved);
        }
        if (laid.picture && laid.picture->minY() / k >= span.from - 1 && laid.picture->minY() / k < span.to) {
            page.picture = CGRect{laid.picture->minX(), laid.picture->minY() + shift, laid.picture->width(), laid.picture->height()};
        }
        out.pages.push_back(page);
    }
    std::vector<Block> blocks = laid.blocks;
    std::vector<Span> pages = laid.pages;
    bool pick = e.node.pick;
    out.draw = [=](Canvas& ctx, int i) {
        Pen pen{ctx, k};
        Look panel;
        panel.fill = palette::glass;
        panel.edge = palette::line;
        panel.radius = 20;
        pen.face(width, height, panel);
        Span span = pages[size_t(i)];
        float pad = i == 0 ? 0 : TOP;
        ctx.saveGState();
        ctx.clip(pen.px(0, pad, width, span.to - span.from));
        for (const Block& b : blocks) {
            if (b.top < span.to && b.top + b.height > span.from) b.draw(pen, b.top - span.from + pad);
        }
        ctx.restoreGState();
        if (count > 1) {
            std::string mark = std::to_string(i + 1) + " / " + std::to_string(count);
            float w = std::ceil(widthOf(mark, setting::fact, k)) + 1;
            pen.words(mark, width - Sheet::left - w, height - FOOT - MARK + 4, w, 1, setting::fact, palette::ink3);
        }
        pen.edge(width, height, panel);
    };
    return out;
}

}  // namespace

Footprint footprint(const Json& view, const Json& item) {
    Resolved r = resolve(view);
    return sized(*r.kind, Item::from(item), r.props).size;
}

std::vector<Chip> chipsOf(const Json& view, const Json& item) {
    Resolved r = resolve(view);
    return sized(*r.kind, Item::from(item), r.props).line;
}

bool draws(const std::string& component) { return kindNamed(component) != nullptr; }

bool put(const std::string& noteID, const Json& view, const Json& item, const Node& node) {
    std::string sig = signature(view, item, node);
    auto it = store().find(noteID);
    if (it != store().end() && it->second.signature == sig) return false;
    Entry e;
    e.signature = sig;
    e.view = resolve(view);
    e.item = Item::from(item);
    e.node = node;
    e.sized = sized(*e.view.kind, e.item, e.view.props);
    e.revision = ++revisions;
    e.generation = ++generations;
    store()[noteID] = std::move(e);
    return true;
}

void drop(const std::string& noteID) { store().erase(noteID); }

bool has(const std::string& noteID) { return store().count(noteID) > 0; }

std::vector<std::string> pictures(const std::string& noteID) {
    auto it = store().find(noteID);
    if (it == store().end() || !it->second.view.kind->pictures) return {};
    std::vector<std::string> out;
    for (const std::string& src : it->second.view.kind->pictures(it->second.view.props)) {
        if (!src.empty()) out.push_back(src);
    }
    return out;
}

std::vector<std::string> picture(const std::string& src, ImageRef image) {
    setPicture(src, Picture{image, image == nullptr});
    std::vector<std::string> changed;
    for (auto& [id, e] : store()) {
        if (!e.view.kind->pictures) continue;
        std::vector<std::string> shown = e.view.kind->pictures(e.view.props);
        if (std::find(shown.begin(), shown.end(), src) == shown.end()) continue;
        e.revision = ++revisions;
        changed.push_back(id);
    }
    return changed;
}

std::optional<Footprint> footprintOf(const std::string& noteID) {
    auto it = store().find(noteID);
    return it == store().end() ? std::nullopt : std::optional(it->second.sized.size);
}

int revision(const std::string& noteID) {
    auto it = store().find(noteID);
    return it == store().end() ? 0 : it->second.revision;
}

namespace {

/// A pick's kicker, as the ocean writes one over a note: capitals at Art::Size::micro on the small note,
/// bold, in the card's tone. The card's height is the web's, with no line to spare above the title, so the
/// kicker is a flat ink label over the top edge, left of the corner's curve; over a picture it is the same.
void suggested(const Pen& pen, const Look& look, const Kind& kind) {
    constexpr float size = Art::Size::micro * 240 / Metrics::smallNoteWidth;
    Setting t{size, size + 1, Font::Weight::bold};
    const std::string said = "SUGGESTED";
    float wide = std::ceil(pen.width(said, t)), left = kind.radius < 12 ? 1 : kind.radius;
    pen.ctx.setFillColor(Art::ink);
    pen.ctx.fill(pen.px(left, 0, wide + 12, 14.5f));
    pen.words(said, left + 6, 1.5f, wide + 1, 1, t, look.accent);
}

}  // namespace

std::optional<Drawn> small(const std::string& noteID, float k) {
    auto it = store().find(noteID);
    if (it == store().end()) return std::nullopt;
    const Entry& e = it->second;
    Look look = lookOf(e);
    Footprint f = e.sized.size;
    std::vector<Chip> line = e.sized.line;
    const Kind* kind = e.view.kind;
    Item item = e.item;
    Json props = e.view.props;
    float w = float(f.width), h = float(f.height), body = line.empty() ? h : h - CHIP_LINE;
    bool pick = e.node.pick;
    Drawn d;
    d.key = "card-s:" + noteID + "#" + std::to_string(e.revision);
    d.size = CGSize{std::ceil(w * k), std::ceil(h * k)};
    d.draw = [=](Canvas& ctx) {
        Pen pen{ctx, k};
        pen.face(w, h, look);
        kind->draw(pen, look, item, props, w, body);
        if (!line.empty()) pen.chips(line, 1 + float(kind->chipInset), h - 1 - float(kind->chipBottom) - 20, look);
        pen.corners(w, h, look.radius);
        pen.edge(w, h, look);
        if (pick) suggested(pen, look, *kind);
    };
    return d;
}

std::optional<Opened> opened(const std::string& noteID, float k, float pageTall, float pictureTall) {
    auto it = store().find(noteID);
    if (it == store().end()) return std::nullopt;
    Entry& e = it->second;
    if (!e.laid || e.laid->k != k || e.laid->pageTall != pageTall || e.laid->pictureTall != pictureTall) e.laid = layOut(e, k, pageTall, pictureTall);
    return open(noteID, e);
}

int generation(const std::string& noteID) {
    auto it = store().find(noteID);
    return it == store().end() ? 0 : it->second.generation;
}

const Kind* kindOf(const std::string& noteID) {
    auto it = store().find(noteID);
    return it == store().end() ? nullptr : it->second.view.kind;
}

std::optional<float> pictureAspect(const std::string& noteID) {
    auto it = store().find(noteID);
    if (it == store().end()) return std::nullopt;
    Entry& e = it->second;
    if (!e.aspect) {
        std::vector<std::string> shown = pictures(noteID);
        std::optional<float> known = shown.empty() ? std::nullopt : aspectOf(shown.front());
        double given = number(e.view.props["aspect"]);
        e.aspect = known ? *known : given > 0 ? float(given) : 1.35f;
    }
    return e.aspect;
}

}  // namespace cards
