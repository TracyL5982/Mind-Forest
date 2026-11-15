// What the reference, steps, list, chat and code cards share: a structured type's trimmed props, the
// short label that names what a card is, and the words under the rows a card leaves out.
#pragma once
#include "kind.h"

namespace cards {

/// `.card-foot`: the fixed words for `count` rows a card leaves out, at the foot of its body.
void foot(const Pen& pen, const Words& words, int count, float body, float column, Color color);

}  // namespace cards
