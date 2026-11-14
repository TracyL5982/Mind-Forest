#include "text.h"

#include <vector>

namespace cards {

std::string moreOf(const Words& words, int rows, int columns) {
    auto part = [&](int n, const char* english, const char* chinese) {
        return std::to_string(n) + (words.chinese ? chinese : english) + (words.chinese || n == 1 ? "" : "s");
    };
    std::vector<std::string> parts;
    if (rows > 0) parts.push_back(part(rows, " more row", " 行"));
    if (columns > 0) parts.push_back(part(columns, " more column", " 列"));
    std::string out = words.chinese ? "还有 " : "and ";
    for (size_t i = 0; i < parts.size(); i++) out += (i ? (words.chinese ? "、" : ", ") : "") + parts[i];
    return out;
}

}  // namespace cards
