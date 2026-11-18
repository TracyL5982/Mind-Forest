#include "support.h"

#include "agent/look.h"

using namespace agent;

namespace {

/// A picture of `w` × `h`: its left half blue, its right half green, so where a crop came from shows in its pixels.
std::vector<uint8_t> halves(int w, int h) {
    std::vector<uint8_t> out(size_t(w) * size_t(h) * 4, 255);
    for (int y = 0; y < h; y++) {
        for (int x = 0; x < w; x++) {
            uint8_t* p = &out[(size_t(y) * size_t(w) + size_t(x)) * 4];
            p[0] = 0;
            p[1] = x < w / 2 ? 0 : 200;
            p[2] = x < w / 2 ? 200 : 0;
        }
    }
    return out;
}

const uint8_t* at(const Pixels& p, int x, int y) { return &p.rgba[(size_t(y) * size_t(p.width) + size_t(x)) * 4]; }

/// A ring round (cx, cy) of radius r, 0…1 of the picture.
std::vector<Vec2> ring(float cx, float cy, float r) {
    std::vector<Vec2> out;
    for (int k = 0; k <= 24; k++) out.push_back({cx + r * std::cos(float(k) * 0.2618f), cy + r * std::sin(float(k) * 0.2618f)});
    return out;
}

}  // namespace

TEST(whatALineRingsOnAPictureIsCutOutWithAMarginTheLineDrawnInRed) {
    std::vector<uint8_t> picture = halves(1000, 800);
    // A ring on the right (green) half.
    std::optional<Sight> s = sight(1000, 800, picture.data(), {ring(0.75f, 0.5f, 0.1f)});
    CHECK(s.has_value(), "a ring makes a sight");
    if (!s) return;
    // What the ring encloses (0.65…0.85 across, 0.4…0.6 down), with 6 % of the longer side (60 px) round it.
    CHECK(std::fabs(s->box[0] - 0.59f) < 0.002f && std::fabs(s->box[2] - 0.32f) < 0.002f, "across: %.3f + %.3f", double(s->box[0]), double(s->box[2]));
    CHECK(std::fabs(s->box[1] - 0.325f) < 0.002f && std::fabs(s->box[3] - 0.35f) < 0.002f, "down: %.3f + %.3f", double(s->box[1]), double(s->box[3]));
    // Cut from the picture at its own pixels (320 × 280), smaller than the most, and green: the right half.
    CHECK_EQ(s->crop.width, 320);
    CHECK_EQ(s->crop.height, 280);
    CHECK(at(s->crop, 160, 140)[1] == 200 && at(s->crop, 160, 140)[2] == 0, "the middle of the crop is the picture's green");
    // The ring's leftmost point is 60 px in from the crop's left edge, half way down.
    const uint8_t* line = at(s->crop, 60, 140);
    CHECK(line[0] > 200 && line[1] < 140 && line[2] < 100, "the line is drawn in the pen's red");
    // The whole picture, at most 384 across, with the line on it too.
    CHECK_EQ(s->whole.width, 384);
    CHECK_EQ(s->whole.height, 307);
    CHECK(at(s->whole, 10, 150)[2] == 200, "the whole picture's left is the picture's blue");
    CHECK(at(s->whole, 250, 153)[0] > 200, "and the ring is on it, in red");
}

TEST(aSmallMarkStillShowsEnoughRoundItAndALargeOneIsMadeSmaller) {
    std::vector<uint8_t> picture = halves(2000, 1000);
    // A dot of a line, at the picture's corner: the margin round it (120 px) makes it about the least there is (240 px),
    // and it is kept inside the picture.
    std::optional<Sight> dot = sight(2000, 1000, picture.data(), {{{0.01f, 0.02f}, {0.012f, 0.021f}}});
    CHECK(dot.has_value(), "a short line makes a sight");
    if (dot) {
        CHECK(dot->box[0] == 0 && dot->box[1] == 0, "it is kept inside the picture");
        CHECK(std::fabs(dot->box[2] * 2000 - 244) < 1 && std::fabs(dot->box[3] * 1000 - 241) < 1,
              "%.1f px across, %.1f down", double(dot->box[2] * 2000), double(dot->box[3] * 1000));
    }
    // A line as short as can be, in the middle: about the least part all round it.
    std::optional<Sight> tiny = sight(1000, 1000, picture.data(), {{{0.5f, 0.5f}, {0.5001f, 0.5f}}});
    if (tiny) CHECK(std::fabs(tiny->box[2] - 0.12f) < 0.001f && std::fabs(tiny->box[3] - 0.12f) < 0.001f, "the least part is 12 %% of the longer side");
    // A line round nearly all of it: cut to at most 512 on its longer side.
    std::optional<Sight> all = sight(2000, 1000, picture.data(), {{{0.02f, 0.05f}, {0.98f, 0.05f}, {0.98f, 0.95f}, {0.02f, 0.95f}}});
    CHECK(all.has_value(), "a large mark makes a sight");
    if (all) CHECK(all->crop.width == 512 && all->crop.height == 256, "%d × %d", all->crop.width, all->crop.height);
}

TEST(aLineOnTheBoxAPictureIsShownInIsALineOnThePicture) {
    // A picture half as wide as its box, shown whole in the middle of it: the box's left quarter is empty.
    std::vector<std::vector<Vec2>> tall = onPicture({{{0.25f, 0.1f}, {0.75f, 0.9f}, {0.5f, 0.5f}}}, 2.f, 1.f);
    CHECK(std::fabs(tall[0][0].x) < 1e-6f && std::fabs(tall[0][1].x - 1) < 1e-6f && std::fabs(tall[0][2].x - 0.5f) < 1e-6f, "across, the picture's own edges");
    CHECK(tall[0][0].y == 0.1f && tall[0][1].y == 0.9f, "down, as on the box");
    // One twice as wide as its box: the top and foot are empty.
    std::vector<std::vector<Vec2>> wide = onPicture({{{0.3f, 0.25f}, {0.3f, 0.75f}}}, 0.5f, 1.f);
    CHECK(std::fabs(wide[0][0].y) < 1e-6f && std::fabs(wide[0][1].y - 1) < 1e-6f && wide[0][0].x == 0.3f, "down, the picture's own edges");
    // One the box's own shape: as it is.
    CHECK(onPicture({{{0.3f, 0.4f}}}, 1.25f, 1.25f)[0][0].x == 0.3f, "the same");
}

TEST(nothingIsSeenWithoutALineOrAPicture) {
    std::vector<uint8_t> picture = halves(10, 10);
    CHECK(!sight(10, 10, picture.data(), {}).has_value(), "no line");
    CHECK(!sight(10, 10, picture.data(), {{{0.5f, 0.5f}}}).has_value(), "a line of one point");
    CHECK(!sight(0, 0, nullptr, {ring(0.5f, 0.5f, 0.2f)}).has_value(), "no picture");
}
