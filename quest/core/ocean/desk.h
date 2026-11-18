// Where you sit, the desk in front of you, and
// where things stand on it.
//
// The scene used to stand wherever the head was and faced at launch. Now it
// is seated: squared to the near edge of the desk you sit at, if the headset
// knows a table there (Meta's scene model, read by the host: platform::tables),
// and otherwise to the way you face, with a desk assumed where one usually is.
// Either way there is a desk, and the things at hand stand on it: the small
// tree right in front of you, the trees you put away behind it like a forest.
#pragma once
#include <string>
#include <vector>

#include "../platform.h"
#include "../vecmath.h"

/// Where the eyes are and which way is ahead, level.
struct Chair {
    Vec3 eyes;
    Vec3 f{0, 0, -1};

    Vec3 r() const { return normalize(cross(f, {0, 1, 0})); }
    /// As a head that looks level along `f`.
    Mat4 matrix() const { return Mat4::trs(eyes, Quat(Mat3(r(), {0, 1, 0}, -f)), {1, 1, 1}); }
};

/// The top of the desk, as you sit at it.
struct Desk {
    bool found = false;             // a table the headset knows; otherwise one assumed
    int table = 0;                  // which (platform::Table::id), when found
    Vec3 front;                     // on its top, on its near edge, straight ahead of you
    Vec3 across{1, 0, 0};           // to the right along that edge
    Vec3 back{0, 0, -1};            // away from you, across the top
    float left = 0.7f, right = 0.7f;    // m its top runs to each side of `front`
    float depth = 0.75f;            // m from the near edge to the far one

    /// A place on it: `x` m right of `front`, `z` m back from the near edge, `up` m above the top.
    Vec3 at(float x, float z, float up = 0) const { return front + across * x + back * z + Vec3{0, up, 0}; }
    /// The same, read back: where a point above it stands on it.
    Vec2 plot(Vec3 p) const { return {dot(p - front, across), dot(p - front, back)}; }
};

struct Seating {
    Chair seat;
    Desk desk;
    std::string note;               // why, for the log

    // What makes a table the desk you sit at. Each can be tried at launch (`-deskReach 0.9`).
    static float reach();           // m: its near edge is no further than this ahead of you (0.75)
    static float square();          // degrees: and you face it within this of square on (35)
    static constexpr float lean = 0.3f;         // m you may lean in over its edge
    static constexpr float slack = 0.12f;       // m you may sit past the end of the edge
    static constexpr float lowest = 0.22f;      // m: its top is this far below the eyes at least,
    static constexpr float highest = 1.05f;     // and this far at most
    // The desk assumed when none is found: as far below the eyes as a desk is below someone seated, a
    // standing desk for someone standing, and its edge about where a desk's edge is against you.
    static constexpr float usual = 0.73f;       // m: a desk's height above the floor
    static constexpr float edge = 0.28f;        // m ahead of the eyes

    /// Where the scene should sit for a head that is here, in a room with these tables.
    static Seating choose(const Mat4& head, const std::vector<platform::Table>& tables, Vec3 lastAhead = {0, 0, -1});
};

/// Where trees put away stand on the desk: scattered as trees are, but so
/// that from where you sit none hides another (a nearer one may cover a
/// corner of a further one, never the middle of it), since each is picked
/// by pointing at it.
struct Forest {
    struct Clearing {
        Vec2 at;                    // on the desk (see Desk::plot)
        float radius;
    };
    /// How large a put-away tree stands on the desk while no tree is open, against its own measure
    /// (`-forestGrown`), and how large it lies on the ocean's floor while one is (`-forestScale`).
    static float grown();
    static float scale();
    // A tree's cover in its own measure, about: half its width with all its pictures, and its height.
    static constexpr float halfWide = 0.36f;        // (0.55 before the pictures were drawn in to the trunk)
    static constexpr float tall = 0.64f;
    // The ground the forest stands on: this far to each side of you, and this deep from its nearest trees, m.
    static constexpr float wide = 2.6f;
    static constexpr float deep = 2.6f;
    /// Degrees a trunk's line of sight keeps from the next, at the least.
    static constexpr float apart = 8;

    /// The places, in rings round you at the desk's height, the nearest `nearest` back from the desk's
    /// edge; the first are the ones to take first. `eyes` is where they are seen from.
    static std::vector<Vec2> plots(const Desk& desk, Vec3 eyes, float nearest, const std::vector<Clearing>& clearings, int count = 40);
    /// How much of the smaller of two trees, seen from `eyes`, the other covers: 0 to 1.
    static float hidden(const Desk& desk, Vec3 eyes, Vec2 a, Vec2 b);
    /// Whether two trees at these places would stand in each other's way: their pictures run into
    /// each other, or from `eyes` one's trunk stands behind the other's.
    static bool crowd(const Desk& desk, Vec3 eyes, Vec2 a, Vec2 b);
};
