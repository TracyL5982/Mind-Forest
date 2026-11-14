// What table, qa, callout, excerpt and proscons share: the fixed words of words.js that `Words` does
// not hold, the small label that names a tone or a side (`.kind`), and glyphs drawn as strokes.
#pragma once
#include <string>
#include <vector>

#include "item.h"
#include "paint.h"

namespace cards {

/// A fixed word of words.js, in English and in Chinese.
struct Fixed {
    const char* english;
    const char* chinese;
    std::string in(const Words& words) const { return words.chinese ? chinese : english; }
};

namespace fixed {
constexpr Fixed question{"Q", "问"};
constexpr Fixed answer{"A", "答"};
constexpr Fixed caution{"Caution", "注意"};
constexpr Fixed note{"Note", "备注"};
constexpr Fixed pros{"For", "优点"};
constexpr Fixed cons{"Against", "缺点"};
}  // namespace fixed

/// words.js `moreOf`: what a table writes under the rows and columns it leaves out.
std::string moreOf(const Words& words, int rows, int columns);

/// A glyph's lines in its own box, that box's top-left at (x, y) px, each line a run of points stroked
/// `width` px wide with round ends.
void strokes(const Pen& pen, float x, float y, const std::vector<std::vector<CGPoint>>& lines, float width, Color color);
/// A circle as a run of points, for `strokes`.
std::vector<CGPoint> ring(float cx, float cy, float r);

}  // namespace cards
