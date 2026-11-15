// The small face on the Quest, by the sizing spec's build spec (sizing/quest-card-sizing.md, sections 1 and
// 2): 210 px wide, at most 146 tall, one web px a millimetre at 1.5 m. A face holds whole lines only, up to
// what its type allows; when something is left out its last row is the cue. Nothing is cut, ellipsised or
// shrunk. Each type lays its face out once through `Col`, which sizes it when it has no pen and draws it
// when it has one, so the size and the drawing cannot disagree.
#pragma once
#include <array>
#include <functional>
#include <optional>
#include <string>
#include <vector>

#include "kind.h"

namespace cards {

namespace face {
constexpr int W = 210, H = 146;
/// The frame: 1 px border and 13 px padding above and below with 2 px to spare, and 15 px each side.
constexpr int TOP = 14, BOTTOM = 16, LEFT = 16, COL = W - SIDES;
constexpr int TITLE = 24, BODY = 22, META = 18, CUE = 18, GAP = 6;
/// The pixels a px a face is laid out and drawn at (cards::ocean::smallScale): its lines are counted there.
constexpr float K = 2;
/// The most lines a title takes on the face. A longer one is cut there, at a whole word (a character in
/// Chinese), and ends with an ellipsis: the one place a face draws one. The opened card has it whole.
constexpr int TITLE_LINES = 2;
}  // namespace face

namespace setting {
constexpr Setting faceTitle{18, 24, Font::Weight::semibold};
constexpr Setting faceBody{16, 22, Font::Weight::medium};
constexpr Setting faceMeta{13.5f, 18, Font::Weight::medium};
/// A heading or a label over a structure (`props.above`): the title's weight at the body size.
constexpr Setting faceHead{16, 22, Font::Weight::semibold};
/// A quotation, a passage, a meaning: the upright serif at the body size.
constexpr Setting facePassage{16, 22, Font::Weight::regular, true};
}  // namespace setting

/// How a line is set on the small face: the title, the body, meta, a passage in the serif, or a heading
/// over a structure. Lines are counted by the host's own layout of the words, as they are drawn, so a face
/// reserves no line it then leaves blank.
enum class Measure { title, body, meta, passage, head };
int counted(const std::string& s, int column, Measure m, int max = 99);
/// `s` as it stands in at most `lines` lines, by `count`, which says how many lines a string takes: itself
/// when it fits, or cut at a whole word (a character in Chinese) and ended with an ellipsis.
std::string ellipsized(const std::string& s, int lines, const std::function<int(const std::string&)>& count);
/// A title in at most `face::TITLE_LINES` lines of `column` px, set as `m`, and how many lines it takes.
struct Titled {
    std::string said;
    int lines = 0;
};
Titled titled(const std::string& title, float column, Measure m);
/// The same, for a title set as a figure (a term, a place's name).
Titled titledFigure(const std::string& title, float column, const Figure& size);
/// How many lines a figure takes in `column` px on the face, as the host sets it.
int figureLines(const std::string& value, float column, const Figure& size);
/// How wide `s` is counted on one line, px, as `counted` counts it.
float countedWidth(const std::string& s, Measure m);
/// The size a measure draws at.
const Setting& settingOf(Measure m);

/// One of the item's own lines over a card's structure (`props.above`), as the web reads them: a line set
/// in bold (`**...**`) or one ending in a colon, a letter or a digit heads what is under it.
struct Over {
    std::string words;
    bool head = false;
};
std::vector<Over> oversOf(const Json& props);
/// The heads row over the two columns a card's figures or bars come from (`props.heads`): two heads, not both empty.
std::optional<std::array<std::string, 2>> headsOf(const Json& props);

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
    /// A line over the structure was held back: nothing under it is drawn, and the face ends with the cue.
    bool ended = false;
    /// The foot of the last lines `lines`, `above` and `heads` set, px: the cue never rises over them.
    float inked = 0;
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
    /// The title first, at `atX` in `column` px (the face's column if not given): whole in up to two lines,
    /// or its first two cut with an ellipsis (`titled`). The face goes on under it. False when the face had
    /// already ended.
    bool title(const std::string& s, float atX = -1, float column = -1);
    /// The item's lines over the structure, in order and whole, 6 px under what came before (or, first on the
    /// face, 6 px over what follows), each keeping the cue's row free under it. A line that does not fit ends
    /// the face: it is held back, and so is everything under it. False then.
    /// `keep` px are kept free under them for a title that comes after them (a question, a term, a fact's
    /// foot), which comes first in the budget: a line that does not fit then is held back and the face goes on
    /// to that title, and ends after it.
    bool above(const Json& props, float keep = 0);
    /// The heads row in meta over a hairline, each head over its half of the column. False, and the face ends,
    /// when it does not fit over the cue's row.
    bool heads(const Json& props, float keep = 0);
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
