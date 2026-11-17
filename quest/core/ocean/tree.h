// Port of visionos/MindPalace/Ocean/Tree.swift.
#pragma once
#include <array>
#include <cmath>
#include <map>
#include <memory>
#include <optional>
#include <set>
#include <string>
#include <vector>

#include "../base.h"
#include "../json.h"
#include "../vecmath.h"
#include "stage.h"
#include "catalog.h"


/// Sizes, in meters, of everything a card can be. One place, so the tree's
/// layout and the drawing agree.
namespace Metrics {
constexpr float smallFilm = 0.17f;          // a film's picture, small
constexpr float smallFilmMaxHeight = 0.118f;
constexpr float openFilm = 0.46f;           // and open
constexpr float openFilmMaxHeight = 0.32f;
constexpr float filmCaption = 0.116f;       // the panel under an open film
constexpr float smallNoteWidth = 0.21f;
constexpr float openNoteWidth = 0.46f;
// NOTE(port): added for Quest: the stage a lesson of the welcome tree was made for, which its gesture's size is
// given against (oceanmodel_guide.cpp, `TourStep::stage`). Its note keeps these proportions; the stage on its
// card is as wide as the card's panel and `lessonStageTall`.
constexpr float lessonWidth = 0.56f;
constexpr float lessonStage = 0.34f;
constexpr float chipHeight = 0.03f;
constexpr float chipGap = 0.038f;

constexpr float smallWorkArea = 0.17f * 0.105f;     // a work's picture, small: as much of the view as a film's
constexpr float openWorkArea = 0.46f * 0.27f;       // and open
constexpr float openWorkMinWidth = 0.3f;            // an open work is never narrower: its caption needs the room
constexpr float workCaption = 0.126f;               // the panel under an open work

inline Vec2 film(float width, float maxHeight, float aspect) {
    float h = width / aspect;
    return h > maxHeight ? Vec2{maxHeight * aspect, maxHeight} : Vec2{width, h};
}

/// A picture of a given area that keeps its proportions, within a largest width and height.
inline Vec2 work(float area, float aspect, float maxWidth, float maxHeight) {
    float w = std::sqrt(area * aspect), h = std::sqrt(area / aspect);
    if (w > maxWidth) {
        w = maxWidth;
        h = w / aspect;
    }
    if (h > maxHeight) {
        h = maxHeight;
        w = h * aspect;
    }
    return {w, h};
}
}  // namespace Metrics

/// How branches share a layer, and how nearer layers condense onto the one
/// you work on. Tuned in studies/layer-meaning/a2-restored.html at 1.2 m and
/// carried to this app's working distance. Some can be tried at launch.
struct Branching {
    static float gap() { static const float v = asked("groupGap").value_or(0.25f); return v; }      // m of room kept between two groups on a layer
    static float gather() { static const float v = asked("gather").value_or(0.25f); return v; }     // each layer, a group is drawn this share of the way back to the middle
    static constexpr float closed = 0.55f;                  // a group whose first card isn't open draws in this much
    static constexpr int deep = 2;                          // how many nearer layers stay in sight, condensed
    static constexpr int keep = 3;                          // cards a condensed group keeps
    static constexpr float small = 0.45f;                   // how small a condensed card is
    // NOTE(port): `float` in the Swift; a C++ keyword.
    static float float_() { static const float v = asked("float").value_or(0.075f); return v; }     // m a condensed group stands off its sheet, per level
    static constexpr float hug = 0.045f;                    // m of air kept round a condensed group
    static constexpr float glassLayers = 2;                 // layers, from the one you work on, whose groups stand on glass
    static constexpr float step = 0.105f;                   // how far a branch's colour moves from its parent's at a split
    static constexpr float first = 330 * floatPi / 180;       // the direction the first split is made around

private:
    static std::optional<float> asked(const char* key) {
        double v = Flags::number(key);
        return v > 0 ? std::optional<float>(float(v)) : std::nullopt;
    }
};

/// A rectangle on a sheet, m.
struct Box {
    Vec2 lo;
    Vec2 hi;

    /// `init(lo:hi:)`
    Box(Vec2 lo, Vec2 hi) : lo(lo), hi(hi) {}

    /// `init(center:size:)`: the same argument types as `init(lo:hi:)`, so it takes its labels.
    static Box centerSize(Vec2 center, Vec2 size) { return Box(center - size / 2, center + size / 2); }

    Box moved(Vec2 d) const { return Box(lo + d, hi + d); }
    Box grown(float m) const { return Box(lo - Vec2::repeating(m), hi + Vec2::repeating(m)); }
    Box joined(const Box& o) const { return Box(vmin(lo, o.lo), vmax(hi, o.hi)); }
    /// Whether it comes within `gap` of another.
    bool hits(const Box& o, float gap) const {
        return lo.x < o.hi.x + gap && o.lo.x < hi.x + gap && lo.y < o.hi.y + gap && o.lo.y < hi.y + gap;
    }
};

/// Where a card shows: which layer, where on the sheet all layers share, how
/// large, and how far it stands off its sheet.
struct Seat {
    int depth = 0;
    Vec2 xy;
    float scale = 1;
    float float_ = 0;           // in steps of `Branching.float`. NOTE(port): `float` in the Swift; a C++ keyword
    bool visible = true;
};

/// A branch's colour as a point on the colour wheel (OKLab's a and b): white
/// in the middle, purer toward the rim.
namespace Chroma {
/// Linear RGB for a point on the wheel: lighter near white, a little
/// deeper as it gets purer, and pulled back inside what a display can show.
Vec3 linear(Vec2 q);
}

struct TreeNode {
    int id = 0;
    Ref ref;
    std::optional<int> parent;
    std::vector<int> children;
    bool opened = false;        // it has been the focus at some time
    bool kept = false;          // confirmed: yours, with a solid thread. Until then it is only a suggestion
    bool chip = false;          // a tag still sitting beside its card
    std::string why;
    Tone tone = Tone::path;
    bool head = false;          // it has been asked about: it is the first card of a group, on the next layer
    /// Where it sits in the group it came back in, m, from that group's first card.
    Vec2 xy;
    int slot = -1;              // which place around its parent it took
    bool byHand = false;
    bool placed = false;        // put where it is by hand
    std::optional<float> imp;   // how much it matters, 0…1: what stays when its group condenses

    /// Every key but `parent` and `imp` has to be there, as Swift's own decoding has it.
    static std::optional<TreeNode> from(const Json& j);
    Json json() const;
};

/// One tree standing out of the ocean.
///
/// Every question makes the next layer. Picking a card asks about it: it
/// becomes the first card of a group, one layer nearer than the group it
/// came back in, and what the gardener brings stands round it. Every card
/// asked from the same layer shares that next layer, each group standing by
/// the card it came from, so a layer holds one round of every branch.
///
/// - The layers in line (`route`) are the first cards from the root out to
///   the last card asked; `stand` is the one whose layer you work on.
/// - A group on a layer nearer than the one you work on is not gone: it
///   condenses onto the card it came from, small, keeping what matters most,
///   and floats a little off the sheet. That holds two layers deep.
/// - Groups are drawn a share of the way back to the middle on each layer,
///   and part only along the direction their branches first parted, so a
///   branch keeps its side.
/// - The first branch is white; its colour comes apart at every split.
///
/// Nothing is thrown away unless it is cut.
class Tree {
public:
    std::map<int, TreeNode> nodes;
    int root = 0;
    /// The card in focus (open), or the last one that was.
    int current = 0;
    /// Whether a card is in focus at all.
    bool focused = true;
    /// The first card of the layer you work on.
    int stand = 0;
    /// The layers in line, first cards from the root out. Those up to
    /// `stand` are open; any after it are folded, and are where "forward" leads.
    std::vector<int> route;
    std::string title;
    Maker maker = Maker::gardener;
    bool sent = false;
    /// Connections across the tree, between things already in it: what an
    /// answer from the gardener ties together.
    struct Link {
        int a = 0;
        int b = 0;
        std::string why;
        Tone tone = Tone::path;
        static std::optional<Link> from(const Json& j);
        Json json() const;
    };
    std::vector<Link> links;
    /// Where each group stands on the sheet all layers share, by its first card.
    std::map<int, Vec2> lifted{{0, Vec2::zero()}};
    /// Each card's colour, as a point on the colour wheel.
    std::map<int, Vec2> tints;

private:
    int nextID = 0;
    std::shared_ptr<Catalog> catalog;

public:
    /// Where things may stand around an open card, degrees counter-clockwise from the right.
    static constexpr std::array<float, 9> ringAngles{20, 60, 100, 140, 180, 220, 260, 300, 340};

    /// `init(root:title:maker:catalog:)`
    // AGENT: `grows` false makes a tree the agent service grows: its root starts with nothing round it (see `grows` below).
    Tree(const Ref& ref, const std::string& title, Maker maker, const std::shared_ptr<Catalog>& catalog, bool grows = true);

    std::set<Ref> held() const;

    /// Root to `id`.
    std::vector<int> path(int id) const;

    std::vector<int> path() const { return path(current); }

    /// `node(for:)`. NOTE(port): the Swift takes whichever the dictionary gives first; here, the lowest id.
    std::optional<TreeNode> node(const Ref& ref) const;

    // MARK: - Layers

    /// The group `id` belongs to, by its first card: itself if it has been asked about, else the card it came back to.
    int layer(int id) const;

    /// The group a card came back in.
    int host(int id) const;

    /// Which layer a group lies on, by its first card: the root's is 0, and
    /// each question is one more.
    int generation(int id) const;

    int standDepth() const;

    /// How far a group is drawn in: open, its cards stand at their full distance round the open card.
    /// AGENT: a card opened where it stands (`open`) leaves its group open too: the group is still the one you work on.
    float spread(int head) const { return focused && layer(current) == head ? 1 : Branching::closed; }

    // NOTE(port): added for Quest. The welcome tree is a walk (oceanmodel_guide.cpp), and every step of it
    // should look like the last: a card taken comes to the middle of its layer (any other tree's keeps most
    // of where it stood), and what a card brings has set places, the next card on its right.
    bool walk() const;

private:
    Vec2 home(const TreeNode& n, const TreeNode& host) const;

public:
    /// Where a card shows, given the layer you work on.
    /// - Asked about, and its group's layer is in view: in the middle of its group, on that layer.
    /// - Its group's layer is nearer than the one you work on: at home, and its group condensed round it.
    /// - Its own layer is nearer than the one you work on: small, huddled
    ///   round the card it came back to, if it matters enough; else put away into that card.
    Seat seat(const TreeNode& n) const;

    /// A layer, and a place on it.
    struct Place {
        int depth;
        Vec2 xy;
    };

    /// Where a card shows: nil when it is put away.
    std::optional<Place> shown(const TreeNode& n) const;

    /// Whether a card shows as part of a condensed group.
    bool condensed(const TreeNode& n) const;

    /// Where a card lies with every layer open: for a picture of the whole
    /// tree. Its layer, and where it stands from its group's first card.
    std::optional<Place> flat(const TreeNode& n) const;

    /// A group's first card whose layer is nearer than the one you work on.
    bool folded(const TreeNode& n) const { return n.head && generation(n.id) > standDepth(); }

private:
    std::vector<int> heads(int id) const;

public:
    /// The cards that hang from `id` without a group of their own between (in a tree kept before every question made a layer).
    std::vector<int> riders(int id) const;

    // MARK: - Asking, focus, and layers

    /// The card in focus, if one is.
    std::optional<int> focus() const { return focused ? std::optional<int>(current) : std::nullopt; }

    /// Everything the gardener brings is simply there now; this only marks an older tree's suggestion as taken.
    bool confirm(int id);

    /// What a step brought and what it took away.
    struct Change {
        std::vector<int> added;
        std::vector<TreeNode> gone;
    };

    /// Asks about a card, or goes back to one that was asked: it becomes
    /// the first card of a group on the next layer, opens there, and that
    /// layer is the one you work on. The first time, what the gardener
    /// brings for it comes up round it. Returns what came.
    Change focus(int id);
    /// AGENT: the cards already hanging from `id`, a card that has just come to lead its layer from where it stood at `was`,
    /// placed round it again in its own frame, each in the first free place on its ring as if it came now (`focus`).
    void placeRound(int id, Vec2 was);
    /// AGENT: makes `id`, a card with cards under it, the first card of their group on the layer after its own: a branch, as
    /// `settle` makes every such card of an older tree. Its cards are placed round it (`placeRound`). Nothing changes for a
    /// card that leads already, or has no cards. Whether it leads now.
    bool lead(int id);

    /// Steps out of the card in focus: it closes, and its group draws in.
    std::vector<TreeNode> unfocus();

    /// Stands on a layer in line, with its first card in focus. (`go(toLayer:)`)
    std::optional<Change> go(int head);

    /// One layer toward the root, or back out along the layers in line.
    std::optional<Change> stepBack();

    std::optional<Change> stepForward();

    /// Brings something in by hand, beside the open card.
    std::optional<int> attach(const Ref& ref, const std::string& why = "Brought in by you");

    /// Something an answer points to, and why.
    struct Pointing {
        Ref ref;
        std::string why;
    };
    /// An answer's node, and what came with it.
    struct Asked {
        int id;
        std::vector<int> added;
        std::vector<TreeNode> gone;
    };

    /// A question put to the gardener about the card in focus. Its answer
    /// (a note) comes back into that card's group and is asked in turn: it
    /// rises to the next layer, where what it points to that the tree
    /// doesn't hold yet stands round it; what the tree already holds is
    /// tied to it across the tree. Returns the answer's node and what came.
    std::optional<Asked> ask(const Ref& answer, const std::vector<Pointing>& links, const std::string& why = "You asked");

    /// Cuts `id` away, with everything grown from it. Returns what left.
    std::vector<TreeNode> prune(int id);

    // AGENT: a tree the agent service grows (core/agent/bridge.*). Its nodes come from the service, so
    // focusing a card does not ask the catalog, and they are placed here the way the gardener's are.
    /// Whether focusing a card asks the catalog for what to set round it.
    bool grows = true;
    /// Hangs `ref` from `parent` in the next free place round it. Returns its id, or -1 if `parent` is not here.
    int graft(const Ref& ref, int parent, const std::string& why, Tone tone, bool kept, std::optional<float> imp);
    /// What a node says on its thread, whether it is kept, and how much it matters.
    void revise(int id, const std::string& why, bool kept, std::optional<float> imp);
    /// Opens a card where it stands, to show what it holds, without starting a layer from it.
    bool open(int id);

    /// Puts a card somewhere else in its group, by hand. Returns what moved.
    std::vector<int> place(int id, Vec2 xy);

    // MARK: - Layout

    /// Half the open card's width, and how far it reaches up and down.
    struct Extent {
        float half, up, down;
    };
    Extent openExtent(const Ref& ref) const;

private:
    struct Ring {
        Vec2 center;
        Vec2 axes;
    };
    Ring ring(const TreeNode& n) const;

    /// Where a card is on the sheet its children lie on.
    Vec2 center(const TreeNode& n) const { return n.head ? Vec2::zero() : n.xy; }

    /// Everything already lying on the sheet that `id`'s children would lie on.
    std::vector<Vec2> neighbors(int sheet, int id) const;

    /// Places still free around a card. The first nine are the ring the
    /// gardener fills; with `outer`, nine more follow on a wider ring. A
    /// place is not free if something already lies there, or if it is
    /// straight below the layer's first card, where the path runs down to
    /// the earlier layers.
    std::vector<int> freeSlots(int id, bool outer = false) const;

    float angle(int slot) const;

    float wrap(float deg) const;

    Vec2 spot(int slot, const TreeNode& n) const;

    int add(const Ref& ref, int parent, const std::string& why, Tone tone, bool chip, int slot);

    /// Where a tag stands when it is the reason for some of the
    /// suggestions: out on the way to them, just clear of the open card, so
    /// their threads run through it and it is said once.
    Vec2 junction(const std::string& title, const TreeNode& n, const std::vector<Vec2>& targets) const;

    /// The gardener's suggestions around the card in focus. Those that are
    /// there for the same reason stand side by side, and a tag that is the
    /// reason stands on the way to them instead of beside the card.
    std::vector<int> grow(int id);

    // MARK: - Condensing

    /// Which cards of a group stay when it condenses: every card that was
    /// asked about, since it carries a branch, then the most important of the rest.
    std::vector<TreeNode> stays(const TreeNode& p, int level) const;

    /// A condensed group huddles: each card that stays keeps its direction
    /// from the middle card and moves in until it nearly touches. One with a
    /// huddle of its own brings that whole huddle with it. `scale` is the
    /// middle card's; `level` is 1 for a huddle on the layer you work on, 2
    /// for one nested in it.
    std::map<int, Vec2> huddle(const TreeNode& p, float scale, int level) const;

public:
    /// The room a card takes at home: itself, and its huddle if it has been asked about.
    Box foot(const TreeNode& c, float scale, int level) const;

    // MARK: - Where groups stand

private:
    struct Group {
        TreeNode node;
        std::vector<Box> boxes;     // its cards, round its own place
        Vec2 at;
    };

    /// A group's cards, round its first card. On the layer you work on, a
    /// card that has been asked about is given the room its huddle needs;
    /// on any other, the group is as it was before that card was asked.
    std::vector<Box> boxes(const TreeNode& h, int top) const;

    /// The direction in which two branches first parted: from the one card
    /// to the other, in the last group their lines of questions share.
    Vec2 parted(int a, int b) const;

    /// Moves the groups of one layer apart, all together. Two groups only
    /// ever part along the direction their branches first parted, and one
    /// that has ended up on the wrong side of another along that direction
    /// is brought back across: a branch keeps its side, and no group hops
    /// over another to find room. Heavier groups give way less.
    void part(std::vector<Group>& g) const;

public:
    /// Works out where every group stands, layer by layer from the first,
    /// since each layer stands on the one below; then every branch's colour.
    /// It depends on which layer you work on and which card is open, and is
    /// done again whenever either changes.
    void relayout();

private:
    /// Chroma separation. The first branch is white. When more than one
    /// card of a group has been asked about, the group's colour comes apart
    /// into theirs: each is a step away from it, in directions spread evenly
    /// round it and to either side of the way the group itself was heading,
    /// so that mixed again they give the colour they came from. The step
    /// shrinks a little with each split but never to nothing.
    void tint();

public:
    /// A card's colour, linear RGB: its branch's.
    Vec3 color(int id) const;

    // MARK: - Keeping

    /// A tree as it is kept between runs.
    struct Saved {
        std::string title;
        Maker maker = Maker::gardener;
        bool sent = false;
        std::vector<TreeNode> nodes;
        int current = 0;
        int stand = 0;
        std::vector<int> route;
        std::vector<Link> links;
        int nextID = 0;
        std::vector<OceanNote> notes;       // the gardener's answers it holds, which the library doesn't

        /// Every key has to be there, as Swift's own decoding has it.
        static std::optional<Saved> from(const Json& j);
        Json json() const;
    };

    Saved saved() const;

    /// `init?(_ s: Saved, catalog:)`
    static std::shared_ptr<Tree> make(const Saved& s, const std::shared_ptr<Catalog>& catalog);

private:
    /// For `make`: a tree with nothing in it yet.
    explicit Tree(const std::shared_ptr<Catalog>& catalog) : catalog(catalog) {}

    /// A tree kept before every question made a layer is brought into line:
    /// what was only suggested is simply there, and any card with cards of
    /// its own is the first card of their group, with them placed from it.
    void settle();

public:
    /// A saved tree's steps, walked again: each is asked about where the
    /// gardener brought it (or brought in by hand where it didn't).
    static std::shared_ptr<Tree> replay(const SavedSpec& spec, const std::shared_ptr<Catalog>& catalog);
};
