#include "spots.h"

#include "../json.h"

namespace agent {

ShelfSpots ShelfSpots::parse(const std::string& text) {
    ShelfSpots out;
    std::optional<Json> json = Json::parse(text);
    if (!json || (*json)["version"].integer() != 1) return out;
    for (const auto& [service, trees] : (*json)["services"].members()) {
        for (const auto& [tree, spot] : trees.members()) {
            if (spot.size() == 2 && spot[0].isNumber() && spot[1].isNumber()) out.services[service][tree] = Vec2{spot[0].real(), spot[1].real()};
        }
    }
    return out;
}

std::string ShelfSpots::text() const {
    Json services = Json::object();
    for (const auto& [service, spots] : this->services) {
        Json trees = Json::object();
        for (const auto& [tree, spot] : spots) trees.set(tree, Json::list({Json(spot.x), Json(spot.y)}));
        services.set(service, trees);
    }
    return Json::object().set("version", 1).set("services", services).dump();
}

}  // namespace agent
