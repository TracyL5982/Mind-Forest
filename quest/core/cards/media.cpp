#include "media.h"

#include <algorithm>
#include <cmath>

namespace cards {

std::string capital(const std::string& s) {
    constexpr char32_t JOINER = 0x200d, EMOJI_FORM = 0xfe0f;
    Text t = points(s);
    if (t.empty()) return "";
    size_t n = 1;
    bool joined = t[0] == JOINER;
    while (n < t.size() && (joined || t[n] == EMOJI_FORM || span(Text(1, t[n])) == 0)) {
        joined = t[n] == JOINER;
        n++;
    }
    return uppercased(utf8(t.substr(0, n)));
}

CGRect contained(CGRect box, float aspect) {
    float w = std::min(box.width(), box.height() * aspect), h = w / aspect;
    return {box.midX() - w / 2, box.midY() - h / 2, w, h};
}

void disc(const Pen& pen, const Look& look, CGRect box) {
    pen.ctx.setFillColor(mix(look.accent, 0.18f, look.fill));
    pen.ctx.fillEllipse(box);
    ring(pen, look, box);
}

void ring(const Pen& pen, const Look& look, CGRect box) {
    float line = pen.k;
    pen.ctx.setStrokeColor(look.accent.withAlphaComponent(0.5f));
    pen.ctx.setLineWidth(line);
    pen.ctx.strokeEllipse(box.insetBy(-line / 2, -line / 2));
}

void play(const Pen& pen, float x, float y, float w, float h, Color color) {
    pen.ctx.setFillColor(color);
    pen.ctx.move(CGPoint{x * pen.k, y * pen.k});
    pen.ctx.addLine(CGPoint{(x + w) * pen.k, (y + h / 2) * pen.k});
    pen.ctx.addLine(CGPoint{x * pen.k, (y + h) * pen.k});
    pen.ctx.closePath();
    pen.ctx.fillPath();
}

void hatch(const Pen& pen, CGRect frame, Color a, Color b, float stripe) {
    Canvas& ctx = pen.ctx;
    ctx.saveGState();
    ctx.clip(frame);
    ctx.setFillColor(a);
    ctx.fill(frame);
    ctx.setFillColor(b);
    float band = stripe * pen.k * float(M_SQRT2), reach = frame.width() + frame.height();
    for (float c = band; c < reach + band; c += 2 * band) {
        ctx.move(CGPoint{frame.minX() + c, frame.minY()});
        ctx.addLine(CGPoint{frame.minX() + c + band, frame.minY()});
        ctx.addLine(CGPoint{frame.minX() + c + band - reach, frame.minY() + reach});
        ctx.addLine(CGPoint{frame.minX() + c - reach, frame.minY() + reach});
        ctx.closePath();
        ctx.fillPath();
    }
    ctx.restoreGState();
}

void paragraph(Sheet& sheet, const std::string& s, const Setting& t, Color color, float gap) {
    if (s.empty()) return;
    if (!sheet.first) sheet.y += gap - Sheet::gap;
    sheet.paragraph(s, t, color);
}

}  // namespace cards
