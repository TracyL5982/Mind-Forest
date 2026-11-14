// What the media cards share: link, artwork, video, person, audio and swatch.
#pragma once
#include <string>

#include "kind.h"

namespace cards {

/// The first character a reader sees in `s`, in capitals (`graphemes(s)[0].toUpperCase()`).
std::string capital(const std::string& s);

/// A round mark in the card's colour (`.audio-play`, `.person-face`): the accent at 18 % over the face,
/// ringed outside by a hairline of the accent at half strength. `box` is in pixels.
void disc(const Pen& pen, const Look& look, CGRect box);
/// A play mark: a triangle pointing right, `w` by `h` px with its top-left at (x, y) px.
void play(const Pen& pen, float x, float y, float w, float h, Color color);
/// Stripes at 135 degrees, `stripe` px each, `a` then `b`, filling `frame` (pixels).
void hatch(const Pen& pen, CGRect frame, Color a, Color b, float stripe);

/// `Sheet::paragraph`, `gap` px under what is above it in place of the sheet's 13: a line inside one of
/// the web's parts.
void paragraph(Sheet& sheet, const std::string& s, const Setting& t, Color color, float gap);

}  // namespace cards
