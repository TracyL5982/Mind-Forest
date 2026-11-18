// Meshes for links and rounded rectangles: the parts the ocean uses.
//
// The ocean uses one type from them, LinkVertex (Grid, Threads, Hologram and
// Shell write their meshes in it). `smoothstep` is in vecmath.h.
#pragma once
#include "../vecmath.h"

// A LinkVertex is 28 bytes. Every mesh says where its attributes are with offsetof and sizeof,
// so nothing depends on the number.
struct LinkVertex {
    Vec3 position;
    Vec2 rg;        // linear color and opacity, read by LineMaterial:
    Vec2 ba;        // UV0 = (red, green), UV1 = (blue, opacity)
};
