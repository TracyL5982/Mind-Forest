// Port of visionos/MindPalace/Ocean/Hands.swift.
#include "hands.h"

#include <algorithm>
#include <cmath>

/// Every tracked fingertip of both hands, with which hand it is on (0 left, 1 right).
std::vector<Hands::Fingertip> Hands::fingertips() const {
    std::vector<Fingertip> out;
    if (left.tracked) {
        for (Vec3 tip : left.tips) out.push_back({0, tip});
    }
    if (right.tracked) {
        for (Vec3 tip : right.tips) out.push_back({1, tip});
    }
    return out;
}

/// The index fingertip of one hand, and how far its thumb is from it.
std::optional<Hands::Pointer> Hands::pointer(int hand) const {
    const Hand& h = hand == 0 ? left : right;
    return h.tracked ? std::optional<Pointer>(Pointer{h.index, h.pinch}) : std::nullopt;
}

/// What the hands are doing, in a line, for the readout.
std::string Hands::summary() const {
    if (!tracking) return "Hands: " + status;
    auto one = [](const Hand& h, const std::string& name) -> std::string {
        if (!h.tracked) return name + " not seen";
        std::string way = h.fistWay == 2 ? ", carrying" : (h.fistWay == 1 ? ", between layers" : "");
        std::string curl = fmt("%.1f", double(h.reach.empty() ? 0 : *std::max_element(h.reach.begin(), h.reach.end())));
        return name + " " + (h.fist ? "fist" : (h.flat ? "flat" : "open")) + way + " (curl " + curl + ", pinch " + fmt("%d", int(h.pinch * 100)) + " cm)";
    };
    return "Hands: " + one(left, "left") + " · " + one(right, "right") + (quiet ? " · on the steps" : "");
}

/// Whether a hand is closed, or was a moment ago: a hand that is carrying
/// the tree, or has just let it go, is not reaching for the step cards.
bool Hands::grabbing(int hand) const {
    return mediaTime() - (hand == 0 ? left : right).fistLast < 0.6;
}

/// Pinches for the next moment are not taps.
void Hands::hold(double seconds) { busyUntil = std::max(busyUntil, mediaTime() + seconds); }

void Hands::start() {
    if (!platform::handTrackingSupported()) {
        logLine("[ocean] hand tracking unsupported here: fist, knife and clap have stand-ins");
        status = "unsupported on this device";
        return;
    }
    // NOTE(port): there is no authorization to ask for and no session to run: the app's
    // manifest asks for hand tracking, and the host has it running by now. So the Swift's
    // "not allowed" and "failed to start" never come up here.
    tracking = true;
    status = "running";
}

/// Reads both hands and returns what they did this frame. `forward` is
/// the stage's line of sight.
std::vector<Hands::Event> Hands::update(Vec3 origin, Vec3 f, float dt) {
    if (!tracking) return {};
    frame = std::max(dt, 1.0f / 240);
    double now = mediaTime();
    // NOTE(port): `provider.latestAnchors` is the host's two hands, 0 left and 1 right.
    read(platform::hand(0), left, now);
    read(platform::hand(1), right, now);
    std::vector<Event> events;
    if (quiet) {
        // Fingers on the step cards: a curled hand there is not a fist, and nothing is cut.
        for (int k = 0; k < 2; k++) {
            if ((k == 0 ? left : right).fistWay == 2) events.push_back(Event::panEnded(Vec2::zero()));
        }
        left.fistSince = std::nullopt; left.fistBase = std::nullopt; left.fistAt = std::nullopt; left.fistWay = 0;
        right.fistSince = std::nullopt; right.fistBase = std::nullopt; right.fistAt = std::nullopt; right.fistWay = 0;
        clapSince = std::nullopt;
        left.lastTip = left.tracked ? std::optional<Vec3>(left.tip) : std::nullopt;
        right.lastTip = right.tracked ? std::optional<Vec3>(right.tip) : std::nullopt;
        return events;
    }
    fist(left, origin, f, now, events);
    fist(right, origin, f, now, events);
    blade(left, now, events);
    blade(right, now, events);
    clap(f, now, events);
    left.lastTip = left.tracked ? std::optional<Vec3>(left.tip) : std::nullopt;
    right.lastTip = right.tracked ? std::optional<Vec3>(right.tip) : std::nullopt;
    return events;
}

void Hands::read(const platform::Hand& anchor, Hand& hand, double now) {
    if (!anchor.tracked) {
        hand.tracked = false;
        hand.fist = false;
        hand.flat = false;
        return;
    }
    // Every joint as the system places it, seen or not: the fingertips of a fist are hidden
    // behind the hand, and a hand is no less a fist for that.
    // NOTE(port): the host gives each joint in world space already, so there is no anchor
    // transform to carry it through. ARKit's joints by their OpenXR names (platform.h):
    // the middle finger's knuckle is its proximal joint.
    auto at = [&](platform::Joint j) { return anchor.at(j); };
    Vec3 wrist = at(platform::Joint::wrist), index = at(platform::Joint::indexTip), middle = at(platform::Joint::middleTip);
    Vec3 ring = at(platform::Joint::ringTip), little = at(platform::Joint::littleTip), knuckle = at(platform::Joint::middleProximal), thumb = at(platform::Joint::thumbTip);
    float size = std::max(distance(knuckle, wrist), 0.05f);
    std::vector<float> reach;
    for (Vec3 tip : {index, middle, ring, little}) reach.push_back(distance(tip, wrist) / size);
    hand.reach = reach;
    hand.tips = {index, middle, ring, little, thumb};
    hand.index = index;
    hand.pinch = distance(thumb, index);
    // NOTE(port): changed for Quest. OpenXR's fingertip joints lie inside the fingers, so a thumb and
    // index that touch are still a centimetre or two apart by their joints, and `pinchClosed` (tuned
    // on ARKit's) is seldom reached. Where the system gives its own reading of the pinch, that is
    // turned into a distance on the Swift's scale: closed is 0, and `pinchClosed` is two thirds closed.
    if (anchor.pinchStrength >= 0) hand.pinch = std::min(hand.pinch, (1 - anchor.pinchStrength) * 0.05f);
    hand.tracked = true;
    hand.wrist = wrist;
    hand.palm = (wrist + knuckle) / 2;
    hand.tip = middle;
    bool wasFist = hand.fist;
    hand.fist = std::all_of(reach.begin(), reach.end(), [](float r) { return r < fistReach; });
    // NOTE(port): changed for Quest (see `fistGrasp` in hands.h). Where the system says for itself how
    // closed the hand is, a fist needs that reading and every finger curled in, more tightly than
    // `fistReach` asks; a fist already made holds until the hand clearly opens, so one that is
    // carrying the tree is not dropped by a finger loosening.
    if (anchor.graspStrength >= 0) {
        float grasp = wasFist ? fistKeepGrasp : fistGrasp, within = wasFist ? fistKeepReach : fistReachQuest;
        hand.fist = anchor.graspStrength >= grasp && std::all_of(reach.begin(), reach.end(), [&](float r) { return r < within; });
    }
    if (hand.fist) hand.fistLast = now;
    // Flat: every finger out, and held together.
    hand.flat = std::all_of(reach.begin(), reach.end(), [](float r) { return r > openReach; }) && distance(index, little) < 0.9f * size;
    hand.lastSeen = now;
}

void Hands::fist(Hand& hand, Vec3 origin, Vec3 f, double now, std::vector<Event>& events) {
    if (!(hand.tracked && hand.fist)) {
        if (hand.fistWay == 2) events.push_back(Event::panEnded(hand.speed));
        hand.fistSince = std::nullopt;
        hand.fistBase = std::nullopt;
        hand.fistAt = std::nullopt;
        hand.fistWay = 0;
        return;
    }
    busyUntil = now + 0.4;
    if (!hand.fistSince) hand.fistSince = now;
    // Held a moment first, so a hand closing in passing does nothing.
    if (!(hand.fistSince && now - *hand.fistSince > 0.12)) return;
    if (!(hand.fistAt && hand.fistAxes)) {
        // Ahead and right as they are where the hand is: the tree wraps around you.
        // NOTE(port): changed for Quest. "Where the hand is" is where it is seen against the canvas: the line
        // from the eyes through the hand is followed out to the layer you work on (1.5 m round where the scene
        // was set up), and the frame is the canvas's own there. From the middle of the scene this is what it
        // was before; leaning in, or sitting a little off the middle, the gauge still lies flat to the canvas
        // behind it instead of turning away from it. `-fistFrame hand` is the old way.
        Vec3 v = hand.wrist - origin;
        Vec3 r = normalize(cross(f, Vec3{0, 1, 0}));
        static const bool byHand = Flags::string("fistFrame").value_or("") == "hand";
        if (std::optional<Mat4> head = byHand ? std::nullopt : platform::head()) {
            Vec3 e = head->position() - origin, d = hand.wrist - head->position();
            e.y = 0;
            d.y = 0;
            // |e + t d| = R, the root ahead of the eyes.
            const float R = 1.5f;
            float A = dot(d, d), B = 2 * dot(e, d), C = dot(e, e) - R * R, disc = B * B - 4 * A * C;
            if (A > 1e-6f && disc > 0 && C < 0) v = e + d * ((-B + std::sqrt(disc)) / (2 * A));
        }
        float az = std::atan2(dot(v, r), dot(v, f));
        hand.fistAt = hand.wrist;
        hand.fistAxes = Axes{f * std::cos(az) + r * std::sin(az), r * std::cos(az) - f * std::sin(az)};
        hand.fistWay = 0;
        hand.carried = Vec2::zero();
        hand.speed = Vec2::zero();
        return;
    }
    Vec3 start = *hand.fistAt;
    Axes axes = *hand.fistAxes;
    Vec3 d = hand.wrist - start;
    float depth = dot(d, axes.ahead);
    Vec2 across{dot(d, axes.right), d.y};
    if (hand.fistWay == 0) {
        // Whichever way it goes first is what this fist does.
        if (std::fabs(depth) > fistLock && std::fabs(depth) > length(across)) {
            hand.fistWay = 1;
            hand.fistBase = 0;
        } else if (length(across) > fistLock) {
            hand.fistWay = 2;
            hand.carried = across;
        }
        return;
    }
    if (hand.fistWay == 2) {
        Vec2 step = across - hand.carried;
        hand.carried = across;
        hand.speed = hand.speed * 0.7f + (step / frame) * 0.3f;
        if (length(step) > 1e-5f) events.push_back(Event::pan(step));
        return;
    }
    float moved = depth - hand.fistBase.value_or(0);
    if (std::fabs(moved) > layerPull) {
        // Pulled toward you: the layer behind comes forward.
        events.push_back(Event::layer(moved < 0 ? 1 : -1));
        hand.fistBase = depth;
    }
}

void Hands::blade(Hand& hand, double now, std::vector<Event>& events) {
    if (!(hand.tracked && hand.flat && hand.lastTip && now > hand.cutUntil)) return;
    Vec3 last = *hand.lastTip;
    if (!(distance(hand.tip, last) / frame > bladeSpeed)) return;
    busyUntil = now + 0.4;
    events.push_back(Event::cut(last, hand.tip));
}

/// Told that a cut landed, so one swing cuts one thread.
void Hands::cutLanded() {
    double until = mediaTime() + 0.6;
    left.cutUntil = until;
    right.cutUntil = until;
}

void Hands::clap(Vec3 f, double now, std::vector<Event>& events) {
    // NOTE(port): changed for Quest (see `clapClose` in hands.h): palms together and held, not a clap that lands.
    bool both = left.tracked && right.tracked && !left.fist && !right.fist && now > clapUntil;
    // They must come together with the fingers up; once together, the headset sees little of either
    // hand's fingers, so only the palms are asked to stay.
    bool up = both && left.tip.y - left.wrist.y > clapUp && right.tip.y - right.wrist.y > clapUp;
    bool together = both && distance(left.palm, right.palm) < clapClose && (clapSince || up);
    if (together) {
        if (!clapSince) clapSince = now;
        clapSeen = now;
        clapAt = (left.palm + right.palm) * 0.5f;
        busyUntil = now + 0.4;
        if (now - *clapSince >= clapHold) {
            clapSince = std::nullopt;
            clapUntil = now + 1.5;
            busyUntil = now + 0.6;
            events.push_back(Event::clap());
        }
    } else if (clapSince && now - clapSeen > 0.2) {
        // (A moment's loss of the hands does not start the count over; longer than that does.)
        clapSince = std::nullopt;
    }
}

std::optional<Hands::Held> Hands::held() const {
    if (!clapSince || quiet) return std::nullopt;
    Held h;
    h.at = clapAt;
    h.progress = float(std::min(1.0, std::max(0.0, (mediaTime() - *clapSince) / clapHold)));
    return h;
}

// NOTE(port): added for Quest (see hands.h).
std::vector<Hands::Grab> Hands::grabs() const {
    std::vector<Grab> out;
    if (quiet) return out;
    for (int k = 0; k < 2; k++) {
        const Hand& h = k == 0 ? left : right;
        if (!(h.tracked && h.fist && h.fistAt && h.fistAxes)) continue;
        Vec3 d = h.wrist - *h.fistAt;
        Grab g;
        g.hand = k;
        g.way = h.fistWay;
        g.centre = h.palm;
        g.turn = platform::hand(k).rotations[int(platform::Joint::palm)];
        g.offset = d;
        g.ahead = h.fistAxes->ahead;
        g.right = h.fistAxes->right;
        g.carried = h.fistWay == 2 ? h.carried : Vec2{dot(d, h.fistAxes->right), d.y};
        g.depth = dot(d, h.fistAxes->ahead);
        g.base = h.fistBase.value_or(0);
        out.push_back(g);
    }
    return out;
}

// NOTE(port): added for Quest (see hands.h).
std::vector<Hands::Blade> Hands::blades() const {
    std::vector<Blade> out;
    if (quiet) return out;
    for (int k = 0; k < 2; k++) {
        const Hand& h = k == 0 ? left : right;
        if (!(h.tracked && h.flat && !h.fist)) continue;
        Blade b;
        b.hand = k;
        b.tip = h.tip;
        b.palm = h.palm;
        out.push_back(b);
    }
    return out;
}
