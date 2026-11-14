#include "rows.h"

#include <algorithm>

namespace cards {

namespace {

/// How far a setting's baseline sits below the middle of its line, px.
float rise(const Setting& t, float k) {
    FontMetrics m = attributes(t, Color::white(), k).font.metrics();
    return (m.ascent - m.descent) / 2 / k;
}

}  // namespace

void foot(const Pen& pen, const Words& words, int count, float body, float column, Color color) {
    pen.words(words.more(count), 16, body - 14 - TEXT, column, 1, setting::text, color);
}

}  // namespace cards
