#include "bridge.h"

#include <algorithm>
#include <initializer_list>

#include "base.h"
#include "platform.h"
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
    return std::make_shared<Bridge>(model, *address, std::make_shared<PlatformTransport>(), Flags::string("agentDump"));
}

Bridge::Bridge(OceanModel& model, Address address, std::shared_ptr<Transport> transport, std::optional<std::string> dump)
    : model(model), client(std::move(address), std::move(transport)), dump(std::move(dump)), walk(Flags::integer("agentWalk")) {}

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
                       [&](Rejected& r) { logLine("[agent] the service refused a message: " + r.message); },
                   },
                   event);
    }
    reportFocus();
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

    std::vector<Planted*> planted;
    for (const TreeId& id : delta.trees.added) {
        if (const TreeInfo* info = mirror.tree(id)) {
            if (Planted* p = plant(*info)) planted.push_back(p);
        }
    }
    // The newest tree stands when nothing does; every other new one hangs on the shelf.
    for (size_t i = planted.size(); i-- > 0;) {
        if (!model.tree && !model.pressing) {
            model.stand(planted[i]->tree);
        } else {
            model.shelve(planted[i]->tree, std::nullopt);
            model.shelfDirty = true;
        }
    }

    for (const Node& gone : delta.nodes.removed) {
        if (holding(gone.id.value)) touched = true;
        remove(gone.id.value);
    }

    for (const ItemId& id : delta.items.changed) {
        const Item* item = mirror.item(id);
        if (item && model.catalog && model.catalog->notes.count("agent-" + id.value)) refFor(*item);
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
    }

    for (auto& [p, ids] : arrived) {
        if (!standing(*p)) continue;
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
    auto tree = std::make_shared<Tree>(refFor(*item), info.title, Maker::both, model.catalog);
    tree->grows = false;
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
    int id = p.tree->graft(refFor(*item), parent->second, node.why, Tone::note, node.status == Node::Status::kept, float(node.importance));
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
        p->local.erase(s->second);
        p->service.erase(s);
    }
    if (standing(*p) && !gone.empty()) model.dismiss(gone, true);
}

Ref Bridge::refFor(const Item& item) {
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
    }
    OceanNote note;
    note.id = "agent-" + item.id.value;
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
    return Ref::note(note.id);
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

void Bridge::took(int nodeID, bool wasPick) {
    Planted* p = model.tree ? plantedOf(*model.tree) : nullptr;
    if (!p || !p->service.count(nodeID) || !wasPick) return;
    client.send(Outbound::keep({NodeId{p->service[nodeID]}}));
    logLine("[agent] kept " + model.catalog->title(p->tree->nodes[nodeID].ref));
}

void Bridge::reportFocus() {
    Planted* p = model.tree ? plantedOf(*model.tree) : nullptr;
    std::optional<int> open = p ? p->tree->focus() : std::nullopt;
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
    const std::string& question = c->asks[k].question;
    client.send(Outbound::ask(NodeId{s->second}, question));
    logLine("[agent] asked: " + question);
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
