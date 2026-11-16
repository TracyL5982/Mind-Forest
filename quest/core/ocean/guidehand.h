// Not a port: there is nothing like it in the visionOS app. The guide's hand and the gestures it shows,
// carried over line for line from the sketch they were designed in (sketches/onboarding/hand.js and
// gestures.js, which are not in git: this is now where they live).
//
// The hand is the headset's own model of a hand (written out once with `-dumpHandMesh`, kept with the
// media as hands/hand-right.bin), posed by bending its joints. A gesture is a few seconds that loop:
// a function that, for a time, puts hands, lines, fills and orbs into a Frame. guide.cpp draws the Frame.
//
// A gesture's space is the viewer's: +x right, +y up, +z toward them, metres, at life size. A hand's own
// space: the wrist at the origin, fingers along +y, the back of the hand toward +z; a right hand's thumb
// is at -x, and a left hand is the same mirrored in x.
#pragma once
#include <cstdint>
#include <string>
#include <vector>

#include "../vecmath.h"

namespace guide {

// MARK: - Poses

/// How far each joint is bent from the model's own open hand, degrees: each finger's three joints
/// (knuckle, middle, last), index to little; how far each finger leans sideways at the knuckle
/// (+ toward the little finger); and the thumb: its base bent toward the palm, swung, and rolled,
/// then its two joints bent.
struct Pose {
    float fingers[4][3];
    float lean[4];
    float thumb[5];
};
extern const Pose rest, pinch, fist, flat, pray, point, pointPinch;
Pose mixPose(const Pose& a, const Pose& b, float u);

/// Turned about y (yaw), then tipped about x (pitch), then rolled about z, then twisted about the hand's
/// own fingers, degrees: how a hand is held. `held` is the same for either hand (a left hand is held as
/// the right one's mirror image).
Quat turn(float yaw, float pitch, float roll, float twist = 0);
Quat held(bool left, float yaw, float pitch, float roll = 0, float twist = 0);

// MARK: - Pace

float bezier(float x1, float y1, float x2, float y2, float u);
/// Something that travels; something that arrives from nowhere; a hand closing or opening.
float travel(float u);
float arrive(float u);
float snap(float u);
/// How far through the stretch from `from` to `to` the time `t` is, 0…1.
float span(float t, float from, float to);

extern const Vec3 white, cool, warm, hot;

// MARK: - The model

/// Reads the model from the bytes of hands/hand-right.bin. False if they are not one.
bool loadModel(const std::string& bytes);
bool hasModel();
/// How many points the model has; its triangles, for a right hand and (turned over) for a left; and how
/// much of each point is there (the model ends at the wrist with a flat cut: it is let fade toward it).
int modelCount();
const std::vector<uint32_t>& modelTriangles(bool left);
const std::vector<float>& modelThere();

// MARK: - A frame: everything drawn at one moment

/// Where a hand's parts are, in the frame's space.
struct HandParts {
    Vec3 index, thumb, middle, little, palm;
    Vec3 pinch;         // between the index and thumb tips
    Vec3 grip;          // the middle of a closed fist
    Vec3 aim;           // where the hand's ray leaves it
    Vec3 fingers, back, side;       // the hand's own directions
};

struct Frame {
    struct Hand {
        std::vector<Vec3> positions, normals;       // modelCount() of each
        bool left = false;
        float alpha = 1;
    };
    struct Stroke {
        std::vector<Vec3> points;
        std::vector<float> alphas;
        float width = 0.001f;
        Vec3 colour;
        bool closed = false;
    };
    struct Orb {
        Vec3 p;
        float radius = 0;
        Vec3 colour;
        float alpha = 0;
    };
    struct Film {
        std::vector<Vec3> points;       // a convex outline, filled
        Vec3 colour;
        float alpha = 0;
    };
    std::vector<Hand> hands;
    std::vector<Stroke> strokes;
    std::vector<Orb> orbs;
    std::vector<Film> films;
    /// Everything put in from now on is this much there.
    float fade = 1;
    /// Which of `hands` was put in last; -1 if the last was not drawn.
    int pressed = -1;

    /// Empties it for the next moment (keeping its memory).
    void clear();

    /// A hand held at `at`, turned by `q`, `size` times life size. Returns where its parts are.
    /// With `alpha` 0 nothing is drawn: only the parts are worked out.
    HandParts hand(bool left, const Pose& pose, Vec3 at, Quat q, float alpha = 1, float size = 1);

    /// Presses the hand just put in against a flat face: whatever of it lies past the plane through `at` (on the
    /// side `n` points away from) is brought onto the plane, as a palm flattens against what it is pressed to.
    void press(Vec3 at, Vec3 n);

    void line(Vec3 a, Vec3 b, float width, Vec3 colour, float alphaA, float alphaB);
    void line(Vec3 a, Vec3 b, float width, Vec3 colour, float alpha) { line(a, b, width, colour, alpha, alpha); }
    /// A line through `points`.
    void path(const std::vector<Vec3>& points, float width, Vec3 colour, float alpha, bool closed = false);
    /// Part of a ring in the plane of `x` and `y` round `c`, from angle `from` to `to` (radians, counter-clockwise from `x`).
    void arc(Vec3 c, Vec3 x, Vec3 y, float radius, float from, float to, float width, Vec3 colour, float alpha);
    void ring(Vec3 c, Vec3 x, Vec3 y, float radius, float width, Vec3 colour, float alpha);
    /// A ring of dashes; a line of dashes from `a` to `b`, each `dash` long.
    void dashes(Vec3 c, Vec3 x, Vec3 y, float radius, int count, float width, Vec3 colour, float alpha);
    void dashed(Vec3 a, Vec3 b, float dash, float width, Vec3 colour, float alphaA, float alphaB);
    void dashed(Vec3 a, Vec3 b, float dash, float width, Vec3 colour, float alpha) { dashed(a, b, dash, width, colour, alpha, alpha); }
    /// A rectangle with rounded corners in the plane of `x` and `y` round `c`: a card.
    void card(Vec3 c, Vec3 x, Vec3 y, float w, float h, float corner, float width, Vec3 colour, float alpha, float fill = 0);
    /// A faint fill inside `points`.
    void film(const std::vector<Vec3>& points, Vec3 colour, float alpha);
    /// A small ball of light.
    void orb(Vec3 p, float radius, Vec3 colour, float alpha);
};

// MARK: - The gestures

struct Gesture {
    const char* id;                         // "pinch", "layers", "carry", "spread", "mark", "tree", "cut", "clap", "drag"
    void (*draw)(float t, Frame& f);        // at `t` seconds of its loop
    float seconds;                          // how long its loop is
    const char* title;                      // four or five words
    const char* line;                       // and a second line, no longer
};
const std::vector<Gesture>& gestures();
/// The one called `id`, or null.
const Gesture* gesture(const std::string& id);

}  // namespace guide
