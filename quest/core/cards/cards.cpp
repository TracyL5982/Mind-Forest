// The cards notes show, their footprints, and their faces small and opened.
#include "cards.h"

#include <algorithm>
#include <cmath>
#include <ctime>
#include <map>

#include "face.h"
#include "said.h"

namespace cards {

namespace {

/// A view resolved: its type, and the props that type reads. An unknown component is a note with no props.
struct Resolved {
    const Kind* kind;
    Json props;
};
Resolved resolve(const Json& view) {
    // A card still composing stands as the in-progress card, whatever the rules drew it as meanwhile.
    if (view["composing"].isBool() && view["composing"].boolean()) return {kindNamed("composing"), Json::object()};
    if (const Kind* kind = kindNamed(text(view["component"]))) return {kind, view["props"].isObject() ? view["props"] : Json::object()};
    return {&note(), Json::object()};
}

struct Sized {
    Footprint size;
    /// The chips as the line draws them.
    std::vector<Chip> line;
};
/// The small face holds no chips on the Quest: they are listed on the opened card (the sizing spec, section 1).
/// The item as its small face reads it: with `data.shortTitle`, what the service gives a face of a title too long
/// for two lines, as its title when there is one (agents/docs/libraries.md, "Two titles of an item"). The
/// opened card keeps the whole title.
Item onFace(const Item& item) {
    Item face = item;
    if (std::string shortTitle = trimmed(item.data["shortTitle"]); !shortTitle.empty()) face.title = shortTitle;
    return face;
}
Sized sized(const Kind& kind, const Item& item, const Json& props) { return {kind.size(onFace(item), props), {}}; }

/// The opened card laid out once, for the view and picture heights it was asked for.
struct Laid {
    float k, viewTall, pictureTall;
    std::vector<Block> blocks;
    std::vector<Run> runs;
    std::optional<CGRect> picture;
    /// Where the panel ends, px.
    float end = 0;
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
    made = item.agent ? "Brought by the librarian" : "You added this";
    if (!item.sourceFrom.empty()) made += " (" + item.sourceFrom + ")";
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

constexpr float WIDTH = 384;
/// The panel shows through a window inside the card's frame, clear of its round corners, px.
constexpr float INSET_X = 3, INSET_Y = 10;
/// The least a picture is shrunk to so it shows whole in the first view, px.
constexpr float LEAST = 140;
/// The tallest panel a card draws, px: ten views or so, within what one texture holds.
constexpr float LONGEST = 3200;
/// The room under the panel's last part, px.
constexpr float FOOT = 16;

/// The web's panel (panel.js) laid out top to bottom, its badge first.
Laid layOut(const Entry& e, float k, float viewTall, float pictureTall) {
    const Kind& kind = *e.view.kind;
    const Item& item = e.item;
    Look look = lookOf(e);
    Sheet sheet{k, look, item.words};
    bool pick = e.node.pick;

    // `.panel-head`: the badge.
    std::string badge = kind.premade ? text(e.view.props["badge"]) : pick ? "Pick from the librarian" : e.node.root ? "Start of a tree" : "Kept";
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

    // An in-progress card shows none of its item's words until it is finished, opened or not.
    if (std::string(kind.name) == "composing") {
        kind.detail(sheet, item, e.view.props);
        return Laid{k, viewTall, pictureTall, std::move(sheet.blocks), std::move(sheet.runs), sheet.picture, std::min(sheet.y + FOOT, LONGEST)};
    }
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
    // A picture is no taller than what the first view has left under the title, or, when that is too little
    // to show one, than a view.
    float under = viewTall - INSET_Y - sheet.y - Sheet::gap;
    sheet.most = std::min(pictureTall, under >= LEAST ? under : viewTall - 2 * INSET_Y);
    sheet.fits = viewTall - INSET_Y - FOOT;
    // The item's own lines over its structure, in order, and the heads row over a structure of two columns.
    for (const Over& line : oversOf(e.view.props)) {
        sheet.paragraph(line.words, line.head ? setting::bodyHead : setting::body, palette::ink);
        sheet.said.push_back(line.words);
    }
    const std::string named = kind.name;
    if (std::optional<std::array<std::string, 2>> h = headsOf(e.view.props); h && (named == "facts" || named == "fact" || named == "chart" || named == "breakdown")) {
        const float half = std::floor((Sheet::width - 17) / 2);
        float tall = std::max(heightOf((*h)[0], half, 0, setting::body, k), heightOf((*h)[1], half, 0, setting::body, k));
        sheet.part(tall + 4 + 1, [h = *h, half, tall](const Pen& pen, float y) {
            pen.words(h[0], Sheet::left, y, half, 0, setting::body, palette::ink2);
            float w = std::min(half, std::ceil(pen.width(h[1], setting::body)) + 1);
            pen.words(h[1], Sheet::left + Sheet::width - w, y, w + 1, 0, setting::body, palette::ink2);
            pen.ctx.setFillColor(palette::line);
            pen.ctx.fill(pen.px(Sheet::left, y + tall + 4, Sheet::width, 1));
        });
        sheet.said.insert(sheet.said.end(), h->begin(), h->end());
    }
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

    if (kind.premade) return Laid{k, viewTall, pictureTall, std::move(sheet.blocks), std::move(sheet.runs), sheet.picture, std::min(sheet.y + FOOT, LONGEST)};

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
        rows.push_back(std::max(setting::body.lead, heightOf(fact.second, valueWidth, 0, setting::body, k)));
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
                pen.words(facts[i].second, Sheet::left + labels + 14, y, valueWidth, 0, setting::body, look.ink2);
                y += rows[i] + 6;
            }
        },
        breaks);

    return Laid{k, viewTall, pictureTall, std::move(sheet.blocks), std::move(sheet.runs), sheet.picture, std::min(sheet.y + FOOT, LONGEST)};
}

Opened open(const std::string& noteID, const Entry& e) {
    const Laid& laid = *e.laid;
    // The panel runs on until its end can stand at the window's foot.
    float k = laid.k, width = WIDTH, height = laid.viewTall, end = std::max(laid.end + INSET_Y, height);
    Opened out;
    out.key = "card-o:" + noteID + "#" + std::to_string(e.revision);
    out.size = CGSize{std::ceil(width * k), std::ceil(height * k)};
    out.window = CGRect{INSET_X * k, INSET_Y * k, (width - 2 * INSET_X) * k, (height - 2 * INSET_Y) * k};
    out.contentTall = std::ceil(end * k);
    out.runs = laid.runs;
    out.picture = laid.picture;
    out.frame = [=](Canvas& ctx) {
        Pen pen{ctx, k};
        Look panel;
        panel.fill = palette::glass;
        panel.edge = palette::line;
        panel.radius = 20;
        pen.face(width, height, panel);
        pen.edge(width, height, panel);
    };
    std::vector<Block> blocks = laid.blocks;
    out.content = [=](Canvas& ctx) {
        Pen pen{ctx, k};
        ctx.setFillColor(palette::glass);
        ctx.fill(pen.px(0, 0, width, end));
        for (const Block& b : blocks) {
            if (b.top < end) b.draw(pen, b.top);
        }
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

std::optional<Drawn> small(const std::string& noteID, float k) {
    auto it = store().find(noteID);
    if (it == store().end()) return std::nullopt;
    const Entry& e = it->second;
    Look look = lookOf(e);
    Footprint f = e.sized.size;
    const Kind* kind = e.view.kind;
    Item item = onFace(e.item);
    Json props = e.view.props;
    float w = float(f.width), h = float(f.height), body = h;
    bool pick = e.node.pick;
    Drawn d;
    d.key = "card-s:" + noteID + "#" + std::to_string(e.revision);
    d.size = CGSize{std::ceil(w * k), std::ceil(h * k)};
    d.draw = [=](Canvas& ctx) {
        Pen pen{ctx, k};
        pen.face(w, h, look);
        kind->draw(pen, look, item, props, w, body);
        pen.corners(w, h, look.radius);
        pen.edge(w, h, look);
        if (pick) kicker(pen, look, kind->radius);
    };
    return d;
}

std::optional<Drawn> frame(const std::string& noteID, float k) {
    auto it = store().find(noteID);
    if (it == store().end()) return std::nullopt;
    const Entry& e = it->second;
    Look look = lookOf(e);
    float w = float(e.sized.size.width), h = float(e.sized.size.height);
    Drawn d;
    d.key = "card-f:" + noteID + "#" + std::to_string(e.revision);
    d.size = CGSize{std::ceil(w * k), std::ceil(h * k)};
    d.draw = [=](Canvas& ctx) {
        Pen pen{ctx, k};
        pen.face(w, h, look);
        pen.corners(w, h, look.radius);
        pen.edge(w, h, look);
    };
    return d;
}

std::optional<Opened> opened(const std::string& noteID, float k, float viewTall, float pictureTall) {
    auto it = store().find(noteID);
    if (it == store().end()) return std::nullopt;
    Entry& e = it->second;
    if (!e.laid || e.laid->k != k || e.laid->viewTall != viewTall || e.laid->pictureTall != pictureTall) e.laid = layOut(e, k, viewTall, pictureTall);
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
