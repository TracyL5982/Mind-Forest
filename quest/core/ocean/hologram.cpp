// Port of visionos/MindPalace/Ocean/Hologram.swift.
#include "hologram.h"

#include <cstddef>
#include <cstring>
#include <limits>
#include <set>

std::shared_ptr<Hologram> Hologram::make(const std::optional<Material>& material) {
    if (!material) return nullptr;
    LowLevelMesh::Descriptor d;
    d.vertexCapacity = vertexCapacity;
    d.indexCapacity = indexCapacity;
    d.vertexAttributes = {
        {LowLevelMesh::Semantic::position, 3, offsetof(LinkVertex, position)},
        {LowLevelMesh::Semantic::uv0, 2, offsetof(LinkVertex, rg)},
        {LowLevelMesh::Semantic::uv1, 2, offsetof(LinkVertex, ba)},
    };
    d.stride = sizeof(LinkVertex);
    // (d.indexType = .uint32: a LowLevelMesh's indices are always 32-bit here.)
    LowLevelMeshRef mesh = LowLevelMesh::make(d);
    if (!mesh) return nullptr;
    std::shared_ptr<Hologram> hologram(new Hologram());
    hologram->mesh = mesh;
    mesh->setPart(0, hologram->bounds);
    hologram->entity->addChild(Entity::make(mesh, {*material}));
    return hologram;
}

// MARK: - What it shows

void Hologram::set(const std::vector<Node>& fresh, int layers, int current, double now) {
    nodes = fresh;
    this->layers = std::max(layers, 1);
    this->current = current;
    std::set<int> live;
    for (const Node& n : fresh) live.insert(n.id);
    std::erase_if(shown, [&](const auto& entry) { return !live.count(entry.first); });
    // Something new grows out of what it came from.
    for (const Node& n : fresh) {
        if (shown.count(n.id)) continue;
        std::optional<Place> from;
        if (n.parent) {
            auto it = shown.find(*n.parent);
            if (it != shown.end()) from = it->second;
        }
        shown[n.id] = Place{from ? from->at : Vec3(0, 0, 0), from ? from->color : n.color};
    }
    float y = height(float(current), this->layers);
    if (std::fabs(currentY.target() - y) > 1e-5f) currentY.go(y, now, 0.7f, Ease::glide);
    float wide = 0.045f;
    for (const Node& n : fresh) wide = std::max(wide, std::sqrt(n.at.x * n.at.x + n.at.z * n.at.z));
    if (std::fabs(girth.target() - (wide + 0.026f)) > 1e-4f) girth.go(wide + 0.026f, now, 0.7f, Ease::glide);
    if (selected) select(std::min(*selected, this->layers - 1), now);
    busyUntil = std::max(busyUntil, now + 1.8);
}

void Hologram::hover(bool on, double now) {
    if (!((near.target() > 0.5f) != on)) return;
    near.go(on ? 1.f : 0.f, now, on ? 0.28f : 0.4f, Ease::out);
    if (!on) {
        selected.reset();
        selecting.go(0, now, 0.25f, Ease::out);
    }
    busyUntil = std::max(busyUntil, now + 0.6);
}

void Hologram::select(int layer, double now) {
    int to = std::min(std::max(layer, 0), layers - 1);
    float y = height(float(to), layers);
    if (!selected) {
        selectY.set(currentY.value(now));
        selecting.go(1, now, 0.18f, Ease::out);
    }
    if (!(selected != to || std::fabs(selectY.target() - y) > 1e-5f)) return;
    selected = to;
    selectY.go(y, now, 0.16f, Ease::out);
    busyUntil = std::max(busyUntil, now + 0.4);
}

// MARK: - Frame

void Hologram::update(double now, float dt) {
    if (!(now < busyUntil + 0.05)) return;
    // Everything drifts to where it belongs: the tree grows, it never jumps.
    float k = 1 - std::exp(-7 * dt);
    bool moving = false;
    for (const Node& n : nodes) {
        auto it = shown.find(n.id);
        if (it == shown.end()) continue;
        Place& s = it->second;
        if (distance(s.at, n.at) > 0.0002f || distance(s.color, n.color) > 0.004f) moving = true;
        s.at += (n.at - s.at) * k;
        s.color += (n.color - s.color) * k;
    }
    if (moving) busyUntil = std::max(busyUntil, now + 0.25);
    entity->scale = Vec3::repeating(1 + (zoom - 1) * near.value(now));
    draw(now);
}

void Hologram::draw(double now) {
    Pen pen{vertices.get(), indices.get(), vertexCapacity, indexCapacity};
    Vec3 white = Vec3::repeating(1);
    auto room = [&](int verts, int idx) { return pen.room(verts, idx); };
    auto put = [&](Vec3 p, Vec3 c, float a) { pen.put(p, c, a); };
    auto triangle = [&](int a, int b, int c) { pen.triangle(a, b, c); };
    /// A pane of light lying level across the tree: a soft fill and a fine rim.
    auto pane = [&](float y, float r, Vec3 c, float middle, float edge, float rim, float line) {
        int n = 56;
        if (!room(1 + 3 * n, 9 * n)) return;
        auto at = [&](int k, float r) -> Vec3 {
            float a = float(k) * 2 * float(M_PI) / float(n);
            return {std::cos(a) * r, y, -std::sin(a) * r * 0.86f};
        };
        if (middle > 0.003f || edge > 0.003f) {
            int center = pen.nv;
            put({0, y, 0}, c, middle);
            for (int k = 0; k < n; k++) put(at(k, r), c, edge);
            for (int k = 0; k < n; k++) triangle(center, center + 1 + k, center + 1 + (k + 1) % n);
        }
        int ring = pen.nv;
        for (int k = 0; k < n; k++) {
            put(at(k, r), c, rim);
            put(at(k, r + line), c, rim);
        }
        for (int k = 0; k < n; k++) {
            int a = ring + 2 * k, b = ring + 2 * ((k + 1) % n);
            triangle(a, a + 1, b);
            triangle(a + 1, b + 1, b);
        }
    };
    /// A soft round light, facing you.
    auto orb = [&](Vec3 p, float r, Vec3 c, float alpha, bool ring) {
        int n = 24;
        if (!room(1 + 2 * n + (ring ? 2 * n : 0), 9 * n + (ring ? 6 * n : 0))) return;
        auto at = [&](int k, float r) -> Vec3 {
            float a = float(k) * 2 * float(M_PI) / float(n);
            return p + Vec3(std::cos(a), std::sin(a), 0) * r;
        };
        int center = pen.nv;
        put(p + Vec3(0, 0, 0.0006f), c + (white - c) * 0.8f, alpha);
        for (int k = 0; k < n; k++) put(at(k, r * 0.45f), c + (white - c) * 0.25f, alpha * 0.9f);
        for (int k = 0; k < n; k++) put(at(k, r), c, 0);
        for (int k = 0; k < n; k++) {
            int a = center + 1 + k, b = center + 1 + (k + 1) % n;
            triangle(center, a, b);
            triangle(a, a + n, b + n);
            triangle(a, b + n, b);
        }
        if (!ring) return;
        // Where you are: a fine ring round it.
        int base = pen.nv;
        for (int k = 0; k < n; k++) {
            put(at(k, r * 1.22f), white, 0.95f * alpha);
            put(at(k, r * 1.22f + 0.0007f), white, 0.95f * alpha);
        }
        for (int k = 0; k < n; k++) {
            int a = base + 2 * k, b = base + 2 * ((k + 1) % n);
            triangle(a, a + 1, b);
            triangle(a + 1, b + 1, b);
        }
    };

    float hand = near.value(now), wide = girth.value(now);
    Vec3 cool(0.72f, 0.85f, 1.0f), warm(1.0f, 0.9f, 0.72f);
    // Behind everything: the levels. Every one shows as a fine ring while a hand is over the tree.
    if (hand > 0.02f) {
        for (int layer = 0; layer < layers; layer++) {
            pane(height(float(layer), layers), wide, cool, 0, 0, 0.2f * hand, 0.0005f);
        }
    }
    // The layer you work on.
    pane(currentY.value(now), wide, cool, 0.07f, 0.15f, 0.7f, 0.0008f);
    // The one under your fingers.
    float pick = selecting.value(now);
    if (pick > 0.02f) {
        pane(selectY.value(now), wide + 0.007f, warm, 0.1f * pick, 0.24f * pick, 0.95f * pick, 0.0012f);
    }

    // The trunk, and a branch up to every card that was asked about.
    branches(nodes, 1, [this](int id) -> std::optional<Place> {
        auto it = shown.find(id);
        return it == shown.end() ? std::nullopt : std::optional<Place>(it->second);
    }, pen);
    // Every other card: a glitter round the orb it came back to.
    for (const Node& n : nodes) {
        if (n.head) continue;
        auto it = shown.find(n.id);
        if (it == shown.end() || !room(5, 12)) continue;
        const Place& s = it->second;
        float r = 0.0010f + 0.0012f * n.importance;
        int base = pen.nv;
        put(s.at, s.color + (white - s.color) * 0.65f, 0.95f);
        put(s.at + Vec3(r, 0, 0), s.color, 0);
        put(s.at + Vec3(0, r, 0), s.color, 0);
        put(s.at - Vec3(r, 0, 0), s.color, 0);
        put(s.at - Vec3(0, r, 0), s.color, 0);
        for (int k = 0; k < 4; k++) triangle(base, base + 1 + k, base + 1 + (k + 1) % 4);
    }
    // The orbs last, over their branches.
    for (const Node& n : nodes) {
        if (!n.head) continue;
        auto it = shown.find(n.id);
        if (it == shown.end()) continue;
        const Place& s = it->second;
        float r = (0.0030f + 0.0011f * float(std::min(n.branches, 4))) * (n.current ? 1.2f : 1);
        orb(s.at, r * 2.2f, s.color, 0.16f, false);         // its halo
        orb(s.at, r, s.color, n.onPath ? 1 : 0.8f, n.current);
    }

    LinkVertex* v = vertices.get();
    uint32_t* indices = this->indices.get();
    int vertexCount = pen.nv, indexCount = pen.ni;
    mesh->withUnsafeMutableBytes<LinkVertex>([&](LinkVertex* to, int) {
        if (!to || !(vertexCount > 0)) return;
        std::memcpy(static_cast<void*>(to), v, size_t(vertexCount) * sizeof(LinkVertex));
    });
    mesh->withUnsafeMutableIndices([&](uint32_t* to, int) {
        if (!to || !(indexCount > 0)) return;
        std::memcpy(to, indices, size_t(indexCount) * sizeof(uint32_t));
    });
    mesh->setPart(indexCount, bounds);
}

// MARK: - Drawing, shared with a tree's cover

void Hologram::branches(const std::vector<Node>& nodes, float thick, const std::function<std::optional<Place>(int)>& shown, Pen& pen) {
    auto girthOf = [&](const Node& n) { return (0.0007f + 0.0021f * std::sqrt(n.weight)) * thick; };
    std::map<int, Node> byID;
    for (const Node& n : nodes) byID[n.id] = n;
    for (bool glow : {true, false}) {
        for (const Node& n : nodes) {
            if (!n.head) continue;
            std::optional<Place> to = shown(n.id);
            if (!to) continue;
            Place from{Vec3(0, 0, 0), to->color};
            float start = girthOf(n) * 1.6f;
            bool trunk = true;
            if (n.parent) {
                int p = *n.parent;
                if (std::optional<Place> parent = shown(p)) {
                    if (auto node = byID.find(p); node != byID.end()) {
                        from = *parent;
                        start = std::min(girthOf(node->second), girthOf(n) * 1.7f);
                        trunk = false;
                    }
                }
            }
            // Up out of where it left, then bending over to where it goes.
            Vec3 span = to->at - from.at;
            Vec3 bend = from.at + Vec3(span.x * 0.12f, span.y * 0.62f, span.z * 0.12f);
            std::vector<Vec3> points;
            points.reserve(11);
            for (int k = 0; k <= 10; k++) {
                float u = float(k) / 10, w = 1 - u;
                points.push_back(from.at * (w * w) + bend * (2 * w * u) + to->at * (u * u));
            }
            float end = girthOf(n), strength = n.onPath ? 1 : 0.6f;
            // The trunk comes up out of nothing; a branch leaves its orb at full strength.
            float full = (glow ? 0.34f : 0.92f) * strength;
            pen.ribbon(points, [&](float u) { return (start + (end - start) * u) * (glow ? 4.2f : 1); },
                       [&](float u) { return from.color + (to->color - from.color) * u; },
                       [&](float u) { return trunk ? full * std::min(1.f, u / 0.45f) : full; }, glow);
        }
    }
}

EntityRef Hologram::still(const std::vector<Node>& nodes, float thick, const Material& material) {
    int heads = 0;
    for (const Node& n : nodes) {
        if (n.head) heads += 1;
    }
    if (!(heads > 0)) return nullptr;
    // A branch is eleven points along: a soft ribbon three across, and a plain one two across. Then a round join.
    int vertexCapacity = heads * (55 + 13), indexCapacity = heads * (180 + 36);
    // (Freed when this returns: the Swift's `defer`.)
    std::unique_ptr<LinkVertex[]> vertexStore(new LinkVertex[size_t(vertexCapacity)]);
    std::unique_ptr<uint32_t[]> indexStore(new uint32_t[size_t(indexCapacity)]);
    LinkVertex* vertices = vertexStore.get();
    uint32_t* indices = indexStore.get();
    Pen pen{vertices, indices, vertexCapacity, indexCapacity};
    std::map<int, Place> places;
    for (const Node& n : nodes) places[n.id] = Place{n.at, n.color};
    branches(nodes, thick, [&places](int id) -> std::optional<Place> {
        auto it = places.find(id);
        return it == places.end() ? std::nullopt : std::optional<Place>(it->second);
    }, pen);
    // Where one branch hands over to the next its width changes, which an orb hides on the
    // small tree at your hand. Here a round join does, no wider than the branch.
    for (const Node& n : nodes) {
        if (!(n.head && pen.room(13, 36))) continue;
        float r = (0.0007f + 0.0021f * std::sqrt(n.weight)) * thick / 2;
        int center = pen.nv;
        pen.put(n.at + Vec3(0, 0, 0.0004f), n.color, n.onPath ? 0.92f : 0.55f);
        for (int k = 0; k < 12; k++) {
            float a = float(k) * float(M_PI) / 6;
            pen.put(n.at + Vec3(std::cos(a), std::sin(a), 0) * r + Vec3(0, 0, 0.0004f), n.color, n.onPath ? 0.92f : 0.55f);
        }
        for (int k = 0; k < 12; k++) pen.triangle(center, center + 1 + k, center + 1 + (k + 1) % 12);
    }
    if (!(pen.ni > 0)) return nullptr;
    LowLevelMesh::Descriptor d;
    d.vertexCapacity = pen.nv;
    d.indexCapacity = pen.ni;
    d.vertexAttributes = {
        {LowLevelMesh::Semantic::position, 3, offsetof(LinkVertex, position)},
        {LowLevelMesh::Semantic::uv0, 2, offsetof(LinkVertex, rg)},
        {LowLevelMesh::Semantic::uv1, 2, offsetof(LinkVertex, ba)},
    };
    d.stride = sizeof(LinkVertex);
    // (d.indexType = .uint32: a LowLevelMesh's indices are always 32-bit here.)
    LowLevelMeshRef mesh = LowLevelMesh::make(d);
    if (!mesh) return nullptr;
    int vertexCount = pen.nv, indexCount = pen.ni;
    mesh->withUnsafeMutableBytes<LinkVertex>([&](LinkVertex* to, int) {
        if (to) std::memcpy(static_cast<void*>(to), vertices, size_t(vertexCount) * sizeof(LinkVertex));
    });
    mesh->withUnsafeMutableIndices([&](uint32_t* to, int) {
        if (to) std::memcpy(to, indices, size_t(indexCount) * sizeof(uint32_t));
    });
    Vec3 lo = Vec3::repeating(std::numeric_limits<float>::infinity()), hi = Vec3::repeating(-std::numeric_limits<float>::infinity());
    for (int i = 0; i < vertexCount; i++) {
        lo = vmin(lo, vertices[i].position);
        hi = vmax(hi, vertices[i].position);
    }
    mesh->setPart(indexCount, BoundingBox{lo - Vec3::repeating(0.002f), hi + Vec3::repeating(0.002f)});
    return Entity::make(mesh, {material});
}
