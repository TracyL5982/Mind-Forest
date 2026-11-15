// The ocean's own pieces as cards: a note, a film or a work as the item and the view that the service's
// library import makes of it (`npm run import-library`: agents/src/node/library.ts, and `defaultView` in
// agents/src/core/views.ts, on tracy/quest-service), with the field names of agents/src/core/domain.ts.
//
// Where the import's default view and the card a piece is meant to be drawn as differ, the card wins and
// takes its props from its own component: a chart note is a chart, a link note a link, a work an artwork,
// and a note that quotes is a quote. A piece's tags also become its chips: its people and its place.
#pragma once
#include <optional>
#include <string>

#include "../json.h"

class Catalog;
struct Ref;

namespace cards {

/// A piece as a card.
struct OceanCard {
    /// The note the card is put for: a note's own id, or a film's or a work's `Ref::key` ("film:3").
    std::string id;
    Json view, item;
    /// Its picture's width over its height, as the ocean knows it before the picture is there.
    std::optional<float> aspect;
};

/// A note, a film or a work as a card. A tag has none: it keeps the ocean's chip.
std::optional<OceanCard> oceanCard(const Catalog& catalog, const Ref& ref);

/// Where a picture a card shows is in the ocean, by the address its view gives it: a film's still from the
/// atlas ("still:<film>"), a work's own picture ("work:<work>"), or a picture file among the app's
/// resources ("file:<name>").
struct OceanPicture {
    enum class Kind { still, work, file } kind;
    int index = 0;
    std::string file;
};
/// Nothing for an address that is not the ocean's, such as a sample's.
std::optional<OceanPicture> oceanPicture(const std::string& src);

}  // namespace cards
