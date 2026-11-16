// Where the agent service's trees stand in the desk's forest, kept between launches in agent-shelf.json, beside the
// headset's own shelf file (ocean-shelf.json), which joining the service leaves as it was.
#pragma once
#include <map>
#include <string>

#include "../vecmath.h"

namespace agent {

/// By service tree id: where on the desk it stands, as a cover's `OceanModel::Shelved::plot` (Desk::plot).
using Plots = std::map<std::string, Vec2>;

/// Every service's plots, by the service's address (`Address::http`), so one service's trees never forget another's.
struct ShelfPlots {
    std::map<std::string, Plots> services;

    /// What can't be read is left out: a tree whose plot is forgotten stands at the first free place. A file of version 1
    /// held places on the old hanging shelf, not on the desk, and is forgotten whole.
    static ShelfPlots parse(const std::string& text);
    std::string text() const;
};

}  // namespace agent
