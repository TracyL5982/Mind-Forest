// The agents at work, for the lines above Momo's words: for each agent, the steps it has begun and not ended, from the
// service's activities. An agent whose last step ends reads "finished working" for `finishedFor`, then has no line; an
// agent with nothing going on has none. Apart from drawing, so the tests drive it.
#pragma once
#include <optional>
#include <string>
#include <vector>

#include "presence.h"
#include "protocol.h"

namespace agent {

class Crew {
public:
    static constexpr double finishedFor = 3;    // s an agent's line says it finished, before it goes

    /// A step began or ended, at `now`. Steps are told apart by their id, and belong to the agent of their role.
    void activity(const Activity& a, double now);
    /// Lets go of agents that finished more than `finishedFor` before `now`.
    void update(double now);
    /// One line per agent at work or just finished, in the order they began. `momo` is what Momo is called.
    std::vector<AgentLine> lines(const std::string& momo) const;
    /// Some step has begun and not ended.
    bool working() const;

private:
    struct Step {
        std::string id;
        std::string label;
    };
    struct Agent {
        std::string role;
        std::vector<Step> open;             // oldest first
        std::optional<double> finishedAt;
    };
    std::vector<Agent> agents;
};

/// How an agent is named on its line: "Momo (librarian)", and every other by its role, "Scout", "Renderer", ….
std::string agentName(const std::string& role, const std::string& momo);

/// A step in a few words: its label, or the first six words of its message.
std::string stepOf(const Activity& a);

}  // namespace agent
