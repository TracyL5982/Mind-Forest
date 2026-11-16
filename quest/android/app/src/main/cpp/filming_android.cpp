#include <sys/system_properties.h>
#include <time.h>

#define XR_USE_TIMESPEC
#include <openxr/openxr.h>
#include <openxr/openxr_platform.h>

#include <cmath>
#include <cstring>
#include <deque>
#include <mutex>

#include "audio.h"
#include "base.h"
#include "filming_android.h"
#include "host.h"
#include "jni_bridge.h"

namespace {

/// What SheetCamera.kt hands over, on its own thread: what the headset says of its cameras, once, and pictures.
struct Picture {
    int eye = 0;
    double taken = 0, arrived = 0;      // CLOCK_MONOTONIC, seconds
    int width = 0, height = 0;
    std::vector<uint8_t> jpeg;
};
std::mutex cameraGuard;
std::string cameraInfo;
std::deque<Picture> cameraPictures;


/// The text in the sheet's QR code (quest/film/sheet.py).
const char* sheetText = "MINDPALACE-FILM-1";

double monotonic() {
    timespec t{};
    clock_gettime(CLOCK_MONOTONIC, &t);
    return double(t.tv_sec) + double(t.tv_nsec) / 1e9;
}

Mat4 poseMatrix(const XrPosef& p) {
    return Mat4::trs({p.position.x, p.position.y, p.position.z}, Quat{p.orientation.x, p.orientation.y, p.orientation.z, p.orientation.w}, {1, 1, 1});
}

template <class F>
void load(XrInstance instance, const char* name, F& into) {
    xrGetInstanceProcAddr(instance, name, (PFN_xrVoidFunction*)&into);
}

}  // namespace

bool Filming::wanted() {
    // (The copy installed as `.film` films however it is started: opened from the headset's library, an app gets no flags.)
    return Flags::has("film") || Flags::has("take") || host::outDir.find(".film/") != std::string::npos;
}

std::vector<const char*> Filming::sheetExtensions() {
    return {XR_EXT_FUTURE_EXTENSION_NAME, XR_EXT_SPATIAL_ENTITY_EXTENSION_NAME, XR_EXT_SPATIAL_MARKER_TRACKING_EXTENSION_NAME};
}

void Filming::start(XrInstance instance_, XrSystemId system_, XrSession session_, bool sheetOffered_, bool clockOffered) {
    system = system_;
    sheetOffered = sheetOffered_;
    on = wanted();
    if (!on) return;
    instance = instance_;
    session = session_;
    takeAtStart = Flags::has("take");
    // The paper: each is the Letter sheet scaled to fit (sheet.py).
    // (Kept from one launch to the next: opened from the headset's library, the app is given no flags.)
    std::string kept = host::dataDir + "/film-paper.txt";
    std::string paper = Flags::string("sheetPaper").value_or(platform::readFile(kept).value_or("letter"));
    if (Flags::has("sheetPaper")) platform::writeFile(kept, paper);
    float scale = 1;
    if (paper == "a4") { paperWidth = 0.297f; paperHeight = 0.210f; scale = 0.9727f; }
    else if (paper == "tabloid") { paperWidth = 0.4318f; paperHeight = 0.2794f; scale = 1.2941f; }
    else if (paper == "a3") { paperWidth = 0.420f; paperHeight = 0.297f; scale = 1.3757f; }
    // (Not paper: the sheet shown full screen on a 12.9 inch iPad Pro.)
    else if (paper == "ipad") { paperWidth = 0.26285f; paperHeight = 0.19704f; scale = 0.91266f; }
    codeSide = 0.09f * scale;
    makeOutline();
    if (clockOffered) {
        PFN_xrConvertTimeToTimespecTimeKHR convert = nullptr;
        load(instance, "xrConvertTimeToTimespecTimeKHR", convert);
        convertTime = (void*)convert;
    }
    if (!sheetOffered) {
        logLine("[film] this headset's system does not offer marker tracking: the sheet cannot be found, so takes will not place a camera");
        return;
    }
    beginSheet();
}

double Filming::seconds(XrTime time) const {
    if (convertTime) {
        timespec t{};
        if (XR_SUCCEEDED(((PFN_xrConvertTimeToTimespecTimeKHR)convertTime)(instance, time, &t))) return double(t.tv_sec) + double(t.tv_nsec) / 1e9;
    }
    // (On the Quest an XrTime is CLOCK_MONOTONIC in nanoseconds; the conversion above is the proper way to know.)
    return double(time) / 1e9;
}

// MARK: - The sheet

void Filming::makeOutline() {
    outline = Entity::make();
    outline->isEnabled = false;
    outline->unfilmed = true;
    float w = paperWidth, h = paperHeight, line = 0.0025f;
    Material ink = Material::unlit(Color::hex(0x5EDDB4));
    const Vec3 sizes[5] = {{w, line, line}, {w, line, line}, {line, h, line}, {line, h, line}, {line, h / 4, line}};
    const Vec3 places[5] = {{0, h / 2, 0}, {0, -h / 2, 0}, {-w / 2, 0, 0}, {w / 2, 0, 0}, {0, h / 8, 0}};
    for (int i = 0; i < 5; i++) {
        // (The fifth is a short stroke from the middle toward the sheet's top: a sheet read the wrong way round shows.)
        EntityRef edge = Entity::make(Mesh::generateBox(sizes[i]), {ink});
        edge->position = places[i];
        outline->addChild(edge);
    }
}

void Filming::beginSheet() {
    sheetTriedAt = mediaTime();
    PFN_xrEnumerateSpatialCapabilitiesEXT capabilities = nullptr;
    PFN_xrEnumerateSpatialCapabilityFeaturesEXT features = nullptr;
    load(instance, "xrEnumerateSpatialCapabilitiesEXT", capabilities);
    load(instance, "xrEnumerateSpatialCapabilityFeaturesEXT", features);
    load(instance, "xrPollFutureEXT", pollFuture);
    load(instance, "xrCreateSpatialContextAsyncEXT", createContext);
    load(instance, "xrCreateSpatialContextCompleteEXT", completeContext);
    load(instance, "xrCreateSpatialDiscoverySnapshotAsyncEXT", createDiscovery);
    load(instance, "xrCreateSpatialDiscoverySnapshotCompleteEXT", completeDiscovery);
    load(instance, "xrQuerySpatialComponentDataEXT", queryData);
    load(instance, "xrDestroySpatialSnapshotEXT", destroySnapshot);
    load(instance, "xrGetSpatialBufferStringEXT", bufferString);
    load(instance, "xrGetSpatialBufferUint8EXT", bufferBytes);
    if (!capabilities || !pollFuture || !createContext || !completeContext || !createDiscovery || !completeDiscovery || !queryData || !destroySnapshot) {
        logLine("[film] marker tracking is offered but its calls are not there");
        return;
    }
    uint32_t count = 0;
    capabilities(instance, system, 0, &count, nullptr);
    std::vector<XrSpatialCapabilityEXT> offered(count);
    if (count) capabilities(instance, system, count, &count, offered.data());
    bool codes = false;
    for (XrSpatialCapabilityEXT c : offered) codes = codes || c == XR_SPATIAL_CAPABILITY_MARKER_TRACKING_QR_CODE_EXT;
    if (!codes) {
        logLine(fmt("[film] the headset tracks no QR codes (%u spatial capabilities offered): the sheet cannot be found", count));
        return;
    }
    // Told the code's size and that it stays put, where the headset takes such hints: both make its place surer.
    bool sized = false, fixed = false;
    if (features) {
        uint32_t n = 0;
        features(instance, system, XR_SPATIAL_CAPABILITY_MARKER_TRACKING_QR_CODE_EXT, 0, &n, nullptr);
        std::vector<XrSpatialCapabilityFeatureEXT> list(n);
        if (n) features(instance, system, XR_SPATIAL_CAPABILITY_MARKER_TRACKING_QR_CODE_EXT, n, &n, list.data());
        for (XrSpatialCapabilityFeatureEXT f : list) {
            sized = sized || f == XR_SPATIAL_CAPABILITY_FEATURE_MARKER_TRACKING_FIXED_SIZE_MARKERS_EXT;
            fixed = fixed || f == XR_SPATIAL_CAPABILITY_FEATURE_MARKER_TRACKING_STATIC_MARKERS_EXT;
        }
    }
    static const XrSpatialComponentTypeEXT components[2] = {XR_SPATIAL_COMPONENT_TYPE_MARKER_EXT, XR_SPATIAL_COMPONENT_TYPE_BOUNDED_2D_EXT};
    XrSpatialMarkerSizeEXT size{XR_TYPE_SPATIAL_MARKER_SIZE_EXT};
    size.markerSideLength = codeSide;
    XrSpatialMarkerStaticOptimizationEXT still{XR_TYPE_SPATIAL_MARKER_STATIC_OPTIMIZATION_EXT};
    still.optimizeForStaticMarker = XR_TRUE;
    XrSpatialCapabilityConfigurationQrCodeEXT code{XR_TYPE_SPATIAL_CAPABILITY_CONFIGURATION_QR_CODE_EXT};
    code.capability = XR_SPATIAL_CAPABILITY_MARKER_TRACKING_QR_CODE_EXT;
    code.enabledComponentCount = 2;
    code.enabledComponents = components;
    const void* next = nullptr;
    if (sized) {
        size.next = next;
        next = &size;
    }
    if (fixed) {
        still.next = next;
        next = &still;
    }
    code.next = next;
    const XrSpatialCapabilityConfigurationBaseHeaderEXT* configs[1] = {(const XrSpatialCapabilityConfigurationBaseHeaderEXT*)&code};
    XrSpatialContextCreateInfoEXT info{XR_TYPE_SPATIAL_CONTEXT_CREATE_INFO_EXT};
    info.capabilityConfigCount = 1;
    info.capabilityConfigs = configs;
    XrResult result = createContext(session, &info, &contextFuture);
    if (XR_FAILED(result)) {
        // (-1000710000 is "permission insufficient": the user has not yet allowed the app to see the room. It is tried again.)
        static int said = 0;
        if (said++ == 0) {
            logLine(fmt("[film] could not begin tracking QR codes: %d%s", int(result),
                        result == XR_ERROR_PERMISSION_INSUFFICIENT ? " (the app has not been allowed to see the room; it asks once a hand is held up)" : ""));
        }
        contextFuture = XR_NULL_FUTURE_EXT;
        return;
    }
    sheetOn = true;
    logLine(fmt("[film] looking for the filming sheet: a %.0f mm QR code%s%s", double(codeSide * 1000), sized ? ", its size told" : "",
                fixed ? ", as one that stays put" : ""));
}

void Filming::locate(XrSpace base, XrTime time) {
    // (The head as the last frame had it, in the headset's own space, as the sheet's readings are.)
    headKnown = host::head.has_value();
    if (headKnown) headInRoom = (host::sceneFromRoom.inverse() * *host::head).position();
    if (on && sheetOffered && !sheetOn && mediaTime() - sheetTriedAt > 3) beginSheet();
    if (!sheetOn) return;
    auto ready = [&](XrFutureEXT future) {
        XrFuturePollInfoEXT poll{XR_TYPE_FUTURE_POLL_INFO_EXT};
        poll.future = future;
        XrFuturePollResultEXT state{XR_TYPE_FUTURE_POLL_RESULT_EXT};
        return XR_SUCCEEDED(pollFuture(instance, &poll, &state)) && state.state == XR_FUTURE_STATE_READY_EXT;
    };
    if (context == XR_NULL_HANDLE) {
        if (contextFuture == XR_NULL_FUTURE_EXT || !ready(contextFuture)) return;
        XrCreateSpatialContextCompletionEXT done{XR_TYPE_CREATE_SPATIAL_CONTEXT_COMPLETION_EXT};
        XrResult result = completeContext(session, contextFuture, &done);
        contextFuture = XR_NULL_FUTURE_EXT;
        if (XR_FAILED(result) || XR_FAILED(done.futureResult)) {
            logLine(fmt("[film] tracking QR codes did not begin: %d, %d", int(result), int(done.futureResult)));
            sheetOn = false;
            return;
        }
        context = done.spatialContext;
    }
    // What the headset has found is asked for twice a second: a sheet lying still needs no more, and the
    // asking is answered between frames.
    double now = mediaTime();
    if (discoveryFuture == XR_NULL_FUTURE_EXT) {
        if (now - askedAt < (sheetFixed ? 0.5 : 0.15)) return;
        askedAt = now;
        static const XrSpatialComponentTypeEXT components[2] = {XR_SPATIAL_COMPONENT_TYPE_MARKER_EXT, XR_SPATIAL_COMPONENT_TYPE_BOUNDED_2D_EXT};
        XrSpatialDiscoverySnapshotCreateInfoEXT info{XR_TYPE_SPATIAL_DISCOVERY_SNAPSHOT_CREATE_INFO_EXT};
        info.componentTypeCount = 2;
        info.componentTypes = components;
        if (XR_FAILED(createDiscovery(context, &info, &discoveryFuture))) discoveryFuture = XR_NULL_FUTURE_EXT;
        return;
    }
    if (!ready(discoveryFuture)) return;
    XrCreateSpatialDiscoverySnapshotCompletionInfoEXT info{XR_TYPE_CREATE_SPATIAL_DISCOVERY_SNAPSHOT_COMPLETION_INFO_EXT};
    info.baseSpace = base;
    info.time = time;
    info.future = discoveryFuture;
    XrCreateSpatialDiscoverySnapshotCompletionEXT done{XR_TYPE_CREATE_SPATIAL_DISCOVERY_SNAPSHOT_COMPLETION_EXT};
    XrResult result = completeDiscovery(context, &info, &done);
    discoveryFuture = XR_NULL_FUTURE_EXT;
    if (XR_FAILED(result) || XR_FAILED(done.futureResult) || done.snapshot == XR_NULL_HANDLE) return;
    readSheet(done.snapshot);
    destroySnapshot(done.snapshot);
}

void Filming::readSheet(XrSpatialSnapshotEXT snapshot) {
    static const XrSpatialComponentTypeEXT components[2] = {XR_SPATIAL_COMPONENT_TYPE_MARKER_EXT, XR_SPATIAL_COMPONENT_TYPE_BOUNDED_2D_EXT};
    XrSpatialComponentDataQueryConditionEXT condition{XR_TYPE_SPATIAL_COMPONENT_DATA_QUERY_CONDITION_EXT};
    condition.componentTypeCount = 2;
    condition.componentTypes = components;
    XrSpatialComponentDataQueryResultEXT result{XR_TYPE_SPATIAL_COMPONENT_DATA_QUERY_RESULT_EXT};
    // While the sheet has not been found, the log says every few seconds what the headset does see: no code at
    // all, or codes that are not the sheet's.
    static double saidAt = 0;
    bool say = !sheetFixed && mediaTime() - saidAt > 4;
    if (XR_FAILED(queryData(snapshot, &condition, &result)) || result.entityIdCountOutput == 0) {
        if (say) {
            saidAt = mediaTime();
            logLine("[film] the headset sees no QR code yet");
        }
        return;
    }
    uint32_t n = result.entityIdCountOutput;
    std::vector<XrSpatialEntityIdEXT> ids(n);
    std::vector<XrSpatialEntityTrackingStateEXT> states(n);
    std::vector<XrSpatialMarkerDataEXT> markers(n);
    std::vector<XrSpatialBounded2DDataEXT> bounds(n);
    XrSpatialComponentBounded2DListEXT boundList{XR_TYPE_SPATIAL_COMPONENT_BOUNDED_2D_LIST_EXT};
    boundList.boundCount = n;
    boundList.bounds = bounds.data();
    XrSpatialComponentMarkerListEXT markerList{XR_TYPE_SPATIAL_COMPONENT_MARKER_LIST_EXT};
    markerList.next = &boundList;
    markerList.markerCount = n;
    markerList.markers = markers.data();
    result.next = &markerList;
    result.entityIdCapacityInput = n;
    result.entityIds = ids.data();
    result.entityStateCapacityInput = n;
    result.entityStates = states.data();
    if (XR_FAILED(queryData(snapshot, &condition, &result))) return;
    for (uint32_t i = 0; i < n && i < result.entityIdCountOutput; i++) {
        if (states[i] != XR_SPATIAL_ENTITY_TRACKING_STATE_TRACKING_EXT || markers[i].capability != XR_SPATIAL_CAPABILITY_MARKER_TRACKING_QR_CODE_EXT) {
            if (say) {
                saidAt = mediaTime();
                logLine(fmt("[film] a marker is known but not tracked just now (state %d)", int(states[i])));
            }
            continue;
        }
        // Only the sheet's own code: any other QR code in the room is left alone.
        std::string text;
        XrSpatialBufferGetInfoEXT get{XR_TYPE_SPATIAL_BUFFER_GET_INFO_EXT};
        get.bufferId = markers[i].data.bufferId;
        uint32_t length = 0;
        if (markers[i].data.bufferType == XR_SPATIAL_BUFFER_TYPE_STRING_EXT && bufferString) {
            if (XR_SUCCEEDED(bufferString(snapshot, &get, 0, &length, nullptr)) && length > 0) {
                text.resize(length);
                bufferString(snapshot, &get, length, &length, text.data());
            }
        } else if (markers[i].data.bufferType == XR_SPATIAL_BUFFER_TYPE_UINT8_EXT && bufferBytes) {
            if (XR_SUCCEEDED(bufferBytes(snapshot, &get, 0, &length, nullptr)) && length > 0) {
                text.resize(length);
                bufferBytes(snapshot, &get, length, &length, (uint8_t*)text.data());
            }
        }
        if (text.compare(0, strlen(sheetText), sheetText) != 0) {
            if (say) {
                saidAt = mediaTime();
                logLine("[film] a QR code is seen that is not the sheet's: \"" + text.substr(0, 60) + "\"");
            }
            continue;
        }
        takeReading(poseMatrix(bounds[i].center), bounds[i].extents.width);
        return;
    }
}

namespace {

/// A sheet lying flat (within 4 degrees) is taken as exactly level: the headset knows which way is up far
/// better than it can read the tilt of a small code, and a degree of tilt is centimetres two metres away.
Mat4 levelled(const Mat4& sheet) {
    Vec3 out = -sheet.forward();
    if (out.y < std::cos(4 * float(M_PI) / 180)) return sheet;
    Vec3 top = sheet.up();
    top.y = 0;
    if (length(top) < 1e-3f) return sheet;
    top = normalize(top);
    return Mat4(Vec4(cross(top, {0, 1, 0}), 0), Vec4(top, 0), Vec4(Vec3{0, 1, 0}, 0), Vec4(sheet.position(), 1));
}

}  // namespace

void Filming::takeReading(const Mat4& seen, float codeWidth) {
    readings++;
    double now = mediaTime();
    seenAt = now;
    // How the head stands to the sheet: how far, and how squarely it looks down on its face.
    Vec3 toHead = headInRoom - seen.position();
    float away = headKnown ? length(toHead) : 9;
    float facing = away > 0.01f ? dot(toHead * (1 / away), -seen.forward()) : 0;      // the sheet's z is out of its face
    bool close = away < 0.45f && facing > 0.6f;
    sheetAway = away;
    static double saidAt = 0;
    if (!sheetFixed && now - saidAt > 2) {
        saidAt = now;
        logLine(fmt("[film] the sheet is seen from %.0f cm (reading %d, the code read as %.0f mm)%s", double(away * 100), readings,
                    double(codeWidth * 1000), sheetSteady ? ", steady" : close ? ", close" : ""));
    }
    if (sheetFixed) return;         // locked: nothing moves it
    if (!close) {
        closeLooks.clear();
        // What close looks settled is kept for half a minute against readings from further off, which only jump about:
        // the person leans in, sees the outline lie right, and has time to turn to the panel and lock it.
        if (sheetSteady && now - steadyAt < 30) return;
        sheetSteady = false;
        sheetInRoom = seen;
        return;
    }
    closeLooks.push_back(seen);
    if (closeLooks.size() > 5) closeLooks.erase(closeLooks.begin());
    if (closeLooks.size() < 3) {
        if (!sheetSteady) sheetInRoom = seen;
        return;
    }
    // The middle of the last close readings, if they agree.
    Vec3 middle{};
    Quat first(Mat3(closeLooks[0].right(), closeLooks[0].up(), -closeLooks[0].forward()));
    float qx = 0, qy = 0, qz = 0, qw = 0;
    for (const Mat4& m : closeLooks) {
        middle = middle + m.position() * (1.f / float(closeLooks.size()));
        Quat q(Mat3(m.right(), m.up(), -m.forward()));
        float sign = dot(q.imag, first.imag) + q.real * first.real < 0 ? -1.f : 1.f;
        qx += q.imag.x * sign; qy += q.imag.y * sign; qz += q.imag.z * sign; qw += q.real * sign;
    }
    float norm = std::sqrt(qx * qx + qy * qy + qz * qz + qw * qw);
    if (norm < 1e-4f) return;
    Quat turn{qx / norm, qy / norm, qz / norm, qw / norm};
    Vec3 out = turn.act({0, 0, 1});
    float spread = 0, tilt = 0;
    for (const Mat4& m : closeLooks) {
        spread = std::max(spread, distance(m.position(), middle));
        tilt = std::max(tilt, std::acos(std::min(1.f, std::max(-1.f, dot(-m.forward(), out)))));
    }
    if (spread > 0.012f || tilt > 0.05f) {
        if (!sheetSteady) sheetInRoom = seen;
        return;
    }
    if (!sheetSteady) logLine(fmt("[film] the sheet is steady from %.0f cm: readings within %.1f cm of each other", double(away * 100), double(spread * 100)));
    sheetInRoom = levelled(Mat4::trs(middle, turn, {1, 1, 1}));
    sheetSteady = true;
    steadyAt = now;
}

void Filming::lockSheet() {
    if (sheetFixed) {
        if (recorder.on()) return;      // not during a take: the take has the place it began with
        sheetFixed.reset();
        sheetSteady = false;
        closeLooks.clear();
        logLine("[film] the sheet is unlocked");
        return;
    }
    if (!sheetInRoom) return;
    sheetFixed = levelled(*sheetInRoom);
    sheetInRoom = sheetFixed;
    Vec3 p = sheetFixed->position();
    logLine(fmt("[film] the sheet is locked at %.3f, %.3f, %.3f in the headset's space (%s, last seen from %.0f cm)", double(p.x), double(p.y), double(p.z),
                sheetSteady ? "from close readings that agreed" : "from a single reading", double(sheetAway * 100)));
}

EntityRef Filming::front() const {
#ifndef OCEAN_NO_SCENE
    return on ? panel.root() : nullptr;
#else
    return nullptr;
#endif
}

void Filming::pressed(const EntityRef& entity) {
#ifndef OCEAN_NO_SCENE
    switch (panel.pressed(entity)) {
    case FilmPanel::Press::lock: lockSheet(); break;
    case FilmPanel::Press::record:
        if (!ending) asked = !recorder.on();
        logLine(asked ? "[film] a take is asked for, from the panel" : "[film] the take is asked to end, from the panel");
        break;
    case FilmPanel::Press::none: break;
    }
#endif
}

// MARK: - The headset's cameras

extern "C" {

JNIEXPORT void JNICALL Java_com_kaifengwu_mindpalace_SheetCamera_info(JNIEnv* e, jclass, jbyteArray json) {
    jsize n = e->GetArrayLength(json);
    std::string text(size_t(n), '\0');
    e->GetByteArrayRegion(json, 0, n, (jbyte*)text.data());
    std::lock_guard<std::mutex> lock(cameraGuard);
    cameraInfo = std::move(text);
}

JNIEXPORT void JNICALL Java_com_kaifengwu_mindpalace_SheetCamera_picture(JNIEnv* e, jclass, jint eye, jlong takenNs, jlong arrivedNs, jint width,
                                                                        jint height, jbyteArray jpeg) {
    Picture p;
    p.eye = eye;
    p.taken = double(takenNs) / 1e9;
    p.arrived = double(arrivedNs) / 1e9;
    p.width = width;
    p.height = height;
    jsize n = e->GetArrayLength(jpeg);
    p.jpeg.resize(size_t(n));
    e->GetByteArrayRegion(jpeg, 0, n, (jbyte*)p.jpeg.data());
    std::lock_guard<std::mutex> lock(cameraGuard);
    cameraPictures.push_back(std::move(p));
    while (cameraPictures.size() > 24) cameraPictures.pop_front();
}

}  // extern "C"

/// Once a frame: opens the cameras when somebody is there to be asked, and puts their pictures into the take.
void Filming::cameras(bool recording) {
    // (A hand's own pointer is the sign of a person: a headset on a desk reports hands, but aims no ray from them.)
    bool handUp = host::hands[0].aimValid || host::hands[1].aimValid;
    if (!handUp) handUpSince = 0; else if (handUpSince == 0) handUpSince = mediaTime();
    static jclass cls = jni::findClass("com/kaifengwu/mindpalace/SheetCamera");
    JNIEnv* e = jni::env();
    if (!camerasAsked && cls && ((handUp && mediaTime() - handUpSince > 1.5) || Flags::has("camerasNow"))) {
        camerasAsked = true;
        jmethodID open = e->GetStaticMethodID(cls, "open", "(Landroid/app/Activity;)V");
        if (open) e->CallStaticVoidMethod(cls, open, jni::activity());
        if (e->ExceptionCheck()) e->ExceptionClear();
    }
    // Pictures are only made while a take wants them.
    static bool keeping = false;
    if (recording != keeping && cls) {
        keeping = recording;
        jmethodID keep = e->GetStaticMethodID(cls, "keep", "(Z)V");
        if (keep) e->CallStaticVoidMethod(cls, keep, jboolean(recording));
        if (e->ExceptionCheck()) e->ExceptionClear();
    }
    std::deque<Picture> pictures;
    std::string info;
    {
        std::lock_guard<std::mutex> lock(cameraGuard);
        pictures.swap(cameraPictures);
        if (recording && !camerasTold && !cameraInfo.empty()) info = cameraInfo;
    }
    if (!recording) return;
    if (!info.empty()) {
        recorder.extra("CAMI", info.data(), info.size());
        camerasTold = true;
    }
    for (const Picture& p : pictures) {
        std::vector<uint8_t> piece(25 + p.jpeg.size());
        piece[0] = uint8_t(p.eye);
        uint32_t width = uint32_t(p.width), height = uint32_t(p.height);
        memcpy(&piece[1], &p.taken, 8);
        memcpy(&piece[9], &p.arrived, 8);
        memcpy(&piece[17], &width, 4);
        memcpy(&piece[21], &height, 4);
        memcpy(&piece[25], p.jpeg.data(), p.jpeg.size());
        recorder.extra("CAMR", piece.data(), piece.size());
    }
}

// MARK: - Takes

void Filming::begin(Renderer& renderer) {
    time_t now = time(nullptr);
    tm local{};
    localtime_r(&now, &local);
    char stamp[32];
    strftime(stamp, sizeof stamp, "%Y%m%d-%H%M%S", &local);
    std::string about = fmt("\"host\":\"quest\",\"clock\":\"CLOCK_MONOTONIC, seconds\",\"began\":\"%s\",\"sheetCode\":%.4f,\"sheetSeen\":%s", stamp,
                            double(codeSide), sheetFixed ? "true" : "false");
    if (!recorder.begin(host::outDir + "/takes/take-" + stamp, about)) return;
    renderer.keepDrawn = true;
    beganAt = mediaTime();
    ending = false;
    camerasTold = false;
    syncSeen = audio::syncBegan();
    syncDue = false;
    if (!sheetFixed) logLine("[film] a take has begun before the sheet's place was fixed: look at the sheet from close by during it, or no camera can be placed");
}

/// Writes down when the last sync sound reached the speakers, once the audio device can say.
void Filming::noteSync(bool force) {
    if (!syncDue) return;
    int64_t began = audio::syncBegan();
    double waited = mediaTime() - syncAskedAt;
    if (began != syncSeen && began >= 0 && (waited > 0.25 || force)) {
        if (std::optional<double> at = hostaudio::heardAt(began)) {
            recorder.sync(*at);
            syncSeen = began;
            syncDue = false;
            return;
        }
    }
    if (waited > 1.5 || force) {
        // The device would not say: the moment it was asked for, which is early by the output's delay (tens of milliseconds).
        logLine("[film] the audio device gave no time for the sync sound: its time is a guess");
        recorder.sync(monotonic() - waited + 0.04);
        syncSeen = began;
        syncDue = false;
    }
}

void Filming::frame(Renderer& renderer, bool started, double elapsed, float dim, XrTime displayTime) {
    if (!on) return;
    double now = mediaTime();
    // Whether a take is wanted: asked at launch, or by the Mac through a system property, looked at twice a second.
    if (now - askCheckedAt > 0.5) {
        askCheckedAt = now;
        char value[PROP_VALUE_MAX] = {0};
        __system_property_get("debug.mindpalace.take", value);
        // Only a change of it is an asking: the panel's button asks too, and must not be undone by a value set long ago.
        static bool first = true;
        if (first) {
            first = false;
            askedBy = value;
            if (takeAtStart) asked = true;
        } else if (askedBy != value) {
            askedBy = value;
            asked = value[0] == '1';
            logLine(asked ? "[film] a take is asked for" : "[film] the take is asked to end");
        }
    }
    outline->isEnabled = sheetInRoom.has_value();
    if (sheetInRoom) {
        Mat4 inScene = host::sceneFromRoom * *sheetInRoom;
        outline->position = inScene.position();
        outline->orientation = Quat(Mat3(inScene.right(), inScene.up(), -inScene.forward()));
        // Amber while it is only seen, green once its place is fixed.
        Color ink = sheetFixed ? Color::hex(0x5EDDB4) : Color::hex(0xF5C451);
        for (const EntityRef& edge : outline->children) {
            if (edge->model) edge->model->materials[0].color = ink;
        }
    }
    static const bool headCameras = Flags::has("headCameras");
    if (started && headCameras) cameras(recorder.on() && !ending);
#ifndef OCEAN_NO_SCENE
    {
        FilmPanel::State state;
        state.sheetLocked = sheetFixed.has_value();
        state.sheetSeen = sheetInRoom.has_value() && (state.sheetLocked || sheetSteady || now - seenAt < 2);
        state.sheetSteady = sheetSteady;
        state.sheetAway = sheetAway;
        state.recording = recorder.on() && !ending;
        state.recorded = recorder.on() ? now - beganAt : 0;
        float dt = frameAt > 0 ? float(std::min(0.1, now - frameAt)) : 1.f / 90;
        frameAt = now;
        if (started) panel.update(state, host::head, dt);
    }
#endif
    if (!recorder.on()) {
        if (asked && started) begin(renderer);
        return;
    }
    take::Moment moment;
    moment.time = seconds(displayTime);
    moment.appTime = elapsed;
    moment.veil = renderer.veil;
    moment.dim = dim;
    moment.head = host::head;
    if (sheetFixed) moment.sheet = host::sceneFromRoom * *sheetFixed;
    for (int h = 0; h < 2; h++) {
        moment.handTracked[h] = host::hands[h].tracked;
        for (int j = 0; j < int(platform::Joint::count); j++) moment.joints[h][j] = host::hands[h].joints[j];
    }
    recorder.frame(renderer, moment);

    // A sync sound a moment after it begins, and one as it ends; the take runs on a little so the last is in it.
    if (!syncDue && !ending && syncSeen == audio::syncBegan() && now - beganAt > 0.4 && now - beganAt < 0.6) {
        audio::sync();
        syncDue = true;
        syncAskedAt = now;
    }
    noteSync(false);
    if (!asked && !ending && !syncDue) {
        ending = true;
        endAt = now + 1.0;
        audio::sync();
        syncDue = true;
        syncAskedAt = now;
    }
    if (ending && now >= endAt) {
        noteSync(true);
        recorder.end();
        renderer.keepDrawn = false;
        ending = false;
    }
    if (now - saidAt > 10) {
        saidAt = now;
        logLine("[take] " + recorder.describe());
    }
}

void Filming::stop(Renderer& renderer) {
    if (!recorder.on()) return;
    noteSync(true);
    recorder.end();
    renderer.keepDrawn = false;
}
