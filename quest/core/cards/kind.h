// One card type, as agents/client/js/components/<type>.js is one: its footprint, the chip sources it
// already shows, its small face and its part of the opened card. `kinds()` is the registry
// (components/index.js); each type is one file in this folder.
#pragma once
#include <functional>
#include <optional>
#include <string>
#include <vector>

#include "../json.h"
#include "item.h"
#include "paint.h"

namespace cards {

/// A card's size on the web, px.
struct Footprint {
    int width = 0, height = 0;
    bool operator==(const Footprint&) const = default;
};

/// A run of text on the opened card that a hand can mark, in pixels.
struct Run {
    std::string text;
    CGPoint at;
    float width;
    int lines;
    TextAttributes attributes;
};

/// The opened card being laid out top to bottom, in px: the web client's panel, one part under another.
struct Sheet {
    static constexpr float left = 19, width = 346, gap = 13;
    float k;
    Look look;
    Words words;
    float y = 0;
    bool first = true;
    /// Every string the card has written so far, for what the item's text still has to say.
    std::vector<std::string> said;
    std::vector<Run> runs;
    std::vector<std::function<void(Canvas&)>> draws;
    std::optional<CGRect> picture;

    /// A part `height` px tall, drawn at its top.
    void part(float height, std::function<void(const Pen&, float top)> draw);
    /// A paragraph across the sheet; `lines` 0 for all of it. It can be marked.
    void paragraph(const std::string& s, const Setting& t, Color color, int lines = 0);
};

struct Kind {
    const char* name;
    Footprint (*size)(const Item& item, const Json& props);
    /// The `item.data` keys it already draws, which no chip repeats.
    std::vector<std::string> shows;
    /// The small face inside its frame. `body` is the card's height above the line of chips, px.
    void (*draw)(const Pen& pen, const Look& look, const Item& item, const Json& props, float width, float body);
    /// Its part of the opened card, under the title.
    void (*detail)(Sheet& sheet, const Item& item, const Json& props);
    /// The pictures it shows, by address.
    std::vector<std::string> (*pictures)(const Json& props) = nullptr;
    float radius = 12;
    enum class Face { plain, sunk, wash } face = Face::plain;
    /// The chip line's margin each side, and its distance from the bottom, px.
    int chipInset = 15, chipBottom = 12;
};

/// The registry. An unknown component is drawn as a note with no props.
const Kind* kindNamed(const std::string& component);
const Kind& note();

namespace kinds {
extern const Kind note, image, quote;
}

}  // namespace cards
