// Where the agent service's trees stand in the desk's forest, kept between launches in agent-shelf.json, beside the
// headset's own shelf file (ocean-shelf.json), which joining the service leaves as it was.
#pragma once
#include <map>
#include <string>

#include "../vecmath.h"

namespace agent {

/// By service tree id: where on the desk it stands, as a cover's `OceanModel::Shelved::plot` (Desk::plot).
using Plots = std::map<std::string, Vec2>;

/// By service tree id: the service card leading the layer the user last stood on in it, where it stands again when taken off
/// the desk, as a saved tree of Kai's stands where it was left.
using Stands = std::map<std::string, std::string>;

/// Every service's plots, by the service's address (`Address::http`), so one service's trees never forget another's; and
/// likewise where the user last stood in each tree (`stands`, beside them in the same file, which an older app leaves be).
struct ShelfPlots {
    std::map<std::string, Plots> services;
    std::map<std::string, Stands> stands;

    /// What can't be read is left out: a tree whose plot is forgotten stands at the first free place. A file of version 1
    /// held places on the old hanging shelf, not on the desk, and is forgotten whole.
    static ShelfPlots parse(const std::string& text);
    std::string text() const;
};

}  // namespace agent
