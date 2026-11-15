// `-presenceDemo`: Momo's presence going through every state on a 30 s loop, with made-up words and voice, so its look
// and motion can be judged without the service. Working, it looks to the open card when a tree stands (`-cards`).
// Once a loop it logs what the view took a frame on the frame thread.
#pragma once
#include <memory>
#include <vector>

#include "presence.h"
#include "presence_view.h"

class OceanModel;

namespace agent {

class PresenceDemo {
public:
    /// The demo `-presenceDemo` asks for, or null.
    static std::shared_ptr<PresenceDemo> fromFlags(OceanModel& model);
    explicit PresenceDemo(OceanModel& model) : model(model) {}

    void frame(double now);

    static constexpr double loop = 30;
    /// What the voice would say `t` s into the loop, written into `p` (its words reuse their room).
    static void at(double t, Presence& p);

private:
    OceanModel& model;
    std::unique_ptr<PresenceView> view;
    Presence presence;
    /// What the view took each frame, ms, logged once a loop.
    std::vector<double> took;
    double loggedAt = 0;
};

}  // namespace agent
