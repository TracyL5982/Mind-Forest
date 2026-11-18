#include "look.h"

#include <algorithm>
#include <cmath>

namespace agent {

namespace {

/// The pen's red (Art::hot, #FF5A36), as every line the user draws is.
constexpr uint8_t red[3] = {0xFF, 0x5A, 0x36};

/// `source`'s pixels in [x0, x1) × [y0, y1) (pixels, fractional), into `w` × `h`: each target pixel the mean of the source
/// pixels it covers, so a picture made smaller keeps its detail as a thumbnail does; one made no smaller is sampled.
Pixels resampled(int width, int height, const uint8_t* rgba, float x0, float y0, float x1, float y1, int w, int h) {
    Pixels out{w, h, std::vector<uint8_t>(size_t(w) * size_t(h) * 4, 255)};
    float sx = (x1 - x0) / float(w), sy = (y1 - y0) / float(h);
    for (int ty = 0; ty < h; ty++) {
        int ya = std::clamp(int(std::floor(y0 + sy * float(ty))), 0, height - 1);
        int yb = std::clamp(int(std::ceil(y0 + sy * float(ty + 1))), ya + 1, height);
        for (int tx = 0; tx < w; tx++) {
            int xa = std::clamp(int(std::floor(x0 + sx * float(tx))), 0, width - 1);
            int xb = std::clamp(int(std::ceil(x0 + sx * float(tx + 1))), xa + 1, width);
            unsigned sum[3] = {0, 0, 0}, n = 0;
            for (int y = ya; y < yb; y++) {
                const uint8_t* row = rgba + (size_t(y) * size_t(width) + size_t(xa)) * 4;
                for (int x = xa; x < xb; x++, row += 4, n++) {
                    sum[0] += row[0];
                    sum[1] += row[1];
                    sum[2] += row[2];
                }
            }
            uint8_t* p = &out.rgba[(size_t(ty) * size_t(w) + size_t(tx)) * 4];
            for (int c = 0; c < 3; c++) p[c] = uint8_t(sum[c] / std::max(1u, n));
        }
    }
    return out;
}

/// Draws the lines on `image`, which shows the part [x0, x0 + w) × [y0, y0 + h) of the picture (0…1), `thick` px wide.
void draw(Pixels& image, const std::vector<std::vector<Vec2>>& lines, float x0, float y0, float w, float h, float thick) {
    float r = thick / 2;
    auto dot = [&](float cx, float cy) {
        int xa = std::max(0, int(std::floor(cx - r))), xb = std::min(image.width - 1, int(std::ceil(cx + r)));
        int ya = std::max(0, int(std::floor(cy - r))), yb = std::min(image.height - 1, int(std::ceil(cy + r)));
        for (int y = ya; y <= yb; y++) {
            for (int x = xa; x <= xb; x++) {
                float d = std::hypot(float(x) + 0.5f - cx, float(y) + 0.5f - cy);
                float a = std::clamp(r + 0.5f - d, 0.f, 1.f);
                if (a <= 0) continue;
                uint8_t* p = &image.rgba[(size_t(y) * size_t(image.width) + size_t(x)) * 4];
                for (int c = 0; c < 3; c++) p[c] = uint8_t(std::lround(float(p[c]) * (1 - a) + float(red[c]) * a));
            }
        }
    };
    auto at = [&](Vec2 p) { return Vec2{(p.x - x0) / w * float(image.width), (p.y - y0) / h * float(image.height)}; };
    for (const std::vector<Vec2>& line : lines) {
        for (size_t i = 0; i + 1 < line.size(); i++) {
            Vec2 a = at(line[i]), b = at(line[i + 1]);
            float run = std::hypot(b.x - a.x, b.y - a.y);
            int steps = std::max(1, int(std::ceil(run / std::max(0.5f, r * 0.5f))));
            for (int s = 0; s <= steps; s++) {
                float t = float(s) / float(steps);
                dot(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
            }
        }
    }
}

/// The size a picture of `w` × `h` is shown at, at most `most` on its longer side and never larger than it is.
std::pair<int, int> fitted(float w, float h, int most) {
    float k = std::min(1.f, float(most) / std::max(1.f, std::max(w, h)));
    return {std::max(1, int(std::lround(w * k))), std::max(1, int(std::lround(h * k)))};
}

}  // namespace

std::vector<std::vector<Vec2>> onPicture(std::vector<std::vector<Vec2>> lines, float box, float picture) {
    if (box <= 0 || picture <= 0) return lines;
    // The share of the box's width (or height) the picture takes, and where it begins.
    bool narrower = picture < box;
    float share = narrower ? picture / box : box / picture, from = (1 - share) / 2;
    for (std::vector<Vec2>& line : lines) {
        for (Vec2& p : line) {
            if (narrower) p.x = (p.x - from) / share;
            else p.y = (p.y - from) / share;
        }
    }
    return lines;
}

std::optional<Sight> sight(int width, int height, const uint8_t* rgba, const std::vector<std::vector<Vec2>>& lines) {
    if (width <= 0 || height <= 0 || !rgba) return std::nullopt;
    float lo[2] = {1, 1}, hi[2] = {0, 0};
    bool any = false;
    for (const std::vector<Vec2>& line : lines) {
        if (line.size() < 2) continue;
        for (Vec2 p : line) {
            lo[0] = std::min(lo[0], std::clamp(p.x, 0.f, 1.f));
            lo[1] = std::min(lo[1], std::clamp(p.y, 0.f, 1.f));
            hi[0] = std::max(hi[0], std::clamp(p.x, 0.f, 1.f));
            hi[1] = std::max(hi[1], std::clamp(p.y, 0.f, 1.f));
            any = true;
        }
    }
    if (!any) return std::nullopt;
    // The part: what the lines enclose, a margin round it, and no smaller than the least part, all as shares of the
    // picture's longer side, so a part is square-ish whatever the picture's shape; kept inside the picture.
    float longer = float(std::max(width, height));
    float box[4];
    for (int axis = 0; axis < 2; axis++) {
        float side = axis == 0 ? float(width) : float(height);
        float margin = sightMargin * longer / side, least = sightLeast * longer / side;
        float a = lo[axis] - margin, b = hi[axis] + margin;
        if (b - a < least) {
            float mid = (a + b) / 2;
            a = mid - least / 2;
            b = mid + least / 2;
        }
        if (b - a > 1) a = 0, b = 1;
        if (a < 0) b -= a, a = 0;
        if (b > 1) a -= b - 1, b = 1;
        box[axis * 2] = std::max(0.f, a);
        box[axis * 2 + 1] = std::min(1.f, b) - std::max(0.f, a);
    }
    Sight out;
    out.box = {box[0], box[2], box[1], box[3]};
    float cx0 = box[0] * float(width), cy0 = box[2] * float(height), cw = box[1] * float(width), ch = box[3] * float(height);
    auto [w, h] = fitted(cw, ch, cropMost);
    out.crop = resampled(width, height, rgba, cx0, cy0, cx0 + cw, cy0 + ch, w, h);
    draw(out.crop, lines, box[0], box[2], box[1], box[3], std::max(2.f, float(std::max(w, h)) * 0.008f));
    auto [ww, wh] = fitted(float(width), float(height), wholeMost);
    out.whole = resampled(width, height, rgba, 0, 0, float(width), float(height), ww, wh);
    draw(out.whole, lines, 0, 0, 1, 1, std::max(2.f, float(std::max(ww, wh)) * 0.008f));
    return out;
}

}  // namespace agent
