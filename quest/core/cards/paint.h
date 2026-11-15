// The web client's look (agents/client/style.css) as canvas calls: its colours, its three sizes of
// type, a card's face and edge, pictures fitted into a frame, and the line of chips. Every length is
// the web's px; `k` turns a px into the card's pixels.
#pragma once
#include <functional>
#include <optional>
#include <string>
#include <vector>

#include "../canvas.h"
#include "../ocean/art.h"
#include "item.h"

namespace cards {

// The cards keep the web's layout, type scale, types and sizes, and take every colour from the Ocean
// (Art in core/ocean/art.h, the tones in stage.h), so they sit in the ocean as its own notes do: flat,
// opaque, white words at the Ocean's steps of strength, and one accent. Each line says where its value
// comes from and which of style.css's colours it stands for.
namespace palette {
/// Words. White, as the Ocean's titles (`--ink`).
constexpr Color ink = Color::white();
/// Body text, at the Ocean's 0.82 (`--ink-2`).
constexpr Color ink2 = Color::white(1, 0.82f);
/// What a card says about itself: a speaker, a source, a language, at the Ocean's 0.78 for meta.
constexpr Color meta = Color::white(1, 0.78f);
/// Faint words: labels, counts, a picture that is not there (`--ink-3`), at the Ocean's 0.6.
constexpr Color ink3 = Color::white(1, 0.6f);
/// A card's face: the Ocean's panel ground, Art::panel (`--face`).
constexpr Color face = Art::panel;
/// The darker face of a figure, a fact or code: Art::ink, the dark of the Ocean's labels and panels (`--sunk`).
constexpr Color sunk = Art::ink;
/// The first card of a tree, a shade lighter: Art::well (the web's root face).
constexpr Color raised = Art::well;
/// Behind a picture: Art::well, the frame of a picture not there (`.media-frame`, `.detail-media`).
constexpr Color media = Art::well;
/// The opened card: Art::ink, as the ocean's open note is (`--glass`, made flat and opaque).
constexpr Color glass = Art::ink;
/// Hairlines and the edge of a card: white, faint (`--line`, `--line-2`).
constexpr Color line = Color::white(1, 0.12f);
constexpr Color line2 = Color::white(1, 0.2f);
/// The edge and the kicker of a pick, the agent's suggestion: white at 0.5, in place of the web's amber.
constexpr Color pick = Color::white(1, 0.5f);
/// The one accent, Art::hot: where you are, what you marked, what you send, and danger (`--danger`).
constexpr Color hot = Art::hot;
/// A bar or a figure that is not the one a card is about: flat white at 0.35, as Art::bars draws them.
constexpr Color bar = Color::white(1, 0.35f);
}  // namespace palette

/// The tone a chip of this kind is drawn in, as the ocean draws its tags: who is people, where is place,
/// when is era, and where an agent's pick came from is path.
Tone toneOf(Chip::Kind kind);

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
/// Medium, not regular: white at 0.82 in the regular weight reads too thin at this size on the headset.
constexpr Setting text{12.5f, 17, Font::Weight::medium};
constexpr Setting quote{16, 21, Font::Weight::regular, true, true};
constexpr Setting mark{34, 36, Font::Weight::regular, true};
// The opened card (`.panel`), by the sizing spec: the title 21 px semibold, every line that is read 15 px
// medium, and labels, tags and chips 11.5 px medium.
constexpr Setting badge{11.5f, 16.8f, Font::Weight::medium};
constexpr Setting heading{21, 25.62f, Font::Weight::semibold};
constexpr Setting whyLabel{11.5f, 16.1f, Font::Weight::medium};
constexpr Setting why{15, 21, Font::Weight::medium};
constexpr Setting body{15, 21, Font::Weight::medium};
/// A heading over a structure (`props.above`): the title's weight at the reading size.
constexpr Setting bodyHead{15, 21, Font::Weight::semibold};
constexpr Setting caption{15, 21, Font::Weight::medium};
constexpr Setting tag{11.5f, 17.5f, Font::Weight::medium};
/// A label on the opened card: a unit, a chart's axes and the values written on it, a slider's ends.
constexpr Setting small{11.5f, 16, Font::Weight::medium};
/// A fact's label in the list at the opened card's foot; its value is `body`.
constexpr Setting fact{11.5f, 21, Font::Weight::medium};
/// The size of a kind label (`label`) on the opened card, and on the small face, where nothing read is under 13.5 px.
constexpr float labelSize = 11.5f, faceLabelSize = 13.5f;
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
    Color accent = ::color(Tone::note);
    Color fill = palette::face;
    Color edge = palette::line;
    Color ink2 = palette::ink2;
    Color ink3 = palette::ink3;
    float edgeWidth = 1;
    bool dashed = false;
    float radius = 12;
};

/// For the checks (test/sizes.cpp): while `on`, each text a card draws cut short, with an ellipsis or by
/// lines left out with no cue after them, is written down in `seen`.
struct Cuts {
    static inline bool on = false;
    static inline std::vector<std::string> seen;
};

struct Pen;
/// A pick's kicker, as the ocean writes one over a note: SUGGESTED in capitals at Art::Size::micro on the
/// small note, bold, in the card's tone, as a flat ink label over the top edge, left of the corner's curve
/// of a card with corners of `radius` px.
void kicker(const Pen& pen, const Look& look, float radius);

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
float labelWidth(const std::string& label, float k, float size = setting::labelSize);
void label(const Pen& pen, const std::string& label, float x, float y, Color color, float size = setting::labelSize);

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
