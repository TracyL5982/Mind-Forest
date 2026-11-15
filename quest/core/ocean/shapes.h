// Port of visionos/MindPalace/Links/LinkMesh.swift and
// visionos/MindPalace/Nodes/RoundedRectMesh.swift: the parts the ocean uses.
//
// NOTE(port): of the two files the ocean sources use one type, LinkVertex
// (Grid, Threads, Hologram and Shell write their meshes in it). MeshVertex,
// Pebble, RoundedRectMesh, VideoRectMesh, RingMesh, coverUV and LinkMesh
// belong to the sphere mode, which no ocean source names, so they are not
// carried over. `smoothstep` (Layout/Sphere.swift), which LinkMesh and the
// ocean both call, is in vecmath.h.
#pragma once
#include "../vecmath.h"

// NOTE(port): SIMD3<Float> takes 16 bytes in Swift, so a LinkVertex is 32 bytes there and 28
// here. Every mesh says where its attributes are with offsetof and sizeof, as the Swift does
// with MemoryLayout, so nothing depends on the number.
struct LinkVertex {
    Vec3 position;
    Vec2 rg;        // linear color and opacity, read by LineMaterial:
    Vec2 ba;        // UV0 = (red, green), UV1 = (blue, opacity)
};
