#include "render.h"

#include <algorithm>
#include <cstring>

#include "base.h"
#include "platform.h"

#ifdef __ANDROID__
#include <GLES3/gl32.h>
#include <GLES2/gl2ext.h>
#define MP_GLES 1
#else
#define GL_SILENCE_DEPRECATION
#include <OpenGL/gl3.h>
#define MP_GLES 0
#endif

#ifndef GL_TIME_ELAPSED_EXT
#define GL_TIME_ELAPSED_EXT 0x88BF
#endif
#ifndef GL_TEXTURE_EXTERNAL_OES
#define GL_TEXTURE_EXTERNAL_OES 0x8D65
#endif
#ifndef GL_TEXTURE_MAX_ANISOTROPY_EXT
#define GL_TEXTURE_MAX_ANISOTROPY_EXT 0x84FE
#endif

// MARK: - Shaders

// A picture's texels are premultiplied and gamma-encoded (as UIKit and
// Android draw them). They are filtered that way, which keeps soft edges
// clean, then taken apart here: un-premultiplied, brought to linear light.
static const char* kToLinear = R"(
vec3 toLinear(vec3 s) { return s * (s * (s * 0.305306011 + 0.682171111) + 0.012522878); }
vec4 texel(vec4 t) {
    vec3 s = t.a > 0.0001 ? t.rgb / t.a : vec3(0.0);
    return vec4(toLinear(s), t.a);
}
)";

static const char* kVertex = R"(
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec2 aUV0;
layout(location = 2) in vec2 aUV1;
uniform mat4 uModel;
uniform mat4 uViewProj[2];
uniform mat4 uUVMatrix;
out highp vec2 vUV;
out highp vec2 vUV1;
void main() {
    // RealityKit's v grows upward; a picture's first row is its top.
    vUV = (uUVMatrix * vec4(aUV0.x, 1.0 - aUV0.y, 0.0, 1.0)).xy;
    vUV1 = aUV1;
    gl_Position = uViewProj[VIEW] * (uModel * vec4(aPos, 1.0));
}
)";

static const char* kUnlitFragment = R"(
uniform vec4 uTint;
uniform int uUseTexture;
uniform sampler2D uTex;
uniform float uOpacity;
uniform float uThreshold;
uniform vec3 uHover;
uniform int uOpaque;
uniform float uLoading;
uniform float uTime;
in highp vec2 vUV;
out vec4 frag;
void main() {
    if (uLoading > 0.0) {
        // A picture still on its way: a film of light where it will be, with a slow sweep across it.
        float sweep = 0.5 + 0.5 * sin(uTime * 2.6 - (vUV.x + vUV.y) * 3.2);
        float a = (0.05 + 0.09 * sweep * sweep) * uLoading * uOpacity;
        frag = vec4(vec3(0.72, 0.85, 1.0) * a, a);
        return;
    }
    vec4 c = uTint;
    if (uUseTexture != 0) c *= texel(texture(uTex, vUV));
    if (c.a < uThreshold) discard;
    float a = uOpaque != 0 ? 1.0 : c.a * uOpacity;
    frag = vec4((c.rgb + uHover) * a, a);
}
)";

static const char* kVideoFragment = R"(
uniform vec4 uTint;
uniform SAMPLER uTex;
uniform float uOpacity;
uniform int uOpaque;
in highp vec2 vUV;
out vec4 frag;
void main() {
    vec3 c = toLinear(texture(uTex, vUV).rgb) * uTint.rgb;
    float a = uOpaque != 0 ? 1.0 : uOpacity;
    frag = vec4(c * a, a);
}
)";

// LineMaterial.usda: colour in uv0 (r, g) and uv1.x (b), opacity in uv1.y, all linear.
static const char* kLineVertex = R"(
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec2 aUV0;
layout(location = 2) in vec2 aUV1;
uniform mat4 uModel;
uniform mat4 uViewProj[2];
out vec4 vColor;
void main() {
    vColor = vec4(aUV0.x, aUV0.y, aUV1.x, aUV1.y);
    gl_Position = uViewProj[VIEW] * (uModel * vec4(aPos, 1.0));
}
)";

static const char* kLineFragment = R"(
uniform float uOpacity;
uniform float uAdditive;
in vec4 vColor;
out vec4 frag;
void main() {
    float a = clamp(vColor.a, 0.0, 1.0) * uOpacity;
    frag = vec4(vColor.rgb * a, a * (1.0 - uAdditive));
}
)";

// DustMaterial.usda: every speck is moved here, so thousands drift without
// the app touching one. A swell (uv0.x is its place in the wave, uv1.x how
// far it lifts) and a stir (uv0.y its seed, uv1.y its reach, uShift pushed
// on by the app each time something happens in front).
static const char* kDustVertex = R"(
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec2 aUV0;
layout(location = 2) in vec2 aUV1;
uniform mat4 uModel;
uniform mat4 uViewProj[2];
uniform float uTime;
uniform float uShift;
uniform vec3 uCenter;
out float vAlpha;
void main() {
    float wave = sin(aUV0.x - uTime * 0.4);
    float bob = wave * wave * wave * aUV1.x;
    float slide = sin(aUV0.y + uShift * 2.6) * aUV1.y;
    float stirLift = sin(aUV0.y * 1.7 + uShift * 2.1) * aUV1.y;
    vec3 radial = aPos - uCenter;
    vec3 side = cross(vec3(0.0, 1.0, 0.0), radial);
    float len = length(side);
    side = len > 0.00001 ? side / len : vec3(0.0);
    vec3 p = aPos + side * slide + vec3(0.0, 1.0, 0.0) * (bob + stirLift);
    vAlpha = sin(aUV0.y * 7.3) * 0.32 + 0.63;
    gl_Position = uViewProj[VIEW] * (uModel * vec4(p, 1.0));
}
)";

static const char* kDustFragment = R"(
uniform float uOpacity;
in float vAlpha;
out vec4 frag;
void main() {
    float a = clamp(vAlpha, 0.0, 1.0) * uOpacity;
    frag = vec4(vec3(0.9, 0.88, 0.82) * a, a);
}
)";

// HoverGlowMaterial.usda: one warm colour, as visible as the mesh's own
// fall-off (uv0.x) times how strongly the card is hovered.
static const char* kGlowVertex = R"(
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec2 aUV0;
uniform mat4 uModel;
uniform mat4 uViewProj[2];
out float vFall;
void main() {
    vFall = aUV0.x;
    gl_Position = uViewProj[VIEW] * (uModel * vec4(aPos, 1.0));
}
)";

static const char* kGlowFragment = R"(
uniform float uOpacity;
uniform vec3 uHover;
in float vFall;
out vec4 frag;
void main() {
    float a = clamp(vFall * uHover.x, 0.0, 1.0) * uOpacity;
    frag = vec4(vec3(1.0, 0.76, 0.39) * a, a);
}
)";

// The guide's hands: a shape as a line drawing. `uSwell` moves every point out along its normal: the edge
// line is the swollen shape seen from inside, which shows only where it passes the shape itself.
static const char* kGhostVertex = R"(
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec2 aUV0;
layout(location = 2) in vec2 aUV1;
uniform mat4 uModel;
uniform mat4 uViewProj[2];
uniform vec3 uEye[2];
uniform float uSwell;
out highp vec3 vNormal;
out highp vec3 vToEye;
out highp float vThere;
void main() {
    vec3 n = normalize(mat3(uModel) * vec3(aUV0.x, aUV0.y, aUV1.x));
    vec3 p = (uModel * vec4(aPos, 1.0)).xyz + n * uSwell;
    vNormal = n;
    vToEye = uEye[VIEW] - p;
    vThere = aUV1.y;
    gl_Position = uViewProj[VIEW] * vec4(p, 1.0);
}
)";

// `uLook`: how much the body is filled, and how much light gathers toward its edge (for the line: 1 and 0).
static const char* kGhostFragment = R"(
uniform vec4 uTint;
uniform float uOpacity;
uniform vec2 uLook;
in highp vec3 vNormal;
in highp vec3 vToEye;
in highp float vThere;
out vec4 frag;
void main() {
    float edge = 1.0 - abs(dot(normalize(vNormal), normalize(vToEye)));
    float a = clamp((uLook.x + uLook.y * edge * edge) * uOpacity * uTint.a * vThere, 0.0, 1.0);
    frag = vec4(uTint.rgb * a, a);
}
)";

static unsigned compile(GLenum type, const std::string& source, const char* name) {
    unsigned s = glCreateShader(type);
    const char* text = source.c_str();
    glShaderSource(s, 1, &text, nullptr);
    glCompileShader(s);
    GLint ok = 0;
    glGetShaderiv(s, GL_COMPILE_STATUS, &ok);
    if (!ok) {
        char log[2048] = {0};
        glGetShaderInfoLog(s, sizeof log - 1, nullptr, log);
        logLine(fmt("[render] shader %s (%s) failed: %s", name, type == GL_VERTEX_SHADER ? "vertex" : "fragment", log));
    }
    return s;
}

Renderer::Program Renderer::build(const char* name, const char* vertex, const char* fragment, bool external) {
    std::string vs, fs;
    if (MP_GLES) {
        vs = "#version 300 es\n";
        if (multiview) vs += "#extension GL_OVR_multiview2 : require\nlayout(num_views = 2) in;\n#define VIEW gl_ViewID_OVR\n";
        else vs += "#define VIEW 0\n";
        vs += "precision highp float;\n";
        fs = "#version 300 es\n";
        if (external) fs += "#extension GL_OES_EGL_image_external_essl3 : require\n#define SAMPLER mediump samplerExternalOES\n";
        else fs += "#define SAMPLER sampler2D\n";
        fs += "precision mediump float;\n";
    } else {
        vs = "#version 410 core\n#define VIEW 0\n";
        fs = "#version 410 core\n#define SAMPLER sampler2D\n";
    }
    vs += vertex;
    fs += kToLinear;
    fs += fragment;
    Program p;
    p.id = glCreateProgram();
    unsigned v = compile(GL_VERTEX_SHADER, vs, name), f = compile(GL_FRAGMENT_SHADER, fs, name);
    glAttachShader(p.id, v);
    glAttachShader(p.id, f);
    glLinkProgram(p.id);
    GLint ok = 0;
    glGetProgramiv(p.id, GL_LINK_STATUS, &ok);
    if (!ok) {
        char log[2048] = {0};
        glGetProgramInfoLog(p.id, sizeof log - 1, nullptr, log);
        logLine(fmt("[render] program %s failed to link: %s", name, log));
    }
    glDeleteShader(v);
    glDeleteShader(f);
    p.model = glGetUniformLocation(p.id, "uModel");
    p.viewProj = glGetUniformLocation(p.id, "uViewProj");
    p.tint = glGetUniformLocation(p.id, "uTint");
    p.useTexture = glGetUniformLocation(p.id, "uUseTexture");
    p.tex = glGetUniformLocation(p.id, "uTex");
    p.opacity = glGetUniformLocation(p.id, "uOpacity");
    p.threshold = glGetUniformLocation(p.id, "uThreshold");
    p.hover = glGetUniformLocation(p.id, "uHover");
    p.opaque = glGetUniformLocation(p.id, "uOpaque");
    p.time = glGetUniformLocation(p.id, "uTime");
    p.shift = glGetUniformLocation(p.id, "uShift");
    p.center = glGetUniformLocation(p.id, "uCenter");
    p.uvMatrix = glGetUniformLocation(p.id, "uUVMatrix");
    p.loading = glGetUniformLocation(p.id, "uLoading");
    p.additive = glGetUniformLocation(p.id, "uAdditive");
    p.eye = glGetUniformLocation(p.id, "uEye");
    p.swell = glGetUniformLocation(p.id, "uSwell");
    p.look = glGetUniformLocation(p.id, "uLook");
    return p;
}

static bool hasExtension(const char* name) {
    GLint n = 0;
    glGetIntegerv(GL_NUM_EXTENSIONS, &n);
    for (GLint i = 0; i < n; i++) {
        const char* e = (const char*)glGetStringi(GL_EXTENSIONS, GLuint(i));
        if (e && strcmp(e, name) == 0) return true;
    }
    return false;
}

static float maxAnisotropy = 0;
/// One white texel, bound when a material has no picture, so the sampler always has something.
static unsigned whiteTexture = 0;

void Renderer::init(bool multiviewOn) {
    multiview = multiviewOn;
    batching = !Flags::has("noBatch");
    if (Flags::has("uploadBudget")) uploadBudgetMs = Flags::number("uploadBudget");
    unlit = build("unlit", kVertex, kUnlitFragment);
    video = build("video", kVertex, kVideoFragment, MP_GLES != 0);
    line = build("line", kLineVertex, kLineFragment);
    dust = build("dust", kDustVertex, kDustFragment);
    glow = build("glow", kGlowVertex, kGlowFragment);
    ghost = build("ghost", kGhostVertex, kGhostFragment);
    glGenTextures(1, &whiteTexture);
    glBindTexture(GL_TEXTURE_2D, whiteTexture);
    const uint8_t white[4] = {255, 255, 255, 255};
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, 1, 1, 0, GL_RGBA, GL_UNSIGNED_BYTE, white);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
    timerSupported = MP_GLES ? hasExtension("GL_EXT_disjoint_timer_query") : true;
    if (timerSupported) glGenQueries(1, &timerQuery);
    if (hasExtension("GL_EXT_texture_filter_anisotropic")) {
        glGetFloatv(0x84FF /* GL_MAX_TEXTURE_MAX_ANISOTROPY_EXT */, &maxAnisotropy);
        maxAnisotropy = std::min(maxAnisotropy, 4.f);
    }
    logLine(fmt("[render] ready: %s, multiview %s, gpu timer %s, anisotropy %.0f", (const char*)glGetString(GL_RENDERER),
                multiview ? "on" : "off", timerSupported ? "yes" : "no", maxAnisotropy));
}

// MARK: - Uploads

void Renderer::freeDead() {
    auto& t = gpu::deadTextures();
    if (!t.empty()) {
        glDeleteTextures(GLsizei(t.size()), t.data());
        t.clear();
    }
    auto& b = gpu::deadBuffers();
    if (!b.empty()) {
        glDeleteBuffers(GLsizei(b.size()), b.data());
        b.clear();
    }
    auto& v = gpu::deadVertexArrays();
    if (!v.empty()) {
        glDeleteVertexArrays(GLsizei(v.size()), v.data());
        v.clear();
    }
}

void Renderer::upload(Texture* t) {
    if (!t->pending) return;
    Cost::Scope cost(Cost::texture);
    double began = mediaTime();
    struct Spent {
        double& total;
        double began;
        ~Spent() { total += (mediaTime() - began) * 1000; }
    } spent{uploadSpentMs, began};
    ImageRef image = std::move(t->pending);
    t->pending = nullptr;
    if (!t->gl) glGenTextures(1, &t->gl);
    glBindTexture(GL_TEXTURE_2D, t->gl);
    glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, image->width, image->height, 0, GL_RGBA, GL_UNSIGNED_BYTE, image->rgba.data());
    // Always with smaller copies: at the Quest's resolution a card is nearly always drawn smaller than its picture.
    glGenerateMipmap(GL_TEXTURE_2D);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR_MIPMAP_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
    if (maxAnisotropy > 1) glTexParameterf(GL_TEXTURE_2D, GL_TEXTURE_MAX_ANISOTROPY_EXT, maxAnisotropy);
    stats.textureUploads++;
}

void Renderer::upload(Mesh* m) {
    bool fresh = m->vao == 0;
    if (fresh) {
        glGenVertexArrays(1, &m->vao);
        glGenBuffers(1, &m->vbo);
        glGenBuffers(1, &m->ibo);
    }
    if (!fresh && !m->verticesDirty && !m->indicesDirty) return;
    glBindVertexArray(m->vao);
    if (m->isLowLevel()) {
        auto* low = static_cast<LowLevelMesh*>(m);
        if (m->verticesDirty || fresh) {
            // Only as far as the vertices the drawn indices reach: these buffers are sized for the most
            // there could ever be, and most frames use a small part.
            if (low->usedFor != low->indexCount || m->indicesDirty) {
                uint32_t top = 0;
                const uint32_t* idx = low->indexData.data();
                int n = std::min(low->indexCount, int(low->indexData.size()));
                for (int i = 0; i < n; i++) top = std::max(top, idx[i]);
                low->usedVertices = n > 0 ? std::min(int(top) + 1, low->descriptor.vertexCapacity) : 0;
                low->usedFor = low->indexCount;
            }
            size_t bytes = size_t(low->usedVertices) * low->descriptor.stride;
            glBindBuffer(GL_ARRAY_BUFFER, m->vbo);
            glBufferData(GL_ARRAY_BUFFER, GLsizeiptr(std::max(bytes, low->descriptor.stride)), low->vertexData.data(), GL_DYNAMIC_DRAW);
            stats.meshUploads++;
            stats.meshUploadBytes += int(bytes);
        }
        if (fresh) {
            glBindBuffer(GL_ARRAY_BUFFER, m->vbo);
            for (const auto& a : low->descriptor.vertexAttributes) {
                GLuint loc = a.semantic == LowLevelMesh::Semantic::position ? 0 : a.semantic == LowLevelMesh::Semantic::uv0 ? 1 : 2;
                glEnableVertexAttribArray(loc);
                glVertexAttribPointer(loc, a.components, GL_FLOAT, GL_FALSE, GLsizei(low->descriptor.stride), (const void*)a.offset);
            }
        }
        if (m->indicesDirty || fresh) {
            glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, m->ibo);
            glBufferData(GL_ELEMENT_ARRAY_BUFFER, GLsizeiptr(low->indexData.size() * 4), low->indexData.data(), GL_STATIC_DRAW);
        }
    } else {
        if (m->verticesDirty || fresh) {
            static std::vector<float> scratch;
            scratch.resize(m->positions.size() * 5);
            for (size_t i = 0; i < m->positions.size(); i++) {
                const Vec3& p = m->positions[i];
                Vec2 t = i < m->uvs.size() ? m->uvs[i] : Vec2{};
                float* o = &scratch[i * 5];
                o[0] = p.x; o[1] = p.y; o[2] = p.z; o[3] = t.x; o[4] = t.y;
            }
            glBindBuffer(GL_ARRAY_BUFFER, m->vbo);
            glBufferData(GL_ARRAY_BUFFER, GLsizeiptr(scratch.size() * 4), scratch.data(), GL_DYNAMIC_DRAW);
            glEnableVertexAttribArray(0);
            glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, 20, (const void*)0);
            glEnableVertexAttribArray(1);
            glVertexAttribPointer(1, 2, GL_FLOAT, GL_FALSE, 20, (const void*)12);
            stats.meshUploads++;
            stats.meshUploadBytes += int(scratch.size() * 4);
        }
        if (m->indicesDirty || fresh) {
            glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, m->ibo);
            glBufferData(GL_ELEMENT_ARRAY_BUFFER, GLsizeiptr(m->indices.size() * 4), m->indices.data(), GL_DYNAMIC_DRAW);
        }
    }
    m->verticesDirty = false;
    m->indicesDirty = false;
}

// MARK: - The frame

static bool isTransparent(const Material& m, float opacity) {
    return m.transparent || m.onTop || m.kind == Material::Kind::line || m.kind == Material::Kind::dust ||
           m.kind == Material::Kind::hoverGlow || m.kind == Material::Kind::ghost || opacity < 0.999f;
}

void Renderer::collect(const Entity* e, const Mat4& parent, float opacity, const Hover* hover, float hovered, const Views& views) {
    if (!e->isEnabled) return;
    Mat4 world = parent * Mat4::trs(e->position, e->orientation, e->scale);
    if (e->opacity) opacity *= std::min(1.f, std::max(0.f, *e->opacity));
    if (e->hover.kind != Hover::Kind::none) {
        hover = &e->hover;
        hovered = e->hovered;
    }
    if (e->model && e->model->mesh && !e->model->materials.empty() && opacity > 0.002f) {
        Mesh* mesh = e->model->mesh.get();
        const Material& material = e->model->materials[0];
        int count = mesh->isLowLevel() ? static_cast<LowLevelMesh*>(mesh)->indexCount : int(mesh->indices.size());
        bool drawn = count > 0;
        // A glow nobody is pointing at draws nothing.
        if (material.kind == Material::Kind::hoverGlow && hovered < 0.004f) drawn = false;
        if (material.kind == Material::Kind::video && !(material.video && material.video->ready())) drawn = false;
        Vec3 middle = world.point(mesh->bounds.center());
        float distance = length(middle - views.eye);
        if (drawn && views.cullCos > -1) {
            Vec3 ext = mesh->bounds.extents();
            float sx = length(world.columns[0].xyz()), sy = length(world.columns[1].xyz()), sz = length(world.columns[2].xyz());
            float radius = 0.5f * length(Vec3{ext.x * sx, ext.y * sy, ext.z * sz});
            if (distance > radius) {
                float sinR = radius / distance, cosR = std::sqrt(1 - sinR * sinR);
                float sinC = std::sqrt(std::max(0.f, 1 - views.cullCos * views.cullCos));
                float limit = views.cullCos * cosR - sinC * sinR;      // cos(cone + the sphere's own angle)
                float cosA = dot(middle - views.eye, views.forward) / distance;
                if (cosA < limit && std::acos(std::min(1.f, views.cullCos)) + std::asin(sinR) < float(M_PI)) {
                    drawn = false;
                    stats.culled++;
                }
            }
        }
        if (drawn) {
            Item item{e, mesh, &material, world, opacity, hovered, hover, distance, int(opaque.size() + transparent.size() + above.size())};
            bool see = isTransparent(material, opacity);
            if (Texture* texture = material.kind == Material::Kind::unlit ? material.texture.get() : nullptr) {
                if (!texture->gl) {
                    // Not on the GPU yet. If its pixels are still being drawn, nothing shows at first, then a placeholder.
                    if (texture->pending && !texture->wantedAt) texture->wantedAt = frameTime;
                    if (texture->pending && !texture->pending->ready.load()) {
                        double waited = frameTime - texture->wantedAt;
                        if (waited < placeholderAfter) drawn = false;
                        item.waiting = float(std::min(1.0, (waited - placeholderAfter) / 0.25));
                        see = true;
                    }
                } else if (texture->fadeFrom > 0) {
                    double since = frameTime - texture->fadeFrom;
                    if (since >= fadeIn) texture->fadeFrom = 0;
                    else {
                        item.appear = float(std::max(0.0, since / fadeIn));
                        see = true;
                    }
                }
            }
            if (drawn) (material.onTop ? above : see ? transparent : opaque).push_back(item);
        }
    }
    for (const auto& c : e->children) collect(c.get(), world, opacity, hover, hovered, views);
}

bool Renderer::gather(const Item& item) {
    const Material& m = *item.material;
    if (m.kind != Material::Kind::unlit || item.mesh->isLowLevel() || item.mesh->positions.size() > 32) return false;
    if (item.hover && item.hover->kind == Hover::Kind::highlight && item.hovered > 0.004f) return false;
    if (m.opacityThreshold > 0) return false;
    Texture* texture = m.texture.get();
    if (texture && ((texture->pending && !texture->pending->ready.load()) || texture->fadeFrom > 0)) return false;
    Batch* batch = nullptr;
    for (Batch& b : batches) {
        if (b.count == 0 && !batch) batch = &b;     // a free one, if none matches
        if (b.count > 0 && b.texture == texture && b.cull == m.cull && b.tint.r == m.color.r && b.tint.g == m.color.g &&
            b.tint.b == m.color.b && b.tint.a == m.color.a) {
            batch = &b;
            break;
        }
    }
    if (!batch) {
        if (batches.size() >= 24) return false;
        batches.emplace_back();
        batch = &batches.back();
    }
    if (batch->count == 0) {
        batch->texture = texture;
        batch->tint = m.color;
        batch->cull = m.cull;
    }
    const Mesh& mesh = *item.mesh;
    uint32_t base = uint32_t(batch->vertices.size() / 5);
    for (size_t i = 0; i < mesh.positions.size(); i++) {
        Vec3 p = item.world.point(mesh.positions[i]);
        Vec2 t = i < mesh.uvs.size() ? mesh.uvs[i] : Vec2{};
        batch->vertices.insert(batch->vertices.end(), {p.x, p.y, p.z, t.x, t.y});
    }
    for (uint32_t i : mesh.indices) batch->indices.push_back(base + i);
    batch->count++;
    return true;
}

void Renderer::drawBatches(const Mat4* viewProj) {
    static const float identity[16] = {1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1};
    for (Batch& b : batches) {
        if (b.count == 0) continue;
        if (b.texture && b.texture->pending) {
            if (!b.texture->pending->ready.load() || !mayUpload()) continue;
            upload(b.texture);
        }
        if (!b.vao) {
            glGenVertexArrays(1, &b.vao);
            glGenBuffers(1, &b.vbo);
            glGenBuffers(1, &b.ibo);
            glBindVertexArray(b.vao);
            glBindBuffer(GL_ARRAY_BUFFER, b.vbo);
            glEnableVertexAttribArray(0);
            glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, 20, (const void*)0);
            glEnableVertexAttribArray(1);
            glVertexAttribPointer(1, 2, GL_FLOAT, GL_FALSE, 20, (const void*)12);
        }
        glBindVertexArray(b.vao);
        glBindBuffer(GL_ARRAY_BUFFER, b.vbo);
        glBufferData(GL_ARRAY_BUFFER, GLsizeiptr(b.vertices.size() * 4), b.vertices.data(), GL_STREAM_DRAW);
        glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, b.ibo);
        glBufferData(GL_ELEMENT_ARRAY_BUFFER, GLsizeiptr(b.indices.size() * 4), b.indices.data(), GL_STREAM_DRAW);
        const Program& p = unlit;
        glUseProgram(p.id);
        glUniformMatrix4fv(p.viewProj, 2, GL_FALSE, viewProj[0].data());
        glUniformMatrix4fv(p.model, 1, GL_FALSE, identity);
        glUniformMatrix4fv(p.uvMatrix, 1, GL_FALSE, identity);
        glUniform1f(p.opacity, 1);
        glUniform1i(p.opaque, 1);
        Vec3 c = b.tint.linear();
        glUniform4f(p.tint, c.x, c.y, c.z, b.tint.a);
        glUniform1f(p.threshold, 0);
        glUniform1f(p.loading, 0);
        glUniform3f(p.hover, 0, 0, 0);
        bool textured = b.texture && b.texture->gl;
        glUniform1i(p.useTexture, textured ? 1 : 0);
        glBindTexture(GL_TEXTURE_2D, textured ? b.texture->gl : whiteTexture);
        glUniform1i(p.tex, 0);
        if (b.cull) {
            glEnable(GL_CULL_FACE);
            glCullFace(GL_BACK);
        } else {
            glDisable(GL_CULL_FACE);
        }
        glDrawElements(GL_TRIANGLES, GLsizei(b.indices.size()), GL_UNSIGNED_INT, nullptr);
        stats.drawCalls++;
        stats.triangles += int(b.indices.size() / 3);
        stats.batched += b.count;
        stats.meshUploadBytes += int(b.vertices.size() * 4);
    }
}

void Renderer::draw(const EntityRef& root, const Views& views, double time) {
    double began = mediaTime();
    stats.drawCalls = stats.triangles = stats.culled = stats.textureUploads = stats.meshUploads = stats.meshUploadBytes = stats.batched = 0;
    uploadSpentMs = 0;
    for (Batch& b : batches) {
        b.count = 0;
        b.vertices.clear();
        b.indices.clear();
    }
    freeDead();

    if (timerSupported && timerPending) {
        GLuint available = 0;
        glGetQueryObjectuiv(timerQuery, GL_QUERY_RESULT_AVAILABLE, &available);
        if (available) {
            GLuint ns = 0;
            glGetQueryObjectuiv(timerQuery, GL_QUERY_RESULT, &ns);
            stats.gpuMs = double(ns) / 1e6;
            timerPending = false;
        }
    }
    bool timing = timerSupported && !timerPending;
    if (timing) glBeginQuery(GL_TIME_ELAPSED_EXT, timerQuery);

    opaque.clear();
    transparent.clear();
    above.clear();
    frameTime = mediaTime();
    if (root) collect(root.get(), Mat4::identity(), 1, nullptr, 0, views);
    if (batching) {
        size_t kept = 0;
        for (size_t i = 0; i < opaque.size(); i++) {
            if (!gather(opaque[i])) opaque[kept++] = opaque[i];
        }
        opaque.resize(kept);
    }
    // Nearest first for what hides things, farthest first for what is seen through.
    std::stable_sort(opaque.begin(), opaque.end(), [](const Item& a, const Item& b) { return a.distance < b.distance; });
    std::stable_sort(transparent.begin(), transparent.end(), [](const Item& a, const Item& b) { return a.distance > b.distance; });
    std::stable_sort(above.begin(), above.end(), [](const Item& a, const Item& b) { return a.distance > b.distance; });
    double built = mediaTime();
    stats.buildMs = (built - began) * 1000;

    Mat4 viewProj[2];
    for (int i = 0; i < 2; i++) viewProj[i] = views.projection[std::min(i, views.count - 1)] * views.view[std::min(i, views.count - 1)];

    glEnable(GL_DEPTH_TEST);
    glDepthFunc(GL_LEQUAL);
    glActiveTexture(GL_TEXTURE0);
#if !MP_GLES
    glEnable(GL_FRAMEBUFFER_SRGB);
#endif
    glDisable(GL_BLEND);
    glDepthMask(GL_TRUE);
    for (const Item& item : opaque) submit(item, views, time, viewProj);
    drawBatches(viewProj);
    glEnable(GL_BLEND);
    glBlendFuncSeparate(GL_ONE, GL_ONE_MINUS_SRC_ALPHA, GL_ONE, GL_ONE_MINUS_SRC_ALPHA);
    for (const Item& item : transparent) submit(item, views, time, viewProj);
    // What draws over everything: with no depth test, which also writes none.
    glDisable(GL_DEPTH_TEST);
    for (const Item& item : above) submit(item, views, time, viewProj);
    glEnable(GL_DEPTH_TEST);
    if (veil < 0.999f) {
        // The whole picture, faded: one triangle over everything that multiplies what is there (colour
        // and alpha, so on the headset the room shows through) by `veil`.
        static const float identity[16] = {1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1};
        static const float both[32] = {1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1};
        if (!veilVao) {
            static const float corners[15] = {-1, -1, 0, 0, 0, 3, -1, 0, 0, 0, -1, 3, 0, 0, 0};
            glGenVertexArrays(1, &veilVao);
            glGenBuffers(1, &veilVbo);
            glBindVertexArray(veilVao);
            glBindBuffer(GL_ARRAY_BUFFER, veilVbo);
            glBufferData(GL_ARRAY_BUFFER, sizeof corners, corners, GL_STATIC_DRAW);
            glEnableVertexAttribArray(0);
            glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, 20, (const void*)0);
            glEnableVertexAttribArray(1);
            glVertexAttribPointer(1, 2, GL_FLOAT, GL_FALSE, 20, (const void*)12);
        }
        const Program& p = unlit;
        glUseProgram(p.id);
        glBindVertexArray(veilVao);
        glUniformMatrix4fv(p.viewProj, 2, GL_FALSE, both);
        glUniformMatrix4fv(p.model, 1, GL_FALSE, identity);
        glUniformMatrix4fv(p.uvMatrix, 1, GL_FALSE, identity);
        glUniform1f(p.opacity, std::max(0.f, veil));
        glUniform1i(p.opaque, 0);
        glUniform4f(p.tint, 0, 0, 0, 1);
        glUniform1f(p.threshold, 0);
        glUniform1f(p.loading, 0);
        glUniform3f(p.hover, 0, 0, 0);
        glUniform1i(p.useTexture, 0);
        glBindTexture(GL_TEXTURE_2D, whiteTexture);
        glDisable(GL_DEPTH_TEST);
        glDisable(GL_CULL_FACE);
        glDepthMask(GL_FALSE);
        glBlendFuncSeparate(GL_ZERO, GL_SRC_ALPHA, GL_ZERO, GL_SRC_ALPHA);
        glDrawArrays(GL_TRIANGLES, 0, 3);
        glEnable(GL_DEPTH_TEST);
        stats.drawCalls++;
    }
    glDepthMask(GL_TRUE);
    glDisable(GL_BLEND);
    glBindVertexArray(0);
    glUseProgram(0);

    if (timing) {
        glEndQuery(GL_TIME_ELAPSED_EXT);
        timerPending = true;
    }
    stats.submitMs = (mediaTime() - built) * 1000;
}

void Renderer::submit(const Item& item, const Views& views, double time, const Mat4* viewProj) {
    const Material& m = *item.material;
    bool see = isTransparent(m, item.opacity) || item.appear < 1;
    Texture* texture = nullptr;
    const Program* p = &unlit;
    switch (m.kind) {
    case Material::Kind::unlit: texture = m.texture.get(); break;
    case Material::Kind::line: p = &line; break;
    case Material::Kind::dust: p = &dust; break;
    case Material::Kind::hoverGlow: p = &glow; break;
    case Material::Kind::ghost: p = &ghost; break;
    case Material::Kind::video: {
        p = &video;
        static TextureRef frame;
        frame = m.video->texture();
        texture = frame.get();
        if (!texture || !texture->gl) return;
        break;
    }
    }
    bool placeholder = false;
    if (texture && texture->pending) {
        if (!texture->pending->ready.load() || !mayUpload()) {
            // Still on its way (or its turn to be sent has not come): a placeholder if it has been long, else nothing.
            if (item.waiting <= 0) return;
            placeholder = true;
            texture = nullptr;
        } else {
            double waited = texture->wantedAt ? frameTime - texture->wantedAt : 0;
            upload(texture);
            // It was long enough in coming to have been noticed: let it in gently, from the next frame.
            if (waited > gentleAfter) {
                texture->fadeFrom = frameTime;
                if (item.waiting <= 0) return;
                placeholder = true;
                texture = nullptr;
            }
        }
    }
    upload(item.mesh);

    glUseProgram(p->id);
    glUniformMatrix4fv(p->viewProj, 2, GL_FALSE, viewProj[0].data());
    glUniformMatrix4fv(p->model, 1, GL_FALSE, item.world.data());
    if (p->opacity >= 0) glUniform1f(p->opacity, (m.transparent ? m.opacity : 1) * item.opacity * item.appear);
    if (p->additive >= 0) glUniform1f(p->additive, m.additive ? 1 : 0);
    if (p->opaque >= 0) glUniform1i(p->opaque, see && !placeholder ? 0 : 1);
    if (p->loading >= 0) glUniform1f(p->loading, placeholder ? std::max(0.02f, item.waiting) : 0);
    if (placeholder && p->opaque >= 0) glUniform1i(p->opaque, 0);
    if (p->tint >= 0) {
        Vec3 c = m.color.linear();
        glUniform4f(p->tint, c.x, c.y, c.z, m.color.a);
    }
    if (p->threshold >= 0) glUniform1f(p->threshold, m.opacityThreshold);
    if (p->uvMatrix >= 0) {
        static const float identity[16] = {1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1};
        glUniformMatrix4fv(p->uvMatrix, 1, GL_FALSE, texture && m.kind == Material::Kind::video ? texture->uvTransform : identity);
    }
    if (p->hover >= 0) {
        if (m.kind == Material::Kind::hoverGlow) {
            glUniform3f(p->hover, item.hovered, 0, 0);
        } else if (item.hover && item.hover->kind == Hover::Kind::highlight && item.hovered > 0.004f) {
            Vec3 c = item.hover->color.linear() * (item.hover->strength * highlightGain * item.hovered);
            glUniform3f(p->hover, c.x, c.y, c.z);
        } else {
            glUniform3f(p->hover, 0, 0, 0);
        }
    }
    if (p->time >= 0) glUniform1f(p->time, float(std::fmod(time, 3600.0)));
    if (p->shift >= 0) {
        auto it = m.parameters.find("Shift");
        glUniform1f(p->shift, it == m.parameters.end() ? 0 : it->second.x);
    }
    if (p->center >= 0) {
        auto it = m.parameters.find("Center");
        Vec4 c = it == m.parameters.end() ? Vec4{0, 1.5f, 0, 0} : it->second;
        glUniform3f(p->center, c.x, c.y, c.z);
    }
    if (p->useTexture >= 0) glUniform1i(p->useTexture, texture && texture->gl ? 1 : 0);
    if (texture && texture->gl) {
        glBindTexture(texture->external ? GL_TEXTURE_EXTERNAL_OES : GL_TEXTURE_2D, texture->gl);
        if (p->tex >= 0) glUniform1i(p->tex, 0);
    } else if (p->tex >= 0) {
        glBindTexture(GL_TEXTURE_2D, whiteTexture);
        glUniform1i(p->tex, 0);
    }
    if (m.cull) {
        glEnable(GL_CULL_FACE);
        glCullFace(GL_BACK);
    } else {
        glDisable(GL_CULL_FACE);
    }
    glDepthMask(m.writesDepth && !placeholder ? GL_TRUE : GL_FALSE);

    int count = item.mesh->isLowLevel() ? static_cast<LowLevelMesh*>(item.mesh)->indexCount : int(item.mesh->indices.size());
    glBindVertexArray(item.mesh->vao);
    if (m.kind == Material::Kind::ghost) {
        // Three times over: its shape, unseen, so that what is in front covers what is behind; then its
        // body, faintly; then its edge, which is the far side of the shape swollen by the line's weight.
        auto number = [&](const char* name, float otherwise) {
            auto it = m.parameters.find(name);
            return it == m.parameters.end() ? otherwise : it->second.x;
        };
        Vec3 eyes[2];
        for (int i = 0; i < 2; i++) eyes[i] = views.view[std::min(i, views.count - 1)].inverse().position();
        glUniform3fv(p->eye, 2, &eyes[0].x);
        glEnable(GL_CULL_FACE);
        for (int pass = 0; pass < 3; pass++) {
            glColorMask(pass > 0, pass > 0, pass > 0, pass > 0);
            glDepthMask(pass == 0 ? GL_TRUE : GL_FALSE);
            glDepthFunc(pass == 1 ? GL_LEQUAL : GL_LESS);
            glCullFace(pass == 2 ? GL_FRONT : GL_BACK);
            glUniform1f(p->swell, pass == 2 ? number("Line", 0.0012f) : 0);
            glUniform2f(p->look, pass == 2 ? 1 : number("Fill", 0.03f), pass == 2 ? 0 : number("Glow", 0.1f));
            glDrawElements(GL_TRIANGLES, count, GL_UNSIGNED_INT, nullptr);
            stats.drawCalls++;
        }
        glColorMask(GL_TRUE, GL_TRUE, GL_TRUE, GL_TRUE);
        glDepthFunc(GL_LEQUAL);
        glCullFace(GL_BACK);
        stats.triangles += count;
        return;
    }
    glDrawElements(GL_TRIANGLES, count, GL_UNSIGNED_INT, nullptr);
    stats.drawCalls++;
    stats.triangles += count / 3;
}
