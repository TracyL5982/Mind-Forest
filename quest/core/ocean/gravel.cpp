// Not a port: added for Quest (see gravel.h).
#include "gravel.h"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstring>

namespace {
/// A number that is the same every time for the same two numbers: 0 to 1.
float chance(uint32_t seed, uint32_t n) {
    uint32_t h = seed * 0x9E3779B1u + n * 0x85EBCA77u;
    h ^= h >> 15;
    h *= 0x2C1B3C6Du;
    h ^= h >> 12;
    h *= 0x297A2D39u;
    h ^= h >> 15;
    return float(h >> 8) / float(1 << 24);
}

const float tau = 2 * floatPi;
}  // namespace

std::shared_ptr<Gravel> Gravel::make(const Material& material, uint32_t seed) {
    LowLevelMesh::Descriptor d;
    d.vertexCapacity = vertexCapacity;
    d.indexCapacity = indexCapacity;
    d.vertexAttributes = {
        {LowLevelMesh::Semantic::position, 3, offsetof(LinkVertex, position)},
        {LowLevelMesh::Semantic::uv0, 2, offsetof(LinkVertex, rg)},
        {LowLevelMesh::Semantic::uv1, 2, offsetof(LinkVertex, ba)},
    };
    d.stride = sizeof(LinkVertex);
    LowLevelMeshRef mesh = LowLevelMesh::make(d);
    if (!mesh) return nullptr;
    std::shared_ptr<Gravel> g(new Gravel());
    g->mesh = mesh;
    g->seed = seed * 2654435761u + 17;
    g->entity = Entity::make(mesh, {material});
    g->rake({});
    g->show(1);
    return g;
}

void Gravel::rake(const std::vector<Cut>& cuts) {
    marks.clear();
    out.clear();
    indices.clear();
    // Warm white, as the small tree's light is; the heavy rings a shade warmer.
    const Vec3 pale = Color::hex(0xF4F1EA).linear(), warm = Color::hex(0xFFF1D6).linear();
    auto room = [&](size_t vertices, size_t index) { return marks.size() + vertices <= size_t(vertexCapacity) && indices.size() + index <= size_t(indexCapacity); };
    auto put = [&](Vec2 p, Vec3 tint, float alpha) {
        marks.push_back(LinkVertex{Vec3{p.x, 0, p.y}, Vec2(tint.x, tint.y), Vec2(tint.z, alpha)});
        out.push_back(std::min(1.f, length(p) / reach));
    };
    auto taken = [&](Vec2 p) {
        for (const Cut& c : cuts) {
            if (distance(p, c.at) < c.radius) return true;
        }
        return false;
    };

    // Under everything, the faintest pool of light: it is what first lifts the tree off the ocean.
    {
        const int around = 48;
        uint32_t centre = uint32_t(marks.size());
        put(Vec2::zero(), pale, 0.07f);
        for (int k = 0; k < around; k++) {
            float a = float(k) * tau / float(around);
            put(Vec2{std::cos(a), std::sin(a)} * (reach * 0.96f), pale, 0);
        }
        for (int k = 0; k < around; k++) indices.insert(indices.end(), {centre, centre + 1 + uint32_t(k), centre + 1 + uint32_t((k + 1) % around)});
    }

    // How the whole set is out of true: every ring has these, a little more of them the further out.
    float lean = chance(seed, 1) * tau, oval = chance(seed, 2) * tau, three = chance(seed, 3) * tau;
    float heart = chance(seed, 4) * tau;        // which way the heart lies off the middle
    const int rings = 11;
    // Unevenly spaced, wide years and narrow; and a little wider apart the further out, as a ripple's are.
    float radii[rings];
    {
        float r = 0.068f;
        for (int i = 0; i < rings; i++) {
            radii[i] = r;
            r += (0.024f + 0.014f * chance(seed, 20 + uint32_t(i))) * (1 + 0.5f * float(i) / float(rings - 1));
        }
        float fit = (reach - 0.01f) / radii[rings - 1];
        for (float& v : radii) v *= fit;
    }
    for (int i = 0; i < rings; i++) {
        float t = float(i) / float(rings - 1);              // 0 the innermost … 1 the outermost
        // Three kinds of line, as a drawing has three weights. Every third ring is drawn: a heavy line in
        // long strokes, the late wood. The rings between are raked: a fine line in short dashes with a
        // breath between, gravel. And the last is the edge of it all: fine, but nearly unbroken, the line
        // at which another tree's rings stop.
        bool drawn = i % 3 == 0, edge = i == rings - 1;
        float base = radii[i];
        float width = drawn ? 0.0098f : edge ? 0.0062f : 0.0056f;
        // A ripple weakens as it goes out; the drawn rings carry further than the raked.
        float strength = drawn ? 0.9f * (1 - 0.5f * t) : edge ? 0.36f : 0.6f * (1 - 0.55f * t);
        float own = chance(seed, 40 + uint32_t(i)) * tau;
        Vec2 middle = Vec2{std::cos(heart), std::sin(heart)} * (0.018f * t);
        auto at = [&](float a) {
            float r = base * (1 + (0.022f + 0.03f * t) * std::cos(a - lean) + 0.02f * std::cos(2 * a + oval) + 0.012f * std::cos(3 * a + three)) +
                      0.011f * base * std::cos(5 * a + own);
            return middle + Vec2{std::cos(a), std::sin(a)} * r;
        };
        // A point every 6 mm of the ring or so.
        const float step = tau / std::min(200.f, std::max(96.f, tau * base / 0.006f));
        float a = chance(seed, 60 + uint32_t(i)) * tau, end = a + tau;
        uint32_t n = 0;
        while (a < end - 0.01f) {
            float roll = chance(seed, 1000 + uint32_t(i) * 97 + n), air = chance(seed, 5000 + uint32_t(i) * 89 + n);
            // (How long a stroke and how wide the breath after it, in radians: a dash is a length on the
            // ground, 3 to 10 cm of the cover's measure, whatever the ring.)
            float longest = drawn || edge ? 1.0f + 1.5f * roll : (0.03f + 0.07f * roll) / base;
            float breath = drawn || edge ? 0.035f + 0.04f * air : (0.011f + 0.014f * air) / base;
            // Each stroke pressed a little harder or lighter than the last.
            float press = 0.78f + 0.4f * chance(seed, 9000 + uint32_t(i) * 83 + n);
            float to = std::min(a + longest, end - breath * 0.5f);
            // Its points, and which of them lie on ground another tree's rings have.
            std::vector<Vec2> points;
            std::vector<bool> free;
            for (float b = a; b < to + step * 0.5f; b += step) {
                Vec2 p = at(std::min(b, to));
                points.push_back(p);
                free.push_back(!taken(p));
            }
            // What is left of it is drawn as strokes of their own: it ends where the other rings begin.
            size_t from = 0;
            while (from < points.size()) {
                while (from < points.size() && !free[from]) from++;
                size_t till = from;
                while (till < points.size() && free[till]) till++;
                size_t count = till - from;
                if (count >= 2 && room(count * 3, (count - 1) * 12)) {
                    // How far along the stroke each point is, m: its ends are rounded over a length of
                    // about its own width, however long it is, so a dash is a dash and not a spindle.
                    std::vector<float> along(count, 0);
                    for (size_t k = 1; k < count; k++) along[k] = along[k - 1] + distance(points[from + k], points[from + k - 1]);
                    float whole = along[count - 1], cap = width * 1.3f;
                    uint32_t first = uint32_t(marks.size());
                    for (size_t k = 0; k < count; k++) {
                        Vec2 p = points[from + k];
                        Vec2 way = points[std::min(from + k + 1, till - 1)] - points[from + k > from ? from + k - 1 : from];
                        Vec2 across = length(way) > 1e-6f ? normalize(Vec2{way.y, -way.x}) : normalize(p);
                        float lift = smoothstep(0, 1, std::min(along[k], whole - along[k]) / cap);
                        // The hand is not quite even: the line swells and thins a little as it goes.
                        float swell = 1 + 0.16f * std::sin(along[k] * 38 + own + float(n));
                        float half = width * press * swell * (0.5f + 0.5f * lift) / 2;
                        float alpha = std::min(1.f, strength * press * lift);
                        const Vec3& tint = drawn ? warm : pale;
                        put(p - across * half, tint, 0);
                        put(p, tint, alpha);
                        put(p + across * half, tint, 0);
                    }
                    for (uint32_t k = 0; k + 1 < uint32_t(count); k++) {
                        uint32_t q = first + k * 3;
                        for (uint32_t j = 0; j < 2; j++) {
                            indices.insert(indices.end(), {q + j, q + j + 1, q + 3 + j});
                            indices.insert(indices.end(), {q + j + 1, q + 4 + j, q + 3 + j});
                        }
                    }
                }
                from = till;
            }
            a = to + breath;
            n++;
        }
    }

    // Close round the foot, small stones: the rake does not reach in there.
    for (uint32_t k = 0; k < 34; k++) {
        float a = chance(seed, 300 + k) * tau, r = 0.022f + 0.04f * std::sqrt(chance(seed, 400 + k));
        Vec2 p = Vec2{std::cos(a), std::sin(a)} * r;
        float size = 0.0028f + 0.0038f * chance(seed, 500 + k);
        if (taken(p) || !room(9, 24)) continue;
        uint32_t centre = uint32_t(marks.size());
        put(p, pale, 0.42f + 0.3f * chance(seed, 600 + k));
        // (Round, and a little longer round the foot than toward it, as a stone lies.)
        Vec2 round{-std::sin(a), std::cos(a)}, toward{std::cos(a), std::sin(a)};
        for (uint32_t j = 0; j < 8; j++) {
            float b = float(j) * tau / 8;
            put(p + round * (size * 1.4f * std::cos(b)) + toward * (size * std::sin(b)), pale, 0);
        }
        for (uint32_t j = 0; j < 8; j++) indices.insert(indices.end(), {centre, centre + 1 + j, centre + 1 + (j + 1) % 8});
    }

    mesh->withUnsafeMutableIndices([&](uint32_t* to, int) {
        if (to && !indices.empty()) std::memcpy(to, indices.data(), indices.size() * sizeof(uint32_t));
    });
    mesh->setPart(int(indices.size()), BoundingBox{Vec3{-reach - 0.03f, -0.01f, -reach - 0.03f}, Vec3{reach + 0.03f, 0.01f, reach + 0.03f}});
    float was = shown < 0 ? 1 : shown;
    shown = -1;
    show(was);
}

void Gravel::show(float front) {
    front = std::min(1.f, std::max(0.f, front));
    if (std::fabs(front - shown) < 0.002f) return;
    shown = front;
    // The front of the ripple is soft: a ring comes over a fifth of the way, not at a line.
    const float soft = 0.22f;
    float edge = front * (1 + soft);
    mesh->withUnsafeMutableBytes<LinkVertex>([&](LinkVertex* to, int) {
        if (!to) return;
        for (size_t i = 0; i < marks.size(); i++) {
            LinkVertex v = marks[i];
            float here = std::min(1.f, std::max(0.f, (edge - out[i]) / soft));
            v.ba.y *= here * here * (3 - 2 * here);
            to[i] = v;
        }
    });
}
