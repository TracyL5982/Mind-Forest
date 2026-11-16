#include "take.h"

#include <sys/stat.h>
#include <zlib.h>

#include <algorithm>
#include <atomic>
#include <condition_variable>
#include <cstring>
#include <deque>
#include <mutex>
#include <thread>
#include <unordered_map>
#include <unordered_set>

#include "base.h"

namespace take {
namespace {

constexpr char magic[8] = {'M', 'P', 'T', 'A', 'K', 'E', '0', '1'};
constexpr uint32_t tag(const char* s) { return uint32_t(s[0]) | uint32_t(s[1]) << 8 | uint32_t(s[2]) << 16 | uint32_t(s[3]) << 24; }
constexpr uint32_t kHead = tag("HEAD"), kMesh = tag("MESH"), kTexture = tag("TEXR"), kVideo = tag("VIDE"), kFrame = tag("FRAM"),
                   kSync = tag("SYNC"), kTail = tag("TAIL"), kCameras = tag("CAMI"), kCamera = tag("CAMR");
constexpr uint32_t sameKeys = 0xFFFFFFFF;
constexpr int jointCount = int(platform::Joint::count);

/// One drawn model, as a frame spells it out. Only models whose record differs from the one last
/// written are written again, so a still scene costs a frame almost nothing.
#pragma pack(push, 1)
struct Item {
    uint32_t key = 0;               // the entity's serial
    uint32_t mesh = 0;              // a MESH's serial
    uint32_t texture = 0;           // a TEXR's serial, or 0
    uint32_t video = 0;             // a VIDE's serial, or 0
    float world[16] = {0};
    float opacity = 1, hovered = 0, loading = 0;
    uint8_t kind = 0;               // Material::Kind
    uint8_t hoverKind = 0;          // Hover::Kind
    uint8_t flags = 0;              // 1 transparent, 2 cull, 4 writes depth, 8 additive
    uint8_t has = 0;                // which parameters are set: 1 Shift, 2 Center, 4 Line, 8 Fill, 16 Glow
    float color[4] = {1, 1, 1, 1};
    float hoverColor[4] = {1, 1, 1, 1};
    float hoverStrength = 1;
    float materialOpacity = 1, threshold = 0;
    float shift = 0, center[3] = {0, 0, 0}, line = 0, fill = 0, glow = 0;
};
#pragma pack(pop)

/// Bytes being put together, and bytes being taken apart.
struct Out {
    std::vector<uint8_t> d;
    void raw(const void* p, size_t n) {
        const uint8_t* b = static_cast<const uint8_t*>(p);
        d.insert(d.end(), b, b + n);
    }
    template <class T>
    void put(const T& v) { raw(&v, sizeof v); }
    void matrix(const Mat4& m) { raw(m.data(), 64); }
};
struct In {
    const uint8_t* p;
    const uint8_t* end;
    bool ok = true;
    bool raw(void* to, size_t n) {
        if (size_t(end - p) < n) {
            ok = false;
            std::memset(to, 0, n);
            return false;
        }
        std::memcpy(to, p, n);
        p += n;
        return true;
    }
    template <class T>
    T get() {
        T v;
        raw(&v, sizeof v);
        return v;
    }
    Mat4 matrix() {
        Mat4 m;
        raw(&m.columns[0].x, 64);
        return m;
    }
    void skip(size_t n) {
        if (size_t(end - p) < n) ok = false; else p += n;
    }
};

void writeMoment(Out& o, const Moment& m) {
    o.put(m.time);
    o.put(m.appTime);
    o.put(m.veil);
    o.put(m.dim);
    o.put(uint8_t(m.head ? 1 : 0));
    o.matrix(m.head.value_or(Mat4()));
    o.put(uint8_t(m.sheet ? 1 : 0));
    o.matrix(m.sheet.value_or(Mat4()));
    for (int h = 0; h < 2; h++) {
        o.put(uint8_t(m.handTracked[h] ? 1 : 0));
        o.raw(m.joints[h], sizeof(Vec3) * jointCount);
    }
}

Moment readMoment(In& in) {
    Moment m;
    m.time = in.get<double>();
    m.appTime = in.get<double>();
    m.veil = in.get<float>();
    m.dim = in.get<float>();
    bool head = in.get<uint8_t>() != 0;
    Mat4 at = in.matrix();
    if (head) m.head = at;
    bool sheet = in.get<uint8_t>() != 0;
    at = in.matrix();
    if (sheet) m.sheet = at;
    for (int h = 0; h < 2; h++) {
        m.handTracked[h] = in.get<uint8_t>() != 0;
        in.raw(m.joints[h], sizeof(Vec3) * jointCount);
    }
    return m;
}

}  // namespace

// MARK: - Writing

struct Recorder::Impl {
    struct Piece {
        uint32_t tag = 0;
        std::vector<uint8_t> body;
        size_t deflateFrom = 0;         // above 0: the body from here on is deflated before it is written
    };
    std::string folder;
    FILE* file = nullptr;
    std::thread writer;
    std::mutex guard;
    std::condition_variable wake;
    std::deque<Piece> queue;
    std::atomic<size_t> waiting{0};     // bytes queued and not yet written
    std::atomic<size_t> written{0};
    bool closing = false;

    struct MeshState {
        uint32_t revision = 0;
        int count = -1;
        uint32_t writtenAt = 0;         // the frame it was last written in
    };
    std::unordered_map<uint32_t, MeshState> meshes;
    std::unordered_set<uint32_t> textures, videos;
    std::unordered_map<uint32_t, Item> last;
    std::vector<uint32_t> keys;
    // The picture being read back: a large one takes several frames, a band at a time.
    uint32_t reading = 0;
    int readRows = 0;
    std::vector<uint8_t> readInto;
    size_t readFrom = 0;
    uint32_t frameNumber = 0;
    int frames = 0, pictures = 0;
    double lastTime = 0;

    void push(uint32_t tag, std::vector<uint8_t> body, size_t deflateFrom = 0) {
        waiting.fetch_add(body.size());
        {
            std::lock_guard<std::mutex> lock(guard);
            queue.push_back({tag, std::move(body), deflateFrom});
        }
        wake.notify_one();
    }

    /// The writing thread: nothing of the file is touched on the frame thread.
    void run() {
        for (;;) {
            Piece piece;
            {
                std::unique_lock<std::mutex> lock(guard);
                wake.wait(lock, [&] { return closing || !queue.empty(); });
                if (queue.empty()) return;
                piece = std::move(queue.front());
                queue.pop_front();
            }
            size_t was = piece.body.size();
            if (piece.deflateFrom > 0 && piece.body.size() > piece.deflateFrom) {
                // Fastest setting: a card's picture is mostly flat colour and shrinks many times over.
                uLongf room = compressBound(uLong(piece.body.size() - piece.deflateFrom));
                std::vector<uint8_t> packed(piece.deflateFrom + room);
                std::memcpy(packed.data(), piece.body.data(), piece.deflateFrom);
                if (compress2(packed.data() + piece.deflateFrom, &room, piece.body.data() + piece.deflateFrom,
                              uLong(piece.body.size() - piece.deflateFrom), 1) == Z_OK) {
                    packed.resize(piece.deflateFrom + room);
                    piece.body = std::move(packed);
                }
            }
            uint32_t length = uint32_t(piece.body.size());
            fwrite(&piece.tag, 4, 1, file);
            fwrite(&length, 4, 1, file);
            fwrite(piece.body.data(), 1, piece.body.size(), file);
            written.fetch_add(8 + piece.body.size());
            waiting.fetch_sub(was);
        }
    }

    /// A mesh the app rewrites (a LowLevelMesh) mostly changes a little at a time: it is written as
    /// what differs from the version before, which deflates to a fraction of the whole.
    std::unordered_map<uint32_t, std::vector<uint8_t>> meshBefore;

    void writeMesh(Mesh* mesh, int count) {
        Out o;
        o.put(uint8_t(mesh->isLowLevel() ? 1 : 0));
        o.put(mesh->bounds);
        if (mesh->isLowLevel()) {
            auto* low = static_cast<LowLevelMesh*>(mesh);
            int n = std::max(0, std::min(count, int(low->indexData.size())));
            uint32_t top = 0;
            for (int i = 0; i < n; i++) top = std::max(top, low->indexData[size_t(i)]);
            uint32_t used = n > 0 ? std::min(top + 1, uint32_t(low->descriptor.vertexCapacity)) : 0;
            o.put(uint32_t(low->descriptor.stride));
            o.put(uint32_t(low->descriptor.vertexAttributes.size()));
            for (const auto& a : low->descriptor.vertexAttributes) {
                o.put(uint8_t(a.semantic));
                o.put(uint8_t(a.components));
                o.put(uint16_t(a.offset));
            }
            o.put(used);
            size_t at = o.d.size();
            o.raw(low->vertexData.data(), size_t(used) * low->descriptor.stride);
            // Every number in a vertex is a float: its last eight bits are dropped (a part in thirty thousand, far
            // below what can be seen), so that a mesh that barely moved differs from its last version in few bytes.
            if (low->descriptor.stride % 4 == 0) {
                for (size_t i = at; i + 3 < o.d.size(); i += 4) o.d[i] = 0;
            }
            o.put(uint32_t(n));
            o.raw(low->indexData.data(), size_t(n) * 4);
        } else {
            o.put(uint32_t(mesh->positions.size()));
            o.raw(mesh->positions.data(), mesh->positions.size() * sizeof(Vec3));
            o.put(uint32_t(mesh->uvs.size()));
            o.raw(mesh->uvs.data(), mesh->uvs.size() * sizeof(Vec2));
            o.put(uint32_t(mesh->indices.size()));
            o.raw(mesh->indices.data(), mesh->indices.size() * 4);
        }
        Out piece;
        piece.put(mesh->serial);
        piece.put(uint32_t(o.d.size()));
        bool against = false;
        if (mesh->isLowLevel()) {
            std::vector<uint8_t>& before = meshBefore[mesh->serial];
            against = before.size() == o.d.size();
            std::vector<uint8_t> now = o.d;
            if (against) {
                for (size_t i = 0; i < o.d.size(); i++) o.d[i] ^= before[i];
            }
            before = std::move(now);
        }
        piece.put(uint8_t(against ? 1 : 0));
        size_t from = piece.d.size();
        piece.raw(o.d.data(), o.d.size());
        push(kMesh, std::move(piece.d), from);
    }
};

Recorder::Recorder() : impl(new Impl) {}
Recorder::~Recorder() { end(); }

bool Recorder::on() const { return impl->file != nullptr; }
const std::string& Recorder::folder() const { return impl->folder; }

bool Recorder::begin(const std::string& folder, const std::string& about) {
    end();
    // (Every folder on the way, as `mkdir -p` makes them.)
    for (size_t at = 1; at <= folder.size(); at++) {
        if (at == folder.size() || folder[at] == '/') mkdir(folder.substr(0, at).c_str(), 0775);
    }
    impl->file = fopen((folder + "/take.bin").c_str(), "wb");
    if (!impl->file) {
        logLine("[take] could not write in " + folder);
        return false;
    }
    setvbuf(impl->file, nullptr, _IOFBF, 1 << 20);
    fwrite(magic, 1, 8, impl->file);
    impl->folder = folder;
    impl->closing = false;
    impl->meshes.clear();
    impl->meshBefore.clear();
    impl->textures.clear();
    impl->videos.clear();
    impl->last.clear();
    impl->keys.clear();
    impl->frames = impl->pictures = 0;
    impl->reading = 0;
    impl->frameNumber = 0;
    impl->written = 8;
    impl->writer = std::thread([this] { impl->run(); });
    std::string head = "{\"format\":1," + about + "}";
    impl->push(kHead, std::vector<uint8_t>(head.begin(), head.end()));
    logLine("[take] recording into " + folder);
    return true;
}

void Recorder::sync(double time) {
    if (!on()) return;
    Out o;
    o.put(time);
    impl->push(kSync, std::move(o.d));
    logLine(fmt("[take] sync sound at %.4f s", time));
}

void Recorder::extra(const char* tag4, const void* bytes, size_t count) {
    if (!on()) return;
    const uint8_t* b = static_cast<const uint8_t*>(bytes);
    impl->push(tag(tag4), std::vector<uint8_t>(b, b + count));
}

void Recorder::frame(Renderer& renderer, const Moment& moment) {
    if (!on()) return;
    Impl& s = *impl;
    // In the tree's order, which is what settles ties when they are drawn again.
    std::vector<const Renderer::Drawn*> drawn;
    drawn.reserve(renderer.drawn.size());
    for (const auto& d : renderer.drawn) {
        // (What is only for the person in the headset is not written down.)
        bool filmed = true;
        for (const Entity* e = d.entity; e && filmed; e = e->parent) filmed = !e->unfilmed;
        if (filmed) drawn.push_back(&d);
    }
    std::sort(drawn.begin(), drawn.end(), [](const Renderer::Drawn* a, const Renderer::Drawn* b) { return a->order < b->order; });

    // Meshes: when first drawn, and again whenever the renderer has sent one to the GPU again.
    for (const Renderer::Drawn* d : drawn) {
        Mesh* mesh = d->mesh;
        int count = mesh->isLowLevel() ? static_cast<LowLevelMesh*>(mesh)->indexCount : int(mesh->indices.size());
        Impl::MeshState& state = s.meshes[mesh->serial];
        if (state.count < 0 || state.revision != mesh->revision || state.count != count) {
            // A large mesh that changes every frame is written every other frame: half the bytes, and nothing a film's frame rate shows.
            bool large = mesh->isLowLevel() && size_t(count) * 4 + static_cast<LowLevelMesh*>(mesh)->vertexData.size() > (64u << 10);
            if (large && state.count == count && state.writtenAt + 1 == s.frameNumber) continue;
            s.writeMesh(mesh, count);
            state = {mesh->revision, count, s.frameNumber};
        }
    }
    s.frameNumber++;
    // Pictures: read back from the GPU, where they live once sent (their pixels are not kept), a few
    // milliseconds' worth a frame, and none while the file is far behind. A take's first seconds do most of it.
    static const double budgetMs = Flags::has("takeBudget") ? Flags::number("takeBudget") : 2.5;
    double began = mediaTime();
    bool readingSeen = false;
    for (const Renderer::Drawn* d : drawn) {
        Texture* t = d->material->kind == Material::Kind::video ? nullptr : d->texture;
        if (!t || t->external || !t->gl || s.textures.count(t->serial)) continue;
        // One at a time: the one begun is finished before another is started.
        if (s.reading && s.reading != t->serial) continue;
        readingSeen = true;
        if (s.waiting.load() > (96u << 20)) break;
        if (!s.reading) {
            Out o;
            o.put(t->serial);
            o.put(uint32_t(t->width));
            o.put(uint32_t(t->height));
            o.put(uint8_t(t->mipmaps ? 1 : 0));
            s.readFrom = o.d.size();
            s.readInto = std::move(o.d);
            s.readInto.resize(s.readFrom + size_t(t->width) * t->height * 4);
            s.reading = t->serial;
            s.readRows = 0;
        }
        // About a megabyte a band, so that no one band is long.
        int band = std::max(16, (1 << 20) / (t->width * 4));
        bool failed = false;
        while (s.readRows < t->height && (mediaTime() - began) * 1000 < budgetMs) {
            int rows = std::min(band, t->height - s.readRows);
            if (!renderer.read(t, s.readRows, rows, s.readInto.data() + s.readFrom + size_t(s.readRows) * t->width * 4)) {
                failed = true;
                break;
            }
            s.readRows += rows;
        }
        if (failed) {
            s.textures.insert(t->serial);       // not to be tried every frame; whoever plays the take leaves its model out
            s.reading = 0;
            continue;
        }
        if (s.readRows < t->height) break;      // the rest on the next frames
        s.push(kTexture, std::move(s.readInto), s.readFrom);
        s.readInto = {};
        s.textures.insert(t->serial);
        s.pictures++;
        s.reading = 0;
        if ((mediaTime() - began) * 1000 > budgetMs) break;
    }
    // (The one being read is no longer drawn: it is let go, and begun again if it is drawn again.)
    if (s.reading && !readingSeen) {
        s.reading = 0;
        s.readInto = {};
    }

    Out o;
    writeMoment(o, moment);
    // Films: which are showing and how far in each is.
    std::vector<VideoPlayer*> films;
    for (const Renderer::Drawn* d : drawn) {
        VideoPlayer* v = d->material->kind == Material::Kind::video ? d->material->video.get() : nullptr;
        if (!v || std::find(films.begin(), films.end(), v) != films.end()) continue;
        films.push_back(v);
        if (s.videos.insert(v->serial).second) {
            Out film;
            film.put(v->serial);
            film.raw(v->source.data(), v->source.size());
            s.push(kVideo, std::move(film.d));
        }
    }
    o.put(uint32_t(films.size()));
    for (VideoPlayer* v : films) {
        o.put(v->serial);
        o.put(double(v->currentTime()));
    }

    std::vector<uint32_t> keys;
    keys.reserve(drawn.size());
    // Each changed model: its key, then 1 and the whole record, or 2 and only where it is (most of
    // a frame's changes are things drifting: twelve bytes each instead of the lot).
    Out changes;
    uint32_t changed = 0;
    for (const Renderer::Drawn* d : drawn) {
        const Material& m = *d->material;
        Item item;
        item.key = d->entity->serial;
        item.mesh = d->mesh->serial;
        bool film = m.kind == Material::Kind::video;
        item.texture = !film && d->texture ? d->texture->serial : 0;
        item.video = film && m.video ? m.video->serial : 0;
        std::memcpy(item.world, d->world.data(), 64);
        item.opacity = d->opacity;
        item.hovered = d->hover ? d->hovered : 0;
        item.loading = d->loading;
        item.kind = uint8_t(m.kind);
        if (d->hover) {
            item.hoverKind = uint8_t(d->hover->kind);
            const Color& c = d->hover->color;
            item.hoverColor[0] = c.r; item.hoverColor[1] = c.g; item.hoverColor[2] = c.b; item.hoverColor[3] = c.a;
            item.hoverStrength = d->hover->strength;
        }
        item.flags = uint8_t((m.transparent ? 1 : 0) | (m.cull ? 2 : 0) | (m.writesDepth ? 4 : 0) | (m.additive ? 8 : 0));
        item.color[0] = m.color.r; item.color[1] = m.color.g; item.color[2] = m.color.b; item.color[3] = m.color.a;
        item.materialOpacity = m.opacity;
        item.threshold = m.opacityThreshold;
        for (const auto& [name, value] : m.parameters) {
            if (name == "Shift") { item.has |= 1; item.shift = value.x; }
            else if (name == "Center") { item.has |= 2; item.center[0] = value.x; item.center[1] = value.y; item.center[2] = value.z; }
            else if (name == "Line") { item.has |= 4; item.line = value.x; }
            else if (name == "Fill") { item.has |= 8; item.fill = value.x; }
            else if (name == "Glow") { item.has |= 16; item.glow = value.x; }
        }
        keys.push_back(item.key);
        auto found = s.last.find(item.key);
        if (found != s.last.end() && std::memcmp(&found->second, &item, sizeof item) == 0) continue;
        changed++;
        changes.put(item.key);
        if (found != s.last.end()) {
            Item moved = found->second;
            std::memcpy(moved.world + 12, item.world + 12, 12);
            if (std::memcmp(&moved, &item, sizeof item) == 0) {
                changes.put(uint8_t(2));
                changes.raw(item.world + 12, 12);
                found->second = item;
                continue;
            }
        }
        changes.put(uint8_t(1));
        changes.put(item);
        s.last[item.key] = item;
    }
    if (keys == s.keys && s.frames > 0) {
        o.put(sameKeys);
    } else {
        o.put(uint32_t(keys.size()));
        o.raw(keys.data(), keys.size() * 4);
        // What is no longer drawn is forgotten, so that if it is drawn again it is spelled out again.
        if (s.last.size() > keys.size() * 2 + 64) {
            std::unordered_set<uint32_t> now(keys.begin(), keys.end());
            for (auto it = s.last.begin(); it != s.last.end();) it = now.count(it->first) ? std::next(it) : s.last.erase(it);
        }
        s.keys = keys;
    }
    o.put(changed);
    o.raw(changes.d.data(), changes.d.size());
    s.push(kFrame, std::move(o.d));
    s.frames++;
    s.lastTime = moment.time;
}

void Recorder::end() {
    if (!on()) return;
    Out o;
    o.put(uint32_t(impl->frames));
    o.put(impl->lastTime);
    impl->push(kTail, std::move(o.d));
    {
        std::lock_guard<std::mutex> lock(impl->guard);
        impl->closing = true;
    }
    impl->wake.notify_one();
    impl->writer.join();
    fclose(impl->file);
    impl->file = nullptr;
    logLine("[take] done: " + describe() + ", in " + impl->folder);
}

std::string Recorder::describe() const {
    return fmt("%d frames, %d pictures, %.1f MB written, %.1f MB waiting", impl->frames, impl->pictures, double(impl->written.load()) / 1e6,
               double(impl->waiting.load()) / 1e6);
}

// MARK: - Reading

namespace {

/// A film in a take played back: whatever frame the host has for the time the take says.
class ReplayVideo : public VideoPlayer {
public:
    TextureRef frame;
    double at = 0;
    void load(const std::string& path) override { source = path; }
    void play() override {}
    void pause() override {}
    void seek(double) override {}
    double currentTime() override { return at; }
    double duration() override { return 0; }
    void setVolume(float) override {}
    void setMuted(bool) override {}
    bool playing() override { return true; }
    bool ready() override { return frame != nullptr; }
    TextureRef texture() override { return frame; }
};

bool readPiece(FILE* f, uint32_t& tag, std::vector<uint8_t>& body) {
    uint32_t length = 0;
    if (fread(&tag, 4, 1, f) != 1 || fread(&length, 4, 1, f) != 1) return false;
    body.resize(length);
    return length == 0 || fread(body.data(), 1, length, f) == length;
}

}  // namespace

struct Player::Impl {
    FILE* stream = nullptr;         // read forward, frame by frame
    FILE* shelf = nullptr;          // read here and there, for pictures
    About about;
    std::unordered_map<uint32_t, long long> pictureAt;     // where each TEXR's body begins, and how long it is
    std::unordered_map<uint32_t, uint32_t> pictureLength;
    std::unordered_map<uint32_t, TextureRef> textures;
    std::unordered_set<uint32_t> gone;
    std::unordered_map<uint32_t, MeshRef> meshes;
    std::unordered_map<uint32_t, std::shared_ptr<ReplayVideo>> videos;
    std::unordered_map<uint32_t, Item> items;
    std::unordered_map<uint32_t, EntityRef> entities;
    std::vector<uint32_t> keys;
    EntityRef root = Entity::make();
    Moment moment;
    std::vector<uint32_t> showing;  // the films the frame shows
    bool any = false;               // a frame has been applied
    int missing = 0;
    // The pieces up to and including the next frame, read but not yet due.
    std::vector<std::pair<uint32_t, std::vector<uint8_t>>> ahead;
    double aheadTime = 0;
    bool aheadWhole = false, ended = false;

    void rewind() {
        fseek(stream, 8, SEEK_SET);
        ahead.clear();
        aheadWhole = ended = any = false;
        meshes.clear();
        meshBefore.clear();
        items.clear();
        keys.clear();
        moment = Moment();
    }

    /// Reads on until a frame is in `ahead`. False at the end of the file.
    bool readAhead() {
        if (aheadWhole) return true;
        if (ended) return false;
        uint32_t tag = 0;
        std::vector<uint8_t> body;
        while (readPiece(stream, tag, body)) {
            if (tag == kMesh || tag == kVideo) {
                ahead.emplace_back(tag, std::move(body));
            } else if (tag == kFrame) {
                In in{body.data(), body.data() + body.size()};
                aheadTime = in.get<double>();
                ahead.emplace_back(tag, std::move(body));
                aheadWhole = true;
                return true;
            }
            body = {};
        }
        ended = true;
        return false;
    }

    std::unordered_map<uint32_t, std::vector<uint8_t>> meshBefore;

    void applyMesh(const std::vector<uint8_t>& piece) {
        In head{piece.data(), piece.data() + piece.size()};
        uint32_t serial = head.get<uint32_t>();
        uint32_t length = head.get<uint32_t>();
        bool against = head.get<uint8_t>() != 0;
        if (!head.ok || length > (256u << 20)) return;
        std::vector<uint8_t> body(length);
        uLongf size = length;
        if (uncompress(body.data(), &size, head.p, uLong(head.end - head.p)) != Z_OK || size != length) return;
        if (against) {
            const std::vector<uint8_t>& before = meshBefore[serial];
            if (before.size() != body.size()) return;
            for (size_t i = 0; i < body.size(); i++) body[i] ^= before[i];
        }
        In in{body.data(), body.data() + body.size()};
        bool low = in.get<uint8_t>() != 0;
        if (low) meshBefore[serial] = body;
        BoundingBox bounds = in.get<BoundingBox>();
        if (low) {
            LowLevelMesh::Descriptor d;
            d.stride = in.get<uint32_t>();
            uint32_t attributes = in.get<uint32_t>();
            for (uint32_t i = 0; i < attributes && in.ok; i++) {
                LowLevelMesh::Attribute a;
                a.semantic = LowLevelMesh::Semantic(in.get<uint8_t>());
                a.components = in.get<uint8_t>();
                a.offset = in.get<uint16_t>();
                d.vertexAttributes.push_back(a);
            }
            uint32_t used = in.get<uint32_t>();
            d.vertexCapacity = int(std::max(used, 1u));
            const uint8_t* vertices = in.p;
            in.skip(size_t(used) * d.stride);
            uint32_t count = in.get<uint32_t>();
            d.indexCapacity = int(count);
            if (!in.ok || d.stride == 0) return;
            LowLevelMeshRef mesh = LowLevelMesh::make(d);
            std::memcpy(mesh->vertexData.data(), vertices, size_t(used) * d.stride);
            in.raw(mesh->indexData.data(), size_t(count) * 4);
            mesh->setPart(int(count), bounds);
            if (in.ok) meshes[serial] = mesh;
        } else {
            uint32_t n = in.get<uint32_t>();
            if (size_t(n) * sizeof(Vec3) > body.size()) return;
            std::vector<Vec3> positions(n);
            in.raw(positions.data(), size_t(n) * sizeof(Vec3));
            n = in.get<uint32_t>();
            if (size_t(n) * sizeof(Vec2) > body.size()) return;
            std::vector<Vec2> uvs(n);
            in.raw(uvs.data(), size_t(n) * sizeof(Vec2));
            n = in.get<uint32_t>();
            if (size_t(n) * 4 > body.size()) return;
            std::vector<uint32_t> indices(n);
            in.raw(indices.data(), size_t(n) * 4);
            if (!in.ok) return;
            MeshRef mesh = Mesh::generate(std::move(positions), std::move(uvs), std::move(indices));
            mesh->bounds = bounds;
            meshes[serial] = mesh;
        }
    }

    void applyFrame(const std::vector<uint8_t>& body) {
        In in{body.data(), body.data() + body.size()};
        moment = readMoment(in);
        showing.clear();
        uint32_t films = in.get<uint32_t>();
        for (uint32_t i = 0; i < films && in.ok; i++) {
            uint32_t serial = in.get<uint32_t>();
            double at = in.get<double>();
            auto found = videos.find(serial);
            if (found == videos.end()) continue;
            found->second->at = at;
            showing.push_back(serial);
        }
        uint32_t count = in.get<uint32_t>();
        if (count != sameKeys) {
            if (size_t(count) * 4 > body.size()) return;
            keys.resize(count);
            in.raw(keys.data(), size_t(count) * 4);
        }
        uint32_t changed = in.get<uint32_t>();
        for (uint32_t i = 0; i < changed && in.ok; i++) {
            uint32_t key = in.get<uint32_t>();
            uint8_t how = in.get<uint8_t>();
            if (how == 1) {
                Item item = in.get<Item>();
                if (in.ok) items[key] = item;
            } else if (how == 2) {
                float at[3];
                in.raw(at, 12);
                auto found = items.find(key);
                if (in.ok && found != items.end()) std::memcpy(found->second.world + 12, at, 12);
            } else {
                in.ok = false;
            }
        }
        any = true;
    }

    TextureRef texture(uint32_t serial) {
        auto found = textures.find(serial);
        if (found != textures.end()) return found->second;
        auto at = pictureAt.find(serial);
        if (at == pictureAt.end()) return nullptr;
        std::vector<uint8_t> body(pictureLength[serial]);
        fseeko(shelf, at->second, SEEK_SET);
        if (fread(body.data(), 1, body.size(), shelf) != body.size()) return nullptr;
        In in{body.data(), body.data() + body.size()};
        in.skip(4);
        auto image = std::make_shared<Image>();
        image->width = int(in.get<uint32_t>());
        image->height = int(in.get<uint32_t>());
        bool mipmaps = in.get<uint8_t>() != 0;
        if (!in.ok || image->width <= 0 || image->height <= 0 || image->width > 16384 || image->height > 16384) return nullptr;
        image->rgba.resize(size_t(image->width) * image->height * 4);
        uLongf size = uLongf(image->rgba.size());
        if (uncompress(image->rgba.data(), &size, in.p, uLong(in.end - in.p)) != Z_OK || size != image->rgba.size()) return nullptr;
        TextureRef t = Texture::make(image, mipmaps);
        textures[serial] = t;
        return t;
    }

    /// The frame's models as entities under `root`, flat, in the order they were in the tree.
    void rebuild() {
        for (const EntityRef& c : root->children) c->parent = nullptr;
        root->children.clear();
        for (uint32_t key : keys) {
            auto found = items.find(key);
            if (found == items.end()) continue;
            const Item& item = found->second;
            auto mesh = meshes.find(item.mesh);
            if (mesh == meshes.end()) continue;
            Material m;
            m.kind = Material::Kind(item.kind);
            m.color = {item.color[0], item.color[1], item.color[2], item.color[3]};
            m.transparent = item.flags & 1;
            m.cull = item.flags & 2;
            m.writesDepth = item.flags & 4;
            m.additive = item.flags & 8;
            m.opacity = item.materialOpacity;
            m.opacityThreshold = item.threshold;
            if (item.has & 1) m.setParameter("Shift", item.shift);
            if (item.has & 2) m.setParameter("Center", Vec3{item.center[0], item.center[1], item.center[2]});
            if (item.has & 4) m.setParameter("Line", item.line);
            if (item.has & 8) m.setParameter("Fill", item.fill);
            if (item.has & 16) m.setParameter("Glow", item.glow);
            if (item.texture) {
                m.texture = texture(item.texture);
                if (!m.texture) {
                    // Its picture was never written down (it was let go before its turn came): better left out than drawn blank.
                    if (gone.insert(item.texture).second) missing++;
                    continue;
                }
            }
            if (m.kind == Material::Kind::video) {
                auto film = videos.find(item.video);
                if (film == videos.end()) continue;
                m.video = film->second;
            }
            EntityRef& e = entities[key];
            if (!e) e = Entity::make();
            Mat4 world;
            std::memcpy(&world.columns[0].x, item.world, 64);
            e->replayWorld = world;
            e->replayLoading = item.loading;
            if (item.opacity < 0.9995f) e->opacity = item.opacity; else e->opacity.reset();
            e->hover = Hover{Hover::Kind(item.hoverKind), {item.hoverColor[0], item.hoverColor[1], item.hoverColor[2], item.hoverColor[3]},
                             item.hoverStrength};
            e->hovered = item.hovered;
            e->model = ModelComponent{mesh->second, {m}};
            e->parent = root.get();
            root->children.push_back(e);
        }
        if (entities.size() > keys.size() * 2 + 256) {
            std::unordered_set<uint32_t> now(keys.begin(), keys.end());
            for (auto it = entities.begin(); it != entities.end();) it = now.count(it->first) ? std::next(it) : entities.erase(it);
            for (auto it = items.begin(); it != items.end();) it = now.count(it->first) ? std::next(it) : items.erase(it);
        }
    }
};

Player::Player() : impl(new Impl) {}
Player::~Player() {
    if (impl->stream) fclose(impl->stream);
    if (impl->shelf) fclose(impl->shelf);
}

const Player::About& Player::about() const { return impl->about; }
EntityRef Player::root() const { return impl->root; }
const Moment& Player::moment() const { return impl->moment; }
int Player::missing() const { return impl->missing; }

bool Player::open(const std::string& file) {
    Impl& s = *impl;
    s.stream = fopen(file.c_str(), "rb");
    s.shelf = fopen(file.c_str(), "rb");
    char head[8] = {0};
    if (!s.stream || !s.shelf || fread(head, 1, 8, s.stream) != 8 || std::memcmp(head, magic, 8) != 0) return false;
    // Once through, reading only the head of each piece: where the pictures are, when the frames were.
    About& a = s.about;
    std::optional<Mat4> firstSheet;
    double headNoted = -1;
    for (;;) {
        uint32_t tag = 0, length = 0;
        if (fread(&tag, 4, 1, s.stream) != 1 || fread(&length, 4, 1, s.stream) != 1) break;
        long long body = ftello(s.stream);
        if (tag == kHead) {
            a.head.resize(length);
            if (fread(a.head.data(), 1, length, s.stream) != length) break;
        } else if (tag == kTexture && length >= 13) {
            uint32_t serial = 0;
            if (fread(&serial, 4, 1, s.stream) != 1) break;
            s.pictureAt[serial] = body;
            s.pictureLength[serial] = length;
            a.pictures++;
        } else if (tag == kVideo && length >= 4) {
            std::vector<uint8_t> bytes(length);
            if (fread(bytes.data(), 1, length, s.stream) != length) break;
            auto film = std::make_shared<ReplayVideo>();
            film->source.assign(bytes.begin() + 4, bytes.end());
            uint32_t serial = 0;
            std::memcpy(&serial, bytes.data(), 4);
            s.videos[serial] = film;
        } else if (tag == kMesh) {
            a.meshes++;
        } else if (tag == kSync && length >= 8) {
            double t = 0;
            if (fread(&t, 8, 1, s.stream) != 1) break;
            a.syncs.push_back(t);
        } else if (tag == kTail) {
            a.whole = true;
        } else if (tag == kCameras || tag == kCamera) {
            a.extras.push_back({tag, body, length});
        } else if (tag == kFrame) {
            std::vector<uint8_t> start(std::min<uint32_t>(length, 1024));
            if (fread(start.data(), 1, start.size(), s.stream) != start.size()) break;
            In in{start.data(), start.data() + start.size()};
            Moment m = readMoment(in);
            if (!in.ok) break;
            if (a.frames == 0) a.from = m.time;
            a.to = m.time;
            a.frames++;
            if (m.sheet) {
                if (!firstSheet) firstSheet = m.sheet;
                a.sheet = m.sheet;
                a.sheetFrames++;
                a.sheetMoved = std::max(a.sheetMoved, distance(firstSheet->position(), m.sheet->position()));
            }
            if (m.head) a.heads.emplace_back(m.time, *m.head);
            if (m.head && m.time - headNoted >= 0.1) {
                headNoted = m.time;
                Vec3 p = m.head->position();
                a.headAt.push_back({m.time, p.x, p.y, p.z});
            }
        }
        if (fseeko(s.stream, body + length, SEEK_SET) != 0) break;
    }
    clearerr(s.stream);
    s.rewind();
    return a.frames > 0;
}

std::vector<uint8_t> Player::extra(const About::Extra& which) {
    std::vector<uint8_t> bytes(which.length);
    fseeko(impl->shelf, which.at, SEEK_SET);
    if (fread(bytes.data(), 1, bytes.size(), impl->shelf) != bytes.size()) bytes.clear();
    return bytes;
}

bool Player::seek(double time, double slack) {
    Impl& s = *impl;
    if (s.any && time < s.moment.time) s.rewind();
    bool stepped = false;
    while (s.readAhead() && s.aheadTime <= time) {
        for (const auto& [tag, body] : s.ahead) {
            if (tag == kMesh) s.applyMesh(body);
            else if (tag == kFrame) s.applyFrame(body);
        }
        s.ahead.clear();
        s.aheadWhole = false;
        stepped = true;
    }
    if (stepped) {
        // Each film's frame for where the take says it was, asked once however many frames were stepped over.
        for (uint32_t serial : s.showing) {
            auto& film = s.videos[serial];
            film->frame = videoFrame ? videoFrame(film->source, film->at) : nullptr;
        }
        s.rebuild();
    }
    if (!s.any) return false;
    return time <= s.about.to + slack;
}

}  // namespace take
