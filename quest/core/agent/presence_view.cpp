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
constexpr float most = 0.3f;            // m: the widest an agent's line may be
// m: the widest a line of the caption may be: on the demo's lines, some 47 characters or 8 words (at 0.3, 31 or 5). The
// user, 2026-11-17: "the caption box can be a bit longer, now it shows very few words per line"; half as long again as
// it was (my choice, WS68).
constexpr float wordsMost = 0.45f;
constexpr float pad = 6;                // px round the words in their picture
constexpr float curio = 1.08f;          // CurioCity's line, of the type's own line height: its Momo is one such line in radius
constexpr float larger = 1.2f;          // Momo's size, of CurioCity's. Kai, 2026-11-16: "Momo is too small +20% size"
// And half as large again, its words left where they were. Kai, 2026-11-17: "Momo can also grow about 50% larger towards
// top left - to align with status bar": its right edge keeps its gap to the words' bars, and its top meets the top of
// the first agent's line ("Scout · Searching…") as it stands over two lines of words.
constexpr float grown = 1.5f;
// The bars under the words. A line's bar is as tall as the step to the next line, so two lines' bars meet with no gap
// and no overlap; the steps are set so the words keep some 2 mm of ink above their capitals' line and under their tails.
constexpr float pitch = 1.2f;           // from one line of words to the next, of the type's own line height
constexpr float agentPitch = 1.25f;     // and from one agent's line to the next
constexpr float inset = 0.008f;         // m from a bar's end to its words, at either end
constexpr float apart = 0.008f;         // m between the words' bars and what is above them: the agents' bars, or under those, the bubbles
constexpr float behind = 0.002f;        // m the bars stand behind their words
constexpr float reach = 0.07f;          // s, about, a bar takes to reach its words' new length
constexpr float feather = 0.0007f;      // m: Momo's edges soften over about one of the headset's pixels at its distance
// An agent's line (the user, 2026-11-17: "the agent indicator flicker a lot and there is a flash of that agent state block
// whenever there is an update of agent status, make the transition smoother, no flash, no flicker"): its bar and its
// words come, change and go together, quickly and quietly.
constexpr float agentAppear = 0.07f;    // s, about: a line fades in once its words are drawn, its bar with them (95% by 0.2 s)
constexpr float agentRise = 0.35f;      // of an agent's line: how far below its place it rises from as it fades in
constexpr float agentCrossFade = 0.18f; // s new words take to cross-fade over the old

const Color userInk = Color::hex(0xECEBE6);     // the web client's ink
const Color momoInk = Color::hex(0xF2C27A);     // and its amber, the agent's colour
const Color statusInk = Color::hex(0xA3A39C);   // and its quieter ink, for what is not said
const Vec3 ink = Art::ink.linear();             // the dark of the ocean's labels
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

    /// A filled round dot.
    void disc(Vec2 c, float radius, float z, Vec3 colour, float alpha) {
        constexpr int n = 18;
        if (alpha < 0.002f || radius <= 0 || !room(1 + 2 * n, 9 * n)) return;
        int centre = nv;
        put(c, z, colour, alpha);
        for (int i = 0; i < n; i++) {
            Vec2 d{std::cos(float(i) * 2 * pi / n), std::sin(float(i) * 2 * pi / n)};
            put(c + d * radius, z, colour, alpha);
            put(c + d * (radius + feather), z, colour, 0);
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

    /// A flat bar of the labels' ink, its edges hard and its corners square: it stands behind a line of words.
    void bar(float left, float right, float bottom, float top, float z, float alpha) {
        if (alpha < 0.002f || right <= left || top <= bottom || !room(4, 6)) return;
        int base = nv;
        put({left, bottom, z}, ink, alpha);
        put({right, bottom, z}, ink, alpha);
        put({right, top, z}, ink, alpha);
        put({left, top, z}, ink, alpha);
        triangle(base, base + 1, base + 2);
        triangle(base, base + 2, base + 3);
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
    : art(art), caption([art](const std::string& s, Speaker who) { return art->width(s, typeface(*art, who)) / Art::ppm; }, wordsMost),
      roster([art](const std::string& s) { return art->width(s, typeface(*art, Speaker::agent)) / Art::ppm; }, most),
      light(mesh(1400, 5600)), backing(mesh(96, 144)), scratch(5600),
      step(std::ceil(typeface(*art, Speaker::user).lineHeight()) / Art::ppm * pitch),
      small(std::ceil(typeface(*art, Speaker::agent).lineHeight()) / Art::ppm * agentPitch),
      // Of the words' line at the size it was chosen at, so Momo keeps its size when the words are set larger.
      size(std::ceil(typeface(*art, Speaker::user).lineHeight()) / Art::ppm / Art::type * curio * larger * grown),
      // Where the bars began beside Momo at its size before: CurioCity's gap, half its radius past its edge.
      edge(size / grown * 1.5f),
      // The same gap, half its radius now, to the left of the bars; its top at the first agent's bar's top.
      middle{edge - size * 1.5f, step + apart + small - size} {
    // Momo's block draws over whatever it overlaps (the user's choice, 2026-11-17), so nothing in the room ever ties with
    // it, and the pieces of it in their own order (draw()). Momo is light added to what is behind it, as CurioCity
    // draws it, so its three rings sum to white.
    Material dark = lineMaterial;
    dark.onTop = true;
    Material added = lineMaterial;
    added.additive = true;
    added.onTop = true;
    group->name = "presence";
    // (Named, for the preview's depth audit.)
    EntityRef bars = Entity::make(backing, {dark}), ring = Entity::make(light, {added});
    bars->name = "presence bars";
    ring->name = "presence Momo";
    group->addChild(bars);
    group->addChild(ring);
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
    // Over everything, as the rest of Momo is. (All of Momo's lines lie in one plane, and each picture is a little
    // taller than a line with its margin: when they wrote depth, neighbouring lines tied for the pixels they share.)
    m.onTop = true;
    EntityRef e = Entity::make(Mesh::generatePlane(piece->size.x, piece->size.y), {m});
    e->name = std::string(who == Speaker::agent ? "presence agent line (" : "presence words (") + text.substr(0, 24) + ")";
    return e;
}

float PresenceView::write(const std::string& text, Speaker who, size_t name, float y, float opacity, Words& w, float crossFade, float dt) {
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
            if (w.leaving) w.leaving->removeFromParent();
            w.leaving = nullptr;
            if (w.shown && crossFade > 0) {
                w.leaving = w.shown;
                w.leavingWidth = w.width;
                w.mix = 0;
            } else if (w.shown) {
                w.shown->removeFromParent();
            }
            w.shown = w.coming;
            w.text = w.comingText;
            w.width = w.comingWidth;
            w.coming = nullptr;
            w.comingText.clear();
        }
    }
    // The opacities are as bright as they look; blending is in linear light, where a tenth looks like a third.
    float o = std::pow(opacity * w.appear, 2.2f);
    float left = edge + inset;  // where the words begin, inside their bar
    auto lay = [&](const EntityRef& e, float width, float o) {
        e->position = {left + width / 2 - pad / Art::ppm, y, 0};
        e->opacity = o;
    };
    if (w.leaving) {
        w.mix = std::min(1.f, w.mix + dt / std::max(crossFade, 1e-3f));
        if (w.mix >= 1) {
            w.leaving->removeFromParent();
            w.leaving = nullptr;
        }
    }
    float in = w.leaving ? smooth(w.mix) : 1;
    if (w.shown) lay(w.shown, w.width, o * in);
    if (w.leaving) lay(w.leaving, w.leavingWidth, o * (1 - in));
    // The new picture shows as the old one does, or (cross-fading) hardly at all until its turn; with nothing under it
    // yet, it is drawn just enough to be sent to the GPU.
    if (w.coming && w.coming->parent) lay(w.coming, w.comingWidth, w.shown && crossFade <= 0 ? o : 0.004f);
    return o;
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
                                     if (w.leaving) w.leaving->removeFromParent();
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
    // Each line stands on a bar that hugs it: as long as its words and the inset at either end, never shorter than the
    // words now on it, and reaching a new length quickly but not at once as the words come.
    bars.clear();
    auto back = [&](Words& w, float wide, float y, float tall, float there) {
        if (w.bar < 0) w.bar = wide;
        else ease(w.bar, wide, reach, dt);
        // Never shorter than the words on it, the old ones too while they fade.
        float shown = std::max(w.shown ? w.width : 0, w.leaving ? w.leavingWidth : 0) - (w.shown || w.leaving ? 2 * pad / Art::ppm : 0);
        bars.push_back(Bar{edge, edge + std::max(w.bar, shown) + 2 * inset, y - tall / 2, y + tall / 2, there});
    };
    for (const Caption::Line& line : caption.lines()) {
        Words& w = wordsFor(words, line.key);
        if (w.shown) ease(w.appear, 1, 0.08f, dt);
        float solid = write(line.text, line.who, 0, line.y * step, line.opacity, w);
        // Words on what is happening ("Listening…", "Thinking…", the hint, a notice) come and go with their bar, on one
        // curve, and their bar shows only once they are drawn, as an agent's line does (the lead, 2026-11-17); spoken
        // words keep their bar as they were.
        back(w, line.width, line.y * step, step, line.who == Speaker::status ? solid : line.there);
    }
    keep(words, [&](int key) {
        return std::any_of(caption.lines().begin(), caption.lines().end(), [&](const Caption::Line& l) { return l.key == key; });
    });

    // The agents' lines stand above the words at rest, or, with none, the lowest beside Momo.
    int rows = caption.resting();
    float top = float(rows) * step / 2;
    // While Momo thinks, its bubbles hang where the lowest lines would be, so the lines stand above them for that while.
    float above = face.look().dots > 0.5f ? middle.y + Face::bubblesTop * size / Face::radius + apart + small / 2 : 0;
    ease(agentsFrom, std::max(rows > 0 ? top + apart + small / 2 : 0, above), 0.18f, dt);
    auto keyOf = [](const std::string& role) { return int(std::hash<std::string>{}(role) & 0x7FFFFFFF); };
    for (const Roster::Line& line : roster.lines()) {
        Words& w = wordsFor(agents, keyOf(line.role));
        // It shows only once its words are drawn: then its words and its bar fade in together, on one curve, as it
        // rises the last little way into its place; new words cross-fade over the old on a bar that stays.
        if (w.shown) ease(w.appear, 1, agentAppear, dt);
        float y = agentsFrom + (line.y - agentRise * (1 - w.appear)) * small;
        float solid = write(line.text, Speaker::agent, line.name, y, line.opacity, w, agentCrossFade, dt);
        back(w, line.width, y, small, solid);
    }
    keep(agents, [&](int key) {
        return std::any_of(roster.lines().begin(), roster.lines().end(), [&](const Roster::Line& l) { return keyOf(l.role) == key; });
    });

    // `-presenceLog`: each frame, each agent's line as it is drawn: how solid its bar is, how solid its words, and whether
    // its new words are waiting for their picture or showing over the old, to measure how it changes.
    static const bool logged = Flags::has("presenceLog");
    // (And each of the caption's lines, the user's, Momo's and the words on what is happening: its bars come first, in its lines' order.)
    if (logged) {
        std::string out;
        for (size_t i = 0; i < caption.lines().size() && i < bars.size(); i++) {
            const Caption::Line& line = caption.lines()[i];
            const Words* w = nullptr;
            for (const Words& x : words) {
                if (x.key == line.key) w = &x;
            }
            const char* who = line.who == Speaker::status ? "status" : line.who == Speaker::momo ? "momo" : "user";
            if (w) out += fmt(" | %s bar %.2f words %.2f over 0.00 y %.2f \"%s\"", who, double(bars[i].alpha), double(w->shown ? w->shown->opacity.value_or(1) : 0),
                              double(line.y), w->text.c_str());
        }
        if (!out.empty()) logLine(fmt("[presence] t %.3f", now) + out);
    }
    if (logged && !roster.lines().empty()) {
        std::string out = fmt("[presence] t %.3f rows %d from %.4f", now, rows, double(agentsFrom));
        for (const Roster::Line& line : roster.lines()) {
            const Words* w = nullptr;
            for (const Words& x : agents) {
                if (x.key == keyOf(line.role)) w = &x;
            }
            if (!w) continue;
            // (Each agent's line has the next of the bars, after the words' own.)
            size_t at = size_t(&line - roster.lines().data()) + bars.size() - roster.lines().size();
            float barAlpha = at < bars.size() ? bars[at].alpha : 0;
            // `over`: the other words showing as well, the old fading out or the new laid over before their turn.
            float words = w->shown ? w->shown->opacity.value_or(1) : 0;
            float over = w->leaving ? w->leaving->opacity.value_or(1) : w->coming && w->coming->parent ? w->coming->opacity.value_or(1) : 0;
            out += fmt(" | %s bar %.2f words %.2f over %.2f%s y %.2f \"%s\" at %.4f", line.role.c_str(), double(barAlpha), double(words), double(over),
                       w->coming && !w->coming->parent ? " waiting" : "", double(line.y), w->text.c_str(),
                       double(w->shown ? w->shown->position.y : 0));
        }
        logLine(out);
    }

    draw();
}

void PresenceView::draw() {
    const Face::Look& l = face.look();
    // Both meshes say they stand behind the words, so the renderer, which draws what is on top farthest first, draws
    // them before the words: the bars, then Momo's light, then the words. The bars are written again only while they change.
    if (bars != barsDrawn) {
        barsDrawn = bars;
        fill(backing, scratch, BoundingBox{{0, -0.08f, -0.105f}, {0.6f, 0.16f, -0.095f}}, [&](Pen& pen) {
            for (const Bar& b : bars) pen.bar(b.left, b.right, b.bottom, b.top, -behind, b.alpha);
        });
    }
    fill(light, scratch, BoundingBox{{-0.15f, -0.12f, -0.045f}, {0.15f, 0.2f, -0.035f}}, [&](Pen& pen) {
        float shown = l.shown;
        if (shown < 0.003f) return;
        // CurioCity's centimetres to metres, with the swell of a voice.
        float cm = size / Face::radius * l.scale;
        auto at = [&](Vec2 p) { return middle + p * cm; };

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
            pen.band(outer, inner, Face::points, middle, float(i - 1) * Face::zGap * cm, rings[i], shown);
        }

        // The eyes, tall and thin, squashed as they blink.
        float z = Face::eyeForward * cm;
        Vec2 eyes[2];
        for (int i = 0; i < 2; i++) {
            eyes[i] = Vec2{(i == 0 ? -1.f : 1.f) * Face::eyeDistance / 2, Face::eyeHeight} + l.gaze;
            pen.rect(at(eyes[i]), Vec2{Face::eyeSize, Face::eyeSize * Face::eyeAspect * l.openness} * cm, z, white, shown);
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

        // Thinking: three bubbles form at the upper right, each new one easing the others out, then circle there.
        if (l.dots > 0.003f) {
            for (int j = 0; j < 3; j++) {
                Face::Dot d = Face::dot(j, l.rising);
                pen.disc(at(d.at), d.radius * cm, z, white, shown * l.dots);
            }
        }
    });
}

}  // namespace agent
