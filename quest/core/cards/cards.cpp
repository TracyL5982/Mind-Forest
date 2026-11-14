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

struct Entry {
    std::string signature;
    Resolved view;
    Item item;
    Node node;
    Sized sized;
    int revision = 0;
};

std::map<std::string, Entry>& store() {
    static std::map<std::string, Entry> all;
    return all;
}
int revisions = 0;

std::string signature(const Json& view, const Json& item, const Node& node) {
    Color a = node.accent;
    char tail[96];
    snprintf(tail, sizeof tail, "|%d%d|%.4f,%.4f,%.4f,%.4f|", int(node.pick), int(node.root), double(a.r), double(a.g), double(a.b), double(a.a));
    return view.dump() + "\x1f" + item.dump() + tail + node.why;
}

Look lookOf(const Entry& e) {
    const Kind& kind = *e.view.kind;
    const Node& node = e.node;
    Look look;
    look.accent = node.pick ? palette::pick : node.accent;
    look.radius = kind.radius;
    Color ground = node.pick ? palette::pickFace : node.root ? palette::rootFace : palette::face;
    switch (kind.face) {
    case Kind::Face::plain: look.fill = ground; break;
    case Kind::Face::sunk: look.fill = node.pick ? palette::pickSunk : palette::sunk; break;
    case Kind::Face::wash:
        look.fill = mix(look.accent, 0.14f, ground);
        look.ink2 = Color::hex(0xBDBDB6);
        break;
    }
    look.edge = look.accent.withAlphaComponent(kind.face == Kind::Face::wash ? 0.44f : 0.3f);
    if (node.root) {
        look.edge = Color::white(1, 0.5f);
        look.ink3 = Color::hex(0x9A9A93);
    }
    if (node.pick) {
        look.edge = palette::pick.withAlphaComponent(0.62f);
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

Opened open(const std::string& noteID, const Entry& e, float k) {
    const Kind& kind = *e.view.kind;
    const Item& item = e.item;
    Look look = lookOf(e);
    Sheet sheet{k, look, item.words};
    const float width = 384;
    bool pick = e.node.pick;

    // `.panel-head`: the badge.
    std::string badge = pick ? "Pick from the librarian" : e.node.root ? "Start of a tree" : "Kept";
    float badgeWidth = std::ceil(widthOf(badge, setting::badge, k)) + 22, badgeTall = 16.8f + 10;
    sheet.y = 1 + 10 + badgeTall + 6 + 4;

    std::string title = item.titleOrUntitled();
    sheet.paragraph(title, setting::heading, palette::ink);
    if (!e.node.why.empty()) {
        std::string why = e.node.why;
        float tall = 16.1f + heightOf(why, Sheet::width, 0, setting::why, k);
        sheet.part(tall, [why, pick](const Pen& pen, float y) {
            pen.words("Why it is here", Sheet::left, y, Sheet::width, 1, setting::whyLabel, palette::ink3);
            pen.words(why, Sheet::left, y + 16.1f, Sheet::width, 0, setting::why, pick ? palette::pick : palette::ink);
        });
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
        for (const auto& [tag, w] : pills) {
            if (x > 0 && x + w > Sheet::width) {
                rows += 1;
                x = 0;
            }
            x += w + 6;
        }
        float rowTall = 17.5f + 6;
        sheet.part(rows * rowTall + (rows - 1) * 6, [pills, rowTall](const Pen& pen, float y) {
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
        });
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
    std::vector<float> rows;
    float tall = 1 + 12;
    for (const auto& fact : facts) {
        rows.push_back(std::max(18.2f, heightOf(fact.second, valueWidth, 0, setting::fact, k)));
        tall += rows.back();
    }
    tall += 6 * float(facts.size() - 1);
    sheet.part(tall, [facts, rows, labels, valueWidth, look](const Pen& pen, float y) {
        pen.ctx.setFillColor(palette::line);
        pen.ctx.fill(pen.px(Sheet::left, y, Sheet::width, 1));
        y += 13;
        for (size_t i = 0; i < facts.size(); i++) {
            pen.words(facts[i].first, Sheet::left, y, labels + 1, 1, setting::fact, look.ink3);
            pen.words(facts[i].second, Sheet::left + labels + 14, y, valueWidth, 0, setting::fact, look.ink2);
            y += rows[i] + 6;
        }
    });

    float height = std::ceil(sheet.y + 16 + 1);
    std::vector<std::function<void(Canvas&)>> draws = sheet.draws;
    Opened out;
    out.key = "card-o:" + noteID + "#" + std::to_string(e.revision);
    out.size = CGSize{std::ceil(width * k), std::ceil(height * k)};
    out.runs = sheet.runs;
    out.picture = sheet.picture;
    out.draw = [=](Canvas& ctx) {
        Pen pen{ctx, k};
        Look panel;
        panel.fill = palette::glass;
        panel.edge = palette::line;
        panel.radius = 20;
        pen.face(width, height, panel);
        Color edge = pick ? palette::pick : palette::line2;
        ctx.setStrokeColor(edge);
        ctx.setLineWidth(k);
        if (pick) ctx.setLineDash(0, {3 * k, 2.4f * k});
        pen.rounded(pen.px(19.5f, 11.5f, badgeWidth - 1, badgeTall - 1), 10 * k);
        ctx.strokePath();
        if (pick) ctx.setLineDash(0, {});
        pen.words(badge, 19 + 11, 11 + 5, badgeWidth, 1, setting::badge, pick ? palette::pick : palette::ink2);
        for (const auto& draw : draws) draw(ctx);
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
    std::vector<Chip> line = e.sized.line;
    const Kind* kind = e.view.kind;
    Item item = e.item;
    Json props = e.view.props;
    float w = float(f.width), h = float(f.height), body = line.empty() ? h : h - CHIP_LINE;
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
    };
    return d;
}

std::optional<Opened> opened(const std::string& noteID, float k) {
    auto it = store().find(noteID);
    if (it == store().end()) return std::nullopt;
    return open(noteID, it->second, k);
}

}  // namespace cards
