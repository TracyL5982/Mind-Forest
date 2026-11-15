// The small face on the Quest, by the sizing spec's build spec (sizing/quest-card-sizing.md, sections 1 and
// 2): 210 px wide, at most 146 tall, one web px a millimetre at 1.5 m. A face holds whole lines only, up to
// what its type allows; when something is left out its last row is the cue. Nothing is cut, ellipsised or
// shrunk. Each type lays its face out once through `Col`, which sizes it when it has no pen and draws it
// when it has one, so the size and the drawing cannot disagree.
#pragma once
#include <string>

#include "kind.h"

namespace cards {

namespace face {
constexpr int W = 210, H = 146;
/// The frame: 1 px border and 13 px padding above and below with 2 px to spare, and 15 px each side.
constexpr int TOP = 14, BOTTOM = 16, LEFT = 16, COL = W - SIDES;
constexpr int TITLE = 24, BODY = 22, META = 18, CUE = 18, GAP = 6;
}  // namespace face

namespace setting {
constexpr Setting faceTitle{18, 24, Font::Weight::semibold};
constexpr Setting faceBody{16, 22, Font::Weight::medium};
constexpr Setting faceMeta{13.5f, 18, Font::Weight::medium};
/// A quotation, a passage, a meaning: the upright serif at the body size.
constexpr Setting facePassage{16, 22, Font::Weight::regular, true};
}  // namespace setting

/// How lines are counted on the small face (derive.mjs `faces`): in the web's title face, which is never
/// narrower than the medium the words are drawn in, the column scaled to the size; a passage in its serif.
enum class Measure { title, body, meta, passage };
int counted(const std::string& s, int column, Measure m, int max = 99);
/// The size a measure draws at.
const Setting& settingOf(Measure m);

/// The words of the cue, in the card's language.
std::string cueMore(const Words& w);
std::string cueCount(const Words& w, int n);
std::string cueRows(const Words& w, int n);
std::string cueParts(const Words& w, int n);
std::string cueControls(const Words& w, int n);
std::string cueCodeLines(const Words& w, int n, const std::string& language);
std::string cueForAgainst(const Words& w, int pros, int cons);
std::string cuePoints(const Words& w, int n);

/// A small face being laid out top to bottom, px.
struct Col {
    const Pen* pen = nullptr;
    Look look;
    Words words;
    float x = face::LEFT, width = face::COL;
    float y = face::TOP;
    /// Something is left out: the face ends with the cue.
    bool more = false;
    /// For the checks: lines were held back from a text, and the cue was drawn.
    mutable bool heldBack = false;
    bool cued = false;

    /// The room left above the bottom padding, px.
    float room() const { return float(face::H - face::BOTTOM) - y; }
    /// Whole lines of `s`, as many as `max` and the room allow after `after` px more and, when not all
    /// fit, the cue. `column` is the width it is counted in, `drawn` the width it is drawn in (0: the column).
    /// Returns how many it shows.
    int lines(const std::string& s, Measure m, int max, Color color, float after = 0, float at = -1, float column = -1, float drawn = 0);
    /// Draws whole lines only, `n` of them at most, at (x, y) px.
    void say(const std::string& s, const Setting& t, int n, float x, float y, float width, Color color) const;
    void gap(float px) { y += px; }
    /// The last row: the words in meta in the accent. (The spec's 12 px fade above it is left out: under whole
    /// lines it could only lie over letters, and on the bare face it shows nothing.)
    void cue(const std::string& said);
    /// The face's height: what it holds and the bottom of the frame.
    int height() const { return int(std::ceil(y)) + face::BOTTOM; }
};

/// The size `lay` gives a face, and its drawing with the same.
template <class Lay>
Footprint footprint(const Item& item, Lay lay) {
    Col c;
    c.words = item.words;
    lay(c);
    return {face::W, std::min(c.height(), face::H)};
}
template <class Lay>
void drawFace(const Pen& pen, const Look& look, const Item& item, Lay lay) {
    Col c;
    c.pen = &pen;
    c.look = look;
    c.words = item.words;
    lay(c);
    if (Cuts::on && (c.heldBack || c.more) && !c.cued) Cuts::seen.push_back("left out with no cue: " + item.titleOrUntitled());
    if (Cuts::on && c.height() > face::H) Cuts::seen.push_back("runs past the foot: " + item.titleOrUntitled());
}

}  // namespace cards
