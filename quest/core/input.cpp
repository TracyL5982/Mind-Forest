#include "input.h"

#include <algorithm>
#include <cstring>

#include "base.h"
#include "platform.h"

namespace {

/// The ray stub's vertices: the line material's layout (colour and opacity in two texture coordinates).
struct RayVertex {
    Vec3 position;
    Vec2 rg;
    Vec2 ba;
};

MeshRef disc(float radius, int segments) {
    std::vector<Vec3> positions{{0, 0, 0}};
    std::vector<Vec2> uvs{{0.5f, 0.5f}};
    std::vector<uint32_t> indices;
    for (int i = 0; i < segments; i++) {
        float a = float(i) / float(segments) * 2 * float(M_PI);
        positions.push_back({std::cos(a) * radius, std::sin(a) * radius, 0});
        uvs.push_back({0.5f + 0.5f * std::cos(a), 0.5f + 0.5f * std::sin(a)});
        indices.push_back(0);
        indices.push_back(uint32_t(1 + i));
        indices.push_back(uint32_t(1 + (i + 1) % segments));
    }
    return Mesh::generate(positions, uvs, indices);
}

/// Where a ray, given in a box's own space, enters the box; negative if it misses.
float enterBox(Vec3 o, Vec3 d, Vec3 half) {
    float t0 = 0, t1 = 1e9f;
    for (int a = 0; a < 3; a++) {
        if (std::fabs(d[a]) < 1e-9f) {
            if (std::fabs(o[a]) > half[a]) return -1;
            continue;
        }
        float inv = 1 / d[a];
        float n = (-half[a] - o[a]) * inv, f = (half[a] - o[a]) * inv;
        if (n > f) std::swap(n, f);
        t0 = std::max(t0, n);
        t1 = std::min(t1, f);
        if (t0 > t1) return -1;
    }
    return t0;
}

void castInto(const Entity* e, const EntityRef& ref, const Mat4& parent, bool target, Vec3 origin, Vec3 direction, Input::Hit& best) {
    if (!e->isEnabled) return;
    Mat4 world = parent * Mat4::trs(e->position, e->orientation, e->scale);
    target = target || e->inputTarget;
    if (target && !e->collision.empty()) {
        Mat4 inv = world.inverse();
        Vec3 o = inv.point(origin), d = inv.direction(direction);      // not renormalised: t stays in world metres
        for (const Shape& s : e->collision) {
            Quat back = s.rotation.inverse();
            float t = enterBox(back.act(o - s.translation), back.act(d), s.size * 0.5f);
            if (t >= 0 && (!best.entity || t < best.distance)) {
                best.entity = ref;
                best.distance = t;
                best.point = origin + direction * t;
            }
        }
    }
    for (const auto& c : e->children) castInto(c.get(), c, world, target, origin, direction, best);
}

/// Where a ray crosses a triangle, either side of it; negative if it does not.
float crossTriangle(Vec3 o, Vec3 d, Vec3 a, Vec3 b, Vec3 c) {
    Vec3 e1 = b - a, e2 = c - a;
    Vec3 p = cross(d, e2);
    float det = dot(e1, p);
    if (std::fabs(det) < 1e-12f) return -1;
    float inv = 1 / det;
    Vec3 s = o - a;
    float u = dot(s, p) * inv;
    if (u < 0 || u > 1) return -1;
    Vec3 q = cross(s, e1);
    float v = dot(d, q) * inv;
    if (v < 0 || u + v > 1) return -1;
    float t = dot(e2, q) * inv;
    return t > 0 ? t : -1;
}

void castSurfacesInto(const Entity* e, const Mat4& parent, Vec3 origin, Vec3 direction, float& best) {
    if (!e->isEnabled) return;
    Mat4 world = parent * Mat4::trs(e->position, e->orientation, e->scale);
    if (e->stopsPointer && e->model && e->model->mesh) {
        Mat4 inv = world.inverse();
        Vec3 o = inv.point(origin), d = inv.direction(direction);      // not renormalised: t stays in world metres
        const Mesh& mesh = *e->model->mesh;
        auto take = [&](Vec3 a, Vec3 b, Vec3 c) {
            float t = crossTriangle(o, d, a, b, c);
            if (t > 0 && (best < 0 || t < best)) best = t;
        };
        if (mesh.isLowLevel()) {
            const auto& low = static_cast<const LowLevelMesh&>(mesh);
            size_t stride = low.descriptor.stride, offset = 0;
            for (const auto& a : low.descriptor.vertexAttributes) {
                if (a.semantic == LowLevelMesh::Semantic::position) offset = a.offset;
            }
            auto at = [&](uint32_t i) {
                Vec3 p;
                memcpy(&p, low.vertexData.data() + size_t(i) * stride + offset, sizeof(Vec3));
                return p;
            };
            int n = std::min(low.indexCount, int(low.indexData.size()));
            uint32_t top = uint32_t(low.descriptor.vertexCapacity);
            for (int i = 0; i + 2 < n; i += 3) {
                uint32_t a = low.indexData[size_t(i)], b = low.indexData[size_t(i) + 1], c = low.indexData[size_t(i) + 2];
                if (a < top && b < top && c < top) take(at(a), at(b), at(c));
            }
        } else {
            for (size_t i = 0; i + 2 < mesh.indices.size(); i += 3) {
                take(mesh.positions[mesh.indices[i]], mesh.positions[mesh.indices[i + 1]], mesh.positions[mesh.indices[i + 2]]);
            }
        }
    }
    for (const auto& c : e->children) castSurfacesInto(c.get(), world, origin, direction, best);
}

/// The entity whose hover effect lights when `e` is pointed at: itself or the nearest one above it that has one.
EntityRef hoverOwner(const EntityRef& e) {
    for (Entity* at = e.get(); at; at = at->parent) {
        if (at->hover.kind != Hover::Kind::none) return at->shared_from_this();
    }
    return nullptr;
}

}  // namespace

Input::Hit Input::cast(const EntityRef& root, Vec3 origin, Vec3 direction) {
    Hit best;
    if (root) castInto(root.get(), root, Mat4::identity(), false, origin, direction, best);
    return best;
}

float Input::castSurfaces(const EntityRef& root, Vec3 origin, Vec3 direction) {
    float best = -1;
    if (root) castSurfacesInto(root.get(), Mat4::identity(), origin, direction, best);
    return best;
}

Input::Input(PalaceScene* scene) : scene(scene) {
    overlay = Entity::make();
    overlay->name = "hand rays";
    for (auto& h : hands) {
        Material white = Material::unlit(Color::white(1));
        white.transparent = true;
        white.opacity = 0.9f;
        white.writesDepth = false;
        white.cull = false;
        // The pointer shows over Momo (the user's choice, 2026-11-17), still behind what stands in front of it.
        white.overOnTop = true;
        h.dot = Entity::make(disc(1, 24), {white});
        h.dot->isEnabled = false;
        overlay->addChild(h.dot);

        LowLevelMesh::Descriptor d;
        d.vertexCapacity = 4;
        d.indexCapacity = 6;
        d.stride = sizeof(RayVertex);
        d.vertexAttributes = {{LowLevelMesh::Semantic::position, 3, offsetof(RayVertex, position)},
                              {LowLevelMesh::Semantic::uv0, 2, offsetof(RayVertex, rg)},
                              {LowLevelMesh::Semantic::uv1, 2, offsetof(RayVertex, ba)}};
        h.rayMesh = LowLevelMesh::make(d);
        h.rayMesh->withUnsafeMutableIndices([](uint32_t* idx, int) {
            const uint32_t quad[6] = {0, 1, 2, 1, 3, 2};
            for (int i = 0; i < 6; i++) idx[i] = quad[i];
        });
        Material line = Material::line();
        line.overOnTop = true;
        h.ray = Entity::make(h.rayMesh, {line});
        h.ray->isEnabled = false;
        overlay->addChild(h.ray);
    }
}

void Input::set(int hand, const Pointer& pointer) {
    hands[hand].pointer = pointer;
    hands[hand].given = true;
}

Input::Pointer Input::read(int which) const {
    const platform::Hand& hand = platform::hand(which);
    Pointer p;
    if (!hand.tracked) return p;
    using platform::Joint;
    Vec3 thumb = hand.at(Joint::thumbTip), index = hand.at(Joint::indexTip);
    float gap = distance(thumb, index);
    // The system's own reading where there is one: fingertip joints lie inside the fingers, so by
    // their distance alone a firm pinch is easily missed.
    bool held = hands[which].pinching;
    bool closed = hand.pinchStrength >= 0 ? hand.pinchStrength >= (held ? strengthOpen : strengthClosed)
                                          : gap < (held ? pinchOpen : pinchClosed);
    p.pinching = !hand.systemGesture && closed;
    p.grip = (thumb + index) * 0.5f;
    // A closed hand is a fist (it carries the tree, or steps between layers): it aims nothing.
    Vec3 wrist = hand.at(Joint::wrist);
    float size = std::max(distance(hand.at(Joint::middleProximal), wrist), 0.05f);
    bool fist = true;
    for (Joint j : {Joint::indexTip, Joint::middleTip, Joint::ringTip, Joint::littleTip}) {
        if (distance(hand.at(j), wrist) / size >= 1.15f) fist = false;
    }
    // With the system's own reading where it gives one: a hand only half closed still aims (see Hands::fistGrasp).
    if (hand.graspStrength >= 0) fist = fist && hand.graspStrength >= 0.9f;
    p.valid = hand.aimValid && !hand.systemGesture && !fist;
    p.origin = hand.aimOrigin;
    p.direction = hand.aimDirection;
    return p;
}

void Input::setFront(EntityRef root, std::function<void(const EntityRef&)> pressed) {
    frontRoot = std::move(root);
    frontPressed = std::move(pressed);
}

void Input::update(const EntityRef& root, const std::optional<Mat4>& head, float dt) {
    static const double fixedGain = Flags::number("dragGain");
    // A pinched card follows the system's ray, which the headset steadies itself; `-dragBy hand` has it
    // follow the hand's own movement instead (what `-dragGain` then scales).
    static const bool byRay = Flags::string("dragBy").value_or("ray") != "hand";
    bool was[2] = {hands[0].pinching, hands[1].pinching};
    for (int i = 0; i < 2; i++) {
        HandState& h = hands[i];
        if (!h.given) h.pointer = read(i);
        h.given = false;
        // A hand the scene has taken for something else (its fingers on the small tree) aims nothing and pinches nothing here.
        if (scene->pointerHidden(i)) {
            h.pointer.valid = false;
            if (holder != i) h.pointer.pinching = false;
        }
        h.pinching = h.pointer.pinching;
        h.hit = h.pointer.valid ? cast(root, h.pointer.origin, h.pointer.direction) : Hit{};
        // The dot rests on a blob of glass the ray crosses before whatever a pinch would land on, unless
        // that is a card standing on the glass (a card is at most a few centimetres off its pane).
        h.onSurface = false;
        if (h.pointer.valid) {
            float t = castSurfaces(root, h.pointer.origin, h.pointer.direction);
            bool onCard = h.hit.entity && hoverOwner(h.hit.entity) && h.hit.distance < t + 0.25f;
            if (t > 0 && !onCard && (!h.hit.entity || t < h.hit.distance)) {
                h.onSurface = true;
                h.surfaceDistance = t;
                h.surfacePoint = h.pointer.origin + h.pointer.direction * t;
            }
        }
        // The host's own panel, if the ray reaches it before anything of the scene's.
        h.front = nullptr;
        if (h.pointer.valid && frontRoot && holder != i) {
            Hit front = cast(frontRoot, h.pointer.origin, h.pointer.direction);
            if (front.entity && (!h.hit.entity || front.distance <= h.hit.distance)) {
                h.front = front.entity;
                h.hit = Hit{};
                h.onSurface = true;
                h.surfaceDistance = front.distance;
                h.surfacePoint = front.point;
            }
        }
    }

    for (int i = 0; i < 2; i++) {
        HandState& h = hands[i];
        if (h.pinching && !was[i] && h.front) {
            if (frontPressed) frontPressed(h.front);
        } else if (h.pinching && !was[i]) {
            if (holder < 0) {
                if (h.hit.entity) {
                    holder = i;
                    held = h.hit.entity;
                    heldStart = heldAt = h.hit.point;
                    gripStart = h.pointer.grip;
                    // What is far moves further for the same hand movement.
                    gain = fixedGain > 0 ? float(fixedGain) : std::min(3.f, std::max(1.f, h.hit.distance / 0.6f));
                    heldDistance = h.hit.distance;
                    aimStart = h.pointer.direction;
                    swung = false;
                    scene->pinchBegan(i);
                    scene->pinchChanged(held, heldStart, heldStart);
                }
            } else if (holder != i && !magnifying) {
                magnifying = true;
                magnifyBase = std::max(0.01f, distance(h.pointer.grip, hands[holder].pointer.grip));
            }
        } else if (!h.pinching && was[i]) {
            if (magnifying) {
                magnifying = false;
                scene->magnifyEnded();
            }
            if (holder == i) {
                scene->pinchReleasedOver(h.hit.entity);
                scene->pinchEnded(heldAt);
                holder = -1;
                held = nullptr;
            }
        }
    }
    if (holder >= 0 && hands[holder].pinching) {
        Vec3 at = heldAt;
        const Pointer& p = hands[holder].pointer;
        if (!byRay) {
            at = heldStart + (p.grip - gripStart) * gain;
        } else if (p.valid) {
            // Still until the ray has clearly swung (a pinch closing nudges it a little, and that is a
            // tap, not a drag); from there the card goes where the ray goes, at the distance it was picked.
            Vec3 on = p.origin + p.direction * heldDistance;
            if (!swung && dot(p.direction, aimStart) < tapCos) {
                swung = true;
                swingFrom = on;
            }
            if (swung) at = heldStart + (on - swingFrom);
        }
        if (distance(at, heldAt) > 1e-5f) {
            heldAt = at;
            scene->pinchChanged(held, at, heldStart);
        }
    }
    if (magnifying && hands[0].pinching && hands[1].pinching) {
        scene->magnifyChanged(distance(hands[0].pointer.grip, hands[1].pointer.grip) / magnifyBase);
    }

    EntityRef aimed[2];
    for (int i = 0; i < 2; i++) aimed[i] = holder == i ? held : hands[i].hit.entity;
    EntityRef owners[2] = {aimed[0] ? hoverOwner(aimed[0]) : nullptr, aimed[1] ? hoverOwner(aimed[1]) : nullptr};
    for (int i = 0; i < 2; i++) {
        if (hands[i].front) owners[i] = hands[i].front;
    }
    hover(owners[0], owners[1], dt);
    for (int i = 0; i < 2; i++) {
        // (The scene is told only of its own things.)
        if (owners[i] && owners[i].get() != landed[i] && !hands[i].front) scene->pointerLanded(i, owners[i]);
        landed[i] = hands[i].front ? nullptr : owners[i].get();
    }
    for (auto& h : hands) showCursor(h, head, dt);
}

std::string Input::describe(int hand) const {
    const HandState& h = hands[hand];
    std::string out = !h.pointer.valid ? "aims nothing" : h.onSurface ? "ray on a blob" : !h.hit.entity ? "ray on nothing"
                    : hoverOwner(h.hit.entity) ? "ray on a card" : "ray on the backdrop";
    if (h.pointer.valid && (h.hit.entity || h.onSurface)) out += fmt(" %.1f m off", h.onSurface ? h.surfaceDistance : h.hit.distance);
    if (h.pinching) out += holder == hand ? ", pinching and holding" : ", pinching";
    return out;
}

void Input::hover(const EntityRef& a, const EntityRef& b, float dt) {
    float step = hoverRate * dt;
    for (const EntityRef& e : {a, b}) {
        if (!e) continue;
        bool known = false;
        for (auto& w : lit) {
            if (w.lock() == e) known = true;
        }
        if (!known) lit.push_back(e);
    }
    for (auto it = lit.begin(); it != lit.end();) {
        EntityRef e = it->lock();
        if (!e) {
            it = lit.erase(it);
            continue;
        }
        bool on = e == a || e == b;
        e->hovered = std::min(1.f, std::max(0.f, e->hovered + (on ? step : -step)));
        if (!on && e->hovered <= 0) it = lit.erase(it);
        else ++it;
    }
}

void Input::showCursor(HandState& h, const std::optional<Mat4>& head, float dt) {
    const Pointer& p = h.pointer;
    Vec3 eye = head ? head->position() : p.origin;
    bool onSomething = p.valid && (h.hit.entity != nullptr || h.onSurface);
    h.dot->isEnabled = onSomething;
    if (onSomething) {
        // A dot the same size to the eye wherever it lands, a hair in front of what it is on.
        Vec3 landed = h.onSurface ? h.surfacePoint : h.hit.point;
        float far = distance(landed, eye);
        Vec3 toEye = far > 1e-4f ? (eye - landed) / far : Vec3{0, 0, 1};
        h.dot->position = landed + toEye * std::min(0.006f, far * 0.004f);
        Vec3 x = cross(Vec3{0, 1, 0}, toEye);
        x = length(x) > 1e-4f ? normalize(x) : Vec3{1, 0, 0};
        h.dot->orientation = Quat(Mat3(x, cross(toEye, x), toEye));
        float size = 0.0042f * far * (h.pinching ? 0.62f : 1);
        h.dot->scale = Vec3::repeating(size);
        // Brighter on what answers to a pinch than on the backdrop behind everything.
        bool answers = !h.onSurface && hoverOwner(h.hit.entity) != nullptr;
        h.dot->opacity = answers ? 1.f : h.onSurface ? 0.7f : 0.4f;
    }

    h.ray->isEnabled = p.valid;
    if (p.valid) {
        Vec3 a = p.origin + p.direction * 0.05f, b = p.origin + p.direction * 0.24f;
        Vec3 side = cross(p.direction, a - eye);
        side = length(side) > 1e-6f ? normalize(side) * 0.0012f : Vec3{0.0012f, 0, 0};
        float alpha = h.pinching ? 0.55f : 0.3f;
        h.rayMesh->withUnsafeMutableBytes<RayVertex>([&](RayVertex* v, int) {
            v[0] = {a + side, {1, 1}, {1, alpha}};
            v[1] = {a - side, {1, 1}, {1, alpha}};
            v[2] = {b + side, {1, 1}, {1, 0}};
            v[3] = {b - side, {1, 1}, {1, 0}};
        });
        Vec3 lo = vmin(a, b) - Vec3::repeating(0.01f), hi = vmax(a, b) + Vec3::repeating(0.01f);
        h.rayMesh->setPart(6, {lo, hi});
    }
}
