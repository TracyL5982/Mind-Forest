// Hand rays and pinches: what stands in on the Quest for visionOS's
// look-and-pinch. The Quest 3 does not track eyes, so each hand aims a ray
// (the system's own aim pose) and a pinch of that hand acts on what its ray
// rests on. What the scene is told is what PalaceView.swift's gestures told
// it on visionOS:
// - DragGesture(minimumDistance: 0).targetedToAnyEntity(): `pinchChanged`
//   from the moment a pinch lands on an entity and each time the hand moves,
//   then `pinchEnded`. As on visionOS, the pinched point follows the hand's
//   own movement, not the ray's swing.
// - MagnifyGesture(): both hands pinching, `magnifyChanged` with how far
//   apart they are against where they started, then `magnifyEnded`.
// - HoverEffectComponent: the entity a ray rests on is hovered; the renderer
//   draws the effect from `Entity::hovered`.
#pragma once
#include <memory>
#include <string>
#include <vector>

#include "scene.h"

class Input {
public:
    /// Where one hand points and whether it pinches, as the host or a test gives it.
    struct Pointer {
        bool valid = false;         // a ray can be aimed with this hand right now
        Vec3 origin, direction;     // the ray, world space
        bool pinching = false;
        Vec3 grip;                  // the pinch itself (between thumb and index), which a drag follows
    };

    explicit Input(PalaceScene* scene);
    /// Once a frame, before the scene's own update. Reads both hands from the
    /// platform unless a pointer was set by hand for this frame.
    void update(const EntityRef& root, const std::optional<Mat4>& head, float dt);
    /// The cursor dots and ray stubs, to be drawn with the scene (not part of it).
    EntityRef visuals() const { return overlay; }
    /// For the Mac preview and tests: drive a hand's pointer directly this frame.
    void set(int hand, const Pointer& pointer);

    /// In a few words, what a hand's ray and pinch are doing, for the log.
    std::string describe(int hand) const;

    /// What a ray landed on.
    struct Hit {
        EntityRef entity;
        Vec3 point;
        float distance = 0;
    };
    /// The nearest entity with a collision shape and an input target (its own or an ancestor's) along a ray.
    static Hit cast(const EntityRef& root, Vec3 origin, Vec3 direction);
    /// How far along a ray the nearest mesh that stops the pointer is (`Entity::stopsPointer`); negative if none.
    static float castSurfaces(const EntityRef& root, Vec3 origin, Vec3 direction);

    /// A hand closer together than this is pinching; it lets go when wider than `pinchOpen`.
    /// Used only where the system gives no pinch reading of its own (see `strengthClosed`).
    static constexpr float pinchClosed = 0.02f;
    static constexpr float pinchOpen = 0.035f;
    /// The system's pinch reading (0…1) at which a pinch begins, and below which it has let go.
    static constexpr float strengthClosed = 0.9f;
    static constexpr float strengthOpen = 0.55f;
    /// A held ray that has swung less than this is still a tap: the cosine of 1.2 degrees.
    static constexpr float tapCos = 0.99978f;
    /// How fast the hover light comes and goes, 1/s.
    static constexpr float hoverRate = 9;

private:
    struct HandState {
        Pointer pointer;
        bool given = false;         // set by hand this frame
        bool pinching = false;
        Hit hit;
        /// Where the dot rests when a surface that stops the pointer lies in front of what the ray picks.
        bool onSurface = false;
        Vec3 surfacePoint;
        float surfaceDistance = 0;
        EntityRef dot, ray;
        LowLevelMeshRef rayMesh;
        float shown = 0;
    };
    PalaceScene* scene;
    HandState hands[2];
    EntityRef overlay;
    /// The pinch that holds something: which hand, what, where it landed, where the hand was, and the gain.
    int holder = -1;
    EntityRef held;
    Vec3 heldStart, gripStart, heldAt;
    float gain = 1;
    /// For a drag that follows the ray: how far off the held thing was, where the ray pointed when the
    /// pinch landed, and where on the way it stopped being a tap.
    float heldDistance = 0;
    Vec3 aimStart, swingFrom;
    bool swung = false;
    /// Two hands pinching.
    bool magnifying = false;
    float magnifyBase = 0;
    std::vector<std::weak_ptr<Entity>> lit;

    Pointer read(int hand) const;
    void showCursor(HandState& h, const std::optional<Mat4>& head, float dt);
    void hover(const EntityRef& a, const EntityRef& b, float dt);
};
