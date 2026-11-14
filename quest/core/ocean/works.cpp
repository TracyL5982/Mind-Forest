// Port of visionos/MindPalace/Ocean/Works.swift: the part of Art that draws museum works.
// (Its declarations are in art.h.)
#include "art.h"

#include <algorithm>

#include "../platform.h"

// Museum works: the ocean's other kind of piece. A work is a still picture
// with what the museum knows of it. Small, it is drawn like a film; open,
// its picture is its own full-size texture, so it can be looked into.

/// Takes the works' atlas: every work small, in one picture.
void Art::hold(const std::shared_ptr<WorkLibrary>& library) {
    workLibrary = library;
    ImageRef image = platform::loadImage(library->atlasURL);
    if (!image) return;
    workAtlas = image;
    workAtlasTexture = Texture::make(image, true);
}

/// A work's place in the atlas, in the atlas picture's own pixels.
std::optional<CGRect> Art::tile(const Work& work) const {
    if (!workLibrary || !workAtlas) return std::nullopt;
    const std::shared_ptr<WorkLibrary>& library = workLibrary;
    float k = float(workAtlas->width) / library->atlasSize.x;
    return CGRect{float(work.tile[0]) * k, float(work.tile[1]) * k, float(work.tile[2]) * k, float(work.tile[3]) * k};
}

/// Draws a work from the atlas: quick, and only good small.
void Art::thumb(const Work& work, CGRect rect) const {
    std::optional<CGRect> crop = tile(work);
    ImageRef image = crop ? cropping(workAtlas, *crop) : nullptr;
    if (!image) {
        setFill(Color::hex(0x20252E));
        UIRectFill(rect);
        return;
    }
    drawImage(image, rect);
}

/// A work's picture read from its own file, no larger than `pixels` on its long side.
ImageRef Art::picture(const Work& work, int pixels) const {
    if (!workLibrary) return nullptr;
    // NOTE(port): changed for Quest: from a small copy where one will do (see `pictureSource`).
    Source source = pictureSource(work, pixels);
    if (source.url.empty()) return nullptr;
    return read(source.url, source.maxPixel > 0 ? std::optional<int>(source.maxPixel) : std::nullopt);
}

Art::Source Art::pictureSource(const Work& work, int pixels) const {
    if (!workLibrary) return {};
    if (pixels <= 520) {
        // "full/<id>.heic" has a small copy at "works-small/<id>.jpg".
        size_t slash = work.file.find_last_of('/'), dot = work.file.find_last_of('.');
        std::string name = work.file.substr(slash == std::string::npos ? 0 : slash + 1,
                                            dot == std::string::npos || (slash != std::string::npos && dot < slash) ? std::string::npos
                                                                                                                        : dot - (slash == std::string::npos ? 0 : slash + 1));
        std::string small = platform::resourcePath("works-small/" + name + ".jpg");
        if (!small.empty()) return {small, pixels >= 512 ? 0 : pixels};
    }
    return {workLibrary->fullURL(work), pixels};
}

ImageRef Art::read(const std::string& url, std::optional<int> pixels) {
    // NOTE(port): ImageIO's two ways of reading (the whole picture, or a thumbnail no larger than
    // `pixels`, turned upright) are platform::loadImage with and without a `maxPixel`.
    if (!pixels) return platform::loadImage(url);
    return platform::loadImage(url, *pixels);
}

/// Draws a work from its file where there is one, from the atlas otherwise.
void Art::drawPicture(const Work& work, CGRect rect) const {
    if (ImageRef image = picture(work, int(std::ceil(std::max(rect.width(), rect.height()))))) {
        drawImage(image, rect);
    } else {
        thumb(work, rect);
    }
}

/// The work's picture at full size, read and made off the main thread's time.
TextureRef Art::fullTexture(const Work& work) const {
    // NOTE(port): `async` in the Swift, which reads the file on another thread. Here it is read
    // where it is asked for, on the frame thread: a frame waits while a 1600 px picture decodes.
    if (!workLibrary) return nullptr;
    const std::shared_ptr<WorkLibrary>& library = workLibrary;
    std::string url = library->fullURL(work);
    ImageRef image = read(url, std::nullopt);
    if (!image) return nullptr;
    return Texture::make(image, true);
}

bool Art::fullReady(const Work& work) const {
    if (!workLibrary) return true;
    std::string url = workLibrary->fullURL(work);
    if (url.empty() || platform::imageReady(url, 0)) return true;
    platform::prefetchImage(url, 0);
    return false;
}

bool Art::smallReady(const Work& work) const {
    if (!workLibrary) return true;
    // The size `workSmall` asks `drawPicture` for, from where `picture` will read it.
    Vec2 s = workPicture(work, false);
    Source source = pictureSource(work, int(std::ceil(std::max(px(s.x), px(s.y)))));
    if (source.url.empty() || platform::imageReady(source.url, source.maxPixel)) return true;
    platform::prefetchImage(source.url, source.maxPixel);
    return false;
}

// MARK: Sizes

/// A work's picture, m. Works come in every shape, so each is given the
/// same area and keeps its own proportions, within what a card can be.
Vec2 Art::workPicture(const Work& work, bool open) const {
    return open ? Metrics::work(Metrics::openWorkArea, work.aspect, 0.5f, 0.44f)
                : Metrics::work(Metrics::smallWorkArea, work.aspect, 0.19f, 0.165f);
}

/// The open card's top part: the picture, on a dark mount where it is
/// narrower than its caption needs.
Vec2 Art::workOpenBody(const Work& work) const {
    Vec2 p = workPicture(work, true);
    return {std::max(p.x, Metrics::openWorkMinWidth), p.y};
}

// MARK: Cards

/// A work, small: its picture and a few words. Origin: the picture's middle.
std::optional<Piece> Art::workSmall(const Work& work) {
    Vec2 s = workPicture(work, false);
    float pw = px(s.x), ph = px(s.y);
    Font titleFont = font(Size::label, Font::Weight::medium);
    float padX = px(pad.x), padY = px(pad.y);
    float limit = px(0.25f);
    CGSize title = label(work.short_, CGPoint::zero(), titleFont, Color::white(), ink, padX, padY, limit, false);
    float w = std::max(pw, title.width);
    float h = ph + px(0.006f) + title.height;
    Vec2 offset{(w - pw) / 2 / ppm, -((h - ph) / 2 / ppm)};
    return piece(fmt("work-s:%d", work.index), w, h, offset, [&](Canvas&, CGSize) {
        drawPicture(work, CGRect{0, 0, pw, ph});
        label(work.short_, CGPoint{0, ph + px(0.006f)}, titleFont, Color::white(), ink, padX, padY, limit);
    });
}

/// What sits under an open work: why it is here and where it is kept,
/// its title, then who made it and when, where, and of what.
std::optional<Piece> Art::workCaption(const Work& work, const std::string& why, Tone tone) {
    Vec2 body = workOpenBody(work);
    float w = px(body.x), h = px(Metrics::workCaption);
    float pad = px(0.014f);
    Font titleFont = font(Size::lead, Font::Weight::semibold), kickerFont = font(Size::micro, Font::Weight::bold),
         bodyFont = font(Size::body, Font::Weight::regular);
    Vec2 offset{0, -body.y / 2 - Metrics::workCaption / 2};
    return piece(std::nullopt, w, h, offset, [&](Canvas&, CGSize) {
        setFill(ink);
        UIRectFill(CGRect{0, 0, w, h});
        setFill(::color(tone));
        UIRectFill(CGRect{0, 0, w, px(0.004f)});
        float y = px(0.015f);
        float kern = px(0.0009f);
        // Where it is kept, at the right; why it is here, in the room that leaves.
        std::string museum = uppercased(work.museum);
        float mw = width(museum, kickerFont, kern);
        drawString(museum, CGPoint{w - pad - mw, y}, attributes(kickerFont, Color::white(1, 0.55f), kern));
        if (!why.empty()) {
            CGRect room{pad, y, w - 2 * pad - mw - px(0.012f), std::ceil(kickerFont.lineHeight())};
            drawString(uppercased(why), room, usesLineFragmentOrigin | truncatesLastVisibleLine,
                       attributes(kickerFont, ::color(tone), kern, std::nullopt, true));
        }
        y += px(0.017f);
        float titleLine = px(0.0205f);
        y += text(work.title, CGRect{pad, y, w - 2 * pad, titleLine * 2}, titleFont, Color::white(), titleLine) + px(0.005f);
        float bodyLine = px(0.0176f);
        // `[work.maker, work.when].filter { !$0.isEmpty }.joined(separator: " · ")`
        auto joined = [](const std::vector<std::string>& parts) {
            std::string out;
            for (const std::string& part : parts) {
                if (part.empty()) continue;
                if (!out.empty()) out += " · ";
                out += part;
            }
            return out;
        };
        std::string who = joined({work.maker, work.when()});
        std::string what = joined({work.place, work.medium});
        for (const std::string& line : {who, what}) {
            if (line.empty()) continue;
            drawString(line, CGRect{pad, y, w - 2 * pad, bodyLine}, usesLineFragmentOrigin | truncatesLastVisibleLine,
                       attributes(bodyFont, Color::white(1, line == who ? 0.82f : 0.6f), 0, std::nullopt, true));
            y += bodyLine;
        }
    });
}

/// How wide the picture is on a work lifted for a look, m.
float Art::workPeekWidth(const Work& work) const { return Metrics::work(0.2f * 0.125f, work.aspect, 0.22f, 0.19f).x; }

/// A work lifted out of the ocean far enough to see what it is: picture,
/// title, when and by whom, and its tags. Origin: the picture's middle.
std::optional<Piece> Art::workPeek(const Work& work, const std::vector<OceanTag>& tags) {
    Vec2 s = Metrics::work(0.2f * 0.125f, work.aspect, 0.22f, 0.19f);
    float pw = px(s.x), ph = px(s.y);
    float w = std::max(pw, px(0.24f));
    Font titleFont = font(Size::body, Font::Weight::semibold), metaFont = font(Size::micro, Font::Weight::regular),
         tagFont = font(Size::micro, Font::Weight::semibold);
    float padX = px(pad.x), padY = px(pad.y), gap = px(0.003f);
    float rowHeight = std::ceil(tagFont.lineHeight()) + 2 * padY;
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
    std::string meta;
    for (const std::string& part : {work.when(), work.maker.empty() ? work.place : work.maker, work.museum}) {
        if (part.empty()) continue;
        if (!meta.empty()) meta += " · ";
        meta += part;
    }
    float titleHeight = std::ceil(titleFont.lineHeight()) + 2 * padY, metaHeight = std::ceil(metaFont.lineHeight()) + 2 * padY;
    float h = ph + px(0.006f) + titleHeight + gap + metaHeight + gap + float(rows.size()) * (rowHeight + gap);
    Vec2 offset{(w - pw) / 2 / ppm, -((h - ph) / 2 / ppm)};
    return piece(fmt("work-peek:%d", work.index), w, h, offset, [&](Canvas&, CGSize) {
        drawPicture(work, CGRect{0, 0, pw, ph});
        float y = ph + px(0.006f);
        y += label(work.title, CGPoint{0, y}, titleFont, Color::white(), ink, padX, padY, w).height + gap;
        y += label(meta, CGPoint{0, y}, metaFont, Color::white(1, 0.75f), ink, padX, padY, w).height + gap;
        for (const std::vector<OceanTag>& row : rows) {
            float x = 0;
            for (const OceanTag& tag : row) {
                x += label(tag.name, CGPoint{x, y}, tagFont, ::ink(tag.kind), ::color(tag.kind), padX, padY).width + gap;
            }
            y += rowHeight + gap;
        }
    });
}

// MARK: Meshes

std::optional<Material> Art::workAtlasMaterial() {
    if (workMaterial) return workMaterial;
    if (!workAtlasTexture) return std::nullopt;
    Material m = Material::unlit(Color::white());
    m.color = Color::white();
    m.texture = Art::sized(workAtlasTexture);
    workMaterial = m;
    return m;
}

/// A rectangle showing one work, cut from the atlas.
MeshRef Art::workMesh(const Work& work, Vec2 size) const {
    if (!workLibrary) return nullptr;
    const std::shared_ptr<WorkLibrary>& library = workLibrary;
    const std::vector<int>& t = work.tile;
    float W = library->atlasSize.x, H = library->atlasSize.y;
    // Half a pixel in from each edge, so a neighbor never bleeds in.
    float u0 = (float(t[0]) + 0.5f) / W, u1 = (float(t[0] + t[2]) - 0.5f) / W;
    float v1 = 1 - (float(t[1]) + 0.5f) / H, v0 = 1 - (float(t[1] + t[3]) - 0.5f) / H;
    float x = size.x / 2, y = size.y / 2;
    return Mesh::generate({{-x, -y, 0}, {x, -y, 0}, {x, y, 0}, {-x, y, 0}}, {Vec2(u0, v0), Vec2(u1, v0), Vec2(u1, v1), Vec2(u0, v1)},
                          {0, 1, 2, 0, 2, 3});
}

/// A plain picture, as an open work shows it.
Material Art::pictureMaterial(const TextureRef& texture) const {
    Material m = Material::unlit(Color::white());
    m.color = Color::white();
    m.texture = texture;
    return m;
}
