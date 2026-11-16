// Where the ocean's notes meet the card library: notes.cpp, catalog.cpp and the scene ask these first, and a
// note with a card is drawn as the web client draws it. Everything here answers nothing for a note without one.
//
// A card takes the sizing spec's sizes (sizing/quest-card-sizing.md). Small, one web px is a millimetre at
// 1.5 m, so a face is at most 21 by 14.6 cm. Opened, a text, chart or link card is a fixed 46 by 37.2 cm frame,
// a picture card the ocean's open note for its picture, and the web's whole panel shows through a window in
// the frame and scrolls there. Both sizes are worked out when the scene first asks for them and kept until
// the card is put again, so a picture that comes later never moves a card.
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
/// The web's px to the small face's pixels: a px is a millimetre.
constexpr float smallScale = Art::ppm / 1000;
/// The opened frame of a text, chart or link card, px: 37.2 cm.
constexpr float OPEN_TALL = 311;
/// The scroll indicator: its height before it is stretched to the share in view, m; and, px, its width, how
/// far it stands in from the frame's right edge, and how far its track stops short of the top and the foot.
constexpr float INDICATOR_UNIT = 0.01f;
constexpr float INDICATOR_WIDE = 4, INDICATOR_EDGE = 4, INDICATOR_END = 12;

/// Draws the notes, films and works of `catalog` as cards from now on (`-cards`).
void hold(const std::shared_ptr<const Catalog>& catalog);
/// The note a piece's card is put for, made now if the held catalog draws the piece as a card; nothing for a
/// piece without one. A note's own id, or a film's or a work's `Ref::key`.
std::optional<std::string> cardOf(const Ref& ref);
/// Puts a held piece's card again with what the tree says of the node that shows it. True when what it
/// draws changed. Its sizes stay: they never depend on the node.
bool seat(const std::string& noteID, const Node& node);

/// Whether a note's card is the in-progress card of one whose look the agents are still choosing (`view.composing`).
bool composing(const std::string& noteID);
/// A note's card small, m.
std::optional<Vec2> smallSize(const std::string& noteID);
/// Its picture.
std::optional<Piece> small(Art& art, const std::string& noteID);
/// The picture of its frame alone, with none of its words.
std::optional<Piece> frame(Art& art, const std::string& noteID);
/// A note's card opened, m: its frame.
std::optional<Vec2> openSize(const std::string& noteID);
/// The round corners of a note's card small, m.
std::optional<float> smallRadius(const std::string& noteID);
/// And of every card opened, its frame's, m.
constexpr float openRadius = OPEN_RADIUS * openScale / Art::ppm;
/// Where the parts of the panel in view sit, at the scroll it stands at: the words a hand can mark and its picture.
std::optional<NoteLayout> layout(const std::string& noteID);
/// The frame's picture.
std::optional<Piece> open(Art& art, const std::string& noteID);
/// The whole panel's picture, made with the frame's, before the card can open.
std::optional<Piece> panel(Art& art, const std::string& noteID);
/// Sets a quad of the panel's picture to show the part of it in the window, at the scroll it stands at.
void showPanel(const EntityRef& quad, const std::string& noteID);
/// How far the panel runs on past the window, px: 0 when it fits.
float overflow(const std::string& noteID);
/// How far it is scrolled, px from its top. It is 0 until scrolled, and is set to 0 when the card opens.
float scroll(const std::string& noteID);
/// Scrolls it, held between its top and its end. True when it moved.
bool scrollTo(const std::string& noteID, float offset);
/// Places and sizes the thin bar at the frame's edge that says where the view is, and hides it while the panel fits.
void showIndicator(const EntityRef& bar, const std::string& noteID);
/// The round corners of an opened card's picture, `size` m, to lay over a film that plays on it: the
/// opened card's face outside each corner, clear inside, as the poster under the film is cut.
std::optional<Piece> corners(Art& art, Vec2 size);
/// Its frame and panel, `k` pixels to a web px (the scene's `openScale`).
std::optional<Opened> opened(const std::string& noteID, float k = openScale);

}  // namespace cards::ocean
