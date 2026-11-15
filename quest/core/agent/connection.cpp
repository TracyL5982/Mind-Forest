#include "connection.h"

#include "../base.h"
#include "../json.h"

namespace agent {

Launch launch(const std::vector<std::string>& given, const std::optional<std::string>& saved) {
    std::map<std::string, std::string> flags = Flags::parse(given);
    Launch out;
    out.arguments = given;
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

}  // namespace agent
