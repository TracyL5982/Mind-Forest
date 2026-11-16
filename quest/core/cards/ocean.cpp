#include "ocean.h"

#include <map>

#include "../ocean/catalog.h"
#include "media.h"
#include "pieces.h"

namespace cards::ocean {

namespace {

/// Weakly, so the scene's catalog, and the textures its drawing keeps, are not let go after the renderer at exit.
std::weak_ptr<const Catalog>& held() {
    static std::weak_ptr<const Catalog> catalog;
    return catalog;
}

/// The cards made of the held catalog's pieces, by note.
std::map<std::string, OceanCard>& pieces() {
    static std::map<std::string, OceanCard> all;
    return all;
}

OceanNote::Kind noteKind(Kind::Opens opens) {
    switch (opens) {
    case Kind::Opens::text: return OceanNote::Kind::text;
    case Kind::Opens::chart: return OceanNote::Kind::chart;
    case Kind::Opens::link: return OceanNote::Kind::link;
    case Kind::Opens::picture: return OceanNote::Kind::image;
    }
    return OceanNote::Kind::text;
}

/// How a card shows in the ocean: worked out once for each time it is put.
struct Shown {
    int generation = 0;
    Vec2 small, open;
    /// The opened card's frame, and the tallest picture in it, web px.
    float viewTall = 0, pictureTall = INFINITY;
};

const Shown* shownOf(const std::string& noteID) {
    static std::map<std::string, Shown> all;
    int now = generation(noteID);
    if (!now) return nullptr;
    Shown& s = all[noteID];
    if (s.generation == now) return &s;
    std::optional<Footprint> f = footprintOf(noteID);
    const Kind* kind = kindOf(noteID);
    if (!(f && kind && f->width > 0)) return nullptr;
    auto piece = pieces().find(noteID);
    float aspect = piece != pieces().end() && piece->second.aspect ? *piece->second.aspect : pictureAspect(noteID).value_or(1.35f);
    s = Shown{now};
    s.small = {float(f->width) * smallScale / Art::ppm, float(f->height) * smallScale / Art::ppm};
    // A text, chart or link card opens to the 46 by 37.2 cm box; a picture keeps the ocean's picture rule.
    s.open = kind->opens == Kind::Opens::picture ? Catalog::openSize(noteKind(kind->opens), false, aspect)
                                                 : Vec2{Metrics::openNoteWidth, OPEN_TALL * openScale / Art::ppm};
    s.viewTall = s.open.y * Art::ppm / openScale;
    if (kind->opens == Kind::Opens::picture) s.pictureTall = Catalog::pictureSize(aspect).y * Art::ppm / openScale;
    return &s;
}

/// How far each open card's panel is scrolled, px from its top.
std::map<std::string, float>& scrolled() {
    static std::map<std::string, float> all;
    return all;
}

/// A face of a note's card, kept by `key`. Those of an older drawing of the card are let go when one of a newer is made.
std::optional<Piece> face(Art& art, const std::string& noteID, const std::string& key, CGSize size, const std::function<void(Canvas&)>& draw) {
    struct Made {
        int revision = 0;
        std::vector<std::string> keys;
    };
    static std::map<std::string, Made> all;
    Made& made = all[noteID];
    if (int now = revision(noteID); now != made.revision) {
        for (const std::string& old : made.keys) art.forget(old);
        made = Made{now, {}};
    }
    if (std::find(made.keys.begin(), made.keys.end(), key) == made.keys.end()) made.keys.push_back(key);
    return art.piece(key, size.width, size.height, [&](Canvas& ctx, CGSize) { draw(ctx); });
}

}  // namespace

void hold(const std::shared_ptr<const Catalog>& catalog) { held() = catalog; }

std::optional<std::string> cardOf(const Ref& ref) {
    std::string id = ref.kind == Ref::Kind::note ? ref.id : ref.key();
    if (has(id)) return id;
    std::shared_ptr<const Catalog> catalog = held().lock();
    std::optional<OceanCard> card = catalog ? oceanCard(*catalog, ref) : std::nullopt;
    if (!card) return std::nullopt;
    put(card->id, card->view, card->item);
    pieces()[card->id] = *card;
    return card->id;
}

bool composing(const std::string& noteID) {
    const Kind* kind = kindOf(noteID);
    return kind && std::string(kind->name) == "composing";
}

bool seat(const std::string& noteID, const Node& node) {
    auto piece = pieces().find(noteID);
    return piece != pieces().end() && put(noteID, piece->second.view, piece->second.item, node);
}

std::optional<Opened> opened(const std::string& noteID, float k) {
    const Shown* s = shownOf(noteID);
    if (!s) return std::nullopt;
    return cards::opened(noteID, k, s->viewTall, s->pictureTall);
}

std::optional<Vec2> smallSize(const std::string& noteID) {
    const Shown* s = shownOf(noteID);
    return s ? std::optional(s->small) : std::nullopt;
}

std::optional<Piece> small(Art& art, const std::string& noteID) {
    const Shown* s = shownOf(noteID);
    std::optional<Drawn> d = s ? cards::small(noteID, smallScale) : std::nullopt;
    if (!d) return std::nullopt;
    return face(art, noteID, d->key, d->size, d->draw);
}

std::optional<Piece> frame(Art& art, const std::string& noteID) {
    const Shown* s = shownOf(noteID);
    std::optional<Drawn> d = s ? cards::frame(noteID, smallScale) : std::nullopt;
    if (!d) return std::nullopt;
    return face(art, noteID, d->key, d->size, d->draw);
}

std::optional<Vec2> openSize(const std::string& noteID) {
    const Shown* s = shownOf(noteID);
    return s ? std::optional(s->open) : std::nullopt;
}

std::optional<float> smallRadius(const std::string& noteID) {
    const Kind* kind = kindOf(noteID);
    return kind ? std::optional(kind->radius * smallScale / Art::ppm) : std::nullopt;
}

std::optional<Piece> corners(Art& art, Vec2 size) {
    float w = std::round(size.x * Art::ppm), h = std::round(size.y * Art::ppm);
    return art.piece(fmt("card-corners:%gx%g", double(w), double(h)), w, h, [&](Canvas& ctx, CGSize) {
        Pen{ctx, 1}.mask(CGRect{0, 0, w, h}, 14 * openScale, palette::glass);
    });
}

float overflow(const std::string& noteID) {
    std::optional<Opened> o = opened(noteID);
    return o ? std::max(0.f, (o->contentTall - o->size.height) / openScale) : 0;
}

float scroll(const std::string& noteID) {
    auto it = scrolled().find(noteID);
    return it == scrolled().end() ? 0 : it->second;
}

bool scrollTo(const std::string& noteID, float offset) {
    float to = std::clamp(offset, 0.f, overflow(noteID)), was = scroll(noteID);
    scrolled()[noteID] = to;
    return std::fabs(to - was) > 0.01f;
}

std::optional<NoteLayout> layout(const std::string& noteID) {
    std::optional<Opened> o = opened(noteID);
    if (!o) return std::nullopt;
    float off = scroll(noteID) * openScale, top = o->window.minY() + off, bottom = o->window.maxY() + off;
    NoteLayout layout{o->size};
    // A picture can be marked, and its film plays, only while all of it is in view at the top.
    if (o->picture && off < 0.5f && o->picture->maxY() <= bottom) {
        layout.picture = o->picture;
        if (auto piece = pieces().find(noteID); piece != pieces().end() && piece->second.aspect) {
            layout.picture = contained(*layout.picture, *piece->second.aspect);
        }
    }
    for (const Run& run : o->runs) {
        if (run.at.y < top - 1 || run.at.y >= bottom) continue;
        CGPoint at{run.at.x, run.at.y - off};
        layout.blocks.push_back(std::make_shared<TextBlock>(run.text, at, run.width, run.lines, run.attributes));
    }
    return layout;
}

std::optional<Piece> open(Art& art, const std::string& noteID) {
    std::optional<Opened> o = opened(noteID);
    if (!o) return std::nullopt;
    return face(art, noteID, o->key, o->size, o->frame);
}

std::optional<Piece> panel(Art& art, const std::string& noteID) {
    std::optional<Opened> o = opened(noteID);
    if (!o) return std::nullopt;
    return face(art, noteID, o->key + "/panel", CGSize{o->size.width, o->contentTall}, o->content);
}

void showPanel(const EntityRef& quad, const std::string& noteID) {
    std::optional<Opened> o = opened(noteID);
    if (!(quad && quad->model && o)) return;
    const CGRect& w = o->window;
    float off = scroll(noteID) * openScale, tall = std::max(1.f, o->contentTall);
    float hw = w.width() / 2 / Art::ppm, hh = w.height() / 2 / Art::ppm;
    Vec2 c{(w.midX() - o->size.width / 2) / Art::ppm, (o->size.height / 2 - w.midY()) / Art::ppm};
    float u0 = w.minX() / o->size.width, u1 = w.maxX() / o->size.width;
    float vTop = 1 - (w.minY() + off) / tall, vBottom = 1 - (w.maxY() + off) / tall;
    std::vector<Vec3> positions{{c.x - hw, c.y - hh, 0}, {c.x + hw, c.y - hh, 0}, {c.x + hw, c.y + hh, 0}, {c.x - hw, c.y + hh, 0}};
    std::vector<Vec2> uvs{{u0, vBottom}, {u1, vBottom}, {u1, vTop}, {u0, vTop}};
    // A bent card shows its own mesh in place of the flat one: that is given a new flat one, which it bends again.
    if (quad->model->mesh && !quad->model->mesh->isLowLevel()) {
        quad->model->mesh->replace(std::move(positions), std::move(uvs), {0, 1, 2, 0, 2, 3});
    } else {
        quad->model->mesh = Mesh::generate(std::move(positions), std::move(uvs), {0, 1, 2, 0, 2, 3});
    }
}

void showIndicator(const EntityRef& bar, const std::string& noteID) {
    std::optional<Opened> o = opened(noteID);
    if (!(bar && o)) return;
    float most = overflow(noteID);
    bar->isEnabled = most > 0;
    if (most <= 0) return;
    // 4 px wide inside the right edge, on a track 12 px from the top and the foot; the thumb is the share in view.
    float track = o->size.height - 2 * INDICATOR_END * openScale, view = o->window.height();
    float tall = std::max(track * view / (view + most * openScale), 16 * openScale);
    float y = INDICATOR_END * openScale + (track - tall) * (scroll(noteID) / most);
    bar->scale = {1, tall / Art::ppm / INDICATOR_UNIT, 1};
    bar->position = {(o->size.width / 2 - (INDICATOR_EDGE + INDICATOR_WIDE / 2) * openScale) / Art::ppm,
                     (o->size.height / 2 - y - tall / 2) / Art::ppm, 0.0006f};
}

}  // namespace cards::ocean
