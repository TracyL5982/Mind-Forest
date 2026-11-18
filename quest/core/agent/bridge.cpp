#include "bridge.h"

#include <algorithm>
#include <cctype>
#include <functional>
#include <initializer_list>
#include <limits>
#include <random>
#include <set>

#include "base.h"
#include "platform.h"
#include "cards/cards.h"
#include "ocean/oceanmodel.h"

namespace agent {
namespace {

/// A node made here, named as the service names its own: a random UUID.
NodeId newNodeId() {
    static std::mt19937_64 random{std::random_device{}()};
    uint64_t a = random(), b = random();
    return NodeId{fmt("%08x-%04x-4%03x-%04x-%012llx", unsigned(a >> 32), unsigned(a >> 16) & 0xffffu, unsigned(a) & 0xfffu,
                      0x8000u | unsigned(b >> 48 & 0x3fff), static_cast<unsigned long long>(b & 0xffffffffffffULL))};
}

/// The service's item for one of the headset's own pieces, as its library import names them (agents/src/node/library.ts):
/// `library:film:12`, `library:work:met-436535`, `library:note:…`, `library:tag:…`. None for a card of the service's own.
std::optional<ItemId> libraryItem(const Ref& ref, const Catalog& catalog) {
    switch (ref.kind) {
    case Ref::Kind::film: return ItemId{"library:film:" + std::to_string(ref.index)};
    case Ref::Kind::work: {
        auto w = std::find_if(catalog.works.begin(), catalog.works.end(), [&](const Work& x) { return x.index == ref.index; });
        if (w == catalog.works.end()) return std::nullopt;
        return ItemId{"library:work:" + w->id};
    }
    case Ref::Kind::note:
        if (ref.id.rfind("agent-", 0) == 0) return std::nullopt;
        return ItemId{"library:note:" + ref.id};
    case Ref::Kind::tag: return ItemId{"library:tag:" + ref.id};
    }
    return std::nullopt;
}

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

/// How long a navigate waits for its tree to stand before it is let go: a cover opens into its tree in about a second.
constexpr double standsWithin = 5;
/// How long a navigate waits for speaking to end: longer than a reply, so a voice that never says it ended cannot hold it.
constexpr double speechWithin = 20;

/// Where the service's trees stand between launches: beside the headset's own shelf file, never in it.
std::string plotsFile() {
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
    if (Flags::string("agentVoice").value_or("on") != "off") voice = std::make_unique<Voice>(client, [this] { return scene(); }, Flags::string("wakeClip"), Flags::has("mute"));
    if (Flags::string("agentType") && Flags::number("agentTypeAt") > 0) typeAt = Flags::number("agentTypeAt");
    if (Flags::number("wornAt") > 0) wornAt = Flags::number("wornAt");
    std::string file = plotsFile();
    if (!file.empty()) {
        ShelfPlots kept = ShelfPlots::parse(platform::readFile(file).value_or(""));
        plots = kept.services[client.address().http];
        stands = kept.stands[client.address().http];
    }
}

void Bridge::frame(double t) {
    now = t;
    client.tick(now);
    // The headset worn again: the service is told, once it can be (a demo's tree grows for whoever puts it on).
    if (std::optional<double> away = platform::wornAgain()) wornAway = away;
    if (wornAt && now >= *wornAt) {
        wornAway = Flags::number("wornAway") > 0 ? Flags::number("wornAway") : 30;
        wornAt.reset();
    }
    if (wornAway && client.state() == Client::State::live && client.send(Outbound::worn(*wornAway))) {
        logLine(fmt("[agent] worn again, after %.1f s away", *wornAway));
        wornAway.reset();
    }
    for (Event& event : client.drain()) {
        std::visit(overloaded{
                       [&](Synced& s) {
                           synced(s.delta);
                           if (s.share != shareBy) {
                               shareBy = s.share;
                               logLine(shareBy.empty() ? std::string("[agent] the service names no way of sharing: Share opens the list of people")
                                                       : "[agent] the service shares a tree through " + shareBy + ": Share sends at once");
                           }
                           if (voice) voice->joined(s.settings, s.voice, s.live, s.connection);
                       },
                       [&](Changed& c) {
                           if (Flags::has("agentLog")) {
                               logLine(fmt("[agent] change %lld \"%s\": nodes +%d ~%d -%d", (long long)c.set.seq, c.set.label.c_str(),
                                           int(c.delta.nodes.added.size()), int(c.delta.nodes.changed.size()), int(c.delta.nodes.removed.size())));
                           }
                           changed(c.delta, c.set.origin.by == Origin::By::agent, c.yours);
                       },
                       [&](Activity& a) {
                           activity(a);
                           if (voice) voice->activity(a);
                       },
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
                       [&](Rejected& r) {
                           logLine("[agent] the service refused a message: " + r.message);
                           // (The demo's refusal of a share names no tree: it is the one last asked for. WS88)
                           if (r.message.rfind("the tree was not shared", 0) == 0 && !lastShared.empty()) {
                               shareAnswered(Shared{.tree = TreeId{lastShared}, .ok = false, .reason = "not-shared", .text = r.message});
                           }
                       },
                       [&](Shared& s) { shareAnswered(s); },
                   },
                   event);
    }
    for (auto& [src, r] : retries) {
        if (now < r.at) continue;
        r.at = std::numeric_limits<double>::infinity();         // (until it comes, or fails again)
        fetchPicture(src);
    }
    std::vector<Came> arrived;
    {
        std::lock_guard<std::mutex> g(pictures->lock);
        arrived.swap(pictures->arrived);
    }
    Planted* standingTree = model.tree ? plantedOf(*model.tree) : nullptr;
    bool covers = false;
    for (const Came& came : arrived) {
        // One that did not come, and may yet, is asked for again until it does: 1, 2, 4 and 8 s on, then every 15 s. A card
        // showing it, and a cover's place for it, wait for it meanwhile. Only one the service says it can't have is let go.
        if (!came.image && !came.gone) {
            Retry& r = retries[came.src];
            r.tries++;
            r.at = now + (r.tries <= 4 ? double(1 << (r.tries - 1)) : 15.0);
            logLine(fmt("[agent] a picture did not come (%d %s); asked again in %.0f s", r.tries, r.tries == 1 ? "time" : "times",
                        r.at - now));
            continue;
        }
        retries.erase(came.src);
        if (came.gone) logLine("[agent] a picture can't be had: " + came.src);
        std::vector<std::string> shown = cards::picture(came.src, came.image);
        for (const std::string& noteID : shown) {
            std::string nodeId = noteID.substr(std::string("agent-").size());
            if (standingTree && standingTree->local.count(nodeId)) redraw(standingTree->local[nodeId]);
        }
        covers = covers || !shown.empty();
    }
    // A tree put away shows its cards' pictures round it as they come, and the next card's in place of one that can't be had.
    if (covers) model.coverPicturesCame();
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
    model.conversing = voice && voice->presence().conversing();
    goOn();
    reportFocus();
    if (offered) {
        std::optional<int> open = standingTree ? standingTree->tree->focus() : std::nullopt;
        if (!open || !standingTree->service.count(*open) || standingTree->service[*open] != offered->nodeId) offered.reset();
    }
}

void Bridge::synced(const Delta& delta) {
    logLine(fmt("[agent] connected: %d trees, %d cards", int(client.mirror().trees().size()), int(client.mirror().nodes().size())));
    // The headset shows no player from another site, and its player takes these files (Android's MediaPlayer).
    client.send(Outbound::client(Media{false, {"mp4", "m4a", "mp3"}}));
    // A tree deleted at the service while the headset was away leaves no plot behind, and no place stood on.
    for (auto s = plots.begin(); s != plots.end();) s = client.mirror().tree(TreeId{s->first}) ? std::next(s) : plots.erase(s);
    for (auto s = stands.begin(); s != stands.end();) s = client.mirror().tree(TreeId{s->first}) ? std::next(s) : stands.erase(s);
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
        // A standing tree stays up until it is put away; a cover stays on the shelf. Neither is fed again. (Kept by its id, so
        // that a tree coming again with it takes this one's place: `deleted`.)
        logLine("[agent] tree \"" + gone.title + "\" was deleted at the service");
        deleted[gone.id.value] = p->second.tree;
        trees.erase(p);
        plots.erase(gone.id.value);
        stands.erase(gone.id.value);
        model.shelfDirty = true;
    }

    std::vector<std::pair<Planted*, const TreeInfo*>> planted;
    for (const TreeId& id : delta.trees.added) {
        // A tree the service deleted and now makes again (shared and grown back, or the demo's Daily tree): the copy the
        // headset kept goes, its cover off the desk, or, standing, put away and let go rather than shelved (the lead's call).
        if (auto old = deleted.find(id.value); old != deleted.end()) {
            model.letGo(old->second);
            deleted.erase(old);
        }
        if (const TreeInfo* info = mirror.tree(id)) {
            if (Planted* p = plant(*info)) planted.emplace_back(p, info);
        }
    }
    // The newest first, as the headset puts its own trees away at launch. A tree this headset asked for stands as a tree
    // the user starts always has, once the standing one has been put away. Every other new tree, and every tree there at
    // launch, is put away on the desk where it stood last time, or else at the first place no remembered one holds.
    std::stable_sort(planted.begin(), planted.end(), [](const auto& a, const auto& b) { return a.second->createdAt > b.second->createdAt; });
    std::shared_ptr<Tree> stands = yours && !planted.empty() ? planted.front().first->tree : nullptr;
    for (bool remembered : {true, false}) {
        for (const auto& [p, info] : planted) {
            auto plot = plots.find(info->id.value);
            if (p->tree == stands || (plot != plots.end()) != remembered) continue;
            model.shelve(p->tree, std::nullopt, nullptr, std::nullopt, remembered ? std::optional<Vec2>(plot->second) : std::nullopt);
        }
    }
    if (stands) {
        logLine("[agent] \"" + stands->title + "\" was asked for here, so it stands");
        model.whenClear([this, stands] {
            model.standingSpot = std::nullopt;
            model.standingPlot = std::nullopt;
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
        // An edit made here, on another headset, or taken back by an undo.
        if (standing(*p)) model.setEdits(p->local[id.value], sceneEdits(*n));
    }

    for (auto& [p, ids] : arrived) {
        // A card that gets cards is a branch: it leads their layer, as every card with cards does on Kai's trees. Those for the
        // card open where it stands on the standing tree come from a conversation about it, so it is gone into; any other card
        // becomes a branch where it is.
        std::optional<int> opened = standing(*p) ? p->tree->focus() : std::nullopt;
        std::set<int> parents;
        for (int id : ids) {
            if (std::optional<int> parent = p->tree->nodes[id].parent) parents.insert(*parent);
        }
        for (int parent : parents) {
            if (opened && parent == *opened && !p->tree->nodes[parent].head) {
                Tree::Change moved = p->tree->focus(*opened);
                model.arrive(moved.added);
            } else {
                p->tree->lead(parent);
            }
        }
        if (!standing(*p)) continue;
        model.arrive(ids, animate ? 0.1 : 0.0);
        // The agent's cards come as the gardener's do on Kai's trees: one note each, up the chord of the layer.
        if (animate) model.soundArrivals(ids, 0.1);
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
        asking.ended(a.id);
        return;
    }
    if (a.nodeId && a.role == "scout" && a.detail) asking.searching(a.id, a.nodeId->value, *a.detail);
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
    // A tree that arrives whole is a tree as it would be had it grown here: every card with cards leads their layer, nearest
    // the root first.
    std::vector<int> ids;
    for (const auto& [id, n] : tree->nodes) ids.push_back(id);
    std::stable_sort(ids.begin(), ids.end(), [&](int a, int b) { return tree->generation(a) < tree->generation(b); });
    int layers = 1, leading = 0;
    for (int id : ids) {
        if (tree->lead(id)) {
            leading++;
            layers = std::max(layers, tree->generation(id) + 1);
        }
    }
    // It stands as a saved tree of Kai's is taken off the desk, on the layer the user last stood on (`stands`). One nobody has
    // stood in stands on its deepest layer, as a tree grown here stands on its newest, every branch a layer behind it and
    // none folded onto the one it stands on; of layers as deep, the first reached taking at each fork the first card in the
    // service's order. The same every time.
    int at = tree->root;
    auto last = stands.find(info.id.value);
    auto stood = last != stands.end() ? p.local.find(last->second) : p.local.end();
    if (stood != p.local.end()) {
        at = stood->second;
        while (!tree->nodes[at].head && tree->nodes[at].parent) at = *tree->nodes[at].parent;
    } else {
        std::function<void(int)> deepest = [&](int id) {
            const TreeNode& n = tree->nodes[id];
            if (!n.head) return;
            if (tree->generation(id) > tree->generation(at)) at = id;
            for (int c : n.children) deepest(c);
        };
        deepest(tree->root);
    }
    standGroup(*tree, at);
    logLine(fmt("[agent] tree \"%s\": %d cards, %d layers, %d cards leading one; it stands on layer %d, of %s (%s)%s", info.title.c_str(),
                count, layers, leading, tree->generation(at) + 1, model.catalog->title(tree->nodes[at].ref).c_str(),
                p.service[at].c_str(), stood != p.local.end() ? ", where it was left" : ""));
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
        fetchPicture(src);
    }
}

void Bridge::fetchPicture(const std::string& src) {
    std::string file = platform::dataDirectory() + "/agent-picture-" + std::to_string(std::hash<std::string>{}(src));
    platform::Request request;
    request.url = client.address().resolve(src);
    request.saveTo = file;
    request.timeout = 10;           // (one that stalls is asked for again sooner)
    std::weak_ptr<Pictures> inbox = pictures;
    platform::fetch(request, [inbox, src, file](platform::Response r) {
        bool ok = r.status >= 200 && r.status < 300 && r.error.empty();
        ImageRef image = ok ? platform::decodeImage(file, 1024) : nullptr;
        // Not found, gone, or a reply that is no picture the headset can draw: it never will be. Anything else may pass.
        bool gone = r.status == 404 || r.status == 410 || (ok && !image);
        if (auto box = inbox.lock()) {
            std::lock_guard<std::mutex> g(box->lock);
            box->arrived.push_back(Came{src, image, gone});
        }
    });
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
        // And where it stepped aside to, out from under the open card.
        made->nudge = old->nudge;
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
    Tree& t = *p->tree;
    const TreeNode& n = t.nodes[nodeID];
    // Where it lies: the layer of its parent's group, where a card that leads a layer of its own is shown too while you are not
    // on that layer; the root's own. One on the layer you stand on opens there. Any other, behind or folded onto a card,
    // has the layer it lies on stand first (`clickStands`), as a navigate does; and so does one whose parent leads no layer.
    int group = n.parent ? *n.parent : n.id;
    bool here = !t.condensed(n) && t.seat(n).depth == t.standDepth();
    if ((!here && clickStands) || (here && !t.nodes[group].head)) standGroup(t, group);
    t.open(nodeID);
    logLine("[agent] opened " + model.catalog->title(n.ref));
    return true;
}

std::optional<Bridge::Video> Bridge::video(int nodeID) {
    Planted* p = model.tree ? plantedOf(*model.tree) : nullptr;
    if (!p || !p->service.count(nodeID)) return std::nullopt;
    const Node* n = client.mirror().node(NodeId{p->service[nodeID]});
    if (!n || n->view.component != "video") return std::nullopt;
    std::string src = Json(n->view.props)["src"].string("");
    if (src.empty()) return std::nullopt;
    // On the service, a file it holds (`/assets/<id>`, or one it relays): it answers byte ranges, so it streams and seeks.
    const std::string& service = client.address().http;
    if (src.find("://") == std::string::npos) return Video{client.address().resolve(src)};
    if (src.rfind(service + "/", 0) == 0) return Video{client.address().resolve(src.substr(service.size()))};
    // Elsewhere: only over https, and as it is. The service's token is the service's alone.
    if (src.rfind("https://", 0) == 0) return Video{src, true};
    if (unsafe.insert(n->id.value).second) {
        logLine("[agent] " + model.catalog->title(p->tree->nodes[nodeID].ref) + "'s video is not over https, so it does not play");
    }
    return std::nullopt;
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
    for (size_t k = 0; k < offered->questions.size() && k < mostQuestions; k++) asks.push_back(Ask{"question", offered->questions[k]});
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

void Bridge::lead(Planted& p, int nodeID) {
    TreeNode& n = p.tree->nodes[nodeID];
    if (!n.kept) {
        client.send(Outbound::keep({NodeId{p.service[nodeID]}}));
        n.kept = true;
        logLine("[agent] kept " + model.catalog->title(n.ref));
    }
    if (!n.head) {
        Tree::Change moved = p.tree->focus(nodeID);
        model.arrive(moved.added);
        model.restyle();
    }
}

void Bridge::converse(int nodeID, const std::string& question) {
    Planted* p = model.tree ? plantedOf(*model.tree) : nullptr;
    if (!p || !p->service.count(nodeID)) return;
    NodeId id{p->service[nodeID]};
    lead(*p, nodeID);
    if (client.send(Outbound::ask(id, question)) && voice) voice->asked(question);
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
    Mat4 head = platform::head().value_or(Mat4::trs(model.stage.origin, Quat::identity(), {1, 1, 1}));
    presenceView->frame(voice->presence(), voice->name(), head, now);
}

bool Bridge::speaking() const {
    using S = Presence::State;
    if (!voice) return false;
    S state = voice->presence().state;
    // Thinking alone does not hold the view: only once Momo's reply has come and is about to sound, or is on its way as a file.
    return state == S::listening || state == S::sent || state == S::responding || voice->lineComing() || !voice->saying().empty();
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
        // A tree is gone to as it stands: on the layer it was left on, its deepest when it came whole.
        auto found = trees.find(to.treeId->value);
        if (found != trees.end()) {
            p = &found->second;
            id = p->tree->stand;
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
    // A card is gone to in its group: one that leads a layer stands it, and any other stands its group's first (where
    // several groups share a layer, the one it is in) and opens.
    if (n.head) {
        t.focus(id);
    } else if (t.condensed(n) || *n.parent != t.stand || !opens(id)) {
        standGroup(t, *n.parent);
        t.open(id);
    }
    model.restyle();
    logLine("[agent] went to " + model.catalog->title(n.ref) + " in \"" + t.title + "\" (" + p.service[id] + "), on the layer of " +
            p.service[t.stand]);
    // (`-placesOnGo`: where every card on that layer is headed, for checking each layer of a tree in turn.)
    static const bool places = Flags::has("placesOnGo");
    if (places) model.logPlaces();
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

void Bridge::longPinch(int nodeID) {
    Planted* p = model.tree ? plantedOf(*model.tree) : nullptr;
    if (!p || !p->service.count(nodeID)) return;
    Tree& t = *p->tree;
    if (t.nodes[nodeID].children.empty()) {
        moreLike(nodeID);
        return;
    }
    t.lead(nodeID);
    standGroup(t, nodeID);
    model.restyle();
    logLine("[agent] into the layer of " + model.catalog->title(t.nodes[nodeID].ref));
}

void Bridge::moreLike(int nodeID) {
    Planted* p = model.tree ? plantedOf(*model.tree) : nullptr;
    if (!p || !p->service.count(nodeID)) return;
    NodeId id{p->service[nodeID]};
    std::string marked;
    if (const Node* n = client.mirror().node(id)) {
        for (const Edit& e : n->edits) {
            if (e.kind == Edit::Kind::highlight && marked.size() < 600) marked += (marked.empty() ? "\"" : "; \"") + e.quote + "\"";
        }
    }
    std::optional<std::string> need;
    if (!marked.empty()) need = "More like this, especially what I highlighted: " + marked;
    lead(*p, nodeID);
    if (client.send(Outbound::more(id, need)) && voice) voice->asked(need ? "More like this, especially what I highlighted" : "More like this");
    logLine("[agent] more like this" + (need ? ": " + *need : std::string(", with nothing highlighted")));
}

bool Bridge::treeFrom(const Ref& ref) {
    std::string title = model.catalog->title(ref);
    // The service roots a tree on something the user has when its title is said ("make a tree about …", read by plain
    // rules). Those rules end the subject at a colon, a long dash or " - ", and its title match ignores punctuation, so
    // each becomes a comma, which reads as the user would say it: "2001, A Space Odyssey".
    std::string subject;
    for (size_t i = 0; i < title.size(); i++) {
        bool dash = title.compare(i, 3, "—") == 0 || title.compare(i, 3, "–") == 0;
        bool spaced = title[i] == '-' && i > 0 && title[i - 1] == ' ';
        if (!dash && !spaced && title[i] != ':' && title[i] != '\n') {
            subject += title[i];
            continue;
        }
        while (!subject.empty() && subject.back() == ' ') subject.pop_back();
        subject += ',';
        if (dash) i += 2;
    }
    std::string words = "Make a tree about " + subject;
    if (!client.send(Outbound::utter(words, true, scene()))) return false;
    if (voice) voice->asked(words);
    logLine("[agent] asked for a tree about " + title);
    return true;
}

bool Bridge::serves(const Tree& tree) { return plantedOf(tree) != nullptr; }

bool Bridge::sendTree(const Tree& tree) {
    for (const auto& [key, p] : trees) {
        if (p.tree.get() != &tree) continue;
        bool sent = client.send(Outbound::handoff(Scope{.treeIds = {TreeId{key}}, .nodeIds = {}}));
        if (sent) logLine("[agent] asked for the handoff of \"" + tree.title + "\"");
        return sent;
    }
    return false;
}

void Bridge::shareAnswered(const Shared& answer) {
    auto found = trees.find(answer.tree.value);
    std::shared_ptr<Tree> tree = found != trees.end() ? found->second.tree : nullptr;
    logLine(fmt("[agent] the share of %s %s%s%s", tree ? ("\"" + tree->title + "\"").c_str() : answer.tree.value.c_str(),
                answer.ok ? "was taken" : ("was not taken: " + answer.reason).c_str(), answer.text.empty() ? "" : ", ",
                answer.text.c_str()));
    if (answer.tree.value == lastShared) lastShared.clear();
    // Taken: through Telegram, the button says so now and the tree's copy goes (the demo's says so at the pick). Not: the
    // button says why, on the tree's cover.
    if (answer.ok && tree && sharesByTelegram()) model.shareTaken(*tree);
    if (!answer.ok && tree) model.shareRefused(*tree, answer.reason);
}

bool Bridge::shareTree(const Tree& tree) {
    for (const auto& [key, p] : trees) {
        if (p.tree.get() != &tree) continue;
        bool sent = client.send(Outbound::share(TreeId{key}));
        if (sent) lastShared = key;
        if (sent) logLine("[agent] asked to share \"" + tree.title + "\"");
        return sent;
    }
    return false;
}

bool Bridge::addPiece(const Ref& ref) {
    Planted* p = model.tree ? plantedOf(*model.tree) : nullptr;
    std::optional<ItemId> item = libraryItem(ref, *model.catalog);
    if (!p || !item) return false;
    std::string title = model.catalog->title(ref);
    // Under the card in focus, as Kai's own trees take a piece brought in.
    int at = p->service.count(p->tree->current) ? p->tree->current : p->tree->root;
    if (!p->service.count(at)) return false;
    NodeId parent{p->service[at]};
    const Node* under = client.mirror().node(parent);
    if (!under) return false;
    for (const Node* n : client.mirror().treeNodes(under->treeId)) {
        if (n->itemId != *item) continue;
        logLine("[agent] " + title + " is already on \"" + p->tree->title + "\", so it is not added again");
        return true;
    }
    double order = 0;
    for (const Node* n : client.mirror().children(parent)) order = std::max(order, n->order + 1);
    if (!client.send(Outbound::commands("Add " + title, {Command::addNode(newNodeId(), under->treeId, *item, parent, order)}))) return false;
    logLine("[agent] added " + title + " (" + item->value + ") to \"" + p->tree->title + "\" under " + parent.value);
    return true;
}

void Bridge::tellMore(int nodeID, const std::string& question) {
    Planted* p = model.tree ? plantedOf(*model.tree) : nullptr;
    if (!p || !p->service.count(nodeID) || question.empty()) return;
    if (!asking.begin(p->service[nodeID], question, now)) {
        logLine("[agent] still asking, so not again: " + question);
        return;
    }
    converse(nodeID, question);
}

namespace {

/// Which of the appearances of `quote` in `text` starts at `at` (UTF-16 units), or 0 when it is not there.
int appearanceAt(const std::string& text, const std::string& quote, std::optional<int> at) {
    std::u16string in = utf16(text), q = utf16(quote);
    if (!at || q.empty() || in.compare(size_t(std::max(0, *at)), q.size(), q) != 0) return 0;
    int n = 0;
    for (size_t found = in.find(q); found != std::u16string::npos && found < size_t(*at); found = in.find(q, found + q.size())) n++;
    return n;
}

/// Where the `occurrence`th appearance of `quote` starts in `text` (UTF-16 units), if it has that many.
std::optional<int> whereIn(const std::string& text, const std::string& quote, int occurrence) {
    std::u16string in = utf16(text), q = utf16(quote);
    int n = 0;
    for (size_t found = in.find(q); !q.empty() && found != std::u16string::npos; found = in.find(q, found + q.size())) {
        if (n++ == occurrence) return int(found);
    }
    return std::nullopt;
}

}  // namespace

bool Bridge::editable(int nodeID) {
    Planted* p = model.tree ? plantedOf(*model.tree) : nullptr;
    return p && p->service.count(nodeID);
}

std::vector<CardEdit> Bridge::sceneEdits(const Node& node) {
    const Item* item = client.mirror().item(node.itemId);
    std::vector<CardEdit> out;
    for (const Edit& e : node.edits) {
        if (e.kind == Edit::Kind::highlight) {
            out.push_back(CardEdit{.id = e.id, .kind = CardEdit::Kind::highlight, .quote = e.quote,
                                   .occurrence = item ? appearanceAt(item->text, e.quote, e.at) : 0});
        } else if (e.kind == Edit::Kind::stretch) {
            out.push_back(CardEdit{.id = e.id, .kind = CardEdit::Kind::stretch, .from = e.from, .to = e.to});
        } else {
            CardEdit line{.id = e.id, .kind = CardEdit::Kind::stroke};
            for (const auto& [x, y] : e.points) line.points.push_back(Vec2{x, y});
            out.push_back(std::move(line));
        }
    }
    return out;
}

std::vector<CardEdit> Bridge::edits(int nodeID) {
    Planted* p = model.tree ? plantedOf(*model.tree) : nullptr;
    const Node* n = p && p->service.count(nodeID) ? client.mirror().node(NodeId{p->service[nodeID]}) : nullptr;
    return n ? sceneEdits(*n) : std::vector<CardEdit>{};
}

void Bridge::edited(int nodeID, const CardEdit& made) {
    Planted* p = model.tree ? plantedOf(*model.tree) : nullptr;
    if (!p || !p->service.count(nodeID)) return;
    NodeId id{p->service[nodeID]};
    Edit e{.id = made.id};
    if (made.kind == CardEdit::Kind::highlight) {
        const Node* n = client.mirror().node(id);
        const Item* item = n ? client.mirror().item(n->itemId) : nullptr;
        e.quote = made.quote;
        e.at = item ? whereIn(item->text, made.quote, made.occurrence) : std::nullopt;
    } else if (made.kind == CardEdit::Kind::stretch) {
        e.kind = Edit::Kind::stretch;
        e.from = made.from;
        e.to = made.to;
    } else {
        e.kind = Edit::Kind::stroke;
        for (Vec2 v : made.points) e.points.emplace_back(v.x, v.y);
    }
    const char* label = e.kind == Edit::Kind::highlight ? "Highlight words" : e.kind == Edit::Kind::stretch ? "Mark a stretch" : "Draw a line";
    client.send(Outbound::commands(label, {Command::addEdit(id, e)}));
}

void Bridge::erasedAll(int nodeID, const std::vector<std::string>& editIds) {
    Planted* p = model.tree ? plantedOf(*model.tree) : nullptr;
    if (!p || !p->service.count(nodeID) || editIds.empty()) return;
    NodeId id{p->service[nodeID]};
    std::vector<Command> commands;
    for (const std::string& editId : editIds) commands.push_back(Command::removeEdit(id, editId));
    client.send(Outbound::commands(editIds.size() == 1 ? "Erase a mark" : "Erase the marks", std::move(commands)));
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
            plots[id] = cover->plot;
        } else if (standing(p) && model.standingPlot) {
            plots[id] = *model.standingPlot;
        }
        // The layer stood on, for the tree the user is in: a tree only ever put away keeps the place it was left at.
        auto stood = p.service.find(p.tree->stand);
        if (standing(p) && stood != p.service.end()) stands[id] = stood->second;
    }
    std::string file = plotsFile();
    if (file.empty()) return;
    ShelfPlots kept = ShelfPlots::parse(platform::readFile(file).value_or(""));
    kept.services[client.address().http] = plots;
    kept.stands[client.address().http] = stands;
    platform::writeFile(file, kept.text());
}

}  // namespace agent
