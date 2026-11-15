// Port of visionos/MindPalace/Ocean/CardView.swift.
#pragma once
#include <functional>
#include <limits>
#include <memory>
#include <optional>
#include <string>
#include <vector>

#include "../base.h"
#include "../vecmath.h"
#include "../scene.h"
#include "../platform.h"
#include "stage.h"
#include "catalog.h"
#include "tree.h"
#include "art.h"
#include "bend.h"

/// NOTE(port): added for Quest. How far the open face stands in front of the small one, m (see the constructor).
constexpr float openLift = 0.0015f;

/// One node of the standing tree as it appears: a small card that can grow,
/// in place, into its open form. Its origin is the middle of its picture (or
/// panel, or label), so growing never shifts it.
class CardView {
public:
    const int id;
    const Ref ref;
    EntityRef root = Entity::make();
    EntityRef smallHolder = Entity::make();
    EntityRef openHolder = Entity::make();
    EntityRef stepHolder = Entity::make();      // as an earlier step of the path: its number and name
    EntityRef badge;
    std::string badgeKey;
    bool built = false;
    bool openBuilt = false;
    Vec2 smallBody;                     // the picture, panel or label, small, m
    Vec2 openBody;                      // and open
    Vec2 stepBody{0.12f, 0.03f};
    std::string stepKey;

    // Where it is and how it looks, each on its way to a target.
    Tween<Vec2> xy;
    Tween<float> plane;
    Tween<float> pb{1.f};               // how much of the view's pan it follows: less on each layer back
    Tween<float> scale{1.f};
    Tween<float> alpha{1.f};
    Tween<float> openMix{0.f};          // 0 small … 1 open
    Tween<float> stepMix{0.f};          // 0 its card … 1 its number and name, on an earlier layer
    Tween<float> dim{0.f};              // 1 while it is only a suggestion: dimmer, never see-through
    Tween<float> solid{0.f};            // its thread: 0 dashed (suggested) … 1 solid (confirmed)
    Tween<float> onPath{0.f};           // its thread: 1 when it is part of the path to the focus
    /// The small face's one picture, so it can be shown dimmer.
    /// (The Swift's `(entity: ModelEntity, texture: TextureResource)`.)
    struct SmallQuad {
        EntityRef entity;
        TextureRef texture;
    };
    std::optional<SmallQuad> smallQuad;
    std::function<void(const EntityRef&, const TextureRef&, float)> shade;

private:
    float shownDim = 0;

public:
    Tween<float> emerge{0.f};           // 0 at its source … 1 in the tree
    Tween<Vec3> drag{Vec3::zero()};
    Tween<Vec2> nudge{Vec2::zero()};    // moved aside, out from under the open card
    // NOTE(port): `float` in the Swift; a C++ keyword.
    Tween<float> float_{0.f};           // how far it stands off its sheet, in steps: a condensed group floats
    Tween<Vec3> tint{Vec3::repeating(1)};   // its branch's colour, linear: for its thread and its group's glass
    // Where the last frame put it, for the glass under its group.
    Vec2 sheetAt = Vec2::zero();        // on its sheet, m from the sheet's middle
    float behind = 0;                   // how many layers back its sheet is
    float lift = 0;                     // m off that sheet
    Vec3 source = Vec3::zero();         // where it comes from, and goes back to
    float sourceScale = 0.2f;
    double bornAt = 0.0;
    double goneAt = std::numeric_limits<double>::infinity();
    std::optional<int> home;            // its film's or work's place in the ocean
    EntityRef picture;                  // an open work's picture
    // NOTE(port): added for Quest (core/cards). An open card's frame; the panel that scrolls in its window,
    // and the bar that says where; and, while a pinch held still has armed a mark, what it will mark.
    EntityRef openFace;
    EntityRef openPanel;
    EntityRef scrollBar;
    EntityRef armHolder;
    // NOTE(port): added for Quest (core/cards). A card whose look the agents are still choosing: the holder its small
    // face is drawn in, the soft light that runs across it, and, once its finished card has come, how it eases to
    // that card's size under it (OceanModel::settleCard).
    EntityRef shape;
    EntityRef shimmer;
    struct Settle {
        Vec2 from, to;
        double start;
    };
    std::optional<Settle> settle;
    bool pictureFull = false;           // … shown from its own file (asked for, or there), not from the atlas
    bool step = false;                  // it is a layer's first card, standing on the path
    bool lit = true;                    // it glows while it is on the layer you work on

private:
    std::vector<EntityRef> glows;
    float shownGlow = -1;

public:
    std::vector<Ask> asks;              // the questions offered beside it when open
    std::string rowsKey;                // what the column under it says now
    float rowsDown = 0;                 // and how far down that column reaches, m
    EntityRef askHolder = Entity::make();   // the column they stand in, under the open card
    std::vector<const Entity*> extras;  // parts of it that can be picked on their own (each by its address: ObjectIdentifier)
    std::optional<NoteLayout> layout;   // an open note's parts, for marking
    EntityRef markHolder;               // what a hand has marked on it

    Vec3 position = Vec3::zero();
    Vec3 right{1, 0, 0};                // which way is right on the sheet it lies on,
    Vec3 up{0, 1, 0};                   // which way is up,
    Vec3 normal{0, 0, 1};               // and the side that faces you
    Vec2 half = Vec2::zero();           // half its picture (or panel) as it shows now, m, measured on its sheet
    float curve = 0;                    // its layer's curve, 1 over the radius in the card's own units; 0 flat (see OceanModel.layout)

private:
    std::shared_ptr<Bend> bend;         // there once it has ever bent
    float shownAlpha = -1;
    float shownMix = -1;
    float shownStep = 0;

public:
    CardView(const TreeNode& node, Vec2 smallBody, Vec2 openBody);

    /// The last moment any of its motion is still running.
    double settles() const {
        return std::max({std::max({xy.end(), plane.end(), scale.end(), alpha.end()}), std::max({openMix.end(), emerge.end(), drag.end(), nudge.end()}),
                         std::max({stepMix.end(), dim.end(), solid.end(), onPath.end()}), std::max({pb.end(), float_.end(), tint.end()})});
    }

    float growth() const { return openBody.x / std::max(smallBody.x, 1e-4f); }

    /// How large its tweens make it now, before any boost: 1 is its own size.
    float grown(double now) const { return sourceScale + (scale.value(now) - sourceScale) * std::min(emerge.value(now), 1.f); }

    /// Its picture (or panel) at that size, m.
    Vec2 extent(double now) const {
        Vec2 face = smallBody + (openBody - smallBody) * openMix.value(now);
        return (face + (stepBody - face) * stepMix.value(now)) * grown(now);
    }

    /// Puts the card where its tweens say, given where its place on its
    /// sheet works out to and how the sheet lies there. `fade` is how much
    /// of itself its layer shows. `curve` is the layer's curve, which the
    /// card takes.
    void apply(double now, const Stage::Spot& spot, float boost = 1, float curve = 0, float fade = 1);

    /// A point of its face in the world. `at` is measured along the card from
    /// its middle, m; `lift` is how far off the face, toward you.
    Vec3 point(Vec2 at, float lift = 0) const;

    /// A point in the world as one of the flat card, in the card's own units
    /// from its middle; z is how far off its face, toward you.
    Vec3 unbent(Vec3 world) const;

    /// Where on its open face a point in the world is, in the open face's
    /// own units from its middle: the way back through the bend.
    Vec2 onFace(Vec3 world) const;

    /// One of its pieces was given a new flat mesh (an open work's picture, once read).
    void remade(const EntityRef& e) {
        if (bend) bend->forget(e);
    }

    /// Something was put on it, taken off it or moved on it (a mark, the rows under it): if it is bent, that is bent too, at once.
    void changed() {
        if (bend) bend->changed();
    }

    /// A soft edge of light, behind one of the card's two faces.
    void addGlow(const EntityRef& glow, const EntityRef& holder);

    /// How brightly its edge glows, 0…1.
    void setGlow(float v);

    /// Forces the next apply to rewrite the open/small blend (after building a side).
    void refresh() { shownMix = -1; }

    /// How dim it shows now, for what rides on it.
    float dimNow() const { return shownDim; }
};

/// The one film that plays: the open step's. One decoder, whatever the tree
/// holds; everything else is a still.
class Screen {
public:
    VideoPlayerRef player = platform::makeVideoPlayer();

private:
    Material material;
    EntityRef entity;
    // NOTE(port): the Swift keeps `endObserver`, its place in NotificationCenter. Here the player
    // itself calls back (`didPlayToEnd`), so there is nothing to keep.

public:
    std::optional<int> film;

    explicit Screen(bool muted);

    /// The stretch of the film that plays, when a part of it is marked (seconds).
    /// (`ClosedRange<Double>` in the Swift: `a...b` is `Screen::Span{a, b}`.)
    struct Span {
        double lowerBound = 0;
        double upperBound = 0;
    };
    std::optional<Span> span;

    /// `url` is the file's path (see library.h).
    void show(int film, const std::string& url, Vec2 size, const EntityRef& holder, Vec2 offset = Vec2::zero());

    /// Plays only the marked stretch, over and over; nil for the whole film again.
    void loop(std::optional<Span> range);

    void hide();

    // NOTE(port): added for Quest. Something drawn just in front of the film, which shows and goes with it:
    // the round corners of an agent's card's poster (core/cards).
    void cover(const EntityRef& e);

private:
    EntityRef covering;

public:

    /// Shows the picture once it is really running, so the still never
    /// gives way to a black frame.
    void update();

    bool playing() const { return film.has_value(); }

private:
    // NOTE(port): when `hide` wants the player's film dropped (0.15 s after it), on the clock
    // `mediaTime()`: see `hide` and `update`. The Swift leaves this to DispatchQueue.main.asyncAfter.
    std::optional<double> dropAt;
};
