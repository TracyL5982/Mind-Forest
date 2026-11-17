// The scene graph: entities, their models and materials, and what the ocean
// asks of them. Nothing here touches OpenGL; the
// renderer (render.cpp) reads these objects and keeps its own GPU copies.
//
//   Entity (EntityRef)              a thing in the scene; its model is `entity->model`
//   ModelComponent                  a mesh and its materials
//   Mesh (MeshRef), LowLevelMesh    a mesh, and one written in place
//   Material                        unlit, the ocean's own shaders, or a film
//   Texture (TextureRef), Image (ImageRef), Color, Shape
//   entity->opacity = x, entity->opacity.reset()
//   entity->collision = s, entity->collision.clear()       what a pointer can land on
//   entity->inputTarget = true                             it takes pinches
//   entity->hover = Hover::shader() / Hover::highlight(...) / Hover::none()
#pragma once
#include <atomic>
#include <functional>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <vector>

#include "vecmath.h"

// MARK: - Color

/// UIColor: sRGB components, 0...1, not premultiplied.
struct Color {
    float r = 1, g = 1, b = 1, a = 1;
    constexpr Color() = default;
    constexpr Color(float r, float g, float b, float a = 1) : r(r), g(g), b(b), a(a) {}
    /// UIColor(hex:alpha:)
    static constexpr Color hex(uint32_t hex, float alpha = 1) {
        return {float((hex >> 16) & 0xFF) / 255, float((hex >> 8) & 0xFF) / 255, float(hex & 0xFF) / 255, alpha};
    }
    /// UIColor(white:alpha:)
    static constexpr Color white(float w = 1, float alpha = 1) { return {w, w, w, alpha}; }
    static constexpr Color black(float alpha = 1) { return {0, 0, 0, alpha}; }
    static constexpr Color clear() { return {0, 0, 0, 0}; }
    constexpr Color withAlphaComponent(float alpha) const { return {r, g, b, alpha}; }
    /// Linear RGB, for shader parameters.
    Vec3 linear() const {
        auto lin = [](float s) { return s <= 0.04045f ? s / 12.92f : std::pow((s + 0.055f) / 1.055f, 2.4f); };
        return {lin(r), lin(g), lin(b)};
    }
};

/// A number no other texture, mesh, entity or video player made in this run has: what a filming take
/// (take.h) knows each by, since an address is used again once its owner has gone.
uint32_t nextSerial();

// MARK: - Images and textures

/// A picture in memory: 8-bit RGBA, premultiplied, row 0 at the top (as
/// CGImage and Android's Bitmap give it). `scale` is pixels per point, so
/// `width / scale` is its size as a UIImage would report it.
struct Image {
    int width = 0, height = 0;
    float scale = 1;
    std::vector<uint8_t> rgba;
    Vec2 size() const { return {float(width) / scale, float(height) / scale}; }
    /// False while its pixels are still being drawn on the background thread (canvas.cpp): its size is
    /// known, `rgba` is not to be read yet. The renderer waits for it without stopping; anything else
    /// that reads the pixels calls `wait()` first.
    std::atomic<bool> ready{true};
    void wait() const;
    void arrived();
};
using ImageRef = std::shared_ptr<Image>;

/// A texture. Made from an image; the renderer uploads it on first
/// use and frees the GPU copy when the last reference goes.
class Texture {
public:
    /// From an image; `mipmaps` makes every smaller size too.
    static std::shared_ptr<Texture> make(const ImageRef& image, bool mipmaps = false);
    ~Texture();
    int width = 0, height = 0;
    bool mipmaps = false;
    /// Kept until uploaded, then dropped.
    ImageRef pending;
    /// When it was first wanted on screen, and (if it took long enough to notice) when it reached the screen:
    /// the renderer shows a card that is still waiting for its picture as a faint shimmer, and lets the picture
    /// in gently. A picture made ahead of being shown has waited for nothing.
    double wantedAt = 0, fadeFrom = 0;
    /// Renderer's: the GL name, and for a video, that it is an external texture.
    unsigned gl = 0;
    bool external = false;
    /// For a video frame: the 4x4 that takes mesh uv to texture uv, column-major.
    float uvTransform[16] = {1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1};
    uint32_t serial = nextSerial();
};
using TextureRef = std::shared_ptr<Texture>;

// MARK: - Meshes

/// A mesh. Positions are in the entity's own space, m. Texture
/// coordinates: (0, 0) is the picture's bottom-left
/// corner and v grows upward, so an image's top row is at v = 1.
class Mesh {
public:
    virtual ~Mesh();
    /// A mesh of triangles from positions, texture coordinates and indices.
    static std::shared_ptr<Mesh> generate(std::vector<Vec3> positions, std::vector<Vec2> uvs, std::vector<uint32_t> indices);
    /// A plane: upright in XY, facing +Z, centred.
    static std::shared_ptr<Mesh> generatePlane(float width, float height);
    /// A box: centred.
    static std::shared_ptr<Mesh> generateBox(Vec3 size);
    /// Replaces what the mesh holds.
    void replace(std::vector<Vec3> positions, std::vector<Vec2> uvs, std::vector<uint32_t> indices);

    /// What the mesh was made from: empty for a LowLevelMesh.
    std::vector<Vec3> positions;
    std::vector<Vec2> uvs;
    std::vector<uint32_t> indices;
    BoundingBox bounds;

    /// Renderer's.
    unsigned vao = 0, vbo = 0, ibo = 0;
    int uploadedVertexBytes = 0, uploadedIndexCount = 0;
    bool verticesDirty = true, indicesDirty = true;
    /// Renderer's: one more each time it sends this mesh's vertices or indices to the GPU again, so a
    /// filming take knows when to write it down again.
    uint32_t revision = 0;
    uint32_t serial = nextSerial();
    virtual bool isLowLevel() const { return false; }
};
using MeshRef = std::shared_ptr<Mesh>;

/// LowLevelMesh: vertex and index memory the app writes into directly, a
/// frame at a time. It is a mesh itself.
class LowLevelMesh : public Mesh {
public:
    enum class Semantic { position, uv0, uv1 };
    struct Attribute {
        Semantic semantic;
        int components;         // .float2 -> 2, .float3 -> 3
        size_t offset;          // within one vertex, bytes
    };
    struct Descriptor {
        int vertexCapacity = 0;
        int indexCapacity = 0;
        std::vector<Attribute> vertexAttributes;
        size_t stride = 0;      // vertexLayouts[0].bufferStride
    };
    static std::shared_ptr<LowLevelMesh> make(const Descriptor& d);

    /// mesh.withUnsafeMutableBytes(bufferIndex: 0) { raw in let v = raw.bindMemory(to: V.self) ... }
    /// `body` gets a pointer to `vertexCapacity` vertices of type V.
    template <class V, class F>
    void withUnsafeMutableBytes(F&& body) {
        body(reinterpret_cast<V*>(vertexData.data()), descriptor.vertexCapacity);
        verticesDirty = true;
    }
    /// mesh.withUnsafeMutableIndices { raw in let idx = raw.bindMemory(to: UInt32.self) ... }
    template <class F>
    void withUnsafeMutableIndices(F&& body) {
        body(indexData.data(), descriptor.indexCapacity);
        indicesDirty = true;
    }
    /// mesh.parts.replaceAll([LowLevelMesh.Part(indexCount: n, topology: .triangle, bounds: b)])
    void setPart(int indexCount, const BoundingBox& bounds) {
        this->indexCount = indexCount;
        this->bounds = bounds;
    }

    Descriptor descriptor;
    std::vector<uint8_t> vertexData;
    std::vector<uint32_t> indexData;
    int indexCount = 0;
    /// Renderer's: how many vertices the drawn indices reach, and for which index count that was worked out.
    int usedVertices = 0, usedFor = -1;
    bool isLowLevel() const override { return true; }
};
using LowLevelMeshRef = std::shared_ptr<LowLevelMesh>;

// MARK: - Materials

class VideoPlayer;

/// Every material the ocean uses, as one value type (change a copy, then set
/// it back on the model).
struct Material {
    enum class Kind {
        unlit,          // UnlitMaterial
        line,           // LineMaterial.usda: colour in uv0 (r, g) and uv1.x (b), opacity in uv1.y, linear
        dust,           // DustMaterial.usda: specks moved in the vertex shader; parameters "Shift", "Center"
        hoverGlow,      // HoverGlowMaterial.usda: warm light, opacity = uv0.x * how strongly it is hovered
        video,          // VideoMaterial(avPlayer:)
        // The guide's hands: a shape drawn as a line drawing: its edge a line of even
        // weight, the rest barely there, and what is in front of it covering what is behind. The normal is in
        // uv0 (x, y) and uv1.x; uv1.y is how much of that point is there. Parameters "Line" (the edge's
        // weight, m), "Fill" (how much the body is filled) and "Glow" (how much light gathers toward its edge).
        ghost,
    };
    Kind kind = Kind::unlit;

    /// UnlitMaterial(color:) or `m.color = .init(tint: c, texture: .init(t))`: the tint and the texture.
    Color color;
    TextureRef texture;
    /// `m.blending = .transparent(opacity: x)`: transparent = true, opacity = x. Opaque otherwise.
    bool transparent = false;
    float opacity = 1;
    /// `m.opacityThreshold`: texels more see-through than this are not drawn at all.
    float opacityThreshold = 0;
    /// `m.faceCulling = .none` -> cull = false.
    bool cull = true;
    bool writesDepth = true;
    /// Kind::line only: its light is added to what is behind and covers none of it, so overlapping colours sum toward white.
    bool additive = false;
    /// Momo's block: drawn over whatever it overlaps, as a heads-up display is: seen through,
    /// after everything else, its depth neither tested nor written; among such things, the farthest first.
    bool onTop = false;
    /// The hands' pointer and light: drawn after what is on top, so it shows over that too, and
    /// otherwise as it would be: seen through, and behind whatever stands in front of it in the room.
    bool overOnTop = false;
    /// A shader's parameters by name: a float is stored in x.
    std::map<std::string, Vec4> parameters;
    /// For Kind::video.
    std::shared_ptr<VideoPlayer> video;

    static Material unlit(Color color = {}) {
        Material m;
        m.color = color;
        return m;
    }
    static Material unlit(Color tint, TextureRef texture) {
        Material m;
        m.color = tint;
        m.texture = std::move(texture);
        return m;
    }
    /// The three shader-graph materials, as PalaceModel.loadLineMaterial and OceanModel.start load them.
    static Material line() {
        Material m;
        m.kind = Kind::line;
        m.transparent = true;
        m.cull = false;
        m.writesDepth = false;
        return m;
    }
    static Material dust() {
        Material m;
        m.kind = Kind::dust;
        m.transparent = true;
        return m;
    }
    static Material hoverGlow() {
        Material m;
        m.kind = Kind::hoverGlow;
        m.transparent = true;
        return m;
    }
    static Material ghost(Color color = {}) {
        Material m;
        m.kind = Kind::ghost;
        m.color = color;
        m.transparent = true;
        return m;
    }
    static Material videoMaterial(std::shared_ptr<VideoPlayer> player) {
        Material m;
        m.kind = Kind::video;
        m.video = std::move(player);
        return m;
    }
    void setParameter(const std::string& name, float value) { parameters[name] = {value, 0, 0, 0}; }
    void setParameter(const std::string& name, Vec3 value) { parameters[name] = {value, 0}; }
};

struct ModelComponent {
    MeshRef mesh;
    std::vector<Material> materials;
};

// MARK: - Picking and hover

/// ShapeResource: only boxes are used.
struct Shape {
    Vec3 size;
    Vec3 translation;
    Quat rotation;
    /// ShapeResource.generateBox(size:)
    static Shape generateBox(Vec3 size) { return {size, {}, {}}; }
    /// .offsetBy(translation:) and .offsetBy(rotation:translation:)
    Shape offsetBy(Vec3 t) const { return {size, translation + t, rotation}; }
    Shape offsetBy(Quat r, Vec3 t) const { return {size, r.act(translation) + t, r * rotation}; }
    /// shape.bounds
    BoundingBox bounds() const;
};

/// How an entity shows that it is hovered. There is no system gaze: an entity is
/// "hovered" while a hand ray rests on it (input.cpp), and the renderer
/// draws the effect.
struct Hover {
    enum class Kind { none, shader, highlight };
    Kind kind = Kind::none;
    Color color;
    float strength = 1;
    static Hover none() { return {}; }
    /// The entity's hoverGlow materials read how strongly it is hovered.
    static Hover shader() { return {Kind::shader, {}, 1}; }
    /// A highlight of a colour and a strength.
    static Hover highlight(Color color, float strength) { return {Kind::highlight, color, strength}; }
};

// MARK: - Entities

class Entity;
using EntityRef = std::shared_ptr<Entity>;

class Entity : public std::enable_shared_from_this<Entity> {
public:
    /// An empty entity.
    static EntityRef make();
    /// An entity with a model.
    static EntityRef make(MeshRef mesh, std::vector<Material> materials);
    ~Entity();

    std::string name;
    bool isEnabled = true;
    Vec3 position;
    Quat orientation;
    Vec3 scale{1, 1, 1};
    Transform transform() const { return {scale, orientation, position}; }
    void setTransform(const Transform& t) {
        scale = t.scale;
        orientation = t.rotation;
        position = t.translation;
    }

    std::optional<ModelComponent> model;
    /// Fades this entity and everything under it.
    std::optional<float> opacity;
    /// What a pointer can land on: empty when it has none.
    std::vector<Shape> collision;
    bool inputTarget = false;
    Hover hover;
    /// The pointer's dot rests on this entity's mesh instead of flying on to whatever is
    /// behind it, though a pinch still passes through to what it would have landed on (input.cpp).
    bool stopsPointer = false;

    Entity* parent = nullptr;
    std::vector<EntityRef> children;
    void addChild(const EntityRef& child);
    void removeChild(const EntityRef& child);
    void removeFromParent();

    /// Whether it and everything above it is enabled.
    bool isEnabledInHierarchy() const;
    /// transformMatrix(relativeTo:); nullptr means world space, as nil does.
    Mat4 transformMatrix(const Entity* relativeTo = nullptr) const;
    Mat4 transformMatrix(const EntityRef& relativeTo) const { return transformMatrix(relativeTo.get()); }
    /// convert(position: p, from: other): a point in `from`'s space (world if nullptr), in this entity's space.
    Vec3 convertFrom(Vec3 position, const Entity* from) const;
    Vec3 convertFrom(Vec3 position, const EntityRef& from) const { return convertFrom(position, from.get()); }
    /// convert(position: p, to: other): a point in this entity's space, in `to`'s space (world if nullptr).
    Vec3 convertTo(Vec3 position, const Entity* to) const;
    Vec3 convertTo(Vec3 position, const EntityRef& to) const { return convertTo(position, to.get()); }
    /// position(relativeTo:) and setPosition(_:relativeTo:); nullptr is world space.
    Vec3 positionRelativeTo(const Entity* other) const;
    void setPosition(Vec3 p, const Entity* relativeTo);
    /// visualBounds(relativeTo: nil): the box round every enabled mesh under it, in world space.
    BoundingBox visualBounds() const;

    /// Renderer's and the input system's: how strongly a hand ray rests on it, 0...1.
    float hovered = 0;

    /// Drawn for the person in the headset, but left out of a filming take (take.h), with everything under
    /// it: the filming panel, the sheet's outline.
    bool unfilmed = false;
    /// Only in a filming take played back (take.h): where it is in the world, whatever it hangs under,
    /// and how strongly the placeholder showed if its picture had not arrived when it was drawn.
    std::optional<Mat4> replayWorld;
    float replayLoading = 0;
    uint32_t serial = nextSerial();

private:
    Entity() = default;
};

/// What the scene runs: the protocol between the host and the ocean.
class PalaceScene {
public:
    virtual ~PalaceScene() = default;
    virtual EntityRef root() = 0;
    /// `start() async`: loads everything. It runs on the frame thread and may take a while.
    virtual void start() = 0;
    virtual void update(float dt) = 0;
    /// A pinch on `entity`, from the moment it lands, and every time the hand moves: where the
    /// pinched point is now and where it was when the pinch landed, in world space.
    virtual void pinchChanged(const EntityRef& entity, Vec3 at, Vec3 start) = 0;
    virtual void pinchEnded(Vec3 at) = 0;
    /// The hand a pinch beginning is made with (0 left, 1 right), just before its first `pinchChanged`.
    virtual void pinchBegan(int /*hand*/) {}
    /// What the ray of the hand that held a pinch is on as it lets go, just before `pinchEnded`.
    virtual void pinchReleasedOver(const EntityRef& /*entity*/) {}
    /// Both hands pinching: how far apart they are now, as a ratio of where they started.
    virtual void magnifyChanged(float ratio) = 0;
    virtual void magnifyEnded() = 0;
    /// Whether a hand's ray and dot should not be drawn or used right now (0 left, 1 right),
    /// because that hand is doing something its fingers do themselves.
    virtual bool pointerHidden(int /*hand*/) { return false; }
    /// A hand's ray has come to rest on something it was not on before (the entity whose hover lights).
    virtual void pointerLanded(int /*hand*/, const EntityRef& /*entity*/) {}
    /// How much the room around is dimmed, 0...1; 0 leaves it alone.
    virtual float surroundingsDim() { return 0; }
    /// How much of the whole scene shows, 1 as a rule; it goes to 0 and back while the scene
    /// is brought to where the user now is. The renderer fades the finished picture (Renderer::veil).
    virtual float veil() { return 1; }
    // FILM: added for the filming panel (core/ocean/filmpanel.h, quest/film/README.md): a greeting Momo gives when
    // asked from it. Whether it can be asked for now (every tree is closed, and the app has the recording); asking for
    // it to start `after` seconds from now, on the tree whose name has `tree` in it (empty: the scene picks), which
    // asked again while it waits calls it off; and where it stands: seconds until it starts while it waits, 0 while
    // it sounds, below 0 otherwise.
    virtual bool cueReady() { return false; }
    virtual void cue(double /*after*/, const std::string& /*tree*/) {}
    virtual double cueIn() { return -1; }
};

/// GPU objects whose owners have gone, for the renderer to free at the start
/// of its next frame (destructors run on the frame thread, but not always
/// with the GL context in a state to delete things).
namespace gpu {
std::vector<unsigned>& deadTextures();
std::vector<unsigned>& deadBuffers();
std::vector<unsigned>& deadVertexArrays();
}
