// The gestures of the ocean, each as a few seconds of wire hand that loops (see guidehand.h).
//
// A gesture's space is the viewer's: +x right, +y up, +z toward them, metres, at life size. Its middle is
// where the thing acted on would be; the hands come up from below it, as the viewer's own would.
#include "guidehand.h"

#include <algorithm>
#include <cmath>

namespace guide {

namespace {
/// The poses by the name the sketch has for them: a gesture and a pose can be called the same (`pinch`).
namespace poses = guide;

const Vec3 X{1, 0, 0}, Y{0, 1, 0}, Z{0, 0, 1};
float soft(float u) { return u * u * (3 - 2 * u); }
const float tau = 2 * floatPi;

float clamp01(float u) { return std::max(0.f, std::min(1.f, u)); }
/// The sketch's normalize: a zero vector stays zero (vecmath's divides by its length).
Vec3 normalized(Vec3 a) {
    float l = length(a);
    return l > 1e-9f ? a * (1 / l) : Vec3{};
}

/// How much of a gesture is there at `t` of its `T` seconds: it comes, plays, goes, and leaves a breath before it comes again.
float shown(float t, float T) { return soft(span(t, 0, 0.5f)) * (1 - soft(span(t, T - 1.0f, T - 0.5f))); }

/// A ring that opens out from `c` and thins away: something just happened here.
void pulse(Frame& f, Vec3 c, Vec3 x, Vec3 y, float from, float to, float since, float life, Vec3 colour) {
    if (since < 0 || since >= life) return;
    float u = since / life, out = 1 - (1 - u) * (1 - u);
    f.ring(c, x, y, mix(from, to, out), 0.0034f * (1 - u) + 0.0012f, colour, 0.9f * (1 - u));
}

/// A thread from `a` to `b` that bows by `sag`, as the tree's do: points along it from `from` to `to` of its length.
std::vector<Vec3> thread(Vec3 a, Vec3 b, float sag, float from = 0, float to = 1) {
    Vec3 middle = mix(a, b, 0.5f) + Vec3{0, -sag, 0};
    std::vector<Vec3> points;
    for (int k = 0; k <= 16; k++) {
        float u = mix(from, to, float(k) / 16);
        points.push_back(a * ((1 - u) * (1 - u)) + middle * (2 * u * (1 - u)) + b * (u * u));
    }
    return points;
}

/// A hand's ray, as the app draws it: a short stub leaving the hand, a faint line on, and a dot where it lands.
void ray(Frame& f, const HandParts& hand, Vec3 dot, float lit) {
    Vec3 dir = normalized(dot - hand.aim);
    f.line(hand.aim + dir * 0.012f, hand.aim + dir * 0.075f, 0.0022f, cool, 0.75f, 0.05f);
    f.dashed(hand.aim + dir * 0.085f, dot, 0.007f, 0.0011f, cool, 0.1f, 0.34f);
    f.orb(dot, 0.0085f, mix(cool, white, lit), 0.95f);
}

/// A small tree of three cards, its root at `at`: what the gestures on a whole tree are shown on.
void grove(Frame& f, Vec3 at, float alpha, float squeeze = 0, float size = 1) {
    Vec3 root = at + Vec3{0, 0, 0};
    Vec3 a = at + Vec3{-0.085f, 0.062f, 0} * ((1 - squeeze) * size), b = at + Vec3{0.09f, 0.05f, 0} * ((1 - squeeze) * size);
    Vec3 c = at + Vec3{0.012f, -0.07f, 0} * ((1 - squeeze) * size);
    float small = mix(1.f, 0.2f, squeeze) * size;
    for (Vec3 leaf : {a, b, c}) f.path(thread(root, leaf, 0.012f * (1 - squeeze) * size), 0.0012f, cool, 0.5f * alpha * (1 - squeeze));
    f.card(root, X, Y, 0.075f * size, 0.05f * size, 0.005f * size, 0.0016f, white, 0.85f * alpha, 0.07f * alpha);
    for (Vec3 leaf : {a, b, c}) {
        f.card(leaf, X, Y, 0.052f * small, 0.035f * small, 0.004f * small, 0.0013f, white, 0.6f * alpha * (1 - squeeze), 0.04f * alpha);
    }
}

/// The tree's layers as three sheets on a drafting table: the one you work on upright, the ones behind it
/// tipped back and lower. `step` 0 is as it starts; at 1 the layer behind has come forward.
void sheets(Frame& f, Vec3 at, float step, float size = 1) {
    // A sheet's slot: how far down and back it lies, how far it is tipped, how large and how bright it is.
    struct Slot {
        float y, z, tip, size, alpha;
    };
    auto slot = [](float k) {
        float d = std::max(k, -1.f);
        return Slot{-0.05f * d - 0.012f * d * d, -0.05f * d, clamp01(d / 2.6f) * 72, 1 - 0.1f * d, k < -0.5f ? 0 : k < 0 ? 1 + 2 * k : 1 - 0.3f * k};
    };
    for (int n = 0; n < 4; n++) {
        Slot s = slot(float(n) - step);         // sheet n sits in slot n - step … with one waiting in front
        if (s.alpha <= 0.01f || float(n) - step > 2.4f) continue;
        float tip = s.tip * floatPi / 180;
        Vec3 up{0, std::cos(tip), -std::sin(tip)};
        Vec3 c = at + Vec3{0, s.y * size, s.z * size};
        float here = 1 - clamp01(std::fabs(float(n) - step));       // the one you are on
        float far = clamp01(1 - (float(n) - step - 1.4f));
        f.card(c, X, up, 0.2f * s.size * size, 0.105f * s.size * size, 0.008f * size, 0.0013f + 0.0006f * here, mix(cool, white, here),
               (0.36f + 0.54f * here) * s.alpha * far, (0.02f + 0.06f * here) * s.alpha * far);
        // Where you are: the accent, on its corner.
        f.orb(c + (X * ((-0.1f * s.size + 0.012f) * size) + up * ((0.0525f * s.size - 0.012f) * size)), 0.0075f * size, hot, 0.95f * here * s.alpha);
    }
}
}

/// What each gesture draws, under the gesture's own name. Which hand is `left`: false is a right hand.
namespace draw {

// MARK: - Point and pinch

static void pinch(float t, Frame& f) {
    f.fade = shown(t, 5.0f);
    Vec3 c{-0.055f, 0.075f, -0.16f};
    float aim = travel(span(t, 0.6f, 1.55f));
    Vec3 dot = mix(c + Vec3{0.14f, -0.1f, 0}, c + Vec3{0.022f, -0.012f, 0}, aim);
    float on = soft(span(aim, 0.62f, 0.86f));                               // the ray has come onto the card
    float close = snap(span(t, 1.85f, 2.1f)) - snap(span(t, 2.6f, 2.9f));
    float open = arrive(span(t, 2.1f, 2.95f));                              // the card answers: it comes up a size
    float size = 1 + 0.2f * open;
    f.card(c, X, Y, 0.15f * size, 0.1f * size, 0.008f, 0.0016f, mix(white, warm, on), 0.5f + 0.4f * on, 0.03f + 0.05f * on + 0.05f * open);
    HandParts hand = f.hand(false, mixPose(poses::rest, poses::pinch, close), Vec3{0.1f, -0.165f, 0.07f} + Vec3{-0.03f, 0.02f, 0} * aim,
                            held(false, 4 + 12 * aim, -46, 0, 62));
    ray(f, hand, dot, on);
    f.orb(hand.pinch, 0.013f, warm, 0.95f * close);
    pulse(f, dot, X, Y, 0.009f, 0.04f, t - 2.1f, 0.5f, warm);
}

// MARK: - Pinch, hold and move

static void drag(float t, Frame& f) {
    f.fade = shown(t, 5.4f);
    Vec3 from{-0.11f, 0.07f, -0.16f}, to{0.07f, 0.095f, -0.16f};
    float close = snap(span(t, 0.75f, 1.0f)) - snap(span(t, 2.75f, 3.05f));
    float go = travel(span(t, 1.2f, 2.5f));
    float lift = soft(span(t, 1.0f, 1.25f)) - soft(span(t, 2.75f, 3.1f));  // held, it stands a little off the sheet
    Vec3 c = mix(from, to, go) + Vec3{0, 0, 0.022f * lift};
    // Where it was: its place stays marked while it is carried.
    f.card(from, X, Y, 0.11f, 0.074f, 0.006f, 0.0011f, cool, 0.32f * lift);
    f.card(c, X, Y, 0.11f, 0.074f, 0.006f, 0.0016f, mix(white, warm, 0.6f), 0.9f, 0.08f + 0.05f * lift);
    HandParts hand = f.hand(false, mixPose(poses::rest, poses::pinch, close), Vec3{0.03f, -0.165f, 0.07f} + Vec3{0.155f, 0.02f, 0} * go,
                            held(false, 14 - 8 * go, -46, 0, 62));
    ray(f, hand, c + Vec3{0.012f, -0.008f, 0}, 1);
    f.orb(hand.pinch, 0.013f, warm, 0.95f * close);
    pulse(f, to + Vec3{0.012f, -0.008f, 0}, X, Y, 0.009f, 0.036f, t - 3.0f, 0.45f, warm);
}

// MARK: - Pinch and hold still on the open card: more like it, a layer of its own

// The long pinch on an open card of the service's, which asks for more
// like it (OceanModel::holdPress). A ring fills round the pinch while it is held still; full, new cards come up round it.
static void hold(float t, Frame& f) {
    f.fade = shown(t, 6.0f);
    Vec3 c{-0.04f, 0.07f, -0.16f};
    float close = snap(span(t, 0.9f, 1.15f)) - snap(span(t, 3.4f, 3.7f));
    float fill = span(t, 1.3f, 2.5f);
    float grown = arrive(span(t, 2.6f, 3.6f));
    f.card(c, X, Y, 0.15f, 0.1f, 0.008f, 0.0016f, mix(white, warm, 0.6f), 0.9f, 0.08f);
    Vec3 dot = c + Vec3{0.02f, -0.01f, 0};
    HandParts hand = f.hand(false, mixPose(poses::rest, poses::pinch, close), Vec3{0.1f, -0.165f, 0.07f}, held(false, 10, -46, 0, 62));
    ray(f, hand, dot, 1);
    f.orb(hand.pinch, 0.013f, warm, 0.95f * close);
    float ring = close * (1 - soft(span(t, 2.5f, 2.8f)));
    f.ring(dot, X, Y, 0.018f, 0.0016f, cool, 0.45f * ring);
    if (fill > 0) f.arc(dot, X, Y, 0.018f, floatPi / 2 - tau * fill, floatPi / 2, 0.0028f, warm, 0.95f * ring);
    pulse(f, dot, X, Y, 0.018f, 0.06f, t - 2.5f, 0.5f, warm);
    // What the service brings: three cards round it, each on a dashed thread.
    const Vec3 round[3] = {{-0.13f, 0.075f, 0}, {0.135f, 0.06f, 0}, {0.0f, -0.105f, 0}};
    for (const Vec3& off : round) {
        if (grown <= 0.01f) break;
        Vec3 at = c + off * (0.55f + 0.45f * grown);
        f.dashed(c, at, 0.006f, 0.0011f, cool, 0.55f * grown);
        f.card(at, X, Y, 0.07f * grown, 0.047f * grown, 0.005f, 0.0013f, white, 0.75f * grown, 0.05f * grown);
    }
}

// MARK: - A tool picked over the card gone into, and a drag that marks part of it

static void mark(float t, Frame& f) {
    f.fade = shown(t, 6.8f);
    // A card gone into: its picture, and down from its top right corner the pen, the eraser and Send.
    // All three, where the card has them (`layTools`).
    Vec3 c{0.0f, 0.045f, -0.14f};
    float w = 0.25f, h = 0.165f;
    f.card(c, X, Y, w, h, 0.01f, 0.0016f, white, 0.8f, 0.06f);
    Vec3 tool = c + Vec3{w / 2 + 0.026f, h / 2 - 0.018f, 0};
    // First the marker is picked: a pinch on it, and it lights.
    float toTool = travel(span(t, 0.6f, 1.3f)), toCard = travel(span(t, 2.0f, 2.8f));
    float pick = snap(span(t, 1.45f, 1.65f)) - snap(span(t, 1.8f, 2.0f));
    float lit = soft(span(t, 1.65f, 1.85f));
    Vec3 ink = mix(white, hot, lit);
    // A small square button: a pen, at a slant, and the mark it leaves under its tip.
    f.card(tool, X, Y, 0.036f, 0.036f, 0.007f, 0.0014f, ink, 0.7f + 0.3f * lit, 0.05f + 0.3f * lit);
    Vec3 nib = tool + Vec3{-0.0075f, -0.0065f, 0}, up{0.64f, 0.768f, 0}, out{-0.768f, 0.64f, 0};
    auto pen = [&](float along, float across) { return nib + up * along + out * across; };
    f.path({nib, pen(0.006f, 0.0027f), pen(0.022f, 0.0027f), pen(0.022f, -0.0027f), pen(0.006f, -0.0027f)}, 0.0013f, ink, 0.95f, true);
    f.line(pen(0.006f, 0.0027f), pen(0.006f, -0.0027f), 0.0011f, ink, 0.8f);
    f.line(pen(0.018f, 0.0027f), pen(0.018f, -0.0027f), 0.0011f, ink, 0.8f);
    f.path({tool + Vec3{-0.012f, -0.0115f, 0}, tool + Vec3{-0.007f, -0.0128f, 0}, tool + Vec3{-0.001f, -0.0112f, 0}, tool + Vec3{0.005f, -0.0125f, 0}}, 0.0018f, ink, 0.95f);
    // Under it the eraser and Send, faint until something is marked.
    float marked = soft(span(t, 4.4f, 4.9f));
    float glyph = 0.45f + 0.5f * marked;
    Vec3 eraser = tool + Vec3{0, -0.044f, 0}, send = tool + Vec3{0, -0.088f, 0};
    f.card(eraser, X, Y, 0.036f, 0.036f, 0.007f, 0.0014f, white, 0.4f + 0.3f * marked, 0.04f);
    f.path({eraser + Vec3{-0.01f, -0.003f, 0}, eraser + Vec3{0.001f, 0.009f, 0}, eraser + Vec3{0.01f, 0.001f, 0}, eraser + Vec3{-0.001f, -0.011f, 0}}, 0.0012f, white, glyph, true);
    f.line(eraser + Vec3{-0.0045f, 0.003f, 0}, eraser + Vec3{0.0045f, -0.005f, 0}, 0.0011f, white, glyph);
    f.card(send, X, Y, 0.036f, 0.036f, 0.007f, 0.0014f, white, 0.4f + 0.5f * marked, 0.04f + 0.4f * marked);
    f.path({send + Vec3{-0.011f, -0.001f, 0}, send + Vec3{0.011f, 0.009f, 0}, send + Vec3{0.002f, -0.011f, 0}}, 0.0012f, white, glyph, true);
    f.line(send + Vec3{0.011f, 0.009f, 0}, send + Vec3{-0.001f, -0.002f, 0}, 0.0011f, white, glyph);
    // Then it is drawn with, freely: round part of the picture as a hand goes, not quite a circle and on past where it began.
    Vec3 middle = c + Vec3{-0.01f, 0.004f, 0};
    auto round = [&](float u) {
        float turn = -2.3f + u * 7.0f, wobble = 1 + 0.07f * std::sin(3 * turn + 1);
        return middle + Vec3{std::cos(turn) * 0.062f * wobble, std::sin(turn) * 0.044f * wobble - 0.004f * u, 0};
    };
    float hold = snap(span(t, 3.0f, 3.25f)) - snap(span(t, 5.0f, 5.3f));
    float go = travel(span(t, 3.35f, 4.85f));
    Vec3 start = c + Vec3{0.09f, -0.11f, 0};
    Vec3 dot = go > 0 ? round(go) : toCard > 0 ? mix(tool, round(0), toCard) : mix(start, tool, toTool);
    if (go > 0.01f) {
        std::vector<Vec3> stroke;
        int steps = std::max(2, int(std::ceil(56 * go)));
        for (int k = 0; k <= steps; k++) stroke.push_back(round(go * float(k) / float(steps)));
        f.path(stroke, 0.0046f, hot, 0.95f);
    }
    float close = std::max(pick, hold);
    // The hand goes with the line it draws, by half as much: the ray does the rest.
    Vec3 drift = dot - round(0);
    float drawing = go > 0 ? 1.f : 0.f;
    HandParts hand = f.hand(false, mixPose(poses::rest, poses::pinch, close),
                            Vec3{0.075f, -0.19f, 0.08f} + Vec3{0.02f * toCard + 0.03f * toTool * (1 - toCard) + 0.5f * drift.x * drawing, 0.5f * drift.y * drawing, 0},
                            held(false, 8, -46, 0, 62));
    ray(f, hand, dot, 1);
    f.orb(hand.pinch, 0.013f, warm, 0.95f * close);
    pulse(f, tool, X, Y, 0.012f, 0.04f, t - 1.65f, 0.45f, warm);
}

// MARK: - A closed hand, pulled or pushed: between layers

static void layers(float t, Frame& f) {
    f.fade = shown(t, 7.4f);
    float close = snap(span(t, 0.7f, 1.0f)) - snap(span(t, 5.7f, 6.0f));
    float pull = travel(span(t, 1.3f, 2.3f)), push = travel(span(t, 3.7f, 4.7f));
    float depth = 0.1f * (pull - push);                                     // how far toward you the fist is from where it closed
    // The layers glide: slow, as anything that moves the whole tree is.
    float step = travel(span(t, 2.25f, 3.25f)) - travel(span(t, 4.65f, 5.65f));
    sheets(f, {-0.075f, 0.035f, -0.1f}, step, 1.45f);
    Vec3 base{0.105f, -0.17f, 0.0f};
    HandParts hand = f.hand(false, mixPose(poses::rest, poses::fist, close), base + Vec3{0, 0, depth}, held(false, -4, -58, 0, 14));
    // What the app draws round a closed hand, pared down: a gate where it closed and a gate a step nearer,
    // on the line between them. The one it is heading for fills, and rings out when the fist reaches it.
    float g = close;
    Vec3 origin = hand.grip - Vec3{0, 0, depth}, near = origin + Vec3{0, 0, 0.1f};
    float toNear = pull * (1 - span(t, 3.6f, 3.75f)), toOrigin = push;
    f.line(origin, near, 0.0016f, cool, 0.45f * g);
    for (int k = 1; k < 4; k++) f.orb(mix(origin, near, float(k) / 4), 0.0032f, cool, 0.6f * g);
    f.ring(near, X, Y, 0.068f, 0.0022f + 0.002f * toNear, mix(cool, warm, toNear), (0.34f + 0.56f * toNear) * g);
    f.ring(origin, X, Y, 0.068f, 0.0022f + 0.002f * toOrigin, mix(cool, warm, toOrigin), (0.34f + 0.56f * toOrigin) * g);
    pulse(f, near, X, Y, 0.068f, 0.115f, t - 2.3f, 0.5f, warm);
    pulse(f, origin, X, Y, 0.068f, 0.115f, t - 4.7f, 0.5f, warm);
}

// MARK: - A closed hand, moved across: carries the tree

static void carry(float t, Frame& f) {
    f.fade = shown(t, 5.6f);
    float close = snap(span(t, 0.7f, 1.0f)) - snap(span(t, 2.9f, 3.2f));
    float go = travel(span(t, 1.25f, 2.6f));
    Vec3 move{0.16f, 0.03f, 0};
    // The tree follows a moment behind the hand, and runs on a little when let go.
    float follow = travel(span(t, 1.37f, 2.85f));
    grove(f, Vec3{-0.085f, 0.03f, -0.1f} + move * follow, 1, 0, 1.5f);
    Vec3 base{-0.02f, -0.17f, 0.05f};
    HandParts hand = f.hand(false, mixPose(poses::rest, poses::fist, close), base + move * go, held(false, -4, -58, 0, 14));
    // From where it closed to where it is: the carry, marked every 5 cm, as the app draws it.
    float g = close;
    Vec3 c = hand.grip, origin = c - move * go;
    float far = length(move * go);
    Vec3 along = normalized(move), across = normalized(cross(along, Z));
    f.ring(origin, X, Y, 0.011f, 0.002f, cool, 0.7f * g);
    if (far > 0.05f) {
        f.line(origin, c - along * 0.05f, 0.0034f, white, 0.2f * g, 0.8f * g);
        for (int k = 1; float(k) * 0.05f < far - 0.045f; k++) {
            Vec3 at = origin + along * (0.05f * float(k));
            f.line(at - across * 0.01f, at + across * 0.01f, 0.002f, white, 0.75f * g);
        }
    }
}

// MARK: - A flat hand swept across a thread cuts it

static void cut(float t, Frame& f) {
    f.fade = shown(t, 7.4f);
    // The thread stands where the hand can reach it: the blade passes through it, not in front of it.
    Vec3 a{-0.13f, 0.1f, -0.05f}, b0{0.1f, 0.065f, -0.05f};
    const float first = 2.0f, second = 4.3f;                                // when the blade crosses: once to mark it, again to cut
    float gone = soft(span(t, second, second + 1.3f));
    Vec3 b = b0 + Vec3{0.012f * gone, -0.09f * gone * gone, 0};             // cut away, it goes down into the water
    float part = arrive(span(t, second, second + 0.55f));
    float marked = soft(span(t, first, first + 0.25f)) * (1 - span(t, second, second + 0.2f));
    f.card(a, X, Y, 0.1f, 0.066f, 0.006f, 0.0016f, white, 0.85f, 0.07f);
    f.card(b, X, Y, 0.075f, 0.05f, 0.005f, 0.0015f, white, 0.8f * (1 - gone), 0.06f * (1 - gone));
    Vec3 from = a + Vec3{0.05f, 0, 0}, to = b + Vec3{-0.0375f, 0, 0};
    // Marked, the thread is in the accent. Cut, each half draws back to its own card.
    f.path(thread(from, to, 0.02f, 0, 0.5f - 0.42f * part), 0.0016f + 0.0014f * marked, mix(cool, hot, marked), 0.85f * (1 - 0.6f * part));
    f.path(thread(from, to, 0.02f, 0.5f + 0.42f * part, 1), 0.0016f + 0.0014f * marked, mix(cool, hot, marked), 0.85f * (1 - gone));
    Vec3 middle = thread(a + Vec3{0.05f, 0, 0}, b0 + Vec3{-0.0375f, 0, 0}, 0.02f, 0.5f, 0.5f)[0];
    // While it is marked: the place, a ring round it running down, and "Cut again to confirm" standing under it (a wider tag than "Cut" had).
    if (marked > 0.01f) {
        f.orb(middle, 0.008f, hot, 0.95f * marked);
        f.ring(middle, X, Y, 0.022f, 0.0016f, hot, 0.4f * marked);
        f.arc(middle, X, Y, 0.022f, tau / 4, tau / 4 - (1 - span(t, first, first + 5)) * tau, 0.0036f, white, 0.9f * marked);
        f.card(middle + Vec3{0, -0.045f, 0.01f}, X, Y, 0.088f, 0.024f, 0.005f, 0.0014f, hot, 0.95f * marked, 0.5f * marked);
    }
    float flat = snap(span(t, 0.7f, 1.05f)) - snap(span(t, 5.3f, 5.7f));
    // A short draw back, then the stroke; back again, and the stroke a second time.
    Vec3 stroke{-0.19f, 0.15f, 0};
    float back = soft(span(t, 1.2f, 1.75f)) * (1 - span(t, 1.75f, 1.85f));
    float sweep = snap(span(t, 1.8f, 2.25f)) - travel(span(t, 2.9f, 3.7f)) + snap(span(t, 4.1f, 4.55f));
    Vec3 tipAt = middle + stroke * (sweep - 0.42f) + stroke * (-0.12f * back);
    Quat q = held(false, 20 + 16 * sweep - 6 * back, -34, -24 + 14 * sweep, 80);
    Pose pose = mixPose(poses::rest, poses::flat, flat);
    HandParts probe = f.hand(false, pose, {0, 0, 0}, q, 0);
    HandParts hand = f.hand(false, pose, tipAt - probe.middle, q);
    // The blade the app draws on a flat hand: light running out past the fingertips.
    Vec3 edge = normalized(hand.middle - hand.palm);
    f.line(hand.middle, hand.middle + edge * 0.1f, 0.004f, warm, 0.9f * flat, 0);
    f.orb(hand.middle, 0.007f, warm, 0.9f * flat);
    pulse(f, middle, X, Y, 0.006f, 0.04f, t - first, 0.45f, hot);
    pulse(f, middle, X, Y, 0.006f, 0.05f, t - second, 0.5f, warm);
    f.orb(middle, 0.014f, warm, 0.95f * (1 - span(t, second, second + 0.35f)) * (t >= second ? 1 : 0));
}

// MARK: - Palms together and held, as in prayer: presses the tree flat and sends it on

static void clap(float t, Frame& f) {
    f.fade = shown(t, 5.4f);
    // The hands come in already raised, palm toward palm: there is nothing to watch before the clap but the clap.
    const float at = 1.05f, longFor = 1.0f;                                 // when the palms meet, and how long they are held together
    const float done = at + longFor;
    // A clap: the hands draw apart a little, then come together fast, faster the nearer they are, and stop dead.
    float back = soft(span(t, 0.4f, 0.78f));
    float strike = std::pow(span(t, 0.8f, at), 2.4f);
    float part = soft(span(t, done + 0.3f, done + 0.95f));
    float apart = (0.095f + 0.03f * back) * (1 - strike) * (1 - part) + 0.095f * part;
    // Together, the wrists are as far apart as two palms are thick, and what of each hand would pass the
    // other is pressed flat against it, as palms are.
    float gap = 0.027f + apart;
    float lean = 1.5f + 60 * apart;
    // Held for its second, the tree is pressed into one card, which leaves for the tray.
    float press = arrive(span(t, done, done + 0.6f)), leave = travel(span(t, done + 0.75f, done + 1.9f));
    Vec3 tree{-0.02f, 0.11f, -0.2f};
    if (leave <= 0) {
        grove(f, tree, 1, press);
    } else {
        f.card(tree + Vec3{0.2f, -0.07f, 0.02f} * leave, X, Y, 0.075f * (1 - 0.3f * leave), 0.05f * (1 - 0.3f * leave), 0.005f, 0.0016f,
               mix(white, hot, leave), 0.85f * (1 - span(leave, 0.7f, 1)), 0.07f);
    }
    // Palm to palm in front of you, fingers up, each thumb lying up along its own hand.
    HandParts right = f.hand(false, poses::pray, {gap, -0.22f, 0.02f}, held(false, 0, -8, lean, 90));
    f.press({0.0004f, 0, 0}, {1, 0, 0});
    HandParts left = f.hand(true, poses::pray, {-gap, -0.22f, 0.02f}, held(true, 0, -8, lean, 90));
    f.press({-0.0004f, 0, 0}, {-1, 0, 0});
    Vec3 between = mix(right.palm, left.palm, 0.5f);
    // They meet: a quick ring out from between them. Then the ring the app draws round hands held together,
    // which fills over the second and rings out when it is full.
    pulse(f, between, X, Y, 0.03f, 0.1f, t - at, 0.3f, white);
    float holding = soft(span(t, at, at + 0.15f)) * (1 - span(t, done, done + 0.3f));
    float fill = span(t, at, done);
    f.ring(between, X, Y, 0.105f, 0.002f, cool, 0.45f * holding);
    if (fill > 0.01f) f.arc(between, X, Y, 0.105f, tau / 4, tau / 4 - fill * tau, 0.0055f, warm, 0.95f * holding);
    pulse(f, between, X, Y, 0.105f, 0.17f, t - done, 0.55f, warm);
}

// MARK: - The small tree: a finger on a level, and a pinch to go there

static void tree(float t, Frame& f) {
    f.fade = shown(t, 6.0f);
    Vec3 foot{-0.075f, -0.19f, 0};
    const float levels[3] = {0.05f, 0.125f, 0.2f};
    // The trunk leans as it climbs, as the small tree's does.
    auto trunk = [&](float y) { return foot + Vec3{0.03f * std::sin(y * 9), y, 0}; };
    // The finger comes in at the lowest level, runs up to the middle one, and the thumb comes in to pick it.
    float come = travel(span(t, 0.6f, 1.4f)), rise = travel(span(t, 1.9f, 2.8f));
    // The thumb comes up to the finger unhurried, and the finger gives a little to meet it.
    float close = travel(span(t, 3.1f, 3.75f)) - travel(span(t, 4.3f, 4.8f));
    float height = mix(levels[0], levels[1], rise);
    std::vector<Vec3> line;
    for (int k = 0; k <= 20; k++) line.push_back(trunk(0.235f * float(k) / 20));
    f.path(line, 0.0034f, cool, 0.9f);
    f.path(thread(trunk(levels[0]), trunk(levels[1]) + Vec3{0.06f, -0.01f, 0.01f}, -0.012f), 0.0022f, warm, 0.6f);
    f.orb(trunk(levels[1]) + Vec3{0.06f, -0.01f, 0.01f}, 0.007f, warm, 0.8f);
    for (int k = 0; k < 3; k++) f.orb(trunk(levels[k]), 0.009f, cool, 0.9f);
    // A pane of light on the level the finger is at: it goes from level to level, never between.
    int level = rise < 0.5f ? 0 : 1;
    float since = rise < 0.5f ? come : soft(span(rise, 0.5f, 0.75f));
    Vec3 c = trunk(levels[level]);
    float reach = 0.085f;
    std::vector<Vec3> disc;
    for (int i = 0; i < 32; i++) disc.push_back(c + Vec3{std::cos(float(i) * tau / 32) * reach, 0, std::sin(float(i) * tau / 32) * reach});
    f.film(disc, cool, 0.13f * since);
    f.ring(c, X, Z, reach, 0.0016f, mix(cool, white, 0.5f), 0.75f * since);
    Vec3 tipAt = foot + Vec3{mix(0.22f, 0.075f, come), height + 0.004f, 0.02f};
    // Held and seen as in Kai's photographs of the gesture: the finger toward the tree and a little toward you,
    // the back of the hand up and to the right, the thumb under the finger. (The angles are fitted to the
    // photographs as seen square on; the first turn allows for this being looked at from a little above.)
    Quat q = Quat::angleAxis(-12 * floatPi / 180, X) * held(false, 66.6f, -10, 38, 0);
    Pose pose = mixPose(poses::point, poses::pointPinch, close);
    // The hand is put so that its pointing finger's tip is where the finger is meant to be, and it stays there:
    // a pinch moves the finger, down to the thumb, not the hand.
    HandParts probe = f.hand(false, poses::point, {0, 0, 0}, q, 0);
    HandParts hand = f.hand(false, pose, tipAt - probe.index, q);
    Vec3 touch = hand.index;
    // The orb the app puts on the finger: bright on a level, dim between two.
    float on = std::max(clamp01(1 - std::fabs(height - levels[0]) / 0.02f), clamp01(1 - std::fabs(height - levels[1]) / 0.02f)) * come;
    f.orb(touch, 0.011f + 0.004f * on, mix(cool, warm, 0.6f * on), 0.45f + 0.55f * on);
    f.line(touch, trunk(height), 0.0018f, mix(cool, warm, 0.6f * on), 0.6f * come, 0.25f * come);
    // The thumb coming in: a ring closes round the orb and meets it at the pinch.
    if (close > 0.02f) f.ring(touch, X, Y, 0.013f + 0.02f * (1 - close), 0.002f, white, 0.4f + 0.5f * close);
    pulse(f, trunk(levels[1]), X, Z, reach, reach + 0.05f, t - 3.75f, 0.55f, warm);
}

}  // namespace draw

// MARK: - The set

const std::vector<Gesture>& gestures() {
    static const std::vector<Gesture> all = {
        {"pinch", draw::pinch, 5.0f, "Point and pinch", "Aim with your hand. A pinch opens a card."},
        {"carry", draw::carry, 5.6f, "Grab to pan", "Close your hand and move it. The tree comes along."},
        {"layers", draw::layers, 7.4f, "Grab to pull or push", "Pull toward you to bring back the layer behind."},
        {"drag", draw::drag, 5.4f, "Pinch and drag to move", "Move at once. It stays where you put it."},
        {"hold", draw::hold, 6.0f, "Pinch and hold a card", "Hold still till the ring fills: a new layer."},
        {"mark", draw::mark, 6.8f, "Mark part of a card", "Go in, take up the pen, draw. Send asks Momo."},
        {"tree", draw::tree, 6.0f, "Choose a layer on the small tree", "Slide a finger along it, then pinch."},
        {"clap", draw::clap, 5.4f, "Palms together, and hold", "A second like this closes the tree."},
        {"cut", draw::cut, 7.4f, "Flat hand: slice a thread", "Hold it straight, on its edge. Once to mark, again to cut."},
    };
    return all;
}

const Gesture* gesture(const std::string& id) {
    for (const Gesture& g : gestures()) {
        if (id == g.id) return &g;
    }
    return nullptr;
}

}  // namespace guide
