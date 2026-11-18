// The hand gestures: the fist that pulls layers and carries the tree, the blade that cuts, the palms together.
#pragma once
#include <functional>
#include <optional>
#include <string>
#include <vector>

#include "../base.h"
#include "../vecmath.h"
#include "../platform.h"

/// The hand gestures of the ocean mode, read from hand tracking
/// (so, on the headset only; the Mac preview has stand-ins):
/// - A fist, pulled toward you or pushed away, moves between the tree's layers.
///   Moved sideways or up and down instead, it carries the tree with it.
///   (2026-11-15.) Both are read in one frame, set when the fist closes: the shortest line from the fist to the layer in front of it
///   is the normal axis, and the plane across that line is where the tree is carried. Which of the two the
///   fist is doing follows the whole movement so far and can change, with a buffer between them, until one
///   of them is committed: a carry of `panCommit`, or a layer stepped. From then on it is that until it opens.
/// - A flat hand swept sideways, like a knife, cuts the thread it crosses.
///   (2026-11-15.) Any open hand with its fingers together was a knife, so one
///   showed beside the pointer of nearly every hand. Now it is a pose that has to be made and held: fingers
///   straight and together, the hand on its edge, not pinching, the other hand not at it, for `knifeDwell`.
/// - The palms put together, fingers up, and held for a second presses the tree flat.
///
/// The hands come from the host (platform::hand), which reads OpenXR hand tracking.
class Hands {
public:
    struct Event {
        // `panUndone`: a carry that turned out to be a push is taken back.
        enum class Kind { layer, pan, panUndone, panEnded, cut, clap };
        Kind kind = Kind::clap;
        int steps = 0;          // layer: +1: a step back toward the root, -1: forward again
        Vec2 move;              // pan: a closed hand moved this far right and up, m
                                // panEnded: it opened, moving this fast, m/s
        Vec3 from, to;          // cut: where the blade's point was and is

        static Event layer(int steps) {
            Event e;
            e.kind = Kind::layer;
            e.steps = steps;
            return e;
        }
        static Event pan(Vec2 move) {
            Event e;
            e.kind = Kind::pan;
            e.move = move;
            return e;
        }
        static Event panUndone(Vec2 move) {
            Event e;
            e.kind = Kind::panUndone;
            e.move = move;
            return e;
        }
        static Event panEnded(Vec2 speed) {
            Event e;
            e.kind = Kind::panEnded;
            e.move = speed;
            return e;
        }
        static Event cut(Vec3 from, Vec3 to) {
            Event e;
            e.kind = Kind::cut;
            e.from = from;
            e.to = to;
            return e;
        }
        static Event clap() {
            Event e;
            e.kind = Kind::clap;
            return e;
        }
    };

    // A fingertip's distance from the wrist, as a share of the hand's own length (wrist to middle knuckle),
    // so it holds for any hand: curled into a fist it is well under that length, stretched out nearly twice it.
    static constexpr float fistReach = 1.15f;
    static constexpr float openReach = 1.38f;
    static constexpr float layerPull = 0.1f;            // m of fist travel per layer
    // Only where reading begins: a fist is decided for good later.
    static constexpr float fistLock = 0.03f;            // m a fist moves before anything is read into it
    // Which of the two a movement is, by how it leans: along the normal axis steeper than `pushLean` it is
    // between layers, flatter than `panLean` it carries. Between the two is the buffer, where it stays what it
    // was; a fist that has been nothing yet and is still in the buffer by `fistSure` is whichever is nearer.
    static constexpr float pushLean = 1.28f;            // tan 52 degrees: depth over travel across
    static constexpr float panLean = 0.78f;             // tan 38 degrees
    static constexpr float fistSure = 0.06f;            // m
    static constexpr float panCommit = 0.09f;           // m across from where it closed: from here the fist only carries, until it opens
    // From readings taken in the headset (2026-11-13): a real fist reads
    // a system grasp of 1.0 with every fingertip within 0.86 to 0.9 hand lengths of the wrist; a
    // half-closed hand, in the lap above all, is given a grasp of 0.9 to 1.0 as well, but its fingers
    // reach 1.26 or more. So a fist needs both, and once made it is kept until the hand clearly opens.
    static constexpr float fistGrasp = 0.9f;            // the system's closed-hand reading (0…1) a fist needs
    static constexpr float fistReachQuest = 1.05f;      // and how far any fingertip may reach, in hand lengths
    static constexpr float fistKeepGrasp = 0.6f;        // a fist already made is kept above this reading
    static constexpr float fistKeepReach = 1.2f;        // and within this reach
    static constexpr float pinchClosed = 0.017f;        // m between thumb and index when they pinch
    // A slice only marks a thread, and a second one cuts it, so it can be easy to make.
    // (2026-11-15, after Kai wore it:) the blade points, as its line of light
    // says it does, so what cuts is the place on the layer it points at, and a stroke is that place's travel
    // there. 2 m/s on a layer 1.2 m off is a hand turning about 95 degrees a second: a flick meant as one.
    static constexpr float bladeSpeed = 2.0f;           // m/s the place the blade points at must move to cut
    // What makes a hand a knife. A finger's straightness is the
    // distance from its knuckle to its tip over the length of its three bones: 1 laid out straight, about 0.95
    // in a hand at rest. Each asks more to begin than to keep, so the pose does not flicker at its edge.
    // (Each of the measures that begin it was asked a little more of on 2026-11-15, after Kai wore the first
    // set and found the knife could "still be a little bit harder to make": 0.965, 0.42, 0.78, 0.55, 0.72, 0.3 s.)
    static constexpr float knifeStraight = 0.975f, knifeStraightKeep = 0.93f;
    static constexpr float knifeBent = 0.36f, knifeBentKeep = 0.6f;            // how far a finger may leave the palm's plane at its knuckle (the sine of it)
    static constexpr float knifeTogether = 0.74f, knifeTogetherKeep = 0.95f;   // index tip to little tip, in hand lengths
    static constexpr float knifeEdge = 0.45f, knifeEdgeKeep = 0.78f;           // how far the palm may face up or down (the sine of it)
    static constexpr float knifeFacing = 0.62f, knifeFacingKeep = 0.88f;       // and toward or away from you
    static constexpr float knifeApart = 0.035f;         // m between thumb and index, on the pinch's own scale: not about to pinch
    static constexpr float knifeAlone = 0.22f;          // m the other hand's palm keeps away: hands coming together are not knives
    static constexpr double knifeDwell = 0.45;          // s the pose is held before the blade is out
    static constexpr double knifeGrace = 0.18;          // s a blade that is out survives the pose being lost (a fast stroke blurs the fingers)
    static constexpr float knifeReach = 0.08f;          // m past the middle fingertip the blade is at its brightest: from there it thins out to where it points
    static constexpr double strokeSpan = 0.06;          // s of travel a stroke is judged over
    // One stroke, one cut. After a cut lands nothing cuts for `cutPause`, and after that not until the place the
    // blade points at has come to rest: slower than `strokeRest` for `strokeRestFor`. A hand that shakes, or
    // tracking that jitters, goes on moving and so never makes the second cut that confirms; a second stroke
    // made on purpose starts from a pause. (0.6 s alone let a shake through.)
    static constexpr double cutPause = 0.8;             // s
    static constexpr float strokeRest = 0.5f;           // m/s on the surface
    static constexpr double strokeRestFor = 0.2;        // s
    static constexpr float knifeSteady = 0.04f;         // s the way the blade points is steadied over: at 1.2 m a degree of shiver is 2 cm
    // A clap that lands at once is set off by hands passing each other, so the
    // palms are put together, fingers up, as in prayer, and held so for a second.
    static constexpr float clapClose = 0.085f;          // m between the middles of the palms when they are together
    static constexpr double clapHold = 1.0;             // s they are held so
    static constexpr float clapUp = 0.03f;              // m each middle fingertip is above its wrist as they come together: fingers up

    // The host tracks the hands and gives both each frame, already in world space (platform::hand).
    bool tracking = false;
    /// Why the hands are or aren't being read, in a few words.
    std::string status = "not started";
    /// A fist or a blade was seen this recently: pinches meanwhile aren't taps.
    double busyUntil = 0;
    /// The same, for each hand (0 left, 1 right): a fist held in one
    /// hand says nothing of a pinch made with the other. (A left hand resting closed kept every pinch of the right from
    /// being taken.) Palms together, and `hold`, busy both.
    double handBusy[2] = {0, 0};
    bool busyFor(int hand) const { return hand >= 0 && hand < 2 && mediaTime() < handBusy[hand]; }

private:
    struct Axes {
        Vec3 ahead;                             // the normal axis: from the fist into the surface in front of it
        Vec3 right;
        Vec3 up;
    };
    struct Hand {
        bool tracked = false;
        Vec3 wrist = Vec3::zero();
        Vec3 palm = Vec3::zero();
        Vec3 tip = Vec3::zero();                // middle fingertip
        std::optional<Vec3> lastTip;
        double lastSeen = 0.0;
        bool fist = false;
        bool flat = false;
        std::optional<double> fistSince;
        double fistLast = -10.0;                // when it was last closed
        std::optional<float> fistBase;          // depth along the view when the fist closed, or last stepped
        std::optional<Vec3> fistAt;             // where the fist closed
        std::optional<Axes> fistAxes;
        int fistWay = 0;                        // 0 not yet known, 1 between layers, 2 carrying the tree
        bool fistLocked = false;                // committed: it is `fistWay` until it opens
        Vec2 carried = Vec2::zero();            // where across the frame the tree has been carried to
        Vec2 carriedFrom = Vec2::zero();        // and where the carry began
        Vec2 speed = Vec2::zero();              // and how fast, smoothed
        double cutUntil = 0.0;
        // The knife.
        Vec3 back = Vec3{0, 1, 0};              // out of the back of the hand
        Vec3 point = Vec3::zero();              // `knifeReach` past the middle fingertip, the way the blade points
        std::optional<Vec3> aim;                // the way the blade points: from the wrist through the middle fingertip, steadied
        std::optional<Vec3> mark;               // where on the surface it points: the place that cuts
        std::optional<double> flatSince;        // since when the pose has been held
        double flatLast = -10.0;                // when it was last seen
        bool out = false;                       // the blade is out
        bool spent = false;                     // its stroke has cut: it must come to rest before it cuts again
        std::optional<double> restSince;        // since when it has been at rest
        struct Was {
            double at;
            Vec3 mark;
        };
        std::vector<Was> trail;                 // where it has pointed, this last moment
        std::vector<float> reach;               // each fingertip's distance from the wrist, in hand lengths
        std::vector<Vec3> tips;                 // every fingertip
        Vec3 index = Vec3::zero();
        float pinch = 1;                        // m between thumb tip and index tip
    };
    Hand left, right;
    std::optional<double> clapSince;                    // since when the palms have been together
    double clapSeen = 0.0;                              // when they were last seen so
    Vec3 clapAt = Vec3::zero();
    double clapUntil = 0.0;
    float frame = 1.0f / 90;

public:
    /// While fingers are on the step cards, nothing else is read from the hands.
    bool quiet = false;

    /// A fingertip, with which hand it is on (0 left, 1 right).
    struct Fingertip {
        int hand;
        Vec3 tip;
    };
    /// Every tracked fingertip of both hands, with which hand it is on (0 left, 1 right).
    std::vector<Fingertip> fingertips() const;

    /// An index fingertip, and how far its thumb is from it.
    struct Pointer {
        Vec3 tip;
        float pinch;
    };
    /// The index fingertip of one hand, and how far its thumb is from it.
    std::optional<Pointer> pointer(int hand) const;

    /// What the hands are doing, in a line, for the readout.
    std::string summary() const;

    /// Whether a hand is closed, or was a moment ago: a hand that is carrying
    /// the tree, or has just let it go, is not reaching for the step cards.
    bool grabbing(int hand) const;

    /// A closed hand is stepping between layers or carrying the tree right now.
    bool carrying() const { return left.fistWay != 0 || right.fistWay != 0; }

    /// The frame a closed hand is read in: the surface in front of it, as the scene has it.
    struct Surface {
        Vec3 normal;                // from the hand into the surface, along the shortest line to it
        Vec3 right, up;             // across the surface there
    };
    /// Asked once as a fist closes, with where the fist is. Set by the scene; without it the frame is the stage's own.
    std::function<std::optional<Surface>(Vec3)> surface;
    /// Where a line from a point, along a direction, meets the surface a blade cuts on. Set by the scene; without it
    /// a blade points at nothing and cuts nothing.
    std::function<std::optional<Vec3>(Vec3, Vec3)> target;

    // For the gauge drawn round a closed hand (handglow.h).
    /// What a closed hand is doing, once it has been closed long enough to count.
    struct Grab {
        int hand = 0;               // 0 left, 1 right
        int way = 0;                // 0 not yet known, 1 between layers, 2 carrying the tree
        Vec3 centre;                // the middle of the fist
        Quat turn;                  // how the hand is turned (the palm joint's rotation)
        Vec3 offset;                // how far the hand is from where it closed
        Vec3 ahead, right, up;
        Vec2 carried;               // carrying: how far it has carried the tree; otherwise how far across it is
        float depth = 0;            // along `ahead`, from where it closed
        float base = 0;             // the depth it last stepped a layer at
        bool locked = false;        // it can no longer become the other
    };
    std::vector<Grab> grabs() const;

    // For the blade drawn on a flat hand (handglow.h).
    /// A hand held as a knife (see `knifeStraight`).
    struct Blade {
        int hand = 0;               // 0 left, 1 right
        Vec3 tip;                   // the middle fingertip
        Vec3 palm;
        Vec3 point;                 // where the blade is at its brightest, a little past the fingertip
        Vec3 along;                 // the way it points
        std::optional<Vec3> mark;   // where on the surface it points: the place that cuts
        float ready = 0;            // 0…1: how much of `knifeDwell` the pose has been held
        bool out = false;           // the blade is out: a stroke of it cuts
    };
    std::vector<Blade> blades() const;

    // For the ring drawn round palms held together (handglow.h).
    /// The palms are together and being held: where, and how much of the second has passed.
    struct Held {
        Vec3 at;
        float progress = 0;
    };
    std::optional<Held> held() const;

    /// Pinches for the next moment are not taps.
    void hold(double seconds = 0.5);

    void start();

    /// Reads both hands and returns what they did this frame. `forward` is
    /// the stage's line of sight.
    std::vector<Event> update(Vec3 origin, Vec3 f, float dt);

private:
    void read(const platform::Hand& anchor, Hand& hand, double now);

    void fist(Hand& hand, Vec3 origin, Vec3 f, double now, std::vector<Event>& events);

    void blade(Hand& hand, const Hand& other, double now, std::vector<Event>& events);

public:
    /// Told that a cut landed, so one swing cuts one thread.
    void cutLanded();

private:
    void clap(Vec3 f, double now, std::vector<Event>& events);
};
