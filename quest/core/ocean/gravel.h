// The rings on the ground round the foot of a
// tree that has been put away (oceanmodel_desk.cpp), so that it reads against
// what lies behind it.
//
// They are drawn after the raked gravel of a dry garden (枯山水), as Hashimoto
// Okiie cut it in wood: not seven neat circles but marks. And they stand
// between two other things that are rings: a tree's own, and a ripple on water.
//
// - As a tree's rings: no ring is a true circle, and all of them are out of
//   true together, each following the one inside it; the heart is a little off
//   the middle; they are unevenly spaced, some years wide and some narrow; and
//   every third is a heavy line, as late wood is darker than early.
// - As a rake leaves gravel: the rings between the heavy ones are fine and
//   broken into short dashes, each a few centimetres of ground with a breath
//   before the next, each pressed a little harder or lighter than the last;
//   their ends are round, not drawn out. Close round the foot, a scatter of
//   small stones. The last ring is the edge of it all, fine but nearly whole.
// - As a ripple: they weaken as they go out, and they are not all there at
//   once. When a tree comes to stand they spread from its foot (`show`), and
//   draw back in before it leaves.
// - Where two trees stand close and their rings would cross, they do not: the
//   nearer tree's rings are whole, and the further tree's run up to its edge
//   and end there (`rake`), as one stone's rings give way to the next's in the
//   garden.
//
// One mesh a tree, each raked differently (`seed`), drawn with the line
// material: colour and opacity in every vertex.
#pragma once
#include <memory>
#include <vector>

#include "../scene.h"
#include "../vecmath.h"
#include "shapes.h"

class Gravel {
public:
    /// As far as the rings reach from the foot, m in the cover's own measure.
    static constexpr float reach = 0.41f;

    /// Ground another tree's rings have: its foot and how far its rings reach, in this tree's own ground measure.
    struct Cut {
        Vec2 at;
        float radius;
    };

    EntityRef entity;

    /// Null when no mesh could be made.
    static std::shared_ptr<Gravel> make(const Material& material, uint32_t seed);

    /// Rakes the rings anew, stopping short of the ground other trees have.
    void rake(const std::vector<Cut>& cuts);
    /// How far the rings have spread from the foot: 0 none of them, 1 all.
    void show(float front);

private:
    Gravel() = default;
    LowLevelMeshRef mesh;
    uint32_t seed = 1;
    std::vector<LinkVertex> marks;          // as raked, every mark at its full strength
    std::vector<float> out;                 // how far out each vertex lies, 0 at the foot … 1 at `reach`
    std::vector<uint32_t> indices;
    float shown = -1;
    static constexpr int vertexCapacity = 9000;
    static constexpr int indexCapacity = 30000;
};
