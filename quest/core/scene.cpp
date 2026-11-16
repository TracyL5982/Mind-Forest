#include "scene.h"

#include <algorithm>
#include <condition_variable>
#include <mutex>

#include "base.h"

namespace gpu {
// (Never destroyed: a texture or mesh kept in a static, such as Art::glowMaterial, is let go while the
// program exits, after a list made later than it would already be gone, and would write into freed memory.)
std::vector<unsigned>& deadTextures() {
    static std::vector<unsigned>* v = new std::vector<unsigned>;
    return *v;
}
std::vector<unsigned>& deadBuffers() {
    static std::vector<unsigned>* v = new std::vector<unsigned>;
    return *v;
}
std::vector<unsigned>& deadVertexArrays() {
    static std::vector<unsigned>* v = new std::vector<unsigned>;
    return *v;
}
}

// MARK: - Pictures still on their way

namespace {
std::mutex arrivals;
std::condition_variable arrivedSignal;
}

void Image::wait() const {
    if (ready.load()) return;
    std::unique_lock<std::mutex> lock(arrivals);
    arrivedSignal.wait(lock, [&] { return ready.load(); });
}

void Image::arrived() {
    {
        std::lock_guard<std::mutex> lock(arrivals);
        ready.store(true);
    }
    arrivedSignal.notify_all();
}

// MARK: - Textures

TextureRef Texture::make(const ImageRef& image, bool mipmaps) {
    if (!image || image->width <= 0 || image->height <= 0) return nullptr;
    auto t = std::make_shared<Texture>();
    t->width = image->width;
    t->height = image->height;
    t->mipmaps = mipmaps;
    t->pending = image;
    t->madeAt = mediaTime();
    return t;
}

Texture::~Texture() {
    // A video's frame texture belongs to its player.
    if (gl && !external) gpu::deadTextures().push_back(gl);
}

// MARK: - Meshes

static BoundingBox boundsOf(const std::vector<Vec3>& positions) {
    if (positions.empty()) return {};
    BoundingBox b{positions[0], positions[0]};
    for (const Vec3& p : positions) {
        b.min = vmin(b.min, p);
        b.max = vmax(b.max, p);
    }
    return b;
}

Mesh::~Mesh() {
    if (vao) gpu::deadVertexArrays().push_back(vao);
    if (vbo) gpu::deadBuffers().push_back(vbo);
    if (ibo) gpu::deadBuffers().push_back(ibo);
}

MeshRef Mesh::generate(std::vector<Vec3> positions, std::vector<Vec2> uvs, std::vector<uint32_t> indices) {
    auto m = std::make_shared<Mesh>();
    m->replace(std::move(positions), std::move(uvs), std::move(indices));
    return m;
}

MeshRef Mesh::generatePlane(float width, float height) {
    float x = width / 2, y = height / 2;
    return generate({{-x, -y, 0}, {x, -y, 0}, {x, y, 0}, {-x, y, 0}}, {{0, 0}, {1, 0}, {1, 1}, {0, 1}}, {0, 1, 2, 0, 2, 3});
}

MeshRef Mesh::generateBox(Vec3 size) {
    Vec3 h = size * 0.5f;
    std::vector<Vec3> positions;
    std::vector<Vec2> uvs;
    std::vector<uint32_t> indices;
    // Six faces, each its own four corners, counter-clockwise seen from outside.
    const Vec3 normals[6] = {{1, 0, 0}, {-1, 0, 0}, {0, 1, 0}, {0, -1, 0}, {0, 0, 1}, {0, 0, -1}};
    for (const Vec3& n : normals) {
        Vec3 a = std::fabs(n.y) > 0.5f ? Vec3{1, 0, 0} : Vec3{0, 1, 0};
        Vec3 b = cross(n, a);
        a = cross(b, n);
        uint32_t base = uint32_t(positions.size());
        const float corners[4][2] = {{-1, -1}, {1, -1}, {1, 1}, {-1, 1}};
        for (const auto& c : corners) {
            positions.push_back((n + b * c[0] + a * c[1]) * h);
            uvs.push_back({(c[0] + 1) / 2, (c[1] + 1) / 2});
        }
        for (uint32_t i : {0u, 1u, 2u, 0u, 2u, 3u}) indices.push_back(base + i);
    }
    return generate(std::move(positions), std::move(uvs), std::move(indices));
}

void Mesh::replace(std::vector<Vec3> p, std::vector<Vec2> t, std::vector<uint32_t> i) {
    positions = std::move(p);
    uvs = std::move(t);
    indices = std::move(i);
    uvs.resize(positions.size());
    bounds = boundsOf(positions);
    verticesDirty = true;
    indicesDirty = true;
}

LowLevelMeshRef LowLevelMesh::make(const Descriptor& d) {
    if (d.vertexCapacity < 0 || d.indexCapacity < 0 || d.stride == 0) return nullptr;
    auto m = std::make_shared<LowLevelMesh>();
    m->descriptor = d;
    m->vertexData.assign(size_t(d.vertexCapacity) * d.stride, 0);
    m->indexData.assign(size_t(d.indexCapacity), 0);
    return m;
}

// MARK: - Shapes

BoundingBox Shape::bounds() const {
    Vec3 h = size * 0.5f;
    BoundingBox b;
    bool first = true;
    for (int k = 0; k < 8; k++) {
        Vec3 c{(k & 1) ? h.x : -h.x, (k & 2) ? h.y : -h.y, (k & 4) ? h.z : -h.z};
        Vec3 p = rotation.act(c) + translation;
        if (first) {
            b = {p, p};
            first = false;
        } else {
            b.min = vmin(b.min, p);
            b.max = vmax(b.max, p);
        }
    }
    return b;
}

// MARK: - Entities

EntityRef Entity::make() { return EntityRef(new Entity()); }

EntityRef Entity::make(MeshRef mesh, std::vector<Material> materials) {
    EntityRef e = make();
    e->model = ModelComponent{std::move(mesh), std::move(materials)};
    return e;
}

Entity::~Entity() {
    for (auto& c : children) c->parent = nullptr;
}

void Entity::addChild(const EntityRef& child) {
    if (!child || child.get() == this) return;
    if (child->parent == this) return;
    EntityRef keep = child;
    if (child->parent) child->parent->removeChild(child);
    child->parent = this;
    children.push_back(keep);
}

void Entity::removeChild(const EntityRef& child) {
    auto it = std::find(children.begin(), children.end(), child);
    if (it == children.end()) return;
    (*it)->parent = nullptr;
    children.erase(it);
}

void Entity::removeFromParent() {
    if (!parent) return;
    EntityRef self = shared_from_this();
    parent->removeChild(self);
}

bool Entity::isEnabledInHierarchy() const {
    for (const Entity* e = this; e; e = e->parent) {
        if (!e->isEnabled) return false;
    }
    return true;
}

Mat4 Entity::transformMatrix(const Entity* relativeTo) const {
    Mat4 world = Mat4::trs(position, orientation, scale);
    for (const Entity* e = parent; e; e = e->parent) world = Mat4::trs(e->position, e->orientation, e->scale) * world;
    if (!relativeTo) return world;
    return relativeTo->transformMatrix(nullptr).inverse() * world;
}

Vec3 Entity::convertFrom(Vec3 p, const Entity* from) const {
    Vec3 world = from ? from->transformMatrix(nullptr).point(p) : p;
    return transformMatrix(nullptr).inverse().point(world);
}

Vec3 Entity::convertTo(Vec3 p, const Entity* to) const {
    Vec3 world = transformMatrix(nullptr).point(p);
    return to ? to->transformMatrix(nullptr).inverse().point(world) : world;
}

Vec3 Entity::positionRelativeTo(const Entity* other) const { return transformMatrix(other).position(); }

void Entity::setPosition(Vec3 p, const Entity* relativeTo) {
    Vec3 world = relativeTo ? relativeTo->transformMatrix(nullptr).point(p) : p;
    position = parent ? parent->transformMatrix(nullptr).inverse().point(world) : world;
}

static void growBounds(const Entity* e, const Mat4& parentWorld, BoundingBox& box, bool& any) {
    if (!e->isEnabled) return;
    Mat4 world = parentWorld * Mat4::trs(e->position, e->orientation, e->scale);
    if (e->model && e->model->mesh) {
        const BoundingBox& b = e->model->mesh->bounds;
        for (int k = 0; k < 8; k++) {
            Vec3 c{(k & 1) ? b.max.x : b.min.x, (k & 2) ? b.max.y : b.min.y, (k & 4) ? b.max.z : b.min.z};
            Vec3 p = world.point(c);
            if (!any) {
                box = {p, p};
                any = true;
            } else {
                box.min = vmin(box.min, p);
                box.max = vmax(box.max, p);
            }
        }
    }
    for (const auto& c : e->children) growBounds(c.get(), world, box, any);
}

BoundingBox Entity::visualBounds() const {
    BoundingBox box;
    bool any = false;
    Mat4 parentWorld = parent ? parent->transformMatrix(nullptr) : Mat4::identity();
    growBounds(this, parentWorld, box, any);
    return box;
}
