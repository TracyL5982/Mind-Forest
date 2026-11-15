#include "bridge.h"

#include <algorithm>
#include <cctype>
#include <initializer_list>

#include "base.h"
#include "platform.h"
#include "cards/cards.h"
#include "ocean/oceanmodel.h"

namespace agent {
namespace {

/// The platform's WebSocket as the client's transport.
class PlatformTransport : public Transport {
    struct Held : Socket {
        platform::SocketRef socket;
        bool send(const std::string& text) override { return socket->send(text); }
        void close() override { socket->close(); }
    };

public:
    std::shared_ptr<Socket> open(const std::string& url, SocketEvents events) override {
        platform::SocketRef socket = platform::openSocket(url, {events.opened, events.text, events.closed});
        if (!socket) return nullptr;
        auto held = std::make_shared<Held>();
        held->socket = socket;
        return held;
    }
};

/// Words cut at the last sentence or word that fits, so an open note stays a card and not a page.
std::string clipped(const std::string& text, size_t most) {
    if (text.size() <= most) return text;
    std::string cut = text.substr(0, most);
    size_t stop = cut.find_last_of(".!?");
    if (stop != std::string::npos && stop > most / 2) return cut.substr(0, stop + 1);
    size_t space = cut.find_last_of(' ');
    return (space == std::string::npos ? cut : cut.substr(0, space)) + "…";
}

std::string firstString(const Json& data, std::initializer_list<const char*> keys) {
    for (const char* key : keys) {
        if (data.has(key) && data[key].isString() && !data[key].string().empty()) return data[key].string();
    }
    return "";
}

std::string kindWord(const std::string& kind) {
    static const std::map<std::string, std::string> words = {
        {"text", "Note"}, {"image", "Picture"}, {"video", "Video"}, {"link", "Page"}, {"chat", "Chat"}, {"file", "File"}};
    auto w = words.find(kind);
    return w != words.end() ? w->second : kind;
}

/// `%20` and the like as the characters they stand for: Android's launcher splits launch flags at spaces,
/// so `-agentDump` carries several words as `The%20dolly%20zoom`.
std::string percentDecoded(const std::string& s) {
    std::string out;
    for (size_t i = 0; i < s.size(); i++) {
        if (s[i] == '%' && i + 2 < s.size() && std::isxdigit((unsigned char)s[i + 1]) && std::isxdigit((unsigned char)s[i + 2])) {
            out += char(std::stoi(s.substr(i + 1, 2), nullptr, 16));
            i += 2;
        } else {
            out += s[i];
        }
    }
    return out;
}

/// Seconds between showings of "Thinking…" while the service still works on a card (each showing lasts a little longer).
constexpr double thinkAgain = 2.2;

/// How long a navigate waits for its tree to stand before it is let go: a cover opens into its tree in about a second.
constexpr double standsWithin = 5;
/// How long a navigate waits for speaking to end: longer than a reply, so a voice that never says it ended cannot hold it.
constexpr double speechWithin = 20;

/// Where the covers of the service's trees hang between launches: beside the headset's own shelf file, never in it.
std::string spotsFile() {
    std::string folder = platform::dataDirectory();
    return folder.empty() ? "" : folder + "/agent-shelf.json";
}

/// Stands the layer a card's group lies on: `parent` leads it, and each card on the way leads its own, as the pinches that
/// reach it by hand would have made them.
void standGroup(Tree& t, int parent) {
    for (int step : t.path(parent)) {
        // Focusing keeps a card in a tree the gardener grows; in the service's, the service says what is kept.
        bool kept = t.nodes[step].kept;
        t.focus(step);
        t.nodes[step].kept = kept;
    }
}

}  // namespace

std::shared_ptr<Bridge> Bridge::fromFlags(OceanModel& model) {
    std::optional<std::string> flag = Flags::string("agent");
    if (!flag) return nullptr;
    std::optional<Address> address = Address::parse(*flag, Flags::string("agentToken").value_or(""));
    if (!address) {
        logLine("[agent] -agent " + *flag + " is not an address the service can be at");
        return nullptr;
    }
    logLine("[agent] joining " + address->http);
    std::optional<std::string> dump = Flags::string("agentDump");
    if (dump) dump = percentDecoded(*dump);
    return std::make_shared<Bridge>(model, *address, std::make_shared<PlatformTransport>(), dump);
}

Bridge::Bridge(OceanModel& model, Address address, std::shared_ptr<Transport> transport, std::optional<std::string> dump)
    : model(model), client(std::move(address), std::move(transport)), dump(std::move(dump)), walk(Flags::integer("agentWalk")),
      keyboardTest(Flags::has("keyboardTest")) {
    if (Flags::string("agentVoice").value_or("on") != "off") voice = std::make_unique<Voice>(client, [this] { return scene(); }, Flags::string("wakeClip"));
    if (Flags::string("agentType") && Flags::number("agentTypeAt") > 0) typeAt = Flags::number("agentTypeAt");
    std::string file = spotsFile();
    if (!file.empty()) spots = ShelfSpots::parse(platform::readFile(file).value_or("")).services[client.address().http];
}

void Bridge::frame(double t) {
    now = t;
    client.tick(now);
    for (Event& event : client.drain()) {
        std::visit(overloaded{
                       [&](Synced& s) {
                           synced(s.delta);
                           if (voice) voice->joined(s.settings, s.voice);
                       },
                       [&](Changed& c) {
                           if (Flags::has("agentLog")) {
                               logLine(fmt("[agent] change %lld \"%s\": nodes +%d ~%d -%d", (long long)c.set.seq, c.set.label.c_str(),
                                           int(c.delta.nodes.added.size()), int(c.delta.nodes.changed.size()), int(c.delta.nodes.removed.size())));
                           }
                           changed(c.delta, c.set.origin.by == Origin::By::agent, c.yours);
                       },
                       [&](Activity& a) { activity(a); },
                       [&](Say& s) {
                           logLine("[agent] says: " + s.text);
                           if (voice) voice->say(s.text);
                       },
                       [&](Heard&) {},
                       [&](Navigate& n) {
                           std::string to = n.nodeId ? "card " + n.nodeId->value : n.treeId ? "tree " + n.treeId->value : "nowhere";
                           // Another client's request moves its own view; the headset's stays where the user is.
                           if (!n.yours) {
                               logLine("[agent] navigate to " + to + " was asked for elsewhere, so the view stays");
                               return;
                           }
                           logLine("[agent] navigate to " + to);
                           going = Going{n, now, std::nullopt};
                       },
                       [&](Handoff& h) { logLine("[agent] handoff ready: " + h.name); },
                       [&](SettingsChanged& c) {
                           if (voice) voice->renamed(c.settings.agentName);
                       },
                       [&](Note&) {},
                       [&](Questions& q) { offer(q); },
                       [&](Rejected& r) { logLine("[agent] the service refused a message: " + r.message); },
                   },
                   event);
    }
    std::vector<std::pair<std::string, ImageRef>> arrived;
    {
        std::lock_guard<std::mutex> g(pictures->lock);
        arrived.swap(pictures->arrived);
    }
    Planted* standingTree = model.tree ? plantedOf(*model.tree) : nullptr;
    for (auto& [src, image] : arrived) {
        for (const std::string& noteID : cards::picture(src, image)) {
            std::string nodeId = noteID.substr(std::string("agent-").size());
            if (standingTree && standingTree->local.count(nodeId)) redraw(standingTree->local[nodeId]);
        }
    }
    std::vector<std::pair<std::string, bool>> finished;
    {
        std::lock_guard<std::mutex> g(typed->lock);
        finished.swap(typed->done);
    }
    for (auto& [text, sent] : finished) {
        std::optional<int> card = typingFor;
        typingFor.reset();
        if (!sent || text.find_first_not_of(" \t\n") == std::string::npos) {
            logLine("[agent] typing put away");
            continue;
        }
        if (card && model.tree && model.tree->nodes.count(*card)) converse(*card, text);
    }
    if (typeAt && now > *typeAt && client.state() == Client::State::live) {
        typeAt.reset();
        std::string words = percentDecoded(*Flags::string("agentType"));
        client.send(Outbound::utter(words, true, scene()));
        logLine("[agent] typed: " + words);
    }
    if (keyboardTest && now > 3) {
        keyboardTest = false;
        bool shown = platform::showKeyboard("", {
            [](const std::string& text) { logLine("[agent] keyboard test typed: " + text); },
            [](const std::string& text, bool sent) { logLine(std::string("[agent] keyboard test ") + (sent ? "sent: " : "closed: ") + text); },
        });
        logLine(std::string("[agent] keyboard test: ") + (shown ? "asked the system for its keyboard" : "no keyboard here"));
    }
    if (voice) {
        voice->frame(now);
        showPresence();
    }
    goOn();
    reportFocus();
    if (offered) {
        std::optional<int> open = standingTree ? standingTree->tree->focus() : std::nullopt;
        if (!open || !standingTree->service.count(*open) || standingTree->service[*open] != offered->nodeId) offered.reset();
    }
    for (auto& [id, t] : thinking) {
        if (now - t.shown < thinkAgain) continue;
        auto p = trees.find(t.tree);
        if (p == trees.end() || !standing(p->second) || !model.card(t.node)) continue;
        model.think(t.node, float(thinkAgain + 0.4));
        t.shown = now;
    }
}

void Bridge::synced(const Delta& delta) {
    logLine(fmt("[agent] connected: %d trees, %d cards", int(client.mirror().trees().size()), int(client.mirror().nodes().size())));
    // The headset shows no player from another site, and its player takes these files (Android's MediaPlayer).
    client.send(Outbound::client(Media{false, {"mp4", "m4a", "mp3"}}));
    // A tree deleted at the service while the headset was away leaves no spot behind.
    for (auto s = spots.begin(); s != spots.end();) s = client.mirror().tree(TreeId{s->first}) ? std::next(s) : spots.erase(s);
    changed(delta, false, false);
    if (dump) {
        client.send(Outbound::dump({Dump::text(*dump)}));
        logLine("[agent] dropped in: " + *dump);
        dump.reset();
    }
}

void Bridge::changed(const Delta& delta, bool animate, bool yours) {
    const Mirror& mirror = client.mirror();
    bool touched = false;

    for (const TreeInfo& gone : delta.trees.removed) {
        auto p = trees.find(gone.id.value);
        if (p == trees.end()) continue;
        // A standing tree stays up until it is put away; a cover stays on the shelf. Neither is fed again.
        logLine("[agent] tree \"" + gone.title + "\" was deleted at the service");
        trees.erase(p);
        spots.erase(gone.id.value);
        model.shelfDirty = true;
    }

    std::vector<std::pair<Planted*, const TreeInfo*>> planted;
    for (const TreeId& id : delta.trees.added) {
        if (const TreeInfo* info = mirror.tree(id)) {
            if (Planted* p = plant(*info)) planted.emplace_back(p, info);
        }
    }
    // The newest first, as the headset hangs its own covers at launch. A tree this headset asked for stands as a tree the
    // user starts always has, once the standing one has pressed itself onto the shelf. Every other new tree, and every
    // tree there at launch, hangs as a cover where it hung last time, or else at the first place no remembered one holds.
    std::stable_sort(planted.begin(), planted.end(), [](const auto& a, const auto& b) { return a.second->createdAt > b.second->createdAt; });
    std::shared_ptr<Tree> stands = yours && !planted.empty() ? planted.front().first->tree : nullptr;
    for (bool remembered : {true, false}) {
        for (const auto& [p, info] : planted) {
            auto spot = spots.find(info->id.value);
            if (p->tree == stands || (spot != spots.end()) != remembered) continue;
            model.shelve(p->tree, std::nullopt, nullptr, remembered ? std::optional<Vec2>(spot->second) : std::nullopt);
        }
    }
    if (stands) {
        logLine("[agent] \"" + stands->title + "\" was asked for here, so it stands");
        model.whenClear([this, stands] {
            model.standingSpot = std::nullopt;
            model.stand(stands);
        });
    }
    if (!planted.empty()) model.shelfDirty = true;

    for (const Node& gone : delta.nodes.removed) {
        if (holding(gone.id.value)) touched = true;
        remove(gone.id.value);
    }

    for (const ItemId& id : delta.items.changed) {
        const Item* item = mirror.item(id);
        if (!item) continue;
        for (const auto& [nodeId, n] : mirror.nodes()) {
            if (n.itemId != id || !holding(nodeId.value)) continue;
            Planted* p = holding(nodeId.value);
            if (paint(*item, n) && standing(*p)) redraw(p->local[nodeId.value]);
        }
    }

    // Nodes come in the order the service made them, so a parent is usually there before its child;
    // what is left waiting is tried again until nothing more can be placed.
    std::vector<const Node*> waiting;
    for (const NodeId& id : delta.nodes.added) {
        const Node* n = mirror.node(id);
        auto p = n ? trees.find(n->treeId.value) : trees.end();
        if (p != trees.end() && !p->second.local.count(id.value)) waiting.push_back(n);
    }
    std::map<Planted*, std::vector<int>> arrived;
    for (bool progress = true; progress && !waiting.empty();) {
        progress = false;
        std::vector<const Node*> still;
        for (const Node* n : waiting) {
            Planted& p = trees[n->treeId.value];
            if (std::optional<int> local = graft(p, *n)) {
                arrived[&p].push_back(*local);
                progress = true;
            } else {
                still.push_back(n);
            }
        }
        waiting = still;
    }
    if (!waiting.empty()) logLine(fmt("[agent] %d cards had no parent here and were left out", int(waiting.size())));

    for (const NodeId& id : delta.nodes.changed) {
        const Node* n = mirror.node(id);
        Planted* p = holding(id.value);
        if (!n || !p) continue;
        p->tree->revise(p->local[id.value], n->why, n->status == Node::Status::kept, float(n->importance));
        touched = touched || standing(*p);
        const Item* item = mirror.item(n->itemId);
        if (item && paint(*item, *n) && standing(*p)) redraw(p->local[id.value]);
    }

    for (auto& [p, ids] : arrived) {
        if (!standing(*p)) continue;
        // Suggestions for the card open where it stands come from a conversation about it, so it starts its layer.
        std::optional<int> opened = p->tree->focus();
        if (opened && !p->tree->nodes[*opened].head) {
            for (int id : ids) {
                if (p->tree->nodes[id].parent != *opened) continue;
                Tree::Change moved = p->tree->focus(*opened);
                model.arrive(moved.added);
                break;
            }
        }
        model.arrive(ids, animate ? 0.1 : 0.0);
        logLine(fmt("[agent] %d new cards", int(ids.size())));
        touched = true;
        std::optional<int> open = p->tree->focus();
        auto first = p->tree->nodes.find(ids.front());
        if (walk > 0 && open && first != p->tree->nodes.end() && first->second.parent == *open && !first->second.kept) {
            walk -= 1;
            int pick = ids.front();
            model.after(1.5, [this, pick] {
                if (model.tree && model.tree->nodes.count(pick)) model.take(pick);
            });
            model.after(3.0, [this, pick] {
                if (!model.tree || model.tree->focus() != pick) return;
                if (std::optional<std::string> words = Flags::string("agentType")) {
                    converse(pick, percentDecoded(*words));
                    return;
                }
                const auto& c = model.card(pick);
                for (int k = 0; c && k < int(c->asks.size()); k++) {
                    if (c->asks[k].key == "deeper") model.askGardener(pick, k);
                }
            });
        }
    }
    if (touched && model.tree) model.restyle();
}

void Bridge::activity(const Activity& a) {
    if (a.state != Activity::State::start) {
        thinking.erase(a.id);
        asking.ended(a.id);
        return;
    }
    if (!a.nodeId) return;
    if (a.role == "scout" && a.detail) asking.searching(a.id, a.nodeId->value, *a.detail);
    for (auto& [key, p] : trees) {
        auto local = p.local.find(a.nodeId->value);
        if (local != p.local.end()) {
            thinking[a.id] = Thinking{key, local->second, -thinkAgain};
            return;
        }
    }
}

Bridge::Planted* Bridge::plant(const TreeInfo& info) {
    const Mirror& mirror = client.mirror();
    const Node* root = mirror.node(info.rootId);
    const Item* item = root ? mirror.item(root->itemId) : nullptr;
    if (!root || !item || !model.catalog) return nullptr;
    auto tree = std::make_shared<Tree>(refFor(*item, *root), info.title, Maker::both, model.catalog, false);
    Planted& p = trees[info.id.value];
    p = Planted{tree, {{root->id.value, tree->root}}, {{tree->root, root->id.value}}};
    int count = 1;
    for (const Node* n : mirror.treeNodes(info.id)) {
        if (n->id == root->id) continue;
        count += graft(p, *n) ? 1 : 0;
    }
    logLine(fmt("[agent] tree \"%s\": %d cards", info.title.c_str(), count));
    return &p;
}

std::optional<int> Bridge::graft(Planted& p, const Node& node) {
    if (!node.parent) return std::nullopt;
    auto parent = p.local.find(node.parent->value);
    const Item* item = client.mirror().item(node.itemId);
    if (parent == p.local.end() || !item) return std::nullopt;
    int id = p.tree->graft(refFor(*item, node), parent->second, node.why, Tone::note, node.status == Node::Status::kept, float(node.importance));
    if (id < 0) return std::nullopt;
    p.local[node.id.value] = id;
    p.service[id] = node.id.value;
    return id;
}

void Bridge::remove(const std::string& nodeId) {
    Planted* p = holding(nodeId);
    if (!p) return;
    std::vector<TreeNode> gone = p->tree->prune(p->local[nodeId]);
    for (const TreeNode& g : gone) {
        auto s = p->service.find(g.id);
        if (s == p->service.end()) continue;
        cards::drop("agent-" + s->second);
        p->local.erase(s->second);
        p->service.erase(s);
    }
    if (standing(*p) && !gone.empty()) model.dismiss(gone, true);
}

Ref Bridge::refFor(const Item& item, const Node& node) {
    const Catalog& catalog = *model.catalog;
    if (item.source.from == "library" && item.data.has("library")) {
        const Json& library = item.data["library"];
        const std::string kind = library["kind"].string("");
        if (kind == "film" && library["key"].isNumber()) {
            int i = int(library["key"].number());
            if (i >= 0 && i < int(catalog.clips.size())) return Ref::film(i);
        }
        if (kind == "work" && library["key"].isString()) {
            for (const Work& w : catalog.works) {
                if (w.id == library["key"].string()) return Ref::work(w.index);
            }
        }
        if (kind == "tag" && library["key"].isString() && catalog.tags.count(library["key"].string())) return Ref::tag(library["key"].string());
        if (kind == "note" && library["key"].isString() && catalog.notes.count(library["key"].string())) return Ref::note(library["key"].string());
    }
    OceanNote note;
    note.id = "agent-" + node.id.value;
    // A small card and a crumb show the kicker alone: where the thing comes from, or what it is.
    note.kicker = firstString(item.data, {"from", "site"});
    if (note.kicker.empty()) note.kicker = kindWord(item.kind);
    note.tone = Tone::note;
    note.headline = item.title;
    note.highlight = clipped(item.summary, 180);
    note.summary = clipped(item.text, 600);
    note.tags = item.tags;
    if (item.data.has("chart")) {
        const Json& chart = item.data["chart"];
        ChartSpec spec;
        for (const Json& l : chart["labels"].array()) spec.labels.push_back(l.string(""));
        for (const Json& v : chart["values"].array()) spec.values.push_back(v.number());
        spec.unit = chart["unit"].optionalString();
        spec.source = chart["source"].optionalString();
        if (!spec.labels.empty() && spec.labels.size() == spec.values.size()) note.chart = spec;
    }
    model.catalog->notes[note.id] = note;
    paint(item, node);
    return Ref::note(note.id);
}

namespace {

/// The item as the card library reads it: the service's field names (agents/src/core/domain.ts).
Json cardItem(const Item& item) {
    Json tags = Json::list();
    for (const std::string& t : item.tags) tags.push(t);
    Json source = Json::object();
    source.set("from", item.source.from);
    if (item.source.url) source.set("url", *item.source.url);
    source.set("capturedAt", item.source.capturedAt);
    Json out = Json::object();
    out.set("kind", item.kind);
    out.set("title", item.title);
    out.set("text", item.text);
    out.set("summary", item.summary);
    out.set("tags", tags);
    out.set("data", Json(item.data));
    out.set("origin", Json::object().set("by", item.origin.by == Origin::By::agent ? "agent" : "user"));
    out.set("source", source);
    return out;
}

}  // namespace

bool Bridge::paint(const Item& item, const Node& node) {
    if (item.source.from == "library") return false;
    std::string noteID = "agent-" + node.id.value;
    Json view = Json::object();
    view.set("component", node.view.component);
    view.set("props", Json(node.view.props));
    if (node.view.composing) view.set("composing", true);
    bool changed = cards::put(noteID, view, cardItem(item), cards::Node{node.status == Node::Status::pick, !node.parent, node.why});
    fetchPictures(noteID);
    return changed;
}

void Bridge::fetchPictures(const std::string& noteID) {
    for (const std::string& src : cards::pictures(noteID)) {
        if (src.rfind("sample:", 0) == 0 || !asked.insert(src).second) continue;
        std::string file = platform::dataDirectory() + "/agent-picture-" + std::to_string(std::hash<std::string>{}(src));
        platform::Request request;
        request.url = client.address().resolve(src);
        request.saveTo = file;
        std::weak_ptr<Pictures> inbox = pictures;
        platform::fetch(request, [inbox, src, file](platform::Response r) {
            ImageRef image = r.status >= 200 && r.status < 300 && r.error.empty() ? platform::decodeImage(file, 1024) : nullptr;
            if (auto box = inbox.lock()) {
                std::lock_guard<std::mutex> g(box->lock);
                box->arrived.emplace_back(src, image);
            }
        });
    }
}

void Bridge::redraw(int localId) {
    auto found = model.cards.find(localId);
    const TreeNode* n = model.tree ? model.find(*model.tree, localId) : nullptr;
    if (!n || found == model.cards.end()) return;
    // A card that was composing does not fade: the finished card comes up inside it.
    if (found->second->shape) {
        model.settleCard(localId);
        return;
    }
    OceanModel::CardRef old = found->second;
    model.cards.erase(found);
    for (const Entity* e : old->extras) model.picks.erase(e);
    old->root->inputTarget = false;
    old->alpha.go(0, model.time, 0.15f);
    old->goneAt = model.time + 0.16;
    old->home = std::nullopt;
    model.leaving.push_back(old);
    model.buildQueue.erase(std::remove(model.buildQueue.begin(), model.buildQueue.end(), localId), model.buildQueue.end());
    model.makeCard(*n, 0);
    // The same card with new content carries on from where the old one was, and does not arrive again.
    if (OceanModel::CardRef made = model.card(localId)) {
        made->source = old->source;
        made->sourceScale = old->sourceScale;
        made->emerge = old->emerge;
        made->bornAt = old->bornAt;
    }
}

Bridge::Planted* Bridge::plantedOf(const Tree& tree) {
    for (auto& [key, p] : trees) {
        if (p.tree.get() == &tree) return &p;
    }
    return nullptr;
}

Bridge::Planted* Bridge::holding(const std::string& nodeId) {
    for (auto& [key, p] : trees) {
        if (p.local.count(nodeId)) return &p;
    }
    return nullptr;
}

bool Bridge::standing(const Planted& p) const { return model.tree && model.tree.get() == p.tree.get(); }

bool Bridge::opens(int nodeID) {
    Planted* p = model.tree ? plantedOf(*model.tree) : nullptr;
    if (!p || !p->service.count(nodeID)) return false;
    const TreeNode& n = p->tree->nodes[nodeID];
    // A card that already leads a layer, or one on another layer, is gone to as before.
    if (n.head || p->tree->seat(n).depth != p->tree->standDepth()) return false;
    // One whose parent leads no layer lies on this one where no group is, so its parent's group stands first.
    if (n.parent && !p->tree->nodes[*n.parent].head) standGroup(*p->tree, *n.parent);
    p->tree->open(nodeID);
    logLine("[agent] opened " + model.catalog->title(n.ref));
    return true;
}

void Bridge::rows(const TreeNode& node, std::vector<Ask>& asks) {
    Planted* p = model.tree ? plantedOf(*model.tree) : nullptr;
    if (!p || !p->service.count(node.id)) return;
    const std::string& id = p->service[node.id];
    if (!offered || offered->nodeId != id) {
        offered = Offered{id, {}};
        client.send(Outbound::questions(NodeId{id}));
    }
    asks.clear();
    if (!node.kept) asks.push_back(Ask{"keep", "Keep this"});
    if (offered->questions.empty()) {
        asks.push_back(Ask{"more", "What else is like this?"});
        asks.push_back(Ask{"deeper", "Tell me more about this"});
    }
    for (const std::string& q : offered->questions) asks.push_back(Ask{"question", q});
    asks.push_back(Ask{"type", "Type your own question…"});
}

void Bridge::offer(const Questions& q) {
    // A card closed or another opened while the service wrote them: they are for a card no longer shown.
    if (!offered || offered->nodeId != q.nodeId.value || q.questions.empty()) return;
    offered->questions = q.questions;
    Planted* p = model.tree ? plantedOf(*model.tree) : nullptr;
    if (!p || !p->local.count(q.nodeId.value)) return;
    int local = p->local[q.nodeId.value];
    logLine(fmt("[agent] %d questions for %s", int(q.questions.size()), model.catalog->title(p->tree->nodes[local].ref).c_str()));
    refreshRows(local);
}

void Bridge::refreshRows(int localId) {
    auto found = model.cards.find(localId);
    const TreeNode* n = model.tree ? model.find(*model.tree, localId) : nullptr;
    if (!n || found == model.cards.end()) return;
    CardView& c = *found->second;
    c.asks = model.catalog->asks(c.ref, model.previousPiece(localId));
    rows(*n, c.asks);
    model.buildRows(c);
}

void Bridge::type(int nodeID) {
    std::weak_ptr<Typed> inbox = typed;
    bool shown = platform::showKeyboard("", {
        nullptr,
        [inbox](const std::string& text, bool sent) {
            if (auto box = inbox.lock()) {
                std::lock_guard<std::mutex> g(box->lock);
                box->done.emplace_back(text, sent);
            }
        },
    });
    if (!shown) {
        logLine("[agent] there is no keyboard to bring up here");
        return;
    }
    typingFor = nodeID;
    logLine("[agent] typing a question");
}

void Bridge::converse(int nodeID, const std::string& question) {
    Planted* p = model.tree ? plantedOf(*model.tree) : nullptr;
    if (!p || !p->service.count(nodeID)) return;
    NodeId id{p->service[nodeID]};
    TreeNode& n = p->tree->nodes[nodeID];
    if (!n.kept) {
        client.send(Outbound::keep({id}));
        n.kept = true;
        logLine("[agent] kept " + model.catalog->title(n.ref));
    }
    // A conversation about the card: it now leads a layer of its own, where what the service brings for it stands.
    if (!n.head) {
        Tree::Change moved = p->tree->focus(nodeID);
        model.arrive(moved.added);
        model.restyle();
    }
    client.send(Outbound::ask(id, question));
    logLine("[agent] asked: " + question);
}

Scene Bridge::scene() {
    Scene s;
    Planted* p = model.tree ? plantedOf(*model.tree) : nullptr;
    if (!p) return s;
    for (const auto& [key, planted] : trees) {
        if (&planted == p) s.treeId = TreeId{key};
    }
    std::optional<int> open = p->tree->focus();
    if (open && p->service.count(*open)) s.focus = NodeId{p->service[*open]};
    return s;
}

void Bridge::showPresence() {
    if (!presenceView) {
        if (!model.art || !model.lineMaterial) return;
        presenceView = std::make_unique<PresenceView>(model.art, *model.lineMaterial, model.root_);
    }
    // Until the voice says what it is doing itself (WS17), it is read from what the voice shows now.
    using S = Presence::State;
    std::optional<Listener::State> state = voice->state();
    presence.state = !state ? S::off
                     : *state == Listener::State::hearing ? S::listening
                     : *state == Listener::State::working ? S::thinking
                     : *state == Listener::State::speaking ? S::responding
                                                           : S::waiting;
    presence.momoText = voice->saying();
    presence.workingOn.reset();
    for (const auto& [id, t] : thinking) {
        auto p = trees.find(t.tree);
        if (presence.state == S::waiting && p != trees.end() && standing(p->second)) {
            presence.state = S::working;
            presence.workingOn = t.node;
        }
    }
    std::optional<Vec3> at;
    if (presence.workingOn) {
        if (const auto& c = model.card(*presence.workingOn)) at = c->root->transformMatrix(nullptr).position();
    }
    Mat4 head = platform::head().value_or(Mat4::trs(model.stage.origin, Quat::identity(), {1, 1, 1}));
    presenceView->frame(presence, voice->name(), at, head, now);
}

bool Bridge::speaking() const {
    // TODO(WS17): ask the new voice's own state. Until then: the user is recorded, or a reply is on its way or playing.
    return voice && (voice->state() == Listener::State::hearing || !voice->saying().empty());
}

void Bridge::goOn() {
    if (!going || (speaking() && now - going->came < speechWithin)) return;
    const Navigate& to = going->to;
    Planted* p = nullptr;
    int id = 0;
    if (to.nodeId) {
        p = holding(to.nodeId->value);
        if (p) id = p->local[to.nodeId->value];
    } else if (to.treeId) {
        auto found = trees.find(to.treeId->value);
        if (found != trees.end()) {
            p = &found->second;
            id = p->tree->root;
        }
    }
    if (!p) {
        logLine("[agent] nothing here to go to");
        going.reset();
        return;
    }
    if (!standing(*p)) {
        auto cover = std::find_if(model.shelf.begin(), model.shelf.end(), [&](const OceanModel::Shelved& s) { return s.tree == p->tree; });
        if (cover != model.shelf.end() && !model.pressing) model.unfold(cover->uid);
        if (!going->waitingSince) {
            going->waitingSince = now;
        } else if (now - *going->waitingSince > standsWithin) {
            logLine("[agent] \"" + p->tree->title + "\" did not stand, so it was not gone to");
            going.reset();
        }
        return;
    }
    if (model.pressing || !model.standQueue.empty()) return;
    bring(*p, id);
    going.reset();
}

void Bridge::bring(Planted& p, int id) {
    Tree& t = *p.tree;
    const TreeNode& n = t.nodes[id];
    if (n.head) {
        t.focus(id);
    } else if (t.condensed(n) || !opens(id)) {
        standGroup(t, *n.parent);
        t.open(id);
    }
    model.restyle();
    logLine("[agent] went to " + model.catalog->title(n.ref) + " in \"" + t.title + "\" (" + p.service[id] + "), on the layer of " +
            p.service[t.stand]);
}

void Bridge::reportFocus() {
    Planted* p = model.tree ? plantedOf(*model.tree) : nullptr;
    std::optional<int> open = p ? p->tree->focus() : std::nullopt;
    // A card opened where it stands is only being looked at; the service hears of a card once it leads a layer.
    if (open && !p->tree->nodes[*open].head) return;
    if (!open || !p->service.count(*open)) {
        focusSent.reset();
        return;
    }
    const std::string& id = p->service[*open];
    if (focusSent == id) return;
    if (!client.send(Outbound::focus(NodeId{id}))) return;
    focusSent = id;
    logLine("[agent] open: " + model.catalog->title(p->tree->nodes[*open].ref));
}

bool Bridge::ask(int nodeID, int k) {
    Planted* p = model.tree ? plantedOf(*model.tree) : nullptr;
    if (!p) return false;
    auto s = p->service.find(nodeID);
    const auto& c = model.card(nodeID);
    if (s == p->service.end() || !c || k < 0 || k >= int(c->asks.size())) return true;
    const Ask row = c->asks[k];
    if (row.key == "type") {
        type(nodeID);
        return true;
    }
    if (row.key == "keep") {
        TreeNode& n = p->tree->nodes[nodeID];
        if (!n.kept) {
            client.send(Outbound::keep({NodeId{s->second}}));
            n.kept = true;
            logLine("[agent] kept " + model.catalog->title(n.ref));
        }
        redraw(nodeID);
        model.restyle();
        return true;
    }
    if (!asking.begin(s->second, row.question, now)) {
        logLine("[agent] still asking, so not again: " + row.question);
        return true;
    }
    acknowledge(nodeID, k);
    if (row.key == "question" && offered) {
        auto& q = offered->questions;
        q.erase(std::remove(q.begin(), q.end(), row.question), q.end());
    }
    converse(nodeID, row.question);
    return true;
}

void Bridge::acknowledge(int nodeID, int k) {
    const auto& c = model.card(nodeID);
    if (!c) return;
    for (const EntityRef& row : c->askHolder->children) {
        auto pick = model.picks.find(row.get());
        if (pick == model.picks.end() || pick->second.kind != OceanModel::Pick::Kind::ask || pick->second.question != k) continue;
        Tween<float> alpha(0.35f);
        alpha.go(1, model.time, 0.1, 0.45f, Ease::out);
        row->opacity = 0.35f;
        model.fades.push_back(OceanModel::Fade{row, alpha, false});
        model.touch(model.time + 0.6);
    }
}

bool Bridge::askMark(int nodeID, const Mark& mark) {
    Planted* p = model.tree ? plantedOf(*model.tree) : nullptr;
    if (!p) return false;
    auto s = p->service.find(nodeID);
    if (s == p->service.end()) return true;
    std::string need = "About this part of it: " + OceanModel::described(mark);
    client.send(Outbound::ask(NodeId{s->second}, need));
    logLine("[agent] asked about a mark: " + OceanModel::described(mark));
    return true;
}

void Bridge::pruned(int nodeID, const std::vector<TreeNode>& gone) {
    Planted* p = model.tree ? plantedOf(*model.tree) : nullptr;
    if (!p) return;
    auto s = p->service.find(nodeID);
    if (s != p->service.end()) client.send(Outbound::commands("Cut", {Command::deleteNode(NodeId{s->second})}));
    for (const TreeNode& g : gone) {
        auto found = p->service.find(g.id);
        if (found == p->service.end()) continue;
        cards::drop("agent-" + found->second);
        p->local.erase(found->second);
        p->service.erase(found);
    }
}

void Bridge::saveShelf() {
    for (const auto& [id, p] : trees) {
        auto cover = std::find_if(model.shelf.begin(), model.shelf.end(), [&](const OceanModel::Shelved& s) { return s.tree == p.tree; });
        if (cover != model.shelf.end()) {
            spots[id] = cover->spot;
        } else if (standing(p) && model.standingSpot) {
            spots[id] = *model.standingSpot;
        }
    }
    std::string file = spotsFile();
    if (file.empty()) return;
    ShelfSpots kept = ShelfSpots::parse(platform::readFile(file).value_or(""));
    kept.services[client.address().http] = spots;
    platform::writeFile(file, kept.text());
}

void Bridge::pressed(const Tree& tree, bool send) {
    if (!send) return;
    for (auto& [key, p] : trees) {
        if (p.tree.get() != &tree) continue;
        client.send(Outbound::handoff(Scope{{TreeId{key}}, {}}));
        logLine("[agent] sent on: " + tree.title);
        return;
    }
}

}  // namespace agent
