#include "presence_view.h"

#include <algorithm>
#include <cmath>
#include <cstddef>

#include "ocean/art.h"
#include "ocean/shapes.h"

namespace agent {
namespace {

constexpr float pi = 3.14159265f;
constexpr float type = 0.0165f;         // m: the words' size, as large to the eye as an open card's title
constexpr float statusType = 0.015f;    // m: a word on what is happening, a little smaller, in italics
constexpr float agentType = 0.0115f;    // m: an agent's line, small, above the words
constexpr float most = 0.3f;            // m: the widest a line may be, some 35 characters
constexpr float pad = 6;                // px round the words in their picture
constexpr float feather = 0.0007f;      // m: Momo's edges soften over about one of the headset's pixels at its distance

const Color userInk = Color::hex(0xECEBE6);     // the web client's ink
const Color momoInk = Color::hex(0xF2C27A);     // and its amber, the agent's colour
const Color statusInk = Color::hex(0xA3A39C);   // and its quieter ink, for what is not said
const Vec3 night = Color::hex(0x0B0D11).linear();
const Vec3 white{1, 1, 1};
/// CurioCity's three rings: cyan, magenta and yellow at its colour intensity, set as its display shows them.
const Vec3 rings[3] = {Color(0, Face::colorIntensity, Face::colorIntensity, 1).linear(),
                       Color(Face::colorIntensity, 0, Face::colorIntensity, 1).linear(),
                       Color(Face::colorIntensity, Face::colorIntensity, 0, 1).linear()};

void ease(float& v, float target, float tau, float dt) { v += (target - v) * (1 - std::exp(-dt / tau)); }
float smooth(float t) { return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t); }

/// Speech is set upright in the web client's ink or amber; a word on what is happening in italics and quieter; an
/// agent's line small.
Font typeface(const Art& art, Speaker who) {
    if (who == Speaker::agent) return art.font(agentType, Font::Weight::regular);
    if (who != Speaker::status) return art.font(type, Font::Weight::medium);
    Font f = art.font(statusType, Font::Weight::regular);
    f.italic = true;
    return f;
}

Color inkOf(Speaker who) {
    switch (who) {
    case Speaker::user: return userInk;
    case Speaker::momo: return momoInk;
    case Speaker::status:
    case Speaker::agent: return statusInk;
    }
    return userInk;
}

/// CurioCity's 2D Perlin noise (Assets/Scripts/Bubbles/PerlinNoise.ts), as it is: its gradients reach 8 long, so
/// what it gives is not held to -1…1, and the rings' distortion is tuned to that.
class Perlin {
public:
    Perlin() {
        static constexpr int permutation[256] = {
            151, 160, 137, 91,  90,  15,  131, 13,  201, 95,  96,  53,  194, 233, 7,   225, 140, 36,  103, 30,  69,  142,
            8,   99,  37,  240, 21,  10,  23,  190, 6,   148, 247, 120, 234, 75,  0,   26,  197, 62,  94,  252, 219, 203,
            117, 35,  11,  32,  57,  177, 33,  88,  237, 149, 56,  87,  174, 20,  125, 136, 171, 168, 68,  175, 74,  165,
            71,  134, 139, 48,  27,  166, 77,  146, 158, 231, 83,  111, 229, 122, 60,  211, 133, 230, 220, 105, 92,  41,
            55,  46,  245, 40,  244, 102, 143, 54,  65,  25,  63,  161, 1,   216, 80,  73,  209, 76,  132, 187, 208, 89,
            18,  169, 200, 196, 135, 130, 116, 188, 159, 86,  164, 100, 109, 198, 173, 186, 3,   64,  52,  217, 226, 250,
            124, 123, 5,   202, 38,  147, 118, 126, 255, 82,  85,  212, 207, 206, 59,  227, 47,  16,  58,  17,  182, 189,
            28,  42,  223, 183, 170, 213, 119, 248, 152, 2,   44,  154, 163, 70,  221, 153, 101, 155, 167, 43,  172, 9,
            129, 22,  39,  253, 19,  98,  108, 110, 79,  113, 224, 232, 178, 185, 112, 104, 218, 246, 97,  228, 251, 34,
            242, 193, 238, 210, 144, 12,  191, 179, 162, 241, 81,  51,  145, 235, 249, 14,  239, 107, 49,  192, 214, 31,
            181, 199, 106, 157, 184, 84,  204, 176, 115, 121, 50,  45,  127, 4,   150, 254, 138, 236, 205, 93,  222, 114,
            67,  29,  24,  72,  243, 141, 128, 195, 78,  66,  215, 61,  156, 180,
        };
        for (int i = 0; i < 256; i++) p[i] = p[256 + i] = permutation[i];
    }

    float noise(float x, float y) const {
        int X = int(std::floor(x)) & 255, Y = int(std::floor(y)) & 255;
        x -= std::floor(x);
        y -= std::floor(y);
        float u = fade(x), v = fade(y);
        int A = p[X] + Y, B = p[X + 1] + Y;
        return lerp(v, lerp(u, grad(p[A], x, y), grad(p[B], x - 1, y)), lerp(u, grad(p[A + 1], x, y - 1), grad(p[B + 1], x - 1, y - 1)));
    }

private:
    int p[512];
    static float fade(float t) { return t * t * t * (t * (t * 6 - 15) + 10); }
    static float lerp(float t, float a, float b) { return a + t * (b - a); }
    static float grad(int hash, float x, float y) {
        int h = hash & 15;
        float g = float(1 + (h & 7));
        float u = (h & 8) ? -x : x, v = (h & 4) ? -y : y;
        return ((h & 1) == 0 ? u : v) * g;
    }
};

const Perlin perlin;

/// Where each rim point of a ring points (Bubbles/ShapeGeometry.ts buildRimDirections): evenly round from -60 degrees.
struct Rim {
    Vec2 dir[Face::points];
    Rim() {
        for (int i = 0; i < Face::points; i++) {
            float a = -pi / 3 + float(i) / float(Face::points) * 2 * pi;
            dir[i] = {std::cos(a), std::sin(a)};
        }
    }
};
const Rim rim;

/// A rim pushed in and out by the noise (getBubblePointsInto, with its reference radius of 40), cm.
void rimPoints(Vec2* out, float radius, float time, float noiseScale, float distortion) {
    constexpr float reference = 40;
    float ratio = radius / reference;
    for (int i = 0; i < Face::points; i++) {
        Vec2 d = rim.dir[i];
        float n = perlin.noise(d.x * noiseScale + time, d.y * noiseScale + time);
        out[i] = d * (ratio * (reference + n * distortion));
    }
}

Vec2 outward(Vec2 v) {
    float l = length(v);
    return l > 1e-9f ? v * (1 / l) : Vec2{0, 1};
}

/// Writes light into a mesh, in Momo's own plane: x right, y up, z toward the eyes, every edge softened by `feather`.
struct Pen {
    LinkVertex* v;
    uint32_t* idx;
    int vertexCapacity, indexCapacity;
    int nv = 0, ni = 0;

    bool room(int verts, int indices) const { return nv + verts <= vertexCapacity && ni + indices <= indexCapacity; }
    void put(Vec3 p, Vec3 c, float a) { v[nv++] = LinkVertex{p, Vec2(c.x, c.y), Vec2(c.z, std::max(0.f, a))}; }
    void put(Vec2 p, float z, Vec3 c, float a) { put({p.x, p.y, z}, c, a); }
    void triangle(int a, int b, int c) {
        idx[ni++] = uint32_t(a);
        idx[ni++] = uint32_t(b);
        idx[ni++] = uint32_t(c);
    }
    /// Joins `strips` + 1 rows of `n` vertices each, laid out row by row within each point, round a closed loop.
    void stitch(int base, int n, int rows, bool closed) {
        for (int i = 0; i + (closed ? 0 : 1) < n; i++) {
            int j = (i + 1) % n;
            for (int s = 0; s + 1 < rows; s++) {
                int a = base + rows * i + s, b = base + rows * j + s;
                triangle(a, a + 1, b + 1);
                triangle(a, b + 1, b);
            }
        }
    }

    /// A band between two closed outlines round `centre` (BubbleMeshBuilder.updateBand).
    void band(const Vec2* outer, const Vec2* inner, int n, Vec2 centre, float z, Vec3 colour, float alpha) {
        if (alpha < 0.002f || !room(4 * n, 18 * n)) return;
        int base = nv;
        for (int i = 0; i < n; i++) {
            put(inner[i] - outward(inner[i] - centre) * feather, z, colour, 0);
            put(inner[i], z, colour, alpha);
            put(outer[i], z, colour, alpha);
            put(outer[i] + outward(outer[i] - centre) * feather, z, colour, 0);
        }
        stitch(base, n, 4, true);
    }

    /// A thin ring round `c`.
    void circle(Vec2 c, float radius, float width, float z, Vec3 colour, float alpha) {
        constexpr int n = 40;
        Vec2 outer[n], inner[n];
        for (int i = 0; i < n; i++) {
            Vec2 d{std::cos(float(i) * 2 * pi / n), std::sin(float(i) * 2 * pi / n)};
            outer[i] = c + d * radius;
            inner[i] = c + d * std::max(0.f, radius - width);
        }
        band(outer, inner, n, c, z, colour, alpha);
    }

    /// A filled round blob, drawn out along `along` by `stretch` and as much narrower across, so it keeps its area.
    void blob(Vec2 c, float radius, Vec2 along, float stretch, float z, Vec3 colour, float alpha) {
        constexpr int n = 18;
        if (alpha < 0.002f || radius <= 0 || !room(1 + 2 * n, 9 * n)) return;
        Vec2 across{-along.y, along.x};
        int centre = nv;
        put(c, z, colour, alpha);
        for (int i = 0; i < n; i++) {
            float a = float(i) * 2 * pi / n;
            Vec2 p = c + along * (std::cos(a) * radius * stretch) + across * (std::sin(a) * radius / stretch);
            put(p, z, colour, alpha);
            put(p + outward(p - c) * feather, z, colour, 0);
        }
        for (int i = 0; i < n; i++) triangle(centre, centre + 1 + 2 * i, centre + 1 + 2 * ((i + 1) % n));
        stitch(centre + 1, n, 2, true);
    }

    /// A filled rectangle, `half` its half size (renderBoundingRect: an eye).
    void rect(Vec2 c, Vec2 half, float z, Vec3 colour, float alpha) {
        if (alpha < 0.002f || !room(8, 30)) return;
        const Vec2 corners[4] = {{1, 1}, {-1, 1}, {-1, -1}, {1, -1}};
        int base = nv;
        for (const Vec2& k : corners) {
            put(c + half * k, z, colour, alpha);
            put(c + (half + Vec2{feather, feather}) * k, z, colour, 0);
        }
        triangle(base, base + 2, base + 4);
        triangle(base, base + 4, base + 6);
        stitch(base, 4, 2, true);
    }

    /// A line through `points`, `width` across.
    void stroke(const Vec2* points, int n, float width, float z, Vec3 colour, float alpha) {
        if (alpha < 0.002f || n < 2 || !room(4 * n, 18 * n)) return;
        int base = nv;
        for (int i = 0; i < n; i++) {
            Vec2 along = outward(points[std::min(n - 1, i + 1)] - points[std::max(0, i - 1)]);
            Vec2 side{-along.y, along.x};
            float h = width / 2;
            put(points[i] - side * (h + feather), z, colour, 0);
            put(points[i] - side * h, z, colour, alpha);
            put(points[i] + side * h, z, colour, alpha);
            put(points[i] + side * (h + feather), z, colour, 0);
        }
        stitch(base, n, 4, false);
    }

    /// A dark rectangle whose edges soften to nothing over `soft`, rounded at the corners: it stands behind the words.
    void mist(float left, float right, float bottom, float top, float soft, float z, float alpha) {
        constexpr int steps = 6;
        if (alpha < 0.002f || !room(8 * (steps + 1), 6 + 24 * (steps + 1))) return;
        const Vec2 corners[] = {{right, top}, {left, top}, {left, bottom}, {right, bottom}};
        int base = nv;
        for (int q = 0; q < 4; q++) {
            for (int s = 0; s <= steps; s++) {
                float a = (float(q) + float(s) / float(steps)) * pi / 2;
                Vec2 c = corners[q];
                put({c.x, c.y, z}, night, alpha);
                put({c.x + std::cos(a) * soft, c.y + std::sin(a) * soft, z}, night, 0);
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

PresenceView::PresenceView(std::shared_ptr<Art> art, const Material& lineMaterial, EntityRef parent)
    : art(art), caption([art](const std::string& s, Speaker who) { return art->width(s, typeface(*art, who)) / Art::ppm; }, most),
      roster([art](const std::string& s) { return art->width(s, typeface(*art, Speaker::agent)) / Art::ppm; }, most),
      light(mesh(1400, 5600)), mist(mesh(64, 192)), scratch(5600),
      step(std::ceil(typeface(*art, Speaker::user).lineHeight()) / Art::ppm * 1.08f),
      small(std::ceil(typeface(*art, Speaker::agent).lineHeight()) / Art::ppm * 1.12f), size(step) {
    // The ocean's dust is seen through and drawn after everything else, so the mist says where it stands; Momo's light
    // does not, or a fading part of it would hide the words. Momo is light added to what is behind it, as CurioCity
    // draws it, so its three rings sum to white.
    Material dark = lineMaterial;
    dark.writesDepth = true;
    Material added = lineMaterial;
    added.additive = true;
    group->name = "presence";
    group->addChild(Entity::make(mist, {dark}));
    group->addChild(Entity::make(light, {added}));
    group->isEnabled = false;
    parent->addChild(group);
}

PresenceView::~PresenceView() { group->removeFromParent(); }

EntityRef PresenceView::picture(const std::string& text, Speaker who, size_t name, float& width) const {
    Font f = typeface(*art, who);
    float w = art->width(text, f) + 2 * pad, h = std::ceil(f.lineHeight()) + 2 * pad;
    std::optional<Piece> piece = art->piece(std::nullopt, w, h, [&](Canvas&, CGSize) {
        // An agent's name stands out from what it is doing, in the ink of the user's words.
        std::string named = text.substr(0, std::min(name, text.size()));
        drawString(named, CGPoint{pad, pad}, art->attributes(f, userInk));
        drawString(text.substr(named.size()), CGPoint{pad + art->width(named, f), pad}, art->attributes(f, inkOf(who)));
    });
    if (!piece) return nullptr;
    width = piece->size.x;
    Material m = Material::unlit(Color::white());
    m.texture = piece->texture;
    m.transparent = true;
    return Entity::make(Mesh::generatePlane(piece->size.x, piece->size.y), {m});
}

void PresenceView::write(const std::string& text, Speaker who, size_t name, float y, float opacity, Words& w) {
    if (text != w.comingText && w.coming) {
        w.coming->removeFromParent();
        w.coming = nullptr;
        w.comingText.clear();
    }
    if (text != w.text && !w.coming) {
        w.comingText = text;
        w.coming = picture(text, who, name, w.comingWidth);
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
    // The opacities are as bright as they look; blending is in linear light, where a tenth looks like a third.
    float o = std::pow(opacity * w.appear, 2.2f);
    float left = size * 1.5f;   // CurioCity's gap: half Momo's radius past its edge
    auto lay = [&](const EntityRef& e, float width, float o) {
        e->position = {left + width / 2 - pad / Art::ppm, y, 0};
        e->opacity = o;
    };
    if (w.shown) lay(w.shown, w.width, o);
    // The new picture shows as the old one does; with nothing under it yet, it is drawn just enough to be sent to the GPU.
    if (w.coming && w.coming->parent) lay(w.coming, w.comingWidth, w.shown ? o : 0.004f);
}

void PresenceView::frame(const Presence& presence, const std::string& name, const Mat4& head, double now) {
    float dt = last < 0 ? 0 : float(std::min(0.1, std::max(0.0, now - last)));
    last = now;
    follow.update(head, dt);
    face.update(presence, dt);
    caption.update(presence, name, now, dt);
    roster.update(presence.agents, dt);
    bool any = face.look().shown > 0.003f || !caption.lines().empty() || !words.empty() || !roster.lines().empty() || !agents.empty();
    group->isEnabled = any;
    if (!any) return;
    group->position = follow.position();
    group->orientation = follow.orientation();

    // Every line keeps its picture by its key, and lets it go once the line has gone.
    auto keep = [&](std::vector<Words>& all, auto&& wanted) {
        all.erase(std::remove_if(all.begin(), all.end(),
                                 [&](Words& w) {
                                     if (wanted(w.key)) return false;
                                     if (w.shown) w.shown->removeFromParent();
                                     if (w.coming) w.coming->removeFromParent();
                                     return true;
                                 }),
                  all.end());
    };
    auto wordsFor = [&](std::vector<Words>& all, int key) -> Words& {
        auto w = std::find_if(all.begin(), all.end(), [&](const Words& x) { return x.key == key; });
        if (w != all.end()) return *w;
        all.push_back(Words{key, ""});
        return all.back();
    };
    for (const Caption::Line& line : caption.lines()) {
        Words& w = wordsFor(words, line.key);
        if (w.shown) ease(w.appear, 1, 0.08f, dt);
        write(line.text, line.who, 0, line.y * step, line.opacity, w);
    }
    keep(words, [&](int key) {
        return std::any_of(caption.lines().begin(), caption.lines().end(), [&](const Caption::Line& l) { return l.key == key; });
    });

    // The agents' lines stand above the words at rest, or, with none, the lowest beside Momo.
    int rows = caption.resting();
    float top = float(rows) * step / 2;
    // While Momo thinks, its bubbles rise where the lowest lines would be, so the lines stand above them for that while.
    float above = face.look().dots > 0.5f ? Face::bubblesTop * size / Face::radius + small * 0.6f : 0;
    ease(agentsFrom, std::max(rows > 0 ? top + small * 0.75f : 0, above), 0.18f, dt);
    auto keyOf = [](const std::string& role) { return int(std::hash<std::string>{}(role) & 0x7FFFFFFF); };
    for (const Roster::Line& line : roster.lines()) {
        Words& w = wordsFor(agents, keyOf(line.role));
        if (w.shown) ease(w.appear, 1, 0.08f, dt);
        write(line.text, Speaker::agent, line.name, agentsFrom + line.y * small, line.opacity, w);
    }
    keep(agents, [&](int key) {
        return std::any_of(roster.lines().begin(), roster.lines().end(), [&](const Roster::Line& l) { return keyOf(l.role) == key; });
    });

    int lines = roster.resting();
    bool misted = rows > 0 || lines > 0;
    ease(mistWidth, std::max(caption.width(), roster.width()), 0.18f, dt);
    ease(mistBottom, -std::max(float(std::max(1, rows)) * step / 2, size) - 0.012f, 0.18f, dt);
    ease(mistTop, std::max(lines > 0 ? agentsFrom + (float(lines) - 0.5f) * small : float(std::max(1, rows)) * step / 2, size) + 0.012f, 0.18f, dt);
    ease(misty, misted ? 1.f : 0.f, misted ? 0.15f : 0.3f, dt);
    draw();
}

void PresenceView::draw() {
    const Face::Look& l = face.look();
    // Both meshes say they stand behind the words, so the renderer, which draws what is seen through farthest first,
    // draws them before the words. The mist is written again only while it changes.
    Vec4 mistNow{mistWidth, mistBottom, mistTop, misty};
    if (std::fabs(mistNow.x - mistDrawn.x) + std::fabs(mistNow.y - mistDrawn.y) + std::fabs(mistNow.z - mistDrawn.z) +
            std::fabs(mistNow.w - mistDrawn.w) > 1e-4f) {
        mistDrawn = mistNow;
        fill(mist, scratch, BoundingBox{{-0.08f, -0.08f, -0.065f}, {0.36f, 0.08f, -0.055f}}, [&](Pen& pen) {
            pen.mist(-size - 0.006f, size * 1.5f + mistWidth + 0.014f, mistBottom, mistTop, 0.026f, -0.03f, 0.8f * misty);
        });
    }
    fill(light, scratch, BoundingBox{{-0.08f, -0.08f, -0.045f}, {0.08f, 0.1f, -0.035f}}, [&](Pen& pen) {
        float shown = l.shown;
        if (shown < 0.003f) return;
        // CurioCity's centimetres to metres, with the swell of a voice.
        float cm = size / Face::radius * l.scale;
        auto at = [&](Vec2 p) { return p * cm; };

        // The three rings (AgentRing.update): each its own noise time, apart as far as the voice parts them.
        Vec2 outer[Face::points], inner[Face::points];
        for (int i = 0; i < 3; i++) {
            float time = l.time + float(i) * l.divergence, f = Face::innerFraction;
            rimPoints(outer, Face::radius, time, Face::noiseScale, l.distortion);
            rimPoints(inner, Face::radius * (1 - f), time, Face::noiseScale * (1 - f), l.distortion * (1 - f));
            for (int k = 0; k < Face::points; k++) {
                outer[k] = at(outer[k]);
                inner[k] = at(inner[k]);
            }
            pen.band(outer, inner, Face::points, {}, float(i - 1) * Face::zGap * cm, rings[i], shown);
        }

        // The eyes, tall and thin, squashed as they blink.
        float z = Face::eyeForward * cm;
        Vec2 eyes[2];
        for (int i = 0; i < 2; i++) {
            eyes[i] = Vec2{(i == 0 ? -1.f : 1.f) * Face::eyeDistance / 2, Face::eyeHeight} + l.gaze;
            pen.rect(at(eyes[i]), at(Vec2{Face::eyeSize, Face::eyeSize * Face::eyeAspect * l.openness}), z, white, shown);
        }

        // Searching: a monocle round the eye on the viewer's left, settling on as it comes, with a short cord hanging
        // from it.
        if (l.monocle > 0.003f) {
            float on = smooth(l.monocle), radius = Face::monocleRadius * (1.2f - 0.2f * on);
            float alpha = shown * on;
            Vec2 centre = eyes[0] - Vec2{Face::monocleShift, 0};
            pen.circle(at(centre), radius * cm, Face::monocleLine * cm, z, white, alpha);
            Vec2 from = centre + Vec2{std::cos(pi * 1.39f), std::sin(pi * 1.39f)} * radius;
            const Vec2 c1 = from + Vec2{-0.25f, -0.18f}, c2 = from + Vec2{0.15f, -0.35f}, to = from + Vec2{-0.1f, -0.6f};
            constexpr int n = 10;
            Vec2 cord[n];
            for (int i = 0; i < n; i++) {
                float t = float(i) / float(n - 1), u = 1 - t;
                cord[i] = at(from * (u * u * u) + c1 * (3 * u * u * t) + c2 * (3 * u * t * t) + to * (t * t * t));
            }
            pen.stroke(cord, n, Face::cordLine * cm, z, white, alpha);
        }

        // Thinking: bubbles rise from the upper right, each pushed out and growing as the next pops, the largest bursting.
        if (l.dots > 0.003f) {
            Face::Bubbles bubbles = Face::bubbles(l.rising);
            for (int k = 0; k < bubbles.count; k++) {
                const Face::Bubble& b = bubbles.all[k];
                pen.blob(at(b.at), b.radius * cm, b.along, b.stretch, z, white, shown * l.dots * b.alpha);
                if (b.ring > 0) pen.circle(at(b.at), b.ring * cm, 0.05f * cm, z, white, shown * l.dots * b.ringAlpha);
            }
        }
    });
}

}  // namespace agent
