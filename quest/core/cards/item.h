// What a card is drawn from, read once from the service's JSON (agents/src/core/domain.ts field
// names): the item, the words a card adds in the item's own language (words.js), and the chips
// (chips.js and the chip line of components/index.js).
#pragma once
#include <string>
#include <vector>

#include "../json.h"
#include "measure.h"

namespace cards {

/// The fixed words a card draws that are not the item's own, in English or in Chinese (words.js).
struct Words {
    bool chinese = false;
    std::string untitled() const { return chinese ? "未命名" : "Untitled"; }
    std::string more(int count) const;
    std::string noPicture() const { return chinese ? "图片无法显示" : "Picture unavailable"; }
};

/// An item, as a card reads it. A field that is not a string reads as an empty one; `title`, `text`
/// and `summary` are never trimmed.
struct Item {
    /// `item.kind`: text, image, video, link, chat, file, code or audio.
    std::string kind;
    std::string title, text, summary;
    Json data = Json::object();
    /// `origin.by == "agent"`: the agents brought it.
    bool agent = false;
    std::string sourceFrom, url, capturedAt;
    std::vector<std::string> tags;
    Words words;

    static Item from(const Json& item);
    /// `item.title`, or the word for one that is missing.
    std::string titleOrUntitled() const { return title.empty() ? words.untitled() : title; }
};

/// A prop that is a string, or "".
std::string text(const Json& value);
/// A string prop with the white space at both ends taken off, as the structured types read one; "" for what is no string.
std::string trimmed(const Json& value);
/// `\p{Script=Han}`.
bool han(char32_t c);
/// JavaScript's `Number(value)`: NaN for what is no number.
double number(const Json& value);

/// One chip under a card: when, where it came from, where, or who.
struct Chip {
    enum class Kind { when, origin, where, people };
    Kind kind;
    std::string text;
    /// How many people a people chip leaves unnamed.
    int count = 0;
    /// Its box on the line, px.
    int width = 0;
    /// The `item.data` key it was read from.
    std::string key;
    /// What the opened card lists: every person a people chip names.
    std::string full;
};
const char* name(Chip::Kind kind);

/// Every source the item holds, in chip order, without one that repeats an earlier one (`chipSources`).
std::vector<Chip> sources(const Item& item);
/// The chips a card may draw, at most three, without those whose key is in `shown` or that say what one of those says.
std::vector<Chip> chips(const Item& item, const std::vector<std::string>& shown);
/// Fits them to a line `room` px wide: which are drawn, and each one's box.
std::vector<Chip> fit(const std::vector<Chip>& all, int room);

}  // namespace cards
