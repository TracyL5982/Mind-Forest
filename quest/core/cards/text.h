// What table, qa, callout, excerpt and proscons share: the fixed words of words.js that `Words` does
// not hold.
#pragma once
#include <string>

#include "item.h"

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
}  // namespace fixed

/// words.js `moreOf`: what a table writes under the rows and columns it leaves out.
std::string moreOf(const Words& words, int rows, int columns);

}  // namespace cards
