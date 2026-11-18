// A card as the scene shows it: its small and open faces, its film, and how it moves.
#pragma once
#include <algorithm>
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

/// How far the open face stands in front of the small one, m (see the constructor).
constexpr float openLift = 0.0015f;

/// What the user marked on a service card with the pen, as the scene draws it.
struct CardEdit {
    enum class Kind { highlight, stroke, stretch };
    std::string id;
    Kind kind = Kind::highlight;
    /// A highlight: the words, and which of their appearances on the card's content it is, 0 the first.
    std::string quote;
    int occurrence = 0;
    /// A line: its points in order, each 0 to 1 across and down the card's whole content, however far it is scrolled.
    std::vector<Vec2> points;
    /// A stretch of the card's video: seconds from its start. A card keeps one, drawn as the pen's own mark (`syncStretch`).
    double from = 0, to = 0;
    bool operator==(const CardEdit& o) const {
        return id == o.id && kind == o.kind && quote == o.quote && occurrence == o.occurrence && from == o.from && to == o.to && points.size() == o.points.size() &&
               std::equal(points.begin(), points.end(), o.points.begin(), [](Vec2 a, Vec2 b) { return a.x == b.x && a.y == b.y; });
    }
};

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
    // `float` is a C++ keyword, hence the underscore.
    Tween<float> float_{0.f};           // how far it stands off its sheet, in steps: a condensed group floats
    Tween<Vec3> tint{Vec3::repeating(1)};   // its branch's colour, linear: for its thread and its group's glass
    // Where the last frame put it, for the glass under its group.
    Vec2 sheetAt = Vec2::zero();        // on its sheet, m from the sheet's middle
    float behind = 0;                   // how many layers back its sheet is
    float lift = 0;                     // m off that sheet
    Vec3 source = Vec3::zero();         // where it comes from, and goes back to
    float sourceScale = 0.2f;
    // A card that rises out of a picture on a put-away tree's cover takes
    // that picture's place: it is there whole from its first moment (not faded in as it leaves), exactly
    // the picture's size, and turned as the picture was, coming round to its layer on the way. Unset
    // again once it has arrived.
    std::optional<Quat> sourceTurn;
    double bornAt = 0.0;
    double goneAt = std::numeric_limits<double>::infinity();
    std::optional<int> home;            // its film's or work's place in the ocean
    EntityRef picture;                  // an open work's picture
    // An open card's frame; the panel that scrolls in its window, and the bar
    // that says where. The service's cards also have the ring round a pinch held still, and the user's edits, made with the
    // pen and kept with the card, drawn as one see-through amber mesh behind the words and one white mesh of lines, both
    // cut to the window.
    EntityRef openFace;
    EntityRef openPanel;
    EntityRef scrollBar;
    EntityRef holdRing;
    int holdShown = -1;
    // AGENT: the same ring round a pinch held still on the card while it is closed, made the first time (`holdPress`).
    EntityRef pressRing;
    int pressShown = -1;
    std::vector<CardEdit> edits;
    EntityRef highlights;
    EntityRef lines;
    /// The content's text, laid out once each time the card is drawn anew (`runsDrawn`, its generation): what a
    /// highlight is found in. And where the content lies, px: the frame, the window in it, and how tall the whole content is.
    std::vector<std::shared_ptr<TextBlock>> runs;
    int runsDrawn = -1;
    struct Content {
        CGSize frame;
        CGRect window;
        float tall = 0;
    };
    Content content;
    // A card whose look the agents are still choosing: the holder its small
    // face is drawn in, the soft light that runs across it, and, once its finished card has come, how it eases to
    // that card's size under it (OceanModel::settleCard).
    EntityRef shape;
    EntityRef shimmer;
    struct Settle {
        Vec2 from, to;
        double start;
    };
    std::optional<Settle> settle;
    /// The finished card a composing one gives way to, while its faces are still on their way to the GPU: until they are there
    /// the composing card stays as it was, so nothing is ever shown empty.
    std::weak_ptr<CardView> givingWay;
    double givingWaySince = 0;
    /// How much of its faces show, 0…1, as a finished card comes up inside the composing one; its card, its glow and
    /// what it leads stay as they are, so the glass of its group never thins.
    float appear = 1;
    std::optional<double> appearAt;
    bool pictureFull = false;           // … shown from its own file (asked for, or there), not from the atlas
    bool step = false;                  // it is a layer's first card, standing on the path
    bool lit = true;                    // it glows while it is on the layer you work on

private:
    std::vector<EntityRef> glows;
    float shownGlow = -1;

public:
    /// Its glows, to tell them apart in a look at what is drawn (`OceanModel::depthAudit`).
    const std::vector<EntityRef>& glowPieces() const { return glows; }
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
    float shownAppear = 1;

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
    // The player itself calls back (`didPlayToEnd`), so there is nothing to keep.

public:
    std::optional<int> film;

    explicit Screen(bool muted);

    /// The stretch of the film that plays, when a part of it is marked (seconds).
    /// (From `a` to `b`: `Screen::Span{a, b}`.)
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

    // Something drawn just in front of the film, which shows and goes with it:
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
    // When `hide` wants the player's film dropped (0.15 s after it), on the clock `mediaTime()`: see `hide`
    // and `update`.
    std::optional<double> dropAt;
};
