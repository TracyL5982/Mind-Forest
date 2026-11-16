#include "plots.h"

#include "../json.h"

namespace agent {

ShelfPlots ShelfPlots::parse(const std::string& text) {
    ShelfPlots out;
    std::optional<Json> json = Json::parse(text);
    if (!json || (*json)["version"].integer() != 2) return out;
    for (const auto& [service, trees] : (*json)["services"].members()) {
        for (const auto& [tree, plot] : trees.members()) {
            if (plot.size() == 2 && plot[0].isNumber() && plot[1].isNumber()) out.services[service][tree] = Vec2{plot[0].real(), plot[1].real()};
        }
    }
    return out;
}

std::string ShelfPlots::text() const {
    Json services = Json::object();
    for (const auto& [service, plots] : this->services) {
        Json trees = Json::object();
        for (const auto& [tree, plot] : plots) trees.set(tree, Json::list({Json(plot.x), Json(plot.y)}));
        services.set(service, trees);
    }
    return Json::object().set("version", 2).set("services", services).dump();
}

}  // namespace agent
