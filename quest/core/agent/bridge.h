// The agent service in the ocean: its mindstorm drawn as trees, and what a hand does sent back to it.
// Made at launch only with `-agent <address>`; without it the ocean is exactly as it was.
//
// Each service tree is a `Tree` with `grows` off, so its cards come from the service, never from the
// catalog. The newest stands when nothing does; the rest hang as covers on the shelf. A service item
// is a note in the catalog ("agent-<item id>"), or the film or work itself when it is from the
// headset's own library. A pick is a node that is not kept: its thread is dashed until a pinch keeps it.
#pragma once
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <vector>

#include "agent/client.h"
#include "ocean/catalog.h"
#include "ocean/tree.h"

class OceanModel;

namespace agent {

class Bridge {
public:
    /// The bridge `-agent`, `-agentToken` and `-agentDump` ask for, or null when there is no `-agent`.
    static std::shared_ptr<Bridge> fromFlags(OceanModel& model);
    Bridge(OceanModel& model, Address address, std::shared_ptr<Transport> transport, std::optional<std::string> dump);

    /// Once a frame, on the frame thread: what the service sent since the last frame reaches the scene.
    void frame(double now);
    /// A card was asked about (`take`). `wasPick`: it was a suggestion until this pinch kept it.
    void took(int nodeID, bool wasPick);
    /// One of the open card's questions was picked. True when the service takes it (the tree is the service's).
    bool ask(int nodeID, int k);
    /// The marked part of the open card was asked about. True when the service takes it.
    bool askMark(int nodeID, const Mark& mark);
    /// A branch was cut with the flat of the hand; `gone` is what left with it.
    void pruned(int nodeID, const std::vector<TreeNode>& gone);
    /// The tree was pressed by a clap: sent on, or put away.
    void pressed(const Tree& tree, bool send);

private:
    /// One service tree as the scene holds it.
    struct Planted {
        std::shared_ptr<Tree> tree;
        std::map<std::string, int> local;           // service node id -> TreeNode id
        std::map<int, std::string> service;         // TreeNode id -> service node id
    };
    /// A service activity on a card, shown as the scene's "Thinking…" until it is done.
    struct Thinking {
        std::string tree;
        int node;
        double shown;
    };

    OceanModel& model;
    Client client;
    std::optional<std::string> dump;
    std::map<std::string, Planted> trees;           // by service tree id
    std::map<std::string, Thinking> thinking;       // by activity id
    /// The service node last reported as open, so the service hears each time the open card changes.
    std::optional<std::string> focusSent;
    /// `-agentWalk <n>`: for runs with no hands, the first new pick round the open card is pinched, n times.
    int walk = 0;
    double now = 0;

    void synced(const Delta& delta);
    void changed(const Delta& delta, bool animate);
    void activity(const Activity& a);
    /// Makes the scene's tree for a service tree, with every node the mirror holds for it.
    Planted* plant(const TreeInfo& info);
    /// Puts one service node into its tree. Returns the TreeNode id, or nullopt if its parent is not there yet.
    std::optional<int> graft(Planted& p, const Node& node);
    /// Takes a service node, and what hangs from it, out of the scene.
    void remove(const std::string& nodeId);
    /// The scene's reference for an item: its film or work, or a note made for it in the catalog.
    Ref refFor(const Item& item);
    Planted* plantedOf(const Tree& tree);
    Planted* holding(const std::string& nodeId);
    bool standing(const Planted& p) const;
    /// Tells the service which card is open when that changes: standing a tree, unfolding a cover, a pinch, a step.
    void reportFocus();
};

}  // namespace agent
