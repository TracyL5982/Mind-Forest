// The Quest app: an OpenXR session with passthrough and hand tracking, and
// the frame loop that runs the ported scene. One thread does everything
// (reads head and hands, updates the scene, draws both eyes in one pass),
// as the scene's code expects.
//
// Launch flags of the host itself (the scene's own are in its sources):
//   -hz <72|80|90|120>   display rate to ask for (default 90)
//   -scale <0.5…1.5>     eye buffer size against the recommended one (default 1)
//   -msaa <1|2|4>        samples (default 4)
//   -ffr <0…4>           fixed foveation: off, low, medium, high, high-top (default 2)
//   -cpuLevel/-gpuLevel <1…4>  power saving, sustained low, sustained high, boost (default 3)
//   -noBatch             draw every small picture with its own call (to compare)
//   -uploadBudget <ms>   time a frame may spend sending new pictures to the GPU (default 3)
//   -dragBy hand         a pinched card follows the hand's own movement (as on visionOS) instead of the system's ray
//   -cull <degrees>      skip things further than this from where the head points (default 75; 0 draws all)
//   -perf                write a line per frame to out/perf.csv and a summary each second to the log
//   -quitAfter <s>       end the run after this long
//   -shotAt <s>          save the left eye to out/shot-<n>.bmp at this time (also -shotEvery <s>)
//   -testScene           a plain test scene instead of the ocean
//   -rasterTest          before any session: draw 200 pictures on the background thread beside 2000 text measures, and log how it went
//   -syncRaster          draw every picture on the frame thread, as before pictures could arrive later (to compare)
//   -slowRaster <ms>     hold each picture back this long, to see how waiting looks
//   -noRoom              do not read the room (the headset's scene model): the scene sits at an assumed desk
//   -scanRoom            if the headset knows nothing of the room, show its Space Setup so it can be scanned
#include <EGL/egl.h>
#include <GLES3/gl32.h>
#include <GLES2/gl2ext.h>
#include <jni.h>
#include <unistd.h>

#include <algorithm>
#include <atomic>
#include <cstdio>
#include <cstring>
#include <thread>
#include <vector>

#define XR_USE_PLATFORM_ANDROID
#define XR_USE_GRAPHICS_API_OPENGL_ES
#include <openxr/openxr.h>
#include <openxr/openxr_platform.h>

#include "app.h"
#ifndef OCEAN_NO_SCENE
#include "agent/connection.h"
#endif
#include "async.h"
#include "audio.h"
#include "base.h"
#include "canvas.h"
#include "host.h"
#include "input.h"
#include "jni_bridge.h"
#include "perf.h"
#include "platform.h"
#include "render.h"
#include "room_android.h"

namespace {

std::thread frameThread;
std::atomic<bool> quitting{false};
/// Set from the activity's thread when the user has answered whether the app may see the room.
std::atomic<bool> roomPermissionChanged{false};

typedef void (*MultiviewFn)(GLenum, GLenum, GLuint, GLint, GLint, GLsizei);
typedef void (*MultisampleMultiviewFn)(GLenum, GLenum, GLuint, GLint, GLsizei, GLint, GLsizei);

bool ok(XrResult r, const char* what) {
    if (XR_SUCCEEDED(r)) return true;
    logLine(fmt("[xr] %s failed: %d", what, int(r)));
    return false;
}

Mat4 poseMatrix(const XrPosef& p) {
    return Mat4::trs({p.position.x, p.position.y, p.position.z},
                     Quat{p.orientation.x, p.orientation.y, p.orientation.z, p.orientation.w}, {1, 1, 1});
}

Mat4 projection(const XrFovf& fov, float n, float f) {
    float l = std::tan(fov.angleLeft), r = std::tan(fov.angleRight), u = std::tan(fov.angleUp), d = std::tan(fov.angleDown);
    float w = r - l, h = u - d;
    Mat4 m;
    m.columns[0] = {2 / w, 0, 0, 0};
    m.columns[1] = {0, 2 / h, 0, 0};
    m.columns[2] = {(r + l) / w, (u + d) / h, -(f + n) / (f - n), -1};
    m.columns[3] = {0, 0, -2 * f * n / (f - n), 0};
    return m;
}

struct Egl {
    EGLDisplay display = EGL_NO_DISPLAY;
    EGLConfig config = nullptr;
    EGLContext context = EGL_NO_CONTEXT;
    EGLSurface surface = EGL_NO_SURFACE;

    bool start() {
        display = eglGetDisplay(EGL_DEFAULT_DISPLAY);
        if (!eglInitialize(display, nullptr, nullptr)) return false;
        const EGLint attribs[] = {EGL_RENDERABLE_TYPE, EGL_OPENGL_ES3_BIT, EGL_SURFACE_TYPE, EGL_PBUFFER_BIT | EGL_WINDOW_BIT,
                                  EGL_RED_SIZE, 8, EGL_GREEN_SIZE, 8, EGL_BLUE_SIZE, 8, EGL_ALPHA_SIZE, 8,
                                  EGL_DEPTH_SIZE, 0, EGL_STENCIL_SIZE, 0, EGL_SAMPLES, 0, EGL_NONE};
        EGLint count = 0;
        if (!eglChooseConfig(display, attribs, &config, 1, &count) || count < 1) return false;
        const EGLint contextAttribs[] = {EGL_CONTEXT_CLIENT_VERSION, 3, EGL_NONE};
        context = eglCreateContext(display, config, EGL_NO_CONTEXT, contextAttribs);
        const EGLint surfaceAttribs[] = {EGL_WIDTH, 16, EGL_HEIGHT, 16, EGL_NONE};
        surface = eglCreatePbufferSurface(display, config, surfaceAttribs);
        return context != EGL_NO_CONTEXT && eglMakeCurrent(display, surface, surface, context);
    }

    void stop() {
        if (display == EGL_NO_DISPLAY) return;
        eglMakeCurrent(display, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
        if (surface != EGL_NO_SURFACE) eglDestroySurface(display, surface);
        if (context != EGL_NO_CONTEXT) eglDestroyContext(display, context);
        eglTerminate(display);
        display = EGL_NO_DISPLAY;
    }
};

/// A 32-bit BMP of the bound read framebuffer: what a frame looked like, for the Mac to pull.
void saveShot(const std::string& path, int width, int height) {
    std::vector<uint8_t> pixels(size_t(width) * height * 4);
    glPixelStorei(GL_PACK_ALIGNMENT, 1);
    glReadPixels(0, 0, width, height, GL_RGBA, GL_UNSIGNED_BYTE, pixels.data());
    for (size_t i = 0; i < pixels.size(); i += 4) {
        std::swap(pixels[i], pixels[i + 2]);       // BMP is BGRA
        pixels[i + 3] = 255;                         // over black: the room is not in the eye buffer
    }
    FILE* f = fopen(path.c_str(), "wb");
    if (!f) return;
    uint32_t size = uint32_t(pixels.size()), offset = 54, file = offset + size;
    uint8_t header[54] = {'B', 'M'};
    auto put32 = [&](int at, uint32_t v) { memcpy(header + at, &v, 4); };
    put32(2, file);
    put32(10, offset);
    put32(14, 40);
    put32(18, uint32_t(width));
    put32(22, uint32_t(height));        // positive: rows bottom-up, as GL reads them
    header[26] = 1;
    header[28] = 32;
    put32(34, size);
    fwrite(header, 1, sizeof header, f);
    fwrite(pixels.data(), 1, pixels.size(), f);
    fclose(f);
    logLine("[host] saved " + path);
}

void run() {
    Egl egl;
    if (!egl.start()) {
        logLine("[host] no GL context");
        return;
    }
    JNIEnv* env = jni::env();

    // MARK: Instance

    {
        PFN_xrInitializeLoaderKHR initLoader = nullptr;
        xrGetInstanceProcAddr(XR_NULL_HANDLE, "xrInitializeLoaderKHR", (PFN_xrVoidFunction*)&initLoader);
        if (initLoader) {
            XrLoaderInitInfoAndroidKHR info{XR_TYPE_LOADER_INIT_INFO_ANDROID_KHR};
            info.applicationVM = jni::javaVM();
            info.applicationContext = jni::activity();
            initLoader((XrLoaderInitInfoBaseHeaderKHR*)&info);
        }
    }
    uint32_t extCount = 0;
    xrEnumerateInstanceExtensionProperties(nullptr, 0, &extCount, nullptr);
    std::vector<XrExtensionProperties> available(extCount, {XR_TYPE_EXTENSION_PROPERTIES});
    xrEnumerateInstanceExtensionProperties(nullptr, extCount, &extCount, available.data());
    auto has = [&](const char* name) {
        for (const auto& e : available) {
            if (strcmp(e.extensionName, name) == 0) return true;
        }
        return false;
    };
    {
        // What the headset offers for hands, for the record: the system's own pointer, pinch and gestures.
        std::string offered = "[xr] hand extensions offered:";
        for (const auto& e : available) {
            if (strstr(e.extensionName, "hand") || strstr(e.extensionName, "gesture")) offered += std::string(" ") + e.extensionName;
        }
        logLine(offered);
    }
    std::vector<const char*> enabled{XR_KHR_ANDROID_CREATE_INSTANCE_EXTENSION_NAME, XR_KHR_OPENGL_ES_ENABLE_EXTENSION_NAME};
    auto want = [&](const char* name) {
        if (!has(name)) return false;
        enabled.push_back(name);
        return true;
    };
    bool extHands = want(XR_EXT_HAND_TRACKING_EXTENSION_NAME);
    bool extAim = extHands && want(XR_FB_HAND_TRACKING_AIM_EXTENSION_NAME);
    // Only to write the system's hand model out for the guide's hands to be made from (`-dumpHandMesh`).
    bool extHandMesh = extHands && Flags::has("dumpHandMesh") && want(XR_FB_HAND_TRACKING_MESH_EXTENSION_NAME);
    bool extPassthrough = want(XR_FB_PASSTHROUGH_EXTENSION_NAME);
    bool extRate = want(XR_FB_DISPLAY_REFRESH_RATE_EXTENSION_NAME);
    bool extPerf = want(XR_EXT_PERFORMANCE_SETTINGS_EXTENSION_NAME);
    bool extThreads = want(XR_KHR_ANDROID_THREAD_SETTINGS_EXTENSION_NAME);
    bool extLocalFloor = want(XR_EXT_LOCAL_FLOOR_EXTENSION_NAME);
    bool extHandInteraction = extHands && want(XR_EXT_HAND_INTERACTION_EXTENSION_NAME);
    // The room: Meta's scene model. All of its extensions or none.
    bool extRoom = !Flags::has("noRoom");
    for (const char* name : Room::extensions()) extRoom = extRoom && has(name);
    if (extRoom) {
        for (const char* name : Room::extensions()) enabled.push_back(name);
    }
    {
        std::string offered = "[xr] scene extensions offered:";
        for (const auto& e : available) {
            if (strstr(e.extensionName, "scene") || strstr(e.extensionName, "spatial") || strstr(e.extensionName, "plane")) offered += std::string(" ") + e.extensionName;
        }
        logLine(offered);
    }
    bool extFoveation = has(XR_FB_FOVEATION_EXTENSION_NAME) && has(XR_FB_FOVEATION_CONFIGURATION_EXTENSION_NAME) &&
                        has(XR_FB_SWAPCHAIN_UPDATE_STATE_EXTENSION_NAME);
    if (extFoveation) {
        enabled.push_back(XR_FB_FOVEATION_EXTENSION_NAME);
        enabled.push_back(XR_FB_FOVEATION_CONFIGURATION_EXTENSION_NAME);
        enabled.push_back(XR_FB_SWAPCHAIN_UPDATE_STATE_EXTENSION_NAME);
    }

    XrInstance instance = XR_NULL_HANDLE;
    {
        XrInstanceCreateInfoAndroidKHR android{XR_TYPE_INSTANCE_CREATE_INFO_ANDROID_KHR};
        android.applicationVM = jni::javaVM();
        android.applicationActivity = jni::activity();
        XrInstanceCreateInfo info{XR_TYPE_INSTANCE_CREATE_INFO};
        info.next = &android;
        strncpy(info.applicationInfo.applicationName, "Mind Palace Ocean", XR_MAX_APPLICATION_NAME_SIZE - 1);
        strncpy(info.applicationInfo.engineName, "ocean", XR_MAX_ENGINE_NAME_SIZE - 1);
        info.applicationInfo.applicationVersion = 1;
        info.applicationInfo.apiVersion = XR_MAKE_VERSION(1, 0, 34);
        info.enabledExtensionCount = uint32_t(enabled.size());
        info.enabledExtensionNames = enabled.data();
        if (!ok(xrCreateInstance(&info, &instance), "xrCreateInstance")) return;
    }
    XrSystemId system = XR_NULL_SYSTEM_ID;
    {
        XrSystemGetInfo info{XR_TYPE_SYSTEM_GET_INFO};
        info.formFactor = XR_FORM_FACTOR_HEAD_MOUNTED_DISPLAY;
        if (!ok(xrGetSystem(instance, &info, &system), "xrGetSystem")) return;
    }
    {
        PFN_xrGetOpenGLESGraphicsRequirementsKHR requirements = nullptr;
        xrGetInstanceProcAddr(instance, "xrGetOpenGLESGraphicsRequirementsKHR", (PFN_xrVoidFunction*)&requirements);
        XrGraphicsRequirementsOpenGLESKHR r{XR_TYPE_GRAPHICS_REQUIREMENTS_OPENGL_ES_KHR};
        if (requirements) requirements(instance, system, &r);
    }

    // MARK: Session

    XrSession session = XR_NULL_HANDLE;
    {
        XrGraphicsBindingOpenGLESAndroidKHR binding{XR_TYPE_GRAPHICS_BINDING_OPENGL_ES_ANDROID_KHR};
        binding.display = egl.display;
        binding.config = egl.config;
        binding.context = egl.context;
        XrSessionCreateInfo info{XR_TYPE_SESSION_CREATE_INFO};
        info.next = &binding;
        info.systemId = system;
        if (!ok(xrCreateSession(instance, &info, &session), "xrCreateSession")) return;
    }

    // The floor is y = 0, under where the user was when the headset was last recentred.
    XrSpace appSpace = XR_NULL_HANDLE, viewSpace = XR_NULL_HANDLE;
    {
        uint32_t n = 0;
        xrEnumerateReferenceSpaces(session, 0, &n, nullptr);
        std::vector<XrReferenceSpaceType> types(n);
        xrEnumerateReferenceSpaces(session, n, &n, types.data());
        auto offered = [&](XrReferenceSpaceType t) { return std::find(types.begin(), types.end(), t) != types.end(); };
        XrReferenceSpaceCreateInfo info{XR_TYPE_REFERENCE_SPACE_CREATE_INFO};
        info.poseInReferenceSpace.orientation.w = 1;
        if (extLocalFloor && offered(XR_REFERENCE_SPACE_TYPE_LOCAL_FLOOR_EXT)) {
            info.referenceSpaceType = XR_REFERENCE_SPACE_TYPE_LOCAL_FLOOR_EXT;
        } else if (offered(XR_REFERENCE_SPACE_TYPE_STAGE)) {
            info.referenceSpaceType = XR_REFERENCE_SPACE_TYPE_STAGE;
        } else {
            info.referenceSpaceType = XR_REFERENCE_SPACE_TYPE_LOCAL;
            info.poseInReferenceSpace.position.y = -1.5f;      // no floor known: assume eyes at 1.5 m
        }
        logLine(fmt("[xr] reference space %d", int(info.referenceSpaceType)));
        if (!ok(xrCreateReferenceSpace(session, &info, &appSpace), "app space")) return;
        XrReferenceSpaceCreateInfo view{XR_TYPE_REFERENCE_SPACE_CREATE_INFO};
        view.referenceSpaceType = XR_REFERENCE_SPACE_TYPE_VIEW;
        view.poseInReferenceSpace.orientation.w = 1;
        xrCreateReferenceSpace(session, &view, &viewSpace);
    }

    Room room;
    room.start(instance, session, extRoom);
    bool roomAsked = false, captureAsked = false;
    double roomWaitFrom = 0;
    // The table the scene is fixed to, and where its anchor was when the scene was last laid by it.
    int held = 0;
    bool heldKnown = false;
    Mat4 heldPose;

    // MARK: Eye buffers: one array texture, both eyes drawn in one pass

    const XrViewConfigurationType viewType = XR_VIEW_CONFIGURATION_TYPE_PRIMARY_STEREO;
    XrViewConfigurationView configViews[2] = {{XR_TYPE_VIEW_CONFIGURATION_VIEW}, {XR_TYPE_VIEW_CONFIGURATION_VIEW}};
    {
        uint32_t n = 0;
        xrEnumerateViewConfigurationViews(instance, system, viewType, 2, &n, configViews);
    }
    double scaleFlag = Flags::number("scale");
    float bufferScale = scaleFlag > 0 ? float(std::min(1.5, std::max(0.5, scaleFlag))) : 1;
    int width = int(float(configViews[0].recommendedImageRectWidth) * bufferScale) & ~1;
    int height = int(float(configViews[0].recommendedImageRectHeight) * bufferScale) & ~1;
    int samples = Flags::has("msaa") ? std::max(1, Flags::integer("msaa")) : 4;

    XrSwapchain swapchain = XR_NULL_HANDLE;
    std::vector<XrSwapchainImageOpenGLESKHR> images;
    std::vector<GLuint> framebuffers;
    GLuint depthTexture = 0, readFramebuffer = 0;
    {
        uint32_t n = 0;
        xrEnumerateSwapchainFormats(session, 0, &n, nullptr);
        std::vector<int64_t> formats(n);
        xrEnumerateSwapchainFormats(session, n, &n, formats.data());
        int64_t format = std::find(formats.begin(), formats.end(), int64_t(GL_SRGB8_ALPHA8)) != formats.end() ? GL_SRGB8_ALPHA8 : formats[0];

        XrSwapchainCreateInfoFoveationFB foveation{XR_TYPE_SWAPCHAIN_CREATE_INFO_FOVEATION_FB};
        foveation.flags = XR_SWAPCHAIN_CREATE_FOVEATION_SCALED_BIN_BIT_FB;
        XrSwapchainCreateInfo info{XR_TYPE_SWAPCHAIN_CREATE_INFO};
        if (extFoveation) info.next = &foveation;
        info.usageFlags = XR_SWAPCHAIN_USAGE_COLOR_ATTACHMENT_BIT | XR_SWAPCHAIN_USAGE_SAMPLED_BIT;
        info.format = format;
        info.sampleCount = 1;
        info.width = uint32_t(width);
        info.height = uint32_t(height);
        info.faceCount = 1;
        info.arraySize = 2;
        info.mipCount = 1;
        if (!ok(xrCreateSwapchain(session, &info, &swapchain), "xrCreateSwapchain")) return;
        xrEnumerateSwapchainImages(swapchain, 0, &n, nullptr);
        images.assign(n, {XR_TYPE_SWAPCHAIN_IMAGE_OPENGL_ES_KHR});
        xrEnumerateSwapchainImages(swapchain, n, &n, (XrSwapchainImageBaseHeader*)images.data());

        auto multiview = (MultiviewFn)eglGetProcAddress("glFramebufferTextureMultiviewOVR");
        auto multisample = (MultisampleMultiviewFn)eglGetProcAddress("glFramebufferTextureMultisampleMultiviewOVR");
        if (!multiview) {
            logLine("[host] no multiview on this GL");
            return;
        }
        if (!multisample) samples = 1;
        glGenTextures(1, &depthTexture);
        glBindTexture(GL_TEXTURE_2D_ARRAY, depthTexture);
        glTexStorage3D(GL_TEXTURE_2D_ARRAY, 1, GL_DEPTH_COMPONENT24, width, height, 2);
        framebuffers.resize(images.size());
        glGenFramebuffers(GLsizei(framebuffers.size()), framebuffers.data());
        for (size_t i = 0; i < images.size(); i++) {
            glBindFramebuffer(GL_DRAW_FRAMEBUFFER, framebuffers[i]);
            if (samples > 1) {
                multisample(GL_DRAW_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, images[i].image, 0, samples, 0, 2);
                multisample(GL_DRAW_FRAMEBUFFER, GL_DEPTH_ATTACHMENT, depthTexture, 0, samples, 0, 2);
            } else {
                multiview(GL_DRAW_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, images[i].image, 0, 0, 2);
                multiview(GL_DRAW_FRAMEBUFFER, GL_DEPTH_ATTACHMENT, depthTexture, 0, 0, 2);
            }
            GLenum status = glCheckFramebufferStatus(GL_DRAW_FRAMEBUFFER);
            if (status != GL_FRAMEBUFFER_COMPLETE) logLine(fmt("[host] framebuffer %zu incomplete: 0x%x", i, status));
        }
        glBindFramebuffer(GL_DRAW_FRAMEBUFFER, 0);
        glGenFramebuffers(1, &readFramebuffer);
        logLine(fmt("[host] eye buffers %d x %d x2, %d samples, %zu images, format 0x%llx", width, height, samples, images.size(),
                    (long long)format));
    }

    int ffr = Flags::has("ffr") ? Flags::integer("ffr") : 2;
    if (extFoveation && ffr > 0) {
        PFN_xrCreateFoveationProfileFB create = nullptr;
        PFN_xrDestroyFoveationProfileFB destroy = nullptr;
        PFN_xrUpdateSwapchainFB update = nullptr;
        xrGetInstanceProcAddr(instance, "xrCreateFoveationProfileFB", (PFN_xrVoidFunction*)&create);
        xrGetInstanceProcAddr(instance, "xrDestroyFoveationProfileFB", (PFN_xrVoidFunction*)&destroy);
        xrGetInstanceProcAddr(instance, "xrUpdateSwapchainFB", (PFN_xrVoidFunction*)&update);
        if (create && destroy && update) {
            XrFoveationLevelProfileCreateInfoFB level{XR_TYPE_FOVEATION_LEVEL_PROFILE_CREATE_INFO_FB};
            level.level = ffr == 1 ? XR_FOVEATION_LEVEL_LOW_FB : ffr == 2 ? XR_FOVEATION_LEVEL_MEDIUM_FB : XR_FOVEATION_LEVEL_HIGH_FB;
            level.verticalOffset = 0;
            level.dynamic = XR_FOVEATION_DYNAMIC_DISABLED_FB;
            XrFoveationProfileCreateInfoFB profileInfo{XR_TYPE_FOVEATION_PROFILE_CREATE_INFO_FB};
            profileInfo.next = &level;
            XrFoveationProfileFB profile = XR_NULL_HANDLE;
            if (ok(create(session, &profileInfo, &profile), "foveation profile")) {
                XrSwapchainStateFoveationFB state{XR_TYPE_SWAPCHAIN_STATE_FOVEATION_FB};
                state.profile = profile;
                ok(update(swapchain, (XrSwapchainStateBaseHeaderFB*)&state), "foveation on the swapchain");
                destroy(profile);
            }
        }
    }

    // MARK: Passthrough

    XrPassthroughFB passthrough = XR_NULL_HANDLE;
    XrPassthroughLayerFB passthroughLayer = XR_NULL_HANDLE;
    if (extPassthrough) {
        PFN_xrCreatePassthroughFB create = nullptr;
        PFN_xrCreatePassthroughLayerFB createLayer = nullptr;
        xrGetInstanceProcAddr(instance, "xrCreatePassthroughFB", (PFN_xrVoidFunction*)&create);
        xrGetInstanceProcAddr(instance, "xrCreatePassthroughLayerFB", (PFN_xrVoidFunction*)&createLayer);
        XrPassthroughCreateInfoFB info{XR_TYPE_PASSTHROUGH_CREATE_INFO_FB};
        info.flags = XR_PASSTHROUGH_IS_RUNNING_AT_CREATION_BIT_FB;
        if (create && createLayer && ok(create(session, &info, &passthrough), "passthrough")) {
            XrPassthroughLayerCreateInfoFB layer{XR_TYPE_PASSTHROUGH_LAYER_CREATE_INFO_FB};
            layer.passthrough = passthrough;
            layer.purpose = XR_PASSTHROUGH_LAYER_PURPOSE_RECONSTRUCTION_FB;
            layer.flags = XR_PASSTHROUGH_IS_RUNNING_AT_CREATION_BIT_FB;
            ok(createLayer(session, &layer, &passthroughLayer), "passthrough layer");
        }
    }

    // MARK: Hands

    XrHandTrackerEXT trackers[2] = {XR_NULL_HANDLE, XR_NULL_HANDLE};
    PFN_xrLocateHandJointsEXT locateJoints = nullptr;
    if (extHands) {
        XrSystemHandTrackingPropertiesEXT handProps{XR_TYPE_SYSTEM_HAND_TRACKING_PROPERTIES_EXT};
        XrSystemProperties props{XR_TYPE_SYSTEM_PROPERTIES};
        props.next = &handProps;
        xrGetSystemProperties(instance, system, &props);
        PFN_xrCreateHandTrackerEXT create = nullptr;
        xrGetInstanceProcAddr(instance, "xrCreateHandTrackerEXT", (PFN_xrVoidFunction*)&create);
        xrGetInstanceProcAddr(instance, "xrLocateHandJointsEXT", (PFN_xrVoidFunction*)&locateJoints);
        if (handProps.supportsHandTracking && create && locateJoints) {
            for (int i = 0; i < 2; i++) {
                XrHandTrackerCreateInfoEXT info{XR_TYPE_HAND_TRACKER_CREATE_INFO_EXT};
                info.hand = i == 0 ? XR_HAND_LEFT_EXT : XR_HAND_RIGHT_EXT;
                info.handJointSet = XR_HAND_JOINT_SET_DEFAULT_EXT;
                ok(create(session, &info, &trackers[i]), "hand tracker");
            }
            host::handsSupported = trackers[0] != XR_NULL_HANDLE && trackers[1] != XR_NULL_HANDLE;
        }
    }
    // `-dumpHandMesh`: the headset's own model of each hand (its shape, its joints as they are when the
    // model was made, and how much each joint moves each point), written to out/hand-left.bin and
    // out/hand-right.bin. tools/hand_mesh.py turns them into what the guide's hands are drawn from.
    if (extHandMesh) {
        PFN_xrGetHandMeshFB getMesh = nullptr;
        xrGetInstanceProcAddr(instance, "xrGetHandMeshFB", (PFN_xrVoidFunction*)&getMesh);
        for (int i = 0; i < 2 && getMesh && trackers[i] != XR_NULL_HANDLE; i++) {
            XrHandTrackingMeshFB mesh{XR_TYPE_HAND_TRACKING_MESH_FB};
            if (!ok(getMesh(trackers[i], &mesh), "hand mesh size")) continue;
            std::vector<XrPosef> poses(mesh.jointCountOutput);
            std::vector<float> radii(mesh.jointCountOutput);
            std::vector<XrHandJointEXT> parents(mesh.jointCountOutput);
            std::vector<XrVector3f> positions(mesh.vertexCountOutput), normals(mesh.vertexCountOutput);
            std::vector<XrVector2f> uvs(mesh.vertexCountOutput);
            std::vector<XrVector4sFB> blendIndices(mesh.vertexCountOutput);
            std::vector<XrVector4f> blendWeights(mesh.vertexCountOutput);
            std::vector<int16_t> indices(mesh.indexCountOutput);
            mesh.jointCapacityInput = mesh.jointCountOutput;
            mesh.jointBindPoses = poses.data();
            mesh.jointRadii = radii.data();
            mesh.jointParents = parents.data();
            mesh.vertexCapacityInput = mesh.vertexCountOutput;
            mesh.vertexPositions = positions.data();
            mesh.vertexNormals = normals.data();
            mesh.vertexUVs = uvs.data();
            mesh.vertexBlendIndices = blendIndices.data();
            mesh.vertexBlendWeights = blendWeights.data();
            mesh.indexCapacityInput = mesh.indexCountOutput;
            mesh.indices = indices.data();
            if (!ok(getMesh(trackers[i], &mesh), "hand mesh")) continue;
            std::string path = host::outDir + (i == 0 ? "/hand-left.bin" : "/hand-right.bin");
            if (FILE* f = fopen(path.c_str(), "wb")) {
                uint32_t head[4] = {0x48534D48, mesh.jointCountOutput, mesh.vertexCountOutput, mesh.indexCountOutput};
                fwrite(head, sizeof(head), 1, f);
                fwrite(poses.data(), sizeof(XrPosef), poses.size(), f);
                fwrite(radii.data(), sizeof(float), radii.size(), f);
                for (XrHandJointEXT p : parents) {
                    int32_t parent = int32_t(p);
                    fwrite(&parent, sizeof(parent), 1, f);
                }
                fwrite(positions.data(), sizeof(XrVector3f), positions.size(), f);
                fwrite(normals.data(), sizeof(XrVector3f), normals.size(), f);
                fwrite(uvs.data(), sizeof(XrVector2f), uvs.size(), f);
                fwrite(blendIndices.data(), sizeof(XrVector4sFB), blendIndices.size(), f);
                fwrite(blendWeights.data(), sizeof(XrVector4f), blendWeights.size(), f);
                fwrite(indices.data(), sizeof(int16_t), indices.size(), f);
                fclose(f);
                logLine(fmt("[xr] hand mesh %d: %u joints, %u vertices, %u indices -> %s", i, mesh.jointCountOutput, mesh.vertexCountOutput,
                            mesh.indexCountOutput, path.c_str()));
            }
        }
    }
    // The system's own reading of a closed hand (the hand interaction profile's grasp), for the fist:
    // the headset's makers know their own joints better than a rule tuned on another headset's.
    XrActionSet actionSet = XR_NULL_HANDLE;
    XrAction graspAction = XR_NULL_HANDLE;
    XrPath handPaths[2] = {XR_NULL_PATH, XR_NULL_PATH};
    if (extHandInteraction) {
        xrStringToPath(instance, "/user/hand/left", &handPaths[0]);
        xrStringToPath(instance, "/user/hand/right", &handPaths[1]);
        XrActionSetCreateInfo setInfo{XR_TYPE_ACTION_SET_CREATE_INFO};
        strcpy(setInfo.actionSetName, "hands");
        strcpy(setInfo.localizedActionSetName, "Hands");
        XrActionCreateInfo actionInfo{XR_TYPE_ACTION_CREATE_INFO};
        actionInfo.actionType = XR_ACTION_TYPE_FLOAT_INPUT;
        strcpy(actionInfo.actionName, "grasp");
        strcpy(actionInfo.localizedActionName, "Closed hand");
        actionInfo.countSubactionPaths = 2;
        actionInfo.subactionPaths = handPaths;
        XrPath profile = XR_NULL_PATH;
        XrActionSuggestedBinding bindings[2] = {};
        bool made = ok(xrCreateActionSet(instance, &setInfo, &actionSet), "action set") &&
                    ok(xrCreateAction(actionSet, &actionInfo, &graspAction), "grasp action") &&
                    ok(xrStringToPath(instance, "/interaction_profiles/ext/hand_interaction_ext", &profile), "hand profile");
        if (made) {
            bindings[0].action = bindings[1].action = graspAction;
            xrStringToPath(instance, "/user/hand/left/input/grasp_ext/value", &bindings[0].binding);
            xrStringToPath(instance, "/user/hand/right/input/grasp_ext/value", &bindings[1].binding);
            XrInteractionProfileSuggestedBinding suggested{XR_TYPE_INTERACTION_PROFILE_SUGGESTED_BINDING};
            suggested.interactionProfile = profile;
            suggested.countSuggestedBindings = 2;
            suggested.suggestedBindings = bindings;
            XrSessionActionSetsAttachInfo attach{XR_TYPE_SESSION_ACTION_SETS_ATTACH_INFO};
            attach.countActionSets = 1;
            attach.actionSets = &actionSet;
            made = ok(xrSuggestInteractionProfileBindings(instance, &suggested), "hand bindings") &&
                   ok(xrAttachSessionActionSets(session, &attach), "attach actions");
        }
        if (!made) graspAction = XR_NULL_HANDLE;
    }
    logLine(fmt("[xr] the system's closed-hand reading: %s", graspAction != XR_NULL_HANDLE ? "yes" : "no"));
    logLine(fmt("[xr] hands %s, aim %s, passthrough %s, foveation %s", host::handsSupported ? "yes" : "no", extAim ? "yes" : "no",
                passthroughLayer != XR_NULL_HANDLE ? "yes" : "no", extFoveation && ffr > 0 ? "yes" : "no"));

    // MARK: Pace: display rate, clocks, and which cores this thread runs on

    if (extRate) {
        PFN_xrEnumerateDisplayRefreshRatesFB enumerate = nullptr;
        PFN_xrRequestDisplayRefreshRateFB request = nullptr;
        xrGetInstanceProcAddr(instance, "xrEnumerateDisplayRefreshRatesFB", (PFN_xrVoidFunction*)&enumerate);
        xrGetInstanceProcAddr(instance, "xrRequestDisplayRefreshRateFB", (PFN_xrVoidFunction*)&request);
        if (enumerate && request) {
            uint32_t n = 0;
            enumerate(session, 0, &n, nullptr);
            std::vector<float> rates(n);
            enumerate(session, n, &n, rates.data());
            float wanted = Flags::number("hz") > 0 ? float(Flags::number("hz")) : 90;
            float best = 0;
            for (float r : rates) {
                if (best == 0 || std::fabs(r - wanted) < std::fabs(best - wanted)) best = r;
            }
            if (best > 0) ok(request(session, best), "display rate");
            logLine(fmt("[xr] display rate asked %.0f Hz (of %zu offered)", best, rates.size()));
        }
    }
    auto setLevels = [&]() {
        if (!extPerf) return;
        PFN_xrPerfSettingsSetPerformanceLevelEXT set = nullptr;
        xrGetInstanceProcAddr(instance, "xrPerfSettingsSetPerformanceLevelEXT", (PFN_xrVoidFunction*)&set);
        if (!set) return;
        auto level = [](int v) {
            return v <= 1 ? XR_PERF_SETTINGS_LEVEL_POWER_SAVINGS_EXT : v == 2 ? XR_PERF_SETTINGS_LEVEL_SUSTAINED_LOW_EXT
                 : v == 3 ? XR_PERF_SETTINGS_LEVEL_SUSTAINED_HIGH_EXT : XR_PERF_SETTINGS_LEVEL_BOOST_EXT;
        };
        set(session, XR_PERF_SETTINGS_DOMAIN_CPU_EXT, level(Flags::has("cpuLevel") ? Flags::integer("cpuLevel") : 3));
        set(session, XR_PERF_SETTINGS_DOMAIN_GPU_EXT, level(Flags::has("gpuLevel") ? Flags::integer("gpuLevel") : 3));
    };
    auto markThread = [&]() {
        if (!extThreads) return;
        PFN_xrSetAndroidApplicationThreadKHR set = nullptr;
        xrGetInstanceProcAddr(instance, "xrSetAndroidApplicationThreadKHR", (PFN_xrVoidFunction*)&set);
        if (set) set(session, XR_ANDROID_THREAD_TYPE_RENDERER_MAIN_KHR, uint32_t(gettid()));
    };

    // MARK: The scene

    Renderer renderer;
    renderer.init(true);
    std::unique_ptr<PalaceScene> scene = makeScene();
    Input input(scene.get());
    EntityRef world = Entity::make();
    world->addChild(scene->root());
    world->addChild(input.visuals());
    Perf perf;
    if (Flags::has("perf")) perf.open(host::outDir + "/perf.csv");
    bool logFps = Flags::has("perf") || Flags::has("fps");
    double cullDegrees = Flags::has("cull") ? Flags::number("cull") : 75;
    double quitAfter = Flags::number("quitAfter");
    double shotAt = Flags::number("shotAt"), shotEvery = Flags::number("shotEvery");
    int shots = 0;

    bool running = false, started = false, exitAsked = false;
    double handsNotedAt = 0;
    bool handsWereSeen = false;
    FILE* handsFile = nullptr;
    XrSessionState state = XR_SESSION_STATE_UNKNOWN;
    XrTime lastDisplayTime = 0;
    double runBegan = 0, lastFrameWall = 0;

    // `-rasterTest`: before any session, draw two hundred pictures on the background thread while this
    // thread measures text, as a busy step does, and say how it went. It checks the one thing a headset
    // lying on a desk (its session held back by the boundary dialog) cannot otherwise show.
    if (Flags::has("rasterTest")) {
        double began = mediaTime();
        std::vector<ImageRef> made;
        TextAttributes words;
        words.font = Font::systemFont(28, Font::Weight::semibold);
        words.foregroundColor = Color::white();
        long measured = 0;
        for (int i = 0; i < 200; i++) {
            UIGraphicsImageRendererFormat format;
            format.scale = 1;
            std::string text = fmt("Picture %d of the test", i);
            made.push_back(UIGraphicsImageRenderer(CGSize(320, 96), format).image([&](Canvas&) {
                setFill(Color::hex(0x101820));
                UIRectFill(CGRect(0, 0, 320, 96));
                drawString(text, CGPoint(12, 30), words);
            }));
            for (int k = 0; k < 10; k++) measured += long(stringSize(fmt("measured %d %d", i, k), words).width);
        }
        double asked = mediaTime();
        long lit = 0;
        for (const ImageRef& image : made) {
            image->wait();
            for (size_t p = 0; p < image->rgba.size(); p += 97) lit += image->rgba[p];
        }
        logLine(fmt("[test] raster: 200 pictures asked for in %.0f ms beside 2000 measures (%ld), all there after %.0f ms, sum %ld, last %d x %d",
                    (asked - began) * 1000, measured, (mediaTime() - began) * 1000, lit, made.back()->width, made.back()->height));
    }

    // MARK: Frames

    while (!quitting) {
        XrEventDataBuffer event{XR_TYPE_EVENT_DATA_BUFFER};
        bool ended = false;
        while (xrPollEvent(instance, &event) == XR_SUCCESS) {
            if (event.type == XR_TYPE_EVENT_DATA_SESSION_STATE_CHANGED) {
                state = ((XrEventDataSessionStateChanged*)&event)->state;
                logLine(fmt("[xr] session state %d", int(state)));
                if (state == XR_SESSION_STATE_READY) {
                    XrSessionBeginInfo begin{XR_TYPE_SESSION_BEGIN_INFO};
                    begin.primaryViewConfigurationType = viewType;
                    running = ok(xrBeginSession(session, &begin), "xrBeginSession");
                    setLevels();
                    markThread();
                    hostaudio::start();
                } else if (state == XR_SESSION_STATE_STOPPING) {
                    running = false;
                    hostaudio::stop();          // the headset is off or the app is put aside: nothing sounds
                    xrEndSession(session);
                } else if (state == XR_SESSION_STATE_EXITING || state == XR_SESSION_STATE_LOSS_PENDING) {
                    ended = true;
                }
            } else if (event.type == XR_TYPE_EVENT_DATA_INSTANCE_LOSS_PENDING) {
                ended = true;
            } else if (event.type == XR_TYPE_EVENT_DATA_REFERENCE_SPACE_CHANGE_PENDING) {
                // The user recentred the headset: the scene is told, and comes to where they are.
                logLine("[xr] the headset was recentred");
                host::recentred = true;
            } else {
                room.handle(event);
            }
            event = {XR_TYPE_EVENT_DATA_BUFFER};
        }
        if (ended) break;
        if (!running) {
            usleep(20000);
            continue;
        }

        XrFrameState frame{XR_TYPE_FRAME_STATE};
        if (!ok(xrWaitFrame(session, nullptr, &frame), "xrWaitFrame")) break;
        double frameBegan = mediaTime();
        Cost::reset();
        xrBeginFrame(session, nullptr);

        // Head, eyes, hands, all for the moment this frame is shown.
        XrView views[2] = {{XR_TYPE_VIEW}, {XR_TYPE_VIEW}};
        XrViewState viewState{XR_TYPE_VIEW_STATE};
        {
            XrViewLocateInfo locate{XR_TYPE_VIEW_LOCATE_INFO};
            locate.viewConfigurationType = viewType;
            locate.displayTime = frame.predictedDisplayTime;
            locate.space = appSpace;
            uint32_t n = 0;
            xrLocateViews(session, &locate, &viewState, 2, &n, views);
        }
        bool posed = (viewState.viewStateFlags & XR_VIEW_STATE_POSITION_VALID_BIT) && (viewState.viewStateFlags & XR_VIEW_STATE_ORIENTATION_VALID_BIT);

        // The room. It is read once the session runs, again when the scene asks or the user has just
        // allowed it, and its tables are placed every frame (a handful of calls).
        if (!roomAsked || host::readRoomAsked || roomPermissionChanged.exchange(false)) {
            roomAsked = true;
            host::readRoomAsked = false;
            room.read();
        }
        room.locate(appSpace, frame.predictedDisplayTime);
        // The scene is kept fixed to the table it sits at: when the headset shifts its own bearings
        // (it has found itself again, or was recentred), that table's anchor moves in the app space,
        // and the scene's space is moved the same way. Only a turn about the vertical and a move.
        if (host::heldTable != held) {
            held = host::heldTable;
            heldKnown = false;
        }
        if (const Room::Found* table = held ? room.table(held) : nullptr; table && table->placed) {
            if (!heldKnown) {
                heldPose = table->pose;
                heldKnown = true;
            } else {
                Vec3 was = heldPose.direction({0, 0, -1}), is = table->pose.direction({0, 0, -1});
                float turn = std::atan2(was.x, was.z) - std::atan2(is.x, is.z);
                turn = std::atan2(std::sin(turn), std::cos(turn));
                float moved = distance(heldPose.position(), table->pose.position());
                if (moved > 0.004f || std::fabs(turn) > 0.0035f) {
                    Quat q = Quat::angleAxis(-turn, {0, 1, 0});
                    Mat4 shift = Mat4::trs(table->pose.position() - q.act(heldPose.position()), q, {1, 1, 1});
                    host::sceneFromRoom = host::sceneFromRoom * shift.inverse();
                    if (moved > 0.05f || std::fabs(turn) > 0.03f) {
                        logLine(fmt("[room] the headset's bearings shifted %.2f m and %.1f degrees: the scene stays at its table", double(moved),
                                    double(turn * 180 / M_PI)));
                    }
                    heldPose = table->pose;
                }
            }
        }
        const Mat4 lay = host::sceneFromRoom;
        const Quat layTurn(Mat3(lay.columns[0].xyz(), lay.columns[1].xyz(), lay.columns[2].xyz()));
        host::tables.clear();
        for (const Room::Found& f : room.tables()) {
            if (!f.placed) continue;
            platform::Table t = f.top;
            t.center = lay.point(t.center);
            t.a = lay.direction(t.a);
            t.b = lay.direction(t.b);
            host::tables.push_back(t);
        }
        {
            XrSpaceLocation location{XR_TYPE_SPACE_LOCATION};
            xrLocateSpace(viewSpace, appSpace, frame.predictedDisplayTime, &location);
            bool valid = (location.locationFlags & XR_SPACE_LOCATION_POSITION_VALID_BIT) && (location.locationFlags & XR_SPACE_LOCATION_ORIENTATION_VALID_BIT);
            if (valid) host::head = lay * poseMatrix(location.pose);
        }
        // Whether the app may see the room is asked of the user once somebody is there to answer: the
        // session has the focus and a hand has been held up for a second (see MainActivity.askForRoom).
        // The system's own pointer is the sign of that: a headset lying on a desk still reports hands,
        // where it last saw them, but aims no ray from them.
        static bool roomPermissionAsked = false;
        static double handUpSince = 0;
        bool handUp = host::hands[0].aimValid || host::hands[1].aimValid;
        if (!handUp) handUpSince = 0; else if (handUpSince == 0) handUpSince = mediaTime();
        if (extRoom && !roomPermissionAsked && started && state == XR_SESSION_STATE_FOCUSED && handUp && mediaTime() - handUpSince > 1 &&
            mediaTime() - runBegan > 1.5) {
            roomPermissionAsked = true;
            jclass cls = env->GetObjectClass(jni::activity());
            jmethodID ask = env->GetMethodID(cls, "askForRoom", "()V");
            if (ask) env->CallVoidMethod(jni::activity(), ask);
            if (env->ExceptionCheck()) env->ExceptionClear();
            env->DeleteLocalRef(cls);
        }
        // The scene waits for the first reading of the room before it sits down, but not for long.
        if (host::head && roomWaitFrom == 0) roomWaitFrom = mediaTime();
        if (!host::roomSettled) {
            bool placed = true;
            for (const Room::Found& f : room.tables()) placed = placed && f.placed;
            bool late = roomWaitFrom > 0 && mediaTime() - roomWaitFrom > 2.0;
            if ((room.settled() && (placed || late)) || late) {
                host::roomSettled = true;
                logLine(fmt("[room] settled after %.2f s with %zu tables", roomWaitFrom > 0 ? mediaTime() - roomWaitFrom : 0.0, host::tables.size()));
                if (Flags::has("scanRoom") && room.settled() && room.tables().empty() && !captureAsked) {
                    captureAsked = true;
                    room.capture();
                }
            }
        }
        for (int i = 0; i < 2; i++) {
            platform::Hand& hand = host::hands[i];
            hand.tracked = false;
            hand.aimValid = false;
            hand.systemGesture = false;
            hand.pinchStrength = -1;
            hand.graspStrength = -1;
            if (trackers[i] == XR_NULL_HANDLE) continue;
            XrHandJointLocationEXT joints[XR_HAND_JOINT_COUNT_EXT];
            XrHandTrackingAimStateFB aim{XR_TYPE_HAND_TRACKING_AIM_STATE_FB};
            XrHandJointLocationsEXT locations{XR_TYPE_HAND_JOINT_LOCATIONS_EXT};
            if (extAim) locations.next = &aim;
            locations.jointCount = XR_HAND_JOINT_COUNT_EXT;
            locations.jointLocations = joints;
            XrHandJointsLocateInfoEXT locate{XR_TYPE_HAND_JOINTS_LOCATE_INFO_EXT};
            locate.baseSpace = appSpace;
            locate.time = frame.predictedDisplayTime;
            if (XR_FAILED(locateJoints(trackers[i], &locate, &locations)) || !locations.isActive) continue;
            // Every joint as the system places it, seen or not (see Hands.swift): a fist's fingertips are hidden.
            bool any = false;
            for (int j = 0; j < XR_HAND_JOINT_COUNT_EXT; j++) {
                if (joints[j].locationFlags & XR_SPACE_LOCATION_POSITION_VALID_BIT) any = true;
                const XrPosef& p = joints[j].pose;
                hand.joints[j] = lay.point({p.position.x, p.position.y, p.position.z});
                hand.rotations[j] = layTurn * Quat{p.orientation.x, p.orientation.y, p.orientation.z, p.orientation.w};
            }
            hand.tracked = any;
            if (extAim && any) {
                hand.aimValid = (aim.status & XR_HAND_TRACKING_AIM_VALID_BIT_FB) != 0;
                hand.systemGesture = (aim.status & (XR_HAND_TRACKING_AIM_SYSTEM_GESTURE_BIT_FB | XR_HAND_TRACKING_AIM_MENU_PRESSED_BIT_FB)) != 0;
                hand.aimOrigin = lay.point({aim.aimPose.position.x, aim.aimPose.position.y, aim.aimPose.position.z});
                Quat q{aim.aimPose.orientation.x, aim.aimPose.orientation.y, aim.aimPose.orientation.z, aim.aimPose.orientation.w};
                hand.aimDirection = lay.direction(q.act({0, 0, -1}));
                hand.pinchStrength = aim.pinchStrengthIndex;
            }
        }

        if (graspAction != XR_NULL_HANDLE) {
            XrActiveActionSet active{actionSet, XR_NULL_PATH};
            XrActionsSyncInfo sync{XR_TYPE_ACTIONS_SYNC_INFO};
            sync.countActiveActionSets = 1;
            sync.activeActionSets = &active;
            bool synced = state == XR_SESSION_STATE_FOCUSED && XR_SUCCEEDED(xrSyncActions(session, &sync));
            for (int i = 0; i < 2; i++) {
                host::hands[i].graspStrength = -1;
                if (!synced || !host::hands[i].tracked) continue;
                XrActionStateGetInfo get{XR_TYPE_ACTION_STATE_GET_INFO};
                get.action = graspAction;
                get.subactionPath = handPaths[i];
                XrActionStateFloat value{XR_TYPE_ACTION_STATE_FLOAT};
                if (XR_SUCCEEDED(xrGetActionStateFloat(session, &get, &value)) && value.isActive) host::hands[i].graspStrength = value.currentState;
            }
        }

        float dt = lastDisplayTime > 0 ? float(double(frame.predictedDisplayTime - lastDisplayTime) / 1e9) : 1.f / 90;
        dt = std::min(0.1f, std::max(1.f / 240, dt));
        lastDisplayTime = frame.predictedDisplayTime;

        // The scene starts once the head is known: it stands where you are and faces where you face.
        // The two big pictures the ocean is built from are unpacked on the background thread first (0.1 s
        // of work); frames keep coming meanwhile, with nothing in them yet.
        static bool atlasesAsked = false;
        static std::string atlases[2];
        if (!started && !atlasesAsked) {
            atlasesAsked = true;
            if (!Flags::has("testScene")) {
                atlases[0] = platform::resourcePath("clips/atlas.jpg");
                atlases[1] = platform::resourcePath("works/atlas.jpg");
                for (const std::string& a : atlases) platform::prefetchImage(a, 0);
            }
        }
        bool atlasesReady = true;
        for (const std::string& a : atlases) {
            if (!a.empty() && !platform::imageReady(a, 0)) atlasesReady = false;
        }
        if (!started && host::head && atlasesReady && host::roomSettled) {
            double began = mediaTime();
            scene->start();
            started = true;
            runBegan = mediaTime();
            logLine(fmt("[host] scene started in %.2f s", runBegan - began));
        }
        double now = mediaTime();
        double elapsed = started ? now - runBegan : 0;

        double updateBegan = mediaTime();
        if (started) {
            host::tickVideos();
            Async::drain();
            input.update(scene->root(), host::head, dt);
            scene->update(dt);
        }
        double updateMs = (mediaTime() - updateBegan) * 1000;

        // What the hands are read as, once a second while one is seen: in the log, and in out/hands.txt
        // for the Mac to pull. This is how a gesture that does not work in the headset is told apart
        // from one the headset never reported.
        if (started && now - handsNotedAt >= 1 && (host::hands[0].tracked || host::hands[1].tracked || handsWereSeen)) {
            handsNotedAt = now;
            handsWereSeen = host::hands[0].tracked || host::hands[1].tracked;
            std::string line = fmt("[hands] %.0f s:", elapsed);
            for (int i = 0; i < 2; i++) {
                const platform::Hand& h = host::hands[i];
                const char* side = i == 0 ? "left" : "right";
                if (!h.tracked) {
                    line += fmt(" %s not seen ·", side);
                    continue;
                }
                using platform::Joint;
                Vec3 wrist = h.at(Joint::wrist);
                float size = std::max(distance(h.at(Joint::middleProximal), wrist), 0.05f);
                float least = 9, most = 0;
                for (Joint j : {Joint::indexTip, Joint::middleTip, Joint::ringTip, Joint::littleTip}) {
                    float r = distance(h.at(j), wrist) / size;
                    least = std::min(least, r);
                    most = std::max(most, r);
                }
                line += fmt(" %s gap %.1f cm, pinch %.2f, grasp %.2f, reach %.2f to %.2f, spread %.2f, %s%s, %s ·", side,
                            distance(h.at(Joint::thumbTip), h.at(Joint::indexTip)) * 100, h.pinchStrength, h.graspStrength, least, most,
                            distance(h.at(Joint::indexTip), h.at(Joint::littleTip)) / size, h.aimValid ? "ray" : "no ray",
                            h.systemGesture ? " (system gesture)" : "", input.describe(i).c_str());
            }
            logLine(line);
            if (!handsFile) handsFile = fopen((host::outDir + "/hands.txt").c_str(), "w");
            if (handsFile) {
                fprintf(handsFile, "%s\n", line.c_str());
                fflush(handsFile);
            }
        }

        std::vector<XrCompositionLayerBaseHeader*> layers;
        XrCompositionLayerPassthroughFB passthroughInfo{XR_TYPE_COMPOSITION_LAYER_PASSTHROUGH_FB};
        XrCompositionLayerProjection projectionLayer{XR_TYPE_COMPOSITION_LAYER_PROJECTION};
        XrCompositionLayerProjectionView projectionViews[2] = {{XR_TYPE_COMPOSITION_LAYER_PROJECTION_VIEW}, {XR_TYPE_COMPOSITION_LAYER_PROJECTION_VIEW}};
        if (frame.shouldRender && posed) {
            uint32_t index = 0;
            XrSwapchainImageAcquireInfo acquire{XR_TYPE_SWAPCHAIN_IMAGE_ACQUIRE_INFO};
            xrAcquireSwapchainImage(swapchain, &acquire, &index);
            XrSwapchainImageWaitInfo wait{XR_TYPE_SWAPCHAIN_IMAGE_WAIT_INFO};
            wait.timeout = XR_INFINITE_DURATION;
            xrWaitSwapchainImage(swapchain, &wait);

            Views eyes;
            eyes.count = 2;
            for (int i = 0; i < 2; i++) {
                // (Through where the scene's space lies now: the scene may have moved it in its update.)
                eyes.view[i] = (host::sceneFromRoom * poseMatrix(views[i].pose)).inverse();
                eyes.projection[i] = projection(views[i].fov, 0.05f, 60);
            }
            if (host::head) {
                eyes.eye = host::head->position();
                eyes.forward = host::head->forward();
            }
            eyes.cullCos = cullDegrees > 0 && cullDegrees < 180 ? float(std::cos(cullDegrees * M_PI / 180)) : -1;

            glBindFramebuffer(GL_DRAW_FRAMEBUFFER, framebuffers[index]);
            glViewport(0, 0, width, height);
            glScissor(0, 0, width, height);
            // The room shows wherever nothing is drawn; a little black over it dims it.
            float dim = started ? std::min(1.f, std::max(0.f, scene->surroundingsDim())) : 0;
            glClearColor(0, 0, 0, passthroughLayer != XR_NULL_HANDLE ? dim : 1);
            glDepthMask(GL_TRUE);
            glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
            renderer.veil = started ? scene->veil() : 1;
            if (started) renderer.draw(world, eyes, elapsed);
            const GLenum discard[] = {GL_DEPTH_ATTACHMENT};
            glInvalidateFramebuffer(GL_DRAW_FRAMEBUFFER, 1, discard);
            glBindFramebuffer(GL_DRAW_FRAMEBUFFER, 0);

            bool shoot = (shotAt > 0 && elapsed >= shotAt && shots == 0) || (shotEvery > 0 && elapsed >= shotEvery * (shots + 1));
            if (shoot && started) {
                glBindFramebuffer(GL_READ_FRAMEBUFFER, readFramebuffer);
                glFramebufferTextureLayer(GL_READ_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, images[index].image, 0, 0);
                saveShot(fmt("%s/shot-%d.bmp", host::outDir.c_str(), shots), width, height);
                glBindFramebuffer(GL_READ_FRAMEBUFFER, 0);
                shots++;
            }

            XrSwapchainImageReleaseInfo release{XR_TYPE_SWAPCHAIN_IMAGE_RELEASE_INFO};
            xrReleaseSwapchainImage(swapchain, &release);

            for (int i = 0; i < 2; i++) {
                projectionViews[i].pose = views[i].pose;
                projectionViews[i].fov = views[i].fov;
                projectionViews[i].subImage.swapchain = swapchain;
                projectionViews[i].subImage.imageRect = {{0, 0}, {width, height}};
                projectionViews[i].subImage.imageArrayIndex = uint32_t(i);
            }
            projectionLayer.space = appSpace;
            projectionLayer.viewCount = 2;
            projectionLayer.views = projectionViews;
            if (passthroughLayer != XR_NULL_HANDLE) {
                passthroughInfo.flags = XR_COMPOSITION_LAYER_BLEND_TEXTURE_SOURCE_ALPHA_BIT;
                passthroughInfo.layerHandle = passthroughLayer;
                layers.push_back((XrCompositionLayerBaseHeader*)&passthroughInfo);
                // The eye buffer's colours are already multiplied by their alpha.
                projectionLayer.layerFlags = XR_COMPOSITION_LAYER_BLEND_TEXTURE_SOURCE_ALPHA_BIT;
            }
            layers.push_back((XrCompositionLayerBaseHeader*)&projectionLayer);
        }
        XrFrameEndInfo end{XR_TYPE_FRAME_END_INFO};
        end.displayTime = frame.predictedDisplayTime;
        end.environmentBlendMode = XR_ENVIRONMENT_BLEND_MODE_OPAQUE;
        end.layerCount = uint32_t(layers.size());
        end.layers = layers.data();
        xrEndFrame(session, &end);

        if (started) {
            double wall = mediaTime();
            Perf::Frame f;
            f.time = elapsed;
            f.intervalMs = lastFrameWall > 0 ? (wall - lastFrameWall) * 1000 : 0;
            f.cpuMs = (wall - frameBegan) * 1000;
            f.updateMs = updateMs;
            f.buildMs = renderer.stats.buildMs;
            f.submitMs = renderer.stats.submitMs;
            f.gpuMs = renderer.stats.gpuMs;
            f.drawCalls = renderer.stats.drawCalls;
            f.triangles = renderer.stats.triangles;
            f.culled = renderer.stats.culled;
            f.uploads = renderer.stats.meshUploads + renderer.stats.textureUploads;
            f.uploadBytes = renderer.stats.meshUploadBytes;
            perf.add(f, logFps);
            lastFrameWall = wall;
            // A frame that ran over its time (13 ms is past the budget at 90 Hz, and at 72): say what it spent it on.
            if (f.cpuMs > 13 && logFps) {
                auto part = [](const char* name, Cost::Kind k) { return fmt("%s %d calls %.1f ms", name, Cost::of(k).calls, Cost::of(k).ms); };
                logLine(fmt("[hitch] %.1f s: %.0f ms (update %.0f, draw %.0f) · %s · %s · %s · %s", elapsed, f.cpuMs, updateMs, f.buildMs + f.submitMs,
                            part("text layout", Cost::layout).c_str(), part("rasterise", Cost::raster).c_str(),
                            part("decode", Cost::decode).c_str(), part("texture upload", Cost::texture).c_str()));
            }
        }

        if (quitAfter > 0 && started && elapsed >= quitAfter && !exitAsked) {
            exitAsked = true;
            perf.close();
            logLine("[host] run over");
            xrRequestExitSession(session);
            jclass cls = env->GetObjectClass(jni::activity());
            jmethodID finish = env->GetMethodID(cls, "finishFromNative", "()V");
            env->CallVoidMethod(jni::activity(), finish);
            env->DeleteLocalRef(cls);
        }
    }

    perf.close();
    hostaudio::stop();
    scene.reset();
    if (session != XR_NULL_HANDLE) xrDestroySession(session);
    if (instance != XR_NULL_HANDLE) xrDestroyInstance(instance);
    egl.stop();
}

}  // namespace

extern "C" {

JNIEXPORT void JNICALL Java_com_kaifengwu_mindpalace_MainActivity_nativeStart(JNIEnv* env, jobject self, jobjectArray args, jstring mediaDir,
                                                                             jobject assets, jstring dataDir, jstring outDir, jstring server,
                                                                             jstring appKey) {
    jni::attach(env, self);
    auto text = [&](jstring s) {
        const char* c = env->GetStringUTFChars(s, nullptr);
        std::string out(c);
        env->ReleaseStringUTFChars(s, c);
        return out;
    };
    std::vector<std::string> arguments;
    jsize n = env->GetArrayLength(args);
    for (jsize i = 0; i < n; i++) {
        jstring s = (jstring)env->GetObjectArrayElement(args, i);
        arguments.push_back(text(s));
        env->DeleteLocalRef(s);
    }
    host::mediaDir = text(mediaDir);
    host::useAssets(env, assets);
    host::dataDir = text(dataDir);
    host::outDir = text(outDir);
#ifndef OCEAN_NO_SCENE
    // Started from the app library there are no flags: the app joins the agent service it was last started with, or the
    // judging build its own.
    std::string remembered = host::dataDir + "/agent-connection.json";
    std::optional<agent::BuiltIn> builtIn;
    if (std::string address = text(server); !address.empty()) builtIn = agent::BuiltIn{address, text(appKey), agent::deviceId(host::dataDir + "/device-id")};
    agent::Launch launch = agent::launch(arguments, platform::readFile(remembered), builtIn);
    if (launch.file == agent::Launch::File::save) platform::writeFile(remembered, launch.text);
    if (launch.file == agent::Launch::File::forget) std::remove(remembered.c_str());
    arguments = launch.arguments;
    if (!launch.said.empty()) logLine(launch.said);
#endif
    Flags::set(arguments);
    std::string line = "[host] starting with:";
    for (size_t i = 0; i < arguments.size(); i++) line += " " + (i > 0 && arguments[i - 1] == "-agentToken" ? std::string("(the token)") : arguments[i]);
    logLine(line);
    quitting = false;
    frameThread = std::thread(run);
}

/// The user has answered whether the app may see the room (MainActivity): read it again.
JNIEXPORT void JNICALL Java_com_kaifengwu_mindpalace_MainActivity_nativeRoomPermission(JNIEnv*, jobject, jboolean granted) {
    logLine(granted ? "[room] the app may see the room" : "[room] the app may not see the room: it sits at an assumed desk");
    if (granted) roomPermissionChanged = true;
}

JNIEXPORT void JNICALL Java_com_kaifengwu_mindpalace_MainActivity_nativeStop(JNIEnv*, jobject) {
    quitting = true;
    if (frameThread.joinable()) frameThread.join();
}

}
