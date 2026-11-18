// The threads between cards.
#pragma once
#include <memory>
#include <optional>
#include <vector>

#include "../vecmath.h"
#include "../scene.h"
#include "shapes.h"
#include "stage.h"

/// Every thread of the standing tree, in one mesh: a thin, slightly bowed
/// ribbon from a card to the card it grew from. Solid for what's kept, dashed
/// for what the gardener only offers, and one bright line for the path.
/// Rewritten only while something moves.
class Threads {
public:
    static constexpr int segments = 24;
    static constexpr int capacity = 96;         // threads at once

    struct Thread {
        Vec3 a;
        Vec3 b;
        Vec3 color;                             // linear
        float alpha;
        float width;                            // m, as seen at the focus distance
        float gap = 0;                          // 0 a solid line … 1 dashed; between, the gaps are filling in
        float bow = 0.08f;                      // how far its middle leans aside, as a share of its length
        std::optional<Vec3> via;                // or: the point its middle passes through (a strand under tension)
    };

    EntityRef entity;

private:
    LowLevelMeshRef mesh;
    int drawn = -1;

    Threads() = default;

public:
    /// `init?(material:)`: null when there is no material, or no mesh could be made.
    static std::shared_ptr<Threads> make(const std::optional<Material>& material);

private:
    static constexpr BoundingBox bounds{Vec3(-8, -4, -8), Vec3(8, 6, 8)};

public:
    void draw(const std::vector<Thread>& threads, Vec3 eye);

    /// The curve's control point: set so its middle passes through `via`, or leans aside by `bow`.
    static Vec3 control(const Thread& t, Vec3 eye);

    /// The same curve the mesh draws, for testing what a hand cuts across.
    static std::vector<Vec3> points(const Thread& t, Vec3 eye, int count = 8);
};
