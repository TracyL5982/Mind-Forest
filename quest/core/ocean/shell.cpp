// Port of visionos/MindPalace/Ocean/Shell.swift.
#include "shell.h"

#include <cstddef>
#include <numeric>

Shell::Shell(const Stage& stage, const std::shared_ptr<Art>& art, const std::vector<Clip>& clips, const std::vector<Work>& works,
             const std::optional<Material>& material)
    : material(material), stage(stage) {
    if (this->material) this->material->setParameter("Center", stage.origin);
    buildDust(stage);
    buildPieces(stage, art, clips, works);
}

void Shell::setShift(float value) {
    if (!(std::fabs(value - shift) > 1e-4f)) return;
    shift = value;
    if (material && dustEntity) {
        Material m = *material;
        m.setParameter("Shift", value);
        material = m;
        if (dustEntity->model) dustEntity->model->materials = {m};
    }
    for (size_t i = 0; i < specks.size(); i++) {
        homes[i] = place(int(i));
        specks[i]->position = homes[i];
    }
}

Vec3 Shell::place(int i) const {
    Vec3 radial = rest[i] - stage.origin;
    Vec3 side = cross(Vec3(0, 1, 0), radial);
    side = length(side) > 1e-5f ? normalize(side) : stage.r;
    float slide = std::sin(seeds[i] + shift * 2.6f) - std::sin(seeds[i]);
    float lift = std::sin(seeds[i] * 1.7f + shift * 2.1f) - std::sin(seeds[i] * 1.7f);
    return rest[i] + (side * slide + Vec3(0, 0.3f, 0) * lift) * filmReach;
}

void Shell::buildDust(const Stage& stage) {
    SeededRandom random(0x0CEA2026);
    std::vector<LinkVertex> vertices;
    vertices.reserve(size_t(dust) * 4);
    float radians = float(M_PI) / 180;
    while (int(vertices.size()) < dust * 4) {
        float az = (random.next() * 2 - 1) * 150;
        // Even in how far down you look to see it, so the far ocean isn't one bright line.
        float down = 5.5f + random.next() * 46;
        float dist = stage.drop / std::tan(down * radians);
        // Thinner toward the sides and right at your feet, and in loose drifts rather than evenly.
        float sides = 1 - smoothstep(95, 150, std::fabs(az));
        float feet = 1 - smoothstep(38, 52, down);
        float phaseA = az * 0.09f + 1.3f;
        float phaseB = dist * 1.1f + az * 0.035f;
        float wave = std::sin(phaseA) * std::sin(phaseB);
        float drift = 0.55f + 0.45f * wave;
        if (!(random.next() < sides * feet * drift)) continue;
        float far = farther(dist);
        float rise = (random.next() - 0.5f) * 0.05f;
        Vec3 p = stage.ocean(az, dist) + Vec3(0, rise, 0);
        float roll = random.next();
        float size = (0.008f + 0.018f * roll * roll * roll) * far;
        Quat q = stage.facing(p);
        Vec3 x = q.act(Vec3(size / 2, 0, 0));
        Vec3 y = q.act(Vec3(0, size / 2, 0));
        // Its place in the swell (which runs toward you, a little slanted), and its seed.
        float across = dist * std::sin(az * radians);
        float ahead = dist * std::cos(az * radians);
        float jitter = (random.next() - 0.5f) * 0.5f;
        float place = ahead * 2.1f + across * 0.8f + jitter;
        float seed = random.next() * 6.2832f;
        float lift = (0.022f + 0.04f * random.next()) * std::sqrt(far);
        float sign = random.next() < 0.5f ? -1 : 1;
        float reach = (0.07f + 0.13f * random.next()) * sign * far;
        const Vec3 corners[] = {p - x - y, p + x - y, p + x + y, p - x + y};
        for (Vec3 corner : corners) {
            vertices.push_back(LinkVertex{corner, Vec2(place, seed), Vec2(lift, reach)});
        }
    }
    if (!material) {
        // No material: still dust, standing still.
        std::vector<Vec3> positions;
        positions.reserve(vertices.size());
        for (const LinkVertex& v : vertices) positions.push_back(v.position);
        std::vector<uint32_t> index;
        for (uint32_t q = 0; q < uint32_t(dust); q++) {
            uint32_t v = q * 4;
            index.insert(index.end(), {v, v + 1, v + 2, v, v + 2, v + 3});
        }
        if (MeshRef mesh = Mesh::generate(positions, {}, index)) {
            Material m = Material::unlit(Color::hex(0xF4F1EA));
            m.transparent = true;
            m.opacity = 0.7f;
            root->addChild(Entity::make(mesh, {m}));
        }
        return;
    }
    LowLevelMesh::Descriptor d;
    d.vertexCapacity = int(vertices.size());
    d.indexCapacity = dust * 6;
    d.vertexAttributes = {
        {LowLevelMesh::Semantic::position, 3, offsetof(LinkVertex, position)},
        {LowLevelMesh::Semantic::uv0, 2, offsetof(LinkVertex, rg)},
        {LowLevelMesh::Semantic::uv1, 2, offsetof(LinkVertex, ba)},
    };
    d.stride = sizeof(LinkVertex);
    // (d.indexType = .uint32: a LowLevelMesh's indices are always 32-bit here.)
    LowLevelMeshRef mesh = LowLevelMesh::make(d);
    if (!mesh) return;
    mesh->withUnsafeMutableBytes<LinkVertex>([&](LinkVertex* v, int) {
        for (size_t i = 0; i < vertices.size(); i++) v[i] = vertices[i];
    });
    mesh->withUnsafeMutableIndices([&](uint32_t* idx, int) {
        for (int q = 0; q < dust; q++) {
            uint32_t v = uint32_t(q * 4);
            int i = q * 6;
            idx[i] = v; idx[i + 1] = v + 1; idx[i + 2] = v + 2;
            idx[i + 3] = v; idx[i + 4] = v + 2; idx[i + 5] = v + 3;
        }
    });
    // Wide bounds: the specks move in the shader, and must never be culled for it.
    Vec3 o = stage.origin;
    mesh->setPart(dust * 6, BoundingBox{o - Vec3::repeating(14), o + Vec3::repeating(14)});
    EntityRef e = Entity::make(mesh, {*material});
    root->addChild(e);
    dustEntity = e;
}

void Shell::buildPieces(const Stage& stage, const std::shared_ptr<Art>& art, const std::vector<Clip>& clips, const std::vector<Work>& works) {
    int count = int(clips.size() + works.size());
    std::vector<int> years;
    years.reserve(size_t(count));
    for (const Clip& clip : clips) years.push_back(clip.year);
    for (const Work& work : works) years.push_back(work.year);
    std::vector<int> order(static_cast<size_t>(count));
    std::iota(order.begin(), order.end(), 0);
    std::stable_sort(order.begin(), order.end(), [&](int a, int b) { return years[a] != years[b] ? years[a] < years[b] : a < b; });
    bool crowd = count > 160;
    float reach = crowd ? 112 : 74;             // degrees to each side
    float farthest = crowd ? 6.5f : 10;         // degrees down to the farthest
    float apart = crowd ? 2.35f : 5.2f;         // degrees kept between two
    // Each piece's place as you see it: degrees right of ahead, and degrees down.
    std::vector<Vec2> spots(static_cast<size_t>(count), Vec2::zero());
    auto nearest = [](float az) -> float { return std::fabs(az) < 24 ? 17 : 30; };
    for (int rank = 0; rank < count; rank++) {
        int i = order[rank];
        float t = (float(rank) + 0.5f) / float(count);
        // The golden ratio spreads them so neighbors in time never line up.
        float h = std::fmod(float(rank) * 0.618034f, 1.f);
        float az = -reach + 2 * reach * t;
        spots[i] = {az, farthest + (nearest(az) - farthest) * h};
    }
    // Ease apart any two that still sit close.
    float floor = farthest - 0.5f;
    for (int pass = 0; pass < 40; pass++) {
        for (int a = 0; a < count; a++) {
            for (int b = a + 1; b < count; b++) {
                Vec2 d = spots[b] - spots[a];
                if (!(std::fabs(d.x) < apart && std::fabs(d.y) < apart)) continue;
                float l = length(d);
                if (l < apart && l > 1e-4f) {
                    Vec2 push = d / l * (apart - l) * 0.5f;
                    spots[a] -= push;
                    spots[b] += push;
                }
            }
            spots[a].y = std::min(nearest(spots[a].x), std::max(floor, spots[a].y));
            if (crowd) spots[a].x = std::min(reach + 5, std::max(-reach - 5, spots[a].x));
        }
    }
    float area = speckWidth * 0.052f;
    for (int i = 0; i < count; i++) {
        float dist = stage.drop / std::tan(spots[i].y * float(M_PI) / 180);
        float far = farther(dist);
        EntityRef e = Entity::make(), face = Entity::make();
        Vec2 size;
        if (i < int(clips.size())) {
            size = Metrics::film(speckWidth, 0.06f, clips[i].aspect) * far;
            if (MeshRef mesh = art->stillMesh(clips[i], size)) face->model = ModelComponent{mesh, {art->atlasMaterial()}};
        } else {
            // Works come in every shape: each takes the same room on the water.
            const Work& work = works[size_t(i) - clips.size()];
            size = Metrics::work(area, work.aspect, 0.1f, 0.085f) * far;
            if (MeshRef mesh = art->workMesh(work, size)) {
                if (std::optional<Material> m = art->workAtlasMaterial()) face->model = ModelComponent{mesh, {*m}};
            }
        }
        // Standing on the water, not half under it. Its picture is a child of what is picked,
        // so that it can change size while the room to pick it in stays as it is.
        Vec3 p = stage.ocean(spots[i].x, dist) + Vec3(0, size.y * small() / 2 + 0.01f, 0);
        e->position = p;
        e->orientation = stage.facing(p);
        face->scale = Vec3::repeating(small());
        e->addChild(face);
        faces.push_back(face);
        full.push_back(size);
        ups.push_back(e->orientation.act(Vec3(0, 1, 0)));
        grown.push_back(small());
        // Easier to pick than it is to see, as far as its neighbors leave room.
        Vec3 box = crowd ? Vec3(0.15f * far, 0.14f * far, 0.02f) : Vec3(0.2f * far, 0.16f * far, 0.02f);
        e->collision = {Shape::generateBox(box)};
        e->inputTarget = true;
        e->hover = Art::hover();
        root->addChild(e);
        specks.push_back(e);
        homes.push_back(p);
        rest.push_back(p);
        seeds.push_back(float(i) * 2.399f + 0.7f);
    }
}

void Shell::look(Vec3 eye, std::optional<Vec3> forward, float dt) {
    if (forward) {
        if (!aim) {
            aim = *forward;
            stirring = 1;
            return;
        }
        Vec3 a = *aim;
        float between = std::acos(std::min(1.f, std::max(-1.f, dot(a, *forward))));
        if (between > 0.0003f) {
            // The middle trails the head, and never sweeps fast.
            float step = std::min(between * (1 - std::exp(-trail * dt)), sweep * float(M_PI) / 180 * dt);
            a = normalize(a + (*forward - a) * (step / between));
            aim = a;
            stirring = std::max(stirring, 1);
        }
    } else if (aim) {
        aim.reset();
        stirring = 1;
    }
    if (!(stirring > 0)) return;
    // (The launch flags, read once for the loop below.)
    const float small = Shell::small(), large = Shell::large();
    float half = cone() / 2 * float(M_PI) / 180;
    float edge = std::cos(half), k = 1 - std::exp(-ease() * dt);
    int moving = 0;
    for (size_t i = 0; i < faces.size(); i++) {
        float target = small;
        if (aim) {
            Vec3 to = homes[i] - eye;
            float along = dot(to, *aim);
            // Outside the cone and at rest: nothing to do. (Most pieces, most of the time.)
            if (along * along < edge * edge * length_squared(to) || along <= 0) {
                if (grown[i] == small) continue;
            } else {
                float angle = std::acos(std::min(1.f, along / length(to)));
                target += (large - small) * (1 - smoothstep(half * core, half, angle));
            }
        }
        float g = grown[i] + (target - grown[i]) * k;
        if (std::fabs(target - g) < 0.004f) g = target; else moving += 1;
        if (!(g != grown[i])) continue;
        grown[i] = g;
        faces[i]->setTransform(Transform{Vec3::repeating(g), Quat(), Vec3(0, (g - small) * full[i].y / 2, 0)});
    }
    stirring = moving;
}

void Shell::setOut(int film, bool isOut) {
    if (!(isOut != (out.count(film) > 0))) return;
    if (isOut) out.insert(film); else out.erase(film);
    specks[film]->opacity = isOut ? 0.22f : 1;
}

std::optional<int> Shell::film(const EntityRef& entity) const {
    for (size_t i = 0; i < specks.size(); i++) {
        if (specks[i] == entity) return int(i);
    }
    return std::nullopt;
}
