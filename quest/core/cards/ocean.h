// Where the ocean's notes meet the card library: notes.cpp and catalog.cpp ask these first, and a note
// with a card is drawn as the web client draws it. Everything here answers nothing for a note without one.
#pragma once
#include <optional>
#include <string>

#include "../ocean/art.h"
#include "cards.h"

namespace cards::ocean {

/// The web's px to the card's pixels: small, a 240 px note is as wide as the ocean's own small note;
/// opened, the web's 384 px panel is as wide as the ocean's open note.
constexpr float smallScale = Metrics::smallNoteWidth * Art::ppm / 240;
constexpr float openScale = Metrics::openNoteWidth * Art::ppm / 384;

/// A note's card small, m.
std::optional<Vec2> smallSize(const std::string& noteID);
/// Its picture.
std::optional<Piece> small(Art& art, const std::string& noteID);
/// A note's card opened, m.
std::optional<Vec2> openSize(const std::string& noteID);
/// Where its parts sit: the words a hand can mark and its picture.
std::optional<NoteLayout> layout(const std::string& noteID);
/// Its picture.
std::optional<Piece> open(Art& art, const std::string& noteID);

}  // namespace cards::ocean
