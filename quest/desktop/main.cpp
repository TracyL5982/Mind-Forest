// The Mac preview: the same scene and renderer as the Quest app in a
// window, to look at a change without putting the headset on. One eye, the
// mouse for a hand.
//
//   quest/desktop/build.sh && quest/desktop/preview -demo
//   preview -walk 3 -shot /tmp/walk.png -shotAt 6      run 6 s of app time at once, save a picture, quit
//   preview ... -shot /tmp/run.png -shotAt 30 -shotEvery 1   also save /tmp/run-<n>.png each second until then
//   preview -cards -frames /tmp/open -framesFrom 3 -framesTo 4    save every frame from 3 s to 4 s, then quit
//
// - Move the mouse: the hand ray goes through the pointer. Click: pinch. Drag: a pinch held and moved.
// - Right-drag: turn the head. Scroll: both hands pinching, pulled apart or together.
// - `-eye <x> <y> <z>` is not needed: the head starts at 1.5 m, looking ahead; `-yaw`/`-pitch <degrees>` turn it.
// - `-size <w> <h>` sets the window; `-fov <degrees>` the vertical field of view (default 80).
// - `-moveX <m>` / `-moveZ <m>` step the head to the right / back once the scene has started, as `-yaw` turns it;
//   `-moveAt <s>` does all three at that time instead (to see the scene offer to come along, and `-reseatAt` bring it).
// - `-deskAhead <m>` puts a table in the room (platform_mac.mm).
// - `-lapHand` lays a left hand at rest, out of view, where a lap is: 39 cm ahead of the eyes and 57 cm under them, at
//   the height of the desk the scene assumes when it knows no table, its fingers over the small tree's place. Hand tracking
//   is on with it; the right hand is still the mouse. `-lapHandAt <s>` lays it there only from that second.
// - `-lookAt <s> -lookPitch <degrees>` tips the head to that pitch at that second (after `-pitch`); `-lookBackAt <s>`
//   tips it back to `-pitch`.
// - `-take <folder>` records a filming take (core/take.h) of the run, with a sync sound half a second in and
//   another a second before a picture run ends; `-sheet <x>,<y>,<z>,<degrees>` lays a filming sheet flat in the
//   room for it. `-film <take.bin> …` draws a take again from a camera, and `-takeInfo <take.bin>` says what
//   one holds (film.cpp). `-filmPanel` shows the headset's filming panel (core/ocean/filmpanel.h): with it, `-take`
//   records only between a pinch on Record and one on Stop, and the sheet is locked by its own button.
#define GL_SILENCE_DEPRECATION
#define GLFW_INCLUDE_GLCOREARB
#include <GLFW/glfw3.h>

#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <thread>
#include <vector>

#include "app.h"
#include "async.h"
#include "audio.h"
#include "base.h"
#include "host_mac.h"
#include "input.h"
#include "perf.h"
#include "render.h"
#include "take.h"
#ifndef OCEAN_NO_SCENE
#include "ocean/filmpanel.h"
#endif

int runFilm(const std::string& takeFile);
int takeInfo(const std::string& takeFile);
int takeCameras(const std::string& takeFile, const std::string& folder);

#ifndef REPO_ROOT
#define REPO_ROOT "."
#endif

static double scrolled = 0;

/// A left hand at rest on a lap, palm down, its fingers a little curled, laid where it is when the scene starts (`-lapHand`).
static void layLapHand(bool there) {
    using platform::Joint;
    static std::optional<Mat4> laidFrom;
    platform::Hand& h = host::hands[0];
    if (!there) {
        h.tracked = false;
        return;
    }
    if (!laidFrom) laidFrom = host::head;
    Vec3 eye = laidFrom->position(), f = laidFrom->forward();
    f.y = 0;
    f = normalize(f);
    Vec3 u{0, 1, 0}, r = normalize(cross(f, u));
    Vec3 tip = eye + f * 0.39f - r * 0.03f - u * 0.565f;
    Vec3 wrist = tip - f * 0.175f + r * 0.01f + u * 0.01f;
    auto at = [&](Joint j, Vec3 p) {
        h.joints[int(j)] = p;
        h.rotations[int(j)] = Quat(Mat3(r, u, -f));
    };
    at(Joint::wrist, wrist);
    at(Joint::palm, wrist + f * 0.07f);
    // Each finger from its knuckle, its last two joints dipping toward the lap; the thumb on the right, apart from the index.
    const Joint fingers[4][5] = {{Joint::indexMetacarpal, Joint::indexProximal, Joint::indexIntermediate, Joint::indexDistal, Joint::indexTip},
                                 {Joint::middleMetacarpal, Joint::middleProximal, Joint::middleIntermediate, Joint::middleDistal, Joint::middleTip},
                                 {Joint::ringMetacarpal, Joint::ringProximal, Joint::ringIntermediate, Joint::ringDistal, Joint::ringTip},
                                 {Joint::littleMetacarpal, Joint::littleProximal, Joint::littleIntermediate, Joint::littleDistal, Joint::littleTip}};
    const float side[4] = {0, -0.02f, -0.038f, -0.054f}, reach[4] = {1, 1.04f, 0.97f, 0.82f};
    // `-lapFist`: the same hand closed, as a hand left resting in a fist is (WS75: on the headset one kept every pinch of the
    // other hand from being taken).
    static const bool closed = Flags::has("lapFist");
    for (int k = 0; k < 4; k++) {
        Vec3 base = wrist + r * (side[k] - 0.01f);
        float s = reach[k];
        at(fingers[k][0], base + f * 0.03f + r * side[k] * 0.5f);
        at(fingers[k][1], base + f * 0.095f * s);
        if (closed) {
            at(fingers[k][2], base + f * 0.1f - u * 0.03f);
            at(fingers[k][3], base + f * 0.08f - u * 0.035f);
            at(fingers[k][4], base + f * 0.06f - u * 0.03f);
            continue;
        }
        at(fingers[k][2], base + f * 0.135f * s - u * 0.008f);
        at(fingers[k][3], base + f * 0.16f * s - u * 0.016f);
        at(fingers[k][4], base + f * 0.175f * s - u * 0.022f);
    }
    at(Joint::thumbMetacarpal, wrist + r * 0.02f + f * 0.02f);
    at(Joint::thumbProximal, wrist + r * 0.035f + f * 0.05f);
    at(Joint::thumbDistal, wrist + r * 0.042f + f * 0.08f);
    at(Joint::thumbTip, wrist + r * 0.045f + f * 0.105f - u * 0.01f);
    h.tracked = true;
    h.aimValid = false;
    h.systemGesture = false;
    h.pinchStrength = 0;
    h.graspStrength = closed ? 1 : 0;
}

int main(int argc, char** argv) {
    std::vector<std::string> args;
    for (int i = 1; i < argc; i++) args.push_back(argv[i]);
    Flags::set(args);
    host::repoRoot = Flags::string("repo").value_or(REPO_ROOT);
    if (auto file = Flags::string("takeInfo")) return takeInfo(*file);
    if (auto file = Flags::string("takeCameras")) return takeCameras(*file, Flags::string("to").value_or("."));
    auto filming = Flags::string("film");

    int width = 1280, height = 900;
    for (size_t i = 0; i + 2 < args.size(); i++) {
        if (args[i] == "-size") {
            width = atoi(args[i + 1].c_str());
            height = atoi(args[i + 2].c_str());
        }
    }
    auto shot = Flags::string("shot");
    double shotAt = Flags::number("shotAt") > 0 ? Flags::number("shotAt") : 3;
    double shotEvery = Flags::number("shotEvery");
    int shots = 0;
    auto frames = Flags::string("frames");
    double framesFrom = Flags::number("framesFrom"), framesTo = Flags::number("framesTo") > 0 ? Flags::number("framesTo") : framesFrom + 1;
    bool offscreen = shot || frames || filming;

    if (!glfwInit()) return 1;
    glfwWindowHint(GLFW_CONTEXT_VERSION_MAJOR, 4);
    glfwWindowHint(GLFW_CONTEXT_VERSION_MINOR, 1);
    glfwWindowHint(GLFW_OPENGL_FORWARD_COMPAT, GLFW_TRUE);
    glfwWindowHint(GLFW_OPENGL_PROFILE, GLFW_OPENGL_CORE_PROFILE);
    glfwWindowHint(GLFW_SRGB_CAPABLE, GLFW_TRUE);
    glfwWindowHint(GLFW_SAMPLES, 4);
    glfwWindowHint(GLFW_COCOA_RETINA_FRAMEBUFFER, offscreen ? GLFW_FALSE : GLFW_TRUE);
    if (offscreen) glfwWindowHint(GLFW_VISIBLE, GLFW_FALSE);
    GLFWwindow* window = glfwCreateWindow(width, height, "Mind Palace Ocean (Quest preview)", nullptr, nullptr);
    if (!window) {
        fprintf(stderr, "no window\n");
        return 1;
    }
    glfwMakeContextCurrent(window);
    glfwSwapInterval(offscreen ? 0 : 1);
    glfwSetScrollCallback(window, [](GLFWwindow*, double, double dy) { scrolled += dy; });
    if (filming) {
        int result = runFilm(*filming);
        glfwTerminate();
        return result;
    }

    // The scene stands where the head faces when it starts, so the head starts facing ahead and is
    // turned by `-yaw` / `-pitch` once the scene has started (below).
    float yaw = 0, pitch = 0;
    float fov = (Flags::number("fov") > 0 ? float(Flags::number("fov")) : 80) * float(M_PI) / 180;
    Vec3 eye{0, 1.5f, 0};
    // (In the preview's room; the scene is given it through where its space lies over the room.)
    auto headMatrix = [&]() {
        Quat q = Quat::angleAxis(-yaw, {0, 1, 0}) * Quat::angleAxis(pitch, {1, 0, 0});
        return host::sceneFromRoom * Mat4::trs(eye, q, {1, 1, 1});
    };
    auto flagNumber = [&](const char* key) {
        for (size_t i = 0; i + 1 < args.size(); i++) {
            if (args[i] == key) return float(atof(args[i + 1].c_str()));
        }
        return 0.f;
    };
    bool moved = false;
    host::head = headMatrix();

    Renderer renderer;
    renderer.init(false);
    std::unique_ptr<PalaceScene> scene = makeScene();
    Input input(scene.get());
    EntityRef world = Entity::make();
    world->addChild(scene->root());
    world->addChild(input.visuals());
    scene->start();
    // Sound: through the Mac's output when the preview runs as a window. A picture is made faster
    // than time passes, so it plays nothing; `-soundOut <file.wav>` writes what would have been
    // heard, frame by frame of the app's own time, to listen to or to measure afterwards.
    auto soundOut = Flags::string("soundOut");
    std::vector<float> heard;
    double heardUntil = 0;
    if (!shot && !soundOut) hostaudio::start();

    // A filming take of this run, and the sheet a camera would place itself by.
    take::Recorder recorder;
    std::optional<Mat4> sheetInRoom;
    if (auto at = Flags::string("sheet")) {
        float x = 0, y = 0.75f, z = -0.6f, degrees = 0;
        sscanf(at->c_str(), "%f,%f,%f,%f", &x, &y, &z, &degrees);
        // Flat, face up: its top edge away from where the room faces, turned about the vertical.
        Quat turn = Quat::angleAxis(-degrees * float(M_PI) / 180, {0, 1, 0});
        Vec3 top = turn.act({0, 0, -1}), out{0, 1, 0};
        sheetInRoom = Mat4(Vec4(cross(top, out), 0), Vec4(top, 0), Vec4(out, 0), Vec4(Vec3{x, y, z}, 1));
    }
    const char* aboutTake = "\"host\":\"mac preview\",\"clock\":\"the app's own time\"";
    bool withPanel = Flags::has("filmPanel");
    if (auto folder = Flags::string("take"); folder && !withPanel) renderer.keepDrawn = recorder.begin(*folder, aboutTake);
    int synced = 0;
    double takeBegan = 0;
    bool sheetLocked = !withPanel;
#ifndef OCEAN_NO_SCENE
    // The filming panel, as the headset has it: the mouse's pinch on its buttons does what a hand's would.
    FilmPanel panel;
    FilmPanel::Press press = FilmPanel::Press::none;
    if (withPanel) {
        world->addChild(panel.root());
        input.setFront(panel.root(), [&](const EntityRef& e) { press = panel.pressed(e); });
    }
#endif

    Perf perf;
    bool logFps = Flags::has("fps") || Flags::has("perf");
    double elapsed = 0, last = glfwGetTime(), lastX = 0, lastY = 0;
    int frameCount = 0;
    float magnify = 1;
    bool magnifying = false;
    double magnifyQuiet = 0;
    while (!glfwWindowShouldClose(window)) {
        glfwPollEvents();
        // (The scene takes its bearings on its first frame: the head turns after that.)
        ++frameCount;
        if (!moved && frameCount >= 3 && elapsed >= Flags::number("moveAt")) {
            moved = true;
            yaw = flagNumber("-yaw") * float(M_PI) / 180;
            pitch = flagNumber("-pitch") * float(M_PI) / 180;
            eye.x += flagNumber("-moveX");
            eye.z += flagNumber("-moveZ");
        }
        // `-lookAt <s> -lookPitch <degrees>`: the head tips up or down to that pitch then, as one looking up from the desk.
        static bool looked = false, lookedBack = false;
        if (!looked && Flags::has("lookAt") && elapsed >= Flags::number("lookAt")) {
            looked = true;
            pitch = flagNumber("-lookPitch") * float(M_PI) / 180;
        }
        // `-lookBackAt <s>`: and back to `-pitch`, as from a glance.
        if (looked && !lookedBack && Flags::has("lookBackAt") && elapsed >= Flags::number("lookBackAt")) {
            lookedBack = true;
            pitch = flagNumber("-pitch") * float(M_PI) / 180;
        }
        // For a picture, app time runs as fast as frames can be made.
        // (`-realtime` keeps the wall clock even for a picture: for looking at what waiting looks like. A hidden
        // window does not wait for the display, so its frames are held to 90 a second to keep app time with the clock.)
        static const bool realtime = Flags::has("realtime");
        if (offscreen && realtime) {
            while (glfwGetTime() < last + 1.0 / 90) std::this_thread::sleep_for(std::chrono::milliseconds(1));
        }
        double wall = glfwGetTime();
        float dt = offscreen && !realtime ? 1.f / 90 : float(std::min(0.1, std::max(1.0 / 240, wall - last)));
        last = wall;
        elapsed += dt;

        double mx, my;
        glfwGetCursorPos(window, &mx, &my);
        int ww, wh, fw, fh;
        glfwGetWindowSize(window, &ww, &wh);
        glfwGetFramebufferSize(window, &fw, &fh);
        if (glfwGetMouseButton(window, GLFW_MOUSE_BUTTON_RIGHT) == GLFW_PRESS) {
            yaw += float(mx - lastX) * 0.004f;
            pitch = std::min(1.4f, std::max(-1.4f, pitch - float(my - lastY) * 0.004f));
        }
        lastX = mx;
        lastY = my;
        Mat4 head = headMatrix();
        host::head = head;

        float aspect = float(fw) / float(fh), t = std::tan(fov / 2);
        // `-aimX <-1…1> -aimY <-1…1>` aims the ray at a place in the window without a mouse (0 0 is the middle,
        // 1 1 the top right), and `-pinchAt <s>` / `-releaseAt <s>` pinch there: for checking picks in a picture.
        bool scripted = Flags::has("aimX") || Flags::has("aimY");
        if (!offscreen || scripted) {
            // The right hand: a ray from the eye through the pointer; the pinch moves with it at arm's length.
            float nx = float(mx / ww * 2 - 1) * t * aspect, ny = float(1 - my / wh * 2) * t;
            if (scripted) {
                const auto& all = Flags::arguments();
                auto after = [&](const char* key) {
                    for (size_t i = 0; i + 1 < all.size(); i++) {
                        if (all[i] == key) return float(atof(all[i + 1].c_str()));
                    }
                    return 0.f;
                };
                nx = after("-aimX") * t * aspect;
                ny = after("-aimY") * t;
                // `-releaseAimX/-releaseAimY`: where it aims as the pinch lets go, moving there evenly from `-aimX/-aimY`
                // while it is held, as a hand's ray moves as its fingers close and open.
                double from = Flags::number("pinchAt"), to = Flags::number("releaseAt");
                if ((Flags::has("releaseAimX") || Flags::has("releaseAimY")) && from > 0 && to > from && elapsed >= from) {
                    float k = float(std::min(1.0, (elapsed - from) / (to - from)));
                    nx += (after("-releaseAimX") - after("-aimX")) * t * aspect * k;
                    ny += (after("-releaseAimY") - after("-aimY")) * t * k;
                }
            }
            Vec3 dir = normalize(head.direction({nx, ny, -1}));
            Input::Pointer p;
            p.valid = true;
            p.origin = head.position();
            p.direction = dir;
            p.pinching = glfwGetMouseButton(window, GLFW_MOUSE_BUTTON_LEFT) == GLFW_PRESS;
            if (scripted) {
                double from = Flags::number("pinchAt"), to = Flags::number("releaseAt") > 0 ? Flags::number("releaseAt") : from + 0.15;
                p.pinching = from > 0 && elapsed >= from && elapsed < to;
            }
            p.grip = head.position() + dir * 0.6f;
            input.set(1, p);
        }
        static const bool lap = Flags::has("lapHand");
        if (lap) layLapHand(elapsed >= Flags::number("lapHandAt") && frameCount >= 3);
        input.update(scene->root(), host::head, dt);
#ifndef OCEAN_NO_SCENE
        if (withPanel) {
            if (press == FilmPanel::Press::lock && sheetInRoom && !(sheetLocked && recorder.on())) sheetLocked = !sheetLocked;
            if (press == FilmPanel::Press::record) {
                if (recorder.on()) {
                    recorder.end();
                    renderer.keepDrawn = false;
                } else if (auto folder = Flags::string("take")) {
                    renderer.keepDrawn = recorder.begin(*folder, aboutTake);
                    takeBegan = elapsed;
                    synced = 0;
                }
            }
            press = FilmPanel::Press::none;
            FilmPanel::State state;
            state.sheetSeen = state.sheetSteady = sheetInRoom.has_value();
            state.sheetLocked = sheetLocked && sheetInRoom;
            state.sheetAway = 0.4f;
            state.recording = recorder.on();
            state.recorded = recorder.on() ? elapsed - takeBegan : 0;
            panel.update(state, host::head, dt);
        }
#endif
        if (scrolled != 0) {
            magnify *= float(std::pow(1.08, scrolled));
            scrolled = 0;
            magnifying = true;
            magnifyQuiet = 0;
            scene->magnifyChanged(magnify);
        } else if (magnifying && (magnifyQuiet += dt) > 0.4) {
            magnifying = false;
            magnify = 1;
            scene->magnifyEnded();
        }
        Async::drain(offscreen && !realtime);      // for a picture, wait for what is being read, so it comes out the same each time
        Cost::reset();
        double updateBegan = mediaTime();
        scene->update(dt);
        if (soundOut) {
            int frames = int((elapsed - heardUntil) * audio::sampleRate);
            if (frames > 0) {
                heardUntil += double(frames) / audio::sampleRate;
                heard.resize(heard.size() + size_t(frames) * 2);
                audio::render(heard.data() + heard.size() - size_t(frames) * 2, frames);
            }
        }
        double updateMs = (mediaTime() - updateBegan) * 1000;
        // `-hitches` lists updates over 4 ms; `-hitches <ms>` sets the line (the headset's chip is about six times slower).
        if (Flags::has("hitches") && updateMs > (Flags::number("hitches") > 0 ? Flags::number("hitches") : 4)) {
            auto part = [](const char* name, Cost::Kind k) { return fmt("%s %d calls %.1f ms", name, Cost::of(k).calls, Cost::of(k).ms); };
            fprintf(stderr, "[hitch] %.1f s: update %.1f ms · %s · %s · %s\n", elapsed, updateMs, part("text layout", Cost::layout).c_str(),
                    part("rasterise", Cost::raster).c_str(), part("decode", Cost::decode).c_str());
        }

        Views views;
        views.count = 1;
        head = host::head.value_or(head);       // the scene may have been laid somewhere else during its update
        views.view[0] = head.inverse();
        float n = 0.05f, f = 60;
        Mat4 proj;
        proj.columns[0] = {1 / (t * aspect), 0, 0, 0};
        proj.columns[1] = {0, 1 / t, 0, 0};
        proj.columns[2] = {0, 0, -(f + n) / (f - n), -1};
        proj.columns[3] = {0, 0, -2 * f * n / (f - n), 0};
        views.projection[0] = proj;
        views.eye = head.position();
        views.forward = head.forward();
        glBindFramebuffer(GL_FRAMEBUFFER, 0);
        glViewport(0, 0, fw, fh);
        // A dim room stands in for the real one seen through the headset.
        float room = 0.05f * (1 - scene->surroundingsDim());
        glEnable(GL_FRAMEBUFFER_SRGB);
        glClearColor(room, room, room * 1.1f, 1);
        glDepthMask(GL_TRUE);
        glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
        renderer.veil = scene->veil();
        renderer.draw(world, views, elapsed);
        if (recorder.on()) {
            if ((synced == 0 && elapsed >= takeBegan + 0.5) || (synced == 1 && shot && elapsed >= shotAt - 1)) {
                synced++;
                audio::sync();
                recorder.sync(elapsed);
            }
            take::Moment moment;
            moment.time = moment.appTime = elapsed;
            moment.veil = renderer.veil;
            moment.dim = scene->surroundingsDim();
            moment.head = host::head;
            if (sheetInRoom && sheetLocked) moment.sheet = host::sceneFromRoom * *sheetInRoom;
            for (int h = 0; h < 2; h++) {
                moment.handTracked[h] = host::hands[h].tracked;
                for (int j = 0; j < int(platform::Joint::count); j++) moment.joints[h][j] = host::hands[h].joints[j];
            }
            recorder.frame(renderer, moment);
        }

        Perf::Frame frame;
        frame.time = elapsed;
        frame.updateMs = updateMs;
        frame.cpuMs = updateMs + renderer.stats.buildMs + renderer.stats.submitMs;
        frame.buildMs = renderer.stats.buildMs;
        frame.submitMs = renderer.stats.submitMs;
        frame.gpuMs = renderer.stats.gpuMs;
        frame.drawCalls = renderer.stats.drawCalls;
        frame.triangles = renderer.stats.triangles;
        perf.add(frame, logFps);

        auto save = [&](const std::string& path) {
            glFinish();
            std::vector<uint8_t> pixels(size_t(fw) * fh * 4);
            glPixelStorei(GL_PACK_ALIGNMENT, 1);
            glReadPixels(0, 0, fw, fh, GL_RGBA, GL_UNSIGNED_BYTE, pixels.data());
            bool ok = host::savePNG(path, fw, fh, pixels);
            fprintf(stderr, "%s %s (%d draws, %d triangles)\n", ok ? "saved" : "could not save", path.c_str(), renderer.stats.drawCalls,
                    renderer.stats.triangles);
        };
        bool closing = shot && elapsed >= shotAt;
        if (closing || (shot && shotEvery > 0 && elapsed >= shotEvery * (shots + 1))) {
            std::string path = *shot;
            if (!closing) path = path.substr(0, path.rfind('.')) + fmt("-%d", ++shots) + path.substr(path.rfind('.'));
            save(path);
            if (closing) break;
        }
        if (frames && elapsed >= framesFrom) {
            save(fmt("%s/%05d.png", frames->c_str(), int(std::lround(elapsed * 1000))));
            if (elapsed >= framesTo) break;
        }
        glfwSwapBuffers(window);
    }
    hostaudio::stop();
    if (recorder.on()) recorder.end();
    if (soundOut) {
        // 16 bit stereo wav.
        std::vector<int16_t> pcm(heard.size());
        for (size_t i = 0; i < heard.size(); i++) pcm[i] = int16_t(std::lround(std::min(1.f, std::max(-1.f, heard[i])) * 32767));
        uint32_t bytes = uint32_t(pcm.size() * 2), rate = audio::sampleRate, byteRate = rate * 4, riff = 36 + bytes, sixteen = 16;
        uint16_t one = 1, two = 2, four = 4, bits = 16;
        if (FILE* f = fopen(soundOut->c_str(), "wb")) {
            fwrite("RIFF", 1, 4, f); fwrite(&riff, 4, 1, f); fwrite("WAVEfmt ", 1, 8, f); fwrite(&sixteen, 4, 1, f);
            fwrite(&one, 2, 1, f); fwrite(&two, 2, 1, f); fwrite(&rate, 4, 1, f); fwrite(&byteRate, 4, 1, f);
            fwrite(&four, 2, 1, f); fwrite(&bits, 2, 1, f); fwrite("data", 1, 4, f); fwrite(&bytes, 4, 1, f);
            fwrite(pcm.data(), 2, pcm.size(), f);
            fclose(f);
            fprintf(stderr, "saved %s (%.1f s; %s)\n", soundOut->c_str(), double(pcm.size()) / 2 / audio::sampleRate, audio::describe().c_str());
        }
    }
    scene.reset();
    glfwTerminate();
    return 0;
}
