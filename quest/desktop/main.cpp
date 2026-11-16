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

#ifndef REPO_ROOT
#define REPO_ROOT "."
#endif

static double scrolled = 0;

int main(int argc, char** argv) {
    std::vector<std::string> args;
    for (int i = 1; i < argc; i++) args.push_back(argv[i]);
    Flags::set(args);
    host::repoRoot = Flags::string("repo").value_or(REPO_ROOT);

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
    bool offscreen = shot || frames;

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
        input.update(scene->root(), host::head, dt);
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
