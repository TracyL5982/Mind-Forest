// The agent service in the ocean: its mindstorm drawn as trees, and what a hand does sent back to it.
// Made at launch only with `-agent <address>`; without it the ocean is exactly as it was.
#pragma once
#include <memory>
#include <optional>
#include <string>
#include <vector>

#include "ocean/catalog.h"
#include "ocean/tree.h"

class OceanModel;

namespace agent {

class Bridge {
public:
    /// The bridge `-agent`, `-agentToken` and `-agentDump` ask for, or null when there is no `-agent`.
    static std::shared_ptr<Bridge> fromFlags(OceanModel& model);
    virtual ~Bridge() = default;

    /// Once a frame, on the frame thread: what the service sent since the last frame reaches the scene.
    virtual void frame(double now) = 0;
    /// A card was asked about (`take`). `wasPick`: it was a suggestion until this pinch kept it.
    virtual void took(int nodeID, bool wasPick) = 0;
    /// One of the open card's questions was picked. True when the service takes it (the card is the service's).
    virtual bool ask(int nodeID, int k) = 0;
    /// The marked part of the open card was asked about. True when the service takes it.
    virtual bool askMark(int nodeID, const Mark& mark) = 0;
    /// A branch was cut with the flat of the hand; `gone` is what left with it.
    virtual void pruned(int nodeID, const std::vector<TreeNode>& gone) = 0;
    /// The tree was pressed by a clap: sent on, or put away.
    virtual void pressed(const Tree& tree, bool send) = 0;
};

}  // namespace agent
