// Port of visionos/MindPalace/Ocean/Bend.swift.
#include "bend.h"

#include <cstddef>
#include <limits>

namespace {
/// Swift's `defer`: runs `body` when the scope it stands in is left.
template <class F>
struct Deferred {
    F body;
    ~Deferred() { body(); }
};
template <class F>
Deferred(F) -> Deferred<F>;
}  // namespace

Bend::Mark Bend::mark(const std::vector<Shape>& shapes) {
    if (shapes.empty()) return {};
    BoundingBox first = shapes.front().bounds(), last = shapes.back().bounds();
    return {float(shapes.size()), first.min.x, first.min.y, first.min.z, first.max.x, first.max.z, last.max.x, last.max.y, last.max.z};
}

void Bend::update(const EntityRef& root, float curve, bool moved) {
    curve = curve > 1e-4f ? curve : 0;
    if (curve == 0 && parts.empty() && solids.empty()) return;
    bool settled = curve == lastCurve;
    if (curve == 0 && settled && rested && !moved) return;
    double began = mediaTime();
    Deferred timed{[&] {
        double took = mediaTime() - began;
        spent += took;
        worst = std::max(worst, took);
    }};
    lastCurve = curve;
    frame += 1;
    // Shapes, and the last small step of a bend, wait until nothing is changing.
    bool still = settled && !moved;
    if (!still) finished = false;
    if (!(moved || stale || showing.empty() || frame % 6 == 0 || (still && !finished))) {
        if (!settled) {
            for (const std::shared_ptr<Part>& part : showing) place(*part, curve, false);
        }
        return;
    }
    stale = false;
    showing.clear();        // removeAll(keepingCapacity: true)
    auto visit = [&](auto&& visit, const EntityRef& e) -> void {
        for (const EntityRef& child : e->children) {
            if (!child->isEnabled) continue;
            if (showsShapes() && child->name == shapesName) continue;
            // (`child as? ModelEntity`, with a mesh.)
            if (child->model && child->model->mesh) {
                if (std::shared_ptr<Part> part = draw(child, child->model->mesh, root, curve, still)) showing.push_back(part);
            }
            if (still) shape(child, root, curve);
            visit(visit, child);
        }
    };
    if (still) shape(root, root, curve);
    visit(visit, root);
    finished = still;
    rested = still && curve == 0;
    // What is gone from the card for good. (A face that is only hidden keeps its pieces: they are bent when it shows again.)
    if (frame % 64 == 0) {
        std::erase_if(parts, [](const auto& entry) { return entry.second->entity.expired(); });
        std::erase_if(solids, [](const auto& entry) { return entry.second->entity.expired(); });
    }
}

void Bend::forget(const EntityRef& e) {
    parts.erase(e.get());
    stale = true;
}

// MARK: - What is drawn

std::shared_ptr<Bend::Part> Bend::draw(const EntityRef& e, const MeshRef& mesh, const EntityRef& root, float curve, bool exactly) {
    const Entity* key = e.get();
    std::shared_ptr<Part> part;
    if (auto it = parts.find(key); it != parts.end()) part = it->second;
    // A flat card's new piece needs nothing done.
    if (!part && curve == 0) return nullptr;
    Mat4 matrix = e->transformMatrix(root);
    if (!part || part->shown != mesh || part->entity.lock() != e) {
        // New here, or given a new flat mesh since.
        parts.erase(key);
        if (!(curve > 0)) return nullptr;
        part = std::make_shared<Part>();
        part->entity = e;
        part->flat = mesh;
        parts[key] = part;
    }
    if (part->matrix != matrix || part->across.empty()) {
        // Its columns grow with it about the card's middle (a face opening), and it is cut again only when they move in it.
        float stretch = std::fabs(matrix.columns[0].x) > 1e-6f ? matrix.columns[0].x : 1;
        std::array<float, 3> lines{matrix.columns[1].x / stretch, matrix.columns[2].x / stretch, matrix.columns[3].x / stretch};
        bool moved = false;
        for (size_t i = 0; i < lines.size(); i++) moved = moved || std::fabs(lines[i] - part->lines[i]) > 1e-6f;
        part->width = width(matrix);
        if (part->across.empty() || moved) {
            std::optional<Cut> cut = Bend::cut(part->flat, matrix, part->width);
            if (!cut) {
                parts.erase(key);
                return nullptr;
            }
            part->lines = lines;
            part->points = std::move(cut->points);
            part->uvs = std::move(cut->uvs);
            bool video = e->model && !e->model->materials.empty() && e->model->materials.front().kind == Material::Kind::video;
            if (!video) part->low = lowMesh(part->uvs);
            part->shown = nullptr;
        }
        part->matrix = matrix;
        part->across.resize(part->points.size());
        for (size_t i = 0; i < part->points.size(); i++) {
            Vec4 p = matrix * Vec4(part->points[i], 1);
            part->across[i] = {p.x, p.y, p.z};
        }
        Mat4 m = matrix.inverse();
        part->back = Mat3({m.columns[0].x, m.columns[0].y, m.columns[0].z}, {m.columns[1].x, m.columns[1].y, m.columns[1].z},
                          {m.columns[2].x, m.columns[2].y, m.columns[2].z});
        part->curve = -1;
    }
    place(*part, curve, exactly);
    return part;
}

void Bend::place(Part& part, float curve, bool exactly) {
    if (!(part.curve != curve)) return;
    EntityRef e = part.entity.lock();
    if (!e) return;
    if (!exactly && part.curve >= 0 && std::fabs(part.curve - curve) < 0.003f * std::max(part.curve, curve)) return;
    part.curve = curve;
    int count = int(part.points.size());
    if (LowLevelMesh* low = part.low.get()) {
        low->withUnsafeMutableBytes<Vertex>([&](Vertex* v, int) {
            for (int i = 0; i < count; i++) {
                Vec3 p = part.across[i];
                v[i].position = part.points[i] + part.back * (drawn(p, curve, part.width) - p);
            }
        });
        if (!part.shown) {
            // Its bounds stay those of the flat piece: what is see-through is drawn in the order
            // of its bounds, and that order (threads, then a card's glow) must not change with the bend.
            Vec3 lo = Vec3::repeating(std::numeric_limits<float>::infinity()), hi = Vec3::repeating(-std::numeric_limits<float>::infinity());
            for (Vec3 q : part.points) {
                lo = vmin(lo, q);
                hi = vmax(hi, q);
            }
            low->setPart(count, BoundingBox{lo - Vec3::repeating(0.001f), hi + Vec3::repeating(0.001f)});
        }
        if (!part.shown) {
            // (MeshResource(from: low) is the LowLevelMesh itself.)
            part.shown = part.low;
            if (e->model) e->model->mesh = part.low;
        }
    } else {
        // The video: an ordinary mesh, made again.
        std::vector<Vec3> positions(static_cast<size_t>(count));
        for (int i = 0; i < count; i++) {
            Vec3 p = part.across[i];
            positions[i] = part.points[i] + part.back * (drawn(p, curve, part.width) - p);
        }
        std::vector<uint32_t> indices(static_cast<size_t>(count));
        for (int i = 0; i < count; i++) indices[i] = uint32_t(i);
        MeshRef resource = Mesh::generate(std::move(positions), part.uvs, std::move(indices));
        if (!resource) return;
        part.shown = resource;
        if (e->model) e->model->mesh = resource;
    }
}

LowLevelMeshRef Bend::lowMesh(const std::vector<Vec2>& uvs) {
    LowLevelMesh::Descriptor d;
    d.vertexCapacity = int(uvs.size());
    d.indexCapacity = int(uvs.size());
    d.vertexAttributes = {
        {LowLevelMesh::Semantic::position, 3, offsetof(Vertex, position)},
        {LowLevelMesh::Semantic::uv0, 2, offsetof(Vertex, uv)},
    };
    d.stride = sizeof(Vertex);
    // (d.indexType = .uint32: a LowLevelMesh's indices are always 32-bit here.)
    LowLevelMeshRef mesh = LowLevelMesh::make(d);
    if (!mesh) return nullptr;
    mesh->withUnsafeMutableBytes<Vertex>([&](Vertex* v, int) {
        for (size_t i = 0; i < uvs.size(); i++) v[i] = Vertex{Vec3::zero(), uvs[i]};
    });
    mesh->withUnsafeMutableIndices([&](uint32_t* index, int) {
        for (size_t i = 0; i < uvs.size(); i++) index[i] = uint32_t(i);
    });
    return mesh;
}

std::optional<Bend::Cut> Bend::cut(const MeshRef& mesh, const Mat4& matrix, float width) {
    struct Corner {
        Vec3 p;
        Vec2 t;
        float x;            // across the card
    };
    std::vector<Vec3> points;
    std::vector<Vec2> uvs;
    // NOTE(port): the Swift reads the mesh back through `mesh.contents`: every part of every
    // model, once for each instance with that instance's transform. A Mesh here keeps what it was
    // made from as one model of one part with no instance transform (its `positions`, `uvs` and
    // `indices`), so `take` is called once, on the mesh itself. A LowLevelMesh keeps none, and
    // nothing is taken from it, as on visionOS.
    auto take = [&](const Mesh& part, const Mat4& within) {
        const std::vector<Vec3>& positions = part.positions;
        const std::vector<uint32_t>& index = part.indices;
        if (positions.empty()) return;
        const std::vector<Vec2>& coordinates = part.uvs;
        Mat4 across = matrix * within;
        auto corner = [&](uint32_t i) -> Corner {
            int k = int(i);
            Vec4 p4 = within * Vec4(positions[k], 1);
            Vec3 p(p4.x, p4.y, p4.z);
            return Corner{p, k < int(coordinates.size()) ? coordinates[k] : Vec2::zero(), (across * Vec4(positions[k], 1)).x};
        };
        auto keep = [](const std::vector<Corner>& poly, float edge, bool above) -> std::vector<Corner> {
            std::vector<Corner> out;
            for (size_t i = 0; i < poly.size(); i++) {
                const Corner &a = poly[i], &b = poly[(i + 1) % poly.size()];
                bool ina = above ? a.x >= edge : a.x <= edge, inb = above ? b.x >= edge : b.x <= edge;
                if (ina) out.push_back(a);
                if (ina != inb && std::fabs(b.x - a.x) > 1e-9f) {
                    float u = (edge - a.x) / (b.x - a.x);
                    out.push_back(Corner{a.p + (b.p - a.p) * u, a.t + (b.t - a.t) * u, edge});
                }
            }
            return out;
        };
        size_t k = 0;
        while (k + 2 < index.size()) {
            const Corner triangle[3] = {corner(index[k]), corner(index[k + 1]), corner(index[k + 2])};
            k += 3;
            float least = std::min(triangle[0].x, std::min(triangle[1].x, triangle[2].x));
            float most = std::max(triangle[0].x, std::max(triangle[1].x, triangle[2].x));
            int first = int(std::floor(least / width)), last = int(std::floor(most / width));
            if (!(last - first < 600)) continue;
            for (int strip = first; strip <= last; strip++) {
                std::vector<Corner> poly(std::begin(triangle), std::end(triangle));
                if (first != last) {
                    poly = keep(keep(poly, float(strip) * width, true), float(strip + 1) * width, false);
                }
                if (!(poly.size() >= 3)) continue;
                for (size_t j = 1; j < poly.size() - 1; j++) {
                    for (const Corner& c : {poly[0], poly[j], poly[j + 1]}) {
                        points.push_back(c.p);
                        uvs.push_back(c.t);
                    }
                }
            }
        }
    };
    take(*mesh, Mat4::identity());
    if (points.empty()) return std::nullopt;
    return Cut{std::move(points), std::move(uvs)};
}

// MARK: - What a look or a pinch lands on

void Bend::shape(const EntityRef& e, const EntityRef& root, float curve) {
    // (An entity without a CollisionComponent has no shapes.)
    if (e->collision.empty()) return;
    const Entity* key = e.get();
    Mat4 matrix = e == root ? Mat4::identity() : e->transformMatrix(root);
    std::shared_ptr<Solid> solid;
    if (auto it = solids.find(key); it != solids.end()) solid = it->second;
    if (!solid || solid->shown != mark(e->collision)) {
        // New here, or given new flat shapes since.
        solids.erase(key);
        if (!(curve > 0)) return;
        auto s = std::make_shared<Solid>();
        s->entity = e;
        s->flat = e->collision;
        s->shown = mark(e->collision);
        s->matrix = matrix;
        solids[key] = s;
        solid = s;
    }
    // (Shapes take far longer to make than a mesh takes to move, and nothing is picked on a
    // card while it is still growing: this is only called once the bend has come to rest.)
    if (!(solid->curve != curve || solid->matrix != matrix)) return;
    solid->curve = curve;
    solid->matrix = matrix;
    float scale = length(Vec3(matrix.columns[0].x, matrix.columns[0].y, matrix.columns[0].z));
    bool turned = std::fabs(matrix.columns[0].y) + std::fabs(matrix.columns[0].z) > 1e-4f * scale;
    std::vector<Shape> shapes;
    if (curve == 0 || turned || scale < 1e-6f) {
        shapes = solid->flat;
    } else {
        Mat4 inverse = matrix.inverse();
        for (const Shape& s : solid->flat) {
            BoundingBox b = s.bounds();
            Vec3 size = b.max - b.min, middle = (b.max + b.min) / 2;
            // In slabs, each turned to the arc where it stands.
            int count = std::max(1, std::min(16, int(std::ceil(size.x * scale * curve / 0.16f))));
            for (int i = 0; i < count; i++) {
                float x = b.min.x + size.x * (float(i) + 0.5f) / float(count);
                Vec4 p = matrix * Vec4(x, middle.y, middle.z, 1);
                Vec4 at = inverse * Vec4(bent({p.x, p.y, p.z}, curve), 1);
                shapes.push_back(Shape::generateBox({size.x / float(count) * 1.03f, size.y, std::max(size.z, 0.002f)})
                                     .offsetBy(Quat::angleAxis(-p.x * curve, {0, 1, 0}), {at.x, at.y, at.z}));
            }
        }
    }
    solid->shown = mark(shapes);
    e->collision = shapes;
    if (showsShapes()) show(shapes, e);
}

void Bend::show(const std::vector<Shape>& shapes, const EntityRef& e) {
    EntityRef old;
    for (const EntityRef& child : e->children) {
        if (child->name == shapesName) {
            old = child;
            break;
        }
    }
    if (old) old->removeFromParent();
    EntityRef holder = Entity::make();
    holder->name = shapesName;
    Material m = Material::unlit(Color(1, 0, 0));       // UIColor.red
    m.transparent = true;
    m.opacity = 0.35f;
    for (const Shape& s : shapes) {
        // A turned box's bounds are wider than the box: drawn as a thin slab across its middle.
        BoundingBox b = s.bounds();
        EntityRef box = Entity::make(Mesh::generateBox({0.004f, b.max.y - b.min.y, 0.004f}), {m});
        box->position = (b.max + b.min) / 2;
        holder->addChild(box);
    }
    e->addChild(holder);
}
