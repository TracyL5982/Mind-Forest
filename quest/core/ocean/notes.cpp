// Port of visionos/MindPalace/Ocean/Notes.swift: TextBlock, NoteLayout, and the part of Art
// that draws notes. (Their declarations are in art.h.)
#include "art.h"

#include <algorithm>

#include "../platform.h"
#include "diagrams.h"

// MARK: - TextBlock

TextBlock::TextBlock(const std::string& string, CGPoint origin, float width, int lines, const TextAttributes& attributes)
    : string(string),
      origin(origin),
      // NOTE(port): the container is as tall as can be (`.greatestFiniteMagnitude`), has no side
      // padding, holds `lines` lines and cuts its tail: all of that is what a TextLayout is.
      layout(string, attributes, CGSize{width, INFINITY}, lines),
      height(std::ceil(layout.usedRect().height())) {}

float TextBlock::width() const { return std::ceil(layout.usedRect().width()); }

void TextBlock::draw() const {
    layout.drawGlyphs(origin);
}

CGRect TextBlock::frame() const { return CGRect{origin.x, origin.y, layout.containerSize.width, height}; }

/// The words between two points on the note (pixels), whole words only,
/// with the rectangles that cover them line by line.
std::optional<TextBlock::Words> TextBlock::words(CGPoint a, CGPoint b) const {
    auto index = [&](CGPoint p) {
        CGPoint local{std::min(std::max(p.x - origin.x, 0.f), layout.containerSize.width - 1), std::min(std::max(p.y - origin.y, 0.f), height - 1)};
        return layout.characterIndex(local);
    };
    // NOTE(port): `string as NSString`: indices below count UTF-16 code units, as the Swift's do.
    std::u16string ns = utf16(string);
    int length = int(ns.size());
    if (!(length > 0)) return std::nullopt;
    int lo = std::min(index(a), length - 1), hi = std::min(index(b), length - 1);
    if (lo > hi) std::swap(lo, hi);
    // Half of a pair is no scalar, so it is no space (`UnicodeScalar(...)` is nil for it).
    auto isSpace = [&](int i) {
        char16_t c = ns[size_t(i)];
        return !(c >= 0xD800 && c < 0xE000) && CharacterSet::whitespacesAndNewlines(c);
    };
    while (lo > 0 && !isSpace(lo - 1)) lo -= 1;
    while (hi < length - 1 && !isSpace(hi + 1)) hi += 1;
    while (lo < hi && isSpace(lo)) lo += 1;
    while (hi > lo && isSpace(hi)) hi -= 1;
    CharacterRange range{lo, hi - lo + 1};
    std::vector<CGRect> rects;
    layout.enumerateEnclosingRects(range, [&](CGRect rect) {
        rects.push_back(rect.offsetBy(origin.x, origin.y));
    });
    std::u16string picked = trimmingCharacters(ns.substr(size_t(range.location), size_t(range.length)), [](char32_t c) {
        return CharacterSet::punctuationCharacters(c) || CharacterSet::whitespacesAndNewlines(c);
    });
    std::string text = utf8(picked);
    if (text.empty() || rects.empty()) return std::nullopt;
    size_t at = ns.find(picked, size_t(range.location));
    return Words{text, rects, at == std::u16string::npos ? range.location : int(at)};
}

std::vector<CGRect> TextBlock::rects(int at, int length) const {
    std::vector<CGRect> out;
    if (length <= 0) return out;
    layout.enumerateEnclosingRects(CharacterRange{at, length}, [&](CGRect rect) { out.push_back(rect.offsetBy(origin.x, origin.y)); });
    return out;
}

// MARK: - NoteLayout

/// A point on the note in pixels to a point on the card in meters (its middle is the origin, y up).
Vec2 NoteLayout::meters(CGPoint p) const {
    return {(p.x - size.width / 2) / Art::ppm, (size.height / 2 - p.y) / Art::ppm};
}

CGPoint NoteLayout::pixels(Vec2 m) const {
    return CGPoint{m.x * Art::ppm + size.width / 2, size.height / 2 - m.y * Art::ppm};
}

// Notes: every card that is led by words. A text note, a picture, a video,
// a chart and a link are all one card with a different middle.

std::map<std::string, ImageRef> Art::pictures;
std::map<std::string, NoteLayout> Art::layouts;

/// A picture kept in the app (any file among its resources), by name.
ImageRef Art::picture(const std::string& name) const {
    // NOTE(port): added for Quest. "gesture:<name>" is no file: it is the empty stage on a lesson's card in
    // the welcome tree, where the guide plays that gesture (oceanmodel_guide.cpp).
    if (name.rfind("gesture:", 0) == 0) return nullptr;
    auto hit = pictures.find(name);
    if (hit != pictures.end()) return hit->second;
    // `name.split(separator: ".", maxSplits: 1)`: the name, and its extension if it has one.
    std::vector<std::string> parts;
    size_t dot = name.find('.');
    if (dot == std::string::npos) {
        parts = {name};
    } else {
        parts = {name.substr(0, dot), name.substr(dot + 1)};
    }
    // A note's picture is a file in visionos/MindPalace/Resources/Ocean (vertigo-mirror.jpg), which the
    // app's bundle holds at its top, beside ocean.json: both hosts find it by its bare name.
    std::string url = platform::resourcePath(parts.size() > 1 ? parts[0] + "." + parts[1] : parts[0]);
    if (url.empty()) return nullptr;
    ImageRef image = platform::loadImage(url);
    if (!image) return nullptr;
    pictures[name] = image;
    return image;
}

/// Draws a note's picture: a file of its own, or a film's still.
void Art::drawPicture(const OceanNote& note, CGRect rect) const {
    if (std::optional<int> f = note.stillFilm(); f && *f >= 0 && *f < int(clips.size())) {
        still(clips[size_t(*f)], rect);
    } else if (ImageRef image = note.image ? picture(*note.image) : nullptr) {
        drawImage(image, rect);
    } else {
        setFill(Art::well);
        UIRectFill(rect);
    }
}

std::string Art::kickerWords(const OceanNote& note) const {
    switch (note.kind()) {
    case OceanNote::Kind::link: return (note.link ? note.link->site : note.kicker) + "  ↗";
    default: return note.kicker;
    }
}

// MARK: Small

/// The body of a note, small: a picture for the notes that have one, a panel for the rest.
Vec2 Art::noteSmallSize(const OceanNote& note, const std::shared_ptr<Catalog>& catalog) const {
    switch (note.kind()) {
    case OceanNote::Kind::image:
    case OceanNote::Kind::video:
        return Metrics::film(Metrics::smallFilm, Metrics::smallFilmMaxHeight, catalog->aspect(note));
    default: {
        float pad = px(0.011f), line = px(0.0176f);
        float h = text(note.headline, CGRect{0, 0, px(Metrics::smallNoteWidth) - 2 * pad, line * 4.2f},
                       font(Size::body, Font::Weight::semibold), Color::white(), line, 0, false);
        return {Metrics::smallNoteWidth, (px(0.031f) + h + px(0.012f)) / ppm};
    }
    }
}

std::optional<Piece> Art::noteSmall(const OceanNote& note, const std::shared_ptr<Catalog>& catalog) {
    Vec2 size = noteSmallSize(note, catalog);
    float w = px(size.x), h = px(size.y);
    switch (note.kind()) {
    case OceanNote::Kind::image:
    case OceanNote::Kind::video: {
        // Like a film: the picture, and under it what it is in a few words.
        Font kindFont = font(Size::micro, Font::Weight::bold), titleFont = font(Size::label, Font::Weight::medium);
        float padX = px(pad.x), padY = px(pad.y), limit = px(0.25f);
        std::string kind = note.kind() == OceanNote::Kind::video ? "VIDEO" : "IMAGE";
        // NOTE(port): added for Quest: a lesson of the welcome tree is named by its step, not as an image.
        if (note.id.rfind("welcome", 0) == 0) kind = uppercased(note.kicker);
        CGSize kindSize = label(kind, CGPoint::zero(), kindFont, ::ink(note.tone), ::color(note.tone), padX, padY, INFINITY, false);
        CGSize title = label(note.headline, CGPoint::zero(), titleFont, Color::white(), ink, padX, padY, limit - kindSize.width, false);
        float full = std::max(w, kindSize.width + title.width);
        float tall = h + px(0.006f) + std::max(kindSize.height, title.height);
        Vec2 offset{(full - w) / 2 / ppm, -((tall - h) / 2 / ppm)};
        return piece("note-s:" + note.id, full, tall, offset, [&](Canvas&, CGSize) {
            // NOTE(port): added for Quest. A lesson of the welcome tree, closed, is the number of its step, large,
            // on a plain ground (the marking lesson too, whose open card is a picture): the walk's cards are
            // told from the pictures round them at a glance.
            bool lesson = note.id.rfind("welcome", 0) == 0;
            if (lesson) {
                setFill(Color::hex(0x20252E));
                UIRectFill(CGRect{0, 0, w, h});
            } else {
                drawPicture(note, CGRect{0, 0, w, h});
            }
            if (lesson) {
                std::string number;
                for (char ch : note.kicker) {
                    if (ch >= '0' && ch <= '9') number += ch;
                    else if (!number.empty()) break;
                }
                Font big = font(0.05f, Font::Weight::semibold);
                TextAttributes look = attributes(big, Color::white(1, 0.92f));
                CGSize took = stringSize(number, look);
                drawString(number, CGPoint{(w - took.width) / 2, (h - std::ceil(big.lineHeight())) / 2}, look);
            }
            if (note.kind() == OceanNote::Kind::video) {
                // A play mark, so a video never reads as a still.
                float d = px(0.026f);
                CGRect box{px(0.006f), h - d - px(0.006f), d, d};
                setFill(ink);
                UIRectFill(box);
                setFill(Color::white());
                UIBezierPath t;
                t.move(CGPoint{box.minX() + d * 0.36f, box.minY() + d * 0.27f});
                t.addLine(CGPoint{box.minX() + d * 0.36f, box.maxY() - d * 0.27f});
                t.addLine(CGPoint{box.maxX() - d * 0.27f, box.midY()});
                t.close();
                t.fill();
            }
            // Its kind, on a label as tall as the title's, then the title.
            float y = h + px(0.006f);
            setFill(::color(note.tone));
            UIRectFill(CGRect{0, y, kindSize.width, title.height});
            drawString(kind, CGPoint{padX, y + (title.height - std::ceil(kindFont.lineHeight())) / 2}, attributes(kindFont, ::ink(note.tone)));
            label(note.headline, CGPoint{kindSize.width, y}, titleFont, Color::white(), ink, padX, padY, limit - kindSize.width);
        });
    }
    default:
        return piece("note-s:" + note.id, w, h, [&](Canvas& ctx, CGSize) {
            setFill(ink);
            UIRectFill(CGRect{0, 0, w, h});
            setFill(::color(note.tone));
            UIRectFill(CGRect{0, 0, w, px(0.004f)});
            float pad = px(0.011f);
            Font kicker = font(Size::micro, Font::Weight::bold);
            drawString(uppercased(kickerWords(note)), CGPoint{pad, px(0.012f)}, attributes(kicker, ::color(note.tone), px(0.0007f)));
            if (note.chart) {
                const ChartSpec& chart = *note.chart;
                // A few bars in the corner say "numbers" before a word is read.
                CGRect box{w - pad - px(0.034f), px(0.011f), px(0.034f), px(0.014f)};
                bars(chart, box, ctx, note.tone, std::nullopt);
            }
            float line = px(0.0176f);
            text(note.headline, CGRect{pad, px(0.031f), w - 2 * pad, line * 4.2f}, font(Size::body, Font::Weight::semibold), Color::white(),
                 line);
        });
    }
}

// MARK: Open

/// Where an open note's parts sit. Worked out once per note.
NoteLayout Art::noteLayout(const OceanNote& note, const std::shared_ptr<Catalog>& catalog) const {
    auto hit = layouts.find(note.id);
    if (hit != layouts.end()) return hit->second;
    Vec2 size = catalog->openSize(note);
    float w = px(size.x), h = px(size.y);
    NoteLayout layout{CGSize{w, h}};
    float pad = px(0.022f), inner = w - 2 * pad;
    Tone tone = note.tone;
    Font kickerFont = font(Size::micro, Font::Weight::bold);
    std::string kicker = uppercased(kickerWords(note));
    TextAttributes kickerAttributes = attributes(kickerFont, ::color(tone), px(0.001f));

    // `x` and `width` are `pad` and `inner` where the Swift leaves them out.
    auto block = [&](const std::string& string, float y, float x, float width, int lines, float size, Font::Weight weight, Color color,
                     float lineHeight) {
        return std::make_shared<TextBlock>(string, CGPoint{x, y}, width, lines, attributes(font(size, weight), color, 0, px(lineHeight)));
    };

    // NOTE(port): the drawing closures are kept with the layout and run later, so they hold
    // copies of what they draw (the note among them), where the Swift's hold references.
    switch (note.kind()) {
    case OceanNote::Kind::image:
    case OceanNote::Kind::video: {
        // The picture first, full width; then what it is, and a line about it.
        Vec2 p = catalog->pictureSize(note);
        float pw = px(p.x), ph = px(p.y);
        CGRect picture{(w - pw) / 2, 0, pw, ph};
        layout.picture = picture;
        float y = ph + px(0.014f);
        CGPoint kickerAt{pad, y};
        y += px(0.02f);
        std::shared_ptr<TextBlock> head = block(note.headline, y, pad, inner, 2, Size::title, Font::Weight::semibold, Color::white(), 0.03f);
        y += head->height + px(0.007f);
        std::shared_ptr<TextBlock> body = block(note.summary, y, pad, inner, 2, Size::body, Font::Weight::regular, Color::white(1, 0.8f), 0.0176f);
        layout.blocks = {head, body};
        layout.draw.push_back([=, this](Canvas&) {
            drawPicture(note, picture);
            setFill(::color(tone));
            UIRectFill(CGRect{0, ph, w, px(0.004f)});
            drawString(kicker, kickerAt, kickerAttributes);
            head->draw();
            body->draw();
        });
        break;
    }
    case OceanNote::Kind::text:
    case OceanNote::Kind::chart:
    case OceanNote::Kind::link: {
        float y = px(0.024f);
        CGPoint kickerAt{pad, y};
        y += px(0.021f);
        std::shared_ptr<TextBlock> head = block(note.headline, y, pad, inner, 2, Size::title, Font::Weight::semibold, Color::white(), 0.0305f);
        y += head->height + px(0.011f);
        // The takeaway, marked like a highlighter.
        std::shared_ptr<TextBlock> mark = block(note.highlight, y + px(0.003f), pad + px(0.007f), inner - px(0.014f), 2, Size::lead,
                                                Font::Weight::semibold, ::ink(tone), 0.0215f);
        CGRect markBox{pad, y, std::min(inner, mark->width() + px(0.014f)), mark->height + px(0.006f)};
        y += markBox.height() + px(0.012f);
        std::shared_ptr<TextBlock> body;
        if (note.kind() != OceanNote::Kind::chart) {
            body = block(note.summary, y, pad, inner, 3, Size::body, Font::Weight::regular, Color::white(1, 0.8f), 0.0176f);
        }
        layout.blocks = {head, mark};
        if (body) layout.blocks.push_back(body);
        float foot = h - px(0.022f);
        layout.draw.push_back([=, this](Canvas& ctx) {
            drawString(kicker, kickerAt, kickerAttributes);
            head->draw();
            if (!note.highlight.empty()) {
                setFill(::color(tone));
                UIRectFill(markBox);
                mark->draw();
            }
            if (body) body->draw();
            if (note.chart) {
                const ChartSpec& chart = *note.chart;
                float top = y + px(0.004f);
                bars(chart, CGRect{pad, top, inner, foot - top}, ctx, tone,
                     attributes(font(Size::micro, Font::Weight::medium), Color::white(1, 0.72f)));
            } else if (note.diagram) {
                const std::string& diagram = *note.diagram;
                CGRect box{pad, foot - px(0.118f), inner, px(0.118f)};
                Diagrams::draw(diagram, box, ctx, tone, px(0.001f),
                               attributes(font(Size::micro, Font::Weight::medium), Color::white(1, 0.7f)));
            }
        });
        break;
    }
    }
    layouts[note.id] = layout;
    return layout;
}

/// A note, open.
std::optional<Piece> Art::noteOpen(const OceanNote& note, const std::shared_ptr<Catalog>& catalog) {
    NoteLayout layout = noteLayout(note, catalog);
    float w = layout.size.width, h = layout.size.height;
    return piece("note-o:" + note.id, w, h, [&](Canvas& ctx, CGSize) {
        setFill(ink);
        UIRectFill(CGRect{0, 0, w, h});
        if (!layout.picture) {
            setFill(::color(note.tone));
            UIRectFill(CGRect{0, 0, w, px(0.006f)});
        }
        for (const std::function<void(Canvas&)>& draw : layout.draw) draw(ctx);
    });
}

/// Bars, flat: one per value, the one the note is about in its color.
/// With `labels`, each bar carries its value above and its name below.
void Art::bars(const ChartSpec& chart, CGRect box, Canvas& ctx, Tone tone, const std::optional<TextAttributes>& labels) const {
    int n = int(std::min(chart.labels.size(), chart.values.size()));
    if (!(n > 0)) return;
    double most = *std::max_element(chart.values.begin(), chart.values.begin() + n);
    if (!(most > 0)) return;
    CGRect area = box;
    float sourceHeight = 0;
    if (labels) {
        const Font& font = labels->font;
        float line = std::ceil(font.lineHeight());
        if (chart.source) {
            const std::string& source = *chart.source;
            TextAttributes quiet = *labels;
            quiet.foregroundColor = Color::white(1, 0.45f);
            drawString(source, CGPoint{box.minX(), box.maxY() - line}, quiet);
            sourceHeight = line + line * 0.5f;
        }
        area = CGRect{box.minX(), box.minY() + line * 1.25f, box.width(), box.height() - line * 2.6f - sourceHeight};
    }
    // Each gap is a third of a bar.
    float bar = area.width() / (float(n) + float(n - 1) * 0.34f);
    float gap = bar * 0.34f;
    for (int i = 0; i < n; i++) {
        float v = float(chart.values[size_t(i)] / most);
        float x = area.minX() + float(i) * (bar + gap);
        float hgt = std::max(area.height() * v, 2.f);
        bool marked = chart.mark == i;
        // Solid grays: a see-through fill would cut a hole in the card.
        setFill(marked ? ::color(tone) : Color::hex(!labels ? 0xC4C7CD : 0x575C66));
        UIRectFill(CGRect{x, area.maxY() - hgt, bar, hgt});
        if (!labels) continue;
        const Font& font = labels->font;
        float line = std::ceil(font.lineHeight());
        TextAttributes strong = *labels;
        strong.foregroundColor = marked ? ::color(tone) : Color::white();
        std::string value = chart.values[size_t(i)] == std::round(chart.values[size_t(i)]) ? std::to_string(int(chart.values[size_t(i)]))
                                                                                           : fmt("%.1f", chart.values[size_t(i)]);
        const std::string& vs = value;
        float vw = stringSize(vs, strong).width;
        drawString(vs, CGPoint{x + (bar - vw) / 2, area.maxY() - hgt - line * 1.15f}, strong);
        const std::string& name = chart.labels[size_t(i)];
        float nw = stringSize(name, *labels).width;
        drawString(name, CGPoint{x + (bar - nw) / 2, area.maxY() + line * 0.25f}, *labels);
    }
}

// MARK: Marks

/// The outline of a circled part of a picture, drawn at its own size so the line stays even.
std::optional<Piece> Art::ring(Vec2 size) {
    float w = std::max(px(size.x), 12.f), h = std::max(px(size.y), 12.f);
    float line = px(0.0032f);
    return piece(std::nullopt, w + line * 2, h + line * 2, [&](Canvas& ctx, CGSize) {
        ctx.setStrokeColor(ink);
        ctx.setLineWidth(line * 2);
        ctx.strokeEllipse(CGRect{line, line, w, h});
        ctx.setStrokeColor(hot);
        ctx.setLineWidth(line);
        ctx.strokeEllipse(CGRect{line, line, w, h});
    });
}

/// A flat rectangle of one color: a highlighter stroke (see-through) or a timeline's bar.
EntityRef Art::swatch(Color color, Vec2 size, float opacity) const {
    Material m = Material::unlit(color);
    if (opacity < 1) {
        m.transparent = true;
        m.opacity = opacity;
    }
    return Entity::make(Mesh::generatePlane(size.x, size.y), {m});
}

// MARK: Glow

namespace {
/// How far a glow reaches out from the card's edge, and in under it, m.
constexpr float glowOut = 0.02f, glowIn = 0.012f;

/// Bands of light round a card whose face is `size` with corners of `radius`. Ring `i` is the card's outline
/// moved out by `offsets[i]` (in, where it is negative), turning each corner about that corner's own centre,
/// so all the way round it stays as far from the card's edge; its points carry `uvs[i]`. Each ring is joined
/// to the next.
// NOTE(port): changed for Quest. The Swift's glow is one picture of a soft square, stretched to fit, and its gaze
// rim turns about the card's corner points: both are square where a card's corners are round.
MeshRef bands(Vec2 size, float radius, const std::vector<float>& offsets, const std::vector<Vec2>& uvs) {
    constexpr int arc = 12;                         // pieces of each corner's quarter turn
    float hx = size.x / 2, hy = size.y / 2;
    radius = std::clamp(radius, 0.f, std::min(hx, hy));
    const float signs[4][2] = {{1, 1}, {-1, 1}, {-1, -1}, {1, -1}};
    int around = 4 * (arc + 1);                     // points in one ring
    std::vector<Vec3> positions;
    std::vector<Vec2> coordinates;
    for (size_t r = 0; r < offsets.size(); r++) {
        // Moved in further than the corner is round, a ring's corners are sharp, at the moved edges' meeting.
        float turn = std::max(0.f, radius + offsets[r]), centre = radius - std::min(0.f, radius + offsets[r]);
        for (int c = 0; c < 4; c++) {
            for (int k = 0; k <= arc; k++) {
                float a = (float(c) + float(k) / arc) * float(M_PI) / 2;
                positions.push_back({signs[c][0] * (hx - centre) + std::cos(a) * turn, signs[c][1] * (hy - centre) + std::sin(a) * turn, 0});
                coordinates.push_back(uvs[r]);
            }
        }
    }
    std::vector<uint32_t> index;
    for (int r = 0; r + 1 < int(offsets.size()); r++) {
        for (int k = 0; k < around; k++) {
            uint32_t a = uint32_t(r * around + k), b = uint32_t(r * around + (k + 1) % around);
            uint32_t c = a + uint32_t(around), d = b + uint32_t(around);
            index.insert(index.end(), {a, c, d, a, d, b});
        }
    }
    return Mesh::generate(std::move(positions), std::move(coordinates), std::move(index));
}
}  // namespace

std::optional<Material> Art::glowMaterial;

std::optional<Material> Art::glowLook() {
    if (glowMaterial) return glowMaterial;
    // Across the band, u 0 at its outer edge and 1 at its inner one. The light falls away over about
    // a centimetre outward, to nothing at the band's edge, and at once inward (the card covers that part anyway).
    const int n = 128;
    const float outward = 0.0075f, inward = 0.0025f, end = std::exp(-glowOut * glowOut / (2 * outward * outward));
    std::vector<uint8_t> pixels(size_t(n * 4), 0);
    for (int i = 0; i < n; i++) {
        float d = glowOut - (float(i) + 0.5f) / n * (glowOut + glowIn);        // how far outside the card's edge
        float a = d >= 0 ? 0.42f * std::max(0.f, std::exp(-d * d / (2 * outward * outward)) - end) / (1 - end)
                         : 0.42f * std::exp(-d * d / (2 * inward * inward));
        size_t p = size_t(i * 4);
        pixels[p] = uint8_t(std::lround(255 * a));      // premultiplied: a warm white
        pixels[p + 1] = uint8_t(std::lround(238 * a));
        pixels[p + 2] = uint8_t(std::lround(205 * a));
        pixels[p + 3] = uint8_t(std::lround(255 * a));
    }
    auto image = std::make_shared<Image>();
    image->width = n;
    image->height = 1;
    image->rgba = std::move(pixels);
    TextureRef texture = Texture::make(image);
    if (!texture) return std::nullopt;
    Material m = Material::unlit(Color::white());
    m.texture = texture;
    m.transparent = true;
    m.opacity = 1.0f;
    glowMaterial = m;
    return m;
}

EntityRef Art::glow(Vec2 size, float radius) {
    std::optional<Material> look = glowLook();
    if (!look) return nullptr;
    // The band's inner edge, its outer edge, and between them the card's edge, so the light is brightest exactly there.
    MeshRef mesh = bands(size, radius, {-glowIn, 0, glowOut}, {{1, 0.5f}, {glowOut / (glowOut + glowIn), 0.5f}, {0, 0.5f}});
    if (!mesh) return nullptr;
    return Entity::make(mesh, {*look});
}

EntityRef Art::gazeRim(Vec2 size, const std::optional<Material>& material, float radius) {
    if (!material) return nullptr;
    // Rings around the card, each a little further out and fainter: the first on the
    // card's edge, the last three centimeters out. It falls off fast at first and then
    // slowly, the way a glow does.
    MeshRef mesh = bands(size, radius, {0, 0.006f, 0.013f, 0.021f, 0.03f}, {{0.95f, 0}, {0.6f, 0}, {0.32f, 0}, {0.12f, 0}, {0, 0}});
    if (!mesh) return nullptr;
    EntityRef e = Entity::make(mesh, {*material});
    e->position.z = -0.002f;
    return e;
}
