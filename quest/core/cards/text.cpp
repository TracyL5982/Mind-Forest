#include "text.h"

#include <algorithm>
#include <cmath>
#include <limits>

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

void strokes(const Pen& pen, float x, float y, const std::vector<std::vector<CGPoint>>& lines, float width, Color color) {
    pen.ctx.setStrokeColor(color);
    pen.ctx.setLineWidth(width * pen.k);
    pen.ctx.setLineCap(Canvas::LineCap::round);
    pen.ctx.setLineJoin(Canvas::LineJoin::round);
    for (const std::vector<CGPoint>& line : lines) {
        for (size_t i = 0; i < line.size(); i++) {
            CGPoint p{(x + line[i].x) * pen.k, (y + line[i].y) * pen.k};
            if (i == 0) pen.ctx.move(p); else pen.ctx.addLine(p);
        }
        pen.ctx.strokePath();
    }
}

std::vector<CGPoint> ring(float cx, float cy, float r) {
    std::vector<CGPoint> out;
    for (int i = 0; i <= 32; i++) {
        float a = float(i) / 32 * 2 * float(M_PI);
        out.push_back({cx + r * std::cos(a), cy + r * std::sin(a)});
    }
    return out;
}

}  // namespace cards
