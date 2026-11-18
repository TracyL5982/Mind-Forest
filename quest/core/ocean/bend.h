// Bending a flat card onto the curve of the layer it lies on, and back.
#pragma once
#include <array>
#include <map>
#include <memory>
#include <optional>
#include <vector>

#include "../base.h"
#include "../vecmath.h"
#include "../scene.h"

/// A card takes the curve of the layer it lies on, as the glass and the grid
/// do. A card is made of flat pieces (its picture, its caption, its glow, the
/// rows under it, what a hand has marked on it); this wraps every one of
/// them, and the shapes a look or a pinch lands on, round one axis.
///
/// The bend keeps lengths along the card: a point `x` from the card's middle
/// stays `x` from it measured along the card, so nothing on it is stretched,
/// and it covers on its sheet exactly what it would have covered flat.
///
/// Everything here is in the card's own units (those of `CardView.root`), in
/// which `curve` is one over the bend's radius; 0 is flat. Nothing is done
/// for a card that has never bent, nor for a face of it that is not showing.
class Bend {
public:
    /// Pieces are cut into columns this wide before they are bent, in a piece's
    /// own units along the card, counted from the card's middle. A face that
    /// grows about the middle (a card opening) grows its columns with it, so the
    /// pieces of one face keep their lines in common at every size, however and
    /// whenever each was cut. At rest a face's columns are the card's. At full
    /// zoom a column is 7.5 cm of the world, and its flat face is then half a
    /// millimetre off the arc at most.
    // A piece cut once, at the card's columns, with each point bent onto the arc, would leave a panel drawn again
    // after its face grew, or a piece's own edge inside a column, behind the piece under it, showing through in
    // stripes. So columns grow with their face, and `drawn` puts
    // every point on its column's chord.
    static constexpr float column = 0.025f;

    /// How wide the columns of a piece placed in the card by `matrix` lie along the card.
    static float width(const Mat4& matrix) {
        float stretch = std::fabs(matrix.columns[0].x);
        return stretch > 1e-6f ? stretch * column : column;
    }

    /// Where a point of the flat card is once the card is bent.
    static Vec3 bent(Vec3 p, float curve) {
        if (!(curve > 1e-5f)) return p;
        float r = 1 / curve - p.z, a = p.x * curve;
        return {r * std::sin(a), p.y, 1 / curve - r * std::cos(a)};
    }

    /// Where a point of a piece whose columns are `width` wide is drawn: on the straight line across its column,
    /// between where the column's edges are bent to. Every piece is cut at those edges, so pieces that lie over
    /// each other are drawn exactly as far apart as they lie flat, however the card is bent and wherever a
    /// piece's own edges fall.
    static Vec3 drawn(Vec3 p, float curve, float width) {
        if (!(curve > 1e-5f)) return p;
        float from = std::floor(p.x / width) * width, t = (p.x - from) / width;
        Vec3 a = bent({from, p.y, p.z}, curve), b = bent({from + width, p.y, p.z}, curve);
        return a + (b - a) * t;
    }

    /// And back: where on the flat card a point on (or over) the bent one belongs.
    static Vec3 flat(Vec3 p, float curve) {
        if (!(curve > 1e-5f)) return p;
        float back = 1 / curve - p.z;
        return {std::atan2(p.x, back) / curve, p.y, 1 / curve - std::sqrt(p.x * p.x + back * back)};
    }

private:
    struct Vertex {
        Vec3 position;
        Vec2 uv;
    };

    /// One drawn piece.
    struct Part {
        std::weak_ptr<Entity> entity;
        MeshRef flat;                       // the flat mesh it was given, cut again when its columns move in it
        std::array<float, 3> lines{};       // where its columns lie in its own space: its line along the card, over its stretch
        float width = column;               // how wide they lie along the card now
        std::vector<Vec3> points;           // flat, in its own space, cut into columns; three to a triangle
        std::vector<Vec3> across;           // the same points in the card's space
        Mat3 back;                          // a move in the card's space, as one in its own
        std::vector<Vec2> uvs;
        LowLevelMeshRef low;                // nil for the video, which can't be drawn on one
        MeshRef shown;                      // the mesh it was given here
        Mat4 matrix;                        // to the card's space, when it was last bent
        float curve = -1;
    };

    /// Enough of a set of shapes to tell it from another.
    ///
    /// It is made for everything on a card that can be picked each time the card is looked over, so it is
    /// nine numbers held
    /// in place, all zero for no shapes (the first is otherwise the count, never zero).
    using Mark = std::array<float, 9>;

    /// One thing a look or a pinch can land on.
    struct Solid {
        std::weak_ptr<Entity> entity;
        std::vector<Shape> flat;            // its shapes as they were made
        Mark shown{};                       // what it was given here, to know them by (a shape read back is not the object that was set)
        Mat4 matrix;
        float curve = 0;
    };

    static Mark mark(const std::vector<Shape>& shapes);

public:
    /// What all bending has taken since it was last asked (`-fps` reports it), s, and the longest single card.
    static inline double spent = 0.0, worst = 0.0;

private:
    // (Keyed by the entity's address: ObjectIdentifier.)
    std::map<const Entity*, std::shared_ptr<Part>> parts;
    std::map<const Entity*, std::shared_ptr<Solid>> solids;
    std::vector<std::shared_ptr<Part>> showing;     // the pieces that show, as of the last look over the card
    float lastCurve = 0;
    int frame = 0;
    bool stale = true;                      // something on the card is new, or has been moved
    bool finished = false;                  // everything is bent to the curve it rests at, shapes too
    bool rested = false;                    // … and that is flat

public:
    /// Something was put on the card, taken off it or moved on it: it is looked over at the next update.
    void changed() { stale = true; }

    /// Bends everything that shows under `root` to `curve`. Only what is
    /// new, has moved within the card, or whose bend has changed is worked
    /// on. The pieces already known are bent every frame the bend changes
    /// (a zoom on its way, a layer moving). The card is looked over for new
    /// or moved pieces when it is said to have `changed()`, when a face
    /// changed size within it (`moved`: it is opening or closing), when
    /// its bend comes to rest, and otherwise every sixth frame.
    void update(const EntityRef& root, float curve, bool moved = false);

    /// A piece was given a new flat mesh: it is cut and bent afresh.
    void forget(const EntityRef& e);

    // MARK: - What is drawn

private:
    /// (`mesh` is the one on `e`'s model; it is not read once the piece has been placed, which may change it.)
    std::shared_ptr<Part> draw(const EntityRef& e, const MeshRef& mesh, const EntityRef& root, float curve, bool exactly);

    /// While a bend is on its way, a step too small to see (a tween's first and last frames) is
    /// left out; the curve it comes to rest at is always taken `exactly`.
    void place(Part& part, float curve, bool exactly);

    static LowLevelMeshRef lowMesh(const std::vector<Vec2>& uvs);

    /// What `cut` gives back.
    struct Cut {
        std::vector<Vec3> points;
        std::vector<Vec2> uvs;
    };

    /// A flat mesh's triangles, cut along the lines between columns `width`
    /// wide (which are the same lines for every piece of a face, so pieces
    /// that lie over each other bend alike).
    static std::optional<Cut> cut(const MeshRef& mesh, const Mat4& matrix, float width);

    // MARK: - What a look or a pinch lands on

    void shape(const EntityRef& e, const EntityRef& root, float curve);

    /// `-bendShapes` draws what a look or a pinch lands on, in red, to check it against the card.
    static bool showsShapes() {
        static const bool v = Flags::has("bendShapes");
        return v;
    }
    static constexpr const char* shapesName = "bend shapes";

    void show(const std::vector<Shape>& shapes, const EntityRef& e);
};
