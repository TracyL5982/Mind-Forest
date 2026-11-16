// Filming: a take (core/take.h) drawn again from where a camera stood, over
// what the camera filmed. quest/film/film.py runs this; quest/film/README.md
// says how a take is shot.
//
//   preview -film take.bin -camera camera.json -footage "<command>" -out "<command>" [-overlay "<command>"]
//
// - `camera.json` (made by quest/film/solve.py and sync.py) says, for every frame of the footage,
//   where the camera was against the filming sheet, what its lens was, and how the footage's time
//   maps to the take's.
// - `-footage` is a command whose output is the footage's frames, RGBA, row after row from the top
//   (ffmpeg); `-out` and `-overlay` are commands that take frames the same way, rows from the
//   bottom. `-out` gets the scene over the footage; `-overlay` the scene alone, its colours
//   multiplied by its alpha, for whoever would rather put the two together in an editor.
// - Everything is blended in linear light, the room dimmed as the headset dimmed it (`-dimScale <0…1>`
//   to dim the footage less; 0 leaves it as filmed).
// - `-camera head` (or none) draws the take as the person in the headset saw it, from their own head:
//   `-size <w> <h>`, `-fov <degrees>` (upright, default 80) and `-fps <n>` (default 30) say how.
// - `-footageHLG`: the footage was filmed in HDR (hybrid log-gamma, as an iPhone films by default); its frames are
//   brought to ordinary light here: unpacked, the wide colours brought into sRGB's, and what is brighter than
//   paper white eased under the top instead of cut off.
// - `-still <s> -stillOut <file.png>` makes one frame of the footage's time instead of a film.
// - `-showHands` marks where the take has the head and the hands' joints: with the sheet found well
//   and the clocks matched, the marks sit on the person's own hands. `-showSheet <w>,<h>` (metres)
//   draws the sheet's edge where the headset saw it: it should lie on the paper in the footage.
// - `-takeInfo take.bin` (no window) prints what a take holds, as JSON.
// - `-takeCameras take.bin -to <folder>` (no window) writes out what the headset's own cameras saw during
//   the take (cam-<n>.jpg) and `cameras.json`: when each was taken, what the headset says of its cameras,
//   and where the head was in every frame. quest/film/headset.py finds the sheet in them.
#define GL_SILENCE_DEPRECATION
#include <OpenGL/gl3.h>

#include <sys/stat.h>

#include <cmath>
#include <cstdio>
#include <cstring>
#include <map>
#include <string>
#include <vector>

#include "base.h"
#include "host_mac.h"
#include "json.h"
#include "render.h"
#include "take.h"

namespace {

std::string matrixJson(const Mat4& m) {
    std::string out = "[";
    for (int i = 0; i < 16; i++) out += fmt(i ? ",%.7g" : "%.7g", double(m.data()[i]));
    return out + "]";
}

/// What the footage is drawn with: the picture as it is, a little darker if asked.
struct Backdrop {
    unsigned program = 0, vao = 0, vbo = 0, texture = 0;
    int gain = -1, hlg = -1;
    bool wide = false;
    void make(int width, int height, bool hdr) {
        wide = hdr;
        const char* vs = "#version 410 core\nlayout(location = 0) in vec2 p; out vec2 uv;\n"
                         "void main() { uv = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5); gl_Position = vec4(p, 0.0, 1.0); }";
        const char* fs = R"(#version 410 core
uniform sampler2D t; uniform float gain; uniform int hlg; in vec2 uv; out vec4 frag;
// Hybrid log-gamma, as filmed, to linear sRGB light: the signal unpacked to the scene's light, the display's
// own curve (gamma 1.2 on brightness), BT.2020's colours to sRGB's, then paper white (203 of the 1000 nits)
// set a little under full and whatever is brighter eased in under the top.
vec3 unpack(vec3 e) {
    vec3 scene = mix(e * e / 3.0, (exp((e - 0.55991073) / 0.17883277) + 0.28466892) / 12.0, step(0.5, e));
    float y = dot(scene, vec3(0.2627, 0.6780, 0.0593));
    vec3 shown = scene * pow(max(y, 1e-6), 0.2);
    vec3 c = max(mat3(1.6605, -0.1246, -0.0182, -0.5876, 1.1329, -0.1006, -0.0728, -0.0083, 1.1187) * shown, 0.0) * 3.3;
    vec3 over = max(c - 0.6, 0.0);
    return min(c, 0.6) + 0.4 * tanh(over / 0.4);
}
void main() {
    vec3 c = texture(t, uv).rgb;
    frag = vec4((hlg != 0 ? unpack(c) : c) * gain, 1.0);
})";
        unsigned v = glCreateShader(GL_VERTEX_SHADER), f = glCreateShader(GL_FRAGMENT_SHADER);
        glShaderSource(v, 1, &vs, nullptr);
        glCompileShader(v);
        glShaderSource(f, 1, &fs, nullptr);
        glCompileShader(f);
        program = glCreateProgram();
        glAttachShader(program, v);
        glAttachShader(program, f);
        glLinkProgram(program);
        gain = glGetUniformLocation(program, "gain");
        hlg = glGetUniformLocation(program, "hlg");
        const float corners[6] = {-1, -1, 3, -1, -1, 3};
        glGenVertexArrays(1, &vao);
        glGenBuffers(1, &vbo);
        glBindVertexArray(vao);
        glBindBuffer(GL_ARRAY_BUFFER, vbo);
        glBufferData(GL_ARRAY_BUFFER, sizeof corners, corners, GL_STATIC_DRAW);
        glEnableVertexAttribArray(0);
        glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 8, nullptr);
        glGenTextures(1, &texture);
        glBindTexture(GL_TEXTURE_2D, texture);
        // (Ordinary footage is unpacked by the GPU as it is read; HDR footage by the shader above.)
        glTexImage2D(GL_TEXTURE_2D, 0, hdr ? GL_RGBA8 : GL_SRGB8_ALPHA8, width, height, 0, GL_RGBA, GL_UNSIGNED_BYTE, nullptr);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
    }
    void set(int width, int height, const uint8_t* rgba) {
        glBindTexture(GL_TEXTURE_2D, texture);
        glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
        glTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, width, height, GL_RGBA, GL_UNSIGNED_BYTE, rgba);
    }
    void draw(float brightness) {
        glDisable(GL_DEPTH_TEST);
        glDisable(GL_BLEND);
        glDisable(GL_CULL_FACE);
        glDepthMask(GL_FALSE);
        glUseProgram(program);
        glUniform1f(gain, brightness);
        glUniform1i(hlg, wide ? 1 : 0);
        glActiveTexture(GL_TEXTURE0);
        glBindTexture(GL_TEXTURE_2D, texture);
        glBindVertexArray(vao);
        glDrawArrays(GL_TRIANGLES, 0, 3);
        glDepthMask(GL_TRUE);
    }
};

/// The films cards play, for a take drawn again: each film's frames come from an ffmpeg of its own,
/// read forward as the take's time for it goes forward, and started again when it jumps.
struct Films {
    struct Film {
        FILE* pipe = nullptr;
        std::string file;
        int width = 0, height = 0;
        double fps = 30, next = 0;      // the time of the frame the pipe gives next
        TextureRef shown;
        bool failed = false;
    };
    std::map<std::string, Film> films;

    static bool exists(const std::string& path) {
        struct stat st;
        return !path.empty() && stat(path.c_str(), &st) == 0;
    }
    /// The file on this Mac for a film the headset knew by its own path: the same file under the app's media.
    static std::string find(const std::string& source) {
        if (exists(source)) return source;
        for (size_t at = source.find('/'); at != std::string::npos; at = source.find('/', at + 1)) {
            std::string under = platform::resourcePath(source.substr(at + 1));
            if (exists(under)) return under;
        }
        return "";
    }
    static std::string quoted(const std::string& s) {
        std::string out = "'";
        for (char c : s) out += c == '\'' ? std::string("'\\''") : std::string(1, c);
        return out + "'";
    }
    bool begin(Film& f, double at) {
        if (f.pipe) pclose(f.pipe);
        f.pipe = nullptr;
        if (f.width == 0) {
            std::string probe = "ffprobe -v error -select_streams v:0 -show_entries stream=width,height,r_frame_rate -of csv=p=0 " + quoted(f.file);
            FILE* p = popen(probe.c_str(), "r");
            int num = 30, den = 1;
            if (!p || fscanf(p, "%d,%d,%d/%d", &f.width, &f.height, &num, &den) < 3) f.width = 0;
            if (p) pclose(p);
            if (f.width <= 0 || f.height <= 0) return false;
            f.fps = den > 0 ? double(num) / den : 30;
            // No larger than a card is ever drawn.
            if (f.width > 1280) {
                f.height = int(std::lround(double(f.height) * 1280 / f.width / 2)) * 2;
                f.width = 1280;
            }
        }
        std::string command = fmt("ffmpeg -v error -ss %.3f -i %s -vf scale=%d:%d -f rawvideo -pix_fmt rgba -", std::max(0.0, at),
                                  quoted(f.file).c_str(), f.width, f.height);
        f.pipe = popen(command.c_str(), "r");
        f.next = std::max(0.0, at);
        return f.pipe != nullptr;
    }
    TextureRef frame(const std::string& source, double at) {
        Film& f = films[source];
        if (f.failed) return nullptr;
        if (f.file.empty()) {
            f.file = find(source);
            if (f.file.empty()) {
                logLine("[film] a card's film is not on this Mac: " + source);
                f.failed = true;
                return nullptr;
            }
        }
        // Behind where the take has it, or far ahead: start reading from there.
        if (!f.pipe || at < f.next - 1.5 / f.fps || at > f.next + 2) {
            if (!begin(f, at)) {
                f.failed = true;
                return nullptr;
            }
        }
        auto image = std::make_shared<Image>();
        image->width = f.width;
        image->height = f.height;
        image->rgba.resize(size_t(f.width) * f.height * 4);
        bool read = false;
        while (f.next <= at + 0.5 / f.fps) {
            if (fread(image->rgba.data(), 1, image->rgba.size(), f.pipe) != image->rgba.size()) break;
            f.next += 1 / f.fps;
            read = true;
        }
        if (read) f.shown = Texture::make(image);
        return f.shown;
    }
    ~Films() {
        for (auto& [name, f] : films) {
            if (f.pipe) pclose(f.pipe);
        }
    }
};

}  // namespace

int takeInfo(const std::string& file) {
    take::Player player;
    if (!player.open(file)) {
        fprintf(stderr, "not a take: %s\n", file.c_str());
        return 1;
    }
    const auto& a = player.about();
    std::string out = "{";
    out += "\"head\":" + (a.head.empty() ? std::string("{}") : a.head);
    out += fmt(",\"frames\":%d,\"from\":%.6f,\"to\":%.6f,\"whole\":%s,\"pictures\":%d,\"meshes\":%d", a.frames, a.from, a.to,
               a.whole ? "true" : "false", a.pictures, a.meshes);
    out += ",\"syncs\":[";
    for (size_t i = 0; i < a.syncs.size(); i++) out += fmt(i ? ",%.6f" : "%.6f", a.syncs[i]);
    out += "]";
    out += ",\"sheet\":" + (a.sheet ? matrixJson(*a.sheet) : std::string("null"));
    out += fmt(",\"sheetFrames\":%d,\"sheetMoved\":%.4f", a.sheetFrames, double(a.sheetMoved));
    out += ",\"headAt\":[";
    for (size_t i = 0; i < a.headAt.size(); i++) {
        out += fmt(i ? ",[%.3f,%.3f,%.3f,%.3f]" : "[%.3f,%.3f,%.3f,%.3f]", a.headAt[i][0], a.headAt[i][1], a.headAt[i][2], a.headAt[i][3]);
    }
    out += "]}";
    printf("%s\n", out.c_str());
    return 0;
}

int takeCameras(const std::string& file, const std::string& folder) {
    take::Player player;
    if (!player.open(file)) {
        fprintf(stderr, "not a take: %s\n", file.c_str());
        return 1;
    }
    mkdir(folder.c_str(), 0775);
    const auto& a = player.about();
    std::string info = "null", frames;
    int count = 0;
    for (const auto& piece : a.extras) {
        std::vector<uint8_t> bytes = player.extra(piece);
        if (piece.tag == (uint32_t('C') | uint32_t('A') << 8 | uint32_t('M') << 16 | uint32_t('I') << 24)) {
            info.assign(bytes.begin(), bytes.end());
            continue;
        }
        // A picture: which eye's camera, when it was taken and when it arrived (the take's clock), its size, then a JPEG.
        if (bytes.size() < 25) continue;
        uint8_t eye = bytes[0];
        double taken = 0, arrived = 0;
        uint32_t width = 0, height = 0;
        memcpy(&taken, &bytes[1], 8);
        memcpy(&arrived, &bytes[9], 8);
        memcpy(&width, &bytes[17], 4);
        memcpy(&height, &bytes[21], 4);
        std::string name = fmt("cam-%04d.jpg", count);
        if (FILE* f = fopen((folder + "/" + name).c_str(), "wb")) {
            fwrite(bytes.data() + 25, 1, bytes.size() - 25, f);
            fclose(f);
        }
        frames += fmt("%s{\"eye\":%d,\"time\":%.6f,\"arrived\":%.6f,\"width\":%u,\"height\":%u,\"file\":\"%s\"}", count ? "," : "", int(eye), taken,
                      arrived, width, height, name.c_str());
        count++;
    }
    std::string heads;
    heads.reserve(a.heads.size() * 200);
    for (size_t i = 0; i < a.heads.size(); i++) {
        heads += fmt(i ? ",[%.6f" : "[%.6f", a.heads[i].first);
        for (int k = 0; k < 16; k++) heads += fmt(",%.6g", double(a.heads[i].second.data()[k]));
        heads += "]";
    }
    std::string out = "{\"info\":" + info + ",\"frames\":[" + frames + "],\"sheet\":" + (a.sheet ? matrixJson(*a.sheet) : std::string("null")) +
                      ",\"heads\":[" + heads + "]}";
    if (FILE* f = fopen((folder + "/cameras.json").c_str(), "wb")) {
        fwrite(out.data(), 1, out.size(), f);
        fclose(f);
    }
    printf("%d pictures from the headset's cameras, %zu frames of the head, in %s\n", count, a.heads.size(), folder.c_str());
    return 0;
}

int runFilm(const std::string& takeFile) {
    take::Player player;
    if (!player.open(takeFile)) {
        fprintf(stderr, "[film] not a take: %s\n", takeFile.c_str());
        return 1;
    }
    const auto& about = player.about();
    fprintf(stderr, "[film] take: %d frames over %.1f s, %d pictures%s\n", about.frames, about.to - about.from, about.pictures,
            about.whole ? "" : " (cut short: it has no end)");

    auto cameraPath = Flags::string("camera");
    bool fromHead = !cameraPath || *cameraPath == "head";
    Json camera;
    int width = 1280, height = 900;
    double fps = 30, fx = 0, fy = 0, cx = 0, cy = 0, clockOffset = about.from, clockRate = 1;
    int frameCount = 0;
    if (fromHead) {
        const auto& all = Flags::arguments();
        for (size_t i = 0; i + 2 < all.size(); i++) {
            if (all[i] == "-size") {
                width = atoi(all[i + 1].c_str());
                height = atoi(all[i + 2].c_str());
            }
        }
        if (Flags::number("fps") > 0) fps = Flags::number("fps");
        double fov = (Flags::number("fov") > 0 ? Flags::number("fov") : 80) * M_PI / 180;
        fx = fy = height / 2.0 / std::tan(fov / 2);
        cx = width / 2.0;
        cy = height / 2.0;
        frameCount = int((about.to - about.from) * fps) + 1;
    } else {
        std::optional<std::string> cameraText = platform::readFile(*cameraPath);
        std::optional<Json> parsed = cameraText ? Json::parse(*cameraText) : std::nullopt;
        if (!parsed) {
            fprintf(stderr, "[film] could not read the camera: %s\n", cameraPath->c_str());
            return 1;
        }
        camera = *parsed;
        width = camera["width"].integer();
        height = camera["height"].integer();
        fps = camera["fps"].number(30);
        fx = camera["fx"].number();
        fy = camera["fy"].number(fx);
        cx = camera["cx"].number(width / 2.0);
        cy = camera["cy"].number(height / 2.0);
        clockOffset = camera["clock"]["offset"].number(about.from);
        clockRate = camera["clock"]["rate"].number(1);
        frameCount = int(camera["frames"].size());
    }
    const std::vector<Json>& poses = camera["frames"].array();
    if (width <= 0 || height <= 0 || fx <= 0 || frameCount <= 0) {
        fprintf(stderr, "[film] the camera has no size, lens or frames\n");
        return 1;
    }

    // Where the picture is made: off screen, at the footage's size, four samples a pixel.
    unsigned many = 0, manyColor = 0, manyDepth = 0, flat = 0, flatColor = 0;
    glGenFramebuffers(1, &many);
    glBindFramebuffer(GL_FRAMEBUFFER, many);
    glGenRenderbuffers(1, &manyColor);
    glBindRenderbuffer(GL_RENDERBUFFER, manyColor);
    glRenderbufferStorageMultisample(GL_RENDERBUFFER, 4, GL_SRGB8_ALPHA8, width, height);
    glFramebufferRenderbuffer(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_RENDERBUFFER, manyColor);
    glGenRenderbuffers(1, &manyDepth);
    glBindRenderbuffer(GL_RENDERBUFFER, manyDepth);
    glRenderbufferStorageMultisample(GL_RENDERBUFFER, 4, GL_DEPTH_COMPONENT24, width, height);
    glFramebufferRenderbuffer(GL_FRAMEBUFFER, GL_DEPTH_ATTACHMENT, GL_RENDERBUFFER, manyDepth);
    glGenFramebuffers(1, &flat);
    glBindFramebuffer(GL_FRAMEBUFFER, flat);
    glGenTextures(1, &flatColor);
    glBindTexture(GL_TEXTURE_2D, flatColor);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_SRGB8_ALPHA8, width, height, 0, GL_RGBA, GL_UNSIGNED_BYTE, nullptr);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, flatColor, 0);
    if (glCheckFramebufferStatus(GL_FRAMEBUFFER) != GL_FRAMEBUFFER_COMPLETE) {
        fprintf(stderr, "[film] could not make a %d x %d picture to draw into\n", width, height);
        return 1;
    }

    Renderer renderer;
    renderer.init(false);
    // Nothing here is in a hurry: every picture a frame needs is sent before the frame is drawn.
    renderer.uploadBudgetMs = 1e9;
    Backdrop backdrop;
    backdrop.make(width, height, Flags::has("footageHLG"));
    Films films;
    player.videoFrame = [&](const std::string& source, double at) { return films.frame(source, at); };

    // `-showHands`: a mark at the head and at each joint of each hand.
    EntityRef marks = Entity::make();
    std::vector<EntityRef> jointMarks;
    EntityRef headMark;
    bool showHands = Flags::has("showHands");
    if (showHands) {
        MeshRef dot = Mesh::generateBox({0.012f, 0.012f, 0.012f});
        for (int i = 0; i < 2 * int(platform::Joint::count); i++) {
            EntityRef e = Entity::make(dot, {Material::unlit(i < int(platform::Joint::count) ? Color::hex(0x5EDDB4) : Color::hex(0xF5C451))});
            marks->addChild(e);
            jointMarks.push_back(e);
        }
        headMark = Entity::make(Mesh::generateBox({0.16f, 0.09f, 0.09f}), {Material::unlit(Color::hex(0xF59AB8))});
        headMark->opacity = 0.5f;
        marks->addChild(headMark);
    }
    EntityRef sheetMark;
    if (auto size = Flags::string("showSheet")) {
        float w = 0.2794f, h = 0.2159f, line = 0.003f;
        sscanf(size->c_str(), "%f,%f", &w, &h);
        sheetMark = Entity::make();
        Material ink = Material::unlit(Color::hex(0x5EDDB4));
        const Vec3 sizes[4] = {{w, line, line}, {w, line, line}, {line, h, line}, {line, h, line}};
        const Vec3 places[4] = {{0, h / 2, 0}, {0, -h / 2, 0}, {-w / 2, 0, 0}, {w / 2, 0, 0}};
        for (int i = 0; i < 4; i++) {
            EntityRef edge = Entity::make(Mesh::generateBox(sizes[i]), {ink});
            edge->position = places[i];
            sheetMark->addChild(edge);
        }
        // A short stroke from its middle toward its top, so a sheet found the wrong way round shows.
        EntityRef up = Entity::make(Mesh::generateBox({line, h / 4, line}), {ink});
        up->position = {0, h / 8, 0};
        sheetMark->addChild(up);
        marks->addChild(sheetMark);
    }
    EntityRef world = Entity::make();
    world->addChild(player.root());
    world->addChild(marks);

    auto footageCommand = Flags::string("footage"), outCommand = Flags::string("out"), overlayCommand = Flags::string("overlay");
    auto stillOut = Flags::string("stillOut");
    bool still = Flags::has("still");
    FILE* footage = footageCommand ? popen(footageCommand->c_str(), "r") : nullptr;
    FILE* out = outCommand && !still ? popen(outCommand->c_str(), "w") : nullptr;
    FILE* overlay = overlayCommand && !still ? popen(overlayCommand->c_str(), "w") : nullptr;
    if (footageCommand && !footage) fprintf(stderr, "[film] could not start: %s\n", footageCommand->c_str());
    double dimScale = Flags::has("dimScale") ? Flags::number("dimScale") : 1;
    int first = still ? int(std::lround(Flags::number("still") * fps)) : 0;
    int last = still ? first : frameCount - 1;
    if (Flags::has("filmTo")) last = std::min(last, int(Flags::number("filmTo") * fps));

    std::vector<uint8_t> frameIn(size_t(width) * height * 4), frameOut(size_t(width) * height * 4);
    std::optional<Mat4> sheet = about.sheet;
    int drawn = 0, unplaced = 0, outside = 0;
    double began = mediaTime(), said = began;
    static const Json none;
    for (int i = 0; i <= last && i < frameCount; i++) {
        bool haveFootage = footage && fread(frameIn.data(), 1, frameIn.size(), footage) == frameIn.size();
        if (footage && !haveFootage) break;
        if (i < first) continue;
        if (haveFootage) backdrop.set(width, height, frameIn.data());

        double videoTime = double(i) / fps;
        bool inTake = player.seek(clockOffset + clockRate * videoTime);
        const take::Moment& moment = player.moment();
        if (moment.sheet) sheet = moment.sheet;
        const Json& pose = fromHead ? none : poses[size_t(i)];
        bool placed = fromHead ? moment.head.has_value() : pose.isArray() && pose.size() == 16 && sheet.has_value();
        if (!inTake) outside++; else if (!placed) unplaced++;
        bool live = inTake && placed;

        Views views;
        if (live) {
            // The camera in the scene: through the sheet, which both the headset and the camera have seen.
            Mat4 sheetFromCamera;
            for (int r = 0; r < 4 && !fromHead; r++) {
                for (int c = 0; c < 4; c++) (&sheetFromCamera.columns[c].x)[r] = pose[size_t(r * 4 + c)].real();
            }
            Mat4 sceneFromCamera = fromHead ? *moment.head : *sheet * sheetFromCamera;
            views.view[0] = sceneFromCamera.inverse();
            float n = 0.05f, f = 60;
            Mat4 p;
            p.columns[0] = {float(2 * fx / width), 0, 0, 0};
            p.columns[1] = {0, float(2 * fy / height), 0, 0};
            p.columns[2] = {float(1 - 2 * cx / width), float(2 * cy / height - 1), -(f + n) / (f - n), -1};
            p.columns[3] = {0, 0, -2 * f * n / (f - n), 0};
            views.projection[0] = p;
            views.eye = sceneFromCamera.position();
            views.forward = sceneFromCamera.forward();
            if (sheetMark) sheetMark->replayWorld = *sheet;
            if (showHands) {
                for (int h = 0; h < 2; h++) {
                    for (int j = 0; j < int(platform::Joint::count); j++) {
                        EntityRef& e = jointMarks[size_t(h * int(platform::Joint::count) + j)];
                        e->isEnabled = moment.handTracked[h];
                        e->position = moment.joints[h][j];
                    }
                }
                headMark->isEnabled = moment.head.has_value();
                if (moment.head) {
                    headMark->position = moment.head->position();
                    headMark->orientation = Quat(Mat3(moment.head->right(), moment.head->up(), -moment.head->forward()));
                }
            }
        }
        float dim = live ? std::min(1.f, std::max(0.f, moment.dim * float(dimScale))) : 0;
        auto pass = [&](bool over, FILE* to) {
            glBindFramebuffer(GL_FRAMEBUFFER, many);
            glViewport(0, 0, width, height);
            glEnable(GL_FRAMEBUFFER_SRGB);
            glDepthMask(GL_TRUE);
            // (`-room <light>`: with no footage, the dim room the preview draws, to set a frame beside the preview's own.)
            float room = over && !haveFootage ? float(Flags::number("room")) * (1 - dim) : 0;
            glClearColor(room, room, room * 1.1f, over ? 1 : dim);
            glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
            if (over && haveFootage) backdrop.draw(1 - dim);
            if (live) {
                renderer.veil = moment.veil;
                renderer.draw(world, views, moment.appTime);
            }
            glBindFramebuffer(GL_READ_FRAMEBUFFER, many);
            glBindFramebuffer(GL_DRAW_FRAMEBUFFER, flat);
            glBlitFramebuffer(0, 0, width, height, 0, 0, width, height, GL_COLOR_BUFFER_BIT, GL_NEAREST);
            glBindFramebuffer(GL_READ_FRAMEBUFFER, flat);
            glPixelStorei(GL_PACK_ALIGNMENT, 1);
            glReadPixels(0, 0, width, height, GL_RGBA, GL_UNSIGNED_BYTE, frameOut.data());
            if (to) fwrite(frameOut.data(), 1, frameOut.size(), to);
        };
        if (out || still) pass(true, out);
        if (still && stillOut) {
            bool ok = host::savePNG(*stillOut, width, height, frameOut);
            fprintf(stderr, "[film] %s %s (%.2f s of the footage, %s)\n", ok ? "saved" : "could not save", stillOut->c_str(), videoTime,
                    live ? "the scene drawn" : !inTake ? "outside the take" : "the camera not placed");
        }
        if (overlay) pass(false, overlay);
        drawn++;
        if (mediaTime() - said > 2) {
            said = mediaTime();
            fprintf(stderr, "[film] %d of %d frames, %.1f a second\n", drawn, last - first + 1, drawn / (said - began));
        }
    }
    if (footage) pclose(footage);
    if (out) pclose(out);
    if (overlay) pclose(overlay);
    fprintf(stderr, "[film] %d frames drawn in %.0f s: %d outside the take, %d with the camera not placed, %d models left out for want of their picture\n",
            drawn, mediaTime() - began, outside, unplaced, player.missing());
    return 0;
}
