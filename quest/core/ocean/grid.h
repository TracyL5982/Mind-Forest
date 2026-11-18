// The grid of dots and lines drawn under a layer.
#pragma once
#include <memory>
#include <optional>
#include <vector>

#include "../vecmath.h"
#include "../scene.h"
#include "shapes.h"
#include "stage.h"

/// The ground one layer's cards stand on, drawn on its sheet: a dot in the
/// middle of every cell and a small cross where the heavier lines meet. While
/// the tree is being moved the lines themselves show, thin for every cell and
/// heavier for every fourth. It moves with the layer's cards but is never
/// squeezed with them, and fades out toward the sheet's border.
///
/// One mesh, colored and faded per vertex, rewritten only while something moves.
class SheetGrid {
public:
    static constexpr int vertexCapacity = 44'000;
    static constexpr int indexCapacity = 110'000;
    static constexpr float cell = 0.125f;       // m: one cell on the layer you work on

private:
    static constexpr Vec3 tint{0.62f, 0.75f, 1.0f};

public:
    EntityRef entity;

private:
    LowLevelMeshRef mesh;
    // Worked out here first, then handed to the mesh in one piece.
    std::unique_ptr<LinkVertex[]> vertices{new LinkVertex[vertexCapacity]};
    std::unique_ptr<uint32_t[]> indices{new uint32_t[indexCapacity]};
    int drawn = -1;
    std::vector<float> last;                    // what the last drawing was of: nothing is redrawn that hasn't changed
    BoundingBox bounds{Vec3(-14, -14, -14), Vec3(14, 14, 14)};

    SheetGrid() = default;

public:
    /// `init?(material:)`: null when there is no material, or no mesh could be made.
    static std::shared_ptr<SheetGrid> make(const std::optional<Material>& material);

    void clear();

    /// Draws the grid of one layer.
    /// - origin: where the layer's own zero falls in the view, m from the sheet's middle.
    /// - cell: the size of one cell as this layer shows it.
    /// - dots: how strongly the dots and crosses show, 0…1.
    /// - lines: how strongly the lines show, 0…1.
    /// - fine: whether the thin line of every cell is drawn, or only every fourth.
    void draw(const Stage& stage, const Stage::Sheet& sheet, Vec2 origin, float cell, float dots, float lines, bool fine);
};

/// The glass under the tree's groups: a pane of the branch's colour lying on
/// the sheet behind each group, a pebble with round corners and a brighter rim.
/// It is drawn round the cards as they are this frame, so it grows and
/// shrinks with them and never jumps.
///
/// One mesh for all the panes, colored and faded per vertex, rewritten only
/// while something moves.
class PaneMesh {
public:
    static constexpr int vertexCapacity = 60'000;
    static constexpr int indexCapacity = 330'000;

    struct Pane {
        std::vector<Vec2> outline;      // on its sheet, m from the sheet's middle, counter-clockwise
        Stage::Sheet sheet;
        float lift;                     // m off the sheet
        Vec3 color;                     // linear
        float strength;                 // 0…1
    };

    EntityRef entity;

private:
    LowLevelMeshRef mesh;
    std::unique_ptr<LinkVertex[]> vertices{new LinkVertex[vertexCapacity]};
    std::unique_ptr<uint32_t[]> indices{new uint32_t[indexCapacity]};
    int drawn = -1;
    BoundingBox bounds;

    PaneMesh() = default;

public:
    /// `near` panes are sorted as if close to you, so they are drawn over
    /// the cards that lie on the sheet under them; the others as if far
    /// away, so they are drawn before the cards that stand on them.
    ///
    /// `init?(material:near:stage:)`: null when there is no material, or no mesh could be made.
    static std::shared_ptr<PaneMesh> make(const std::optional<Material>& material, bool near, const Stage& stage);

    /// A pane's edge: the hull of its cards' corners, moved outward by
    /// `radius` so that every corner is an arc of that radius, then walked
    /// in even steps and eased, so arcs run into straight stretches without
    /// a kink. Counter-clockwise.
    static std::vector<Vec2> outline(const std::vector<Vec2>& points, float radius);

    void draw(const std::vector<Pane>& panes);
};
