// The agent's cards in the web client's look: agents/client/js/components and agents/client/style.css
// on genui/integration, to agents/docs/libraries.md. See README.md in this folder for how the bridge
// calls it.
//
// A card is a node's `view` ({component, props}) and its `item`, as the service sends them. Its
// footprint is the web's, worked out from letter widths and never measured, so a card takes the same
// room as on the web; its words are set in the host's fonts inside that room.
#pragma once
#include <optional>
#include <string>
#include <vector>

#include "../json.h"
#include "../scene.h"
#include "kind.h"

namespace cards {

/// What the tree says of a card besides its view and its item.
struct Node {
    /// `node.status == "pick"`: a dashed edge, a darker face and a SUGGESTED kicker.
    bool pick = false;
    /// The first card of a tree (`node.parent` is null): a lighter face and a white edge.
    bool root = false;
    /// `node.why`, which the opened card says.
    std::string why;
    /// The tone of the card's place in the tree, as its thread is drawn (`TreeNode::tone`). Its marks take
    /// the tone's colour, where the web's take the tree's.
    Tone tone = Tone::note;
};

/// The footprint the web gives this view and item, px.
Footprint footprint(const Json& view, const Json& item);
/// The chips its card draws, each with its box (the web's `chipsOf`).
std::vector<Chip> chipsOf(const Json& view, const Json& item);
/// Whether this library has a face of its own for a component. Any other is drawn as a note.
bool draws(const std::string& component);

/// Keeps the card a note shows, or its newer view, item or node. True when what it draws changed.
bool put(const std::string& noteID, const Json& view, const Json& item, const Node& node = {});
/// Forgets a note's card.
void drop(const std::string& noteID);
bool has(const std::string& noteID);

/// The pictures a note's card shows (an image's `props.src`), for the caller to fetch.
std::vector<std::string> pictures(const std::string& noteID);
/// A picture the caller fetched, or null when it could not be had. Returns the notes whose card changed.
std::vector<std::string> picture(const std::string& src, ImageRef image);

/// A card drawn: its size in pixels and the calls that draw it. `key` changes whenever what it draws does.
struct Drawn {
    std::string key;
    CGSize size;
    std::function<void(Canvas&)> draw;
};
/// The opened card: a frame of a fixed size, and the whole panel (panel.js) drawn once, which shows through
/// a window in the frame and scrolls there.
struct Opened {
    std::string key;
    /// The frame, pixels: the card's open size.
    CGSize size;
    /// Where the panel shows inside the frame, pixels, clear of the frame's round corners.
    CGRect window;
    /// The whole panel, pixels tall; as wide as the frame.
    float contentTall = 0;
    /// The text a hand can mark, and where its picture is, pixels on the panel.
    std::vector<Run> runs;
    std::optional<CGRect> picture;
    /// Draws the frame, and the whole panel, each into a picture of its own.
    std::function<void(Canvas&)> frame, content;
};
/// A note's card small, `k` pixels to a web px.
std::optional<Drawn> small(const std::string& noteID, float k);
/// Its small face's frame alone: the face, its corners and its edge, and none of its words. What an in-progress card
/// eases to its finished card's size as.
std::optional<Drawn> frame(const std::string& noteID, float k);
/// A note's card opened in a frame `viewTall` px tall, its pictures at most `pictureTall` px, `k` pixels to a web px.
/// It is laid out once and kept until the card is put again: a picture that comes later moves nothing.
std::optional<Opened> opened(const std::string& noteID, float k, float viewTall, float pictureTall);
/// Rises each time a note's card is put anew, and not when a picture comes; 0 for a note with no card.
int generation(const std::string& noteID);
/// The type a note's card is drawn as.
const Kind* kindOf(const std::string& noteID);
/// The width over the height of the first picture a note's card shows, as first known: its own, `props.aspect`, or the web's 1.35.
std::optional<float> pictureAspect(const std::string& noteID);
/// Its footprint, px.
std::optional<Footprint> footprintOf(const std::string& noteID);
/// Rises each time what a note's card draws changes; 0 for a note with no card.
int revision(const std::string& noteID);

}  // namespace cards
