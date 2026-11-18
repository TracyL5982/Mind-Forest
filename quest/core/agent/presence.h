// What the voice is doing, for the view of Momo's presence in the scene (presence_view.h): one value the frame
// thread reads each frame. The voice fills it (Voice::presence).
#pragma once
#include <algorithm>
#include <string>
#include <vector>

namespace agent {

/// The level Momo's ring follows, 0 to 1, from a voice's RMS in -1…1: AgentSphere's, the RMS three times over (its
/// LEVEL_GAIN), so a voice at about -16 dBFS reads near 0.5 and a room's hiss near nothing.
inline float levelOf(float rms) { return std::clamp(rms * 3, 0.f, 1.f); }

/// One agent at work, for its line above Momo's words: "Scout · Searching museum collections for dancing people".
/// Once its last step ends it is `finished` for a while ("Scout · finished working"), then has no line.
struct AgentLine {
    std::string role;       // the service's: "momo", "scout", "renderer", …
    std::string name;       // as shown: "Momo (librarian)", "Scout", …
    std::string step;       // its newest step still going
    bool finished = false;

    bool operator==(const AgentLine&) const = default;
};

struct Presence {
    /// `open`: between turns the conversation is open, and Momo hears the user without its name.
    enum class State { off, waiting, listening, open, sent, thinking, responding, working };
    State state = State::off;
    std::string userText;
    bool userFinal = false;
    std::string momoText;
    float level = 0;
    /// One per agent at work or just finished, in the order they began.
    std::vector<AgentLine> agents;
    /// A line about the app itself, which Momo's caption shows in place of the conversation while there is one, Momo
    /// showing too: the service can't be reached, why the headset asks for the microphone, or (the note on a microphone
    /// that is off) that Momo can't hear.
    std::string notice;
    /// The note's button, under its words ("Allow microphone"); empty for none.
    std::string noticeButton;
    /// WS87: the microphone is not allowed. Momo shows, quiet, with a "microphone off" mark that a pinch opens the note of.
    bool microphoneOff = false;
    /// WS95: the microphone has not been asked for yet (it is, where it is first needed). Momo shows, quiet, unmarked, and
    /// a pinch on her asks for it.
    bool microphoneUnasked = false;

    /// The conversation goes on: Momo listens, thinks or speaks. The ocean's own sounds draw back under it.
    bool conversing() const {
        return state == State::listening || state == State::open || state == State::sent || state == State::thinking ||
               state == State::responding;
    }
    /// Some agent is at work: Momo wears its monocle.
    bool searching() const {
        for (const AgentLine& a : agents) {
            if (!a.finished) return true;
        }
        return false;
    }
};

}  // namespace agent
