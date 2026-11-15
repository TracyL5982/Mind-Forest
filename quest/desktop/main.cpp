// The Mac preview: the same scene and renderer as the Quest app in a
// window, to look at a change without putting the headset on. One eye, the
// mouse for a hand.
//
//   quest/desktop/build.sh && quest/desktop/preview -demo
//   preview -walk 3 -shot /tmp/walk.png -shotAt 6      run 6 s of app time at once, save a picture, quit
//   preview -cards -frames /tmp/open -framesFrom 3 -framesTo 4    save every frame from 3 s to 4 s, then quit
//
// - Move the mouse: the hand ray goes through the pointer. Click: pinch. Drag: a pinch held and moved.
// - Right-drag: turn the head. Scroll: both hands pinching, pulled apart or together.
// - `-eye <x> <y> <z>` is not needed: the head starts at 1.5 m, looking ahead; `-yaw`/`-pitch <degrees>` turn it.
// - `-size <w> <h>` sets the window; `-fov <degrees>` the vertical field of view (default 80).
#define GL_SILENCE_DEPRECATION
#define GLFW_INCLUDE_GLCOREARB
#include <GLFW/glfw3.h>

#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>

#include "app.h"
#include "async.h"
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
    auto headMatrix = [&]() {
        Quat q = Quat::angleAxis(-yaw, {0, 1, 0}) * Quat::angleAxis(pitch, {1, 0, 0});
        return Mat4::trs(eye, q, {1, 1, 1});
    };
    host::head = headMatrix();

    Renderer renderer;
    renderer.init(false);
    std::unique_ptr<PalaceScene> scene = makeScene();
    Input input(scene.get());
    EntityRef world = Entity::make();
    world->addChild(scene->root());
    world->addChild(input.visuals());
    scene->start();

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
        if (++frameCount == 3) {
            yaw = float(Flags::number("yaw")) * float(M_PI) / 180;
            pitch = float(Flags::number("pitch")) * float(M_PI) / 180;
        }
        double wall = glfwGetTime();
        // For a picture, app time runs as fast as frames can be made.
        // (`-realtime` keeps the wall clock even for a picture: for looking at what waiting looks like.)
        static const bool realtime = Flags::has("realtime");
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
            p.origin = eye;
            p.direction = dir;
            p.pinching = glfwGetMouseButton(window, GLFW_MOUSE_BUTTON_LEFT) == GLFW_PRESS;
            if (scripted) {
                double from = Flags::number("pinchAt"), to = Flags::number("releaseAt") > 0 ? Flags::number("releaseAt") : from + 0.15;
                p.pinching = from > 0 && elapsed >= from && elapsed < to;
            }
            p.grip = eye + dir * 0.6f;
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
        double updateMs = (mediaTime() - updateBegan) * 1000;
        // `-hitches` lists updates over 4 ms; `-hitches <ms>` sets the line (the headset's chip is about six times slower).
        if (Flags::has("hitches") && updateMs > (Flags::number("hitches") > 0 ? Flags::number("hitches") : 4)) {
            auto part = [](const char* name, Cost::Kind k) { return fmt("%s %d calls %.1f ms", name, Cost::of(k).calls, Cost::of(k).ms); };
            fprintf(stderr, "[hitch] %.1f s: update %.1f ms · %s · %s · %s\n", elapsed, updateMs, part("text layout", Cost::layout).c_str(),
                    part("rasterise", Cost::raster).c_str(), part("decode", Cost::decode).c_str());
        }

        Views views;
        views.count = 1;
        views.view[0] = head.inverse();
        float n = 0.05f, f = 60;
        Mat4 proj;
        proj.columns[0] = {1 / (t * aspect), 0, 0, 0};
        proj.columns[1] = {0, 1 / t, 0, 0};
        proj.columns[2] = {0, 0, -(f + n) / (f - n), -1};
        proj.columns[3] = {0, 0, -2 * f * n / (f - n), 0};
        views.projection[0] = proj;
        views.eye = eye;
        views.forward = head.forward();
        glBindFramebuffer(GL_FRAMEBUFFER, 0);
        glViewport(0, 0, fw, fh);
        // A dim room stands in for the real one seen through the headset.
        float room = 0.05f * (1 - scene->surroundingsDim());
        glEnable(GL_FRAMEBUFFER_SRGB);
        glClearColor(room, room, room * 1.1f, 1);
        glDepthMask(GL_TRUE);
        glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
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
        if (shot && elapsed >= shotAt) {
            save(*shot);
            break;
        }
        if (frames && elapsed >= framesFrom) {
            save(fmt("%s/%05d.png", frames->c_str(), int(std::lround(elapsed * 1000))));
            if (elapsed >= framesTo) break;
        }
        glfwSwapBuffers(window);
    }
    scene.reset();
    glfwTerminate();
    return 0;
}
