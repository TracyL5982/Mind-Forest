// The small tree at your hand: every layer of the tree, to choose one by finger.
#pragma once
#include <functional>
#include <map>
#include <memory>
#include <optional>
#include <vector>

#include "../vecmath.h"
#include "../scene.h"
#include "shapes.h"
#include "stage.h"

/// The whole tree, small, within reach: a tree of light that mirrors the one
/// standing in front of you.
///
/// - It stands upright. Each layer of the real tree is one level of it, the
///   first at its foot; a level is the layer's sheet laid flat, its top edge
///   away from you. So a branch that went up and to the right goes back and
///   to the right here, and keeps its side on every level.
/// - It is not to scale: far branches are drawn in, so the tree keeps a
///   natural crown however wide the real one has grown.
/// - A card that was asked about is an orb, larger the more of its group's
///   cards were asked in turn: the places where the tree branches. Every
///   other card is a small glitter round the orb it came back to, larger the
///   more it matters.
/// - Branches curve up out of the orb they left, in their branch's colour,
///   running from the parent's colour into their own, thicker the more of
///   the tree hangs from them, drawn in limbs that run smooth through
///   their cards and branch at an angle (see `branches`).
/// - A pane of light lies across it at the layer you work on. With a hand
///   over it, it grows a little, every level shows as a ring, and a second
///   pane follows the fingers up and down, snapping to the nearest level.
///
/// One mesh, colored and faded per vertex, in the tree's own space, so
/// growing it is only a change of scale. Rewritten only while something
/// about it moves.
class Hologram {
public:
    static constexpr int vertexCapacity = 36'000;
    static constexpr int indexCapacity = 120'000;
    static constexpr float reach = 0.085f;      // m from the trunk: as far as a branch is ever drawn
    static constexpr float foot = 0.026f;       // m from its base up to the first level
    static constexpr float tall = 0.17f;        // m its levels share between them, at most
    static constexpr float glitter = 0.05f;     // m here for each m a card stands from its group's first card
    static constexpr float zoom = 1.3f;         // how much it grows under a hand

    struct Node {
        int id;
        std::optional<int> parent;
        bool head;                          // asked about: an orb, with a branch up to it
        int layer;
        Vec3 at;                            // where it belongs, m from the base
        Vec3 color;                         // linear
        float weight = 0;                   // the share of the tree that hangs from it
        int branches = 0;                   // cards of its group that were asked in turn
        float importance = 0.5f;
        bool onPath = false;
        bool current = false;
    };

    /// Where a card is right now and its colour.
    struct Place {
        Vec3 at;
        Vec3 color;
    };

    /// Writes triangles into a mesh's buffers (below, with the drawing shared with a tree's cover).
    struct Pen;

    EntityRef entity = Entity::make();

private:
    LowLevelMeshRef mesh;
    std::unique_ptr<LinkVertex[]> vertices{new LinkVertex[vertexCapacity]};
    std::unique_ptr<uint32_t[]> indices{new uint32_t[indexCapacity]};
    BoundingBox bounds{Vec3(-0.4f, -0.2f, -0.4f), Vec3(0.4f, 0.6f, 0.4f)};
    std::vector<Node> nodes;
    std::map<int, Place> shown;

public:
    int layers = 1;
    int current = 0;
    std::optional<int> selected;

private:
    Tween<float> near{0.f};                 // a hand is over it
    Tween<float> selecting{0.f};
    Tween<float> currentY{foot};
    Tween<float> selectY{foot};
    Tween<float> girth{0.07f};              // how wide its panes are

public:
    double busyUntil = 0.0;

private:
    Hologram() = default;

public:
    /// `init?(material:)`: null when there is no material, or no mesh could be made.
    static std::shared_ptr<Hologram> make(const std::optional<Material>& material);

    // MARK: - Its shape

    /// How far one level stands above the last: less as the tree gets taller, so it stays in the hand.
    static float rise(int layers) { return std::min(0.036f, std::max(0.015f, tall / float(std::max(layers - 1, 1)))); }

    static float height(float layer, int layers) { return foot + layer * rise(layers); }

    /// Where a place on a layer's sheet (m from the first card's) falls on
    /// that level: the same direction from the trunk, drawn in more the
    /// further out it is.
    static Vec3 spot(Vec2 p, int layer, int layers) {
        float r = length(p);
        float k = r > 1e-5f ? reach * (1 - std::exp(-r / 1.3f)) / r : 0;
        return {p.x * k, height(float(layer), layers), -p.y * k};
    }

    /// The level a height on it (in its own m) is nearest, not rounded.
    float level(float y) const { return (y - foot) / rise(layers); }

    float top() const { return height(float(layers - 1), layers); }
    float width() const { return girth.target(); }
    /// Where its label rides: beside the pane the fingers move, or the one that marks where you are.
    Vec3 labelSpot(double now) const {
        float s = selecting.value(now);
        return {girth.value(now) + 0.012f, currentY.value(now) + (selectY.value(now) - currentY.value(now)) * s, 0};
    }

    // MARK: - What it shows

    void set(const std::vector<Node>& fresh, int layers, int current, double now);

    /// A hand comes over it, or leaves.
    void hover(bool on, double now);

    /// The pane under the fingers snaps to a level.
    void select(int layer, double now);

    // MARK: - Frame

    void update(double now, float dt);

private:
    void draw(double now);

    // MARK: - Drawing, shared with a tree's cover

public:
    /// The trunk, and a branch up to every card that was asked about, with a soft glow round it. They are
    /// drawn in limbs: the trunk spreads at its foot and runs up through the card the most of the tree hangs
    /// from at each fork; every other branch leaves its limb at up to 45 degrees and is a limb of its own.
    /// Each limb is one ribbon, smooth through its cards and thinner as it climbs. `shown` says where a card
    /// is right now; `thick` makes every branch that many times as thick (a cover hangs far off).
    ///
    /// (`thick` is 1 unless said otherwise; it stands before arguments that must be given, so it is always written.)
    static void branches(const std::vector<Node>& nodes, float thick, const std::function<std::optional<Place>(int)>& shown, Pen& pen);

    /// The tree as it stands, still: its trunk and branches and nothing
    /// else. No orbs, no glitter, no panes. For a tree's cover on the shelf.
    /// Written once, in the small tree's own measure; the cover sets its size.
    static EntityRef still(const std::vector<Node>& nodes, float thick, const Material& material);
};

// MARK: - Drawing, shared with a tree's cover

/// Writes triangles into a mesh's buffers.
struct Hologram::Pen {
    LinkVertex* vertices;
    uint32_t* indices;
    int vertexCapacity;
    int indexCapacity;
    int nv = 0, ni = 0;

    bool room(int verts, int idx) const { return nv + verts <= vertexCapacity && ni + idx <= indexCapacity; }

    void put(Vec3 p, Vec3 c, float a) {
        vertices[nv] = LinkVertex{p, Vec2(c.x, c.y), Vec2(c.z, a)};
        nv += 1;
    }

    void triangle(int a, int b, int c) {
        indices[ni] = uint32_t(a); indices[ni + 1] = uint32_t(b); indices[ni + 2] = uint32_t(c);
        ni += 3;
    }

    /// A ribbon through `points`, turned to face you. `soft`: brightest along its middle and fading to nothing at its edges, as light does.
    ///
    /// `width`, `color` and `alpha` are never kept; as std::function each call could allocate, on every branch of every frame the
    /// tree moves. They are template arguments instead: any callable float -> float (or Vec3).
    template <class Width, class Tint, class Alpha>
    void ribbon(const std::vector<Vec3>& points, Width&& width, Tint&& color, Alpha&& alpha, bool soft) {
        int across = soft ? 3 : 2;
        int count = int(points.size());
        if (!(count > 1 && room(count * across, (count - 1) * 6 * (across - 1)))) return;
        int base = nv;
        for (int i = 0; i < count; i++) {
            Vec3 p = points[i];
            Vec3 along = points[std::min(i + 1, count - 1)] - points[std::max(i - 1, 0)];
            Vec3 side = cross(along, Vec3(0, 0, 1));
            side = length(side) > 1e-7f ? normalize(side) : Vec3(1, 0, 0);
            float u = float(i) / float(count - 1);
            Vec3 c = color(u);
            float half = width(u) / 2, a = alpha(u);
            put(p - side * half, c, soft ? 0 : a);
            if (soft) put(p, c, a);
            put(p + side * half, c, soft ? 0 : a);
        }
        for (int i = 0; i < count - 1; i++) {
            for (int k = 0; k < across - 1; k++) {
                int a = base + across * i + k, b = a + across;
                triangle(a, a + 1, b);
                triangle(a + 1, b + 1, b);
            }
        }
    }
};
