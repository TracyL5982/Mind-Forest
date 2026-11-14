// Port of visionos/MindPalace/Ocean/Stage.swift.
#pragma once
#include <functional>
#include <optional>
#include <string>

#include "../base.h"
#include "../vecmath.h"
#include "../scene.h"

/// Where everything in the ocean mode stands: fixed where the user was and
/// faced when it started. Nothing here follows the head afterwards.
///
/// The ocean lies under you, at the floor. The tree's layers are sheets that
/// fan from one hinge on the floor, like the pages of a book stood open: the
/// one you work on is upright and wraps around you; each earlier one leans
/// further back and unrolls as it goes, until the earliest lie nearly flat
/// on the water, nested close together. Two sheets can only meet at the
/// hinge, where no sheet reaches.
struct Stage {
    Vec3 origin;                    // the eyes, at the start
    Vec3 f;                         // ahead, level
    Vec3 r;                         // right
    Vec3 u{0, 1, 0};
    float drop = 1.5f;              // m: from the eyes down to the ocean
    /// The layer you work on, as a sheet: half its width along its curve, and
    /// how far it reaches above and below its middle, m.
    struct Frame {
        float x = 0, up = 0, down = 0;
    };
    Frame frame;
    float band = 0;                 // m in from its border where cards begin to shrink

    static constexpr float shell = 4.2f;        // m: how far off the shelf of saved trees hangs
    static constexpr float focus = 1.5f;        // m: the layer you work on
    static constexpr float openY = 0.05f;       // m: its middle, at eye level
    // Each of these three can be tried at launch: `-frameWidth 120 -frameHeight 60 -squeezeBand 0.4`.
    static float width() { static const float v = asked("frameWidth").value_or(160); return v; }            // degrees of your view it spans, side to side
    static float height() { static const float v = asked("frameHeight").value_or(90); return v; }           // and top to bottom (it stops just above the floor)
    static float squeezeBand() { static const float v = asked("squeezeBand").value_or(0.575f); return v; }  // m: 46 cm at 1.2 m, the distance it was tuned at
    static constexpr float smallest = 0.25f;    // how small a card is by the time it reaches the border
    static constexpr float taper = 3.1f;        // how late in the band most of the shrinking happens
    static constexpr float ratio = 0.6f;        // each layer back has this much of the last one's angle left to the ground
    static constexpr float unroll = 1.4f;       // how much faster a sheet unrolls than it leans
    static constexpr float creep = 0.56f;       // m the hinge has moved away from you by the earliest layers
    static constexpr float recentre = 0.5f;     // each layer back sits this much nearer the middle of the view
    static constexpr float fade = 0.62f;        // and keeps this much of the last one's opacity

    Stage() : Stage(std::nullopt) {}

    explicit Stage(const std::optional<Mat4>& head) {
        origin = head ? head->position() : Vec3{0, 1.5f, 0};
        Vec3 forward = head ? head->forward() : Vec3{0, 0, -1};
        forward.y = 0;
        f = length(forward) > 1e-3f ? normalize(forward) : Vec3{0, 0, -1};
        r = normalize(cross(f, {0, 1, 0}));
        // The floor, for someone seated or standing (`-drop <m>` to try another).
        double askedDrop = Flags::number("drop");
        drop = askedDrop > 0.5 ? float(askedDrop) : std::min(1.6f, std::max(1.0f, origin.y));
        float up = focus * std::tan(height() / 2 * float(M_PI) / 180);
        float down = std::min(up, drop + openY - 0.06f);
        frame = {focus * width() / 2 * float(M_PI) / 180, up, down};
        band = std::min(squeezeBand(), 0.9f * std::min(frame.x, down));
    }

    /// A direction, `az` degrees to the right of ahead and `el` degrees up.
    Vec3 dir(float az, float el) const {
        float a = az * float(M_PI) / 180, e = el * float(M_PI) / 180;
        return (f * std::cos(a) + r * std::sin(a)) * std::cos(e) + u * std::sin(e);
    }

    Vec3 point(float az, float el, float dist) const { return origin + dir(az, el) * dist; }

    /// A point on the ocean, `az` degrees to the right of ahead and `dist` away along the floor.
    Vec3 ocean(float az, float dist) const {
        float a = az * float(M_PI) / 180;
        return origin + (f * std::cos(a) + r * std::sin(a)) * dist - u * drop;
    }

    /// Flat to a wall straight ahead: facing back along `f`.
    Quat flat() const { return Quat(Mat3(r, u, -f)); }

    /// Turned to face the user from `p`.
    Quat facing(Vec3 p) const {
        Vec3 z = normalize(origin - p);
        Vec3 x = cross(u, z);
        x = length(x) > 1e-4f ? normalize(x) : r;
        return Quat(Mat3(x, cross(z, x), z));
    }

    /// Upright and turned toward where you sit, for something that stands at `p` on the sheet around you.
    struct Upright {
        Quat orientation;
        Vec3 right;
        Vec3 normal;
    };
    Upright upright(Vec3 p) const {
        Vec3 v = p - origin;
        float az = std::atan2(dot(v, r), dot(v, f));
        Vec3 right = r * std::cos(az) - f * std::sin(az), normal = -(f * std::cos(az) + r * std::sin(az));
        return {Quat(Mat3(right, u, normal)), right, normal};
    }

    /// A place on a sheet: where it is and how a card lies there.
    struct Spot {
        Vec3 position;
        Vec3 right;
        Vec3 up;
        Vec3 normal;
        Quat orientation() const { return Quat(Mat3(right, up, normal)); }
    };

    /// One layer of the tree: a sheet that hangs from the hinge and curls toward you.
    struct Sheet {
        Vec3 hinge;         // on the floor, under the sheet's middle line
        Vec3 up;            // along the sheet, away from the hinge
        Vec3 near;          // off the sheet, on the side you are on
        Vec3 r;
        float curve;        // 1/m: how tightly it wraps around you
        float rise;         // m from the hinge to the sheet's middle
        float raise;        // m the whole sheet stands off toward you

        /// Where `p` (m right of and above the sheet's middle) is, and how a card lies there.
        Spot at(Vec2 p, float lift = 0) const {
            float a = p.x * curve;
            float s = std::sin(a), c = std::cos(a);
            float across = curve > 1e-4f ? s / curve : p.x;
            float off = (curve > 1e-4f ? (1 - c) / curve : 0) + lift + raise;
            return Spot{hinge + up * (rise + p.y) + r * across + near * off, r * c + near * s, up, near * c - r * s};
        }
    };

    /// The layer `behind` steps back from the one you work on. Each step
    /// leaves `ratio` of the angle to the ground, so the layers settle
    /// toward the floor and nest ever closer; the sheet unrolls as it leans,
    /// and its hinge creeps a little away from you.
    Sheet sheet(float behind) const {
        float b = std::max(behind, 0.f);
        float left = std::pow(ratio, b);                        // 1 for the layer you work on, toward 0 for the earliest
        float lean = (1 - left) * float(M_PI) / 2;
        Vec3 up = u * std::cos(lean) + f * std::sin(lean);
        Vec3 near = u * std::sin(lean) - f * std::cos(lean);
        Vec3 hinge = origin + f * (focus + creep * (1 - left)) - u * drop;
        // Anything in front of the layer you work on (a tree being pressed) stands off it a little.
        return Sheet{hinge, up, near, r, std::pow(left, unroll) / focus, drop + openY, behind < 0 ? -behind * 0.09f : 0};
    }

    /// The middle of a layer, as a flat page: for things that stand in front of the whole tree.
    struct Page {
        Vec3 center;
        Vec3 up;
        Vec3 normal;
        Quat orientation;
    };

    Page page(float behind) const {
        Spot s = sheet(behind).at(Vec2::zero());
        return Page{s.position, s.up, s.normal, s.orientation()};
    }

    /// Earlier layers also draw in toward the card you left them by, so each
    /// is smaller than the one after it.
    static float gather(float behind) { return behind > 0 ? std::pow(0.8f, behind) : 1; }

    /// How much of itself a layer `behind` steps back still shows.
    static float opacity(float behind) { return behind > 0 ? std::pow(fade, behind) : 1; }

    /// Where something that belongs at `v` on a sheet (m from its middle)
    /// shows, and how large. In the middle of the sheet, exactly there at
    /// full size. Within `band` of the border, pushed inward along the line
    /// from the middle and smaller, down to `smallest` at the border itself;
    /// anything that belongs past that piles up on the border. Order from
    /// the middle outward never changes.
    struct Squeezed {
        Vec2 at;
        float scale;
    };
    Squeezed squeeze(Vec2 v) const {
        float fy = v.y >= 0 ? frame.up : frame.down;
        float ax = std::fabs(v.x), ay = std::fabs(v.y);
        float inner = std::max(ax / (frame.x - band), ay / (fy - band));
        if (!(inner > 1)) return {v, 1};
        float rho = std::max(ax / frame.x, ay / fy), least = smallest;
        if (rho >= 1 / least) return {v / rho, least};
        float start = rho / inner, width = 1 - start;
        auto scale = [&](float s) { return 1 - (1 - least) * std::pow((s - start) / width, taper); };
        float lo = start, hi = 1;
        for (int i = 0; i < 12; i++) {
            float mid = (lo + hi) / 2;
            if (mid / scale(mid) > rho) hi = mid; else lo = mid;
        }
        float k = scale((lo + hi) / 2);
        return {v * k, k};
    }

    /// How fully something at `v` on the sheet is inside the border: 1 in the
    /// middle, falling to 0 across the band.
    float inside(Vec2 v) const {
        float e = std::min(frame.x - std::fabs(v.x), (v.y >= 0 ? frame.up : frame.down) - std::fabs(v.y)) / band;
        return e <= 0 ? 0 : e >= 1 ? 1 : e * e * (3 - 2 * e);
    }

private:
    static std::optional<float> asked(const char* key) {
        double v = Flags::number(key);
        return v > 0 ? std::optional<float>(float(v)) : std::nullopt;
    }
};

// MARK: - Motion

struct Ease {
    enum class Kind { out, pop, inOut, glide, linear, travel, arrive };
    Kind kind = Kind::out;
    constexpr Ease() = default;
    constexpr explicit Ease(Kind k) : kind(k) {}
    /// The cases, as the Swift names them: `.glide` is `Ease::glide`.
    static const Ease out, pop, inOut, glide, linear, travel, arrive;

    /// Where the curve is at time `u`: `ease(u)` in the Swift.
    float operator()(float u) const {
        u = std::min(1.f, std::max(0.f, u));
        switch (kind) {
        case Kind::linear: return u;
        case Kind::travel: return bezier(0.45f, 0, 0.1f, 1, u);          // one thing on its way: a departure, clear travel, a long soft arrival
        case Kind::arrive: return bezier(0.25f, 0.8f, 0.25f, 1, u);      // something appearing: quick to show, slow to settle, never past its place
        case Kind::out: return 1 - std::pow(1 - u, 3.f);                 // quick away, a soft landing
        case Kind::inOut: return u < 0.5f ? 8 * u * u * u * u : 1 - std::pow(-2 * u + 2, 4.f) / 2;
        case Kind::glide: return u * u * u * (u * (6 * u - 15) + 10);    // eases away and eases in: for anything large that moves
        case Kind::pop: {                                                // past its place by a hair, then back
            float c = 1.25f;
            return 1 + (c + 1) * std::pow(u - 1, 3.f) + c * std::pow(u - 1, 2.f);
        }
        }
        return u;
    }
    bool operator==(const Ease& o) const { return kind == o.kind; }

private:
    /// A cubic Bézier timing curve through (0,0), (x1,y1), (x2,y2), (1,1): where it is at time `u`.
    static float bezier(float x1, float y1, float x2, float y2, float u) {
        auto at = [](float a, float b, float t) {
            float w = 1 - t;
            return 3 * w * w * t * a + 3 * w * t * t * b + t * t * t;
        };
        // Find the curve's own parameter for this moment, closing in from both sides.
        float lo = 0, hi = 1, t = u;
        for (int i = 0; i < 12; i++) {
            float x = at(x1, x2, t);
            if (std::fabs(x - u) < 0.0005f) break;
            if (x < u) lo = t; else hi = t;
            t = (lo + hi) / 2;
        }
        return at(y1, y2, t);
    }
};
inline constexpr Ease Ease::out{Ease::Kind::out};
inline constexpr Ease Ease::pop{Ease::Kind::pop};
inline constexpr Ease Ease::inOut{Ease::Kind::inOut};
inline constexpr Ease Ease::glide{Ease::Kind::glide};
inline constexpr Ease Ease::linear{Ease::Kind::linear};
inline constexpr Ease Ease::travel{Ease::Kind::travel};
inline constexpr Ease Ease::arrive{Ease::Kind::arrive};

/// A value on its way somewhere: from where it was when told, to its target,
/// over a set time. Never a spring, so it can't run away.
/// V is float, Vec2 or Vec3 (anything with +, - and * float).
template <class V>
struct Tween {
    Tween() = default;
    Tween(V v) : from_(v), to_(v) {}

    V value(double now) const {
        if (!(duration > 0)) return now >= start ? to_ : from_;
        float u = float(now - start) / duration;
        return u <= 0 ? from_ : u >= 1 ? to_ : from_ + (to_ - from_) * ease(u);
    }

    double end() const { return start + double(duration); }
    V target() const { return to_; }
    V from() const { return from_; }
    V to() const { return to_; }

    /// `t.go(v, now: now, delay: d, over: s, .glide)`: with a delay, the ease is always written out.
    void go(V v, double now, double delay, float over, Ease e) {
        from_ = value(now);
        to_ = v;
        start = now + delay;
        duration = over;
        ease = e;
    }
    /// Without a delay: `t.go(v, now: now, over: s, .glide)`; the ease is `.out` when not given.
    void go(V v, double now, float over, Ease e = Ease::out) { go(v, now, 0, over, e); }

    void set(V v) {
        from_ = v;
        to_ = v;
        duration = 0;
    }

private:
    V from_{};
    V to_{};
    double start = 0;
    float duration = 0;
    Ease ease = Ease::out;
};

/// How long things take. Small things a hand causes are quick. Anything that
/// moves the whole tree (a new step, a step back) glides: in a headset a
/// fast move of everything at once is jarring, and can turn the stomach.
/// Nothing here is caused by the head.
namespace Pace {
constexpr float step = 1.0f;        // the tree shifting to a new step: a glide
constexpr float think = 1.4f;       // the gardener working on a question, before what it brings arrives
constexpr float grow = 0.5f;        // a card growing in place
constexpr float fly = 0.6f;         // a film coming out of the ocean
constexpr float pop = 0.42f;        // a note or tag appearing
constexpr double stagger = 0.045;   // between neighbors arriving
constexpr float leave = 0.3f;
constexpr float press = 0.32f;      // the clap flattening the tree
}

// MARK: - Color

/// Flat label colors, one per kind of thing, each with the ink that reads on it.
enum class Tone { people, craft, story, era, place, note, question, path };

inline uint32_t hex(Tone t) {
    switch (t) {
    case Tone::people: return 0xB9A7FF;
    case Tone::craft: return 0x5EDDB4;
    case Tone::story: return 0xF59AB8;
    case Tone::era: return 0x9FB2C8;
    case Tone::place: return 0xC6DB6E;
    case Tone::note: return 0xF5C451;
    case Tone::question: return 0x8FC7FF;
    case Tone::path: return 0xFFF4E0;
    }
    return 0xFFFFFF;
}

inline uint32_t inkHex(Tone t) {
    switch (t) {
    case Tone::people: return 0x1B1533;
    case Tone::craft: return 0x06281E;
    case Tone::story: return 0x3A0C1E;
    case Tone::era: return 0x121C28;
    case Tone::place: return 0x1F2807;
    case Tone::note: return 0x33250A;
    case Tone::question: return 0x0A2238;
    case Tone::path: return 0x1C160C;
    }
    return 0;
}

/// `tone.color` and `tone.ink`
inline Color color(Tone t) { return Color::hex(hex(t)); }
inline Color ink(Tone t) { return Color::hex(inkHex(t)); }

/// Linear RGB, for the thread material: `tone.linear`
inline Vec3 linear(Tone t) { return color(t).linear(); }

/// `tone.name`
inline const char* name(Tone t) {
    switch (t) {
    case Tone::people: return "People";
    case Tone::craft: return "Craft";
    case Tone::story: return "Story";
    case Tone::era: return "Era";
    case Tone::place: return "Place";
    case Tone::note: return "Note";
    case Tone::question: return "Question";
    case Tone::path: return "Path";
    }
    return "";
}

/// `tone.rawValue` and `Tone(rawValue:)`, as the JSON files spell them.
inline const char* rawValue(Tone t) {
    switch (t) {
    case Tone::people: return "people";
    case Tone::craft: return "craft";
    case Tone::story: return "story";
    case Tone::era: return "era";
    case Tone::place: return "place";
    case Tone::note: return "note";
    case Tone::question: return "question";
    case Tone::path: return "path";
    }
    return "";
}

inline std::optional<Tone> toneFrom(const std::string& raw) {
    for (Tone t : {Tone::people, Tone::craft, Tone::story, Tone::era, Tone::place, Tone::note, Tone::question, Tone::path}) {
        if (raw == rawValue(t)) return t;
    }
    return std::nullopt;
}
