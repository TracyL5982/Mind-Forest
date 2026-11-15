#include "mirror.h"

#include <algorithm>
#include <type_traits>
#include <utility>

#include "../base.h"

namespace agent {

namespace {

template <class E>
Changes<E>& changesOf(Delta& delta) {
    if constexpr (std::is_same_v<E, Item>) return delta.items;
    else if constexpr (std::is_same_v<E, Node>) return delta.nodes;
    else if constexpr (std::is_same_v<E, TreeInfo>) return delta.trees;
    else if constexpr (std::is_same_v<E, Link>) return delta.links;
    else return delta.groups;
}

template <class E>
const char* entityName() {
    if constexpr (std::is_same_v<E, Item>) return "item";
    else if constexpr (std::is_same_v<E, Node>) return "node";
    else if constexpr (std::is_same_v<E, TreeInfo>) return "tree";
    else if constexpr (std::is_same_v<E, Link>) return "link";
    else return "group";
}

/// An entity as it was and as it is; neither means it came and went within one change set.
template <class E>
void compare(Changes<E>& out, const IdOf<E>& id, const E* was, const E* now) {
    if (!was && now) out.added.push_back(id);
    else if (was && !now) out.removed.push_back(*was);
    else if (was && now && !(*was == *now)) out.changed.push_back(id);
}

/// Two id-ordered maps walked side by side.
template <class E>
void compare(Changes<E>& out, const std::map<IdOf<E>, E>& was, const std::map<IdOf<E>, E>& now) {
    auto i = was.begin();
    auto k = now.begin();
    while (i != was.end() || k != now.end()) {
        if (k == now.end() || (i != was.end() && i->first < k->first)) {
            out.removed.push_back(i->second);
            ++i;
        } else if (i == was.end() || k->first < i->first) {
            out.added.push_back(k->first);
            ++k;
        } else {
            if (!(i->second == k->second)) out.changed.push_back(k->first);
            ++i;
            ++k;
        }
    }
}

}  // namespace

template <class E>
void Mirror::write(const IdOf<E>& id, const std::optional<E>& value) {
    Table<E>& table = std::get<Table<E>>(tables_);
    if constexpr (std::is_same_v<E, Node>) {
        auto old = table.find(id);
        if (old != table.end() && old->second.parent) {
            auto kids = children_.find(*old->second.parent);
            if (kids != children_.end()) {
                kids->second.erase(id);
                if (kids->second.empty()) children_.erase(kids);
            }
        }
        if (value && value->parent) children_[*value->parent].insert(id);
    }
    if (value) table.insert_or_assign(id, *value);
    else table.erase(id);
}

Delta Mirror::apply(Snapshot snapshot) {
    auto was = std::move(tables_);
    tables_ = {};
    children_.clear();
    seq_ = snapshot.seq;
    Delta delta;
    auto load = [&]<class E>(std::vector<E>& list) {
        Table<E>& table = std::get<Table<E>>(tables_);
        for (E& e : list) {
            if constexpr (std::is_same_v<E, Node>) {
                if (e.parent) children_[*e.parent].insert(e.id);
            }
            IdOf<E> id = e.id;
            table.insert_or_assign(std::move(id), std::move(e));
        }
        compare(changesOf<E>(delta), std::get<Table<E>>(was), table);
    };
    load(snapshot.items);
    load(snapshot.nodes);
    load(snapshot.trees);
    load(snapshot.links);
    load(snapshot.groups);
    return delta;
}

Applied Mirror::apply(const ChangeSet& set) {
    if (set.seq <= seq_) return Stale{};
    std::string why;
    size_t applied = 0;
    for (; applied < set.patches.size(); applied++) {
        bool follows = std::visit(overloaded{
                                      [&]<class E>(const PatchOf<E>& p) {
                                          const E* now = find<E>(p.id);
                                          if (now ? !(p.before && *now == *p.before) : p.before.has_value()) {
                                              why = fmt("%s %s is not as change set %lld found it", entityName<E>(), p.id.value.c_str(),
                                                        (long long)set.seq);
                                              return false;
                                          }
                                          write<E>(p.id, p.after);
                                          return true;
                                      },
                                      [](const UnknownPatch&) { return true; },
                                  },
                                  set.patches[applied]);
        if (!follows) break;
    }
    if (applied < set.patches.size()) {
        while (applied-- > 0) {
            std::visit(overloaded{
                           [&]<class E>(const PatchOf<E>& p) { write<E>(p.id, p.before); },
                           [](const UnknownPatch&) {},
                       },
                       set.patches[applied]);
        }
        return Gap{why};
    }
    seq_ = set.seq;

    // Each entity's first `before` is what the mirror held, since every patch was checked against it.
    Delta delta;
    std::set<std::pair<size_t, std::string>> seen;
    for (const Patch& patch : set.patches) {
        std::visit(overloaded{
                       [&]<class E>(const PatchOf<E>& p) {
                           if (!seen.insert({patch.index(), p.id.value}).second) return;
                           compare(changesOf<E>(delta), p.id, p.before ? &*p.before : nullptr, find<E>(p.id));
                       },
                       [](const UnknownPatch&) {},
                   },
                   patch);
    }
    return delta;
}

const Item* Mirror::itemOf(const NodeId& id) const {
    const Node* n = node(id);
    return n ? item(n->itemId) : nullptr;
}

std::vector<const Node*> Mirror::children(const NodeId& id) const {
    std::vector<const Node*> out;
    auto kids = children_.find(id);
    if (kids == children_.end()) return out;
    for (const NodeId& kid : kids->second) {
        if (const Node* n = node(kid)) out.push_back(n);
    }
    std::stable_sort(out.begin(), out.end(), [](const Node* a, const Node* b) { return a->order < b->order; });
    return out;
}

std::vector<const Node*> Mirror::treeNodes(const TreeId& id) const {
    std::vector<const Node*> out;
    const TreeInfo* t = tree(id);
    const Node* root = t ? node(t->rootId) : nullptr;
    if (!root) return out;
    // Bounded by the mirror's size, so a loop in the parents can't hang the frame.
    std::vector<const Node*> stack{root};
    while (!stack.empty() && out.size() < nodes().size()) {
        const Node* n = stack.back();
        stack.pop_back();
        out.push_back(n);
        std::vector<const Node*> kids = children(n->id);
        stack.insert(stack.end(), kids.rbegin(), kids.rend());
    }
    return out;
}

int Mirror::depth(const NodeId& id) const {
    int d = 0;
    for (const Node* n = node(id); n && n->parent && size_t(d) < nodes().size(); n = node(*n->parent)) d++;
    return d;
}

std::vector<const Node*> Mirror::roots() const {
    std::vector<const TreeInfo*> oldest;
    for (const auto& [id, t] : trees()) oldest.push_back(&t);
    std::stable_sort(oldest.begin(), oldest.end(), [](const TreeInfo* a, const TreeInfo* b) { return a->createdAt < b->createdAt; });
    std::vector<const Node*> out;
    for (const TreeInfo* t : oldest) {
        if (const Node* root = node(t->rootId)) out.push_back(root);
    }
    return out;
}

}  // namespace agent
