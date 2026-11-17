// Runs made-up hands through Hands (core/ocean/hands.cpp) and checks what it reads from them: a fist
// pushed, pulled and carried in one frame, changing its mind and committing, and the knife's pose and
// stroke; and which finger may work the small tree (holoreach.h). No window and no headset; the clock is the real
// one, so it takes about 15 s.
//   quest/desktop/test/hands_check.sh
#include <cstdio>
#include <functional>
#include <thread>
#include <chrono>
#include "ocean/hands.h"
#include "ocean/holoreach.h"

namespace { platform::Hand g[2]; Mat4 gHead; }
namespace platform {
const Hand& hand(int which) { return g[which]; }
std::optional<Mat4> head() { return gHead; }
bool handTrackingSupported() { return true; }
}
using platform::Joint;

enum class Made { fist, knife, relaxed };
// A right hand at `at`: fingers along -Z, across X, back of the hand +Y; rolled `roll` radians about Z,
// then turned `yaw` radians about Y (positive: the fingers swing to the left).
void pose(platform::Hand& h, Vec3 at, Made shape, float roll, float yaw = 0) {
    h = platform::Hand();
    h.tracked = true;
    auto put = [&](Joint j, Vec3 p) {
        float c = std::cos(roll), s = std::sin(roll);
        Vec3 q{p.x * c - p.y * s, p.x * s + p.y * c, p.z};
        float cy = std::cos(yaw), sy = std::sin(yaw);
        h.joints[int(j)] = at + Vec3{q.x * cy + q.z * sy, q.y, q.z * cy - q.x * sy};
    };
    put(Joint::wrist, {0, 0, 0});
    put(Joint::palm, {0, 0, -0.045f});
    Joint knuckles[4] = {Joint::indexProximal, Joint::middleProximal, Joint::ringProximal, Joint::littleProximal};
    float xs[4] = {-0.03f, -0.01f, 0.01f, 0.03f};
    for (int k = 0; k < 4; k++) {
        int j = int(knuckles[k]);
        Vec3 knuckle{xs[k], 0, -0.09f};
        put(Joint(j - 1), {xs[k] * 0.5f, 0, -0.03f});
        put(Joint(j), knuckle);
        float bend = shape == Made::knife ? 0.03f : shape == Made::relaxed ? 0.5f : 1.5f;   // radians at each joint
        float lens[3] = {0.042f, 0.026f, 0.02f};
        Vec3 p = knuckle;
        float a = shape == Made::relaxed ? 0.35f : shape == Made::fist ? 1.2f : 0.02f;        // at the knuckle
        for (int b = 0; b < 3; b++) {
            p = p + Vec3{0, -std::sin(a), -std::cos(a)} * lens[b];
            put(Joint(j + 1 + b), p);
            a += bend;
        }
    }
    put(Joint::thumbTip, {-0.075f, -0.01f, -0.06f});
    h.pinchStrength = 0;
    h.graspStrength = shape == Made::fist ? 1.0f : 0.1f;
}

struct Run {
    Hands hands;
    std::vector<Hands::Event> seen;
    bool lands = false;         // every stroke crosses a thread: the scene tells Hands a cut landed
    Run() {
        hands.surface = [](Vec3) { return std::optional<Hands::Surface>(Hands::Surface{{0, 0, -1}, {1, 0, 0}, {0, 1, 0}}); };
        // What a blade cuts on: a wall 1.2 m ahead.
        hands.target = [](Vec3 from, Vec3 along) -> std::optional<Vec3> {
            if (!(along.z < -1e-3f)) return std::nullopt;
            return from + along * ((-1.2f - from.z) / along.z);
        };
        hands.start();
        g[0] = platform::Hand();
    }
    void frame(Vec3 at, Made shape, float roll = 0, float yaw = 0) {
        pose(g[1], at, shape, roll, yaw);
        for (const Hands::Event& e : hands.update({0, 0, 0.4f}, {0, 0, -1}, 1.0f / 90)) {
            seen.push_back(e);
            if (lands && e.kind == Hands::Event::Kind::cut) hands.cutLanded();
        }
        std::this_thread::sleep_for(std::chrono::microseconds(11111));
    }
    void hold(Vec3 at, Made shape, double seconds, float roll = 0) { for (int k = 0; k < int(seconds * 90); k++) frame(at, shape, roll); }
    void turn(Vec3 at, float from, float to, double seconds, float roll) {
        int n = int(seconds * 90);
        for (int k = 1; k <= n; k++) frame(at, Made::knife, roll, from + (to - from) * (float(k) / float(n)));
    }
    void move(Vec3 from, Vec3 to, Made shape, double seconds, float roll = 0) {
        int n = int(seconds * 90);
        for (int k = 1; k <= n; k++) frame(from + (to - from) * (float(k) / float(n)), shape, roll);
    }
    int count(Hands::Event::Kind kind) const { int n = 0; for (auto& e : seen) n += e.kind == kind; return n; }
    Vec2 panned() const { Vec2 t{0, 0}; for (auto& e : seen) if (e.kind == Hands::Event::Kind::pan || e.kind == Hands::Event::Kind::panUndone) t = t + e.move; return t; }
    int layers() const { int n = 0; for (auto& e : seen) if (e.kind == Hands::Event::Kind::layer) n += e.steps; return n; }
};

int failures = 0;
void check(const char* name, bool ok, const std::string& detail) {
    printf("%s %s  (%s)\n", ok ? "ok  " : "FAIL", name, detail.c_str());
    if (!ok) failures++;
}
std::string say(const Run& r) {
    Vec2 p = r.panned();
    char b[200];
    snprintf(b, sizeof b, "layer steps %d in %d events, carried %.0f,%.0f mm, undone %d", r.layers(), r.count(Hands::Event::Kind::layer), p.x * 1000, p.y * 1000, r.count(Hands::Event::Kind::panUndone));
    return b;
}

int main() {
    gHead = Mat4::identity();
    Vec3 o{0.2f, -0.3f, 0};
    {   Run r; r.hold(o, Made::fist, 0.3); r.move(o, o + Vec3{0, 0, -0.12f}, Made::fist, 0.6); r.hold(o + Vec3{0, 0, -0.12f}, Made::fist, 0.1);
        check("a push straight in steps one layer forward and carries nothing", r.layers() == -1 && length(r.panned()) < 1e-4f, say(r)); }
    {   Run r; r.hold(o, Made::fist, 0.3); Vec3 to = o + Vec3{0.045f, 0.05f, -0.12f}; r.move(o, to, Made::fist, 0.6); r.hold(to, Made::fist, 0.1);
        check("a push 30 degrees off the axis (up and to the side) still steps and carries nothing", r.layers() == -1 && length(r.panned()) < 1e-4f, say(r)); }
    {   Run r; r.hold(o, Made::fist, 0.3); Vec3 to = o + Vec3{0, 0, 0.13f}; r.move(o, to, Made::fist, 0.6);
        check("a pull steps one layer back", r.layers() == 1 && length(r.panned()) < 1e-4f, say(r)); }
    {   Run r; r.hold(o, Made::fist, 0.3); Vec3 to = o + Vec3{0.15f, 0.02f, -0.03f}; r.move(o, to, Made::fist, 0.6);
        check("a carry sideways with some depth in it carries and steps nothing", r.layers() == 0 && r.count(Hands::Event::Kind::layer) == 0 && r.panned().x > 0.1f, say(r)); }
    {   Run r; r.hold(o, Made::fist, 0.3); Vec3 a = o + Vec3{0.04f, 0.01f, 0}; r.move(o, a, Made::fist, 0.2); Vec3 b = a + Vec3{0, 0, -0.13f}; r.move(a, b, Made::fist, 0.6);
        check("a first 4 cm sideways, then a push: the carry is taken back and the layer steps", r.layers() == -1 && r.count(Hands::Event::Kind::panUndone) == 1 && length(r.panned()) < 1e-3f, say(r)); }
    {   Run r; r.hold(o, Made::fist, 0.3); Vec3 a = o + Vec3{0, 0, -0.04f}; r.move(o, a, Made::fist, 0.2); Vec3 b = a + Vec3{0.14f, 0, 0.03f}; r.move(a, b, Made::fist, 0.6);
        check("a first 4 cm in, then sideways: it becomes a carry, no layer", r.count(Hands::Event::Kind::layer) == 0 && r.panned().x > 0.05f, say(r)); }
    {   Run r; r.hold(o, Made::fist, 0.3); Vec3 a = o + Vec3{0.12f, 0, 0}; r.move(o, a, Made::fist, 0.4); Vec3 b = a + Vec3{0, 0, -0.3f}; r.move(a, b, Made::fist, 0.8);
        check("carried past 9 cm, then pushed 30 cm: still a carry, no layer", r.count(Hands::Event::Kind::layer) == 0 && r.count(Hands::Event::Kind::panUndone) == 0, say(r)); }
    {   Run r; r.hold(o, Made::fist, 0.3); Vec3 a = o + Vec3{0, 0, -0.12f}; r.move(o, a, Made::fist, 0.4); Vec3 b = a + Vec3{0.3f, 0, 0}; r.move(a, b, Made::fist, 0.8);
        check("a layer stepped, then 30 cm sideways: nothing is carried", r.layers() == -1 && length(r.panned()) < 1e-4f, say(r)); }
    {   Run r; r.hold(o, Made::fist, 0.3); Vec3 a = o + Vec3{0.08f, 0, -0.08f}; r.move(o, a, Made::fist, 0.5);
        check("dead on the diagonal: it is decided by 6 cm, one way or the other", r.hands.grabs().size() == 1 && r.hands.grabs()[0].way != 0, say(r) + ", way " + std::to_string(r.hands.grabs().empty() ? -1 : r.hands.grabs()[0].way)); }
    {   Run r; r.hold(o, Made::fist, 0.3); r.move(o, o + Vec3{0.012f, 0.008f, -0.01f}, Made::fist, 0.3);
        check("a fist that only shivers 2 cm does nothing", r.seen.empty(), say(r)); }

    // The knife.
    const float edge = 1.5708f;
    {   Run r; r.hold(o, Made::knife, 0.7, edge);
        auto b = r.hands.blades();
        // (Where the line from the wrist through the middle fingertip meets the wall.)
        Vec3 w = g[1].at(Joint::wrist), d = g[1].at(Joint::middleTip) - w;
        Vec3 want = w + d * ((-1.2f - w.z) / d.z);
        bool at = b.size() == 1 && b[0].out && b[0].mark && distance(*b[0].mark, want) < 0.01f;
        check("straight, together, on its edge, held 0.7 s: the blade is out, and marks the wall where the hand points", at, "blades " + std::to_string(b.size())); }
    {   Run r; r.hold(o, Made::knife, 0.2, edge);
        auto b = r.hands.blades();
        check("the same held 0.2 s: forming, not out", b.size() == 1 && !b[0].out && b[0].ready > 0.2f && b[0].ready < 0.8f, b.empty() ? "none" : "ready " + std::to_string(b[0].ready)); }
    {   Run r; r.hold(o, Made::knife, 0.7, 0);
        check("a flat hand palm down (reaching for the desk) is no knife", r.hands.blades().empty(), ""); }
    {   Run r; r.hold(o, Made::relaxed, 0.7, edge);
        check("an open hand at rest, on its edge, is no knife", r.hands.blades().empty(), ""); }
    {   Run r; r.hold(o, Made::knife, 0.7, edge); r.turn(o, 0, 0.35f, 0.15, edge);
        check("a flick of the blade (its mark crossing 44 cm of the wall in 0.15 s) cuts", r.count(Hands::Event::Kind::cut) > 0, "cut events " + std::to_string(r.count(Hands::Event::Kind::cut))); }
    {   Run r; r.hold(o, Made::knife, 0.7, edge); r.turn(o, 0, 0.2f, 0.8, edge);
        check("the blade turned slowly (its mark at 0.3 m/s) cuts nothing", r.count(Hands::Event::Kind::cut) == 0, ""); }
    {   Run r; r.hold(o, Made::knife, 0.7, edge); r.move(o, o + Vec3{-0.06f, 0.02f, 0}, Made::knife, 0.4, edge);
        check("the blade carried slowly sideways cuts nothing", r.count(Hands::Event::Kind::cut) == 0, ""); }
    {   Run r; r.hold(o, Made::knife, 0.7, edge);
        // one frame's jump in the tracking, in place and in direction, then back
        r.frame(o + Vec3{0.012f, 0, 0}, Made::knife, edge, 0.03f); r.frame(o, Made::knife, edge); r.hold(o, Made::knife, 0.1, edge);
        check("one frame's jump in the tracking (12 mm and 1.7 degrees) cuts nothing", r.count(Hands::Event::Kind::cut) == 0, "cut events " + std::to_string(r.count(Hands::Event::Kind::cut))); }
    {   Run r; r.move(o + Vec3{0.3f, 0, 0}, o, Made::knife, 0.2, edge);
        check("a knife-shaped hand passing through in 0.2 s cuts nothing", r.count(Hands::Event::Kind::cut) == 0, ""); }
    {   Run r; r.lands = true; r.hold(o, Made::knife, 0.7, edge);
        // A hand that shakes across a thread for three seconds: a quarter of a radian each way, four times a second.
        for (int k = 0; k < 270; k++) r.frame(o, Made::knife, edge, 0.25f * std::sin(float(k) / 90 * 6.2832f * 4));
        int shaken = r.count(Hands::Event::Kind::cut);
        // Then it comes to rest, and strokes once more, on purpose.
        r.hold(o, Made::knife, 0.4, edge); r.turn(o, 0, 0.35f, 0.15, edge);
        check("a blade shaking across a thread for 3 s cuts once, not twice; at rest and stroked again, it cuts again",
              shaken == 1 && r.count(Hands::Event::Kind::cut) == 2, "cuts while shaking " + std::to_string(shaken) + ", in all " + std::to_string(r.count(Hands::Event::Kind::cut))); }
    {   Run r; r.lands = true; r.hold(o, Made::knife, 0.7, edge); r.turn(o, 0, 0.35f, 0.15, edge); r.turn(o, 0.35f, 0, 0.15, edge);
        check("a stroke and straight back, with no pause between, cuts once", r.count(Hands::Event::Kind::cut) == 1, "cuts " + std::to_string(r.count(Hands::Event::Kind::cut))); }
    // The small tree at your hand takes only a finger you can see (HoloReach). Seated, looking ahead: the eyes 1.2 m up,
    // the small tree on the desk 0.39 m ahead and 0.57 m under them.
    {   Vec3 eye{0, 1.2f, 0}, tip{0, 1.2f - 0.565f, -0.39f};
        float ahead = HoloReach::off(eye, {0, 0, -1}, tip), down = HoloReach::off(eye, normalize(Vec3{0, -0.565f, -0.39f}), tip);
        check("a finger resting on the small tree while you look ahead is out of view, and does not take it", !HoloReach::takes(ahead), std::to_string(int(ahead)) + " degrees off");
        check("the same finger while you look down at it takes it", HoloReach::takes(down), std::to_string(int(down)) + " degrees off"); }
    {   HoloReach reach;
        bool kept = reach.keep(45.f, 0) == HoloReach::Hold::on;
        check("the hand on it keeps it 45 degrees off, past where it may take it", kept, ""); }
    {   HoloReach reach;
        HoloReach::Hold atOnce = reach.keep(55.f, 1.0), during = reach.keep(55.f, 1.4), after = reach.keep(55.f, 1.5);
        check("past 50 degrees it holds nothing at once, and lets go after 0.5 s", atOnce == HoloReach::Hold::holdingNothing &&
              during == HoloReach::Hold::holdingNothing && after == HoloReach::Hold::letGo, ""); }
    {   HoloReach reach;
        reach.keep(55.f, 1.0);
        HoloReach::Hold back = reach.keep(20.f, 1.3), again = reach.keep(55.f, 1.6), later = reach.keep(55.f, 1.9);
        check("back in view after 0.3 s it goes on, and the next time out of view counts afresh", back == HoloReach::Hold::on &&
              again == HoloReach::Hold::holdingNothing && later == HoloReach::Hold::holdingNothing, ""); }
    {   HoloReach reach;
        HoloReach::Hold lost = reach.keep(std::nullopt, 2.0), gone = reach.keep(std::nullopt, 2.5);
        check("a hand no longer tracked counts as out of view", lost == HoloReach::Hold::holdingNothing && gone == HoloReach::Hold::letGo, ""); }
    printf("%d failed\n", failures);
    return failures;
}
