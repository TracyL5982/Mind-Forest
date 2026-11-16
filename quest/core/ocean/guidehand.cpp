#include "guidehand.h"

#include <algorithm>
#include <cmath>
#include <cstring>

namespace guide {

// MARK: - Vectors and turns

namespace {
const float pi = floatPi;

float clamp01(float u) { return std::max(0.f, std::min(1.f, u)); }
float rad(float d) { return d * pi / 180; }
/// The sketch's normalize: a zero vector stays zero (vecmath's divides by its length).
Vec3 normalized(Vec3 a) {
    float l = length(a);
    return l > 1e-9f ? a * (1 / l) : Vec3{};
}

/// A turn of `degrees` about `axis`.
Quat quatAxis(Vec3 axis, float degrees) { return Quat::angleAxis(rad(degrees), normalized(axis)); }
}

/// Turned about y (yaw), then tipped about x (pitch), then rolled about z, degrees: how a hand is held.
/// pitch < 0 tips the fingers away from the viewer; yaw > 0 swings them to the viewer's left.
/// `twist` comes first and turns the hand about its own fingers: at 0 its back is to the viewer, at 90 a right
/// hand's thumb is.
Quat turn(float yaw, float pitch, float roll, float twist) {
    Quat q = quatAxis({0, 1, 0}, yaw) * quatAxis({1, 0, 0}, pitch) * quatAxis({0, 0, 1}, roll);
    return q * quatAxis({0, 1, 0}, twist);
}
/// The same for either hand: a left hand is held as the right one's mirror image.
Quat held(bool left, float yaw, float pitch, float roll, float twist) {
    return left ? turn(-yaw, pitch, -roll, -twist) : turn(yaw, pitch, roll, twist);
}

// MARK: - Pace

/// A cubic-bezier easing through (x1, y1) and (x2, y2), as CSS has it.
float bezier(float x1, float y1, float x2, float y2, float u) {
    if (u <= 0) return 0;
    if (u >= 1) return 1;
    float t = u;
    for (int k = 0; k < 6; k++) {
        float x = 3 * (1 - t) * (1 - t) * t * x1 + 3 * (1 - t) * t * t * x2 + t * t * t - u;
        float dx = 3 * (1 - t) * (1 - t) * x1 + 6 * (1 - t) * t * (x2 - x1) + 3 * t * t * (1 - x2);
        if (std::fabs(dx) < 1e-6f) break;
        t = clamp01(t - x / dx);
    }
    return 3 * (1 - t) * (1 - t) * t * y1 + 3 * (1 - t) * t * t * y2 + t * t * t;
}
/// Something that travels: a departure, clear travel, a soft arrival.
float travel(float u) { return bezier(0.45f, 0, 0.1f, 1, u); }
/// Something that arrives from nowhere.
float arrive(float u) { return bezier(0.25f, 0.8f, 0.25f, 1, u); }
/// A hand closing or opening: quick, and soft at the end.
float snap(float u) { return bezier(0.3f, 0.75f, 0.1f, 1, u); }
/// How far through the stretch from `from` to `to` the time `t` is, 0…1.
float span(float t, float from, float to) { return clamp01((t - from) / (to - from)); }

// MARK: - Poses

// A pose is how far each joint is bent from the model's own open hand, degrees:
// each finger's three joints (knuckle, middle, last), index to little; how far each finger leans sideways
// at the knuckle (+ toward the little finger); and the thumb: its base bent toward the palm, swung
// toward the index (+) or out (-), and rolled, then its two joints bent.

// As a hand hangs when nothing is asked of it.
const Pose rest{{{16, 20, 10}, {20, 24, 12}, {24, 28, 14}, {28, 30, 16}}, {0, 0, 0, 0}, {6, 0, 0, 8, 10}};
// Thumb and index met; the others as they were.
const Pose pinch{{{44.7f, 48, 22}, {26, 30, 15}, {30, 34, 17}, {34, 36, 19}}, {0, 0, 0, 0}, {26, -12, 0, 14, 18}};
const Pose fist{{{80, 98, 60}, {82, 100, 62}, {84, 100, 62}, {86, 98, 60}}, {2, 0, -2, -5}, {30, -4, 0, 34, 52}};
// Every finger out and held together: the knife.
const Pose flat{{{0, 2, 1}, {0, 2, 1}, {0, 2, 1}, {0, 3, 2}}, {9, 0, -9, -16}, {10, 14, 0, 0, 2}};
// A hand for putting palm to palm with the other: flat, fingers together, the thumb lying up along it in front
// of the palm, where it rests beside the other hand's thumb.
const Pose pray{{{0, 2, 1}, {0, 2, 1}, {0, 2, 1}, {0, 3, 2}}, {9, 0, -9, -16}, {16, 30, 30, -10, 0}};
// A finger for touching, ready to pinch: the index out, the thumb held out under it with a finger's width and
// a half between, the rest curled. (Fitted to a photograph of Kai's hand, sketches/onboarding/ref/slide-crop.jpg,
// by points read off it; then the thumb brought a little nearer the finger, as Kai asked.)
const Pose point{{{52.2f, 27.1f, 11.7f}, {80, 98, 60}, {84, 100, 62}, {86, 98, 60}}, {0, 0, -2, -5}, {11, -17.7f, 46.4f, 25.3f, 24.1f}};
// The same, pinched: finger and thumb have each come half the way, 17 and 18 mm. (Fitted to ref/pinch-crop.jpg.)
const Pose pointPinch{{{53.5f, 31.3f, 43.7f}, {80, 98, 60}, {84, 100, 62}, {86, 98, 60}}, {0, 0, -2, -5}, {22.4f, -23.9f, 44.8f, 22.7f, 27.3f}};

Pose mixPose(const Pose& a, const Pose& b, float u) {
    Pose m;
    for (int f = 0; f < 4; f++) {
        for (int k = 0; k < 3; k++) m.fingers[f][k] = mix(a.fingers[f][k], b.fingers[f][k], u);
        m.lean[f] = mix(a.lean[f], b.lean[f], u);
    }
    for (int k = 0; k < 5; k++) m.thumb[k] = mix(a.thumb[k], b.thumb[k], u);
    return m;
}

// MARK: - The model

namespace {
// The joints, as OpenXR numbers them.
namespace Joint {
enum {
    palm = 0, wrist = 1, thumbMetacarpal = 2, thumbProximal = 3, thumbDistal = 4, thumbTip = 5,
    indexMetacarpal = 6, indexProximal = 7, indexIntermediate = 8, indexDistal = 9, indexTip = 10,
    middleProximal = 12, middleTip = 15, ringProximal = 17, ringTip = 20, littleProximal = 22, littleTip = 25,
};
}

// A joint's own axes are OpenXR's: -z along the bone toward the fingertip, +y out of the back of the hand,
// +x to the right. So a finger curls about x (toward the palm is a negative turn) and leans about y.
Quat curl(float degrees) { return quatAxis({1, 0, 0}, -degrees); }
Quat lean(float degrees) { return quatAxis({0, 1, 0}, -degrees); }

/// A joint's place and turn together. `compose(a, b)` is b carried by a.
struct Place {
    Quat q;
    Vec3 p;
};
Place compose(const Place& a, const Place& b) { return {a.q * b.q, a.p + a.q.act(b.p)}; }
Place inverse(const Place& a) {
    Quat q = a.q.inverse();
    return {q, q.act(a.p) * -1};
}

/// The model: `joints` (each as it is in the open hand the model was made in), `positions`, `normals`,
/// `blendIndices` and `blendWeights` (four joints to a point), `indices`.
struct ModelJoint : Place {
    int parent = -1;
    Place local;        // as its parent sees it
    Place undo;         // what undoes its place in the open hand
};
struct Model {
    std::vector<ModelJoint> joints;
    std::vector<int> order;
    std::vector<float> there;
    std::vector<Vec3> positions, normals;
    std::vector<uint16_t> blendIndices;
    std::vector<float> blendWeights;
    std::vector<uint32_t> indices, flipped;         // the triangles, and the same turned over for a left hand
    int count = 0;
};
Model model;

/// Hands that frames are done with, kept for their memory: `clear` puts them here and `hand` takes them back.
std::vector<Frame::Hand> spare;

/// One number out of the file, which is little-endian, as everything this runs on is.
template <typename T>
T take(const std::string& bytes, size_t& at) {
    T value;
    std::memcpy(&value, bytes.data() + at, sizeof(T));
    at += sizeof(T);
    return value;
}
}

bool hasModel() { return model.count > 0; }
int modelCount() { return model.count; }
const std::vector<uint32_t>& modelTriangles(bool left) { return left ? model.flipped : model.indices; }
const std::vector<float>& modelThere() { return model.there; }

bool loadModel(const std::string& bytes) {
    if (bytes.size() < 16) return false;
    size_t at = 0;
    if (take<uint32_t>(bytes, at) != 0x48534D48) return false;
    uint64_t jointCount = take<uint32_t>(bytes, at), vertexCount = take<uint32_t>(bytes, at), indexCount = take<uint32_t>(bytes, at);
    // Every joint a pose bends has to be there, and all of what the counts promise.
    if (jointCount <= Joint::littleTip || vertexCount == 0 || indexCount % 3 != 0) return false;
    if (bytes.size() < 16 + jointCount * (28 + 4 + 4) + vertexCount * (12 + 12 + 8 + 8 + 16) + indexCount * 2) return false;

    Model m;
    m.joints.resize(jointCount);
    for (ModelJoint& j : m.joints) {
        float x = take<float>(bytes, at), y = take<float>(bytes, at), z = take<float>(bytes, at), w = take<float>(bytes, at);
        j.q = {x, y, z, w};
        j.p.x = take<float>(bytes, at);
        j.p.y = take<float>(bytes, at);
        j.p.z = take<float>(bytes, at);
    }
    at += jointCount * 4;       // each joint's radius: not used
    for (ModelJoint& j : m.joints) {
        int32_t parent = take<int32_t>(bytes, at);
        j.parent = parent >= 0 && parent < int(jointCount) ? parent : -1;
    }
    // Each joint as its parent sees it, and what undoes its place in the open hand.
    for (ModelJoint& j : m.joints) {
        j.local = j.parent < 0 ? Place{j.q, j.p} : compose(inverse(m.joints[j.parent]), j);
        j.undo = inverse(j);
    }
    // Parents before children: the wrist, then the palm, then each finger from its root out.
    m.order = {Joint::wrist, Joint::palm};
    for (int k = 2; k < int(jointCount); k++) m.order.push_back(k);

    m.count = int(vertexCount);
    m.positions.resize(vertexCount);
    m.normals.resize(vertexCount);
    for (Vec3& p : m.positions) {
        p.x = take<float>(bytes, at);
        p.y = take<float>(bytes, at);
        p.z = take<float>(bytes, at);
    }
    for (Vec3& n : m.normals) {
        n.x = take<float>(bytes, at);
        n.y = take<float>(bytes, at);
        n.z = take<float>(bytes, at);
    }
    at += vertexCount * 8;      // where each point is on a picture of the hand: not used
    m.blendIndices.resize(vertexCount * 4);
    m.blendWeights.resize(vertexCount * 4);
    for (uint16_t& k : m.blendIndices) k = take<uint16_t>(bytes, at);
    for (float& w : m.blendWeights) w = take<float>(bytes, at);
    for (size_t k = 0; k < m.blendIndices.size(); k++) {
        if (!(m.blendWeights[k] <= 0) && m.blendIndices[k] >= jointCount) return false;       // as `hand` asks it, so a weight that is no number counts
    }
    m.indices.resize(indexCount);
    for (uint32_t& i : m.indices) {
        i = take<uint16_t>(bytes, at);
        if (i >= vertexCount) return false;
    }
    // A left hand is the right one mirrored, which turns its faces over.
    m.flipped = m.indices;
    for (size_t k = 0; k + 2 < m.flipped.size(); k += 3) std::swap(m.flipped[k + 1], m.flipped[k + 2]);
    // The model ends at the wrist with a flat cut: the hand is let fade toward it instead.
    for (int v = 0; v < m.count; v++) {
        float u = clamp01((-m.positions[v].x + 0.016f) / 0.05f);
        m.there.push_back(u * u * (3 - 2 * u));
    }
    model = std::move(m);
    return true;
}

namespace {
/// The model's own space into a hand's: its fingers run along -x and its back faces +y.
Vec3 toHand(Vec3 p) { return {-p.z, -p.x, p.y}; }

/// Where every joint is, in the model's space, for a pose. (Nothing, without the model.)
std::vector<Place> bend(const Pose& pose) {
    if (!hasModel()) return {};
    std::vector<Quat> turns(model.joints.size());       // a joint the pose says nothing of is left unturned
    for (int f = 0; f < 4; f++) {
        int first = Joint::indexProximal + 5 * f;
        turns[first] = lean(pose.lean[f]) * curl(pose.fingers[f][0]);
        turns[first + 1] = curl(pose.fingers[f][1]);
        turns[first + 2] = curl(pose.fingers[f][2]);
    }
    turns[Joint::thumbMetacarpal] = lean(pose.thumb[1]) * curl(pose.thumb[0]) * quatAxis({0, 0, 1}, pose.thumb[2]);
    turns[Joint::thumbProximal] = curl(pose.thumb[3]);
    turns[Joint::thumbDistal] = curl(pose.thumb[4]);
    std::vector<Place> world(model.joints.size());
    for (int k : model.order) {
        const ModelJoint& j = model.joints[k];
        Place at = j.parent < 0 ? j.local : compose(world[j.parent], j.local);
        world[k] = {at.q * turns[k], at.p};
    }
    return world;
}
}

// MARK: - A frame: everything drawn at one moment

const Vec3 white{1, 1, 1}, cool{0.72f, 0.85f, 1.0f}, warm{1.0f, 0.9f, 0.72f}, hot{1.0f, 0.353f, 0.212f};

void Frame::clear() {
    for (Hand& h : hands) {
        if (spare.size() < 8) spare.push_back(std::move(h));
    }
    hands.clear();
    strokes.clear();
    orbs.clear();
    films.clear();
    fade = 1;
    pressed = -1;
}

/// Presses the hand just put in against a flat face: whatever of it lies past the plane through `at` (on the
/// side `n` points away from) is brought onto the plane, as a palm flattens against what it is pressed to.
void Frame::press(Vec3 at, Vec3 n) {
    if (pressed < 0 || pressed >= int(hands.size())) return;
    Hand& hand = hands[size_t(pressed)];
    for (size_t i = 0; i < hand.positions.size(); i++) {
        Vec3& p = hand.positions[i];
        float past = dot(p - at, n);
        if (past >= 0) continue;
        p -= n * past;
        // What is flattened faces along the flat, not through it: its edge line then runs round the flat's rim.
        Vec3& m = hand.normals[i];
        Vec3 along = normalized(m - n * dot(m, n));
        m = length(along) > 0.5f ? along : n;
    }
}

/// A hand: `left` or right, held at `at`, turned by `q`, `size` times life size. Returns where its parts are in the world.
HandParts Frame::hand(bool left, const Pose& pose, Vec3 at, Quat q, float alpha, float size) {
    std::vector<Place> world = bend(pose);
    float flip = left ? -1 : 1;
    auto place = [&](Vec3 p) {
        Vec3 h = toHand(p);
        return at + q.act({h.x * flip * size, h.y * size, h.z * size});
    };
    // Without the model there is no telling where a joint is: every part is where the hand is held.
    auto joint = [&](int k) { return world.empty() ? at : place(world[k].p); };
    if (alpha * fade > 0.004f && !world.empty()) {
        // Every point of the model goes with the joints that hold it.
        std::vector<Place> skin(world.size());
        for (size_t k = 0; k < world.size(); k++) skin[k] = compose(world[k], model.joints[k].undo);
        int n = model.count;
        Hand drawn;
        if (!spare.empty()) {
            drawn = std::move(spare.back());
            spare.pop_back();
        }
        drawn.positions.resize(n);
        drawn.normals.resize(n);
        for (int v = 0; v < n; v++) {
            Vec3 p = model.positions[v], m = model.normals[v];
            Vec3 P, N;
            for (int k = 0; k < 4; k++) {
                float w = model.blendWeights[4 * v + k];
                if (w <= 0) continue;
                const Place& s = skin[model.blendIndices[4 * v + k]];
                P += (s.q.act(p) + s.p) * w;
                N += s.q.act(m) * w;
            }
            Vec3 h = toHand(N);
            drawn.positions[v] = place(P);
            drawn.normals[v] = normalized(q.act({h.x * flip, h.y, h.z}));
        }
        drawn.left = flip < 0;
        drawn.alpha = alpha * fade;
        hands.push_back(std::move(drawn));
        pressed = int(hands.size()) - 1;
    } else {
        pressed = -1;
    }
    Vec3 index = joint(Joint::indexTip), thumb = joint(Joint::thumbTip), palm = joint(Joint::palm);
    Vec3 back = q.act({0, 0, 1});
    return {
        .index = index, .thumb = thumb, .middle = joint(Joint::middleTip), .little = joint(Joint::littleTip), .palm = palm,
        .pinch = mix(index, thumb, 0.5f),
        .grip = palm + back * (-0.022f * size),                                         // the middle of a closed fist
        .aim = mix(joint(Joint::indexProximal), joint(Joint::thumbProximal), 0.4f),     // where the hand's ray leaves it
        .fingers = q.act({0, 1, 0}), .back = back, .side = q.act({flip, 0, 0}),
    };
}

void Frame::line(Vec3 a, Vec3 b, float width, Vec3 colour, float alphaA, float alphaB) {
    alphaA *= fade;
    alphaB *= fade;
    if (alphaA <= 0.004f && alphaB <= 0.004f) return;
    strokes.push_back({{a, b}, {alphaA, alphaB}, width, colour, false});
}

/// A line through `points`.
void Frame::path(const std::vector<Vec3>& points, float width, Vec3 colour, float alpha, bool closed) {
    alpha *= fade;
    if (alpha <= 0.004f || points.size() < 2) return;
    strokes.push_back({points, std::vector<float>(points.size(), alpha), width, colour, closed});
}

/// Part of a ring in the plane of `x` and `y` round `c`, from angle `from` to `to` (radians, counter-clockwise from `x`).
void Frame::arc(Vec3 c, Vec3 x, Vec3 y, float radius, float from, float to, float width, Vec3 colour, float alpha) {
    int steps = std::max(2, int(std::ceil(std::fabs(to - from) / rad(7.5f))));
    std::vector<Vec3> points;
    for (int i = 0; i <= steps; i++) {
        float a = mix(from, to, float(i) / float(steps));
        points.push_back(c + (x * std::cos(a) + y * std::sin(a)) * radius);
    }
    path(points, width, colour, alpha);
}

void Frame::ring(Vec3 c, Vec3 x, Vec3 y, float radius, float width, Vec3 colour, float alpha) { arc(c, x, y, radius, 0, 2 * pi, width, colour, alpha); }

/// A ring of dashes: something that is there but is not the point.
void Frame::dashes(Vec3 c, Vec3 x, Vec3 y, float radius, int count, float width, Vec3 colour, float alpha) {
    float step = 2 * pi / float(count);
    for (int k = 0; k < count; k++) arc(c, x, y, radius, float(k) * step, (float(k) + 0.5f) * step, width, colour, alpha);
}

/// A line of dashes from `a` to `b`, each `dash` long.
void Frame::dashed(Vec3 a, Vec3 b, float dash, float width, Vec3 colour, float alphaA, float alphaB) {
    float far = length(b - a);
    int n = std::max(1, int(std::round(far / (2 * dash))));
    for (int k = 0; k < n; k++) {
        float u0 = float(k) / float(n), u1 = (float(k) + 0.5f) / float(n);
        line(mix(a, b, u0), mix(a, b, u1), width, colour, mix(alphaA, alphaB, u0), mix(alphaA, alphaB, u1));
    }
}

/// A rectangle with rounded corners in the plane of `x` and `y` round `c`: a card.
void Frame::card(Vec3 c, Vec3 x, Vec3 y, float w, float h, float corner, float width, Vec3 colour, float alpha, float fill) {
    std::vector<Vec3> points;
    const float corners[4][3] = {{1, 1, 0}, {-1, 1, 90}, {-1, -1, 180}, {1, -1, 270}};
    for (const auto& [sx, sy, from] : corners) {
        for (int k = 0; k <= 4; k++) {
            float a = rad(from + float(k) * 22.5f);
            float px = sx * (w / 2 - corner) + std::cos(a) * corner, py = sy * (h / 2 - corner) + std::sin(a) * corner;
            points.push_back(c + (x * px + y * py));
        }
    }
    if (fill * fade > 0.004f) films.push_back({points, colour, fill * fade});
    path(points, width, colour, alpha, true);
}

/// A faint fill inside `points`.
void Frame::film(const std::vector<Vec3>& points, Vec3 colour, float alpha) {
    if (alpha * fade > 0.004f) films.push_back({points, colour, alpha * fade});
}

/// A small ball of light.
void Frame::orb(Vec3 p, float radius, Vec3 colour, float alpha) {
    if (alpha * fade > 0.004f) orbs.push_back({p, radius, colour, alpha * fade});
}

}  // namespace guide
