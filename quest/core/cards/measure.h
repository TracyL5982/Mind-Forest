// The web client's footprint arithmetic (agents/docs/libraries.md, "How a card's footprint is worked
// out"; agents/client/js/components/shared.js), in whole numbers, so a card here has the footprint it
// has on the web. Nothing here measures a font: text is counted from the tables, and drawn later in the
// host's fonts inside what was counted.
#pragma once
#include <cstdint>
#include <string>
#include <vector>

namespace cards {

/// A string as code points, the unit every count here walks.
using Text = std::u32string;
Text points(const std::string& utf8);
std::string utf8(const Text& text);

/// The line heights and paddings in style.css, px.
constexpr int DISPLAY = 36;
constexpr int TITLE = 21;
constexpr int TEXT = 17;
constexpr int FRAME = 30;
constexpr int SIDES = 33;
constexpr int PADDING = 32;
constexpr int CHIP_LINE = 28;

/// One letter of each face, tenths of a px. A letter names its face.
constexpr int TITLE_LETTER = 93;
constexpr int TEXT_LETTER = 72;
constexpr int QUOTE_LETTER = 78;
constexpr int PASSAGE_LETTER = 92;

/// A figure's three sizes: line height px, letter tenths of a px, digit hundredths of a px.
struct Figure {
    int lineHeight, letter, digit;
};
constexpr Figure LARGEST{36, 210, 2148};
constexpr Figure MIDDLE{28, 149, 1506};
constexpr Figure SMALLEST{21, 105, 1001};

/// A string's width in tenths of an average lowercase letter, in the face `letter` names.
int64_t span(const Text& str, int letter = TEXT_LETTER);
/// a / b rounded up.
int64_t up(int64_t a, int64_t b);
int64_t clamp(int64_t v, int64_t lo, int64_t hi);

/// How many lines `str` is given in a column `width` px wide, at most `max`.
int fold(const Text& str, int width, int letter, int max);
/// The same, counted word by word, as the structured types count.
int wrap(const Text& str, int width, int letter, int max);
/// A string's width on one line in hundredths of a px, as `wrap` counts it.
int64_t advance(const Text& str, int letter);
/// A figure's width on one line in hundredths of a px.
int64_t figureNeed(const Text& value, Figure size);
/// The px a string is given at the text size.
int textWidth(const Text& str);
/// Shares `room` px among columns that need `needs`.
std::vector<int> spread(const std::vector<int>& needs, int room);

/// JavaScript's white space (`\s`, and what `trim` takes off).
bool isSpace(char32_t c);
Text trim(const Text& str);
/// Each run of white space turned into one space, and the ends trimmed.
Text squash(const Text& str);

}  // namespace cards
