// The client's copy of the mindstorm: five maps keyed by id, replaced by a snapshot and patched by
// change sets, and the questions a scene asks of them. The service is the record; this keeps up.
#pragma once
#include <map>
#include <set>
#include <string>
#include <tuple>
#include <variant>
#include <vector>

#include "protocol.h"

namespace agent {

/// What one kind of entity did: ids made, ids changed, and what was removed, as it last was.
template <class E>
struct Changes {
    std::vector<IdOf<E>> added;
    std::vector<IdOf<E>> changed;
    std::vector<E> removed;
    bool empty() const { return added.empty() && changed.empty() && removed.empty(); }
};

/// What a snapshot or a change set did to the mirror. For a change set, ids are in the order
/// its patches first touched them, which is the order the service made them in.
struct Delta {
    Changes<Item> items;
    Changes<Node> nodes;
    Changes<TreeInfo> trees;
    Changes<Link> links;
    Changes<Group> groups;
    bool empty() const { return items.empty() && nodes.empty() && trees.empty() && links.empty() && groups.empty(); }
};

/// A change set the mirror already holds: its seq is not past the mirror's.
struct Stale {};
/// A change set that does not follow from what the mirror holds, so one was missed. The mirror is
/// left as it was; only a fresh snapshot mends it.
struct Gap {
    std::string why;
};
using Applied = std::variant<Delta, Stale, Gap>;

class Mirror {
public:
    /// Replaces everything. The delta is against what was held before, so after a reconnect only
    /// what changed meanwhile shows as changed.
    Delta apply(Snapshot snapshot);
    /// Applies the patches in order, if each finds the entity as its `before` says. A seq that
    /// skips ahead is fine: the service never sends a set that changed nothing, but counts it.
    Applied apply(const ChangeSet& set);

    int64_t seq() const { return seq_; }

    const std::map<ItemId, Item>& items() const { return std::get<Table<Item>>(tables_); }
    const std::map<NodeId, Node>& nodes() const { return std::get<Table<Node>>(tables_); }
    const std::map<TreeId, TreeInfo>& trees() const { return std::get<Table<TreeInfo>>(tables_); }
    const std::map<LinkId, Link>& links() const { return std::get<Table<Link>>(tables_); }
    const std::map<GroupId, Group>& groups() const { return std::get<Table<Group>>(tables_); }

    /// Null when there is none.
    const Item* item(const ItemId& id) const { return find<Item>(id); }
    const Node* node(const NodeId& id) const { return find<Node>(id); }
    const TreeInfo* tree(const TreeId& id) const { return find<TreeInfo>(id); }
    const Link* link(const LinkId& id) const { return find<Link>(id); }
    const Group* group(const GroupId& id) const { return find<Group>(id); }
    const Item* itemOf(const NodeId& node) const;

    /// The nodes hanging from a node, in their `order`, then by id.
    std::vector<const Node*> children(const NodeId& id) const;
    /// A tree's nodes from its root down, each parent before its children, siblings in order.
    std::vector<const Node*> treeNodes(const TreeId& id) const;
    /// A node's layer: how many parents are above it. A root is 0.
    int depth(const NodeId& id) const;
    /// Every tree's root, the oldest tree first.
    std::vector<const Node*> roots() const;

private:
    template <class E>
    using Table = std::map<IdOf<E>, E>;

    int64_t seq_ = 0;
    std::tuple<Table<Item>, Table<Node>, Table<TreeInfo>, Table<Link>, Table<Group>> tables_;
    std::map<NodeId, std::set<NodeId>> children_;

    template <class E>
    const E* find(const IdOf<E>& id) const {
        const Table<E>& table = std::get<Table<E>>(tables_);
        auto it = table.find(id);
        return it == table.end() ? nullptr : &it->second;
    }
    template <class E>
    void write(const IdOf<E>& id, const std::optional<E>& value);
};

}  // namespace agent
