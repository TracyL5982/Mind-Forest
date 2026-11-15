#include "connection.h"

#include <random>

#include "../base.h"
#include "../json.h"
#include "../platform.h"

namespace agent {

Launch launch(const std::vector<std::string>& given, const std::optional<std::string>& saved, const std::optional<BuiltIn>& builtIn) {
    std::map<std::string, std::string> flags = Flags::parse(given);
    Launch out;
    out.arguments = given;
    if (builtIn) {
        if (auto agent = flags.find("agent"); agent != flags.end() && !agent->second.empty()) {
            out.said = "[agent] joining " + agent->second + " this launch, in place of the build's own " + builtIn->agent;
            return out;
        }
        out.arguments.insert(out.arguments.end(), {"-agent", builtIn->agent, "-agentToken", builtIn->appKey + "." + builtIn->device});
        if (!flags.count("cards")) out.arguments.push_back("-cards");
        out.said = "[agent] joining the build's own service, " + builtIn->agent;
        return out;
    }
    if (flags.count("agentForget")) {
        out.file = Launch::File::forget;
        out.said = "[agent] the connection to the service is forgotten";
        return out;
    }
    if (auto agent = flags.find("agent"); agent != flags.end() && !agent->second.empty()) {
        out.file = Launch::File::save;
        out.text = Json::object().set("agent", agent->second).set("token", flags["agentToken"]).set("cards", flags.count("cards") > 0).dump();
        out.said = "[agent] remembered the connection to " + agent->second;
        return out;
    }
    std::optional<Json> json = saved ? Json::parse(*saved) : std::nullopt;
    std::string agent = json ? (*json)["agent"].string("") : "";
    if (agent.empty()) return out;
    out.arguments.insert(out.arguments.end(), {"-agent", agent});
    if (std::string token = (*json)["token"].string(""); !token.empty()) out.arguments.insert(out.arguments.end(), {"-agentToken", token});
    if ((*json)["cards"].boolean() && !flags.count("cards")) out.arguments.push_back("-cards");
    out.said = "[agent] no -agent given, so joining the remembered " + agent;
    return out;
}

std::string deviceId(const std::string& file) {
    std::string kept = platform::readFile(file).value_or("");
    kept.erase(kept.find_last_not_of(" \t\r\n") + 1);
    if (kept.size() == 32 && kept.find_first_not_of("0123456789abcdef") == std::string::npos) return kept;
    std::random_device random;
    std::string made;
    for (int i = 0; i < 4; i++) made += fmt("%08x", unsigned(random()));
    platform::writeFile(file, made);
    return made;
}

}  // namespace agent
