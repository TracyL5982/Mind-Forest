// Not a port: there is nothing like it in the visionOS app. Light drawn on
// the hands themselves, in the small tree's language (soft lines, rings,
// orbs), so that a gesture shows what it is doing where the hand is:
//
// - Round a closed hand, a gauge that goes where the fist goes. Its rings
//   lie flat to the canvas and its gates stand along the line into it,
//   because that is the frame the tree is carried and stepped in; a small
//   plate in the middle tips with the fist itself. While the fist has not
//   yet committed, a ring that fills as it nears the distance that commits
//   it. Carrying the tree: a tail from where the fist closed to the fist,
//   marked every 5 cm, whose length is how far it has carried. Between
//   layers: gates that slide through the fist's ring as it pushes or pulls;
//   an arc on the gate ahead fills as that gate nears, and at the step it
//   is the fist's.
// - On the index finger of a hand that is over the small tree, an orb: it
//   glows when the finger rests on a level and dims between two, and a ring
//   closes round it as the thumb comes in to pick.
#pragma once
#include <memory>
#include <vector>

#include "../scene.h"
#include "shapes.h"

class HandGlow {
public:
    /// A closed hand that counts as a fist, as Hands reads it.
    struct Grab {
        int hand = 0;
        int way = 0;                // 0 not yet known, 1 between layers, 2 carrying the tree
        Vec3 centre;                // the middle of the fist now
        Quat turn;                  // how the hand is turned: +Z back toward the wrist, +Y out of the back of the hand (OpenXR's palm)
        Vec3 offset;                // how far the hand is from where it closed
        Vec3 ahead, right;          // away from you and to the right, where the hand is
        Vec2 carried;               // how far it has carried the tree, right and up, m
        float depth = 0;            // how far it is from where it closed, along `ahead`, m
        float base = 0;             // the depth it last stepped a layer at
        float pull = 0.1f;          // m of travel that steps a layer
        float lock = 0.035f;        // m it moves before it is known which way it is going
        bool canBack = true;        // there is an earlier layer to step back to (a pull toward you)
        bool canForward = true;     // and a later one to go forward to (a push away)
    };
    /// A fingertip of the hand that is over the small tree.
    struct Finger {
        Vec3 tip;
        bool lead = false;          // the index finger: the one whose height picks the level
        float snap = 0;             // 0 between two levels … 1 resting on one
        float closing = 0;          // 0 thumb away … 1 pinched
        Vec3 axis;                  // for the lead: the point on the tree's trunk at the finger's height
    };

    /// A hand held flat: the knife. A line of light runs out of its fingers.
    struct Blade {
        Vec3 tip, palm;
        float shown = 1;
    };
    /// A thread in the accent: one a blade points at or a ray rests on (`lit`), or one marked for
    /// cutting (`armed`, with how much of its time is `left`, shown as a ring running down at `at`).
    struct Cut {
        std::vector<Vec3> line;
        Vec3 at;
        float lit = 0;
        float armed = 0;
        float left = 1;
        bool leader = false;        // a line of dashes from `from` (the blade's tip) to `at`
        Vec3 from;
    };
    /// Palms held together: a ring round them that fills over the second they are held.
    struct Hold {
        Vec3 at;
        float progress = 0;
    };
    /// Set before `draw`, each frame (oceanmodel_cut.cpp).
    std::vector<Blade> blades;
    std::vector<Cut> cuts;
    std::optional<Hold> hold;

    static std::shared_ptr<HandGlow> make(const std::optional<Material>& material);
    EntityRef entity;

    /// Redraws it. `grabs` and `fingers` are what is there this frame; what has just gone fades out.
    /// Returns whether anything still shows (so the caller knows frames are still wanted).
    bool draw(Vec3 eye, const std::vector<Grab>& grabs, const std::vector<Finger>& fingers, double now, float dt);
    /// The level under the lead finger changed: its orb answers with a pulse.
    void pulse(double now) { pulsedAt = now; }

private:
    HandGlow() = default;
    struct Pen;
    LowLevelMeshRef mesh;
    struct Held {
        Grab grab;
        float shown = 0;            // 0…1, eased
        bool present = false;
        float base = 0;
        double steppedAt = -10;     // when it last stepped a layer: the gate flashes
        int steppedWay = 0;
        Vec3 origin;                // where the fist's middle was when it closed, steadied
        Vec3 centre;                // where it is now, and how it is turned: followed closely, without the hand's shiver
        Quat turn;
        float moved = 0;            // between layers: how far past the last step it shows, easing after a step
        bool placed = false;
    };
    Held held[2];
    std::vector<Finger> lastFingers;
    float fingersShown = 0;
    double pulsedAt = -10;
    bool blank = true;

    void gauge(Pen& pen, const Held& h, double now) const;
    void blade(Pen& pen, const Blade& b) const;
    void cut(Pen& pen, const Cut& c) const;
    void orbs(Pen& pen, const std::vector<Finger>& fingers, float shown, double now) const;
};
