// `-presenceDemo`: Momo's presence going through every state and look on a 38 s loop, with made-up words, voice and
// agents at work, so how it looks and moves can be judged without the service. Once a loop it logs what the view took
// a frame on the frame thread, and as they happen, when Momo blinks and which way its eyes glance, so a picture of
// either can be timed.
#pragma once
#include <memory>
#include <vector>

#include "crew.h"
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

    static constexpr double loop = 38;
    /// What the voice would say `t` s into the loop, written into `p` (its words reuse their room). The agents' lines
    /// are the demo's to fill.
    static void at(double t, Presence& p);

private:
    OceanModel& model;
    std::unique_ptr<PresenceView> view;
    Presence presence;
    Crew crew;
    double played = -1;             // how far into the loop the agents' steps have been played
    bool shut = false;
    int looking = 0;                // which way the eyes were last said to glance: -1 left, 1 right
    /// What the view took each frame, ms, logged once a loop.
    std::vector<double> took;
    double loggedAt = 0;
};

}  // namespace agent
