// Port of visionos/MindPalace/Ocean/Hands.swift.
#pragma once
#include <optional>
#include <string>
#include <vector>

#include "../base.h"
#include "../vecmath.h"
#include "../platform.h"

/// The hand gestures of the ocean mode, read from ARKit hand tracking
/// (so, on the headset only; the simulator has stand-ins):
/// - A fist, pulled toward you or pushed away, moves between the tree's layers.
///   Moved sideways or up and down instead, it carries the tree with it.
///   Whichever way it first moves is what it does until it opens.
/// - A flat hand swept sideways, like a knife, cuts the thread it crosses.
/// - A clap front to back, one hand nearer and one farther along your line of
///   sight, presses the tree flat.
///
/// NOTE(port): on the Quest the hands come from the host (platform::hand), which reads OpenXR
/// hand tracking; the Mac preview has stand-ins.
class Hands {
public:
    struct Event {
        enum class Kind { layer, pan, panEnded, cut, clap };
        Kind kind = Kind::clap;
        int steps = 0;          // layer: +1: a step back toward the root, -1: forward again
        Vec2 move;              // pan: a closed hand moved this far right and up, m
                                // panEnded: it opened, moving this fast, m/s
        Vec3 from, to;          // cut: where the blade's tip was and is

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
    static constexpr float fistLock = 0.035f;           // m a fist moves before it is known which way it is going
    // NOTE(port): added for Quest, from readings taken in the headset (2026-11-13): a real fist reads
    // a system grasp of 1.0 with every fingertip within 0.86 to 0.9 hand lengths of the wrist; a
    // half-closed hand, in the lap above all, is given a grasp of 0.9 to 1.0 as well, but its fingers
    // reach 1.26 or more. So a fist needs both, and once made it is kept until the hand clearly opens.
    static constexpr float fistGrasp = 0.9f;            // the system's closed-hand reading (0…1) a fist needs
    static constexpr float fistReachQuest = 1.05f;      // and how far any fingertip may reach, in hand lengths
    static constexpr float fistKeepGrasp = 0.6f;        // a fist already made is kept above this reading
    static constexpr float fistKeepReach = 1.2f;        // and within this reach
    static constexpr float pinchClosed = 0.017f;        // m between thumb and index when they pinch
    static constexpr float bladeSpeed = 1.1f;           // m/s the fingertips must move to cut
    static constexpr float clapArm = 0.2f;              // m apart, in depth, before a clap can start
    static constexpr float clapClose = 0.075f;          // m apart when it lands
    static constexpr double clapWindow = 0.7;           // s from armed to landed

    // NOTE(port): no ARKitSession and no HandTrackingProvider: the host tracks the hands and
    // gives both each frame, already in world space (platform::hand).
    bool tracking = false;
    /// Why the hands are or aren't being read, in a few words.
    std::string status = "not started";
    /// A fist or a blade was seen this recently: pinches meanwhile aren't taps.
    double busyUntil = 0;

private:
    struct Axes {
        Vec3 ahead;
        Vec3 right;
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
        Vec2 carried = Vec2::zero();            // how far it has carried the tree, right and up
        Vec2 speed = Vec2::zero();              // and how fast, smoothed
        double cutUntil = 0.0;
        std::vector<float> reach;               // each fingertip's distance from the wrist, in hand lengths
        std::vector<Vec3> tips;                 // every fingertip
        Vec3 index = Vec3::zero();
        float pinch = 1;                        // m between thumb tip and index tip
    };
    Hand left, right;
    std::optional<double> clapArmedAt;
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

    // NOTE(port): added for Quest, for the gauge drawn round a closed hand (handglow.h).
    /// What a closed hand is doing, once it has been closed long enough to count.
    struct Grab {
        int hand = 0;               // 0 left, 1 right
        int way = 0;                // 0 not yet known, 1 between layers, 2 carrying the tree
        Vec3 centre;                // the middle of the fist
        Quat turn;                  // how the hand is turned (the palm joint's rotation)
        Vec3 offset;                // how far the hand is from where it closed
        Vec3 ahead, right;
        Vec2 carried;
        float depth = 0;            // along `ahead`, from where it closed
        float base = 0;             // the depth it last stepped a layer at
    };
    std::vector<Grab> grabs() const;

    /// Pinches for the next moment are not taps.
    void hold(double seconds = 0.5);

    void start();

    /// Reads both hands and returns what they did this frame. `forward` is
    /// the stage's line of sight.
    std::vector<Event> update(Vec3 origin, Vec3 f, float dt);

private:
    void read(const platform::Hand& anchor, Hand& hand, double now);

    void fist(Hand& hand, Vec3 origin, Vec3 f, double now, std::vector<Event>& events);

    void blade(Hand& hand, double now, std::vector<Event>& events);

public:
    /// Told that a cut landed, so one swing cuts one thread.
    void cutLanded();

private:
    void clap(Vec3 f, double now, std::vector<Event>& events);
};
