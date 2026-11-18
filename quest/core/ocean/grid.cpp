// The grid under a layer (see grid.h).
#include "grid.h"

#include <cstddef>
#include <cstring>
#include <iterator>

std::shared_ptr<SheetGrid> SheetGrid::make(const std::optional<Material>& material) {
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
    std::shared_ptr<SheetGrid> grid(new SheetGrid());
    grid->mesh = mesh;
    mesh->setPart(0, grid->bounds);
    grid->entity = Entity::make(mesh, {*material});
    return grid;
}

void SheetGrid::clear() {
    if (drawn == 0) return;
    drawn = 0;
    last.clear();
    mesh->setPart(0, bounds);
}

void SheetGrid::draw(const Stage& stage, const Stage::Sheet& sheet, Vec2 origin, float cell, float dots, float lines, bool fine) {
    // (They are compared where they stand.)
    const float key[] = {origin.x, origin.y, cell, dots, lines, fine ? 1.f : 0.f, sheet.curve, sheet.up.y, sheet.hinge.x, sheet.hinge.z};
    if (std::size(key) == last.size()) {
        bool same = true;
        for (size_t i = 0; i < std::size(key); i++) {
            if (!(std::fabs(key[i] - last[i]) < 2e-4f)) {
                same = false;
                break;
            }
        }
        if (same) return;
    }
    last.assign(std::begin(key), std::end(key));
    // Sorted as if far away, so it is drawn before the cards that stand on it.
    Vec3 far = stage.origin + stage.f * 5;
    bounds = BoundingBox{far - Vec3::repeating(14), far + Vec3::repeating(14)};
    float fx = stage.frame.x, up = stage.frame.up, down = stage.frame.down;
    float major = cell * 4;
    float back = -0.006f;                                   // a hair behind the sheet
    Vec2 rg(tint.x, tint.y);
    float blue = tint.z;
    int nv = 0, ni = 0;
    LinkVertex* v = vertices.get();
    uint32_t* indices = this->indices.get();
    {
        auto room = [&](int verts, int idx) { return nv + verts <= vertexCapacity && ni + idx <= indexCapacity; };
        auto put = [&](Vec3 p, float a) {
            v[nv] = LinkVertex{p, rg, Vec2(blue, a)};
            nv += 1;
        };
        /// One point of a ribbon: where it is on the sheet, and how strongly it shows there.
        struct Point {
            Vec2 at;
            float alpha;
        };
        /// A ribbon through `points`, `half` wide each side, lying in the sheet.
        auto ribbon = [&](const std::vector<Point>& points, bool x, float half) {
            int last = -1;                                  // the index of the previous pair of vertices
            for (const Point& p : points) {
                if (!(p.alpha > 0.004f || last >= 0)) continue;
                if (!room(2, 6)) return;
                Stage::Spot spot = sheet.at(p.at, back);
                Vec3 side = (x ? spot.up : spot.right) * half;
                int base = nv;
                put(spot.position - side, p.alpha);
                put(spot.position + side, p.alpha);
                if (last >= 0) {
                    uint32_t a = uint32_t(last), b = uint32_t(base);
                    indices[ni] = a; indices[ni + 1] = a + 1; indices[ni + 2] = b;
                    indices[ni + 3] = a + 1; indices[ni + 4] = b + 1; indices[ni + 5] = b;
                    ni += 6;
                }
                last = p.alpha > 0.004f ? base : -1;
            }
        };
        /// `lo...hi`, for a ClosedRange<Int>.
        struct Range {
            int lo, hi;
        };
        auto range = [](float lo, float hi, float zero, float step) -> std::optional<Range> {
            int a = int(std::ceil((lo - zero) / step)), b = int(std::floor((hi - zero) / step));
            return a <= b ? std::optional<Range>(Range{a, b}) : std::nullopt;
        };

        // The lines: only while the tree is moving.
        if (lines > 0.01f) {
            int across = std::max(8, int(std::ceil(2 * fx / 0.16f))), tall = 10;
            for (bool heavy : {false, true}) {
                if (!heavy && !fine) continue;
                float step = heavy ? major : cell;
                float alpha = lines * (heavy ? 0.26f : 0.1f), half = heavy ? 0.0016f : 0.0011f;
                if (auto columns = range(-fx, fx, origin.x, step)) {
                    for (int i = columns->lo; i <= columns->hi; i++) {
                        if (!(heavy || i % 4 != 0)) continue;
                        float x = origin.x + float(i) * step;
                        std::vector<Point> points;
                        points.reserve(size_t(tall) + 1);
                        for (int k = 0; k <= tall; k++) {
                            Vec2 at(x, -down + (up + down) * float(k) / float(tall));
                            points.push_back(Point{at, alpha * stage.inside(at)});
                        }
                        ribbon(points, false, half);
                    }
                }
                if (auto rows = range(-down, up, origin.y, step)) {
                    for (int j = rows->lo; j <= rows->hi; j++) {
                        if (!(heavy || j % 4 != 0)) continue;
                        float y = origin.y + float(j) * step;
                        std::vector<Point> points;
                        points.reserve(size_t(across) + 1);
                        for (int k = 0; k <= across; k++) {
                            Vec2 at(-fx + 2 * fx * float(k) / float(across), y);
                            points.push_back(Point{at, alpha * stage.inside(at)});
                        }
                        ribbon(points, true, half);
                    }
                }
            }
        }

        // A soft dot in the middle of each cell, half a cell off the lines.
        if (dots > 0.01f) {
            auto columns = range(-fx, fx, origin.x + cell / 2, cell);
            auto rows = columns ? range(-down, up, origin.y + cell / 2, cell) : std::nullopt;
            if (columns && rows) {
                float radius = 0.0055f;
                for (int i = columns->lo; i <= columns->hi; i++) {
                    // The sheet curves only from side to side: one column of dots is a straight line up it.
                    float x = origin.x + (float(i) + 0.5f) * cell;
                    Stage::Spot foot = sheet.at(Vec2(x, 0), back);
                    Vec3 right = foot.right * radius, rise = foot.up * radius;
                    for (int j = rows->lo; j <= rows->hi; j++) {
                        Vec2 at(x, origin.y + (float(j) + 0.5f) * cell);
                        float a = 0.4f * dots * stage.inside(at);
                        if (!(a > 0.01f)) continue;
                        if (!room(5, 12)) break;
                        Vec3 p = foot.position + foot.up * at.y;
                        uint32_t base = uint32_t(nv);
                        put(p, a);
                        put(p + right, 0);
                        put(p + rise, 0);
                        put(p - right, 0);
                        put(p - rise, 0);
                        for (int k = 0; k < 4; k++) {
                            indices[ni] = base; indices[ni + 1] = base + 1 + uint32_t(k); indices[ni + 2] = base + 1 + uint32_t((k + 1) % 4);
                            ni += 3;
                        }
                    }
                }
            }
        }

        // A small cross where the heavier lines meet.
        if (dots > 0.01f) {
            auto columns = range(-fx, fx, origin.x, major);
            auto rows = columns ? range(-down, up, origin.y, major) : std::nullopt;
            if (columns && rows) {
                float arm = 0.016f;
                for (int j = rows->lo; j <= rows->hi; j++) {
                    for (int i = columns->lo; i <= columns->hi; i++) {
                        Vec2 at(origin.x + float(i) * major, origin.y + float(j) * major);
                        float a = (0.32f + 0.3f * lines) * dots * stage.inside(at);
                        if (!(a > 0.01f)) continue;
                        ribbon({Point{at - Vec2(arm, 0), a}, Point{at + Vec2(arm, 0), a}}, true, 0.0013f);
                        ribbon({Point{at - Vec2(0, arm), a}, Point{at + Vec2(0, arm), a}}, false, 0.0013f);
                    }
                }
            }
        }
    }
    int vertexCount = nv, indexCount = ni;
    mesh->withUnsafeMutableBytes<LinkVertex>([&](LinkVertex* to, int) {
        if (!to || !(vertexCount > 0)) return;
        std::memcpy(static_cast<void*>(to), v, size_t(vertexCount) * sizeof(LinkVertex));
    });
    mesh->withUnsafeMutableIndices([&](uint32_t* to, int) {
        if (!to || !(indexCount > 0)) return;
        std::memcpy(to, indices, size_t(indexCount) * sizeof(uint32_t));
    });
    drawn = ni;
    mesh->setPart(ni, bounds);
}

std::shared_ptr<PaneMesh> PaneMesh::make(const std::optional<Material>& material, bool near, const Stage& stage) {
    if (!material) return nullptr;
    Vec3 middle = stage.origin + stage.f * (near ? 0.4f : 5.5f);
    BoundingBox bounds{middle - Vec3::repeating(14), middle + Vec3::repeating(14)};
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
    std::shared_ptr<PaneMesh> panes(new PaneMesh());
    panes->bounds = bounds;
    panes->mesh = mesh;
    mesh->setPart(0, bounds);
    panes->entity = Entity::make(mesh, {*material});
    return panes;
}

std::vector<Vec2> PaneMesh::outline(const std::vector<Vec2>& points, float radius) {
    std::vector<Vec2> sorted = points;
    std::stable_sort(sorted.begin(), sorted.end(), [](Vec2 a, Vec2 b) { return a.x != b.x ? a.x < b.x : a.y < b.y; });
    if (sorted.empty()) return {};
    Vec2 first = sorted.front();
    auto turn = [](Vec2 o, Vec2 a, Vec2 b) { return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x); };
    std::vector<Vec2> lower, upper;
    for (Vec2 p : sorted) {
        while (lower.size() > 1 && turn(lower[lower.size() - 2], lower[lower.size() - 1], p) <= 0) lower.pop_back();
        lower.push_back(p);
    }
    for (auto it = sorted.rbegin(); it != sorted.rend(); ++it) {
        Vec2 p = *it;
        while (upper.size() > 1 && turn(upper[upper.size() - 2], upper[upper.size() - 1], p) <= 0) upper.pop_back();
        upper.push_back(p);
    }
    std::vector<Vec2> hull;
    hull.insert(hull.end(), lower.begin(), lower.end() - 1);
    hull.insert(hull.end(), upper.begin(), upper.end() - 1);
    if (hull.empty()) hull = {first};

    // Round every corner.
    std::vector<Vec2> round;
    if (hull.size() == 1) {
        for (int k = 0; k < 32; k++) {
            float a = float(k) * 2 * float(M_PI) / 32;
            round.push_back(hull[0] + Vec2(std::cos(a), std::sin(a)) * radius);
        }
    } else {
        for (size_t i = 0; i < hull.size(); i++) {
            Vec2 a = hull[(i + hull.size() - 1) % hull.size()], b = hull[i], c = hull[(i + 1) % hull.size()];
            float from = std::atan2(b.y - a.y, b.x - a.x) - float(M_PI) / 2;
            float sweep = std::atan2(c.y - b.y, c.x - b.x) - float(M_PI) / 2 - from;
            while (sweep < 0) sweep += 2 * float(M_PI);
            while (sweep > 2 * float(M_PI)) sweep -= 2 * float(M_PI);
            int steps = std::max(1, int(std::ceil(sweep / 0.2f)));
            for (int k = 0; k <= steps; k++) {
                float t = from + sweep * float(k) / float(steps);
                round.push_back(b + Vec2(std::cos(t), std::sin(t)) * radius);
            }
        }
    }

    // In even steps along it: a long straight stretch needs points too, to follow a curved sheet.
    std::vector<float> lengths;
    float total = 0;
    for (size_t i = 0; i < round.size(); i++) {
        float d = distance(round[i], round[(i + 1) % round.size()]);
        lengths.push_back(d);
        total += d;
    }
    if (!(total > 1e-5f)) return {};
    int count = std::min(120, std::max(24, int(std::round(total / 0.035f))));
    std::vector<Vec2> even;
    even.reserve(size_t(count));
    int segment = 0;
    float past = 0;
    for (int i = 0; i < count; i++) {
        float want = total * float(i) / float(count);
        while (segment < int(round.size()) - 1 && past + lengths[segment] < want) {
            past += lengths[segment];
            segment += 1;
        }
        float u = lengths[segment] > 1e-9f ? (want - past) / lengths[segment] : 0;
        even.push_back(round[segment] + (round[(size_t(segment) + 1) % round.size()] - round[segment]) * u);
    }
    for (int pass = 0; pass < 5; pass++) {
        std::vector<Vec2> eased = even;
        for (int i = 0; i < count; i++) {
            eased[i] = even[i] / 2 + (even[(i + count - 1) % count] + even[(i + 1) % count]) / 4;
        }
        even = eased;
    }
    return even;
}

void PaneMesh::draw(const std::vector<Pane>& panes) {
    if (panes.empty()) {
        if (drawn == 0) return;
        drawn = 0;
        mesh->setPart(0, bounds);
        return;
    }
    int nv = 0, ni = 0;
    LinkVertex* v = vertices.get();
    uint32_t* indices = this->indices.get();
    auto put = [&](Vec3 p, Vec3 c, float a) {
        v[nv] = LinkVertex{p, Vec2(c.x, c.y), Vec2(c.z, a)};
        nv += 1;
    };
    for (const Pane& pane : panes) {
        int n = int(pane.outline.size());
        if (!(n >= 3)) continue;
        Vec2 middle = Vec2::zero();
        for (Vec2 q : pane.outline) middle += q;
        middle /= float(n);
        float reach = 0;
        for (Vec2 q : pane.outline) reach = std::max(reach, distance(q, middle));
        // The sheet curves, and a flat piece stretched across it would cut in front of the
        // cards: the glass is laid in rings from its middle out, each no wider than a hand,
        // so every part of it lies on the sheet.
        int rings = std::min(14, std::max(2, int(std::ceil(reach / 0.09f))));
        if (!(nv + 1 + n * rings + 2 * n <= vertexCapacity && ni + 3 * n + 6 * n * (rings - 1) + 6 * n <= indexCapacity)) continue;
        // A little clearer in the middle than toward its edge.
        uint32_t center = uint32_t(nv);
        put(pane.sheet.at(middle, pane.lift).position, pane.color, 0.11f * pane.strength);
        for (int r = 1; r <= rings; r++) {
            float t = float(r) / float(rings);
            for (Vec2 q : pane.outline) put(pane.sheet.at(middle + (q - middle) * t, pane.lift).position, pane.color, (0.11f + 0.09f * t) * pane.strength);
        }
        for (int k = 0; k < n; k++) {
            indices[ni] = center;
            indices[ni + 1] = center + 1 + uint32_t(k);
            indices[ni + 2] = center + 1 + uint32_t((k + 1) % n);
            ni += 3;
        }
        for (int r = 0; r < rings - 1; r++) {
            uint32_t inner = center + 1 + uint32_t(r * n), outer = inner + uint32_t(n);
            for (int k = 0; k < n; k++) {
                uint32_t a = uint32_t(k), b = uint32_t((k + 1) % n);
                indices[ni] = inner + a; indices[ni + 1] = outer + a; indices[ni + 2] = outer + b;
                indices[ni + 3] = inner + a; indices[ni + 4] = outer + b; indices[ni + 5] = inner + b;
                ni += 6;
            }
        }
        // Its rim: a fine bright line along the edge.
        uint32_t rim = uint32_t(nv);
        for (int k = 0; k < n; k++) {
            Vec2 before = pane.outline[(k + n - 1) % n], after = pane.outline[(k + 1) % n];
            Vec2 along = after - before;
            along = length(along) > 1e-6f ? normalize(along) : Vec2(1, 0);
            Vec2 out = Vec2(along.y, -along.x) * 0.0035f;
            Stage::Spot spot = pane.sheet.at(pane.outline[k], pane.lift);
            put(spot.position, pane.color, 0.6f * pane.strength);
            put(spot.position + spot.right * out.x + spot.up * out.y, pane.color, 0.6f * pane.strength);
        }
        for (int k = 0; k < n; k++) {
            uint32_t a = rim + uint32_t(2 * k), b = rim + uint32_t(2 * ((k + 1) % n));
            indices[ni] = a; indices[ni + 1] = a + 1; indices[ni + 2] = b;
            indices[ni + 3] = a + 1; indices[ni + 4] = b + 1; indices[ni + 5] = b;
            ni += 6;
        }
    }
    int vertexCount = nv, indexCount = ni;
    mesh->withUnsafeMutableBytes<LinkVertex>([&](LinkVertex* to, int) {
        if (!to || !(vertexCount > 0)) return;
        std::memcpy(static_cast<void*>(to), v, size_t(vertexCount) * sizeof(LinkVertex));
    });
    mesh->withUnsafeMutableIndices([&](uint32_t* to, int) {
        if (!to || !(indexCount > 0)) return;
        std::memcpy(to, indices, size_t(indexCount) * sizeof(uint32_t));
    });
    drawn = ni;
    mesh->setPart(ni, bounds);
}
