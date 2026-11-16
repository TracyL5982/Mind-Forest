// Not a port: there is nothing like it in the visionOS app. What draws one of the guide's gestures
// (guidehand.h) in the room: its hands as the headset's own hand model in line (Material::ghost), and
// what they act on in the small tree's language of soft lines, fills and orbs (the line material).
//
// When and where a gesture is shown is the model's business (oceanmodel_guide.cpp).
#pragma once
#include <memory>
#include <optional>

#include "../scene.h"
#include "guidehand.h"

class GuidePainter {
public:
    /// Null when there is no line material or no hand model to draw with.
    static std::shared_ptr<GuidePainter> make(const std::optional<Material>& line);

    /// Everything it draws hangs from this: put it where the gesture is to be seen (its +z toward the
    /// viewer), and scale it. A gesture is drawn at life size in the entity's own space.
    EntityRef entity;

    /// Draws `gesture` as it is `t` seconds into its loop. `eye` is the viewer's, in the world: the lines turn to face it.
    void draw(const guide::Gesture& gesture, float t, Vec3 eye);
    /// Draws nothing.
    void clear();
    /// How heavy the line round a hand is, m: more for a gesture shown small or far off.
    void setLine(float weight);
    /// How far from the entity it may draw, m: more for one that draws in the room's own space.
    void setReach(float metres) { reach = metres; }

private:
    struct Pen;
    guide::Frame frame;
    // Two hands at most: a mesh each, holding a right hand's triangles or a left's.
    LowLevelMeshRef handMesh[2];
    EntityRef handEntity[2];
    int handSide[2] = {-1, -1};         // 0 right, 1 left, -1 not yet given its triangles
    LowLevelMeshRef lines;
    EntityRef lineEntity;
    bool blank = true;
    float reach = 0.6f;

    GuidePainter() = default;
};
