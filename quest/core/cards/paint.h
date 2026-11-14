// The web client's look (agents/client/style.css) as canvas calls: its colours, its three sizes of
// type, a card's face and edge, pictures fitted into a frame, and the line of chips. Every length is
// the web's px; `k` turns a px into the card's pixels.
#pragma once
#include <functional>
#include <optional>
#include <string>
#include <vector>

#include "../canvas.h"
#include "item.h"

namespace cards {

// style.css `:root`
namespace palette {
constexpr Color ink = Color::hex(0xECEBE6);
constexpr Color ink2 = Color::hex(0xA3A39C);
constexpr Color ink3 = Color::hex(0x909089);
constexpr Color pick = Color::hex(0xF2C27A);
constexpr Color trunk = Color::hex(0xE6EFFF);
constexpr Color face = Color::hex(0x1B1D23);
constexpr Color sunk = Color::hex(0x111317);
constexpr Color rootFace = Color::hex(0x262932);
constexpr Color pickFace = Color::hex(0x14161A);
constexpr Color pickSunk = Color::hex(0x0F1114);
constexpr Color media = Color::hex(0x0C0E11);
/// `--glass` over the page's ground, made opaque: a card's picture is never see-through.
constexpr Color glass = Color::hex(0x16181C);
constexpr Color line = Color::white(1, 0.11f);
constexpr Color line2 = Color::white(1, 0.2f);
}  // namespace palette

/// `color-mix(in srgb, a share, b)`, both opaque.
Color mix(Color a, float share, Color b);

/// One of the web's text settings: size and line height in px, weight, face.
struct Setting {
    float size, lead;
    Font::Weight weight = Font::Weight::regular;
    bool serif = false, italic = false;
    /// Fixed-width (`ui-monospace`), as code is set.
    bool mono = false;
};
namespace setting {
constexpr Setting title{16, 21, Font::Weight::semibold};
constexpr Setting text{12.5f, 17};
constexpr Setting quote{16, 21, Font::Weight::regular, true, true};
constexpr Setting mark{34, 36, Font::Weight::regular, true};
// The opened card (`.panel`), where a line is 1.4 of its size unless it says otherwise.
constexpr Setting badge{12, 16.8f};
constexpr Setting heading{21, 25.62f, Font::Weight::semibold};
constexpr Setting whyLabel{11.5f, 16.1f};
constexpr Setting why{14, 19.6f};
constexpr Setting body{15, 21};
constexpr Setting caption{13.5f, 18.9f};
constexpr Setting tag{12.5f, 17.5f};
constexpr Setting fact{13, 18.2f};
}  // namespace setting

/// Text attributes for a setting at `k` pixels to a px.
TextAttributes attributes(const Setting& t, Color color, float k);
/// How far a line's words are lifted from where the canvas stands them, pixels: a browser sets them
/// in the middle of their line.
float lift(const Setting& t, float k);
/// How tall `s` is set in `width` px, at most `lines` lines (0: all), px.
float heightOf(const std::string& s, float width, int lines, const Setting& t, float k);
/// How wide `s` is on one line, px.
float widthOf(const std::string& s, const Setting& t, float k);

/// How a card's face is coloured: its type's face, then what a pick or a tree's first card change.
struct Look {
    Color accent = palette::trunk;
    Color fill = palette::face;
    Color edge = palette::trunk.withAlphaComponent(0.3f);
    Color ink2 = palette::ink2;
    Color ink3 = palette::ink3;
    float edgeWidth = 1;
    bool dashed = false;
    float radius = 12;
};

/// A canvas and the scale it is drawn at.
struct Pen {
    Canvas& ctx;
    float k;

    /// Text with its top-left at (x, y) px, wrapped to `width` px, at most `lines` lines (0: all), each
    /// line `t.lead` tall with its words in the middle of it, as a browser sets them.
    void words(const std::string& s, float x, float y, float width, int lines, const Setting& t, Color color) const;
    float width(const std::string& s, const Setting& t) const { return widthOf(s, t, k); }

    /// A rectangle in px, as pixels.
    CGRect px(float x, float y, float w, float h) const { return {x * k, y * k, w * k, h * k}; }
    /// A rectangle with round corners as the current path, in pixels.
    void rounded(CGRect r, float radius) const;
    /// Fills the face of a card `w` by `h` px.
    void face(float w, float h, const Look& look) const;
    /// Strokes the edge.
    void edge(float w, float h, const Look& look) const;
    /// Clears what lies outside the round corners: a picture to the edge is cut to them.
    void corners(float w, float h, float radius) const;
    /// Paints what lies outside the round corners of `r` (pixels) with `ground`: a box inside a card rounded.
    void mask(CGRect r, float radius, Color ground) const;
    /// A picture in a frame, in pixels: `cover` fills it (`object-fit: cover`), otherwise it is shown whole.
    void picture(const std::string& src, CGRect frame, bool cover, const Words& words) const;
    /// The line of chips, its left edge at `x` and its top at `y`, px.
    void chips(const std::vector<Chip>& line, float x, float y, const Look& look) const;
};

/// How far below the top of its line a setting's baseline is, px: where `align-items: baseline` lines things up.
float baseline(const Setting& t, float k);
/// `.kind`, in the text's line, its top-left at (x, y) px: a short label set in small capitals, or as
/// written when it holds Han. The canvas has no small capitals, so it sets capitals a size down on the
/// text's baseline.
float labelWidth(const std::string& label, float k);
void label(const Pen& pen, const std::string& label, float x, float y, Color color);

/// A picture a card shows, as the caller has it.
struct Picture {
    ImageRef image;
    bool missing = false;
};
/// What is known of the picture at `src`: nothing yet, or it, or that it could not be had.
std::optional<Picture> pictureAt(const std::string& src);
void setPicture(const std::string& src, Picture picture);
/// A drawn stand-in for a picture: the web library's samples, a gradient with a sun and a hill.
struct Sample {
    Color a, b;
    float width, height;
};
void setSample(const std::string& name, Sample sample);
/// The width over the height of what `src` shows, when known.
std::optional<float> aspectOf(const std::string& src);

}  // namespace cards
