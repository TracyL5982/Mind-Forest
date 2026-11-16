#include "guide.h"

#include <algorithm>
#include <cmath>
#include <cstddef>

#include "../base.h"
#include "shapes.h"

namespace {
const float pi = floatPi;
const int lineVertices = 9000, lineIndices = 36000;
// The accent as light: guidehand's is the colour as it is named (sRGB), and the line material wants it linear.
const Vec3 hotLight = Color(1.0f, 0.353f, 0.212f).linear();
Vec3 light(Vec3 colour) { return colour == guide::hot ? hotLight : colour; }
}

/// Writes soft shapes into the line mesh, as HandGlow's pen does: brightest along the middle, fading to nothing at the edge.
struct GuidePainter::Pen {
    LinkVertex* v;
    uint32_t* idx;
    Vec3 eye;
    int nv = 0, ni = 0;

    bool room(int verts, int indices) const { return nv + verts <= lineVertices && ni + indices <= lineIndices; }
    void put(Vec3 p, Vec3 c, float a) { v[nv++] = LinkVertex{p, Vec2(c.x, c.y), Vec2(c.z, std::max(0.f, a))}; }
    void triangle(int a, int b, int c) {
        idx[ni] = uint32_t(a);
        idx[ni + 1] = uint32_t(b);
        idx[ni + 2] = uint32_t(c);
        ni += 3;
    }

    /// A line through `points`, turned to face you: one strip, so its joints are whole.
    void path(const std::vector<Vec3>& points, const std::vector<float>& alphas, float width, Vec3 colour, bool closed) {
        int n = int(points.size());
        if (n < 2 || !room((n + 1) * 3, n * 12)) return;
        int base = nv, count = closed ? n + 1 : n;
        for (int i = 0; i < count; i++) {
            int k = i % n;
            Vec3 before = points[closed ? (k + n - 1) % n : std::max(k - 1, 0)], after = points[closed ? (k + 1) % n : std::min(k + 1, n - 1)];
            Vec3 side = cross(after - before, points[k] - eye);
            float len = length(side);
            side = len > 1e-9f ? side / len * (width / 2) : Vec3{width / 2, 0, 0};
            put(points[k] - side, colour, 0);
            put(points[k], colour, alphas[k]);
            put(points[k] + side, colour, 0);
        }
        for (int i = 0; i + 1 < count; i++) {
            for (int k = 0; k < 2; k++) {
                int a = base + 3 * i + k, b = a + 3;
                triangle(a, a + 1, b);
                triangle(a + 1, b + 1, b);
            }
        }
    }

    /// A faint fill inside a convex outline.
    void film(const std::vector<Vec3>& points, Vec3 colour, float alpha) {
        int n = int(points.size());
        if (n < 3 || !room(n, 3 * (n - 2))) return;
        int base = nv;
        for (const Vec3& p : points) put(p, colour, alpha);
        for (int k = 1; k + 1 < n; k++) triangle(base, base + k, base + k + 1);
    }

    /// A small ball of light: nearly white in the middle, its own colour round that, fading out.
    void orb(Vec3 p, float radius, Vec3 colour, float alpha) {
        const int n = 14;
        if (!room(1 + 2 * n, 9 * n)) return;
        Vec3 toEye = eye - p;
        float far = length(toEye);
        toEye = far > 1e-6f ? toEye / far : Vec3{0, 0, 1};
        Vec3 x = cross(Vec3{0, 1, 0}, toEye);
        x = length(x) > 1e-5f ? normalize(x) : Vec3{1, 0, 0};
        Vec3 y = cross(toEye, x);
        const Vec3 white{1, 1, 1};
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

std::shared_ptr<GuidePainter> GuidePainter::make(const std::optional<Material>& line) {
    if (!line || !guide::hasModel()) return nullptr;
    std::shared_ptr<GuidePainter> painter(new GuidePainter());
    painter->entity = Entity::make();
    painter->entity->name = "guide";
    LowLevelMesh::Descriptor d;
    d.vertexAttributes = {{LowLevelMesh::Semantic::position, 3, offsetof(LinkVertex, position)},
                          {LowLevelMesh::Semantic::uv0, 2, offsetof(LinkVertex, rg)},
                          {LowLevelMesh::Semantic::uv1, 2, offsetof(LinkVertex, ba)}};
    d.stride = sizeof(LinkVertex);
    const BoundingBox small{{-0.01f, -0.01f, -0.01f}, {0.01f, 0.01f, 0.01f}};
    // The lines first, so that the hands are in front of them where they share a depth.
    d.vertexCapacity = lineVertices;
    d.indexCapacity = lineIndices;
    painter->lines = LowLevelMesh::make(d);
    if (!painter->lines) return nullptr;
    painter->lines->setPart(0, small);
    painter->lineEntity = Entity::make(painter->lines, {*line});
    painter->entity->addChild(painter->lineEntity);
    Material ghost = Material::ghost();
    ghost.setParameter("Line", 0.0013f);
    // Light adds up in linear light, where a little goes a long way: these are much smaller than the sketch's.
    ghost.setParameter("Fill", 0.006f);
    ghost.setParameter("Glow", 0.05f);
    d.vertexCapacity = guide::modelCount();
    d.indexCapacity = int(guide::modelTriangles(false).size());
    for (int k = 0; k < 2; k++) {
        painter->handMesh[k] = LowLevelMesh::make(d);
        if (!painter->handMesh[k]) return nullptr;
        painter->handMesh[k]->setPart(0, small);
        painter->handEntity[k] = Entity::make(painter->handMesh[k], {ghost});
        painter->entity->addChild(painter->handEntity[k]);
    }
    return painter;
}

void GuidePainter::setLine(float weight) {
    for (int k = 0; k < 2; k++) {
        if (handEntity[k]->model && !handEntity[k]->model->materials.empty()) handEntity[k]->model->materials[0].setParameter("Line", weight);
    }
}

void GuidePainter::clear() {
    if (blank) return;
    for (int k = 0; k < 2; k++) handMesh[k]->setPart(0, handMesh[k]->bounds);
    lines->setPart(0, lines->bounds);
    blank = true;
}

void GuidePainter::draw(const guide::Gesture& gesture, float t, Vec3 eye) {
    frame.clear();
    gesture.draw(t, frame);
    // Everything is written in the entity's own space; the eye is brought into it for the lines to face.
    Vec3 here = entity->convertFrom(eye, nullptr);
    const BoundingBox box{{-reach, -reach, -reach}, {reach, reach, reach}};
    const std::vector<float>& there = guide::modelThere();
    for (int k = 0; k < 2; k++) {
        if (k >= int(frame.hands.size())) {
            handMesh[k]->setPart(0, handMesh[k]->bounds);
            continue;
        }
        const guide::Frame::Hand& hand = frame.hands[k];
        int side = hand.left ? 1 : 0;
        if (handSide[k] != side) {
            const std::vector<uint32_t>& triangles = guide::modelTriangles(hand.left);
            handMesh[k]->withUnsafeMutableIndices([&](uint32_t* idx, int capacity) {
                for (int i = 0; i < capacity && i < int(triangles.size()); i++) idx[i] = triangles[size_t(i)];
            });
            handSide[k] = side;
        }
        int count = std::min(int(hand.positions.size()), guide::modelCount());
        handMesh[k]->withUnsafeMutableBytes<LinkVertex>([&](LinkVertex* v, int) {
            for (int i = 0; i < count; i++) {
                const Vec3& n = hand.normals[size_t(i)];
                v[i] = LinkVertex{hand.positions[size_t(i)], Vec2(n.x, n.y), Vec2(n.z, there[size_t(i)])};
            }
        });
        handMesh[k]->setPart(int(guide::modelTriangles(hand.left).size()), box);
        handEntity[k]->opacity = hand.alpha;
    }
    int ni = 0;
    lines->withUnsafeMutableBytes<LinkVertex>([&](LinkVertex* v, int) {
        lines->withUnsafeMutableIndices([&](uint32_t* idx, int) {
            Pen pen{v, idx, here};
            // (A fill is that much fainter here than in the sketch, for the same reason as the hand's body.)
            for (const guide::Frame::Film& f : frame.films) pen.film(f.points, light(f.colour), f.alpha * 0.3f);
            // A stroke's width is its bright middle; the light round it falls off over as much again each side.
            for (const guide::Frame::Stroke& s : frame.strokes) pen.path(s.points, s.alphas, s.width * 2.6f, light(s.colour), s.closed);
            for (const guide::Frame::Orb& o : frame.orbs) pen.orb(o.p, o.radius, light(o.colour), o.alpha);
            ni = pen.ni;
        });
    });
    lines->setPart(ni, box);
    blank = false;
}
