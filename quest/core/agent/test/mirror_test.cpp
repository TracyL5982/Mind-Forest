#include "support.h"

#include <algorithm>

using namespace agent;

namespace {

/// The mirror after the session's first hello and every change set before the one with this label.
Mirror replayedUntil(const std::string& label) {
    Mirror mirror;
    mirror.apply(firstHello().snapshot);
    for (Change& change : sessionChanges()) {
        if (change.set.label == label) break;
        mirror.apply(change.set);
    }
    return mirror;
}

Delta applied(Mirror& mirror, const ChangeSet& set) {
    Applied result = mirror.apply(set);
    if (auto* gap = std::get_if<Gap>(&result)) CHECK(false, "\"%s\" did not follow: %s", set.label.c_str(), gap->why.c_str());
    if (std::holds_alternative<Stale>(result)) CHECK(false, "\"%s\" was stale", set.label.c_str());
    auto* delta = std::get_if<Delta>(&result);
    return delta ? *delta : Delta{};
}

template <class E>
std::vector<std::string> values(const std::vector<IdOf<E>>& ids) {
    std::vector<std::string> out;
    for (const IdOf<E>& id : ids) out.push_back(id.value);
    return out;
}

std::string joined(const std::vector<std::string>& list) {
    std::string out;
    for (const std::string& s : list) out += (out.empty() ? "" : ",") + s;
    return out;
}

/// The ids a recorded set's patches touch for one entity, in order, by how the raw patch reads.
std::vector<std::string> patchIds(const ChangeSet& set, const char* entity, const char* how) {
    std::vector<std::string> out;
    for (const Patch& patch : set.patches) {
        std::visit(overloaded{
                       [&]<class E>(const PatchOf<E>& p) {
                           const char* name = std::is_same_v<E, Item> ? "item" : std::is_same_v<E, Node> ? "node" : std::is_same_v<E, TreeInfo> ? "tree" : "other";
                           const char* kind = !p.before ? "added" : !p.after ? "removed" : "changed";
                           if (std::string(name) == entity && std::string(kind) == how) out.push_back(p.id.value);
                       },
                       [](const UnknownPatch&) {},
                   },
                   patch);
    }
    return out;
}

bool sameState(const Mirror& mirror, const Snapshot& snapshot) {
    return mirror.items() == keyed(snapshot.items) && mirror.nodes() == keyed(snapshot.nodes) && mirror.trees() == keyed(snapshot.trees) &&
           mirror.links() == keyed(snapshot.links) && mirror.groups() == keyed(snapshot.groups);
}

}  // namespace

TEST(replayingTheSessionComesToWhatAFreshHelloHolds) {
    std::vector<Change> changes = sessionChanges();
    bool skipped = false;
    for (size_t i = 1; i < changes.size(); i++) skipped = skipped || changes[i].set.seq > changes[i - 1].set.seq + 1;
    CHECK(skipped, "the recorded session skips a seq, as the service does after a set that changed nothing");

    Mirror mirror;
    mirror.apply(firstHello().snapshot);
    for (Change& change : changes) applied(mirror, change.set);
    Hello final = finalHello();
    CHECK(sameState(mirror, final.snapshot), "the mirror holds what a second connection's hello does");
    CHECK_EQ(mirror.seq(), final.snapshot.seq);
}

TEST(aChangeThatAdds) {
    ChangeSet set = recordedSet("Add \"Dolly zoom\"");
    Mirror mirror = replayedUntil(set.label);
    Delta delta = applied(mirror, set);
    CHECK_EQ(joined(values<Item>(delta.items.added)), joined(patchIds(set, "item", "added")));
    CHECK_EQ(joined(values<Node>(delta.nodes.added)), joined(patchIds(set, "node", "added")));
    CHECK_EQ(joined(values<TreeInfo>(delta.trees.added)), joined(patchIds(set, "tree", "added")));
    CHECK_EQ(delta.trees.added.size(), size_t(1));
    CHECK(delta.items.changed.empty() && delta.nodes.changed.empty() && delta.nodes.removed.empty(), "only additions");
    const TreeInfo* tree = mirror.tree(delta.trees.added.at(0));
    CHECK(tree && mirror.node(tree->rootId), "the new tree's root is in the mirror");
    CHECK_EQ(mirror.roots().size(), size_t(1));
}

TEST(aChangeThatChanges) {
    ChangeSet set = recordedSet("Keep a pick");
    Mirror mirror = replayedUntil(set.label);
    std::vector<std::string> kept = patchIds(set, "node", "changed");
    CHECK_EQ(kept.size(), size_t(1));
    NodeId id{kept.at(0)};
    CHECK(mirror.node(id) && mirror.node(id)->status == Node::Status::pick, "a pick before");
    Delta delta = applied(mirror, set);
    CHECK_EQ(joined(values<Node>(delta.nodes.changed)), kept.at(0));
    CHECK(delta.nodes.added.empty() && delta.nodes.removed.empty() && delta.items.empty(), "nothing else");
    CHECK(mirror.node(id) && mirror.node(id)->status == Node::Status::kept, "kept after");
}

TEST(aChangeThatRemoves) {
    ChangeSet set = recordedSet("Cut a card");
    Mirror mirror = replayedUntil(set.label);
    std::vector<std::string> cut = patchIds(set, "node", "removed");
    CHECK_EQ(cut.size(), size_t(1));
    NodeId id{cut.at(0)};
    const Node* before = mirror.node(id);
    CHECK(before, "the node is there before");
    if (!before) return;
    Node last = *before;
    NodeId parent = *last.parent;
    size_t siblings = mirror.children(parent).size();

    Delta delta = applied(mirror, set);
    CHECK_EQ(delta.nodes.removed.size(), size_t(1));
    CHECK(delta.nodes.removed.at(0) == last, "removed with its last value");
    CHECK_EQ(joined(values<Item>(delta.items.changed)), last.itemId.value);
    CHECK(!mirror.node(id), "gone after");
    CHECK(mirror.item(last.itemId) && mirror.item(last.itemId)->archived, "its item is archived, not gone");
    CHECK_EQ(mirror.children(parent).size(), siblings - 1);
}

TEST(anUndoPutsItBack) {
    ChangeSet cut = recordedSet("Cut a card");
    ChangeSet undo = recordedSet("Undo: " + cut.label);
    Mirror mirror = replayedUntil(undo.label);
    Delta delta = applied(mirror, undo);
    CHECK_EQ(joined(values<Node>(delta.nodes.added)), joined(patchIds(cut, "node", "removed")));
    CHECK(undo.undoes && *undo.undoes == cut.id, "it names what it undoes");
}

TEST(patchesApplyInOrder) {
    Mirror mirror;
    mirror.apply(finalHello().snapshot);
    Node made = mirror.nodes().begin()->second;
    made.id = NodeId{"made-here"};
    made.parent = mirror.roots().at(0)->id;
    Node changed = made;
    changed.why = "second";

    ChangeSet addThenChange{.id = SetId{"s-a"}, .seq = mirror.seq() + 1, .label = "add then change"};
    addThenChange.patches = {PatchOf<Node>{made.id, std::nullopt, made}, PatchOf<Node>{made.id, made, changed}};
    Delta delta = applied(mirror, addThenChange);
    CHECK_EQ(joined(values<Node>(delta.nodes.added)), "made-here");
    CHECK(delta.nodes.changed.empty(), "made and changed in one set is simply added");
    CHECK(mirror.node(made.id) && mirror.node(made.id)->why == "second", "the later patch wins");

    ChangeSet changeThenRemove{.id = SetId{"s-b"}, .seq = mirror.seq() + 1, .label = "change then remove"};
    changeThenRemove.patches = {PatchOf<Node>{made.id, changed, made}, PatchOf<Node>{made.id, made, std::nullopt}};
    delta = applied(mirror, changeThenRemove);
    CHECK_EQ(delta.nodes.removed.size(), size_t(1));
    CHECK(delta.nodes.removed.at(0).why == "second", "removed as it was before the set");
    CHECK(!mirror.node(made.id), "gone");

    ChangeSet comeAndGo{.id = SetId{"s-c"}, .seq = mirror.seq() + 1, .label = "come and go"};
    comeAndGo.patches = {PatchOf<Node>{made.id, std::nullopt, made}, PatchOf<Node>{made.id, made, std::nullopt}};
    delta = applied(mirror, comeAndGo);
    CHECK(delta.empty(), "came and went within the set");

    ChangeSet reversed{.id = SetId{"s-d"}, .seq = mirror.seq() + 1, .label = "reversed"};
    reversed.patches = {PatchOf<Node>{made.id, made, changed}, PatchOf<Node>{made.id, std::nullopt, made}};
    CHECK(std::holds_alternative<Gap>(mirror.apply(reversed)), "the same patches out of order don't follow");
}

TEST(aPatchToAnUnknownEntityIsPassedOver) {
    ChangeSet set = recordedSet("Keep a pick");
    Mirror mirror = replayedUntil(set.label);
    set.patches.push_back(UnknownPatch{"comment", "c1"});
    Delta delta = applied(mirror, set);
    CHECK_EQ(delta.nodes.changed.size(), size_t(1));
}

TEST(aSetTheMirrorAlreadyHoldsIsStale) {
    Mirror mirror;
    mirror.apply(finalHello().snapshot);
    ChangeSet old = recordedSet("Keep a pick");
    std::map<NodeId, Node> nodes = mirror.nodes();
    CHECK(std::holds_alternative<Stale>(mirror.apply(old)), "seq %lld is not past %lld", (long long)old.seq, (long long)mirror.seq());
    CHECK(mirror.nodes() == nodes, "unchanged");
}

TEST(aMissedSetIsAGapAndChangesNothing) {
    ChangeSet picks = recordedSet("Picks for \"Dolly zoom\"");
    ChangeSet formats = recordedSet("Choose formats");
    CHECK_EQ(formats.seq, picks.seq + 1);
    Mirror mirror = replayedUntil(picks.label);
    int64_t seq = mirror.seq();
    std::map<NodeId, Node> nodes = mirror.nodes();
    Applied result = mirror.apply(formats);
    auto* gap = std::get_if<Gap>(&result);
    CHECK(gap, "formats for picks the mirror never got");
    if (gap) CHECK(gap->why.find("node ") == 0, "why: %s", gap->why.c_str());
    CHECK(mirror.nodes() == nodes && mirror.seq() == seq, "unchanged");

    Mirror half;
    half.apply(finalHello().snapshot);
    std::map<NodeId, Node> all = half.nodes();
    Node first = all.begin()->second;
    Node edited = first;
    edited.why = "edited";
    Node stranger = std::next(all.begin())->second;
    stranger.id = NodeId{"never-seen"};
    ChangeSet partly{.id = SetId{"s-p"}, .seq = half.seq() + 5, .label = "half follows"};
    partly.patches = {PatchOf<Node>{first.id, first, edited}, PatchOf<Node>{stranger.id, stranger, std::nullopt}};
    CHECK(std::holds_alternative<Gap>(half.apply(partly)), "the second patch finds nothing to remove");
    CHECK(half.nodes() == all, "the first patch is taken back");
}

TEST(aSnapshotDeltaIsAgainstWhatWasHeld) {
    Hello final = finalHello();
    Mirror fresh;
    Delta all = fresh.apply(final.snapshot);
    CHECK_EQ(all.items.added.size(), final.snapshot.items.size());
    CHECK_EQ(all.nodes.added.size(), final.snapshot.nodes.size());
    CHECK_EQ(all.trees.added.size(), final.snapshot.trees.size());
    CHECK(all.nodes.changed.empty() && all.nodes.removed.empty(), "into an empty mirror, everything is added");

    CHECK(fresh.apply(final.snapshot).empty(), "the same snapshot again changes nothing");

    Snapshot meanwhile = final.snapshot;
    auto leaf = std::find_if(meanwhile.nodes.begin(), meanwhile.nodes.end(), [&](const Node& n) { return n.parent && fresh.children(n.id).empty(); });
    Node gone = *leaf;
    meanwhile.nodes.erase(leaf);
    meanwhile.items.front().title = "Renamed meanwhile";
    meanwhile.links.push_back(Link{.id = LinkId{"l1"}, .a = meanwhile.nodes[0].id, .b = meanwhile.nodes[1].id, .why = "tie", .strength = 0.9});
    Delta delta = fresh.apply(meanwhile);
    CHECK_EQ(delta.nodes.removed.size(), size_t(1));
    CHECK(delta.nodes.removed.at(0) == gone, "removed with its last value");
    CHECK_EQ(joined(values<Item>(delta.items.changed)), meanwhile.items.front().id.value);
    CHECK_EQ(joined(values<Link>(delta.links.added)), "l1");
    CHECK(delta.nodes.added.empty() && delta.nodes.changed.empty() && delta.trees.empty(), "nothing else");
    std::vector<const Node*> siblings = fresh.children(*gone.parent);
    CHECK(!fresh.node(gone.id) && std::none_of(siblings.begin(), siblings.end(), [&](const Node* n) { return n->id == gone.id; }),
          "the removed node is no one's child");
}

TEST(theQuestionsASceneAsks) {
    Hello final = finalHello();
    Mirror mirror;
    mirror.apply(final.snapshot);
    const TreeInfo& tree = final.snapshot.trees.at(0);

    std::vector<const Node*> roots = mirror.roots();
    CHECK(roots.size() == 1 && roots[0]->id == tree.rootId, "one root, the tree's");
    CHECK_EQ(mirror.depth(tree.rootId), 0);

    std::vector<const Node*> kids = mirror.children(tree.rootId);
    std::vector<Node> expected;
    for (const Node& n : final.snapshot.nodes) {
        if (n.parent == tree.rootId) expected.push_back(n);
    }
    std::stable_sort(expected.begin(), expected.end(), [](const Node& a, const Node& b) { return a.order < b.order || (a.order == b.order && a.id < b.id); });
    CHECK_EQ(kids.size(), expected.size());
    for (size_t i = 0; i < std::min(kids.size(), expected.size()); i++) CHECK_EQ(kids[i]->id.value, expected[i].id.value);
    for (const Node* kid : kids) CHECK_EQ(mirror.depth(kid->id), 1);

    std::vector<const Node*> order = mirror.treeNodes(tree.id);
    CHECK_EQ(order.size(), final.snapshot.nodes.size());
    CHECK(!order.empty() && order[0]->id == tree.rootId, "the root first");
    int grandchildren = 0;
    for (size_t i = 1; i < order.size(); i++) {
        auto parent = std::find_if(order.begin(), order.begin() + long(i), [&](const Node* n) { return n->id == *order[i]->parent; });
        CHECK(parent != order.begin() + long(i), "%s comes after its parent", order[i]->id.value.c_str());
        if (parent != order.begin() + long(i)) CHECK_EQ(mirror.depth(order[i]->id), mirror.depth((*parent)->id) + 1);
        grandchildren += mirror.depth(order[i]->id) == 2;
    }
    CHECK(grandchildren > 0, "the session made picks under a kept pick");

    for (const Node& n : final.snapshot.nodes) {
        const Item* item = mirror.itemOf(n.id);
        CHECK(item && item->id == n.itemId, "itemOf %s", n.id.value.c_str());
    }

    Snapshot two = final.snapshot;
    TreeInfo older = tree;
    older.id = TreeId{"zz-older"};
    older.createdAt = "2020-01-01T00:00:00.000Z";
    Node root = *mirror.node(tree.rootId);
    root.id = NodeId{"zz-older-root"};
    root.treeId = older.id;
    older.rootId = root.id;
    two.trees.push_back(older);
    two.nodes.push_back(root);
    mirror.apply(two);
    roots = mirror.roots();
    CHECK(roots.size() == 2 && roots[0]->id == root.id && roots[1]->id == tree.rootId, "the oldest tree first, whatever its id");
    CHECK(mirror.treeNodes(older.id).size() == 1, "a tree of one");
    CHECK(mirror.children(NodeId{"nothing"}).empty() && mirror.treeNodes(TreeId{"nothing"}).empty(), "nothing for what isn't there");
}
