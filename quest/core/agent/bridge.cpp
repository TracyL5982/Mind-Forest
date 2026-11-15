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
      keyboardTest(Flags::has("keyboardTest")) {}

void Bridge::frame(double t) {
    now = t;
    client.tick(now);
    for (Event& event : client.drain()) {
        std::visit(overloaded{
                       [&](Synced& s) { synced(s.delta); },
                       [&](Changed& c) {
                           if (Flags::has("agentLog")) {
                               logLine(fmt("[agent] change %lld \"%s\": nodes +%d ~%d -%d", (long long)c.set.seq, c.set.label.c_str(),
                                           int(c.delta.nodes.added.size()), int(c.delta.nodes.changed.size()), int(c.delta.nodes.removed.size())));
                           }
                           changed(c.delta, c.set.origin.by == Origin::By::agent);
                       },
                       [&](Activity& a) { activity(a); },
                       [&](Say& s) { logLine("[agent] says: " + s.text); },
                       [&](Heard&) {},
                       [&](Navigate&) {},
                       [&](Handoff& h) { logLine("[agent] handoff ready: " + h.name); },
                       [&](SettingsChanged&) {},
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
    if (keyboardTest && now > 3) {
        keyboardTest = false;
        bool shown = platform::showKeyboard("", {
            [](const std::string& text) { logLine("[agent] keyboard test typed: " + text); },
            [](const std::string& text, bool sent) { logLine(std::string("[agent] keyboard test ") + (sent ? "sent: " : "closed: ") + text); },
        });
        logLine(std::string("[agent] keyboard test: ") + (shown ? "asked the system for its keyboard" : "no keyboard here"));
    }
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
    changed(delta, false);
    if (dump) {
        client.send(Outbound::dump({Dump::text(*dump)}));
        logLine("[agent] dropped in: " + *dump);
        dump.reset();
    }
}

void Bridge::changed(const Delta& delta, bool animate) {
    const Mirror& mirror = client.mirror();
    bool touched = false;

    for (const TreeInfo& gone : delta.trees.removed) {
        auto p = trees.find(gone.id.value);
        if (p == trees.end()) continue;
        // A standing tree stays up until it is put away; a cover stays on the shelf. Neither is fed again.
        logLine("[agent] tree \"" + gone.title + "\" was deleted at the service");
        trees.erase(p);
    }

    std::vector<std::pair<Planted*, const TreeInfo*>> planted;
    for (const TreeId& id : delta.trees.added) {
        if (const TreeInfo* info = mirror.tree(id)) {
            if (Planted* p = plant(*info)) planted.emplace_back(p, info);
        }
    }
    // When nothing stands, the user's own newest tree stands; a tree from the headset's library only when
    // there is no other. Every other new tree hangs on the shelf.
    auto own = [&](const TreeInfo* info) {
        const Item* root = mirror.itemOf(info->rootId);
        return root && root->source.from != "library";
    };
    std::optional<size_t> stands;
    for (size_t i = 0; i < planted.size(); i++) {
        if (!stands) {
            stands = i;
            continue;
        }
        const TreeInfo* best = planted[*stands].second;
        const TreeInfo* next = planted[i].second;
        if (own(next) != own(best) ? own(next) : next->createdAt >= best->createdAt) stands = i;
    }
    if (model.tree || model.pressing) stands.reset();
    for (size_t i = 0; i < planted.size(); i++) {
        if (stands == i) {
            model.stand(planted[i].first->tree);
        } else {
            model.shelve(planted[i].first->tree, std::nullopt);
            model.shelfDirty = true;
        }
    }

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
        return;
    }
    if (!a.nodeId) return;
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
    if (row.key == "question" && offered) {
        auto& q = offered->questions;
        q.erase(std::remove(q.begin(), q.end(), row.question), q.end());
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
    converse(nodeID, row.question);
    return true;
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
