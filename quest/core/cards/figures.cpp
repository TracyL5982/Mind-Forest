#include "figures.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>

namespace cards {

namespace {

/// A figure's letters are set 0.02 em closer (`letter-spacing: -0.02em`).
TextAttributes figureAttributes(const Figure& size, Color color, float k) {
    Setting t = figureSetting(size);
    TextAttributes a = attributes(t, color, k);
    a.kern = -0.02f * t.size * k;
    return a;
}

/// `lift` without its floor: a figure is taller than its line, and a browser then sets its words lower
/// than the line's top, by half of what they overrun it.
float raised(const Setting& t, float k) {
    FontMetrics m = attributes(t, Color::white(), k).font.metrics();
    return (t.lead * k - (m.ascent + m.descent)) / 2;
}

/// |value| as decimal digits, and the power of ten of the first: the shortest digits that read back as
/// the same double, which is the number `Intl` rounds, or forty digits of its `exact` value, which is
/// the number `toFixed` rounds.
std::pair<std::string, int> digitsOf(double a, bool exact) {
    char buf[64];
    if (exact) {
        snprintf(buf, sizeof buf, "%.39e", a);
    } else {
        for (int p = 0; p <= 16; p++) {
            snprintf(buf, sizeof buf, "%.*e", p, a);
            if (strtod(buf, nullptr) == a) break;
        }
    }
    const char* e = strchr(buf, 'e');
    std::string digits(1, buf[0]);
    if (buf[1] == '.') digits += std::string(buf + 2, size_t(e - buf - 2));
    return {digits, atoi(e + 1)};
}

/// `value` rounded half away from zero, keeping the digit worth 10^`last` and none after it.
Decimal roundedAt(double value, int last, bool exact) {
    Decimal d;
    d.negative = std::signbit(value);
    double a = std::fabs(value);
    if (a == 0) return d;
    auto [all, e] = digitsOf(a, exact);
    int keep = e - last + 1;
    if (keep < 0) return d;
    std::string kept = all.substr(0, size_t(std::min(keep, int(all.size()))));
    if (keep < int(all.size()) && all[size_t(keep)] >= '5') {
        int i = keep - 1;
        while (i >= 0 && kept[size_t(i)] == '9') kept[size_t(i--)] = '0';
        if (i >= 0) {
            kept[size_t(i)]++;
        } else {
            kept.insert(kept.begin(), '1');
            e++;
        }
    }
    while (!kept.empty() && kept.back() == '0') kept.pop_back();
    d.digits = kept;
    d.exponent = e;
    return d;
}

}  // namespace

Setting figureSetting(const Figure& size) {
    switch (size.letter) {
    case LARGEST.letter: return {34, 36, Font::Weight::bold};
    case MIDDLE.letter: return {24, 28, Font::Weight::bold};
    default: return {18, 24, Font::Weight::bold};
    }
}

bool figure(const Pen& pen, const std::string& value, float x, float y, float width, int lines, const Figure& size, Color color) {
    if (value.empty()) return false;
    CGPoint at{x * pen.k, y * pen.k - raised(figureSetting(size), pen.k)};
    TextAttributes a = figureAttributes(size, color, pen.k);
    std::string shown = value;
    const TextFrame& all = layoutText(value, a, width * pen.k, 0);
    bool held = lines > 0 && int(all.lines.size()) > lines;
    if (held) {
        std::u16string units = utf16(value);
        shown = ::utf8(units.substr(0, size_t(std::clamp(all.lines[size_t(lines - 1)].end, 0, int(units.size())))));
    }
    pen.ctx.drawText(shown, at, a, width * pen.k, 0);
    return held;
}

float figureHeight(const std::string& value, float width, int lines, const Figure& size, float k) {
    if (value.empty()) return 0;
    return layoutText(value, figureAttributes(size, Color::white(), k), width * k, lines).height / k;
}

void rule(const Pen& pen, float x, float y, Color accent) {
    pen.ctx.setFillColor(accent);
    pen.ctx.fill(pen.px(x, y + 4, 28, 2));
}

void box(const Pen& pen, float x, float y, float width, float height, Color fill, std::optional<Color> edge) {
    CGRect r = pen.px(x, y, width, height);
    pen.ctx.setFillColor(fill);
    pen.rounded(r, 12 * pen.k);
    pen.ctx.fillPath();
    if (!edge) return;
    float line = pen.k;
    pen.ctx.setStrokeColor(*edge);
    pen.ctx.setLineWidth(line);
    pen.rounded(CGRect{r.minX() + line / 2, r.minY() + line / 2, r.width() - line, r.height() - line}, 12 * pen.k - line / 2);
    pen.ctx.strokePath();
}

Decimal fixed(double value, int places) { return roundedAt(value, -places, false); }

Decimal toFixed(double value, int places) { return roundedAt(value, -places, true); }

Decimal significant(double value, int figures) {
    if (value == 0) return roundedAt(value, 0, false);
    return roundedAt(value, digitsOf(std::fabs(value), false).second - figures + 1, false);
}

std::string written(const Decimal& d, int grouped) {
    std::string whole = "0", part;
    if (!d.digits.empty()) {
        int n = int(d.digits.size()), before = d.exponent + 1;
        if (before <= 0) {
            part = std::string(size_t(-before), '0') + d.digits;
        } else if (before >= n) {
            whole = d.digits + std::string(size_t(before - n), '0');
        } else {
            whole = d.digits.substr(0, size_t(before));
            part = d.digits.substr(size_t(before));
        }
    }
    if (int(whole.size()) >= grouped) {
        for (int i = int(whole.size()) - 3; i > 0; i -= 3) whole.insert(size_t(i), ",");
    }
    return (d.negative ? "-" : "") + whole + (part.empty() ? "" : "." + part);
}

std::string exact(double value) { return written(fixed(value, 6), 4); }

}  // namespace cards
