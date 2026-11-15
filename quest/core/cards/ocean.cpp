#include "ocean.h"

#include <map>

#include "../ocean/catalog.h"

namespace cards::ocean {

namespace {

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
    float aspect = pictureAspect(noteID).value_or(1.35f);
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

}  // namespace

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
    return art.piece(d->key, d->size.width, d->size.height, [&](Canvas& ctx, CGSize) { d->draw(ctx); });
}

std::optional<Vec2> openSize(const std::string& noteID) {
    const Shown* s = shownOf(noteID);
    return s ? std::optional(s->open) : std::nullopt;
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
    for (const Run& run : shown.runs) layout.blocks.push_back(std::make_shared<TextBlock>(run.text, run.at, run.width, run.lines, run.attributes));
    layout.draw.push_back([draw = o->draw, p](Canvas& ctx) { draw(ctx, p); });
    return layout;
}

std::optional<Piece> open(Art& art, const std::string& noteID, std::optional<int> page) {
    std::optional<Opened> o = opened(noteID);
    if (!o) return std::nullopt;
    int p = std::clamp(page.value_or(ocean::page(noteID)), 0, int(o->pages.size()) - 1);
    return art.piece(o->key + "/" + std::to_string(p), o->size.width, o->size.height, [&](Canvas& ctx, CGSize) { o->draw(ctx, p); });
}

}  // namespace cards::ocean
