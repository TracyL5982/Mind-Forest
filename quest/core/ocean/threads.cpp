// The threads between cards (see threads.h).
#include "threads.h"

#include <cstddef>

std::shared_ptr<Threads> Threads::make(const std::optional<Material>& material) {
    if (!material) return nullptr;
    int quads = capacity * segments;
    LowLevelMesh::Descriptor d;
    d.vertexCapacity = quads * 4;
    d.indexCapacity = quads * 6;
    d.vertexAttributes = {
        {LowLevelMesh::Semantic::position, 3, offsetof(LinkVertex, position)},
        {LowLevelMesh::Semantic::uv0, 2, offsetof(LinkVertex, rg)},
        {LowLevelMesh::Semantic::uv1, 2, offsetof(LinkVertex, ba)},
    };
    d.stride = sizeof(LinkVertex);
    // (d.indexType = .uint32: a LowLevelMesh's indices are always 32-bit here.)
    LowLevelMeshRef mesh = LowLevelMesh::make(d);
    if (!mesh) return nullptr;
    std::shared_ptr<Threads> threads(new Threads());
    threads->mesh = mesh;
    mesh->withUnsafeMutableIndices([&](uint32_t* idx, int) {
        for (int q = 0; q < quads; q++) {
            uint32_t v = uint32_t(q * 4);
            int i = q * 6;
            idx[i] = v; idx[i + 1] = v + 1; idx[i + 2] = v + 2;
            idx[i + 3] = v + 1; idx[i + 4] = v + 3; idx[i + 5] = v + 2;
        }
    });
    mesh->setPart(0, bounds);
    threads->entity = Entity::make(mesh, {*material});
    return threads;
}

void Threads::draw(const std::vector<Thread>& threads, Vec3 eye) {
    int n = segments;
    int quads = 0;
    mesh->withUnsafeMutableBytes<LinkVertex>([&](LinkVertex* v, int) {
        size_t count = std::min(threads.size(), size_t(capacity));      // threads.prefix(Self.capacity)
        for (size_t index = 0; index < count; index++) {
            const Thread& t = threads[index];
            Vec3 span = t.b - t.a;
            float len = length(span);
            if (!(len > 1e-3f)) continue;
            // Bowed to one side, across the line of sight.
            Vec3 control = Threads::control(t, eye);
            auto point = [&](float u) -> Vec3 {
                float w = 1 - u;
                return t.a * (w * w) + control * (2 * w * u) + t.b * (u * u);
            };
            Vec3 previous = point(0);
            for (int k = 0; k < n; k++) {
                Vec3 next = point(float(k + 1) / float(n));
                // Every other piece is a gap, as open as `gap` says.
                float fill = k % 2 == 1 ? 1 - t.gap : 1;
                if (fill < 0.03f) {
                    previous = next;        // (as at the end of the loop)
                    continue;
                }
                auto edge = [&](Vec3 p) -> Vec3 {
                    Vec3 s = cross(next - previous, p - eye);
                    s = length(s) > 1e-9f ? normalize(s) : Vec3::zero();
                    return s * (0.5f * t.width * length(p - eye) / Stage::focus);
                };
                Vec3 e0 = edge(previous), e1 = edge(next);
                int base = quads * 4;
                Vec2 rg(t.color.x, t.color.y), ba(t.color.z, t.alpha * fill);
                v[base] = LinkVertex{previous + e0, rg, ba};
                v[base + 1] = LinkVertex{previous - e0, rg, ba};
                v[base + 2] = LinkVertex{next + e1, rg, ba};
                v[base + 3] = LinkVertex{next - e1, rg, ba};
                quads += 1;
                previous = next;            // (at the end of the loop)
            }
        }
    });
    if (quads != drawn) {
        drawn = quads;
        mesh->setPart(quads * 6, bounds);
    }
}

Vec3 Threads::control(const Thread& t, Vec3 eye) {
    Vec3 mid = (t.a + t.b) / 2;
    if (t.via) return *t.via * 2 - mid;
    Vec3 span = t.b - t.a;
    Vec3 side = cross(span, mid - eye);
    side = length(side) > 1e-6f ? normalize(side) : Vec3(0, 1, 0);
    return mid + side * (t.bow * length(span));
}

std::vector<Vec3> Threads::points(const Thread& t, Vec3 eye, int count) {
    Vec3 control = Threads::control(t, eye);
    std::vector<Vec3> out;
    out.reserve(size_t(count) + 1);
    for (int k = 0; k <= count; k++) {
        float u = float(k) / float(count), w = 1 - u;
        out.push_back(t.a * (w * w) + control * (2 * w * u) + t.b * (u * u));
    }
    return out;
}
