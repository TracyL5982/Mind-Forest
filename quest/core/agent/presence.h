// What the voice is doing, for the view of Momo's presence in the scene (presence_view.h): one value the frame
// thread reads each frame. The voice fills it (Voice::presence), and the bridge adds the card the agent works on.
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
