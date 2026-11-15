#include "gallery.h"

#include <algorithm>
#include <cstdlib>
#include <map>

#include "../base.h"
#include "../ocean/catalog.h"
#include "cards.h"

namespace cards {

namespace {

/// How many of a note's links come up round it (Catalog::offers).
constexpr size_t RING = 7;
Color colour(const std::string& hex) {
    return hex.size() == 7 && hex[0] == '#' ? Color::hex(uint32_t(std::strtoul(hex.c_str() + 1, nullptr, 16))) : Color::white();
}

struct Link {
    std::string id, why;
};

/// The types under each card round the library, so no ring holds more than it can. A type in none goes under "Other cards".
struct Group {
    const char* title;
    std::vector<std::string> types;
};
const std::vector<Group>& groups() {
    static const std::vector<Group> all{
        {"Words", {"note", "quote", "callout", "excerpt", "definition", "idea", "qa"}},
        {"Pictures and sound", {"image", "video", "audio", "artwork", "link", "person", "swatch"}},
        {"Numbers", {"fact", "facts", "chart", "breakdown", "table"}},
        {"Lists and the rest", {"steps", "list", "proscons", "reference", "chat", "code", "place"}},
    };
    return all;
}

/// A note for one card, with the card put for it.
void add(Catalog& catalog, const std::string& id, const Json& view, const Json& item, const Node& node) {
    OceanNote note;
    note.id = id;
    note.kicker = text(view["component"]);
    note.headline = text(item["title"]);
    note.summary = text(item["summary"]);
    catalog.notes[id] = note;
    put(id, view, item, node);
}

/// A plain note that says what is round it.
void addLabel(Catalog& catalog, const std::string& id, const std::string& title, const std::string& summary, bool root) {
    Json view = Json::object(), item = Json::object(), source = Json::object();
    view.set("component", "note");
    item.set("title", title).set("summary", summary).set("text", "");
    source.set("from", "paste");
    item.set("source", source);
    add(catalog, id, view, item, Node{.pick = false, .root = root});
}

/// Links `parent` to `links`. More than a ring holds go round a card that says so, at the ring's end.
void hang(Catalog& catalog, const std::string& parent, std::vector<Link> links, const std::string& more) {
    std::vector<Link> ring = links;
    if (links.size() > RING) {
        ring.assign(links.begin(), links.begin() + RING - 1);
        std::string id = parent + "-more";
        addLabel(catalog, id, more, std::to_string(links.size() - ring.size()) + " more round this card.", false);
        hang(catalog, id, std::vector<Link>(links.begin() + RING - 1, links.end()), more);
        ring.push_back({id, more});
    }
    for (const Link& link : ring) catalog.notes[parent].links.push_back(NoteLink{"note:" + link.id, link.why});
}

}  // namespace

std::optional<Json> readSamples() {
    std::optional<Json> samples = Json::parse(samplesJson);
    if (!samples) return std::nullopt;
    // Each sample with lines over its structure joins its type's samples, after the page's own.
    if (std::optional<Json> lines = Json::parse(linesSamplesJson)) {
        Json types = Json::list();
        for (const Json& type : (*samples)["types"].array()) {
            Json t = type;
            Json cards = type["cards"];
            for (const Json& extra : lines->array()) {
                if (extra["type"].string("") == type["type"].string("")) cards.push(extra);
            }
            t.set("cards", cards);
            types.push(t);
        }
        samples->set("types", types);
    }
    for (const auto& [name, p] : (*samples)["pictures"].members()) {
        setSample(name, Sample{colour(p["a"].string("")), colour(p["b"].string("")), p["w"].real(640), p["h"].real(440)});
    }
    return samples;
}

int gallery(Catalog& catalog) {
    std::optional<Json> samples = readSamples();
    if (!samples) return -1;
    const std::string root = "cards-root";
    addLabel(catalog, root, "Card library", "Every card type the Quest draws so far, from the web client's library page. Pinch a group, then a type to see its other samples round it.", true);
    std::map<std::string, Link> types;
    int count = 0;
    for (const Json& type : (*samples)["types"].array()) {
        std::string name = type["type"].string("");
        if (!draws(name)) continue;
        std::vector<Link> samplesOfType;
        int i = 0;
        for (const Json& card : type["cards"].array()) {
            std::string id = "cards-" + name + "-" + std::to_string(i++);
            add(catalog, id, card["view"], card["item"], Node{.pick = card["status"].string("") == "pick", .root = false});
            for (const std::string& src : pictures(id)) {
                if (src.rfind("sample:", 0) != 0) picture(src, nullptr);
            }
            samplesOfType.push_back({id, card["label"].string("")});
            count++;
        }
        if (samplesOfType.empty()) continue;
        const std::string head = samplesOfType.front().id;
        hang(catalog, head, std::vector<Link>(samplesOfType.begin() + 1, samplesOfType.end()), "More " + name);
        types[name] = {head, name};
    }
    std::vector<Group> shown = groups();
    shown.push_back({"Other cards", {}});
    for (const auto& [name, link] : types) {
        bool placed = std::any_of(shown.begin(), shown.end() - 1, [&](const Group& g) { return std::count(g.types.begin(), g.types.end(), name); });
        if (!placed) shown.back().types.push_back(name);
    }
    std::vector<Link> ring;
    for (size_t g = 0; g < shown.size(); g++) {
        std::vector<Link> members;
        std::string names;
        for (const std::string& name : shown[g].types) {
            if (!types.count(name)) continue;
            members.push_back(types[name]);
            names += (names.empty() ? "" : ", ") + name;
        }
        if (members.empty()) continue;
        std::string id = "cards-group-" + std::to_string(g);
        addLabel(catalog, id, shown[g].title, names + ".", false);
        hang(catalog, id, members, "More types");
        ring.push_back({id, shown[g].title});
    }
    hang(catalog, root, ring, "More groups");
    catalog.briefs.push_back(Brief{"cards", "Every card the agents draw, as the web client draws them", "Card library", "note:" + root});
    logLine(fmt("[cards] the gallery: %d types, %d cards", int(types.size()), count));
    return int(catalog.briefs.size()) - 1;
}

}  // namespace cards
