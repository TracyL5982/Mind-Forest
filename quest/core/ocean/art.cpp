// Port of visionos/MindPalace/Ocean/Art.swift. (Notes.swift is notes.cpp, Works.swift is works.cpp.)
#include "art.h"
#include "icons.h"

#include <algorithm>
#include <numeric>
#include <tuple>

#include "../platform.h"

// NOTE(port): inside Art, `ink`, `label` and `line` are Art's own, so a tone's ink and color and a
// maker's label (free functions in stage.h and catalog.h) are written `::ink(tone)`,
// `::color(tone)`, `::label(maker)`.

const std::vector<Work>& Art::works() const {
    static const std::vector<Work> none;
    return workLibrary ? workLibrary->works : none;
}

std::shared_ptr<Art> Art::make(const std::shared_ptr<ClipLibrary>& library) {
    // NOTE(port): the library's folder is a name among the resources, not a path (see library.h).
    std::string url = platform::resourcePath(library->folder + "/atlas.jpg");
    ImageRef image = platform::loadImage(url);
    if (!image) return nullptr;
    TextureRef texture = Texture::make(image, true);
    if (!texture) return nullptr;
    std::shared_ptr<Art> art(new Art());
    art->clips = library->clips;
    art->atlas = image;
    art->atlasTexture = texture;
    // The still may be saved smaller than the video it stands for.
    art->atlasSize = {float(image->width), float(image->height)};
    art->stillScale = float(image->width) / float(library->atlas.width);
    return art;
}

// MARK: - Building blocks

std::optional<Piece> Art::piece(const std::optional<std::string>& key, float width, float height, float ppm, Vec2 offset,
                                const std::function<void(Canvas&, CGSize)>& draw) {
    if (key) {
        auto hit = cache.find(*key);
        if (hit != cache.end()) return hit->second;
    }
    CGSize size{std::max(4.f, std::ceil(width)), std::max(4.f, std::ceil(height))};
    UIGraphicsImageRendererFormat format;
    format.scale = 1;
    format.opaque = false;
    ImageRef image = UIGraphicsImageRenderer(size, format).image([&](Canvas& ctx) { draw(ctx, size); });
    if (!image) return std::nullopt;
    TextureRef texture = Texture::make(image, true);
    if (!texture) return std::nullopt;
    Piece p{texture, {size.width / ppm, size.height / ppm}, offset};
    if (key) cache[*key] = p;
    return p;
}

TextAttributes Art::attributes(Font font, Color color, float kern, std::optional<float> lineHeight, bool truncate) const {
    ParagraphStyle style;
    if (lineHeight) {
        style.minimumLineHeight = *lineHeight;
        style.maximumLineHeight = *lineHeight;
    }
    style.lineBreakMode = truncate ? LineBreakMode::byTruncatingTail : LineBreakMode::byWordWrapping;
    return {font, color, kern, style};
}

float Art::width(const std::string& text, Font font, float kern) const {
    return std::ceil(stringSize(text, TextAttributes{.font = font, .kern = kern}).width);
}

/// One flat label: a rectangle hugging one line of text. Returns its size.
CGSize Art::label(const std::string& text, CGPoint p, Font font, Color fg, Color bg, float padX, float padY, float maxWidth,
                  bool draw) const {
    float line = std::ceil(font.lineHeight());
    float w = std::min(width(text, font) + 2 * padX, maxWidth);
    CGSize size{w, line + 2 * padY};
    if (!draw) return size;
    setFill(bg);
    UIRectFill(CGRect{p, size});
    drawString(text, CGRect{p.x + padX, p.y + padY, w - 2 * padX + 1, line}, usesLineFragmentOrigin | truncatesLastVisibleLine,
               attributes(font, fg, 0, std::nullopt, true));
    return size;
}

/// Wrapped text. Returns the height it took.
float Art::text(const std::string& string, CGRect rect, Font font, Color color, float lineHeight, float kern, bool draw) const {
    TextAttributes attrs = attributes(font, color, kern, lineHeight);
    CGRect box = stringBoundingRect(string, CGSize{rect.width(), rect.height()}, usesLineFragmentOrigin, attrs);
    if (draw) {
        drawString(string, rect, usesLineFragmentOrigin | truncatesLastVisibleLine, attrs);
    }
    return std::min(std::ceil(box.height()), rect.height());
}

void Art::still(const Clip& clip, CGRect rect) const {
    const std::vector<int>& t = clip.tile;
    CGRect crop{float(t[0]) * stillScale, float(t[1]) * stillScale, float(t[2]) * stillScale, float(t[3]) * stillScale};
    ImageRef tile = cropping(atlas, crop);
    if (!tile) return;
    drawImage(tile, rect);
}

// MARK: - Films

Vec2 Art::filmSize(const Clip& clip, bool open) const {
    return open ? Metrics::film(Metrics::openFilm, Metrics::openFilmMaxHeight, clip.aspect)
                : Metrics::film(Metrics::smallFilm, Metrics::smallFilmMaxHeight, clip.aspect);
}

/// A film, small: its picture and its title. The card's origin is the
/// middle of the picture. (Why it is here rides on its thread.)
std::optional<Piece> Art::filmSmall(const Clip& clip) {
    Vec2 s = filmSize(clip, false);
    float pw = px(s.x), ph = px(s.y);
    Font titleFont = font(Size::label, Font::Weight::medium);
    float padX = px(pad.x), padY = px(pad.y);
    float limit = px(0.25f);
    CGSize title = label(clip.tag.short_, CGPoint::zero(), titleFont, Color::white(), ink, padX, padY, limit, false);
    float w = std::max(pw, title.width);
    float h = ph + px(0.006f) + title.height;
    Vec2 offset{(w - pw) / 2 / ppm, -((h - ph) / 2 / ppm)};
    return piece(fmt("film-s:%d", clip.index), w, h, offset, [&](Canvas&, CGSize) {
        still(clip, CGRect{0, 0, pw, ph});
        label(clip.tag.short_, CGPoint{0, ph + px(0.006f)}, titleFont, Color::white(), ink, padX, padY, limit);
    });
}

/// What sits under an open film: one panel the picture's width, built
/// like a note. Why it is here, its title and year, and what happens
/// in the scene.
std::optional<Piece> Art::filmCaption(const Clip& clip, const std::string& why, Tone tone) {
    Vec2 s = filmSize(clip, true);
    float w = px(s.x), h = px(Metrics::filmCaption);
    float pad = px(0.014f);
    Font titleFont = font(Size::title, Font::Weight::semibold), yearFont = font(Size::body, Font::Weight::regular);
    Font kickerFont = font(Size::micro, Font::Weight::bold), bodyFont = font(Size::body, Font::Weight::regular);
    Vec2 offset{0, -s.y / 2 - Metrics::filmCaption / 2};
    return piece(std::nullopt, w, h, offset, [&](Canvas&, CGSize) {
        setFill(ink);
        UIRectFill(CGRect{0, 0, w, h});
        setFill(::color(tone));
        UIRectFill(CGRect{0, 0, w, px(0.004f)});
        float y = px(0.015f);
        if (!why.empty()) {
            drawString(uppercased(why), CGPoint{pad, y}, attributes(kickerFont, ::color(tone), px(0.0009f)));
        }
        y += px(0.017f);
        // The title, and the year after it on the same line, quieter.
        std::string year = std::to_string(clip.year);
        float room = w - 2 * pad - width(year, yearFont) - px(0.01f);
        CGSize t = label(clip.title, CGPoint{pad, y}, titleFont, Color::white(), ink, 0, 0, room);
        drawString(year, CGPoint{pad + t.width + px(0.01f), y + t.height - std::ceil(yearFont.lineHeight()) - px(0.0035f)},
                   attributes(yearFont, Color::white(1, 0.6f)));
        y += t.height + px(0.006f);
        float bodyLine = px(0.0176f);
        text(clip.tag.description, CGRect{pad, y, w - 2 * pad, bodyLine * 2}, bodyFont, Color::white(1, 0.82f), bodyLine);
    });
}

/// A film lifted out of the ocean far enough to see what it is: picture,
/// title, scene, and its tags as flat labels. Origin: the picture's middle.
std::optional<Piece> Art::filmPeek(const Clip& clip, const std::vector<OceanTag>& tags) {
    Vec2 s = Metrics::film(0.2f, 0.14f, clip.aspect);
    float pw = px(s.x), ph = px(s.y);
    float w = std::max(pw, px(0.24f));
    Font titleFont = font(Size::body, Font::Weight::semibold), metaFont = font(Size::micro, Font::Weight::regular),
         tagFont = font(Size::micro, Font::Weight::semibold);
    float padX = px(pad.x), padY = px(pad.y), gap = px(0.003f);
    float rowHeight = std::ceil(tagFont.lineHeight()) + 2 * padY;
    // Tags wrap onto rows.
    std::vector<std::vector<OceanTag>> rows{{}};
    float x = 0;
    for (size_t k = 0; k < std::min<size_t>(tags.size(), 5); k++) {
        const OceanTag& tag = tags[k];
        float tw = width(tag.name, tagFont) + 2 * padX;
        if (x + tw > w && !rows.back().empty()) {
            rows.push_back({});
            x = 0;
        }
        rows[rows.size() - 1].push_back(tag);
        x += tw + gap;
    }
    float titleHeight = std::ceil(titleFont.lineHeight()) + 2 * padY, metaHeight = std::ceil(metaFont.lineHeight()) + 2 * padY;
    float h = ph + px(0.006f) + titleHeight + gap + metaHeight + gap + float(rows.size()) * (rowHeight + gap);
    Vec2 offset{(w - pw) / 2 / ppm, -((h - ph) / 2 / ppm)};
    return piece(fmt("peek:%d", clip.index), w, h, offset, [&](Canvas&, CGSize) {
        still(clip, CGRect{0, 0, pw, ph});
        float y = ph + px(0.006f);
        y += label(clip.title, CGPoint{0, y}, titleFont, Color::white(), ink, padX, padY, w).height + gap;
        y += label(std::to_string(clip.year) + " · " + clip.scene, CGPoint{0, y}, metaFont, Color::white(1, 0.75f), ink, padX, padY, w).height + gap;
        for (const std::vector<OceanTag>& row : rows) {
            float x = 0;
            for (const OceanTag& tag : row) {
                x += label(tag.name, CGPoint{x, y}, tagFont, ::ink(tag.kind), ::color(tag.kind), padX, padY).width + gap;
            }
            y += rowHeight + gap;
        }
    });
}

// MARK: - Tags

float Art::chipWidth(const std::string& name) const {
    return (width(name, font(Size::label, Font::Weight::semibold)) + 2 * px(pad.x)) / ppm;
}

/// A tag: one flat colored label.
std::optional<Piece> Art::chip(const OceanTag& tag) {
    Font f = font(Size::label, Font::Weight::semibold);
    float padX = px(pad.x), padY = (px(Metrics::chipHeight) - std::ceil(f.lineHeight())) / 2;
    CGSize size = label(tag.name, CGPoint::zero(), f, ::ink(tag.kind), ::color(tag.kind), padX, padY, INFINITY, false);
    return piece("chip:" + tag.id, size.width, size.height, [&](Canvas&, CGSize) {
        label(tag.name, CGPoint::zero(), f, ::ink(tag.kind), ::color(tag.kind), padX, padY);
    });
}

/// A tag in focus: the same label, large, and what it gathers.
std::optional<Piece> Art::tagOpen(const OceanTag& tag) {
    Font f = font(Size::title, Font::Weight::semibold), sub = font(Size::label, Font::Weight::regular);
    float padX = px(0.0135f), padY = px(0.0085f);
    CGSize big = label(tag.name, CGPoint::zero(), f, ::ink(tag.kind), ::color(tag.kind), padX, padY, INFINITY, false);
    std::string line = std::string(::name(tag.kind)) + " · " + tag.gathers() + " share it";
    CGSize small = label(line, CGPoint::zero(), sub, Color::white(), ink, px(pad.x), px(pad.y), INFINITY, false);
    float w = std::max(big.width, small.width), h = big.height + px(0.004f) + small.height;
    // Origin: the middle of the big label.
    Vec2 offset{(w - big.width) / 2 / ppm, -((h - big.height) / 2 / ppm)};
    return piece("tag-o:" + tag.id, w, h, offset, [&](Canvas&, CGSize) {
        label(tag.name, CGPoint::zero(), f, ::ink(tag.kind), ::color(tag.kind), padX, padY);
        label(line, CGPoint{0, big.height + px(0.004f)}, sub, Color::white(1, 0.8f), ink, px(pad.x), px(pad.y));
    });
}

// MARK: - The path, the strip, the shelf

/// A step's number, on the first card of the layer you work on.
std::optional<Piece> Art::badge(int n, bool current) {
    float d = px(0.034f);
    return piece(fmt("badge:%d:%s", n, current ? "true" : "false"), d, d, [&](Canvas&, CGSize) {
        setFill(current ? hot : ::color(Tone::path));
        UIBezierPath::ovalIn(CGRect{0, 0, d, d}).fill();
        Font f = font(Size::lead, Font::Weight::bold);
        std::string s = std::to_string(n);
        CGSize size = stringSize(s, TextAttributes{.font = f});
        drawString(s, CGPoint{(d - size.width) / 2, (d - size.height) / 2}, attributes(f, current ? Color::white() : ::ink(Tone::path)));
    });
}

/// On a card that holds a folded layer: two sheets, one over the other.
std::optional<Piece> Art::foldBadge() {
    float d = px(0.034f);
    return piece("badge:fold", d, d, [&](Canvas& ctx, CGSize) {
        setFill(ink);
        UIBezierPath::ovalIn(CGRect{0, 0, d, d}).fill();
        float w = d * 0.4f, h = d * 0.27f;
        ctx.setStrokeColor(::color(Tone::path));
        ctx.setLineWidth(std::max(2.f, d * 0.055f));
        ctx.stroke(CGRect{d * 0.37f, d * 0.28f, w, h});
        setFill(::color(Tone::path));
        UIRectFill(CGRect{d * 0.23f, d * 0.45f, w, h});
    });
}

/// An earlier step of the path, as it shows from the layers above: its
/// number and a few words, large enough to read from there. The same
/// number-and-name the step cards carry.
std::optional<Piece> Art::stepLabel(int n, const std::string& words) {
    Font f = font(Size::lead, Font::Weight::semibold), nf = font(Size::lead, Font::Weight::bold);
    float padX = px(0.008f), padY = px(0.0055f);
    float h = std::ceil(f.lineHeight()) + 2 * padY;
    std::string number = std::to_string(n);
    float nw = std::max(stringSize(number, TextAttributes{.font = nf}).width + 2 * padX, h);
    CGSize name = label(words, CGPoint::zero(), f, Color::white(), ink, padX, padY, px(0.24f), false);
    return piece(fmt("step:%d:", n) + words, nw + name.width, h, [&](Canvas&, CGSize) {
        setFill(::color(Tone::path));
        UIRectFill(CGRect{0, 0, nw, h});
        CGSize ns = stringSize(number, TextAttributes{.font = nf});
        drawString(number, CGPoint{(nw - ns.width) / 2, padY}, attributes(nf, ::ink(Tone::path)));
        label(words, CGPoint{nw, 0}, f, Color::white(), ink, padX, padY, px(0.24f));
    });
}

// MARK: The welcome card (Quest)

namespace {
/// A rectangle with rounded corners, as a path (the canvas has lines and ovals: the corners are short lines).
UIBezierPath rounded(CGRect r, float radius) {
    UIBezierPath path;
    const float corners[4][3] = {{1, 1, 0}, {-1, 1, 90}, {-1, -1, 180}, {1, -1, 270}};
    bool first = true;
    for (const auto& [sx, sy, from] : corners) {
        for (int k = 0; k <= 10; k++) {
            float a = (from + float(k) * 9) * floatPi / 180;
            CGPoint p{r.midX() + sx * (r.size.width / 2 - radius) + std::cos(a) * radius, r.midY() + sy * (r.size.height / 2 - radius) + std::sin(a) * radius};
            if (first) path.move(p); else path.addLine(p);
            first = false;
        }
    }
    path.close();
    return path;
}
}

std::optional<Piece> Art::lettering(const std::string& word, float size, float ppm) {
    // As a title is set in Fraunces at this size: light, a little tight, in a white with some warmth in it.
    Font f = Font::systemFont(size * ppm, Font::Weight::display);
    TextAttributes look = attributes(f, Color::hex(0xFBF8EE), -0.028f * size * ppm);
    // (Room all round for what swings out past the letters' own boxes.)
    float pad = std::round(size * ppm * 0.3f), w = stringSize(word, look).width + 2 * pad, h = std::ceil(f.lineHeight()) + 2 * pad;
    return piece("lettering:" + word + fmt(":%g:%g", double(size), double(ppm)), w, h, ppm, [&](Canvas&, CGSize) {
        drawString(word, CGPoint{pad, pad}, look);
    });
}

std::optional<Piece> Art::plain(const std::string& words, float size, Font::Weight weight, float alpha, float ppm) {
    Font f = Font::systemFont(size * ppm, weight);
    TextAttributes look = attributes(f, Color::white(1, alpha));
    float w = stringSize(words, look).width, h = std::ceil(f.lineHeight());
    return piece("plain:" + words + fmt(":%g:%d:%g", double(size), int(weight), double(alpha)), w, h, ppm, [&](Canvas&, CGSize) {
        drawString(words, CGPoint{0, 0}, look);
    });
}

std::optional<Piece> Art::way(int number, const std::string& name, const std::string& note, float size, float ppm) {
    auto P = [&](float m) { return std::round(m * ppm); };
    Font nameFont = Font::systemFont(size * ppm, Font::Weight::semibold), noteFont = Font::systemFont(size * 0.72f * ppm, Font::Weight::medium);
    Font numberFont = Font::systemFont(size * 0.74f * ppm, Font::Weight::bold);
    TextAttributes nameLook = attributes(nameFont, Color::white()), noteLook = attributes(noteFont, Color::white(1, 0.78f));
    TextAttributes numberLook = attributes(numberFont, Color::white());
    std::string digit = std::to_string(number);
    float disc = P(size * 1.5f), gap = P(size * 0.5f), nameH = std::ceil(nameFont.lineHeight()), noteH = std::ceil(noteFont.lineHeight());
    float nameW = stringSize(name, nameLook).width, noteW = stringSize(note, noteLook).width;
    // The number and the name are one line, set in the middle; the line under them is in the middle too.
    float head = disc + gap + nameW, w = std::max(head, noteW), between = P(size * 0.38f), h = disc + between + noteH;
    return piece("way:" + name + note + fmt(":%d:%g", number, double(size)), w, h, ppm, [&](Canvas&, CGSize) {
        float left = (w - head) / 2;
        setFill(hot);
        UIBezierPath::ovalIn(CGRect{left, 0, disc, disc}).fill();
        drawString(digit, CGPoint{left + (disc - stringSize(digit, numberLook).width) / 2, (disc - std::ceil(numberFont.lineHeight())) / 2}, numberLook);
        drawString(name, CGPoint{left + disc + gap, (disc - nameH) / 2}, nameLook);
        drawString(note, CGPoint{(w - noteW) / 2, disc + between}, noteLook);
    });
}

std::optional<Piece> Art::pill(const std::string& words, float size, Color ground) {
    Font f = font(size, Font::Weight::semibold);
    TextAttributes look = attributes(f, Color::white());
    float h = std::ceil(f.lineHeight()) + 2 * px(size * 0.62f), w = stringSize(words, look).width + 2 * px(size * 1.5f);
    return piece("pill:" + words + fmt(":%g:%d", double(size), int(ground.r * 255)), w, h, [&](Canvas&, CGSize) {
        setFill(ground);
        rounded(CGRect{0, 0, w, h}, h / 2).fill();
        drawString(words, CGPoint{(w - stringSize(words, look).width) / 2, (h - std::ceil(f.lineHeight())) / 2}, look);
    });
}

std::optional<Piece> Art::iconButton(const std::string& icon, float size, Color ground, Color mark) {
    const std::vector<icons::Line>& lines = icon == "marker" ? icons::marker() : icon == "pencil" ? icons::pencil() : icon == "eraser" ? icons::eraser() : icons::send();
    float w = px(size);
    std::string key = "icon:" + icon + fmt(":%g:%d,%d,%d:%d,%d", double(size), int(ground.r * 255), int(ground.g * 255), int(ground.b * 255), int(mark.r * 255), int(mark.a * 100));
    return piece(key, w, w, [&](Canvas& ctx, CGSize) {
        setFill(ground);
        rounded(CGRect{0, 0, w, w}, w * 0.24f).fill();
        // The icon is 24 units square with a stroke of 2: here it takes three fifths of the button, as the pen
        // does in the diagram it comes from.
        float unit = w * 0.6f / 24, left = (w - 24 * unit) / 2;
        ctx.setStrokeColor(mark);
        ctx.setLineWidth(2 * unit);
        ctx.setLineCap(Canvas::LineCap::round);
        ctx.setLineJoin(Canvas::LineJoin::round);
        for (const icons::Line& line : lines) {
            for (size_t i = 0; i + 1 < line.xy.size(); i += 2) {
                CGPoint p{left + line.xy[i] * unit, left + line.xy[i + 1] * unit};
                if (i == 0) ctx.move(p); else ctx.addLine(p);
            }
            if (line.closed) ctx.closePath();
            ctx.strokePath();
        }
    });
}

/// Any one-line flat label.
std::optional<Piece> Art::line(const std::string& words, float size, Font::Weight weight, Color fg, Color bg, Vec2 pad) {
    Font f = font(size, weight);
    CGSize s = label(words, CGPoint::zero(), f, fg, bg, px(pad.x), px(pad.y), INFINITY, false);
    float r = bg.r, g = bg.g, b = bg.b, a = bg.a;
    float fr = fg.r, fgreen = fg.g, fb = fg.b, fa = fg.a;
    // Only a name to find the piece by again: its numbers are written as C writes them, not as Swift does.
    std::string key = "line:" + words + fmt(":%g:%g:%d,%d,%d:%d,%d:%g", double(size), double(rawValue(weight)), int(r * 255), int(g * 255),
                                            int(b * 255), int(fr * 255), int(fa * 100), double(pad.x));
    return piece(key, s.width, s.height, [&](Canvas&, CGSize) {
        label(words, CGPoint::zero(), f, fg, bg, px(pad.x), px(pad.y));
    });
}

/// A small heading in capitals on its color: it names the lines under it, once.
std::optional<Piece> Art::heading(const std::string& words, Tone tone) {
    Font f = font(Size::micro, Font::Weight::bold);
    float padX = px(pad.x), padY = px(pad.y), kern = px(0.0008f);
    float w = width(uppercased(words), f, kern) + 2 * padX, h = std::ceil(f.lineHeight()) + 2 * padY;
    return piece("heading:" + words + ":" + rawValue(tone), w, h, [&](Canvas&, CGSize) {
        setFill(::color(tone));
        UIRectFill(CGRect{0, 0, w, h});
        drawString(uppercased(words), CGPoint{padX, padY}, attributes(f, ::ink(tone), kern));
    });
}

/// The gardener's line you can pick: a brief, in quotes.
std::optional<Piece> Art::brief(const std::string& words) {
    Font f = font(Size::lead, Font::Weight::medium);
    float padX = px(0.012f), padY = px(0.009f), bar = px(0.005f);
    CGSize s = label(words, CGPoint::zero(), f, Color::white(), ink, padX, padY, INFINITY, false);
    return piece("brief:" + words, s.width + bar, s.height, [&](Canvas&, CGSize) {
        setFill(::color(Tone::question));
        UIRectFill(CGRect{0, 0, bar, s.height});
        label(words, CGPoint{bar, 0}, f, Color::white(), ink, padX, padY);
    });
}

/// One line under an open card that can be picked: a question for the gardener, or something to do.
std::optional<Piece> Art::row(const std::string& words) {
    return line(words, Size::label, Font::Weight::medium, Color::white(), Art::ink, Vec2{0.008f, 0.0055f});
}

/// An empty frame with a label: where a pressed tree lands on its way out.
std::optional<Piece> Art::tray(const std::string& words) {
    float w = px(0.2f), h = px(0.165f);
    return piece("tray:" + words, w, h, [&](Canvas& ctx, CGSize) {
        Font f = font(Size::micro, Font::Weight::semibold);
        float lh = label(words, CGPoint::zero(), f, ink, paper, px(pad.x), px(pad.y)).height;
        ctx.setStrokeColor(paper);
        ctx.setLineWidth(px(0.0018f));
        ctx.setLineDash(0, {px(0.008f), px(0.006f)});
        ctx.stroke(CGRect{px(0.001f), lh + px(0.001f), w - px(0.002f), h - lh - px(0.002f)});
    });
}

// MARK: - A pressed tree

/// What stands under a tree's cover on the shelf: its name, who made it,
/// and whether it has been sent, as flat labels side by side.
std::optional<Piece> Art::coverCaption(const std::string& title, Maker maker, bool sent) {
    float ppm = 1000;
    Font tf = Font::systemFont(40, Font::Weight::semibold), mf = Font::systemFont(26, Font::Weight::medium);
    float gap = 10;
    Color hot = Color::hex(0xFF5A36);
    CGSize t = label(title, CGPoint::zero(), tf, Color::white(), ink, 20, 12, 620, false);
    CGSize m = label(::label(maker), CGPoint::zero(), mf, ink, paper, 14, 8, INFINITY, false);
    CGSize s = sent ? label("Sent", CGPoint::zero(), mf, Color::white(), hot, 14, 8, INFINITY, false) : CGSize::zero();
    float width = t.width + gap + m.width + (sent ? gap + s.width : 0);
    return piece(std::nullopt, width, t.height, ppm, [&](Canvas&, CGSize) {
        label(title, CGPoint::zero(), tf, Color::white(), ink, 20, 12, 620);
        float x = t.width + gap;
        label(::label(maker), CGPoint{x, (t.height - m.height) / 2}, mf, ink, paper, 14, 8);
        x += m.width + gap;
        if (sent) label("Sent", CGPoint{x, (t.height - s.height) / 2}, mf, Color::white(), hot, 14, 8);
    });
}

/// Paints a tree's items into a box: threads first, then the least
/// important items, so the path's steps end on top.
void Art::paint(const std::vector<PressedItem>& items, float w, float h, Canvas& ctx, const std::shared_ptr<Catalog>& catalog) const {
    auto point = [&](int i) { return CGPoint{items[size_t(i)].center.x * w, items[size_t(i)].center.y * h}; };
    // Threads first, the path's the brightest.
    for (int i = 0; i < int(items.size()); i++) {
        const PressedItem& item = items[size_t(i)];
        if (!item.parent) continue;
        int p = *item.parent;
        bool onPath = item.step.has_value() && items[size_t(p)].step.has_value();
        ctx.setStrokeColor(onPath ? ::color(Tone::path) : Color::white(1, 0.22f));
        ctx.setLineWidth(onPath ? 5 : 1.5f);
        ctx.move(point(p));
        ctx.addLine(point(i));
        ctx.strokePath();
    }
    // The least important first, so the path ends on top.
    std::vector<int> order(items.size());
    std::iota(order.begin(), order.end(), 0);
    std::stable_sort(order.begin(), order.end(), [&](int a, int b) {
        return std::make_tuple(items[size_t(a)].step ? 1 : 0, items[size_t(a)].width, -a) <
               std::make_tuple(items[size_t(b)].step ? 1 : 0, items[size_t(b)].width, -b);
    });
    for (int i : order) {
        const PressedItem& item = items[size_t(i)];
        CGPoint c = point(i);
        float iw = item.width * w;
        switch (item.ref.kind) {
        case Ref::Kind::film: {
            int f = item.ref.index;
            const Clip& clip = clips[size_t(f)];
            CGRect rect{c.x - iw / 2, c.y - iw / clip.aspect / 2, iw, iw / clip.aspect};
            if (iw < 24) {
                setFill(Color::white(0.85f, 1));
                UIRectFill(CGRect{c.x - iw / 2, c.y - iw / 2, iw, iw});
            } else {
                still(clip, rect);
            }
            break;
        }
        case Ref::Kind::work: {
            int k = item.ref.index;
            if (!(k >= 0 && k < int(works().size()))) continue;
            const Work& work = works()[size_t(k)];
            if (iw < 24) {
                setFill(Color::white(0.85f, 1));
                UIRectFill(CGRect{c.x - iw / 2, c.y - iw / 2, iw, iw});
            } else {
                thumb(work, CGRect{c.x - iw / 2, c.y - iw / work.aspect / 2, iw, iw / work.aspect});
            }
            break;
        }
        case Ref::Kind::note: {
            auto found = catalog->notes.find(item.ref.id);
            if (found == catalog->notes.end()) continue;
            const OceanNote& note = found->second;
            if (iw < 24) {
                setFill(::color(note.tone));
                UIRectFill(CGRect{c.x - iw / 2, c.y - iw / 2, iw, iw});
                continue;
            }
            if (std::optional<int> f = note.stillFilm(); f && *f >= 0 && *f < int(clips.size())) {
                const Clip& clip = clips[size_t(*f)];
                still(clip, CGRect{c.x - iw / 2, c.y - iw / clip.aspect / 2, iw, iw / clip.aspect});
                continue;
            }
            CGRect rect{c.x - iw / 2, c.y - iw * 0.3f, iw, iw * 0.6f};
            setFill(ink);
            UIRectFill(rect);
            setFill(::color(note.tone));
            UIRectFill(CGRect{rect.minX(), rect.minY(), iw, std::max(3.f, iw * 0.03f)});
            float size = std::max(11.f, iw * 0.085f);
            text(note.headline, rect.insetBy(iw * 0.06f, iw * 0.075f), Font::systemFont(size, Font::Weight::semibold), Color::white(),
                 size * 1.2f);
            break;
        }
        case Ref::Kind::tag: {
            auto found = catalog->tags.find(item.ref.id);
            if (found == catalog->tags.end()) continue;
            const OceanTag& tag = found->second;
            if (iw < 24) {
                setFill(::color(tag.kind));
                UIRectFill(CGRect{c.x - iw / 2, c.y - iw / 2, iw, iw});
                continue;
            }
            Font f = Font::systemFont(std::max(13.f, iw * 0.11f), Font::Weight::semibold);
            CGSize s = label(tag.name, CGPoint::zero(), f, ::ink(tag.kind), ::color(tag.kind), f.pointSize * 0.5f, f.pointSize * 0.3f,
                             INFINITY, false);
            label(tag.name, CGPoint{c.x - s.width / 2, c.y - s.height / 2}, f, ::ink(tag.kind), ::color(tag.kind), f.pointSize * 0.5f,
                  f.pointSize * 0.3f);
            break;
        }
        }
    }
}

/// One layer of a tree as a small picture: the step, large, with what
/// hangs from it around it. For the stack of steps under the tree.
ImageRef Art::layerImage(const std::vector<PressedItem>& items, const std::shared_ptr<Catalog>& catalog) const {
    CGSize size{440, 250};
    UIGraphicsImageRendererFormat format;
    format.scale = 1;
    format.opaque = true;
    return UIGraphicsImageRenderer(size, format).image([&](Canvas& context) {
        setFill(Color::hex(0x161A21));
        UIRectFill(CGRect{CGPoint::zero(), size});
        paint(items, size.width, size.height, context, catalog);
    });
}

/// One step of the path as a picture that fills its card: the layer's
/// first card, as large as it goes. A film or a picture fills the frame;
/// a note is its headline; a tag is its label. `more` is how many other
/// cards the layer holds.
ImageRef Art::stepImage(const Ref& ref, const std::shared_ptr<Catalog>& catalog, int more) const {
    CGSize size{440, 250};
    UIGraphicsImageRendererFormat format;
    format.scale = 1;
    format.opaque = true;
    return UIGraphicsImageRenderer(size, format).image([&](Canvas& context) {
        setFill(ink);
        UIRectFill(CGRect{CGPoint::zero(), size});
        auto fill = [&](float aspect, const std::function<void(CGRect)>& draw) {
            // Fill the frame, cropping what doesn't fit.
            float scale = std::max(size.width / aspect, size.height);
            float w = scale * aspect, h = scale;
            context.saveGState();
            context.clip(CGRect{CGPoint::zero(), size});
            draw(CGRect{(size.width - w) / 2, (size.height - h) / 2, w, h});
            context.restoreGState();
        };
        switch (ref.kind) {
        case Ref::Kind::film: {
            int f = ref.index;
            const Clip& clip = clips[size_t(f)];
            fill(clip.aspect, [&](CGRect rect) { still(clip, rect); });
            break;
        }
        case Ref::Kind::work: {
            int k = ref.index;
            if (!(k >= 0 && k < int(works().size()))) break;
            const Work& work = works()[size_t(k)];
            fill(work.aspect, [&](CGRect rect) {
                if (ImageRef image = picture(work, 520)) drawImage(image, rect); else thumb(work, rect);
            });
            break;
        }
        case Ref::Kind::note: {
            auto found = catalog->notes.find(ref.id);
            if (found == catalog->notes.end()) break;
            const OceanNote& note = found->second;
            if (std::optional<int> f = note.stillFilm(); f && *f >= 0 && *f < int(clips.size())) {
                fill(clips[size_t(*f)].aspect, [&](CGRect rect) { still(clips[size_t(*f)], rect); });
            } else if (ImageRef image = note.image ? picture(*note.image) : nullptr) {
                fill(float(image->width) / float(image->height), [&](CGRect rect) { drawImage(image, rect); });
            } else {
                setFill(::color(note.tone));
                UIRectFill(CGRect{0, 0, size.width, 9});
                Font kicker = Font::systemFont(19, Font::Weight::bold);
                drawString(uppercased(note.kicker), CGPoint{30, 34}, attributes(kicker, ::color(note.tone), 1.6f));
                text(note.headline, CGRect{30, 70, size.width - 60, 150}, Font::systemFont(37, Font::Weight::semibold), Color::white(), 46);
            }
            break;
        }
        case Ref::Kind::tag: {
            auto found = catalog->tags.find(ref.id);
            if (found == catalog->tags.end()) break;
            const OceanTag& tag = found->second;
            Font f = Font::systemFont(44, Font::Weight::semibold);
            CGSize s = label(tag.name, CGPoint::zero(), f, ::ink(tag.kind), ::color(tag.kind), 24, 14, size.width - 60, false);
            label(tag.name, CGPoint{(size.width - s.width) / 2, (size.height - s.height) / 2}, f, ::ink(tag.kind), ::color(tag.kind), 24, 14,
                  size.width - 60);
            break;
        }
        }
        if (more > 0) {
            // How much else lies on the layer, in a corner.
            Font f = Font::systemFont(22, Font::Weight::semibold);
            std::string words = fmt("+%d", more);
            CGSize s = label(words, CGPoint::zero(), f, Color::white(), ink, 12, 7, INFINITY, false);
            label(words, CGPoint{size.width - s.width, size.height - s.height}, f, Color::white(), ink, 12, 7);
        }
    });
}

/// The same picture, out of focus: how a card under glass looks.
ImageRef Art::blurred(const ImageRef& image) const {
    if (!image) return image;
    ImageRef soft = gaussianBlur(image, 7);
    if (!soft) return image;
    return soft;
}

// MARK: - Meshes and materials

Material Art::material(const TextureRef& texture, float white) const {
    Material m = Material::unlit(Color::white());
    m.color = Color::white(white, 1);
    m.texture = texture;
    m.transparent = true;
    m.opacity = 1.0f;
    m.opacityThreshold = 0.5f;
    return m;
}

/// A flat rectangle showing a piece, set where the piece belongs.
EntityRef Art::quad(const Piece& piece) const {
    EntityRef e = Entity::make(Mesh::generatePlane(piece.size.x, piece.size.y), {material(piece.texture)});
    e->position = {piece.offset.x, piece.offset.y, 0};
    return e;
}

/// Shows the same piece dimmer (a suggestion) or at full brightness, never see-through.
void Art::shade(const EntityRef& quad, const TextureRef& texture, float dim) const {
    if (quad->model) quad->model->materials = {material(texture, 1 - 0.45f * dim)};
}

Material Art::atlasMaterial() {
    if (atlasLook) return *atlasLook;
    Material m = Material::unlit(Color::white());
    m.color = Color::white();
    m.texture = sized(atlasTexture);
    atlasLook = m;
    return m;
}

/// A picture read at the size it shows. An atlas keeps every picture at
/// each smaller size as well; drawn small (a piece on the ocean, some
/// twenty pixels wide), it is read from the copy nearest that size, a
/// few texels a pixel, not from the full one, which costs the GPU
/// more and shimmers. Said here outright, so it doesn't rest on a default.
TextureRef Art::sized(const TextureRef& texture) {
    // NOTE(port): the Swift builds a sampler here (linear between texels and between sizes, clamped
    // at the edges). The renderer reads every texture that way already, so there is nothing to set.
    return texture;
}

/// A rectangle showing one film's still, cut from the atlas.
MeshRef Art::stillMesh(const Clip& clip, Vec2 size) const {
    const std::vector<int>& t = clip.tile;
    float W = atlasSize.x / stillScale, H = atlasSize.y / stillScale;
    float u0 = float(t[0]) / W, u1 = float(t[0] + t[2]) / W;
    float v1 = 1 - float(t[1]) / H, v0 = 1 - float(t[1] + t[3]) / H;
    float x = size.x / 2, y = size.y / 2;
    return Mesh::generate({{-x, -y, 0}, {x, -y, 0}, {x, y, 0}, {-x, y, 0}}, {Vec2(u0, v0), Vec2(u1, v0), Vec2(u1, v1), Vec2(u0, v1)},
                          {0, 1, 2, 0, 2, 3});
}
