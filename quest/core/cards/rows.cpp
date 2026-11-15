#include "rows.h"

#include <algorithm>

namespace cards {

void foot(const Pen& pen, const Words& words, int count, float body, float column, Color color) {
    pen.words(words.more(count), 16, body - 14 - TEXT, column, 1, setting::text, color);
}

}  // namespace cards
