#include "crew.h"

#include <algorithm>

namespace agent {

std::string agentName(const std::string& role, const std::string& momo) {
    if (role == "momo") return momo + " (librarian)";
    std::string name = role;
    if (!name.empty() && name[0] >= 'a' && name[0] <= 'z') name[0] = char(name[0] - 'a' + 'A');
    return name;
}

std::string stepOf(const Activity& a) {
    if (a.label && !a.label->empty()) return *a.label;
    std::string out;
    int words = 0;
    size_t at = 0;
    while (at < a.message.size()) {
        size_t begin = a.message.find_first_not_of(' ', at);
        if (begin == std::string::npos) break;
        size_t end = std::min(a.message.find(' ', begin), a.message.size());
        if (words == 6) return out + "…";
        out += (words++ ? " " : "") + a.message.substr(begin, end - begin);
        at = end;
    }
    return out;
}

void Crew::activity(const Activity& a, double now) {
    auto agent = std::find_if(agents.begin(), agents.end(), [&](const Agent& g) { return g.role == a.role; });
    if (a.state == Activity::State::start) {
        if (agent == agents.end()) {
            agents.push_back(Agent{a.role, {}, std::nullopt});
            agent = agents.end() - 1;
        }
        std::erase_if(agent->open, [&](const Step& s) { return s.id == a.id; });
        agent->open.push_back(Step{a.id, stepOf(a)});
        agent->finishedAt.reset();
        return;
    }
    if (agent == agents.end()) return;
    size_t before = agent->open.size();
    std::erase_if(agent->open, [&](const Step& s) { return s.id == a.id; });
    if (before > 0 && agent->open.empty()) agent->finishedAt = now;
}

void Crew::update(double now) {
    std::erase_if(agents, [&](const Agent& g) { return g.open.empty() && (!g.finishedAt || now >= *g.finishedAt + finishedFor); });
}

std::vector<AgentLine> Crew::lines(const std::string& momo) const {
    std::vector<AgentLine> out;
    for (const Agent& g : agents) {
        if (g.open.empty() && !g.finishedAt) continue;
        // Its newest step still going (the user's choice, 2026-11-17, over the oldest, steadier one).
        out.push_back(AgentLine{g.role, agentName(g.role, momo), g.open.empty() ? "" : g.open.back().label, g.open.empty()});
    }
    return out;
}

bool Crew::working() const {
    return std::any_of(agents.begin(), agents.end(), [](const Agent& g) { return !g.open.empty(); });
}

}  // namespace agent
