// platform.h on the Quest: files on the device, pictures and video through
// Android (Media.kt), head and hands from the OpenXR loop (main.cpp).
#include <android/bitmap.h>
#include <GLES3/gl32.h>
#include <GLES2/gl2ext.h>
#include <sys/stat.h>

#include <algorithm>
#include <cstdio>
#include <cstring>
#include <vector>

#include "base.h"
#include "host.h"
#include "jni_bridge.h"
#include "platform.h"

namespace host {
std::string mediaDir, dataDir, outDir;
std::optional<Mat4> head;
platform::Hand hands[2];
bool handsSupported = false;
}

namespace platform {

// MARK: - Files

std::string resourcePath(const std::string& name) {
    std::string path = host::mediaDir + "/" + name;
    struct stat st;
    return stat(path.c_str(), &st) == 0 ? path : "";
}

std::optional<std::string> readFile(const std::string& path) {
    FILE* f = fopen(path.c_str(), "rb");
    if (!f) return std::nullopt;
    std::string out;
    char buf[65536];
    size_t n;
    while ((n = fread(buf, 1, sizeof buf, f)) > 0) out.append(buf, n);
    fclose(f);
    return out;
}

bool writeFile(const std::string& path, const std::string& contents) {
    std::string tmp = path + ".tmp";
    FILE* f = fopen(tmp.c_str(), "wb");
    if (!f) return false;
    bool ok = fwrite(contents.data(), 1, contents.size(), f) == contents.size();
    fclose(f);
    return ok && rename(tmp.c_str(), path.c_str()) == 0;
}

std::optional<std::string> readText(const std::string& name) {
    std::string path = resourcePath(name);
    if (path.empty()) {
        logLine("[ocean] resource missing: " + name + " (run quest/tools/push_media.sh)");
        return std::nullopt;
    }
    return readFile(path);
}

std::string dataDirectory() { return host::dataDir; }

void openURL(const std::string& url) {
    JNIEnv* e = jni::env();
    jclass cls = e->GetObjectClass(jni::activity());
    jmethodID open = e->GetMethodID(cls, "openUrl", "(Ljava/lang/String;)V");
    jstring jurl = e->NewStringUTF(url.c_str());
    if (open) e->CallVoidMethod(jni::activity(), open, jurl);
    if (e->ExceptionCheck()) e->ExceptionClear();
    e->DeleteLocalRef(jurl);
    e->DeleteLocalRef(cls);
}

// MARK: - Pictures

ImageRef decodeImage(const std::string& path, int maxPixel) {
    if (path.empty()) return nullptr;
    Cost::Scope cost(Cost::decode);
    JNIEnv* e = jni::env();
    static jclass media = jni::findClass("com/kaifengwu/mindpalace/Media");
    static jmethodID decode = e->GetStaticMethodID(media, "decodeImage", "(Ljava/lang/String;I)Landroid/graphics/Bitmap;");
    jstring jpath = e->NewStringUTF(path.c_str());
    jobject bitmap = e->CallStaticObjectMethod(media, decode, jpath, jint(maxPixel));
    e->DeleteLocalRef(jpath);
    if (e->ExceptionCheck()) {
        e->ExceptionClear();
        return nullptr;
    }
    if (!bitmap) return nullptr;
    ImageRef out;
    AndroidBitmapInfo info;
    void* pixels = nullptr;
    if (AndroidBitmap_getInfo(e, bitmap, &info) == 0 && info.format == ANDROID_BITMAP_FORMAT_RGBA_8888 &&
        AndroidBitmap_lockPixels(e, bitmap, &pixels) == 0) {
        out = std::make_shared<Image>();
        out->width = int(info.width);
        out->height = int(info.height);
        out->rgba.resize(size_t(info.width) * info.height * 4);
        for (uint32_t y = 0; y < info.height; y++) {
            memcpy(&out->rgba[size_t(y) * info.width * 4], (const uint8_t*)pixels + size_t(y) * info.stride, size_t(info.width) * 4);
        }
        AndroidBitmap_unlockPixels(e, bitmap);
    }
    static jclass bitmapClass = (jclass)e->NewGlobalRef(e->GetObjectClass(bitmap));
    static jmethodID recycle = e->GetMethodID(bitmapClass, "recycle", "()V");
    e->CallVoidMethod(bitmap, recycle);
    e->DeleteLocalRef(bitmap);
    return out;
}

// MARK: - Head and hands

std::optional<Mat4> head() { return host::head; }
const Hand& hand(int which) { return host::hands[which == 0 ? 0 : 1]; }
bool handTrackingSupported() { return host::handsSupported; }

}  // namespace platform

// MARK: - Video

namespace {

class AndroidVideoPlayer;
std::vector<AndroidVideoPlayer*> players;

struct VideoClass {
    jclass cls = nullptr;
    jmethodID make, load, play, pause, seek, currentTime, duration, setVolume, setMuted, playing, ready, takeEnded, update, release;
    VideoClass() {
        JNIEnv* e = jni::env();
        cls = jni::findClass("com/kaifengwu/mindpalace/VideoSurface");
        make = e->GetMethodID(cls, "<init>", "(I)V");
        load = e->GetMethodID(cls, "load", "(Ljava/lang/String;)V");
        play = e->GetMethodID(cls, "play", "()V");
        pause = e->GetMethodID(cls, "pause", "()V");
        seek = e->GetMethodID(cls, "seek", "(D)V");
        currentTime = e->GetMethodID(cls, "currentTime", "()D");
        duration = e->GetMethodID(cls, "duration", "()D");
        setVolume = e->GetMethodID(cls, "setVolume", "(F)V");
        setMuted = e->GetMethodID(cls, "setMuted", "(Z)V");
        playing = e->GetMethodID(cls, "playing", "()Z");
        ready = e->GetMethodID(cls, "ready", "()Z");
        takeEnded = e->GetMethodID(cls, "takeEnded", "()Z");
        update = e->GetMethodID(cls, "update", "([F)Z");
        release = e->GetMethodID(cls, "release", "()V");
    }
};

const VideoClass& videoClass() {
    static VideoClass c;
    return c;
}

class AndroidVideoPlayer : public VideoPlayer {
public:
    AndroidVideoPlayer() {
        JNIEnv* e = jni::env();
        const VideoClass& c = videoClass();
        frame = std::make_shared<Texture>();
        frame->external = true;
        glGenTextures(1, &frame->gl);
        glBindTexture(GL_TEXTURE_EXTERNAL_OES, frame->gl);
        glTexParameteri(GL_TEXTURE_EXTERNAL_OES, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
        glTexParameteri(GL_TEXTURE_EXTERNAL_OES, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
        glTexParameteri(GL_TEXTURE_EXTERNAL_OES, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
        glTexParameteri(GL_TEXTURE_EXTERNAL_OES, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
        jobject local = e->NewObject(c.cls, c.make, jint(frame->gl));
        surface = e->NewGlobalRef(local);
        e->DeleteLocalRef(local);
        matrix = (jfloatArray)e->NewGlobalRef(e->NewFloatArray(16));
        players.push_back(this);
    }
    ~AndroidVideoPlayer() override {
        JNIEnv* e = jni::env();
        e->CallVoidMethod(surface, videoClass().release);
        e->DeleteGlobalRef(surface);
        e->DeleteGlobalRef(matrix);
        gpu::deadTextures().push_back(frame->gl);
        frame->gl = 0;
        players.erase(std::remove(players.begin(), players.end(), this), players.end());
    }
    void load(const std::string& path) override {
        JNIEnv* e = jni::env();
        jstring jpath = e->NewStringUTF(path.c_str());
        e->CallVoidMethod(surface, videoClass().load, jpath);
        e->DeleteLocalRef(jpath);
    }
    void play() override { jni::env()->CallVoidMethod(surface, videoClass().play); }
    void pause() override { jni::env()->CallVoidMethod(surface, videoClass().pause); }
    void seek(double seconds) override { jni::env()->CallVoidMethod(surface, videoClass().seek, jdouble(seconds)); }
    double currentTime() override { return jni::env()->CallDoubleMethod(surface, videoClass().currentTime); }
    double duration() override { return jni::env()->CallDoubleMethod(surface, videoClass().duration); }
    void setVolume(float v) override { jni::env()->CallVoidMethod(surface, videoClass().setVolume, jfloat(v)); }
    void setMuted(bool m) override { jni::env()->CallVoidMethod(surface, videoClass().setMuted, jboolean(m)); }
    bool playing() override { return jni::env()->CallBooleanMethod(surface, videoClass().playing); }
    bool ready() override { return jni::env()->CallBooleanMethod(surface, videoClass().ready); }
    TextureRef texture() override { return frame; }

    void tick() {
        JNIEnv* e = jni::env();
        if (e->CallBooleanMethod(surface, videoClass().update, matrix)) {
            // SurfaceTexture's matrix expects v to grow upward; the renderer hands it v grown downward
            // (as it does for pictures), so turn it back first: m * flip.
            // In the log, so a run shows that film frames are arriving and how many.
            if (++frames == 1 || frames % 300 == 0) logLine(fmt("[media] film frame %d shown", frames));
            float m[16];
            e->GetFloatArrayRegion(matrix, 0, 16, m);
            float* o = frame->uvTransform;
            for (int r = 0; r < 4; r++) {
                o[0 + r] = m[0 + r];
                o[4 + r] = -m[4 + r];
                o[8 + r] = m[8 + r];
                o[12 + r] = m[4 + r] + m[12 + r];
            }
        }
        if (e->CallBooleanMethod(surface, videoClass().takeEnded) && didPlayToEnd) didPlayToEnd();
    }

private:
    jobject surface = nullptr;
    jfloatArray matrix = nullptr;
    TextureRef frame;
    int frames = 0;
};

}  // namespace

namespace host {
void tickVideos() {
    // A callback may make or drop a player: walk a copy.
    std::vector<AndroidVideoPlayer*> now = players;
    for (AndroidVideoPlayer* p : now) {
        if (std::find(players.begin(), players.end(), p) != players.end()) p->tick();
    }
}
}

namespace platform {
VideoPlayerRef makeVideoPlayer() { return std::make_shared<AndroidVideoPlayer>(); }
}
