// What the voice is doing, for the view of Momo's presence in the scene (presence_view.h): one value the frame
// thread reads each frame. WS17 (tracy/quest-live) owns this file; this copy stands in until its commit lands.
#pragma once
#include <optional>
#include <string>

namespace agent {

struct Presence {
    enum class State { off, waiting, listening, sent, thinking, responding, working };
    State state = State::off;
    std::string userText;
    bool userFinal = false;
    std::string momoText;
    float level = 0;
    std::optional<int> workingOn;
    std::string doing;
};

}  // namespace agent
