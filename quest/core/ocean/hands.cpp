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
void Hands::hold(double seconds) {
    busyUntil = std::max(busyUntil, mediaTime() + seconds);
    for (double& b : handBusy) b = std::max(b, mediaTime() + seconds);
}

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
        for (Hand* h : {&left, &right}) {
            h->fistSince = std::nullopt;
            h->fistBase = std::nullopt;
            h->fistAt = std::nullopt;
            h->fistWay = 0;
            h->fistLocked = false;
            h->flatSince = std::nullopt;
            h->out = false;
            h->trail.clear();
        }
        clapSince = std::nullopt;
        left.lastTip = left.tracked ? std::optional<Vec3>(left.tip) : std::nullopt;
        right.lastTip = right.tracked ? std::optional<Vec3>(right.tip) : std::nullopt;
        return events;
    }
    fist(left, origin, f, now, events);
    fist(right, origin, f, now, events);
    blade(left, right, now, events);
    blade(right, left, now, events);
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
        hand.aim = std::nullopt;
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
    // NOTE(port): changed for Quest (2026-11-15, see `knifeStraight` in hands.h). That alone is most open hands,
    // so the knife asks for more: each finger straight from its knuckle to its tip and in line with the hand,
    // the hand on its edge (the palm facing neither up nor down, neither at you nor away), and the thumb
    // nowhere near a pinch. A knife already held keeps to looser measures, so it does not flicker.
    bool wasFlat = hand.flat;
    // Out of the palm or out of its back, whichever hand this is: only how it lies is asked.
    Vec3 normal = cross(at(platform::Joint::indexProximal) - wrist, at(platform::Joint::littleProximal) - wrist);
    normal = length(normal) > 1e-6f ? normalize(normal) : Vec3{0, 1, 0};
    hand.back = normal;
    // `straight`: the least straight finger. `bent`: how far the most bent one leaves the palm's own plane at its knuckle.
    float straight = 1, bent = 0;
    for (platform::Joint knuckle : {platform::Joint::indexProximal, platform::Joint::middleProximal, platform::Joint::ringProximal, platform::Joint::littleProximal}) {
        int k = int(knuckle);
        Vec3 a = anchor.joints[k], b = anchor.joints[k + 1], c = anchor.joints[k + 2], e = anchor.joints[k + 3];
        float bones = distance(a, b) + distance(b, c) + distance(c, e), al = distance(a, e);
        straight = std::min(straight, bones > 1e-4f ? al / bones : 0);
        bent = std::max(bent, al > 1e-4f ? std::fabs(dot(e - a, normal)) / al : 1);
    }
    float together = distance(index, little) / size;
    std::optional<Mat4> head = platform::head();
    Vec3 look = head ? hand.palm - head->position() : Vec3{0, 0, -1};
    look = length(look) > 1e-4f ? normalize(look) : Vec3{0, 0, -1};
    float lying = std::fabs(normal.y), facing = std::fabs(dot(normal, look));
    hand.flat = std::all_of(reach.begin(), reach.end(), [](float r) { return r > openReach; }) &&
                straight > (wasFlat ? knifeStraightKeep : knifeStraight) && bent < (wasFlat ? knifeBentKeep : knifeBent) &&
                together < (wasFlat ? knifeTogetherKeep : knifeTogether) && lying < (wasFlat ? knifeEdgeKeep : knifeEdge) &&
                facing < (wasFlat ? knifeFacingKeep : knifeFacing) && hand.pinch > (wasFlat ? knifeApart * 0.6f : knifeApart);
    // The way a blade on this hand points: from the wrist through the middle fingertip, a little steadied.
    Vec3 edge = middle - wrist;
    edge = length(edge) > 1e-4f ? normalize(edge) : Vec3{0, 0, -1};
    if (hand.aim) {
        Vec3 eased = *hand.aim + (edge - *hand.aim) * (1 - std::exp(-frame / knifeSteady));
        edge = length(eased) > 1e-4f ? normalize(eased) : edge;
    }
    hand.aim = edge;
    hand.point = middle + edge * knifeReach;
    // `-knifeLog`: what each hand reads, once a second, for tuning these in the headset.
    static const bool logging = Flags::has("knifeLog");
    static double logged[2] = {0, 0};
    int which = &hand == &right ? 1 : 0;
    if (logging && now - logged[which] > 1) {
        logged[which] = now;
        logLine(fmt("[hands] %s knife %s: straight %.3f, bent %.2f, together %.2f, lying %.2f, facing %.2f, pinch %.3f", which ? "right" : "left",
                    hand.flat ? "yes" : "no", double(straight), double(bent), double(together), double(lying), double(facing), double(hand.pinch)));
    }
    hand.lastSeen = now;
}

void Hands::fist(Hand& hand, Vec3 origin, Vec3 f, double now, std::vector<Event>& events) {
    if (!(hand.tracked && hand.fist)) {
        if (hand.fistWay == 2) events.push_back(Event::panEnded(hand.speed));
        hand.fistSince = std::nullopt;
        hand.fistBase = std::nullopt;
        hand.fistAt = std::nullopt;
        hand.fistWay = 0;
        hand.fistLocked = false;
        return;
    }
    busyUntil = now + 0.4;
    handBusy[&hand == &left ? 0 : 1] = now + 0.4;
    if (!hand.fistSince) hand.fistSince = now;
    // Held a moment first, so a hand closing in passing does nothing.
    if (!(hand.fistSince && now - *hand.fistSince > 0.12)) return;
    if (!(hand.fistAt && hand.fistAxes)) {
        // NOTE(port): changed for Quest (2026-11-15). The frame is set once, here, and both things a fist does
        // are read in it: the shortest line from the fist to the surface in front of it is the normal axis, and
        // the tree is carried in the plane across that line. The scene says what that surface is (`surface`);
        // without it, ahead and right are as they are where the hand is, as in the Swift.
        Vec3 v = hand.wrist - origin;
        Vec3 r = normalize(cross(f, Vec3{0, 1, 0}));
        float az = std::atan2(dot(v, r), dot(v, f));
        Axes axes{f * std::cos(az) + r * std::sin(az), r * std::cos(az) - f * std::sin(az), Vec3{0, 1, 0}};
        if (std::optional<Surface> s = surface ? surface(hand.wrist) : std::nullopt) axes = Axes{s->normal, s->right, s->up};
        hand.fistAt = hand.wrist;
        hand.fistAxes = axes;
        hand.fistWay = 0;
        hand.fistLocked = false;
        hand.carried = Vec2::zero();
        hand.carriedFrom = Vec2::zero();
        hand.speed = Vec2::zero();
        return;
    }
    Vec3 start = *hand.fistAt;
    Axes axes = *hand.fistAxes;
    Vec3 d = hand.wrist - start;
    float depth = dot(d, axes.ahead);
    Vec2 across{dot(d, axes.right), dot(d, axes.up)};
    if (!hand.fistLocked) {
        // Which of the two the whole movement so far is. Along the normal axis it is between layers, across it
        // the tree is carried; in the buffer between, it stays what it was.
        float deep = std::fabs(depth), flat = length(across), far = std::sqrt(deep * deep + flat * flat);
        int lean = 0;
        if (far > fistLock) {
            lean = deep > flat * pushLean ? 1 : deep < flat * panLean ? 2 : 0;
            if (lean == 0 && hand.fistWay == 0 && far > fistSure) lean = deep > flat ? 1 : 2;
        }
        if (lean != 0 && lean != hand.fistWay) {
            // It was a push after all: the tree goes back to where the carry began, and that carry is not counted.
            if (hand.fistWay == 2 && length(hand.carried - hand.carriedFrom) > 1e-5f) events.push_back(Event::panUndone(hand.carriedFrom - hand.carried));
            hand.fistWay = lean;
            if (lean == 2) {
                hand.carriedFrom = across;
                hand.carried = across;
                hand.speed = Vec2::zero();
            } else {
                hand.fistBase = 0;
            }
        }
    }
    if (hand.fistWay == 0) return;
    if (hand.fistWay == 2) {
        Vec2 step = across - hand.carried;
        hand.carried = across;
        hand.speed = hand.speed * 0.7f + (step / frame) * 0.3f;
        if (length(step) > 1e-5f) events.push_back(Event::pan(step));
        // This far across from where it closed, it is a carry until the hand opens.
        if (length(across) > panCommit) hand.fistLocked = true;
        return;
    }
    float moved = depth - hand.fistBase.value_or(0);
    if (std::fabs(moved) > layerPull) {
        // Pulled toward you: the layer behind comes forward. A layer stepped, it steps layers until the hand opens.
        events.push_back(Event::layer(moved < 0 ? 1 : -1));
        hand.fistBase = depth;
        hand.fistLocked = true;
    }
}

void Hands::blade(Hand& hand, const Hand& other, double now, std::vector<Event>& events) {
    // The pose, held, and the other hand not at it (palms coming together are not knives).
    bool pose = hand.tracked && hand.flat && !hand.fist && !(other.tracked && distance(other.palm, hand.palm) < knifeAlone);
    if (pose) {
        if (!hand.flatSince) hand.flatSince = now;
        hand.flatLast = now;
        if (now - *hand.flatSince >= knifeDwell) hand.out = true;
    } else if (!(hand.out && hand.tracked && !hand.fist && now - hand.flatLast < knifeGrace)) {
        hand.flatSince = std::nullopt;
        hand.out = false;
        hand.spent = false;
        hand.restSince = std::nullopt;
        hand.trail.clear();
    }
    hand.mark = std::nullopt;
    if (!hand.out) return;
    // The blade points, and what cuts is the place on the surface it points at.
    if (target && hand.aim) hand.mark = target(hand.tip, *hand.aim);
    if (!hand.mark) {
        hand.trail.clear();
        return;
    }
    // A stroke is judged over that place's travel this last moment, not one frame of it: a single frame's
    // jump in the tracking is a stroke's speed by itself.
    hand.trail.push_back({now, *hand.mark});
    while (hand.trail.size() > 1 && now - hand.trail[1].at >= strokeSpan) hand.trail.erase(hand.trail.begin());
    const Hand::Was& from = hand.trail.front();
    double took = now - from.at;
    if (!(took > strokeSpan * 0.6)) return;
    float speed = distance(*hand.mark, from.mark) / float(took);
    if (hand.spent) {
        // One stroke, one cut (see `cutPause` in hands.h): it has to come to rest before it can cut again.
        if (speed < strokeRest) {
            if (!hand.restSince) hand.restSince = now;
            if (now - *hand.restSince >= strokeRestFor) hand.spent = false;
        } else {
            hand.restSince = std::nullopt;
        }
    }
    if (hand.spent || !(now > hand.cutUntil)) return;
    if (!(speed > bladeSpeed)) return;
    busyUntil = now + 0.4;
    handBusy[&hand == &left ? 0 : 1] = now + 0.4;
    events.push_back(Event::cut(from.mark, *hand.mark));
}

/// Told that a cut landed, so one swing cuts one thread.
void Hands::cutLanded() {
    double until = mediaTime() + cutPause;
    for (Hand* h : {&left, &right}) {
        h->cutUntil = until;
        h->spent = h->out;
        h->restSince = std::nullopt;
    }
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
        handBusy[0] = handBusy[1] = now + 0.4;
        if (now - *clapSince >= clapHold) {
            clapSince = std::nullopt;
            clapUntil = now + 1.5;
            busyUntil = now + 0.6;
            handBusy[0] = handBusy[1] = now + 0.6;
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
        g.up = h.fistAxes->up;
        g.carried = h.fistWay == 2 ? h.carried - h.carriedFrom : Vec2{dot(d, h.fistAxes->right), dot(d, h.fistAxes->up)};
        g.depth = dot(d, h.fistAxes->ahead);
        g.base = h.fistBase.value_or(0);
        g.locked = h.fistLocked;
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
        if (!(h.tracked && !h.fist && (h.out || h.flatSince))) continue;
        Blade b;
        b.hand = k;
        b.tip = h.tip;
        b.palm = h.palm;
        b.point = h.point;
        b.along = h.aim.value_or(Vec3{0, 0, -1});
        b.mark = h.mark;
        b.out = h.out;
        b.ready = h.out ? 1 : float(std::min(1.0, (mediaTime() - *h.flatSince) / knifeDwell));
        out.push_back(b);
    }
    return out;
}
