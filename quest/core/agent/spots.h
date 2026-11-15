// Where the covers of the agent service's trees hang on the headset's shelf, kept between launches in agent-shelf.json,
// beside the headset's own shelf file (ocean-shelf.json), which joining the service leaves as it was.
#pragma once
#include <map>
#include <string>

#include "../vecmath.h"

namespace agent {

/// By service tree id: degrees right of ahead, and up, as a cover's `OceanModel::Shelved::spot`.
using Spots = std::map<std::string, Vec2>;

/// Every service's spots, by the service's address (`Address::http`), so one service's trees never forget another's.
struct ShelfSpots {
    std::map<std::string, Spots> services;

    /// What can't be read is left out: a cover whose spot is forgotten hangs at the first free place.
    static ShelfSpots parse(const std::string& text);
    std::string text() const;
};

}  // namespace agent
