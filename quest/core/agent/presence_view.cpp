#include "presence_view.h"

#include <algorithm>
#include <cmath>
#include <cstddef>

#include "ocean/art.h"
#include "ocean/shapes.h"

namespace agent {
namespace {

constexpr float pi = 3.14159265f;
constexpr float core = 0.0105f;         // m: the orb's radius at its full size, about half a degree at 1.25 m
constexpr float type = 0.0165f;         // m: the words' size, as large to the eye as an open card's title
constexpr float statusType = 0.015f;    // m: a word on what is happening, a little smaller, in italics
constexpr float most = 0.3f;            // m: the widest a line may be, some 35 characters
constexpr float textLeft = 0.03f;       // m from the orb's middle to where the words start
constexpr float pad = 6;                // px round the words in their picture

const Vec3 white{1, 1, 1};
const Color userInk = Color::hex(0xECEBE6);     // the web client's ink
const Color momoInk = Color::hex(0xF2C27A);     // and its amber, the agent's colour
const Color statusInk = Color::hex(0xA3A39C);   // and its quieter ink, for what is not said
const Vec3 amber = momoInk.linear();
const Vec3 paper = userInk.linear();
const Vec3 night = Color::hex(0x0B0D11).linear();

void ease(float& v, float target, float tau, float dt) { v += (target - v) * (1 - std::exp(-dt / tau)); }

/// Speech is set upright in the web client's ink or amber; a word on what is happening, in italics and quieter.
Font typeface(const Art& art, Speaker who) {
    if (who != Speaker::status) return art.font(type, Font::Weight::medium);
    Font f = art.font(statusType, Font::Weight::regular);
    f.italic = true;
    return f;
}

Color inkOf(Speaker who) {
    switch (who) {
    case Speaker::user: return userInk;
    case Speaker::momo: return momoInk;
    case Speaker::status: return statusInk;
    }
    return userInk;
}

/// Writes soft light into a mesh, in the orb's own plane: x right, y up, z toward the eyes.
struct Pen {
    LinkVertex* v;
    uint32_t* idx;
    int vertexCapacity, indexCapacity;
    int nv = 0, ni = 0;

    bool room(int verts, int indices) const { return nv + verts <= vertexCapacity && ni + indices <= indexCapacity; }
    void put(Vec3 p, Vec3 c, float a) { v[nv++] = LinkVertex{p, Vec2(c.x, c.y), Vec2(c.z, std::max(0.f, a))}; }
    void triangle(int a, int b, int c) {
        idx[ni++] = uint32_t(a);
        idx[ni++] = uint32_t(b);
        idx[ni++] = uint32_t(c);
    }

    /// A round light facing the eyes, brightest in its middle and gone at its edge, as a glow falls off. `whiten` is how
    /// far toward white its middle goes.
    void light(Vec3 c, float radius, Vec3 colour, float alpha, float whiten) {
        constexpr int n = 24;
        constexpr float rings[] = {0.16f, 0.34f, 0.52f, 0.72f, 1.0f};
        constexpr int count = int(std::size(rings));
        if (alpha < 0.002f || !room(1 + count * n, 3 * n + 6 * n * (count - 1))) return;
        auto fall = [](float r) { return (std::exp(-4.2f * r * r) - std::exp(-4.2f)) / (1 - std::exp(-4.2f)); };
        int centre = nv;
        put(c, colour + (white - colour) * whiten, alpha);
        for (float r : rings) {
            Vec3 tint = colour + (white - colour) * (whiten * (1 - r) * (1 - r));
            for (int k = 0; k < n; k++) {
                float a = float(k) * 2 * pi / float(n);
                put(c + Vec3{std::cos(a), std::sin(a), 0} * (radius * r), tint, alpha * fall(r));
            }
        }
        for (int k = 0; k < n; k++) triangle(centre, centre + 1 + k, centre + 1 + (k + 1) % n);
        for (int ring = 0; ring + 1 < count; ring++) {
            int in = centre + 1 + ring * n, out = in + n;
            for (int k = 0; k < n; k++) {
                int k2 = (k + 1) % n;
                triangle(in + k, out + k, out + k2);
                triangle(in + k, out + k2, in + k2);
            }
        }
    }

    /// A soft ring of light round `c`, brightest along its middle.
    void ring(Vec3 c, float radius, float width, Vec3 colour, float alpha) {
        constexpr int n = 40;
        if (alpha < 0.002f || !room(3 * n, 12 * n)) return;
        int base = nv;
        for (int k = 0; k < n; k++) {
            Vec3 d{std::cos(float(k) * 2 * pi / float(n)), std::sin(float(k) * 2 * pi / float(n)), 0};
            put(c + d * std::max(0.f, radius - width / 2), colour, 0);
            put(c + d * radius, colour, alpha);
            put(c + d * (radius + width / 2), colour, 0);
        }
        for (int k = 0; k < n; k++) {
            int a = base + 3 * k, b = base + 3 * ((k + 1) % n);
            for (int s = 0; s < 2; s++) {
                triangle(a + s, a + s + 1, b + s);
                triangle(a + s + 1, b + s + 1, b + s);
            }
        }
    }

    /// A line from `a` to `b`, turned to face `eye`, soft across its width.
    void line(Vec3 a, Vec3 b, float width, Vec3 colour, float alphaA, float alphaB, Vec3 eye) {
        if (!room(6, 12)) return;
        Vec3 side = cross(b - a, (a + b) * 0.5f - eye);
        float len = length(side);
        if (len < 1e-9f) return;
        side = side / len * (width / 2);
        int base = nv;
        put(a - side, colour, 0);
        put(a, colour, alphaA);
        put(a + side, colour, 0);
        put(b - side, colour, 0);
        put(b, colour, alphaB);
        put(b + side, colour, 0);
        for (int k = 0; k < 2; k++) {
            triangle(base + k, base + k + 1, base + 3 + k);
            triangle(base + k + 1, base + 4 + k, base + 3 + k);
        }
    }

    /// A dark rectangle whose edges soften to nothing over `feather`, rounded at the corners: it stands behind the words.
    void mist(float left, float right, float bottom, float top, float feather, float z, float alpha) {
        constexpr int steps = 6;
        if (alpha < 0.002f || !room(8 * (steps + 1), 6 + 24 * (steps + 1))) return;
        const Vec2 corners[] = {{right, top}, {left, top}, {left, bottom}, {right, bottom}};
        int base = nv;
        for (int q = 0; q < 4; q++) {
            for (int s = 0; s <= steps; s++) {
                float a = (float(q) + float(s) / float(steps)) * pi / 2;
                Vec2 c = corners[q];
                put({c.x, c.y, z}, night, alpha);
                put({c.x + std::cos(a) * feather, c.y + std::sin(a) * feather, z}, night, 0);
            }
        }
        int around = 4 * (steps + 1);
        for (int i = 0; i < around; i++) {
            int a = base + 2 * i, b = base + 2 * ((i + 1) % around);
            triangle(a, a + 1, b + 1);
            triangle(a, b + 1, b);
        }
        triangle(base, base + 2 * (steps + 1), base + 4 * (steps + 1));
        triangle(base, base + 4 * (steps + 1), base + 6 * (steps + 1));
    }
};

LowLevelMeshRef mesh(int vertices, int indices) {
    LowLevelMesh::Descriptor d;
    d.vertexCapacity = vertices;
    d.indexCapacity = indices;
    d.vertexAttributes = {{LowLevelMesh::Semantic::position, 3, offsetof(LinkVertex, position)},
                          {LowLevelMesh::Semantic::uv0, 2, offsetof(LinkVertex, rg)},
                          {LowLevelMesh::Semantic::uv1, 2, offsetof(LinkVertex, ba)}};
    d.stride = sizeof(LinkVertex);
    LowLevelMeshRef m = LowLevelMesh::make(d);
    m->setPart(0, BoundingBox{});
    return m;
}

/// Writes `mesh` afresh with `draw`: its vertices every time, its indices only when they change, which is when what is
/// drawn changes and not as it moves, so they are not sent to the GPU again each frame. `scratch` takes them first.
/// `bounds` is where the renderer takes the mesh to be when it sorts what is seen through.
template <class F>
void fill(const LowLevelMeshRef& mesh, std::vector<uint32_t>& scratch, const BoundingBox& bounds, F&& draw) {
    int ni = 0;
    mesh->withUnsafeMutableBytes<LinkVertex>([&](LinkVertex* v, int vertices) {
        Pen pen{v, scratch.data(), vertices, std::min(int(scratch.size()), mesh->descriptor.indexCapacity)};
        draw(pen);
        ni = pen.ni;
    });
    if (ni != mesh->indexCount || !std::equal(scratch.begin(), scratch.begin() + ni, mesh->indexData.begin())) {
        mesh->withUnsafeMutableIndices([&](uint32_t* idx, int) { std::copy(scratch.begin(), scratch.begin() + ni, idx); });
    }
    mesh->setPart(ni, bounds);
}

}  // namespace

PresenceView::PresenceView(std::shared_ptr<Art> art, const Material& line, EntityRef parent)
    : art(art), caption([art](const std::string& s, Speaker who) { return art->width(s, typeface(*art, who)) / Art::ppm; }, most),
      lights(mesh(1000, 5100)), mist(mesh(64, 192)), scratch(5100),
      step(std::ceil(typeface(*art, Speaker::user).lineHeight()) / Art::ppm * 1.08f) {
    // The ocean's dust is seen through and drawn after everything else, so the mist says where it stands; the light
    // does not, or a fading part of it would hide the words.
    Material dark = line;
    dark.writesDepth = true;
    group->name = "presence";
    group->addChild(Entity::make(mist, {dark}));
    group->addChild(Entity::make(lights, {line}));
    group->isEnabled = false;
    parent->addChild(group);
}

PresenceView::~PresenceView() { group->removeFromParent(); }

EntityRef PresenceView::picture(const std::string& text, Speaker who, float& width) const {
    Font f = typeface(*art, who);
    Color ink = inkOf(who);
    float w = art->width(text, f) + 2 * pad, h = std::ceil(f.lineHeight()) + 2 * pad;
    std::optional<Piece> piece = art->piece(std::nullopt, w, h, [&](Canvas&, CGSize) {
        drawString(text, CGPoint{pad, pad}, art->attributes(f, ink));
    });
    if (!piece) return nullptr;
    width = piece->size.x;
    Material m = Material::unlit(Color::white());
    m.texture = piece->texture;
    m.transparent = true;
    return Entity::make(Mesh::generatePlane(piece->size.x, piece->size.y), {m});
}

void PresenceView::write(const Caption::Line& line, Words& w) {
    if (line.text != w.comingText && w.coming) {
        w.coming->removeFromParent();
        w.coming = nullptr;
        w.comingText.clear();
    }
    if (line.text != w.text && !w.coming) {
        w.comingText = line.text;
        w.coming = picture(line.text, line.who, w.comingWidth);
    }
    if (w.coming) {
        const TextureRef& t = w.coming->model->materials[0].texture;
        bool drawn = t && (!t->pending || t->pending->ready.load());
        // Laid over the old picture only once its pixels are there: before then the renderer would show a placeholder.
        if (drawn && !w.coming->parent) group->addChild(w.coming);
        if (w.coming->parent && t->gl != 0 && t->fadeFrom == 0) {
            if (w.shown) w.shown->removeFromParent();
            w.shown = w.coming;
            w.text = w.comingText;
            w.width = w.comingWidth;
            w.coming = nullptr;
            w.comingText.clear();
        }
    }
    // The caption's opacities are as bright as they look; blending is in linear light, where a tenth looks like a third.
    float opacity = std::pow(line.opacity * w.appear, 2.2f);
    auto lay = [&](const EntityRef& e, float width, float o) {
        e->position = {textLeft + width / 2 - pad / Art::ppm, line.y * step, 0};
        e->opacity = o;
    };
    if (w.shown) lay(w.shown, w.width, opacity);
    // The new picture shows as the old one does; with nothing under it yet, it is drawn just enough to be sent to the GPU.
    if (w.coming && w.coming->parent) lay(w.coming, w.comingWidth, w.shown ? opacity : 0.004f);
}

void PresenceView::frame(const Presence& presence, const std::string& name, std::optional<Vec3> workingAt, const Mat4& head, double now) {
    float dt = last < 0 ? 0 : float(std::min(0.1, std::max(0.0, now - last)));
    last = now;
    follow.update(head, dt);
    glow.update(presence, now, dt);
    caption.update(presence, name, now, dt);
    const Glow::Look& look = glow.look();
    bool any = look.shown > 0.003f || !caption.lines().empty() || !words.empty();
    group->isEnabled = any;
    if (!any) return;
    group->position = follow.position();
    group->orientation = follow.orientation();

    if (presence.state == Presence::State::working && workingAt) workedOn = workingAt;
    ease(working, presence.state == Presence::State::working && workingAt ? 1.f : 0.f, 0.5f, dt);

    for (const Caption::Line& line : caption.lines()) {
        auto w = std::find_if(words.begin(), words.end(), [&](const Words& x) { return x.key == line.key; });
        if (w == words.end()) {
            words.push_back(Words{line.key, ""});
            w = words.end() - 1;
        }
        if (w->shown) ease(w->appear, 1, 0.08f, dt);
        write(line, *w);
    }
    words.erase(std::remove_if(words.begin(), words.end(),
                               [&](Words& w) {
                                   bool kept = std::any_of(caption.lines().begin(), caption.lines().end(),
                                                           [&](const Caption::Line& l) { return l.key == w.key; });
                                   if (kept) return false;
                                   if (w.shown) w.shown->removeFromParent();
                                   if (w.coming) w.coming->removeFromParent();
                                   return true;
                               }),
                words.end());

    ease(mistWidth, caption.width(), 0.18f, dt);
    ease(mistRows, float(std::max(1, caption.resting())), 0.18f, dt);
    ease(misty, caption.resting() > 0 ? 1.f : 0.f, caption.resting() > 0 ? 0.15f : 0.3f, dt);
    draw(now);
}

void PresenceView::draw(double now) {
    const Glow::Look& look = glow.look();
    float t = float(std::fmod(now, 3600.0));
    Vec3 colour = paper + (amber - paper) * look.warmth;
    // Thinking, the orb's light rises and falls on the web client's rhythm for the same thing (1.1 s).
    float pulse = 0.5f + 0.5f * std::sin(t * 2 * pi / 1.1f);
    float brightness = look.glow * (1 - 0.18f * look.shimmer * pulse) + 0.25f * look.voice;
    float breath = 1 + 0.07f * look.breath * std::sin(t * 2 * pi / 3.4f);
    float gathering = look.gather >= 0 ? std::sin(pi * look.gather) : 0;
    float r = core * look.size * (1 + 0.45f * look.voice) * breath * (1 - 0.22f * gathering);
    const Vec3 eye{0, 0, Follow::distance};
    Vec3 target = workedOn ? group->convertFrom(*workedOn, nullptr) : Vec3{0, 1, -1};
    Vec2 toward = length(target.xy()) > 1e-4f ? normalize(target.xy()) : Vec2{0, 1};

    // Both meshes say they stand behind the words, so the renderer, which draws what is seen through farthest first,
    // draws them before the words. The mist is written again only while it changes.
    Vec3 mistNow{mistWidth, mistRows, misty};
    if (length(mistNow - mistDrawn) > 1e-4f) {
        mistDrawn = mistNow;
        fill(mist, scratch, BoundingBox{{-0.08f, -0.08f, -0.065f}, {0.36f, 0.08f, -0.055f}}, [&](Pen& pen) {
            float half = mistRows * step / 2 + 0.012f;
            pen.mist(-0.028f, textLeft + mistWidth + 0.014f, -half, half, 0.026f, -0.03f, 0.8f * misty);
        });
    }
    fill(lights, scratch, BoundingBox{{-0.08f, -0.08f, -0.045f}, {0.36f, 0.08f, -0.035f}}, [&](Pen& pen) {
        // The card being worked on: a short ray of light from the orb toward it, with motes drifting out along it,
        // and the orb's brightest part leans its way. It points, and stops short of the card's rows.
        if (working > 0.003f && workedOn) {
            Vec3 way = length(target) > 1e-4f ? normalize(target) : Vec3{0, 1, 0};
            Vec3 from = way * (r * 1.4f), to = way * 0.11f;
            pen.line(from, to, 0.0024f, amber, 0.3f * working, 0, eye);
            for (int k = 0; k < 2; k++) {
                float u = std::fmod(t / 2.4f + float(k) * 0.5f, 1.f);
                pen.light(from + (to - from) * u, core * 0.42f, amber, 0.75f * working * (1 - u) * std::min(1.f, u * 6), 0.5f);
            }
        }

        // Thinking: three small lights circle the orb on a tilted ring, passing behind it and in front.
        Vec3 motes[3];
        float depth[3];
        for (int k = 0; k < 3; k++) {
            float a = t * 2 * pi / 2.6f + float(k) * 2 * pi / 3;
            motes[k] = {std::cos(a) * r * 2.3f, std::sin(a) * r * 0.7f + std::cos(a) * r * 0.2f, std::sin(a) * r * 1.5f};
            depth[k] = std::sin(a);
        }
        auto mote = [&](int k) {
            pen.light(motes[k], r * (0.55f + 0.12f * depth[k]), colour, look.shown * look.shimmer * (0.7f + 0.3f * depth[k]), 0.7f);
        };
        for (int k = 0; k < 3; k++) {
            if (depth[k] < 0) mote(k);
        }
        pen.light({}, r * 3.3f, colour, look.shown * (0.08f + 0.22f * brightness), 0.08f);
        Vec3 lean = Vec3{toward.x, toward.y, 0} * (r * 0.28f * working);
        pen.light(lean, r * 1.25f, colour, look.shown * std::min(1.f, 0.4f + 0.6f * brightness), 0.85f);
        for (int k = 0; k < 3; k++) {
            if (depth[k] >= 0) mote(k);
        }
        // Working: a soft ring goes out from the orb every so often, as from something busy and calm.
        if (look.ripple > 0.003f) {
            float u = std::fmod(t / 2.6f, 1.f), out = 1 - (1 - u) * (1 - u);
            pen.ring({}, r * (1.3f + 2.4f * out), r * (0.9f - 0.5f * u), colour, look.shown * look.ripple * 0.3f * (1 - u) * (1 - u));
        }
        // Sending: a ring closes in on the orb.
        if (look.gather >= 0) {
            float u = 1 - std::pow(1 - look.gather, 3.f);
            pen.ring({}, r * (3.6f - 2.6f * u), r * 0.7f, colour, look.shown * 0.75f * gathering);
        }
    });
}

}  // namespace agent
