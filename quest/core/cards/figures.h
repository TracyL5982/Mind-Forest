// What the figure-led types share (fact, facts, idea, definition, place) and the charts (chart,
// breakdown): a figure set in one of its three sizes and never cut, the short rule under one, the box
// an opened fact or chart sits in, and numbers written as the web client's `Intl` writes them.
#pragma once
#include <optional>
#include <string>

#include "kind.h"

namespace cards {

/// `.fact-value` in one of the figure sizes: 34 px on 36, 24 on 28, or 16 on 21, weight 650.
Setting figureSetting(const Figure& size);
/// A figure with its top-left at (x, y) px, its letters 0.02 em closer as style.css sets them, wrapped
/// to `width` px. `lines` 0 draws it whole, with no clamp and no ellipsis, as a figure always is.
void figure(const Pen& pen, const std::string& value, float x, float y, float width, int lines, const Figure& size, Color color);
/// How tall `figure` draws it, px.
float figureHeight(const std::string& value, float width, int lines, const Figure& size, float k);

/// `.fact-rule`: what it takes, its 4 px margins included.
constexpr int RULE = 10;
/// The rule, 28 by 2 px in the accent, in the band of `RULE` px that starts at `y`.
void rule(const Pen& pen, float x, float y, Color accent);

/// An opened card's box (`.detail-fact`, `.detail-chart`): corners of 12 px, filled, and edged 1 px
/// inside when `edge` is given.
void box(const Pen& pen, float x, float y, float width, float height, Color fill, std::optional<Color> edge);

/// A number as decimal digits: `digits` with the first worth 10^`exponent`. No digits is zero.
struct Decimal {
    std::string digits;
    int exponent = 0;
    bool negative = false;
};
/// `value` rounded half away from zero to `places` decimals, as `Intl` rounds it: from the shortest
/// digits that read back as the same double, so 0.0012345 is 0.001235 to six places.
Decimal fixed(double value, int places);
/// The same as `toFixed` rounds it: from the double's exact value, so 1.005 is 1.00 to two places.
Decimal toFixed(double value, int places);
/// `value` rounded half away from zero to `figures` significant digits, as `Intl` rounds it.
Decimal significant(double value, int figures);
/// Written out with no exponent and no trailing zero after the point, with a comma between thousands
/// when the whole part has at least `grouped` digits.
std::string written(const Decimal& d, int grouped);
/// `value.toLocaleString('en', {maximumFractionDigits: 6})`.
std::string exact(double value);

}  // namespace cards
