// The renderer: draws a tree of entities (scene.h) with OpenGL ES 3 on the
// Quest (both eyes in one pass, multiview) and OpenGL 4.1 in the Mac preview.
//
// It follows what RealityKit does on visionOS closely enough that the ported
// sources layer the same way:
// - Everything is unlit. Colours and textures are sRGB, blended in linear light.
// - Opaque things are drawn first. Transparent things (a material with
//   `.transparent` blending, a shader-graph material, or anything under an
//   OpacityComponent below 1) are drawn after, farthest first, ordered by
//   the middle of each mesh's bounds.
// - A transparent material still writes depth unless it says otherwise
//   (`writesDepth = false`), and `opacityThreshold` discards texels more
//   see-through than it. The sources rely on both.
#pragma once
#include "scene.h"

struct Views {
    int count = 1;              // 2 on the headset
    Mat4 view[2];               // world to eye
    Mat4 projection[2];
    Vec3 eye;                   // the head: what distances are sorted from
    Vec3 forward{0, 0, -1};     // where it points
    float cullCos = -1;         // things whose bounds lie wholly outside this cone of `forward` are skipped; -1 draws everything
};

class Renderer {
public:
    /// Once, with the GL context current. `multiview`: draw both eyes in one pass (GL_OVR_multiview2).
    void init(bool multiview);
    /// Draws into the framebuffer that is bound, with the viewport already set.
    /// `time` is seconds since the app started (the shader graphs' Time).
    void draw(const EntityRef& root, const Views& views, double time);

    struct Stats {
        int drawCalls = 0;
        int batched = 0;            // small opaque pictures drawn together instead of one call each
        int triangles = 0;
        int culled = 0;
        int textureUploads = 0;
        int meshUploads = 0;        // vertex buffers rewritten this frame
        int meshUploadBytes = 0;
        double buildMs = 0;         // walking the tree and sorting
        double submitMs = 0;        // issuing GL calls
        double gpuMs = 0;           // the GPU's time for a recent frame, if the driver reports it
    };
    Stats stats;

    /// How brightly a `.highlight` hover lights its entity at full strength 1.
    float highlightGain = 0.10f;
    /// Draw small opaque pictures that share a texture in one call (`-noBatch` turns it off, to compare).
    bool batching = true;
    /// Milliseconds a frame may spend sending new pictures to the GPU (`-uploadBudget <ms>`). Once it is
    /// spent, what still waits is sent on the next frames, and is not drawn until it has been: a step
    /// that makes a dozen cards costs a dozen frames a little each instead of one frame a lot.
    double uploadBudgetMs = 3;
    /// A picture that has been on its way longer than `placeholderAfter` seconds shows as a faint shimmer
    /// where it will be; one that took longer than `gentleAfter` fades in over `fadeIn` when it arrives.
    /// Anything quicker simply appears, so most cards never show either.
    double placeholderAfter = 0.15, gentleAfter = 0.12, fadeIn = 0.25;

private:
    struct Program {
        unsigned id = 0;
        int model = -1, viewProj = -1, tint = -1, useTexture = -1, tex = -1, opacity = -1, threshold = -1;
        int hover = -1, opaque = -1, time = -1, shift = -1, center = -1, uvMatrix = -1, loading = -1;
    };
    struct Item {
        const Entity* entity;
        Mesh* mesh;
        const Material* material;
        Mat4 world;
        float opacity;
        float hovered;
        const Hover* hover;
        float distance;
        int order;
        float waiting = 0;      // its picture is not there yet: how strongly the placeholder shows, 0…1
        float appear = 1;       // its picture has just arrived: how far it has faded in, 0…1
    };
    /// Small opaque pictures that share a texture and a tint, gathered into one mesh in world space
    /// each frame and drawn with one call: the ocean's hundreds of pieces are two of these.
    struct Batch {
        Texture* texture = nullptr;
        Color tint;
        bool cull = true;
        std::vector<float> vertices;        // x y z u v
        std::vector<uint32_t> indices;
        unsigned vao = 0, vbo = 0, ibo = 0;
        int count = 0;                      // pictures in it this frame
    };
    std::vector<Batch> batches;
    bool multiview = false;
    Program unlit, line, dust, glow, video;
    std::vector<Item> opaque, transparent;
    double uploadSpentMs = 0;
    double frameTime = 0;
    /// Whether a picture still waiting may be sent this frame; false means leave what uses it undrawn for now.
    bool mayUpload() const { return stats.textureUploads == 0 || uploadSpentMs < uploadBudgetMs; }
    unsigned timerQuery = 0;
    bool timerPending = false, timerSupported = false;

    Program build(const char* name, const char* vertex, const char* fragment, bool external = false);
    void collect(const Entity* e, const Mat4& parent, float opacity, const Hover* hover, float hovered, const Views& views);
    void upload(Mesh* mesh);
    void upload(Texture* texture);
    void submit(const Item& item, const Views& views, double time, const Mat4* viewProj);
    void freeDead();
    bool gather(const Item& item);
    void drawBatches(const Mat4* viewProj);
};
