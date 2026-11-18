// What an opened card still prints of its item's text once the title, the type's own opened form and
// the sources have said most of it: agents/client/js/said.js in C++. It walks code points where the
// web walks UTF-16 units, and tells letters from marks with a short table in place of Unicode's.
#pragma once
#include <string>
#include <vector>

#include "item.h"

namespace cards {

struct Leftover {
    std::string summary, text;
};
Leftover leftover(const Item& item, const std::vector<std::string>& said);

}  // namespace cards
