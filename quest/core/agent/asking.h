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

    /// The service started its search for `question` about the service node `nodeId`, as the activity `activityId`.
    void searching(const std::string& activityId, const std::string& nodeId, const std::string& question) {
        runs[activityId] = std::make_pair(nodeId, question);
    }

    /// The activity `activityId` ended, done or failed. When it was a search for a question, that question may be asked again.
    void ended(const std::string& activityId) {
        auto run = runs.find(activityId);
        if (run == runs.end()) return;
        since.erase(run->second);
        runs.erase(run);
    }

private:
    std::map<std::pair<std::string, std::string>, double> since;
    std::map<std::string, std::pair<std::string, std::string>> runs;
};

}  // namespace agent
