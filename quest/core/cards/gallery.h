// `-cards`: the web card library's samples as a tree in the ocean, with no service and no network.
// The library's card stands at the root, a card of each type the Quest draws comes up round it, and a
// pinch on a type brings that type's other samples (a pick, chips, other content) round it.
#pragma once
#include <optional>

#include "../json.h"

class Catalog;

namespace cards {

/// The samples, as quest/tools/cards_samples.mjs wrote them (samples.cpp).
extern const char* const samplesJson;
/// Samples with the item's own lines over a structure, or a heads row, that samples.cpp predates
/// (samples_lines.cpp): `[{type, label, status, view, item}]`.
extern const char* const linesSamplesJson;
/// Samples with a short title for the face, and one with a long title and none (samples_titles.cpp), the same shape.
extern const char* const titlesSamplesJson;
/// The samples read, with the pictures they draw made known: `{pictures, types: [{type, when, cards:
/// [{label, status, view, item}]}]}`.
std::optional<Json> readSamples();

/// Puts the samples into the catalog as notes and their cards into this library, and adds a brief
/// that stands them as a tree. Returns that brief's index, or -1 when the samples could not be read.
int gallery(Catalog& catalog);

}  // namespace cards
