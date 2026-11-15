// A question about a card, once asked, is not asked again while the service still works on it: a hand that picks the
// same row three times in a moment starts one search, not three.
#pragma once
#include <map>
#include <string>
#include <utility>

namespace agent {

class Asking {
public:
    /// How long a question stays in flight when the service never says its work on the card ended.
    static constexpr double within = 60;

    /// True when `question` about the service node `nodeId` may go to the service now; from then it is in flight.
    bool begin(const std::string& nodeId, const std::string& question, double now) {
        auto key = std::make_pair(nodeId, question);
        auto was = since.find(key);
        if (was != since.end() && now - was->second < within) return false;
        since[key] = now;
        return true;
    }

    /// The service's search round the node ended, done or failed: what was asked about it may be asked again.
    void ended(const std::string& nodeId) {
        for (auto s = since.begin(); s != since.end();) s = s->first.first == nodeId ? since.erase(s) : std::next(s);
    }

private:
    std::map<std::pair<std::string, std::string>, double> since;
};

}  // namespace agent
