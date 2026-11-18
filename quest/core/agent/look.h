// What Momo is shown of a part of a picture the user marked (WS89): the part itself, a little round it, and the whole picture,
// each with the user's line drawn on it in red, as the pen drew it. The service gives both to the realtime model with the
// user's next words about the card, so her answer is about what is inside the line (agents/src/node/live.ts, `look`).
// Pure: the headset decodes the picture and encodes the two as JPEG (platform::encodeJpeg), off the frame thread.
#pragma once
#include <array>
#include <cstdint>
#include <optional>
#include <vector>

#include "vecmath.h"

namespace agent {

/// A picture in memory: RGBA, 8 bits each, rows top to bottom.
struct Pixels {
    int width = 0, height = 0;
    std::vector<uint8_t> rgba;
};

struct Sight {
    /// The part marked, with a margin round it, at most `cropMost` px on its longer side, the line drawn on it.
    Pixels crop;
    /// The whole picture, at most `wholeMost` px on its longer side, the line drawn on it.
    Pixels whole;
    /// Where the part is: x, y, width and height, 0…1 of the picture, y down.
    std::array<float, 4> box{};
};

constexpr int cropMost = 512, wholeMost = 384;
/// The margin round what the lines enclose, as a share of the picture's longer side, and the least a part is, likewise.
constexpr float sightMargin = 0.06f, sightLeast = 0.12f;

/// What the lines (each a run of points 0…1 of the picture, x right, y down) mark on a picture of `width` × `height` RGBA
/// pixels. None for a picture with no pixels, or no line of two points.
std::optional<Sight> sight(int width, int height, const uint8_t* rgba, const std::vector<std::vector<Vec2>>& lines);

/// Lines drawn on a card over the box its picture is shown in (0…1 of the box, whose width over height is `box`), as
/// lines on the picture (0…1 of it), which is shown whole in the box, centred: a narrower picture leaves the box's sides
/// empty, a wider one its top and foot.
std::vector<std::vector<Vec2>> onPicture(std::vector<std::vector<Vec2>> lines, float box, float picture);

}  // namespace agent
