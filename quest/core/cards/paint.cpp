#include "paint.h"

#include <algorithm>
#include <cmath>
#include <map>

namespace cards {

Color mix(Color a, float share, Color b) {
    return {a.r * share + b.r * (1 - share), a.g * share + b.g * (1 - share), a.b * share + b.b * (1 - share), 1};
}

TextAttributes attributes(const Setting& t, Color color, float k) {
    Font::Design design = t.mono ? Font::Design::mono : t.serif ? Font::Design::serif : Font::Design::system;
    Font font{t.size * k, t.weight, design, t.italic};
    TextAttributes a{.font = font, .foregroundColor = color};
    a.paragraphStyle.minimumLineHeight = t.lead * k;
    a.paragraphStyle.maximumLineHeight = t.lead * k;
    return a;
}

float lift(const Setting& t, float k) {
    // A browser puts a line's words in the middle of its line; the canvas stands them on its bottom.
    FontMetrics m = attributes(t, Color::white(), k).font.metrics();
    return std::max(0.f, (t.lead * k - (m.ascent + m.descent)) / 2);
}

float heightOf(const std::string& s, float width, int lines, const Setting& t, float k) {
    if (s.empty()) return 0;
    return layoutText(s, attributes(t, Color::white(), k), width * k, lines).height / k;
}

float widthOf(const std::string& s, const Setting& t, float k) { return stringSize(s, attributes(t, Color::white(), k)).width / k; }

void Pen::words(const std::string& s, float x, float y, float width, int lines, const Setting& t, Color color) const {
    if (s.empty()) return;
    if (Cuts::on && lines > 0 && int(layoutText(s, attributes(t, color, k), width * k, 0).lines.size()) > lines) Cuts::seen.push_back("ellipsis: " + s);
    ctx.drawText(s, CGPoint{x * k, y * k - lift(t, k)}, attributes(t, color, k), width * k, lines);
}

void Pen::rounded(CGRect r, float radius) const {
    radius = std::max(0.f, std::min(radius, std::min(r.width(), r.height()) / 2));
    struct Corner {
        float x, y, from;
    };
    const Corner corners[4] = {{r.maxX() - radius, r.minY() + radius, -90},
                               {r.maxX() - radius, r.maxY() - radius, 0},
                               {r.minX() + radius, r.maxY() - radius, 90},
                               {r.minX() + radius, r.minY() + radius, 180}};
    const int steps = 10;
    bool first = true;
    for (const Corner& c : corners) {
        for (int i = 0; i <= steps; i++) {
            float a = (c.from + 90.f * float(i) / steps) * float(M_PI) / 180;
            CGPoint p{c.x + radius * std::cos(a), c.y + radius * std::sin(a)};
            if (first) ctx.move(p); else ctx.addLine(p);
            first = false;
        }
    }
    ctx.closePath();
}

void Pen::face(float w, float h, const Look& look) const {
    ctx.setFillColor(look.fill);
    rounded(px(0, 0, w, h), look.radius * k);
    ctx.fillPath();
}

void Pen::edge(float w, float h, const Look& look) const {
    float line = look.edgeWidth * k;
    ctx.setStrokeColor(look.edge);
    ctx.setLineWidth(line);
    if (look.dashed) ctx.setLineDash(0, {3 * line, 2.4f * line});
    rounded(CGRect{line / 2, line / 2, w * k - line, h * k - line}, look.radius * k - line / 2);
    ctx.strokePath();
    if (look.dashed) ctx.setLineDash(0, {});
}

void Pen::corners(float w, float h, float radius) const {
    float r = radius * k, W = w * k, H = h * k;
    ctx.setFillColor(Color::clear());
    int rows = int(std::ceil(r));
    for (int i = 0; i < rows; i++) {
        float dy = r - (float(i) + 0.5f);
        float out = r - std::sqrt(std::max(0.f, r * r - dy * dy));
        if (out <= 0) continue;
        float top = float(i), bottom = std::ceil(H) - float(i) - 1;
        ctx.rectFill(CGRect{0, top, out, 1});
        ctx.rectFill(CGRect{W - out, top, out, 1});
        ctx.rectFill(CGRect{0, bottom, out, 1});
        ctx.rectFill(CGRect{W - out, bottom, out, 1});
    }
}

void Pen::mask(CGRect r, float radius, Color ground) const {
    ctx.setFillColor(ground);
    struct Corner {
        CGPoint tip, center;
        float from;
    };
    const Corner corners[4] = {{{r.minX(), r.minY()}, {r.minX() + radius, r.minY() + radius}, 180},
                               {{r.maxX(), r.minY()}, {r.maxX() - radius, r.minY() + radius}, 270},
                               {{r.maxX(), r.maxY()}, {r.maxX() - radius, r.maxY() - radius}, 0},
                               {{r.minX(), r.maxY()}, {r.minX() + radius, r.maxY() - radius}, 90}};
    for (const Corner& c : corners) {
        ctx.move(c.tip);
        for (int i = 0; i <= 10; i++) {
            float a = (c.from + 9.f * float(i)) * float(M_PI) / 180;
            ctx.addLine(CGPoint{c.center.x + radius * std::cos(a), c.center.y + radius * std::sin(a)});
        }
        ctx.closePath();
        ctx.fillPath();
    }
}

// MARK: - Pictures

namespace {

std::map<std::string, Picture>& pictures() {
    static std::map<std::string, Picture> all;
    return all;
}
std::map<std::string, Sample>& samples() {
    static std::map<std::string, Sample> all;
    return all;
}
const Sample* sampleAt(const std::string& src) {
    if (src.rfind("sample:", 0) != 0) return nullptr;
    auto it = samples().find(src.substr(7));
    return it == samples().end() ? nullptr : &it->second;
}

/// A rectangle of `aspect` fitted to `frame`: covering it, or inside it whole.
CGRect fitted(CGRect frame, float aspect, bool cover) {
    bool wider = aspect > frame.width() / frame.height();
    bool byHeight = cover ? wider : !wider;
    float w = byHeight ? frame.height() * aspect : frame.width(), h = byHeight ? frame.height() : frame.width() / aspect;
    return {frame.midX() - w / 2, frame.midY() - h / 2, w, h};
}

/// The web library's sample picture (`sample()` in library.html): a diagonal gradient, a pale sun, a dark hill.
void paintSample(Canvas& ctx, const Sample& s, CGRect r) {
    auto at = [&](float u, float v) { return CGPoint{r.minX() + u * r.width(), r.minY() + v * r.height()}; };
    const int bands = 64;
    for (int i = 0; i < bands; i++) {
        float t0 = float(i) / bands, t1 = float(i + 1) / bands + 0.004f;
        float m = (float(i) + 0.5f) / bands;
        ctx.setFillColor(Color{s.a.r + (s.b.r - s.a.r) * m, s.a.g + (s.b.g - s.a.g) * m, s.a.b + (s.b.b - s.a.b) * m, 1});
        // The gradient runs corner to corner of the box, so each band is where u + v lies between two values.
        float a = 2 * t0, b = 2 * t1;
        ctx.move(at(a, 0));
        ctx.addLine(at(b, 0));
        ctx.addLine(at(0, b));
        ctx.addLine(at(0, a));
        ctx.closePath();
        ctx.fillPath();
    }
    ctx.setFillColor(Color::white(1, 0.28f));
    float radius = 0.16f * r.height();
    CGPoint sun = at(0.72f, 0.34f);
    ctx.fillEllipse(CGRect{sun.x - radius, sun.y - radius, 2 * radius, 2 * radius});
    // M0 .78h Q .3w .5h .55w .74h T w .62h V h H0 Z
    auto curve = [&](CGPoint p0, CGPoint c, CGPoint p1) {
        for (int i = 1; i <= 24; i++) {
            float t = float(i) / 24, u = 1 - t;
            ctx.addLine(CGPoint{u * u * p0.x + 2 * u * t * c.x + t * t * p1.x, u * u * p0.y + 2 * u * t * c.y + t * t * p1.y});
        }
    };
    CGPoint start = at(0, 0.78f), c1 = at(0.3f, 0.5f), mid = at(0.55f, 0.74f), end = at(1, 0.62f);
    CGPoint c2{2 * mid.x - c1.x, 2 * mid.y - c1.y};
    ctx.setFillColor(Color::black(0.3f));
    ctx.move(start);
    curve(start, c1, mid);
    curve(mid, c2, end);
    ctx.addLine(at(1, 1));
    ctx.addLine(at(0, 1));
    ctx.closePath();
    ctx.fillPath();
}

/// `.media-missing`: stripes, and the words.
void paintMissing(const Pen& pen, CGRect frame, const Words& words) {
    Canvas& ctx = pen.ctx;
    ctx.setFillColor(Art::ink);
    ctx.fill(frame);
    ctx.setFillColor(Art::panel);
    float band = 10 * pen.k * float(M_SQRT2), reach = frame.width() + frame.height();
    for (float c = band; c < reach + band; c += 2 * band) {
        ctx.move(CGPoint{frame.minX() + c, frame.minY()});
        ctx.addLine(CGPoint{frame.minX() + c + band, frame.minY()});
        ctx.addLine(CGPoint{frame.minX() + c + band - reach, frame.minY() + reach});
        ctx.addLine(CGPoint{frame.minX() + c - reach, frame.minY() + reach});
        ctx.closePath();
        ctx.fillPath();
    }
    std::string said = words.noPicture();
    float w = pen.width(said, setting::text);
    pen.words(said, frame.midX() / pen.k - w / 2, frame.midY() / pen.k - setting::text.lead / 2, w + 1, 1, setting::text, palette::ink3);
}

}  // namespace

std::optional<Picture> pictureAt(const std::string& src) {
    auto it = pictures().find(src);
    return it == pictures().end() ? std::nullopt : std::optional(it->second);
}

void setPicture(const std::string& src, Picture picture) { pictures()[src] = picture; }

void setSample(const std::string& name, Sample sample) { samples()[name] = sample; }

std::optional<float> aspectOf(const std::string& src) {
    if (const Sample* s = sampleAt(src)) return s->width / s->height;
    std::optional<Picture> p = pictureAt(src);
    if (p && p->image && p->image->height > 0) return float(p->image->width) / float(p->image->height);
    return std::nullopt;
}

void Pen::picture(const std::string& src, CGRect frame, bool cover, const Words& words) const {
    ctx.saveGState();
    ctx.clip(frame);
    if (const Sample* s = sampleAt(src)) {
        paintSample(ctx, *s, fitted(frame, s->width / s->height, cover));
    } else if (std::optional<Picture> p = pictureAt(src); p && p->image && p->image->height > 0) {
        ctx.drawImage(p->image, fitted(frame, float(p->image->width) / float(p->image->height), cover));
    } else if (src.empty() || (p && p->missing)) {
        paintMissing(*this, frame, words);
    }
    ctx.restoreGState();
}

// MARK: - Chips

Tone toneOf(Chip::Kind kind) {
    switch (kind) {
    case Chip::Kind::when: return Tone::era;
    case Chip::Kind::origin: return Tone::path;
    case Chip::Kind::where: return Tone::place;
    case Chip::Kind::people: return Tone::people;
    }
    return Tone::path;
}

void Pen::chips(const std::vector<Chip>& line, float x, float y, const Look&) const {
    // Each chip is one of the ocean's tags: a flat label in its tone's colour with its words in the tone's ink
    // (Art::chip), in the box the web gives it. Its kind is told by its tone, where the web draws a glyph.
    constexpr float pad = 7;
    const Setting& t = setting::text;
    for (const Chip& chip : line) {
        Tone tone = toneOf(chip.kind);
        std::string count = chip.count ? "+" + std::to_string(chip.count) : "";
        float countWidth = count.empty() ? 0 : 4 + width(count, t);
        float room = float(chip.width) - 2 * pad - countWidth;
        float drawn = std::min(room, width(chip.text, t));
        // A box closes up to its words when they draw narrower than they were counted.
        float box = std::min(float(chip.width), 2 * pad + std::ceil(drawn) + countWidth);
        ctx.setFillColor(::color(tone));
        ctx.fill(px(x, y, box, 20));
        words(chip.text, x + pad, y + 1.5f, std::max(1.f, room + 0.5f), 1, t, ::ink(tone));
        if (!count.empty()) words(count, x + pad + drawn + 4, y + 1.5f, countWidth + 4, 1, t, ::ink(tone));
        x += box + 6;
    }
}

// MARK: - Labels

namespace {

/// A label as the canvas sets it: its letters, their size, and the `letter-spacing` after each, px.
struct Set {
    std::string shown;
    Setting setting;
    float spacing;
};

/// In capitals at `size`, spaced out, or as written when it holds Han, on a line of the size's meta lead.
Set setOf(const std::string& label, float size) {
    Setting t{size, std::round(size * 4 / 3), Font::Weight::medium};
    Text written = points(label);
    if (std::any_of(written.begin(), written.end(), han)) return {label, t, 0.04f * size};
    std::string shown = label;
    for (char& c : shown) {
        if (c >= 'a' && c <= 'z') c = char(c - 32);
    }
    return {shown, t, 0.07f * size};
}

TextAttributes attributesOf(const Set& set, Color color, float k) {
    TextAttributes a = attributes(set.setting, color, k);
    a.kern = set.spacing * k;
    return a;
}

}  // namespace

float baseline(const Setting& t, float k) {
    FontMetrics m = attributes(t, Color::white(), k).font.metrics();
    return t.lead / 2 + (m.ascent - m.descent) / 2 / k;
}

float labelWidth(const std::string& label, float k, float size) {
    Set set = setOf(label, size);
    return stringSize(set.shown, attributesOf(set, Color::white(), k)).width / k;
}

void label(const Pen& pen, const std::string& label, float x, float y, Color color, float size) {
    Set set = setOf(label, size);
    float k = pen.k;
    pen.ctx.drawText(set.shown, CGPoint{x * k, y * k - lift(set.setting, k)}, attributesOf(set, color, k), (labelWidth(label, k, size) + 1) * k, 1);
}

}  // namespace cards
