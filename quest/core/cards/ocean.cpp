#include "ocean.h"

#include <map>

namespace cards::ocean {

namespace {

/// The opened card is laid out once for each thing it shows: the tree asks its size on every relayout.
const Opened* openedOf(const std::string& noteID) {
    static std::map<std::string, std::pair<int, Opened>> made;
    int now = revision(noteID);
    if (!now) return nullptr;
    auto it = made.find(noteID);
    if (it == made.end() || it->second.first != now) {
        std::optional<Opened> o = cards::opened(noteID, openScale);
        if (!o) return nullptr;
        it = made.insert_or_assign(noteID, std::make_pair(now, *o)).first;
    }
    return &it->second.second;
}

}  // namespace

std::optional<Vec2> smallSize(const std::string& noteID) {
    std::optional<Footprint> f = footprintOf(noteID);
    if (!f) return std::nullopt;
    return Vec2{std::ceil(float(f->width) * smallScale) / Art::ppm, std::ceil(float(f->height) * smallScale) / Art::ppm};
}

std::optional<Piece> small(Art& art, const std::string& noteID) {
    std::optional<Drawn> d = cards::small(noteID, smallScale);
    if (!d) return std::nullopt;
    return art.piece(d->key, d->size.width, d->size.height, [&](Canvas& ctx, CGSize) { d->draw(ctx); });
}

std::optional<Vec2> openSize(const std::string& noteID) {
    const Opened* o = openedOf(noteID);
    if (!o) return std::nullopt;
    return Vec2{o->size.width / Art::ppm, o->size.height / Art::ppm};
}

std::optional<NoteLayout> layout(const std::string& noteID) {
    const Opened* o = openedOf(noteID);
    if (!o) return std::nullopt;
    NoteLayout layout{o->size};
    layout.picture = o->picture;
    for (const Run& run : o->runs) layout.blocks.push_back(std::make_shared<TextBlock>(run.text, run.at, run.width, run.lines, run.attributes));
    layout.draw.push_back(o->draw);
    return layout;
}

std::optional<Piece> open(Art& art, const std::string& noteID) {
    const Opened* o = openedOf(noteID);
    if (!o) return std::nullopt;
    return art.piece(o->key, o->size.width, o->size.height, [&](Canvas& ctx, CGSize) { o->draw(ctx); });
}

}  // namespace cards::ocean
