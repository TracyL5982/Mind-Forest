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
    /// Pixels to a web px, small.
    float smallK = 0;
    Vec2 small, open;
    /// A page, and the tallest picture on it, web px.
    float pageTall = 0, pictureTall = INFINITY;
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
    s.smallK = std::min(Metrics::smallNoteWidth / float(f->width), smallCeiling / float(f->height)) * Art::ppm;
    s.small = {std::ceil(float(f->width) * s.smallK) / Art::ppm, std::ceil(float(f->height) * s.smallK) / Art::ppm};
    s.open = Catalog::openSize(noteKind(kind->opens), false, aspect);
    s.pageTall = s.open.y * Art::ppm / openScale;
    if (kind->opens == Kind::Opens::picture) s.pictureTall = Catalog::pictureSize(aspect).y * Art::ppm / openScale;
    return &s;
}

std::map<std::string, int>& shownPage() {
    static std::map<std::string, int> all;
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

bool seat(const std::string& noteID, const Node& node) {
    auto piece = pieces().find(noteID);
    return piece != pieces().end() && put(noteID, piece->second.view, piece->second.item, node);
}

std::optional<Opened> opened(const std::string& noteID, float k) {
    const Shown* s = shownOf(noteID);
    if (!s) return std::nullopt;
    return cards::opened(noteID, k, s->pageTall, s->pictureTall);
}

std::optional<Vec2> smallSize(const std::string& noteID) {
    const Shown* s = shownOf(noteID);
    return s ? std::optional(s->small) : std::nullopt;
}

std::optional<Piece> small(Art& art, const std::string& noteID) {
    const Shown* s = shownOf(noteID);
    std::optional<Drawn> d = s ? cards::small(noteID, s->smallK) : std::nullopt;
    if (!d) return std::nullopt;
    return face(art, noteID, d->key, d->size, d->draw);
}

std::optional<Vec2> openSize(const std::string& noteID) {
    const Shown* s = shownOf(noteID);
    return s ? std::optional(s->open) : std::nullopt;
}

std::optional<Piece> corners(Art& art, Vec2 size) {
    float w = std::round(size.x * Art::ppm), h = std::round(size.y * Art::ppm);
    return art.piece(fmt("card-corners:%gx%g", double(w), double(h)), w, h, [&](Canvas& ctx, CGSize) {
        Pen{ctx, 1}.mask(CGRect{0, 0, w, h}, 14 * openScale, palette::glass);
    });
}

int pages(const std::string& noteID) {
    std::optional<Opened> o = opened(noteID);
    return o ? int(o->pages.size()) : 0;
}

int page(const std::string& noteID) {
    int count = pages(noteID);
    auto it = shownPage().find(noteID);
    return it == shownPage().end() || count == 0 ? 0 : std::min(it->second, count - 1);
}

void turn(const std::string& noteID) {
    int count = pages(noteID);
    if (count > 1) shownPage()[noteID] = (page(noteID) + 1) % count;
}

std::optional<NoteLayout> layout(const std::string& noteID) {
    std::optional<Opened> o = opened(noteID);
    if (!o) return std::nullopt;
    int p = page(noteID);
    const Opened::Page& shown = o->pages[size_t(p)];
    NoteLayout layout{o->size};
    layout.picture = shown.picture;
    // A piece's picture is drawn whole inside its frame: its film plays, and a hand marks it, where it is.
    if (auto piece = pieces().find(noteID); layout.picture && piece != pieces().end() && piece->second.aspect) {
        layout.picture = contained(*layout.picture, *piece->second.aspect);
    }
    for (const Run& run : shown.runs) layout.blocks.push_back(std::make_shared<TextBlock>(run.text, run.at, run.width, run.lines, run.attributes));
    layout.draw.push_back([draw = o->draw, p](Canvas& ctx) { draw(ctx, p); });
    return layout;
}

std::optional<Piece> open(Art& art, const std::string& noteID, std::optional<int> page) {
    std::optional<Opened> o = opened(noteID);
    if (!o) return std::nullopt;
    int p = std::clamp(page.value_or(ocean::page(noteID)), 0, int(o->pages.size()) - 1);
    return face(art, noteID, o->key + "/" + std::to_string(p), o->size, [&](Canvas& ctx) { o->draw(ctx, p); });
}

}  // namespace cards::ocean
