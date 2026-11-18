// See desk.h.
#include "desk.h"

#include <algorithm>
#include <cmath>
#include <optional>

#include "../base.h"

namespace {
float asked(const char* key, float otherwise) {
    double v = Flags::number(key);
    return v > 0 ? float(v) : otherwise;
}
}  // namespace

float Seating::reach() { static const float v = asked("deskReach", 0.75f); return v; }
float Seating::square() { static const float v = asked("deskSquare", 35); return v; }
// (Doubled on 2026-11-15, with how far off the forest stands, after Kai wore it: at 0.22 and 0.28, half a
// metre to a metre away, the trees were "too small and too close", and on the floor "next to the user's feet".)
// (And again the same afternoon: "trees should be at least 1.5m away, and be around 1m tall", on a desk
// taken to be large. A cover is about 0.5 to 0.63 tall in its own measure. On the floor, half that.)
float Forest::scale() { static const float v = asked("forestScale", 0.85f); return v; }
float Forest::grown() { static const float v = asked("forestGrown", 1.7f); return v; }

Seating Seating::choose(const Mat4& head, const std::vector<platform::Table>& tables, Vec3 lastAhead) {
    const Vec3 up{0, 1, 0};
    Vec3 p = head.position();
    // Ahead, level. A head bent right down over a desk still has an ahead: where the top of the head points.
    Vec3 h = head.forward();
    if (std::fabs(h.y) > 0.94f) h = head.up() * (h.y < 0 ? 1.f : -1.f);
    h.y = 0;
    h = length(h) > 1e-3f ? normalize(h) : lastAhead;

    Seating out;
    out.seat = Chair{p, h};

    // The table edge you sit at: near enough, in front of you, and faced about square on.
    struct Edge {
        const platform::Table* table;
        Vec3 n;             // level, out of the table across this edge
        Vec3 middle;
        float half;         // m: half the edge's length
        float deep;         // m: the table's size behind it
        float out;          // m the eyes are outside it
        float angle;        // degrees off square
        float score;
    };
    std::optional<Edge> best;
    float nearestOut = 99, nearestAngle = 0;
    for (const platform::Table& t : tables) {
        float below = p.y - t.center.y;
        if (!(below >= lowest && below <= highest)) continue;
        for (int k = 0; k < 4; k++) {
            Vec3 n = k == 0 ? t.a : k == 1 ? -t.a : k == 2 ? t.b : -t.b;
            float hn = k < 2 ? t.halfA : t.halfB, half = k < 2 ? t.halfB : t.halfA;
            Vec3 along = k < 2 ? t.b : t.a;
            Vec3 middle = t.center + n * hn;
            float outside = dot(p - middle, n), aside = std::fabs(dot(p - middle, along));
            float angle = std::acos(std::min(1.f, std::max(-1.f, dot(h, -n)))) * 180 / float(M_PI);
            if (aside <= half + slack && outside > -lean && outside < nearestOut && angle < 90) {
                nearestOut = outside;
                nearestAngle = angle;
            }
            if (!(outside >= -lean && outside <= reach() && aside <= half + slack && angle <= square())) continue;
            float score = std::max(outside, 0.f) + angle * 0.01f;
            if (!best || score < best->score) best = Edge{&t, n, middle, half, 2 * hn, outside, angle, score};
        }
    }

    Desk& desk = out.desk;
    if (best) {
        out.seat.f = -best->n;
        desk.found = true;
        desk.table = best->table->id;
        desk.back = -best->n;
        desk.across = out.seat.r();
        // Straight ahead of you on the edge; if you sit past its end, its end.
        float inset = std::min(0.05f, best->half);
        float s = std::min(best->half - inset, std::max(-(best->half - inset), dot(p - best->middle, desk.across)));
        desk.front = best->middle + desk.across * s;
        desk.left = best->half + s;
        desk.right = best->half - s;
        desk.depth = best->deep;
        out.note = fmt("a table: its edge %.2f m ahead, %.0f degrees off square, its top %.2f m below the eyes, %.2f m wide and %.2f deep",
                       double(best->out), double(best->angle), double(p.y - desk.front.y), double(2 * best->half), double(best->deep));
        return out;
    }
    float below = p.y > usual + 0.3f ? std::min(0.60f, std::max(0.42f, p.y - usual)) : 0.45f;
    desk.found = false;
    desk.table = 0;
    desk.back = h;
    desk.across = out.seat.r();
    desk.front = p + h * edge - up * below;
    desk.left = desk.right = 0.7f;
    desk.depth = 0.75f;
    if (tables.empty()) {
        out.note = fmt("no table known: a desk assumed %.2f m below the eyes", double(below));
    } else if (nearestOut < 90) {
        out.note = fmt("%d tables known, none near and square enough (the nearest edge %.2f m ahead, %.0f degrees off): a desk assumed %.2f m below the eyes",
                       int(tables.size()), double(nearestOut), double(nearestAngle), double(below));
    } else {
        out.note = fmt("%d tables known, none in front of you: a desk assumed %.2f m below the eyes", int(tables.size()), double(below));
    }
    return out;
}

// MARK: - The forest

namespace {
/// What a tree at `q` covers of the view from the eyes: degrees right of ahead and up.
struct Seen {
    float l, r, lo, hi;
    float area() const { return (r - l) * (hi - lo); }
};

Seen seen(const Desk& desk, Vec3 eyes, Vec2 q) {
    float s = Forest::grown();
    Vec2 e = desk.plot(eyes);
    float height = std::max(0.05f, eyes.y - desk.front.y);
    float dx = q.x - e.x, dz = q.y - e.y;
    float d = std::max(0.05f, std::sqrt(dx * dx + dz * dz));
    float az = std::atan2(dx, dz), half = std::atan2(Forest::halfWide * s, d);
    return Seen{az - half, az + half, -std::atan2(height, d), -std::atan2(height - Forest::tall * s, d)};
}
}  // namespace

float Forest::hidden(const Desk& desk, Vec3 eyes, Vec2 a, Vec2 b) {
    Seen x = seen(desk, eyes, a), y = seen(desk, eyes, b);
    float w = std::min(x.r, y.r) - std::max(x.l, y.l), h = std::min(x.hi, y.hi) - std::max(x.lo, y.lo);
    if (!(w > 0 && h > 0)) return 0;
    return w * h / std::max(1e-6f, std::min(x.area(), y.area()));
}

bool Forest::crowd(const Desk& desk, Vec3 eyes, Vec2 a, Vec2 b) {
    // (A tenth, and 1.6, while the trees were half this size and near: then a further tree was seen over
    // a nearer one. At this size and distance they stand in one band of the view, and so strict a rule
    // leaves room for six. A third of a further tree may now be behind a nearer one; the rest is there to point at.)
    // (A metre tall, a tree fills a good part of the view and the ones behind it are seen through its
    // branches and between its pictures, as in a wood; each is picked by its trunk, its pictures or its
    // name, not by the box round it (`makeCover`), so a hand ray passes between those to the trees behind.
    // What counts now is that no trunk stands behind another's: every trunk has its own line of sight,
    // `apart` degrees from the next, and room on the ground.)
    Vec2 e = desk.plot(eyes);
    float turn = std::fabs(std::atan2(a.x - e.x, a.y - e.y) - std::atan2(b.x - e.x, b.y - e.y)) * 180 / float(M_PI);
    return distance(a, b) < halfWide * grown() * 1.1f || turn < apart;
}

std::vector<Vec2> Forest::plots(const Desk& desk, Vec3 eyes, float nearest, const std::vector<Clearing>& clearings, int count) {
    // A metre tall and from a metre and a half off, a tree with its pictures is nearly two metres across:
    // two fill the view ahead. So they are not scattered at random (which stood them one behind another)
    // but set in rings round you, as a clearing has trees round it: two before you to left and right,
    // one further back between them, two at your sides, and then on outward. Each trunk has its own line
    // of sight, 11 degrees or more from the next. The first of these are taken first.
    struct Place {
        float az;           // degrees right of ahead
        float far;          // m from the eyes, for a forest that begins 1.5 m off
    };
    // (With its pictures drawn in to the trunk a tree is 1.2 m across, 20 degrees to each side of its
    // trunk at the nearest: the two before you stand 22 degrees to left and right, where they were 34.)
    static const Place ring[] = {{-22, 1.70f}, {23, 1.65f}, {1, 3.30f}, {-64, 1.85f}, {65, 1.80f}, {-43, 3.50f}, {44, 3.40f},
                                 {-11, 5.00f}, {12, 4.90f}, {-33, 5.10f}, {34, 5.00f}, {-54, 5.20f}, {55, 5.10f}};
    // The same small unevenness every time, so a forest is where it was.
    uint32_t state = 0x2F6E2B1u;
    auto random = [&]() {
        state = state * 1664525u + 1013904223u;
        return float(state >> 8) / float(1 << 24);
    };
    Vec2 e = desk.plot(eyes);
    float begins = std::max(0.3f, nearest - e.y) / 1.5f;
    float body = halfWide * grown();
    std::vector<Vec2> out;
    for (const Place& p : ring) {
        if (int(out.size()) >= count) break;
        float az = (p.az + (random() - 0.5f) * 2) * float(M_PI) / 180, far = (p.far + (random() - 0.5f) * 0.2f) * begins;
        Vec2 q{e.x + far * std::sin(az), e.y + far * std::cos(az)};
        bool clear = true;
        for (const Clearing& c : clearings) {
            if (distance(q, c.at) < c.radius + body * 0.3f) clear = false;
        }
        if (clear) out.push_back(q);
    }
    return out;
}
