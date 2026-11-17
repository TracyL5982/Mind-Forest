// Port of visionos/MindPalace/Ocean/OceanModel.swift.
//
// The implementation is in several files, along the Swift's `// MARK:` sections and in its order:
//   oceanmodel.cpp          start, Setup, Frame, Glass, The grid under the layers, What the hands
//                           are read as, The small tree by hand, Panning by hand
//   oceanmodel_cards.cpp    Cards
//   oceanmodel_threads.cpp  Threads
//   oceanmodel_tree.cpp     Starting, picking, layers; Placing by hand; Marking; The ocean: peeking and bringing in
//   oceanmodel_press.cpp    Pressing; The shelf of covers; The strip
//   oceanmodel_flags.cpp    Pinches; Hands; Launch flags
#pragma once
#include <algorithm>
#include <array>
#include <cstdio>
#include <functional>
#include <limits>
#include <map>
#include <memory>
#include <optional>
#include <set>
#include <string>
#include <utility>
#include <vector>

#include "../base.h"
#include "../json.h"
#include "../vecmath.h"
#include "../scene.h"
#include "../platform.h"
#include "../canvas.h"
#include "stage.h"
#include "library.h"
#include "catalog.h"
#include "tree.h"
#include "hands.h"
#include "art.h"
#include "shapes.h"
#include "grid.h"
#include "threads.h"
#include "desk.h"
#include "gravel.h"
#include "hologram.h"
#include "handglow.h"
#include "guide.h"
#include "bend.h"
#include "shell.h"
#include "cardview.h"

/// The ocean mode. Under you, out to the horizon, lies the ocean: dust that
/// stands for everything the agent remembers. One tree at a time rises out
/// of it: the part of that memory in play for one brief.
///
/// - A tree starts three ways: pick one of the gardener's briefs, pick a
///   saved tree's cover off the shelf, or pick a film out of the ocean.
/// - Every question makes the next layer. Picking a card asks about it: it
///   rises to the next layer, nearer to you, the gardener thinks for a
///   moment, and what it brings stands round the card. Every card asked from
///   the same layer shares that next layer, each group on its own pane of
///   glass by the card it came from. The layers behind tip back and sink
///   toward the ocean like sheets on a drafting table.
/// - The first branch is white; its colour comes apart at every split.
/// - Stepping back, the groups of nearer layers condense onto the cards they
///   came from, small and floating a little off the sheet, two layers deep.
///   A pinch anywhere on one goes to its layer.
/// - Part of an open card can be marked (words, a stretch of a video, part
///   of a picture) and asked about on its own.
/// - A film lifted from the ocean first comes only close enough to see what
///   it is. A thread cut with the flat of the hand sends a branch back.
/// - Pressing the tree (the clap) flattens it into one card, which leaves for
///   the tray (sent) or the shelf (put away). The shelf survives a relaunch.
///
/// Small things a hand causes are quick; anything that moves the whole
/// tree glides. Nothing moves because the head did.
// AGENT: the agent service's bridge (core/agent/bridge.h), and the preview of Momo's presence (core/agent/presence_demo.h),
// reach the scene's insides as friends.
namespace agent {
class Bridge;
class EchoCheck;
class PresenceDemo;
}

class OceanModel : public PalaceScene {
public:
    friend class agent::Bridge;
    friend class agent::PresenceDemo;
    friend class agent::EchoCheck;
    std::shared_ptr<agent::Bridge> agentBridge;     // AGENT: only with -agent
    std::shared_ptr<agent::PresenceDemo> presenceDemo;     // AGENT: only with -presenceDemo
    std::shared_ptr<agent::EchoCheck> echoCheck;     // AGENT: only with -echoCheck
    // NOTE(port): `root` in the Swift. PalaceScene asks for it as a function, so the field takes an underscore.
    EntityRef root_ = Entity::make();
    EntityRef root() override { return root_; }
    // NOTE(port): no `subscription`: the host calls `update` itself, once a frame.

    ~OceanModel() override;

private:
    using CardRef = std::shared_ptr<CardView>;
    using TreeRef = std::shared_ptr<Tree>;

    // NOTE(port): the Swift makes several small dictionaries and sets afresh on every frame the
    // tree moves (in `layout` and `drawThreads`). As std::map and std::set each entry would be a
    // piece of memory asked for and given back, every frame, which the Swift's are not. These two
    // keep their entries in one row, in key order, and the model holds on to them from frame to
    // frame: once a row has been as long before, filling it again asks for nothing.
    template <class V>
    struct Scratch {
        std::vector<std::pair<int, V>> items;       // in key order

        void clear() { items.clear(); }
        bool empty() const { return items.empty(); }
        /// `d[key]`, to read or to change: null when it isn't there.
        V* find(int key) {
            auto it = lower(key);
            return it != items.end() && it->first == key ? &it->second : nullptr;
        }
        const V* find(int key) const { return const_cast<Scratch*>(this)->find(key); }
        bool contains(int key) const { return find(key) != nullptr; }
        /// `d[key] = value`
        void set(int key, const V& value) {
            auto it = lower(key);
            if (it != items.end() && it->first == key) it->second = value; else items.insert(it, {key, value});
        }

    private:
        typename std::vector<std::pair<int, V>>::iterator lower(int key) {
            return std::lower_bound(items.begin(), items.end(), key, [](const std::pair<int, V>& a, int k) { return a.first < k; });
        }
    };
    struct ScratchSet {
        std::vector<int> items;                     // in order

        void clear() { items.clear(); }
        bool contains(int key) const { return std::binary_search(items.begin(), items.end(), key); }
        void insert(int key) {
            auto it = std::lower_bound(items.begin(), items.end(), key);
            if (it == items.end() || *it != key) items.insert(it, key);
        }
    };

    // NOTE(port): no `tracker`: HeadTracker().transform() is platform::head().
    std::shared_ptr<Hands> hands = std::make_shared<Hands>();
    Stage stage;
    std::shared_ptr<Art> art;
    std::shared_ptr<Catalog> catalog;
    std::shared_ptr<ClipLibrary> library;
    std::shared_ptr<Shell> shell;
    std::shared_ptr<Threads> threads;
    std::shared_ptr<PaneMesh> panes;                    // the glass under the groups that lie on their sheets
    std::shared_ptr<PaneMesh> floatingPanes;            // and under the condensed ones, which float
    std::optional<Material> lineMaterial;
    std::optional<Material> dustMaterial;
    std::optional<Material> gazeMaterial;               // the light around a card that is looked at
    Tween<float> stirred{0.f};                          // how far the ocean has been stirred, one per thing that happens
    std::shared_ptr<Screen> screen = std::make_shared<Screen>(Flags::has("mute"));
    std::optional<int> screenNode;                      // the card the video plays on
    bool built = false;
    bool loaded = false;

    // The standing tree.
    TreeRef tree;
    std::map<int, CardRef> cards;
    std::vector<CardRef> leaving;
    std::vector<int> buildQueue;
    // NOTE(port): added for Quest (see `update` and `showFull`): how many frames a work's small card
    // has waited for its picture to be unpacked, and the open works whose full picture is on its way.
    std::map<int, int> buildWaited;
    // NOTE(port): added for Quest. A card that is waiting its turn to be built (or for its picture to be
    // unpacked) shows where it will be, as a faint film of light the size it will have, once it has
    // waited long enough to be noticed (the renderer's placeholder, render.h). Each card's, by its id.
    std::map<int, EntityRef> ghosts;
    // NOTE(port): added for Quest (see `stand`): the cards of a tree just stood up that are still to be
    // made, each with the moment it is due to appear, and which tree they are for.
    struct StandWaiting {
        int id;
        double due;
    };
    std::vector<StandWaiting> standQueue;
    size_t standNext = 0;
    const Tree* standTree = nullptr;
    void standMore();
    std::vector<int> fullWaiting;
    void finishFull(int id);
    Tween<Vec2> pan{Vec2::zero()};                      // the open card's place on its layer: it is kept in the middle
    Tween<float> focusLevel{0.f};                       // the layer you work on, counted from the root's
    /// (The Swift's `(thread: Threads.Thread, child: Int)`.)
    struct Drawn {
        Threads::Thread thread;
        int child;
    };
    std::vector<Drawn> drawn;
    /// How far a thread's middle bows from the straight line between its
    /// ends: a gentle arc, moved aside where it would cross the open card.
    /// It eases to a new bow and never swings or overshoots.
    struct Strand {
        Vec3 p;                             // the bow, from the middle of the straight line
        Vec3 v = Vec3::zero();
    };
    Scratch<Strand> strands;
    /// A line of words standing in the room, and what it says: the Swift's `(entity: ModelEntity, words: String)`.
    struct Label {
        EntityRef entity;
        std::string words;
    };
    std::map<int, Label> labels;
    std::map<int, float> labelSize;                     // how large each label shows now: they grow and fade, never blink
    std::optional<int> panStand;                        // the layer the view was last settled on
    /// How each layer in line lies in the view, on its way to where it belongs: for the grid drawn under it.
    struct SheetState {
        Tween<Vec2> origin;
        Tween<float> gather;
        Tween<float> pan;
    };
    std::map<int, SheetState> sheetStates;
    std::map<int, std::shared_ptr<SheetGrid>> grids;
    std::vector<std::shared_ptr<SheetGrid>> spareGrids;
    Tween<float> gridAwake{0.f};                        // 1 while the tree is being moved: the grid's lines show
    double gridUntil = 0.0;
    bool pressing = false;
    Tween<float> zoom{0.f};                             // into the open card: 0 as it opens … 1 filling much of the view

public:
    static constexpr float zoomGrowth = 2.0f;           // at full zoom the open card is three times its size
    /// m: a card stays flat while its layer's curve would move its sides less than this. Every
    /// small card does (a small film's sides would move 2.4 mm), so only open cards are worked on.
    static constexpr float flatWithin = 0.004f;
    static bool flatCards() { static const bool v = Flags::has("flatCards"); return v; }    // leaves every card flat, to compare

private:
    EntityRef treeRoot = Entity::make();

    // What a hand has marked on a card, and the mark being drawn.
    std::map<int, Mark> marks;
    struct MarkKind {
        enum class Kind { words, time, region };
        Kind kind = Kind::time;
        int block = 0;                      // words: which of the note's blocks of text
        static MarkKind words(int block) { return {Kind::words, block}; }
        static MarkKind time() { return {Kind::time, 0}; }
        static MarkKind region() { return {Kind::region, 0}; }
    };
    /// (The Swift's `(id: Int, kind: MarkKind, from: SIMD2<Float>, to: SIMD2<Float>, made: Mark?, words: String)`.)
    struct Marking {
        int id;
        MarkKind kind;
        Vec2 from;
        Vec2 to;
        std::optional<Mark> made;
        std::string words;
    };
    std::optional<Marking> marking;
    // NOTE(port): added for Quest. A drag on the open card no longer marks it by itself: gone into, the card
    // shows what it can be marked with (a stretch of its video, part of its picture, some of its words) as
    // buttons over it, and a drag marks with the one picked. A mark can be taken off again.
    // NOTE(port): changed for Quest (2026-11-15, Kai): three icons at the picture's top right corner. The pen:
    // while it is on, a drag on the card marks it, as what was under where the drag began would have it (a
    // picture is drawn on, words are highlighted, a video's stretch is taken). The eraser takes the mark off.
    // Send asks about what is marked.
    bool penOn = false;
    EntityRef tools;                                    // the buttons over it
    std::vector<const Entity*> toolPicks;
    std::string toolsKey;
    float toolsTall = 0;                                // how tall their column is, m
    static constexpr float toolSize = 0.1f;             // one of them, m across (they keep this size as the card grows)
    static constexpr float toolGap = 0.014f;
    // NOTE(port): each has a tag, in the labels' own flat form, that comes out to its right while a hand's ray
    // rests on it and says what it is for: Comment, Erase, Send to Momo.
    struct ToolTag {
        EntityRef button, tag;
        float wide = 0;
    };
    std::vector<ToolTag> toolTags;
    float toolOut[3] = {0, 0, 0};                       // how far out each tag is, 0…1 (kept while the buttons are made again)
    double toolsMadeAt = 0, toolsLast = 0;
    // NOTE(port): added for Quest. A picture is marked as with a marker: the tool in hand, a pinch held and
    // moved draws on it freely, stroke after stroke, in the accent. What is marked (what the gardener is
    // asked about) is the part of the picture the strokes cover between them.
    struct Ink {
        std::vector<std::vector<Vec2>> strokes;         // each a line on the card's open face, m from its middle
        LowLevelMeshRef mesh;
        EntityRef entity;
        float curve = 0;                                // the card's bend it was last drawn to
    };
    std::map<int, Ink> inks;
    /// Draws a card's strokes.
    void drawInk(CardView& c, Ink& ink);
    /// What a card can be marked with.
    std::vector<Mark::Kind> markKinds(const CardView& c) const;
    /// How long the card's video is, s.
    double markDuration(const CardView& c) const;
    /// Keeps the buttons over the card gone into as they should be: there, gone, lit.
    void layTools();
    /// A pinch on one of them: a tool taken up or put down (0 words, 1 a stretch of video, 2 part of a picture), or the mark removed (3).
    void pickTool(int id, int what);
    void clearMark(int id);

    // MARK: - Cutting (oceanmodel_cut.cpp)

    // NOTE(port): added for Quest. A thread is not cut at once. A slice of the flat hand, or a pinch on
    // the thread, marks it for cutting: it turns to the accent and "Cut again to confirm" stands on it for a few seconds.
    // A second slice across it, or a pinch on those words, cuts it; anything else lets it be.
    struct CutArmed {
        int child = 0;                  // the card the thread runs to
        Vec3 at;                        // where on it
        double until = 0;
        EntityRef chip;
    };
    std::optional<CutArmed> cutArmed;
    std::map<int, EntityRef> threadHits;                // what a hand's ray finds a thread by, by the card it runs to
    int threadHitsTick = 0;
    float bladeGlow[2] = {0, 0};                        // how much each hand shows as a blade
    Hands::Blade bladeLast[2];
    bool bladeOut[2] = {false, false};                  // the blade is out on this hand: its pointer is put away
    double bladeOutAt[2] = {-10, -10};
    struct BladeMark {
        double at;
        Vec3 on;
    };
    std::vector<BladeMark> bladeTrail[2];               // where each blade's point has been on the sheet, this last moment
    /// Where a line from `from` through `through` meets the layer you work on, a little in front of it.
    std::optional<Vec3> onSheet(Vec3 from, Vec3 through, float lift = 0.02f) const;
    /// The frame a fist is read in as it closes at `hand`: the surface in front of it (hands.h).
    std::optional<Hands::Surface> fistSurface(Vec3 hand) const;
    /// The points along the thread that runs to `child`; empty if none is drawn.
    std::vector<Vec3> threadLine(int child) const;
    /// The thread a blade's point is at, as you see it, and where on it.
    std::optional<std::pair<int, Vec3>> threadAimed(Vec3 point) const;
    void layThreadHits();
    void armCut(int child, Vec3 at);
    void disarmCut();
    void confirmCut();
    void updateCut(double now, float dt);

    // Everything else that moves: the peeked film, pressed trees, the shelf.
    class Mover {
    public:
        const EntityRef entity;
        Tween<Vec3> position;
        Tween<float> scale;
        Tween<float> alpha{1.f};
        double removeAt = std::numeric_limits<double>::infinity();
        float shownAlpha = -1;
        Mover(const EntityRef& e, Vec3 p, float s) : entity(e), position(p), scale(s) {}
    };
    using MoverRef = std::shared_ptr<Mover>;
    std::vector<MoverRef> movers;
    /// (The Swift's `(film: Int, mover: Mover, width: Float)`.)
    struct Peek {
        int film;
        MoverRef mover;
        float width;
    };
    std::optional<Peek> peek;                           // a film or a work, by its place among the pieces
    std::vector<int> fullPictures;                      // cards showing a work from its own file, oldest first

    // NOTE(port): added for Quest: a picture on a cover, and the card it stands for.
    struct CoverPicture {
        int id;                             // the card
        Ref ref;                            // the film or the work (AGENT: or a service card, whose own picture it shows)
        EntityRef entity;
        float width;                        // m, in the cover's own measure
        Vec3 at;                            // where it floats, m from the cover's middle, before it is drawn in to the trunk
        float height = 0;
        double since = -1;                  // AGENT: when it began to wait for a service card's picture (-1: it shows)
    };
    // NOTE(port): added for Quest, at Kai's word (2026-11-15): on a tree that stands on the desk the
    // pictures are 0.65 of the size the Swift gives them and as much nearer the trunk ("too large, and
    // they don't huddle close enough to the tree"); on one that lies on the ocean's floor, 0.75.
    static constexpr float huddleUp = 0.65f;
    static constexpr float huddleDown = 0.75f;
    struct Shelved {
        int uid;
        TreeRef tree;
        MoverRef mover;
        std::vector<EntityRef> tilts;       // its pictures and its name, tipped to face you
        Vec2 spot;                          // degrees right of ahead, and up
        // NOTE(port): added for Quest. A tree put away stands on the desk (oceanmodel_desk.cpp): where on
        // it (Desk::plot), and how far its cover's middle is above its foot, in the cover's own measure.
        Vec2 plot = Vec2::zero();
        float foot = 0;
        // Its parts, for when it opens (see `unfold`): the tree of light, the name, each picture and the
        // card it stands for; how its tree is drawn; and how far its pictures are tipped, on its way
        // between the desk and the ocean's floor.
        EntityRef branches, caption;
        std::vector<CoverPicture> pictures;
        // AGENT: the boxes of its tree, which those of its pictures and name join, for pointing at it (`coverCollision`);
        // and the pictures left off for being late, until they come (`tendCovers`).
        std::vector<Shape> trunk;
        std::vector<Ref> late;
        int layers = 1;
        float treeFoot = 0.03f, treeRise = 0.055f;
        Tween<float> el{0.f};
        // How far its pictures are drawn in to the trunk and how small (1: as the cover was made), and the
        // rings on the ground round its foot.
        Tween<float> huddle{1.f};
        std::shared_ptr<Gravel> gravel;
        // How far its rings have spread from its foot (0 none … 1 all), and when they are to spread
        // again: they draw back in before it leaves a place and spread when it has come to the next.
        Tween<float> ripple{1.f};
        double rippleAgainAt = 0;
        // Ground other trees' rings have, for when its own are next raked: one tree is raked a frame
        // (about a millisecond on the headset), not the whole forest in the frame a tree opens.
        std::vector<Gravel::Cut> cuts;
        bool rakeDue = false;
        Vec2 nameSize = Vec2::zero();       // its name's plate, m in the cover's own measure: it is made smaller with the pictures
        // Coming down from the layer it was pressed on, it turns from that layer's facing to its own.
        Quat turnFrom, turnTo;
        double turnStart = 0;
        float turnOver = 0;
    };
    std::vector<Shelved> shelf;
    int nextUID = 0;
    int trayCount = 0;
    std::optional<Vec2> standingSpot;                   // where the standing tree's cover hung, if it had one
    std::optional<Vec2> standingPlot;                   // NOTE(port): added for Quest: and where it stood on the desk
    bool shelfDirty = false;
    bool shelfLoaded = false;

    EntityRef strip = Entity::make();
    std::string stripKey;

    // MARK: The desk (oceanmodel_desk.cpp)
    // NOTE(port): added for Quest; nothing of it is in the Swift. The scene is seated at a desk: the
    // table the headset knows in front of you, squared to its near edge, or one assumed where a desk
    // usually is (desk.h). The small tree stands on it right in front of you, the trees put away
    // behind it as a forest, what can be done with the standing tree to the right. The scene's own
    // space never changes (`stage` is made once): when you have turned or moved away it can be
    // brought to where you are now, which the host does by laying the scene's space somewhere else
    // in the room (platform::carryScene).
    Desk desk;
    std::vector<Vec2> plots;                            // where trees put away may stand on it, the best first
    EntityRef trayEntity;
    /// Chooses where the scene sits, from the head and the tables the headset knows. Once, in `build`.
    void sit();
    /// How far back from the desk's near edge the small tree stands, m.
    float treeBack() const;
    Vec2 controlsPlot() const;
    Vec2 trayPlot() const;
    /// How high the gardener's briefs stand, in degrees up from eye level: clear of the forest's tops.
    float briefsEl() const;
    /// Square to the desk's edge and tipped up to the eyes: how a label that stands on the desk at `p` is turned.
    Quat deskFacing(Vec3 p) const;
    /// How much smaller the tray is on the desk than where the Swift hangs it, further off.
    static constexpr float trayScale = 0.7f;
    /// Works out the forest's places for the desk as it is now.
    void plantForest();
    /// Where a tree put away stands with its foot on the desk at `plot`: the place of its cover's middle.
    Vec3 plantPoint(Vec2 plot, float foot) const;
    /// How far below a cover the eyes are, as `tip` wants it (degrees; negative, the eyes being above).
    float plantEl(Vec2 plot) const;
    /// The first of the forest's places with no tree near it.
    Vec2 freePlot() const;
    /// Stands everything that belongs on the desk where the desk now is.
    void layDesk();

    // The forest's two states. While no tree is open the trees put away stand on the desk, a little
    // larger and with more of their pictures. When one opens (or a new one is started) the others
    // shrink and sink to the ocean's floor, out of the way and out of the hand rays' reach; they rise
    // again when the open one is put away. The one that opens goes to where the small tree stands and
    // becomes it, and its pictures rise to their cards' places on the layers.
    bool forestDown = false;
    bool standPending = false;                          // a tree is making way for another: the forest stays down between the two
    // NOTE(port): and while the greeting after the walk has the room (oceanmodel_guide.cpp): it stands alone, and
    // the kept trees come up to the desk when it goes.
    bool wantDown() const { return tree != nullptr || standPending || teach.home != nullptr || teach.homeDue; }
    /// How far back from the desk's near edge the forest begins.
    /// (Its nearest trees stand a metre ahead of the eyes: twice as far as at first, at Kai's word on
    /// 2026-11-15. On an ordinary desk that is past its far edge, at the desk's height.)
    /// (Then a metre and a half, with trees a metre tall: "assume we have a pretty big desk".)
    float forestNear() const { return std::max(0.3f, 1.5f + desk.plot(stage.origin).y); }
    /// Whether a place is as far from the eyes as a tree must stand (a place kept from an earlier day, or one a hand carries a tree to, may not be).
    bool farEnough(Vec2 plot) const { return distance(plot, desk.plot(stage.origin)) >= 1.45f; }
    /// Where a put-away tree's cover rests, and how its pictures are tipped there (see `tip`): on the desk, or on the floor under its place.
    Vec3 restPoint(Vec2 plot, float foot, bool down) const;
    float restEl(Vec2 plot, bool down) const;
    void settle(Shelved& s, bool down, double delay);
    /// Each frame: sinks or raises the forest when a tree has come to stand or has gone.
    void watchForest();
    /// Each frame something moves: the opening tree's turn and squash, and the tips of covers on their way.
    void tendForest(double now);
    /// Puts a cover's pictures where they float when drawn in by `k` (see `huddleUp`).
    static void layPictures(const std::vector<CoverPicture>& pictures, float k);
    /// And its name with them: as much smaller, still standing on the ground before the tree's foot.
    static void layName(const EntityRef& caption, Vec2 size, float foot, float k);
    /// Rakes every tree's rings (gravel.h) for where the trees stand, or are on their way to: where two
    /// trees' rings would cross, the further tree's stop short of the nearer one's.
    void rakeForest();
    /// How many of a cover's pictures still show on the ocean's floor.
    static constexpr size_t usualPictures = 5;
    /// A picture left standing where its cover was, until its card takes its place and rises.
    struct Rising {
        EntityRef thumb;
        Vec3 at;
        Quat turn;
        float width;                    // m, as it stands
        Ref ref;
        int order;                      // which lifts off first
    };
    std::map<int, Rising> rising;
    /// The cover on its way to becoming the small tree: it turns to face as the small tree does, and
    /// its tree is squashed to the small tree's height, so the one gives way to the other in place.
    struct Becoming {
        MoverRef mover;
        EntityRef branches;
        Tween<float> squash{1.f};
        Quat from, to;
        double start = 0;
        float over = 0.75f;
    };
    std::optional<Becoming> becoming;
    double holoShowAt = 0;                              // when the small tree is to begin to show
    double coverLandsAt = 0;                            // when the cover now coming down to the desk is there
    bool holoHiding = false;
    void hideHologram();
    /// Brings something to an opacity over a moment, and leaves it there.
    void fadeTo(const EntityRef& e, float to, double delay, float over);
    /// Brings the whole scene to where you are now: it fades, is laid there, and comes back.
    void reseat(const std::string& why);
    bool reseating = false;
    Tween<float> veil_{1.f};                            // how much of the whole scene shows while it is carried
    float veilNow = 1;
    float veil() override { return veilNow; }
    double handsStillUntil = 0.0;                       // the hands jump with the scene: nothing is read from them until then
    double seatedAt = 0.0;
    /// Watches for the user having turned or moved away, and offers to bring everything along.
    void watchSeat(float dt);
    struct SeatPrompt {
        EntityRef entity;
        std::vector<const Entity*> picks;
        double unseenSince = -1;                        // since when it has been out of view
        MoverRef mover;                                 // it comes up a little as it appears
        bool held = false;                              // shown by `-seatPromptAt`: it stays though you never left
    };
    std::optional<SeatPrompt> seatPrompt;
    double awaySince = -1, backSince = -1;
    bool seatDeclined = false;                          // "leave it" was answered: not asked again until you have been back
    void showSeatPrompt(bool held = false);
    void hideSeatPrompt();
    /// Launch flags: `-noDesk` (never a real table), `-noSeatPrompt`, `-reseatAt <s>`, `-seatPromptAt <s>`.
    static bool noDesk() { static const bool v = Flags::has("noDesk"); return v; }
    /// The whole tree, small and within reach: where you are in it, and the way to any other layer.
    std::shared_ptr<Hologram> hologram;
    // NOTE(port): added for Quest (handglow.h): light on the hands themselves, saying what a fist or a
    // finger on the small tree is doing; which hand is on the tree, and the level its finger last lit.
    std::shared_ptr<HandGlow> handGlow;
    int holoHand = -1;
    std::optional<int> holoLit;
    void drawHandGlow(double now, float dt);

    // MARK: - The guide: what teaches the hands (oceanmodel_guide.cpp)

    // NOTE(port): added for Quest; there is nothing like it in the Swift.
    /// A gesture a ghost hand teaches: whether it is known, how often it has been shown and left
    /// unlearned, since when its moment has been here, and until when it is left alone.
    struct GuideLesson {
        std::string id;
        double wait = 10;
        bool learned = false;
        int shown = 0;
        double readySince = -1, restUntil = 0;
    };
    /// A few words standing by something.
    struct GuidePin {
        EntityRef entity;
        int times = 0;
        double wantedSince = -1;
        bool done = false;
    };
    struct Teach {
        bool on = false;
        bool welcomed = false;              // the welcome has been left
        bool asked = false;                 // a card has been asked about, once
        std::shared_ptr<GuidePainter> painter;      // the one ghost hand: the welcome's, a lesson's or the sheet's
        std::shared_ptr<GuidePainter> marker;       // what the walk points with: lines only, in the room's own space
        EntityRef holder;                   // what it and its words hang from just now
        std::vector<const Entity*> picks;   // the buttons on it
        int mode = 0;                       // 0 nothing shows, 1 the welcome, 2 a lesson, 3 the sheet
        int lesson = -1;
        int sheetRow = 0;
        double began = 0;                   // when what shows came up
        double quietUntil = 0;              // no lesson before this
        double welcomeAt = 1.5;
        double handsGone = -1;              // since when no hand has been seen (the welcome asks for them)
        bool askedForHands = false;
        float carried = 0;                  // how far the tree has been carried by hand, in all, m
        double zoomedSince = -1;
        std::vector<GuideLesson> lessons;
        std::map<std::string, GuidePin> pins;
        // The welcome tree's walk (oceanmodel_guide.cpp).
        int tour = -1;                      // the lesson the walk has got to; -1 when there is no walk
        int tourBeat = 0;                   // how far through that lesson: pulling is two (pull, then push back)
        bool tourTook = false;              // a card was pinched this frame: the walk is wherever that card is
        int tourAdvanceFor = -1;            // the lesson that is finished and about to be left, and when
        double tourAdvanceAt = 0;
        double tourLast = 0;                // when the walk was last looked at
        float tourMarks = 0;                // how much what it points with shows
        EntityRef tourCaption;              // the line over the tree: where the walk is, and the one thing to do now
        std::string tourCaptionSaid, tourCaptionWords;
        Vec3 tourCaptionAt = Vec3::zero();
        EntityRef tourSpotPin;              // words by the place shown for "pinch empty space"
        std::string tourSpotSaid;
        EntityRef tourOffPanel;             // off the walk: said so, with the way back and the way out
        std::vector<const Entity*> tourOffPicks;
        int tourOffFor = -1;                // the lesson it offers the way back to; -1 when it is not up
        // The card after the walk: how to begin.
        EntityRef home;
        EntityRef homeTags[3];              // its numbers again, in the room, by the three things themselves
        std::vector<const Entity*> homePicks;
        bool homeDue = false;               // the walk is over: the card comes once nothing stands
        bool homeSeen = false;              // it has been shown and left
        double homeAfter = 0;
        double homeTagsUntil = 0;           // the numbers in the room outlast the card by a little
        // The walk's two steps with Momo (oceanmodel_guide.cpp, "Talking to Momo").
        int talkFor = -1;                   // the lesson whose words are waited for; -1 when none are
        double talkSince = 0;               // since when
        double talkWoke = -1;               // when the name was heard, while what follows it is awaited
        int talkMisses = 0;                 // turns that were nothing, or something else
        std::string talkNote;               // what is said about the last turn
        std::vector<std::pair<bool, std::string>> talkHeard;    // from Momo's ears: the name alone (true), or the words after it
        bool tourSent = false;              // the marked part was sent to Momo: what to say about it is waited for
        std::string tourMarkLinks;          // what the card Momo answers a sketch with points to (`tourMarkNote`)
        EntityRef talkPanel;                // what is said about it, with the way on without speaking
        std::vector<const Entity*> talkPicks;
        std::string talkPanelSaid;
        float talkPanelScale = 1;           // larger inside a picture gone into, where everything is
        float talkPanelLift = 0;            // how far up it stands, to keep its button clear of the line under it
        bool tourStood = false;             // its tree has stood
        bool tourDone[8] = {};              // which lessons the viewer has done
        int tourLessonWas = -2;             // the lesson in focus last frame, and since when it has been
        double tourLessonAt = 0;
        int tourTickFor = -1;               // the lesson just done, whose card shows a tick from the next time it is looked at
        double tourTick = -1;               // since when it has (-1: not yet)
        float tourCarried = 0;              // how far the tree has been carried on the walk, m
        int tourShown = -1;                 // where the ghost hand is: on lesson n's card; 100 + n on a card of its own; -1 nowhere
        double tourBegan = 0;               // when it was put there
        std::string tourKey;                // what a card of its own says under it
        EntityRef tourPin, tourNextPin, tourHandsPin;       // the pins: at a button that does the same, at the next card, and for hands
        std::string tourPinSaid, tourNextSaid, tourHandsSaid;
        double tourHandsGone = -1;          // since when no hand has been seen
        double tourWalkAt = 0;              // `-guideStep`: when the next card is taken
        bool scripted = false;              // the run is driven by flags: the welcome tree does not come by itself
        bool demoStarted = false;
        std::optional<std::string> demo;    // `-guideDemo`
        double demoT = -1;                  // `-guideT`
    };
    Teach teach;
    std::string guideURL();
    void loadGuide();
    void saveGuide();
    void startGuide();
    EntityRef guideHolder(float right, float down, float far);
    float guideWords(const EntityRef& holder, const std::optional<Piece>& piece, float x, float y, bool centred = false, int action = -1);
    void guideHand(const EntityRef& holder, Vec3 at, float size, float turned = 0);
    Vec3 guideBacking(const EntityRef& holder, Vec3 at, float size, float under, float opacity = 0.97f, float atLeast = 0);
    void hideGuide(float over = 0.2f);
    EntityRef lessonHolder(const std::string& id, float& size, float& tip);
    void showLesson(int index);
    bool onWelcomeTree() const;
    void addWelcomeNotes();
    void startTour();
    int tourLesson() const;
    CardRef tourCard(int lesson) const;
    /// The card in focus is the layer Momo made for its lesson.
    bool tourOnResult() const;
    std::optional<int> tourResultNode(int lesson) const;
    /// Whether Momo can hear: 0 ready, 1 starting, 2 the microphone is being asked for, 3 refused, 4 off, 5 no Momo here.
    int tourHearing() const;
    void tourTalk(int lesson, bool wanted, double now, std::optional<Vec3> at);
    void tourTalkPanel(const std::string& words, bool pill, std::optional<Vec3> at);
    void tourAnswer(int lesson, const std::string& words);
    void tourSend();
    void tourMarkNote(const std::string& words);
    std::string tourLine() const;
    Quat guideFacing(Vec3 p) const;
    void tourShow(int shown);
    void tourCaption(const std::string& chip, const std::string& words, std::optional<Vec3> at);
    EntityRef guideTag(const std::string& chip, const std::string& words, float size);
    void tourOff(std::optional<Vec3> at);
    void showHome();
    void closeHome();
    void clearHomeTags();
    void updateHome(double now);
    std::optional<int> tourNode(int lesson) const;
    bool tourPinchedOpen();
    void tourPin(EntityRef& pin, std::string& said, const std::string& words, std::optional<Vec3> at, float size = 0, const EntityRef& on = nullptr);
    void updateTour(double now, Vec3 eye);
    void tourDid(const std::string& did, float amount);
    void endTour(const char* why);
    void showSheet(int row);
    void guideAct(int action);
    bool guideReady(const GuideLesson& lesson) const;
    void guideDid(const char* what, float amount = 1);
    /// A place just over the open card, for a few words about it; none if no card is open.
    std::optional<Vec3> overOpenCard() const;
    void guidePin(const char* id, const char* words, bool wanted, Vec3 at, double wait, int most);
    void updateGuide(double now, float dt);
    // (A hand whose blade is out is a knife, not a pointer: one line on it, not two.)
    bool pointerHidden(int hand) override { return (holoTouching && hand == holoHand) || (hand >= 0 && hand < 2 && bladeOut[hand]); }

    // MARK: Sound (oceanmodel_sound.cpp)
    // NOTE(port): added for Quest: the visionOS app has no sounds of its own yet. The sounds are made
    // by quest/sound/synth.py and played by core/audio.h; what follows says when. Everything is in one
    // key. A layer has a chord, struck as you arrive on it; a single thing (a card that arrives, a
    // level of the small tree) has a single note. The head moving sounds one thing only: the
    // pieces of the ocean that swell where it points glint, as Kai asked on 2026-11-15.
    /// A sound, once: `gain` on top of its own, `after` seconds from now.
    void sound(const char* name, float gain = 1, double after = 0);
    /// The same, heard from where `at` is: a little to the left or the right. (`sound(_:at:)`)
    void soundAt(const char* name, Vec3 at, float gain = 1, double after = 0);
    /// A layer's chord, struck upward on coming nearer and downward on stepping back.
    void soundLayer(int layer, bool forward, double after = 0);
    /// One note for each card the gardener brings, up the chord of the layer they come to.
    void soundNotes(int count, double delay);
    /// A card's own note on its layer, a place on the ladder (note_00 … note_11): one of the layer's chord, by its
    /// place among its parent's cards. None for a card not on the tree.
    std::optional<int> cardNote(int id) const;
    /// A press on a card of the service's: "take" at the card's own note.
    void soundCard(int id);
    /// The cards the agent brings to a standing tree: each its own note, in one run however many batches they land in.
    void soundArrivals(const std::vector<int>& ids, double delay);
    double notesFree = 0;                               // when the next arriving card's note may sound, on `time`
    /// The note of a level of the small tree: its layer's root, a step higher for each level.
    void soundLevel(int level);
    /// What sounds for as long as something lasts: the ocean under everything, the gardener
    /// thinking, the next layer's chord as a fist nears its gate; and what is noticed by watching
    /// (the layer changed, a hand closed or opened, a finger moved on the small tree).
    void updateSound(double now);
    /// The ocean's pieces that have just swelled where the head points: a glint each, a few a second at most.
    void soundGlints(double now);
    /// `-oceanBed <0…2>`: how loud the ocean's held sound is, of what it is made at. `-glitter <0…3>`: the glints.
    static float bedLevel() { static const float v = Flags::has("oceanBed") ? float(Flags::number("oceanBed")) : 1; return v; }
    static float glitter() { static const float v = Flags::has("glitter") ? float(Flags::number("glitter")) : 1; return v; }
    std::vector<int> glintsWaiting;                     // pieces that have swelled and not yet been heard
    double glintAt = 0;                                 // when the next may be
    std::optional<Vec3> glintAim;                       // where the look was a frame ago
    float glintTravel = 0, glintNeed = 4;               // degrees the look has travelled since the last glint, and how many the next waits for
    uint32_t glintCount = 0;
    int glintNote = -1;
    void pointerLanded(int hand, const EntityRef& entity) override;
    const Tree* soundTree = nullptr;                    // the tree whose layer was last heard
    int soundDepth = 0;
    double soundLayerAfter = 0;                         // the next layer chord waits this long (a card is still on its way up)
    double thinkFrom = 0, thinkUntil = 0;
    bool conversing = false;                            // AGENT: Momo listens, thinks or speaks, and the ocean draws back
    double stirSounded = -100, landSounded = -100;
    const Entity* landedLast[2] = {nullptr, nullptr};   // the last two things a ray's arrival sounded on
    std::vector<HandGlow::Grab> fistsDrawn;             // the closed hands the gauge was last drawn for (`drawHandGlow`)
    bool fistSounding[2] = {false, false};
    std::string swelling;                               // the layer chord that is held now, for a fist nearing its gate
    std::optional<int> levelSounded;                    // the small tree's level last heard
    bool quietPress = false;                            // the tree is pressed only to make way for another
    // NOTE(port): added for Quest. The tree follows a carrying fist with some weight (see `panBy`):
    // where the fist has asked it to be, and whether it is still on its way there.
    Vec2 panAsked = Vec2::zero();
    bool panFollowing = false;
    void followPan(float dt);
    /// Seconds the tree takes to close most of the distance to a carrying fist (`-panWeight <s>`).
    static float panWeight() { static const float v = Flags::number("panWeight") > 0 ? float(Flags::number("panWeight")) : 0.16f; return v; }
    /// How far it runs on when let go, in seconds of the speed it had (`-panCoast <s>`); the Swift's is 0.15.
    static float panCoast() { static const float v = Flags::has("panCoast") ? float(Flags::number("panCoast")) : 0.05f; return v; }
    /// Degrees below where the headset points that the eyes rest (`-gazeDrop <degrees>`): what the ocean's zoom follows.
    static float gazeDrop() { static const float v = Flags::has("gazeDrop") ? float(Flags::number("gazeDrop")) : 15; return v; }
    bool holoTouching = false;                          // a hand is over it
    bool holoArmed = false;                             // that hand has been open since it arrived: its next pinch picks
    double holoRest = 0.0;                              // no hand counts before this: the one that just picked is still there
    std::optional<double> holoLeft;                     // when the hand last came away
    std::optional<Label> holoLabel;
    /// Small things on their way in or out: nothing appears or goes in one frame.
    /// (The Swift's `(entity: Entity, alpha: Tween<Float>, remove: Bool)`.)
    struct Fade {
        EntityRef entity;
        Tween<float> alpha;
        bool remove;
    };
    std::vector<Fade> fades;
    std::optional<int> zoomedFor;
    std::optional<float> magnifyBase;
    struct Pick {
        enum class Kind { card, speck, peek, brief, shelf, send, putAway, background, ask, askMark, openLink, reseat, stay, guide, tool, thread, cut };
        Kind kind = Kind::background;
        int index = 0;                      // card, ask, askMark, openLink: the card; speck: the piece; brief: which one; shelf: the cover's uid
        int question = 0;                   // ask: which of the card's questions

        static Pick card(int id) { return {Kind::card, id, 0}; }
        static Pick speck(int piece) { return {Kind::speck, piece, 0}; }
        static Pick peek() { return {Kind::peek, 0, 0}; }
        static Pick brief(int i) { return {Kind::brief, i, 0}; }
        static Pick shelf(int uid) { return {Kind::shelf, uid, 0}; }
        static Pick send() { return {Kind::send, 0, 0}; }
        static Pick putAway() { return {Kind::putAway, 0, 0}; }
        static Pick background() { return {Kind::background, 0, 0}; }
        static Pick ask(int id, int question) { return {Kind::ask, id, question}; }
        static Pick askMark(int id) { return {Kind::askMark, id, 0}; }
        static Pick openLink(int id) { return {Kind::openLink, id, 0}; }
        static Pick reseat() { return {Kind::reseat, 0, 0}; }
        static Pick stay() { return {Kind::stay, 0, 0}; }
        static Pick guide(int action) { return {Kind::guide, action, 0}; }
        static Pick tool(int id, int what) { return {Kind::tool, id, what}; }
        static Pick thread(int child) { return {Kind::thread, child, 0}; }
        static Pick cut(int child) { return {Kind::cut, child, 0}; }
    };
    // (Keyed by the entity's address: ObjectIdentifier.)
    std::map<const Entity*, Pick> picks;
    std::vector<const Entity*> stripPicks;

    /// (The Swift's `(pick: Pick, start: SIMD3<Float>, cancelled: Bool, riders: [Int])`.)
    struct Press {
        Pick pick;
        Vec3 start;
        bool cancelled;
        std::vector<int> riders;
        // NOTE(port): added for Quest (core/cards). Under `-cards` a pinch on the open card scrolls it, or, held still
        // first, asks for more like it, or with the pen up marks it: a highlight or a line the service keeps (`edit`), or a
        // mark of the headset's own (`mark`). When it began, where it is now, and what it was claimed for. A claimed pinch
        // is never a tap.
        enum class Claim { open, scroll, edit, mark, spent };
        double began = 0;
        Vec3 at = Vec3::zero();
        Claim claim = Claim::open;
        /// Scrolling: the offset, px, and the point on the face, m, where the scroll was claimed.
        float scrollFrom = 0;
        Vec2 scrollAt = Vec2::zero();
        bool lifted = false;                // NOTE(port): added for Quest: what is held has come away from its place (its sound has played)
        float reach = 0;                    // NOTE(port): added for Quest: the furthest it has been from where it began, m (see `pinchEnded`)
    };
    std::optional<Press> press;
    double time = 0.0;
    double busyUntil = 0.0;
    /// (The Swift's `(at: Double, run: () -> Void)`.)
    struct Scheduled {
        double at;
        std::function<void()> run;
    };
    std::vector<Scheduled> scheduled;
    int frames = 0;
    double frameTime = 0.0, workTime = 0.0, lastReport = 0.0;
    std::array<double, 3> parts{0.0, 0.0, 0.0};

    // NOTE(port): what the Swift makes afresh each frame and this keeps from one frame to the
    // next, empty between uses (see `Scratch` above). Each is named where it is used.
    Scratch<Stage::Sheet> sheets;                       // layout
    std::vector<PaneMesh::Pane> flatPanes, floatPanes;  // drawPanes: `flat` and `floating`
    std::vector<Vec2> panePoints;                       // drawPanes: `points`
    std::vector<Drawn> list;                            // drawThreads
    /// The label on a thread: its text, color and size. (The Swift's `(String, Tone, Float)`.)
    struct Words {
        const std::string* text;            // a node's or a link's own `why`: it stays put for the frame
        Tone tone;
        float size;
    };
    Scratch<Words> words;                               // drawThreads
    Scratch<float> grown;                               // drawThreads
    ScratchSet straight, touching, hubIDs;              // drawThreads
    Scratch<Strand> live;                               // drawThreads
    Scratch<Vec3> spots;                                // drawThreads
    std::vector<std::pair<std::string, CardView*>> hubs;    // drawThreads
    std::vector<const std::string*> said;               // drawThreads
    std::vector<int> labelKeys;                         // drawThreads
    std::vector<Threads::Thread> threadList;            // drawThreads: `list.map(\.thread)`

public:
    static constexpr float shelfDistance = Stage::shell - 0.7f;
    static constexpr std::array<Vec2, 9> shelfSpots{Vec2{-39, 24}, Vec2{-13, 24}, Vec2{13, 24}, Vec2{39, 24}, Vec2{-64, 22},
                                                    Vec2{64, 22}, Vec2{-26, 37}, Vec2{0, 37}, Vec2{26, 37}};

    /// The room stays in sight, barely dimmed (`-dim 1` for not at all).
    ///
    /// NOTE(port): `surroundings` in the Swift, a SurroundingsEffect that multiplies the room's
    /// colour by a white of `v`. So the Swift's number, and `-dim`'s, is the share of the room's
    /// light that is KEPT (0.88 unless said). What is returned here is the share REMOVED, 1 - v,
    /// which is what PalaceScene asks for; 0 leaves the room alone.
    float surroundingsDim() override;

    void start() override;

    // MARK: - Setup

private:
    void build();

    /// The small tree stands on the desk, right in front of you and within reach: it is worked by hand.
    void seat(const EntityRef& entity);

    // NOTE(port): changed for Quest: `stage.point(46, -22, 1.3)` in the Swift; here the tray lies on the desk, to the right.
    Vec3 trayPoint() const { Vec2 p = trayPlot(); return desk.at(p.x, p.y); }

    // MARK: - Frame

public:
    void update(float dt) override;

private:
    void touch(double until) { busyUntil = std::max(busyUntil, until); }

    /// Brings something small in over a moment.
    void fadeIn(const EntityRef& e, double delay = 0, float over = 0.25f);

    /// Lets something go over a moment, then takes it away.
    void fadeOut(const EntityRef& e, float over = 0.2f);

    void runFades(double now);

    /// The ocean's pieces grow where the head points (there is no knowing where the eyes look).
    /// `-gazeAz 30 -gazeEl -12` points a head that isn't there, in degrees right of ahead and up;
    /// with `-gazeSweep 20` it then turns that many degrees a second, to and fro. `-noGaze` leaves
    /// every piece at rest.
    void lookAtOcean(float dt);

    static bool noGaze() { static const bool v = Flags::has("noGaze"); return v; }
    static std::optional<float> gazeAz() { static const std::optional<float> v = number("-gazeAz"); return v; }
    static float gazeEl() { static const float v = number("-gazeEl").value_or(0); return v; }
    static float gazeSweep() { static const float v = number("-gazeSweep").value_or(0); return v; }

    /// The number that follows a launch flag, which may be negative. (`number(after:)`)
    static std::optional<float> number(const std::string& flag);

    /// Something happened above: the ocean is stirred, and settles into a new arrangement.
    void stir();

    void after(double delay, std::function<void()> run);

    void layout(double now);

    // MARK: - Glass

    /// A pane of the branch's colour lies behind every group on the layers
    /// nearest you, and behind every condensed group, which floats with
    /// it. A pane is drawn round its cards as they are right now: a card on
    /// its way to another layer, or being put away, draws the edge in after
    /// it as it goes. A group's pane also goes round whatever is condensed
    /// onto its cards. `-noGlass` leaves them out.
    void drawPanes(double now);

    // MARK: - The grid under the layers

    /// How one layer lies in the view: where the zero of the sheet all
    /// layers share falls as this layer shows it, how far the layer has
    /// drawn in, and how much of the view's pan it follows.
    ///
    /// NOTE(port): it stands in "Cards" in the Swift, before `layerFrames`; `settleSheets` here takes it first.
    struct LayerFrame {
        Vec2 origin = Vec2::zero();
        float gather = 1;
        float pan = 1;
    };

    /// Sends each layer's grid toward how the layer now lies. A new layer's
    /// grid starts exactly where the grid it grew out of was.
    void settleSheets(const Tree& tree, const std::vector<LayerFrame>& frames, double now);

    /// The grid's lines show for as long as the tree is being moved, and a moment after. (`wakeGrid(for:)`)
    void wakeGrid(double seconds);

    /// The grid under the layer you work on and the two behind it. At rest
    /// only the top one shows, as dots; while the tree moves all three do,
    /// with their lines.
    void drawGrid(double now);

    // MARK: - What the hands are read as (for testing)

    EntityRef handsNote;
    std::string handsNoteWords;
    double handsNoteAt = 0.0;
    // NOTE(port): a FileHandle in the Swift.
    std::FILE* handsLog = nullptr;
    std::string nearestTip;                             // the fingertip nearest the step cards, where it is on them

    /// A line above the step cards saying what the hands are read as, twice a
    /// second, and the same line into a file. Only with `-handsNote`.
    void noteHands();

    // MARK: - The small tree, by hand

    /// What the small tree shows: every card that was asked about as an orb
    /// on its layer's level, where its group stands on that layer; every
    /// other card as a glitter beside the orb it came back to.
    void refreshHologram(const Tree& tree);

    /// A hand over the small tree makes it grow a little; the fingers'
    /// height picks a level, which a pane of light snaps to; a pinch goes
    /// to that layer. Either hand will do.
    void feelHologram();

    void leaveHologram();

    /// Goes to a layer: along the path you came by if it reaches that far,
    /// else to the group most lately asked there. (`jump(toLayer:)`)
    void jump(int layer);

    /// Beside the pane on the small tree: which layer it is, and what the path asked there.
    void layHologramLabel(double now);

    /// A hand over the small tree, run to one of its levels, and a pinch: as a stand-in where no hands are tracked.
    void touchHologramByFlag(int pick);

    /// The tree carried by a closed hand, and let go: as a stand-in where no hands are tracked.
    void panByFlag(Vec2 d);

    // MARK: - Panning by hand

    /// The tree follows a closed hand: `d` is how far the hand moved, right and up, m.
    void panBy(Vec2 d);

    /// Let go: it coasts a little way on, and stops.
    void panRelease(Vec2 velocity);

public:
    static constexpr float panGain = 3;

private:
    void apply(Mover& m, double now);

    void report(float dt, double work);

    // MARK: - Cards

    /// A card's two sizes: the Swift's `(small: SIMD2<Float>, open: SIMD2<Float>)`.
    struct Bodies {
        Vec2 small;
        Vec2 open;
    };
    Bodies bodies(const Ref& ref) const;

    void makeCard(const TreeNode& n, double delay);

    /// Every layer up to the one you work on. Each layer back draws in
    /// toward the card your path left it by, which keeps standing under the
    /// group it started, and sits a share nearer the middle of the view, so
    /// a long path that keeps branching one way doesn't walk its early
    /// layers off the edge.
    std::vector<LayerFrame> layerFrames(const Tree& tree) const;

    /// Where a node rests: the Swift's `(xy: SIMD2<Float>, depth: Int, pan: Float, scale: Float, float: Float, visible: Bool)`.
    struct Rest {
        Vec2 xy;
        int depth;
        float pan;
        float scale;
        float float_;           // NOTE(port): `float` in the Swift; a C++ keyword
        bool visible;
    };
    /// Where a node rests in the view before the view's pan: its place on
    /// its layer, through how that layer lies; how large its place in a
    /// condensed group makes it, and how far it floats.
    /// (`frames` is null where the Swift leaves it out.)
    Rest rest(const TreeNode& n, const Tree& tree, const std::vector<LayerFrame>* frames = nullptr) const;

    /// Where a node rests right now (ignoring any motion of its own).
    Vec3 treePoint(const TreeNode* n) const;

    void buildSmall(CardView& c);

    /// A card as an earlier step of the path: its number and name.
    void buildStep(CardView& c, int number, const std::string& words);

    void buildOpen(CardView& c, const TreeNode& node);

    /// What stands under the card in focus, in one column: following its
    /// link, and, under one "Ask" heading, what you
    /// can ask the gardener about it. Rebuilt only when it changes, and
    /// then the lines trade places over a moment.
    void buildRows(CardView& c);

    /// The film or work before `id` on its way from the root, if there is one (its place among the pieces). (`previousPiece(before:)`)
    std::optional<int> previousPiece(int id) const;

    /// How many open works keep their full-size picture. The rest go back
    /// to the atlas's small one until they are opened again: a full picture
    /// is some ten megabytes once it is unpacked.
    static constexpr int fullKept = 4;

    /// Shows an open work from its own file, at full size, as soon as it is read.
    void showFull(CardView& c);

    // NOTE(port): added for Quest (core/cards). Under `-cards` the ocean's pieces are cards, which ask for their
    // pictures by address and are drawn anew in place when one comes or when the tree's say on them changes.
    /// Puts what the tree says of a node on its card: a suggestion is a pick, and the root starts the tree.
    void seatCard(CardView& c, const TreeNode& n);
    /// Draws a card's faces again where they stand. A face drawn anew takes the old one's place once it is
    /// painted (`repaintCards`, each frame), so the card never shows an empty face in between.
    void redrawCard(CardView& c);
    /// NOTE(port): added for Quest (core/cards). A card that was composing has its finished look: the finished card
    /// is made where it stands, the in-progress card eases to its size under it, and the finished card comes up inside
    /// it. Nothing fades out and back in.
    void settleCard(int id);
    /// The light running across each composing card, and the in-progress cards easing to their finished size. Each frame.
    void composeFrame(double now);
    EntityRef shimmerBand(Art& art, Vec2 body);
    void startSettle(CardView& old, CardView& made, double now);
    struct Repaint {
        int id;
        EntityRef quad;
        TextureRef texture;
    };
    std::vector<Repaint> repaints;
    void repaintCards();
    /// Hands a card the pictures it shows that the ocean has now, and asks for the rest. True when it has them all.
    bool cardPictures(const std::string& id);
    /// Hands over the pictures asked for that have come, each frame.
    void landPictures();
    void handPicture(const std::string& src, const ImageRef& image);
    /// A card's picture by its address, if it is here: nothing while it is unpacked, null when there is none.
    std::optional<ImageRef> pictureNow(const std::string& src);
    std::vector<std::string> picturesDue;

    struct Look {
        float scale;
        float alpha;
        float open;
        bool pickable;
        float dim = 0;          // 1 for something shown dimmer, never see-through
        float label = 0;        // 1 for an earlier step: shown as its number and name
    };

    /// How a node shows, given where you stand in the tree and what is in focus.
    Look style(const TreeNode& n, const Tree& tree) const;

    void setHit(CardView& c, const Look& look);

    /// Moves every card to how it should look from where you stand.
    void restyle(bool stirring = true);

    /// Where the view should rest. It never jumps to a new layer's first
    /// card: starting a layer moves nothing sideways. It moves only as far
    /// as it must to keep the card in focus comfortably near the middle;
    /// zoomed into a card, that card is the middle.
    Vec2 panTarget(const Tree& tree) const;

    /// Where a picture sits: the Swift's `(center: SIMD2<Float>, size: SIMD2<Float>)`.
    struct PictureFrame {
        Vec2 center;
        Vec2 size;
    };
    /// Where the picture sits on an open card, in the card's own meters: a
    /// film's is the card itself, a note's is the top of it.
    PictureFrame pictureFrame(const CardView& c) const;

    void logState();

    // MARK: - Threads

    /// A point as you see it: the Swift's `(at: SIMD2<Float>, depth: Float)`.
    struct Seen {
        Vec2 at;
        float depth;
    };
    /// A point as you see it: how far around to the right and how far up
    /// it appears, measured on the sheet that wraps around you at the open
    /// layer's distance, and how far away it is.
    Seen seen(Vec3 p) const;

    /// A move of `move` as seen (right, up), as a move in the room for something at `p`. (`aside(at:_:)`)
    Vec3 aside(Vec3 p, Vec2 move) const;

    /// How far a point at `at` must move to be clear of the box from `lo`
    /// to `hi`: out through its nearest side.
    Vec2 clear(Vec2 at, Vec2 lo, Vec2 hi) const;

    /// A box as you see it, or on a sheet: the Swift's `(lo: SIMD2<Float>, hi: SIMD2<Float>)`.
    struct Reach {
        Vec2 lo;
        Vec2 hi;
    };
    /// The open card on its own sheet, m from its middle: its caption and
    /// the rows under it included, at the size the zoom gives it.
    Reach openReach(const TreeNode& node) const;

    /// The open card as you see it, with a margin.
    std::optional<Reach> openBox(const TreeNode* node, float margin) const;

    /// How far aside (on its own sheet) a card must move so it doesn't sit
    /// under the open card, or behind it. (`nudge(for:in:)`)
    Vec2 nudge(const TreeNode& n, const Tree& tree) const;
    /// AGENT: how far each card on the layer at `depth` moves aside, by node id, on the open card's layer or one behind it in
    /// line: what lies under the open card (or, behind, the card the path left the layer by) goes straight out from it, and of
    /// two cards that touch, the one farther out goes on past the other.
    std::map<int, Vec2> makeRoom(const Tree& tree, int depth) const;
    /// How far a card of a layer behind moves out from behind the open card (Kai's step aside), in its own layer's measure.
    Vec2 outFromBehind(const TreeNode& n, const Tree& tree) const;
    /// AGENT: whether the layer of the open card makes room together round it (`makeRoom`): round a card opened where it stands,
    /// and on any tree the agent service grows.
    bool roomy(const Tree& tree) const;
    /// AGENT: where a card opened where it stands had stepped aside to before it opened, which it keeps while open.
    Vec2 stood(const Tree& tree) const;
    /// AGENT: where the layer makes room together, moves every card aside (`nudge`, `makeRoom`), at this pace.
    void stepAside(double now, float pace, Ease ease);

    void drawThreads(double now, float dt);

    /// One step of easing toward `rest` with no overshoot (a critically
    /// damped follow, worked out exactly, so no frame time can upset it).
    static void ease(Strand& s, Vec3 rest, float dt);

    /// Where a thread leaves `c` on its way to `other`: the edge of its
    /// picture, not its middle, and a hair under it so the card covers it.
    /// Two cards with next to no room between them share the way out, each
    /// by its size, so the ends never pass each other. (Each used to stop
    /// at 0.45 of the way, which left a thread starting well inside a card
    /// grown large, and showing over it.)
    Vec3 edge(const CardView& c, const CardView& other) const;

    // MARK: - Starting, picking, layers

    /// Stands a tree up out of the ocean.
    void stand(TreeRef t);

    void startBrief(int i);

    /// Runs `next` once no tree stands: at once, or after the standing one
    /// has pressed itself back onto the shelf.
    void whenClear(std::function<void()> next);

    /// A pinch on a card asks about it: it rises to the next layer and
    /// opens there, the gardener thinks for a moment, and what it brings
    /// comes up round the card. A card already asked about is gone back to.
    /// A pinch anywhere on a condensed group goes to that group's layer.
    void take(int id);

    /// While the gardener works on a card, a word above it says so. (`think(_:for:)`)
    void think(int id, float seconds);

    /// Cards for what the gardener just suggested, one after another. (`arrive(_:after:)`)
    void arrive(const std::vector<int>& added, double delay = 0.1);

    /// Cards that have left the tree go back where they came from: films
    /// to their place in the ocean, the rest into the card they hung from
    /// (or, cut away, down into the water).
    void dismiss(const std::vector<TreeNode>& gone, bool cut = false);

    /// On a pinch at nothing: out of a zoom, then out of the focus (the card closes, and its group draws in).
    void stepOut();

    /// (`goTo(layer:)`)
    void goTo(int head);

    /// Into the open card: each pinch on it brings it up a size, until it
    /// fills much of the view; one more lets it back. What hangs from it
    /// moves out of its way.
    void zoomIn();

    void setZoom(float z, float over);

    /// Puts one of the open card's questions to the gardener.
    void askGardener(int nodeID, int k);

    /// Asks the gardener about the part of the open card that was marked.
    void askMark(int nodeID);

    /// An answer lands beside the open card and is picked: what it points
    /// to grows around it, and it ties back across the tree to anything it
    /// mentions that is already here. (`bring(answer:why:)`)
    void bring(const OceanNote& note, const std::string& why);

    void openLink(int nodeID);

    // NOTE(port): added for Quest (core/cards). An open card's panel scrolls inside its frame (`-cards`).
    /// Scrolls an open card's panel to `offset` px from its top, held to its range, and moves what is shown on it.
    void scrollCard(CardView& c, float offset);
    void solid(const EntityRef& quad);
    /// When the card has finished growing and the layer has stopped gliding.
    double settledAt(const CardView& c) const;
    /// Each frame: the ring round a pinch held still on the open card fills, and once it is full the hold counts: it asks
    /// for more like the card. Not while the pen is up, when a drag marks the card.
    void holdPress();
    /// How long a pinch is held still before it counts, s, once the card has settled.
    static constexpr double holdFor = 0.4;

    // NOTE(port): added for Quest (core/cards). What the pen marks on a service card, kept with the card by the service
    /// (oceanmodel_edits.cpp). With the pen up, a drag on the card gone into begins one: a highlight on words, a line
    /// anywhere else, or a stretch along a video, drawn as Kai's mark is (`markBegin`, `keepStretch`). What it was claimed for.
    Press::Claim beginMark(CardView& c, Vec2 at);
    /// Whether the card has anything marked on it: a mark the service keeps, or one of the headset's own.
    bool marked(int id) const;
    /// What Send asks about a service card: every mark on it, together ("Tell me more about these parts: …").
    std::string tellMoreAbout(const CardView& c) const;
    /// A stretch made on a service card's video, kept with the card by the service in place of the one it had.
    void keepStretch(CardView& c, const Mark& made);
    /// The pen's own mark on a service card's video shows the stretch the service keeps, or none.
    void syncStretch(CardView& c);
    /// The eraser on a service card: every mark off, at the service as one change.
    void eraseAll(CardView& c);
    /// A stretch's bar along the foot of the card's picture (`markMove`, `syncStretch`).
    void drawStretch(CardView& c, float x0, float x1, bool made, double t0, double t1);
    /// A highlight or a line being drawn: begun by the drag, carried by it, kept when the pinch lets go.
    struct Drawing {
        int card;
        CardEdit edit;
        int run = -1;                   // a highlight: which of the content's runs it is in
        CGPoint from;                   // a highlight: where the hold was, px on the content
    };
    std::optional<Drawing> drawing;
    std::optional<int> editsOpen;       // the open card the log last said the edits of
    /// Each frame: says when an open card shows its edits.
    void editFrame();
    /// Builds the ring and the edit meshes on a service card as it opens.
    void buildEdits(CardView& c);
    /// The edits a card shows, as the service keeps them, drawn again when they change.
    void setEdits(int id, const std::vector<CardEdit>& edits);
    /// Draws a card's edits, and the one being drawn, where the content now stands in its window.
    void drawEdits(CardView& c);
    /// Lays the content's text out for finding words in it, once each time the card is drawn.
    const std::vector<std::shared_ptr<TextBlock>>& contentRuns(CardView& c);
    /// A point of the open face, m from its middle, as a point on the card's whole content, px, and whether it is in the window.
    std::optional<CGPoint> onContent(const CardView& c, Vec2 at, bool inWindowOnly = true) const;
    /// The run of words under a point of the content, or -1.
    int runAt(CardView& c, CGPoint p);
    /// The pen's drag: a highlight of the words under it, or a line from there.
    void beginEdit(CardView& c, Vec2 at);
    void moveEdit(CardView& c, Vec2 at);
    /// Keeps it with the card, if it came to anything.
    void endEdit(CardView& c);
    /// A point of a card's open face in the world, for pinches made by flag.
    Vec3 facePoint(const CardView& c, Vec2 at) const;
    /// Pinches the open card by flag, as a hand would: held `hold` s at the path's start, then drawn along it over `over` s.
    void pinchByFlag(const std::vector<Vec2>& path, double hold, double over);
    /// NOTE(port): added for Quest. Logs where each card on the layer you work on is headed, and the room it takes there
    /// (`-placesAt`), for checking an arrangement without pictures.
    void logPlaces() const;
    /// NOTE(port): added for Quest. Logs what is drawn within 2 mm of something else along the eye's sight (`-depthAuditAt`).
    void depthAudit() const;
    bool cardGestures = false;

    void moveLayer(int direction);

    void prune(int id);

    // MARK: - Placing by hand

    /// Whether a card can be picked up and put somewhere else: anything on
    /// the layer you work on, but for a card that has a group of its own
    /// (the path may run through it) and the open card (a drag on that marks it).
    bool movable(int id) const;

    /// Lets go of a card that was carried `d` from where it was: it stays
    /// there, with what hangs from it. (`drop(_:riders:carried:)`)
    void drop(int id, const std::vector<int>& riders, Vec3 d);

    // MARK: - Marking

    /// A point in the world to a point on a card's open face, m from its middle.
    Vec2 onCard(const CardView& c, Vec3 p) const { return c.onFace(p); }

    /// Starts a mark where a drag on the open card began: on its picture
    /// (a stretch of a video, or part of a still) or on its words. (`markBegin(_:at:)`)
    void markBegin(int id, Vec2 a, std::optional<Mark::Kind> only = std::nullopt);

    /// Carries the mark on to where the hand is now, and shows it. (`markMove(to:)`)
    void markMove(Vec2 b);

    /// The hand let go: the mark stays on the card, and can be asked about.
    void markEnd();

    // MARK: - The ocean: peeking and bringing in

    /// Where a film comes to when it is lifted for a look: up off the water, most of the way to you, and high enough
    /// that no tree on the desk stands between it and you. `tall` is its card's height, m, at the size it comes to.
    Vec3 peekPoint(int film, float tall) const;

    /// Lifts a film or a work out of the ocean just far enough to see what it is.
    void peekAt(int film);

    void clearPeek(bool returning = true);

    /// The peeked film or work, confirmed: it joins the open card, or starts a tree of its own.
    void bringIn(int film);

    // MARK: - Pressing

    /// A tree put away is a small tree of light: its trunk and branches as
    /// the small tree at your hand draws them, without the orbs, the
    /// glitter or the panes, and with a few of its pictures floating round
    /// it. Its name stands under it.
    struct CoverPlan {
        struct Thumb {
            int id;                     // the card it stands for
            Ref ref;                    // the film or the work whose picture it shows (AGENT: or a service card's own)
            Vec3 at;                    // m from the cover's middle
            Vec2 size;
        };
        std::vector<Hologram::Node> nodes;
        std::vector<Thumb> thumbs;
        int choices = 0;                // AGENT: how many different pictures its cards had to show
        std::vector<Ref> ranked;        // AGENT: and which, best first
        float foot = 0;                 // m from the cover's middle down to the tree's foot
        float top = 0;                  // m from the cover's middle up to its highest picture
        // NOTE(port): added for Quest: how its tree is drawn, in the small tree's measure (see `Becoming`).
        int layers = 1;
        float treeFoot = 0.03f, treeRise = 0.055f;
    };

public:
    /// How much larger than the small tree at your hand a cover's tree is (a cover hangs at 0.62 of this).
    static constexpr float coverTree = 2.4f;
    static constexpr float coverRest = 0.62f;

private:
    /// Where pictures float round a cover's tree: m right of the trunk, how far up the cover
    /// (0 its foot … 1 its top), and m toward you. The first is the top left, then round.
    //
    // NOTE(port): changed for Quest, at Kai's request (2026-11-15): three more, further out, for a tree
    // that stands on the desk with no tree open ("more content thumbnails in this state"). The Swift has
    // the first five; here too only those show while a cover lies on the ocean's floor (`usualPictures`).
    static constexpr std::array<Vec3, 8> coverSlots{Vec3{-0.30f, 0.80f, 0.05f}, Vec3{0.31f, 0.58f, -0.04f}, Vec3{-0.33f, 0.30f, -0.06f},
                                                    Vec3{0.29f, 0.10f, 0.06f}, Vec3{0.06f, 1.12f, -0.07f},
                                                    Vec3{-0.47f, 0.56f, -0.02f}, Vec3{0.47f, 0.33f, 0.03f}, Vec3{0.46f, 0.86f, -0.03f}};

    /// What a tree's cover shows. The pictures are of the cards that matter
    /// most: a step of the path before any other card, a later layer before
    /// an earlier one, and then by how much the card matters. The first of
    /// them is a little larger. Each floats on the side of the tree its
    /// card stands on, about as high as its layer.
    CoverPlan coverPlan(const Tree& tree, const std::vector<Ref>& without = {}) const;    // AGENT: `without` those pictures
    /// AGENT: a cover's picture as a plan places it, or none for a film or a work that can't be drawn. A service card's own
    /// picture shows once it has come; until then its place waits (`since`).
    std::optional<CoverPicture> coverPicture(const CoverPlan::Thumb& thumb);
    /// AGENT: a cover's boxes for pointing at it: its tree's, then each picture's and its name's, as drawn in on the desk.
    std::vector<Shape> coverCollision(const std::vector<Shape>& trunk, const std::vector<CoverPicture>& pictures, bool caption,
                                      Vec2 nameSize, float foot) const;
    /// AGENT: whether a cover could show a picture now: a film's or a work's always, a service card's once it has come.
    bool onHand(const Ref& ref) const;
    /// AGENT: how long a cover's place waits for a service card's picture before a picture on hand may take it, s
    /// (`-coverWait <s>`, for checking it).
    static double coverWait();
    /// AGENT: a service tree's cover keeps no place empty while its tree has another picture to show. A place whose picture
    /// could not be had goes to the next card in the cover's order whose picture is on hand or on its way; one whose picture
    /// is late goes to the next on hand, and the late one may take a free place once it comes. A picture that comes when
    /// every place is taken leaves the cover as it is. Run every half second, and as pictures come.
    void tendCovers();
    /// AGENT: places a cover's pictures again as its plan would without `without`: one that stays where it was is kept, the
    /// rest come and go; with fewer pictures than places, fewer show, placed as the plan places them.
    void recover(Shelved& s, const std::vector<Ref>& without, const std::string& why);
    double coversTendedAt = 0;
    /// AGENT: the first picture a card of the service's shows that has not failed to come, for its cover: none for any
    /// other card.
    std::optional<std::string> coverSource(const std::string& noteID) const;
    /// AGENT: that picture, `size` m, cut to fill it, for a cover: null until it has come (`coverPicturesCame`).
    EntityRef coverFace(const std::string& noteID, Vec2 size);

public:
    /// AGENT: pictures the service's cards show have come: covers waiting for them show them now.
    void coverPicturesCame(const std::vector<std::string>& noteIDs);

private:

    /// A cover, as `makeCover` gives it: the Swift's
    /// `(entity: Entity, tilts: [Entity], box: (center: SIMD3<Float>, size: SIMD3<Float>))`.
    struct Cover {
        struct Box {
            Vec3 center;
            Vec3 size;
        };
        EntityRef entity;
        std::vector<EntityRef> tilts;
        Box box;
        float foot = 0;             // NOTE(port): added for Quest: m from its middle down to the tree's foot (`plan.foot`)
        // What a planted cover is picked by: its trunk, each of its pictures and its name, each a box of
        // its own, so that a hand ray goes between them to the trees that stand behind. (Here its trunk
        // and its name; `shelve` adds the pictures, where they are once drawn in.)
        std::vector<Shape> shapes;
        std::shared_ptr<Gravel> gravel;
        Vec2 nameSize = Vec2::zero();
        // (and its parts, as `Shelved` keeps them)
        EntityRef branches, caption;
        std::vector<CoverPicture> pictures;
        int choices = 0;                    // AGENT: as `CoverPlan::choices`
        int layers = 1;
        float treeFoot = 0.03f, treeRise = 0.055f;
    };
    /// Builds a tree's cover. `el` is how high it hangs, in degrees up
    /// from eye level: the tree stands upright, as a tree does, and its
    /// pictures and its name are tipped to face you. Returns the cover,
    /// what on it is tipped, and the box it is picked by.
    ///
    /// NOTE(port): `planted` is added for Quest: the cover is to stand on the desk, so its name lies in
    /// front of the tree's foot instead of hanging under it, and nothing of it reaches below the foot.
    std::optional<Cover> makeCover(const Tree& tree, float el, bool planted = false);

    /// Tips a cover's pictures and its name toward eyes `el` degrees below them.
    static void tip(const std::vector<EntityRef>& entities, float el);

    /// The clap: the tree flattens into one card, which leaves for the tray
    /// (sent on to the next stage) or for the shelf (put away).
    void pressTree(bool send);

    // MARK: - The shelf of covers

    Vec3 shelfPoint(Vec2 spot) const { return stage.point(spot.x, spot.y, shelfDistance); }

    /// The first usual place with no cover near it.
    Vec2 freeSpot() const;

    /// Hangs a pressed tree's cover on the shelf, above the tree. It stays
    /// where it was last put. `hand` is the card already in flight, which
    /// this one meets. (`shelve(_:from:hand:spot:)`)
    ///
    /// NOTE(port): changed for Quest: it is stood on the desk, among the others (`plot`: where, if it had a place).
    void shelve(const TreeRef& tree, std::optional<Vec3> from, const MoverRef& hand = nullptr, std::optional<Vec2> known = std::nullopt,
                std::optional<Vec2> plot = std::nullopt);

    /// A cover carried by hand: it follows, at arm's length, around you. (`carry(_:by:)`)
    ///
    /// NOTE(port): changed for Quest. A tree put away stands on the desk, so a hand slides it across the
    /// desk's top: `from` is where the pinch landed and `d` how far the pinched point has moved since, and
    /// what is returned is its new place on the desk (Desk::plot), not degrees round you.
    std::optional<Vec2> carry(int uid, Vec3 from, Vec3 d);

    void unfold(int uid);

    // The shelf as it is kept between runs: every cover's tree and where it hangs.
    struct ShelfFile {
        struct Item {
            Tree::Saved tree;
            Vec2 spot;
            std::optional<Vec2> plot;       // NOTE(port): added for Quest: where it stands on the desk (key "plot"; left out when not known)
            static std::optional<Item> from(const Json& j);
            Json json() const;
        };
        int version = 3;
        int films = 0;
        std::optional<std::string> works;       // which works the library held (Catalog.worksKey); nil in a file from before there were any
        std::vector<Item> trees;

        ShelfFile() = default;
        ShelfFile(int films, const std::optional<std::string>& works, const std::vector<Item>& trees) : films(films), works(works), trees(trees) {}

        /// `init(from decoder:)`
        static std::optional<ShelfFile> from(const Json& j);
        Json json() const;
    };
    // NOTE(port): added for Quest. Saved trees read from the shelf file are hung one a frame, the most
    // lately saved first, instead of all at once before the first frame: there will be many more of them.
    // Those still to hang, in the file's order (oldest first). Nothing is written back until all are up.
    std::vector<ShelfFile::Item> shelfWaiting;
    void shelveWaiting();

    /// (`shelfURL`: the file's path; "" if there is nowhere to keep it.)
    static std::string shelfURL();

    /// The covers from last time, each where it was left; the first time
    /// (or with `-freshShelf`), the two trees ocean.json starts with.
    void loadShelf(const std::shared_ptr<Catalog>& catalog);

    /// Writes the shelf down. A tree taken off the shelf and still standing is kept at the place it left.
    void saveShelf();

    // MARK: - The strip: what you can say and do

    /// With no tree standing: the gardener's briefs, under where a tree
    /// would be. With one: its name and what can be done with the whole of
    /// it, low and near, at hand, in front of anything the tree puts
    /// there. (What can be done with one card stands under that card.)
    /// Rebuilt only when what it says changes, and then one fades as the
    /// other comes.
    void rebuildStrip();

    // MARK: - Pinches

    /// (`pick(for:)`)
    std::optional<Pick> pick(const EntityRef& entity) const;

public:
    void pinchChanged(const EntityRef& entity, Vec3 point, Vec3 start) override;

    void pinchEnded(Vec3 point) override;

private:
    void tap(const Pick& pick);

public:
    /// Both hands pinching and spreading, on anything: into the open card, as far as you like.
    void magnifyChanged(float ratio) override;

    void magnifyEnded() override { magnifyBase = std::nullopt; }

    // MARK: - Hands

private:
    void handle(const Hands::Event& event);

    /// The thread a blade crosses, as you see it: both are flattened onto
    /// your view, and the first thread the blade's stroke passes over is cut.
    std::optional<int> threadCrossed(Vec3 from, Vec3 to, Vec3* at = nullptr) const;

    // MARK: - Launch flags, for running it without hands

    /// `-brief <1…3>` stands a brief's tree; `-saved <i>` opens a cover.
    /// Then, each at its time in seconds:
    /// `-expand <n>` asks about one of the cards round the open one, n times, one every 3.2 s from 3.2 s;
    /// `-branch <n>` then steps back a layer and asks about another card there, n times, so branches share a layer;
    /// `-walk <n>` is `-expand` under its old name; `-outAt` steps out of the focus;
    /// `-backAt`, `-backAgainAt`, `-forwardAt` step between layers;
    /// `-openHuddleAt` pinches a small card of a condensed group; `-noGlass` leaves the panes out;
    /// `-placeAt` carries a card aside by hand; `-zoomAt`, `-zoomAgainAt`;
    /// `-askAt` with `-ask <i>`; `-markAt` with `-mark words|time|region`,
    /// then `-askMarkAt`; `-peekFilm <index>` with `-peekAt`, `-bringAt`;
    /// `-pressAt` puts the tree away, `-sendAt` sends it.
    /// `-demo` plays the whole flow. `-freshShelf` forgets the kept covers.
    void runFlags();

    /// What stands round the card in focus and has not been asked about, cards before tags.
    std::vector<TreeNode> offers() const;

    /// Asks about one of them (one pinch on it).
    void pickOffer(int k);

    /// Carries one card on the layer aside, as a hand would.
    void carryOne();

    /// NOTE(port): added for Quest. Carries the cover `i` along the shelf, as a hand would: a pinch on it, drawn by `d`
    /// over half a second and let go there.
    void carryCoverByFlag(int i, Vec3 d);

    /// Marks part of the open card, as a drag across it would.
    void markByFlag(const std::string& kind);

    void runDemo();

    // NOTE(port): what follows is not in the Swift: how its `cards[id]` and `tree.nodes[id]` are written here.

    /// `cards[id]`: null when there is none. (The reference is to the map's own: copy it before `cards` is changed.)
    const CardRef& card(int id) const {
        static const CardRef none;
        auto it = cards.find(id);
        return it == cards.end() ? none : it->second;
    }
    /// `tree.nodes[id]`: null when it isn't there. (It points into the tree: copy it before the tree is changed.)
    static const TreeNode* find(const Tree& tree, int id) {
        auto it = tree.nodes.find(id);
        return it == tree.nodes.end() ? nullptr : &it->second;
    }
    /// `tree.lifted[id] ?? .zero`
    static Vec2 lifted(const Tree& tree, int id) {
        auto it = tree.lifted.find(id);
        return it == tree.lifted.end() ? Vec2::zero() : it->second;
    }
    /// `tree.route.firstIndex(of: id)`: -1 when it isn't on it.
    static int routeIndex(const Tree& tree, int id) {
        auto it = std::find(tree.route.begin(), tree.route.end(), id);
        return it == tree.route.end() ? -1 : int(it - tree.route.begin());
    }
    /// How Swift writes a mark out in a line of the log (`"\(mark)"`).
    static std::string described(const Mark& mark);
    /// `a.lowercased() == b.lowercased()`, without making either.
    static bool sameLowercased(const std::string& a, const std::string& b);
};
