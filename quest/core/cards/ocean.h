// Where the ocean's notes meet the card library: notes.cpp, catalog.cpp and the scene ask these first, and a
// note with a card is drawn as the web client draws it. Everything here answers nothing for a note without one.
//
// A card takes the ocean's own sizes. Small, it is as wide as the ocean's small note, and no taller than
// `smallCeiling`. Opened, it is the
// ocean's open note of the kind it opens as (Kind::opens), and what the web's panel holds beyond that
// note's height goes on further pages of the same size. Both are worked out when the scene first asks
// for them and kept until the card is put again, so a picture that comes later never moves a card.
//
// Under `-cards` the ocean's own notes, films and works are cards too (pieces.h). Each is made the first
// time the scene asks about it, under the id `cardOf` gives, and its sizes come from the ocean's own
// shape of its picture, so they are the same whether the picture is there yet or not.
#pragma once
#include <memory>
#include <optional>
#include <string>

#include "../ocean/art.h"
#include "cards.h"

namespace cards::ocean {

/// The web's px to the opened card's pixels: the web's 384 px panel is as wide as the ocean's open note.
constexpr float openScale = Metrics::openNoteWidth * Art::ppm / 384;
/// The tallest a card is small, m: about the ocean's tallest small card, a portrait film with its title on a
/// label under it (Art::filmSmall). A card that would be taller at the small note's width is drawn smaller.
constexpr float smallCeiling = Metrics::smallFilmMaxHeight + 0.006f + 1.2f * Art::Size::label + 2 * Art::pad.y;

/// Draws the notes, films and works of `catalog` as cards from now on (`-cards`).
void hold(const std::shared_ptr<const Catalog>& catalog);
/// The note a piece's card is put for, made now if the held catalog draws the piece as a card; nothing for a
/// piece without one. A note's own id, or a film's or a work's `Ref::key`.
std::optional<std::string> cardOf(const Ref& ref);
/// Puts a held piece's card again with what the tree says of the node that shows it. True when what it
/// draws changed. Its sizes stay: they never depend on the node.
bool seat(const std::string& noteID, const Node& node);

/// A note's card small, m.
std::optional<Vec2> smallSize(const std::string& noteID);
/// Its picture.
std::optional<Piece> small(Art& art, const std::string& noteID);
/// A note's card opened, m: one page.
std::optional<Vec2> openSize(const std::string& noteID);
/// Where the parts of the page it shows sit: the words a hand can mark and its picture.
std::optional<NoteLayout> layout(const std::string& noteID);
/// The picture of the page it shows, or of another page, made ahead so it is there when it is wanted.
std::optional<Piece> open(Art& art, const std::string& noteID, std::optional<int> page = std::nullopt);
/// How many pages it has (0 for a note with no card), and which it shows, from 0.
int pages(const std::string& noteID);
int page(const std::string& noteID);
/// Shows its next page, or its first after its last.
void turn(const std::string& noteID);
/// Its pages, `k` pixels to a web px (the scene's `openScale`).
std::optional<Opened> opened(const std::string& noteID, float k = openScale);

}  // namespace cards::ocean
