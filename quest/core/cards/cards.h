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
    /// `node.status == "pick"`: amber, a dashed edge, a darker face.
    bool pick = false;
    /// The first card of a tree (`node.parent` is null): a lighter face and a white edge.
    bool root = false;
    /// `node.why`, which the opened card says.
    std::string why;
    /// The tree's colour for this card (the web's `store.view.colour`). Its marks take it.
    Color accent = palette::trunk;
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
/// The opened card: also the text a hand can mark and where its picture is.
struct Opened : Drawn {
    std::vector<Run> runs;
    std::optional<CGRect> picture;
};
/// A note's card small, `k` pixels to a web px.
std::optional<Drawn> small(const std::string& noteID, float k);
/// A note's card opened, `k` pixels to a web px.
std::optional<Opened> opened(const std::string& noteID, float k);
/// Its footprint, px.
std::optional<Footprint> footprintOf(const std::string& noteID);
/// Rises each time what a note's card draws changes; 0 for a note with no card.
int revision(const std::string& noteID);

}  // namespace cards
