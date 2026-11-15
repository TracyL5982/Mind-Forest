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
#include "hologram.h"
#include "handglow.h"
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
class OceanModel : public PalaceScene {
public:
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

    struct Shelved {
        int uid;
        TreeRef tree;
        MoverRef mover;
        std::vector<EntityRef> tilts;       // its pictures and its name, tipped to face you
        Vec2 spot;                          // degrees right of ahead, and up
    };
    std::vector<Shelved> shelf;
    int nextUID = 0;
    int trayCount = 0;
    std::optional<Vec2> standingSpot;                   // where the standing tree's cover hung, if it had one
    bool shelfDirty = false;
    bool shelfLoaded = false;

    EntityRef strip = Entity::make();
    std::string stripKey;
    /// The whole tree, small and within reach: where you are in it, and the way to any other layer.
    std::shared_ptr<Hologram> hologram;
    // NOTE(port): added for Quest (handglow.h): light on the hands themselves, saying what a fist or a
    // finger on the small tree is doing; which hand is on the tree, and the level its finger last lit.
    std::shared_ptr<HandGlow> handGlow;
    int holoHand = -1;
    std::optional<int> holoLit;
    void drawHandGlow(double now, float dt);
    bool pointerHidden(int hand) override { return holoTouching && hand == holoHand; }
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
        // NOTE(port): `page` added for Quest: the row that turns a card's pages (core/cards).
        enum class Kind { card, speck, peek, brief, shelf, send, putAway, background, ask, askMark, openLink, page };
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
        static Pick page(int id) { return {Kind::page, id, 0}; }
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

    /// The small tree stands low to the left and within reach: it is worked by hand.
    void seat(const EntityRef& entity);

    Vec3 trayPoint() const { return stage.point(46, -22, 1.3f); }

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

    /// NOTE(port): added for Quest. Shows the next page of an open card's face (core/cards).
    void turnPage(int nodeID);

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
    void markBegin(int id, Vec2 a);

    /// Carries the mark on to where the hand is now, and shows it. (`markMove(to:)`)
    void markMove(Vec2 b);

    /// The hand let go: the mark stays on the card, and can be asked about.
    void markEnd();

    // MARK: - The ocean: peeking and bringing in

    /// Where a film comes to when it is lifted for a look: up off the water, most of the way to you.
    Vec3 peekPoint(int film) const;

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
            Ref ref;                    // the film or the work whose picture it shows
            Vec3 at;                    // m from the cover's middle
            Vec2 size;
        };
        std::vector<Hologram::Node> nodes;
        std::vector<Thumb> thumbs;
        float foot = 0;                 // m from the cover's middle down to the tree's foot
        float top = 0;                  // m from the cover's middle up to its highest picture
    };

public:
    /// How much larger than the small tree at your hand a cover's tree is (a cover hangs at 0.62 of this).
    static constexpr float coverTree = 2.4f;
    static constexpr float coverRest = 0.62f;

private:
    /// Where pictures float round a cover's tree: m right of the trunk, how far up the cover
    /// (0 its foot … 1 its top), and m toward you. The first is the top left, then round.
    static constexpr std::array<Vec3, 5> coverSlots{Vec3{-0.30f, 0.80f, 0.05f}, Vec3{0.31f, 0.58f, -0.04f}, Vec3{-0.33f, 0.30f, -0.06f},
                                                    Vec3{0.29f, 0.10f, 0.06f}, Vec3{0.06f, 1.12f, -0.07f}};

    /// What a tree's cover shows. The pictures are of the cards that matter
    /// most: a step of the path before any other card, a later layer before
    /// an earlier one, and then by how much the card matters. The first of
    /// them is a little larger. Each floats on the side of the tree its
    /// card stands on, about as high as its layer.
    CoverPlan coverPlan(const Tree& tree) const;

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
    };
    /// Builds a tree's cover. `el` is how high it hangs, in degrees up
    /// from eye level: the tree stands upright, as a tree does, and its
    /// pictures and its name are tipped to face you. Returns the cover,
    /// what on it is tipped, and the box it is picked by.
    std::optional<Cover> makeCover(const Tree& tree, float el);

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
    void shelve(const TreeRef& tree, std::optional<Vec3> from, const MoverRef& hand = nullptr, std::optional<Vec2> known = std::nullopt);

    /// A cover carried by hand: it follows, at arm's length, around you. (`carry(_:by:)`)
    std::optional<Vec2> carry(int uid, Vec3 d);

    void unfold(int uid);

    // The shelf as it is kept between runs: every cover's tree and where it hangs.
    struct ShelfFile {
        struct Item {
            Tree::Saved tree;
            Vec2 spot;
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
    std::optional<int> threadCrossed(Vec3 from, Vec3 to) const;

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
