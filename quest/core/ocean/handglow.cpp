#include "handglow.h"

#include <algorithm>
#include <cstddef>

#include "../base.h"

namespace {
const Vec3 white{1, 1, 1};
const Vec3 cool{0.72f, 0.85f, 1.0f};        // the small tree's own two colours
const Vec3 warm{1.0f, 0.9f, 0.72f};
const float pi = floatPi;
const int vertexCapacity = 9000, indexCapacity = 30000;

float rad(float degrees) { return degrees * pi / 180; }
}

/// Writes soft shapes into the mesh: everything is brightest along its middle and fades to nothing at its edge, as light does.
struct HandGlow::Pen {
    LinkVertex* v;
    uint32_t* idx;
    Vec3 eye;
    int nv = 0, ni = 0;

    bool room(int verts, int indices) const { return nv + verts <= vertexCapacity && ni + indices <= indexCapacity; }
    void put(Vec3 p, Vec3 c, float a) { v[nv++] = LinkVertex{p, Vec2(c.x, c.y), Vec2(c.z, std::max(0.f, a))}; }
    void triangle(int a, int b, int c) {
        idx[ni] = uint32_t(a);
        idx[ni + 1] = uint32_t(b);
        idx[ni + 2] = uint32_t(c);
        ni += 3;
    }

    /// A line from `a` to `b`, turned to face you.
    void line(Vec3 a, Vec3 b, float width, Vec3 colour, float alphaA, float alphaB) {
        if (!room(6, 12)) return;
        Vec3 side = cross(b - a, (a + b) * 0.5f - eye);
        float len = length(side);
        if (len < 1e-9f) return;
        side = side / len * (width / 2);
        int base = nv;
        put(a - side, colour, 0);
        put(a, colour, alphaA);
        put(a + side, colour, 0);
        put(b - side, colour, 0);
        put(b, colour, alphaB);
        put(b + side, colour, 0);
        for (int k = 0; k < 2; k++) {
            triangle(base + k, base + k + 1, base + 3 + k);
            triangle(base + k + 1, base + 4 + k, base + 3 + k);
        }
    }

    /// Part of a ring in the plane of `x` and `y` round `c`, from angle `from` to `to` (radians, counter-clockwise from `x`).
    /// `fade` thins its far end to nothing (for a sweep that is still filling).
    void arc(Vec3 c, Vec3 x, Vec3 y, float radius, float from, float to, float width, Vec3 colour, float alpha, bool fade = false) {
        int steps = std::max(2, int(std::ceil(std::fabs(to - from) / rad(7.5f))));
        if (!room((steps + 1) * 3, steps * 12)) return;
        int base = nv;
        for (int i = 0; i <= steps; i++) {
            float u = float(i) / float(steps), a = from + (to - from) * u;
            Vec3 dir = x * std::cos(a) + y * std::sin(a);
            float here = alpha * (fade ? 0.35f + 0.65f * u : 1);
            put(c + dir * (radius - width / 2), colour, 0);
            put(c + dir * radius, colour, here);
            put(c + dir * (radius + width / 2), colour, 0);
        }
        for (int i = 0; i < steps; i++) {
            for (int k = 0; k < 2; k++) {
                int a = base + 3 * i + k, b = a + 3;
                triangle(a, a + 1, b);
                triangle(a + 1, b + 1, b);
            }
        }
    }

    void ring(Vec3 c, Vec3 x, Vec3 y, float radius, float width, Vec3 colour, float alpha) { arc(c, x, y, radius, 0, 2 * pi, width, colour, alpha); }

    /// A film of light across a ring, like the small tree's levels: faint in the middle, a little more toward its edge.
    void film(Vec3 c, Vec3 x, Vec3 y, float radius, Vec3 colour, float middle, float edge) {
        const int n = 40;
        if (!room(1 + n, 3 * n)) return;
        int centre = nv;
        put(c, colour, middle);
        for (int k = 0; k < n; k++) {
            float a = float(k) * 2 * pi / float(n);
            put(c + (x * std::cos(a) + y * std::sin(a)) * radius, colour, edge);
        }
        for (int k = 0; k < n; k++) triangle(centre, centre + 1 + k, centre + 1 + (k + 1) % n);
    }

    /// A ring of dashes: something that is there but cannot be used.
    void dashes(Vec3 c, Vec3 x, Vec3 y, float radius, int count, float width, Vec3 colour, float alpha) {
        float step = 2 * pi / float(count);
        for (int k = 0; k < count; k++) arc(c, x, y, radius, float(k) * step, (float(k) + 0.5f) * step, width, colour, alpha);
    }

    /// Short marks pointing out from a ring.
    void ticks(Vec3 c, Vec3 x, Vec3 y, float inner, float outer, int count, float width, Vec3 colour, float alpha, float turn = 0) {
        for (int k = 0; k < count; k++) {
            float a = turn + float(k) * 2 * pi / float(count);
            Vec3 dir = x * std::cos(a) + y * std::sin(a);
            line(c + dir * inner, c + dir * outer, width, colour, alpha, alpha);
        }
    }

    /// A small ball of light, as the small tree's are: nearly white in the middle, its own colour round that, fading out.
    void orb(Vec3 p, float radius, Vec3 colour, float alpha) {
        const int n = 14;
        if (!room(1 + 2 * n, 9 * n)) return;
        Vec3 toEye = eye - p;
        float far = length(toEye);
        toEye = far > 1e-6f ? toEye / far : Vec3{0, 0, 1};
        Vec3 x = cross(Vec3{0, 1, 0}, toEye);
        x = length(x) > 1e-5f ? normalize(x) : Vec3{1, 0, 0};
        Vec3 y = cross(toEye, x);
        int centre = nv;
        put(p, colour + (white - colour) * 0.8f, alpha);
        for (int k = 0; k < n; k++) {
            float a = float(k) * 2 * pi / float(n);
            put(p + (x * std::cos(a) + y * std::sin(a)) * (radius * 0.45f), colour + (white - colour) * 0.25f, alpha * 0.9f);
        }
        for (int k = 0; k < n; k++) {
            float a = float(k) * 2 * pi / float(n);
            put(p + (x * std::cos(a) + y * std::sin(a)) * radius, colour, 0);
        }
        for (int k = 0; k < n; k++) {
            int a = centre + 1 + k, b = centre + 1 + (k + 1) % n;
            triangle(centre, a, b);
            triangle(a, a + n, b);
            triangle(b, a + n, b + n);
        }
    }
};

std::shared_ptr<HandGlow> HandGlow::make(const std::optional<Material>& material) {
    if (!material) return nullptr;
    LowLevelMesh::Descriptor d;
    d.vertexCapacity = vertexCapacity;
    d.indexCapacity = indexCapacity;
    d.vertexAttributes = {{LowLevelMesh::Semantic::position, 3, offsetof(LinkVertex, position)},
                          {LowLevelMesh::Semantic::uv0, 2, offsetof(LinkVertex, rg)},
                          {LowLevelMesh::Semantic::uv1, 2, offsetof(LinkVertex, ba)}};
    d.stride = sizeof(LinkVertex);
    LowLevelMeshRef mesh = LowLevelMesh::make(d);
    if (!mesh) return nullptr;
    std::shared_ptr<HandGlow> glow(new HandGlow());
    glow->mesh = mesh;
    mesh->setPart(0, BoundingBox{{-0.01f, -0.01f, -0.01f}, {0.01f, 0.01f, 0.01f}});
    glow->entity = Entity::make(mesh, {*material});
    glow->entity->name = "hand glow";
    return glow;
}

/// The gauge round one closed hand. It goes where the fist goes, but it is the canvas's, not the hand's:
/// the tree is carried in the plane of the sheet in front of the hand and stepped along the line straight
/// through it, whichever way the fist happens to be turned, so the rings lie flat to the sheet and the
/// gates stand along the line into it. The fist's own turn shows in the middle, as a small plate that
/// tips with the hand: flat in the rings when the knuckles point square at the canvas.
void HandGlow::gauge(Pen& pen, const Held& h, double now) const {
    const Grab& g = h.grab;
    float s = h.shown;
    if (s < 0.01f) return;
    Vec3 x = g.right, y{0, 1, 0}, z = g.ahead;
    Vec3 c = h.centre;
    const float ring = 0.07f;
    // The plate: across the hand, so its face looks where the knuckles point.
    {
        Vec3 px = h.turn.act({1, 0, 0}), py = h.turn.act({0, 1, 0});
        const float plate = 0.036f;
        pen.film(c, px, py, plate, white, 0.16f * s, 0.07f * s);
        pen.ring(c, px, py, plate, 0.003f, white, 0.75f * s);
        // A mark toward the back of the hand, so a roll of the wrist shows too.
        pen.line(c + py * (plate - 0.012f), c + py * (plate + 0.006f), 0.003f, white, 0.9f * s, 0.9f * s);
        pen.orb(c, 0.008f, white, 0.9f * s);
    }

    if (g.way == 0) {
        // Not yet committed: a ring round the fist that fills as the fist nears the distance that commits it,
        // and a mark left where it closed.
        float near = std::min(1.f, length(g.offset) / std::max(g.lock, 0.001f));
        pen.film(c, x, y, ring, cool, 0.03f * s, 0.09f * s);
        pen.ring(c, x, y, ring, 0.004f, cool, 0.5f * s);
        pen.ticks(c, x, y, ring + 0.004f, ring + 0.013f, 4, 0.0022f, white, 0.7f * s);
        if (near > 0.03f) pen.arc(c, x, y, ring + 0.008f, pi / 2, pi / 2 - near * 2 * pi, 0.005f, white, 0.85f * s, true);
        pen.orb(h.origin, 0.006f, cool, 0.8f * s);
        return;
    }

    if (g.way == 2) {
        // Carrying the tree. From where the fist closed to the fist, a tail: its length is the carry, marked every 5 cm.
        Vec3 back = h.origin - c;
        float far = length(back);
        if (far > 0.012f) {
            Vec3 along = back / far;
            Vec3 from = c + along * std::min(far, ring);         // it leaves the fist's ring, not its middle
            pen.line(h.origin, from, 0.007f, white, 0.25f * s, 0.9f * s);
            pen.line(h.origin, from, 0.02f, cool, 0.06f * s, 0.28f * s);
            Vec3 across = cross(along, c - pen.eye);
            across = length(across) > 1e-6f ? normalize(across) : x;
            for (int k = 1; float(k) * 0.05f < far - ring * 0.5f; k++) {
                Vec3 at = h.origin - along * (0.05f * float(k));
                float half = k % 2 == 0 ? 0.014f : 0.009f;
                pen.line(at - across * half, at + across * half, 0.0026f, white, 0.8f * s, 0.8f * s);
            }
        }
        pen.ring(h.origin, x, y, 0.012f, 0.002f, cool, 0.55f * s);
        pen.orb(h.origin, 0.005f, cool, 0.75f * s);
        // The fist's own rings, and on them, brighter, the side it is heading.
        pen.film(c, x, y, ring, cool, 0.03f * s, 0.08f * s);
        pen.ring(c, x, y, ring, 0.005f, cool, 0.85f * s);
        pen.ring(c, x, y, ring - 0.01f, 0.002f, white, 0.45f * s);
        pen.ticks(c, x, y, ring + 0.004f, ring + 0.009f, 24, 0.0016f, cool, 0.3f * s);
        if (far > 0.012f) {
            Vec3 way = -back;
            float heading = std::atan2(dot(way, y), dot(way, x));
            pen.arc(c, x, y, ring + 0.01f, heading - rad(32), heading + rad(32), 0.0055f, warm, 0.95f * s);
        }
        return;
    }

    // Between layers. Gates stand a step apart along the line into the canvas, and slide through the fist's
    // ring as it pushes or pulls: the gate it last stepped at, and the next either way.
    float moved = h.moved;
    float progress = std::min(1.f, std::fabs(moved) / std::max(g.pull, 0.001f));
    bool pulling = moved < 0;
    Vec3 baseGate = c - z * moved, nearGate = baseGate - z * g.pull, farGate = baseGate + z * g.pull;
    const float gate = ring + 0.006f;
    // The line they are strung on, a bead every quarter of a step.
    pen.line(nearGate, farGate, 0.0022f, cool, 0.4f * s, 0.4f * s);
    for (int k = -4; k <= 4; k++) {
        if (k == 0) continue;
        pen.orb(baseGate + z * (g.pull * float(k) / 4), k % 4 == 0 ? 0.0042f : 0.0026f, cool, 0.6f * s);
    }
    pen.film(baseGate, x, y, gate, cool, 0.03f * s, 0.09f * s);
    pen.ring(baseGate, x, y, gate, 0.0036f, cool, 0.6f * s);
    pen.ticks(baseGate, x, y, gate + 0.004f, gate + 0.011f, 12, 0.0018f, cool, 0.45f * s);
    for (int side = 0; side < 2; side++) {
        bool near = side == 0;
        Vec3 at = near ? nearGate : farGate;
        bool can = near ? g.canBack : g.canForward;
        bool heading = near == pulling && std::fabs(moved) > 0.004f;
        if (!can) {
            pen.dashes(at, x, y, gate, 18, 0.0022f, cool, 0.2f * s);
            continue;
        }
        float lit = heading ? progress : 0;
        // The gate ahead fills with light as it nears the fist.
        if (heading) pen.film(at, x, y, gate, warm, 0.16f * lit * s, 0.05f * lit * s);
        pen.ring(at, x, y, gate, 0.0034f + 0.002f * lit, cool + (white - cool) * lit, (0.34f + 0.5f * lit) * s);
        if (!heading) continue;
        // And an arc on it fills, from the top round: full is the step.
        pen.arc(at, x, y, gate + 0.009f, pi / 2, pi / 2 - progress * 2 * pi, 0.0065f, warm, 0.95f * s, true);
        // Four rails run to it from the gate behind.
        for (int k = 0; k < 4; k++) {
            float a = rad(45) + float(k) * pi / 2;
            Vec3 dir = (x * std::cos(a) + y * std::sin(a)) * gate;
            pen.line(baseGate + dir, at + dir, 0.002f, cool, 0.12f * s, (0.15f + 0.45f * progress) * s);
        }
    }
    // The fist's own ring: the gates come to it.
    pen.ring(c, x, y, ring - 0.012f, 0.005f, white, 0.9f * s);
    // A step just taken: the gate that reached the fist rings out.
    float since = float(now - h.steppedAt);
    if (since >= 0 && since < 0.45f) {
        float u = since / 0.45f, out = 1 - (1 - u) * (1 - u);
        pen.ring(baseGate, x, y, gate + 0.05f * out, 0.008f * (1 - u) + 0.002f, warm, 0.9f * (1 - u) * s);
    }
}

/// The orbs on the fingers of the hand over the small tree.
void HandGlow::orbs(Pen& pen, const std::vector<Finger>& fingers, float shown, double now) const {
    if (shown < 0.01f) return;
    float since = float(now - pulsedAt);
    float pulse = since >= 0 && since < 0.3f ? 1 - since / 0.3f : 0;
    for (const Finger& f : fingers) {
        if (!f.lead) continue;      // only the finger that picks
        // Bright and a little larger on a level, dim between two; a level newly lit answers with a pulse.
        float glow = 0.4f + 0.6f * f.snap;
        float radius = 0.0075f + 0.003f * f.snap + 0.005f * pulse;
        Vec3 colour = cool + (warm - cool) * (0.6f * f.snap);
        pen.orb(f.tip, radius * 1.8f, colour, 0.26f * glow * shown);
        pen.orb(f.tip, radius, colour, std::min(1.f, glow + 0.3f * pulse) * shown);
        // To the trunk at the finger's height: it is the finger, not a pointer, that picks the level.
        pen.line(f.tip, f.axis, 0.0028f, colour, (0.25f + 0.55f * f.snap) * shown, (0.1f + 0.3f * f.snap) * shown);
        // The thumb coming in: a ring closes round the orb, and meets it at the pinch.
        if (f.closing > 0.02f) {
            Vec3 toEye = pen.eye - f.tip;
            float far = length(toEye);
            toEye = far > 1e-6f ? toEye / far : Vec3{0, 0, 1};
            Vec3 x = cross(Vec3{0, 1, 0}, toEye);
            x = length(x) > 1e-5f ? normalize(x) : Vec3{1, 0, 0};
            Vec3 y = cross(toEye, x);
            float r = radius + 0.02f * (1 - f.closing);
            pen.ring(f.tip, x, y, r, 0.0028f, white, (0.35f + 0.6f * f.closing) * shown);
        }
    }
}

bool HandGlow::draw(Vec3 eye, const std::vector<Grab>& grabs, const std::vector<Finger>& fingers, double now, float dt) {
    for (Held& h : held) h.present = false;
    for (const Grab& g : grabs) {
        Held& h = held[g.hand == 0 ? 0 : 1];
        bool fresh = h.shown < 0.01f && !h.placed;
        // A step between layers moves the base: the gate it landed on flashes.
        if (!fresh && g.way == 1 && h.grab.way == 1 && std::fabs(g.base - h.grab.base) > 1e-4f) {
            h.steppedAt = now;
            h.steppedWay = g.base < h.grab.base ? 1 : -1;
        }
        h.grab = g;
        h.present = true;
        // Where the fist's middle was when it closed: the same place every frame but for the hand's
        // own shiver, which is steadied out.
        Vec3 origin = g.centre - g.offset;
        float k = fresh ? 1 : 1 - std::exp(-dt / 0.12f);
        h.origin = fresh ? origin : h.origin + (origin - h.origin) * k;
        // The gauge goes where the fist goes and turns as it turns, closely, a little steadied.
        float follow = fresh ? 1 : 1 - std::exp(-dt / 0.035f), swing = fresh ? 1 : 1 - std::exp(-dt / 0.07f);
        h.centre = fresh ? g.centre : h.centre + (g.centre - h.centre) * follow;
        h.turn = fresh ? g.turn : slerp(h.turn, g.turn, swing);
        // Between layers, what shows is how far the fist is past its last step. At a step that drops by a
        // whole step at once; the gates are a step apart, so the one that had just reached the fist is the
        // one it now starts from, and nothing jumps. It is eased only so far as the hand's own shiver.
        float moved = g.way == 1 ? g.depth - g.base : 0;
        h.moved = fresh || std::fabs(moved - h.moved) > g.pull * 0.5f ? moved : h.moved + (moved - h.moved) * follow;
        h.placed = true;
    }
    bool any = false;
    for (Held& h : held) {
        float target = h.present ? 1 : 0;
        float rate = h.present ? 9 : 6;
        h.shown += (target - h.shown) * std::min(1.f, rate * dt);
        if (!h.present && h.shown < 0.01f) {
            h.shown = 0;
            h.placed = false;
        }
        if (h.shown > 0) any = true;
    }
    if (!fingers.empty()) lastFingers = fingers;
    fingersShown += ((fingers.empty() ? 0.f : 1.f) - fingersShown) * std::min(1.f, 10 * dt);
    if (fingers.empty() && fingersShown < 0.01f) fingersShown = 0;
    if (fingersShown > 0) any = true;

    if (!any) {
        // Nothing to show: the mesh is left alone once it has been emptied.
        if (!blank) {
            mesh->setPart(0, mesh->bounds);
            blank = true;
        }
        return false;
    }
    int nv = 0, ni = 0;
    mesh->withUnsafeMutableBytes<LinkVertex>([&](LinkVertex* v, int) {
        mesh->withUnsafeMutableIndices([&](uint32_t* idx, int) {
            Pen pen{v, idx, eye};
            for (const Held& h : held) gauge(pen, h, now);
            orbs(pen, lastFingers, fingersShown, now);
            nv = pen.nv;
            ni = pen.ni;
        });
    });
    // It is all near the hands: a box round the eye, an arm's length and more each way.
    mesh->setPart(ni, BoundingBox{eye - Vec3::repeating(1.5f), eye + Vec3::repeating(1.5f)});
    blank = false;
    return true;
}
