// platform.h's sound on the Quest: the microphone, MediaPlayer and streamed speech from Kotlin (Sound.kt), reached through JNI.
#include <jni.h>

#include <atomic>
#include <map>
#include <mutex>
#include <vector>

#include "base.h"
#include "jni_bridge.h"
#include "platform.h"

namespace {

struct SoundClass {
    jclass cls = nullptr;
    jmethodID openMicrophone, closeMicrophone, play, stop, openStream, writeStream, finishStream, stopStream;
    SoundClass() {
        JNIEnv* e = jni::env();
        cls = jni::findClass("com/kaifengwu/mindpalace/Sound");
        openMicrophone = e->GetStaticMethodID(cls, "openMicrophone", "(Landroid/app/Activity;JZZ)V");
        closeMicrophone = e->GetStaticMethodID(cls, "closeMicrophone", "(J)V");
        play = e->GetStaticMethodID(cls, "play", "(Landroid/app/Activity;Ljava/lang/String;J)V");
        stop = e->GetStaticMethodID(cls, "stop", "(Landroid/app/Activity;J)V");
        openStream = e->GetStaticMethodID(cls, "openStream", "(IJ)V");
        writeStream = e->GetStaticMethodID(cls, "writeStream", "(J[S)V");
        finishStream = e->GetStaticMethodID(cls, "finishStream", "(J)V");
        stopStream = e->GetStaticMethodID(cls, "stopStream", "(J)V");
    }
};

const SoundClass& sound() {
    static SoundClass c;
    return c;
}

std::mutex registry;
std::map<int64_t, platform::MicrophoneEvents> microphones;
std::map<int64_t, std::function<void(bool)>> playing;
std::atomic<int64_t> nextHandle{1};

class AndroidMicrophone : public platform::Microphone {
public:
    explicit AndroidMicrophone(int64_t handle) : handle(handle) {}
    ~AndroidMicrophone() override { stop(); }
    void stop() override {
        if (stopped.exchange(true)) return;
        jni::env()->CallStaticVoidMethod(sound().cls, sound().closeMicrophone, jlong(handle));
        std::lock_guard<std::mutex> g(registry);
        microphones.erase(handle);
    }

private:
    int64_t handle;
    std::atomic<bool> stopped{false};
};

class AndroidSound : public platform::Sound {
public:
    explicit AndroidSound(int64_t handle) : handle(handle) {}
    void stop() override { jni::env()->CallStaticVoidMethod(sound().cls, sound().stop, jni::activity(), jlong(handle)); }

private:
    int64_t handle;
};

/// Its samples go to Sound.kt's queue for the stream's own thread; `done` comes through `played`, as a file's does.
class AndroidStream : public platform::Stream {
public:
    explicit AndroidStream(int64_t handle) : handle(handle) {}
    void write(const int16_t* samples, size_t count) override {
        if (count == 0) return;
        JNIEnv* e = jni::env();
        jshortArray array = e->NewShortArray(jsize(count));
        if (!array) return;
        e->SetShortArrayRegion(array, 0, jsize(count), reinterpret_cast<const jshort*>(samples));
        e->CallStaticVoidMethod(sound().cls, sound().writeStream, jlong(handle), array);
        e->DeleteLocalRef(array);
    }
    void finish() override { jni::env()->CallStaticVoidMethod(sound().cls, sound().finishStream, jlong(handle)); }
    void stop() override { jni::env()->CallStaticVoidMethod(sound().cls, sound().stopStream, jlong(handle)); }

private:
    int64_t handle;
};

}  // namespace

namespace platform {

MicrophoneRef openMicrophone(MicrophoneEvents events) {
    int64_t handle = nextHandle++;
    {
        std::lock_guard<std::mutex> g(registry);
        microphones[handle] = std::move(events);
    }
    bool recognition = Flags::string("micSource").value_or("") == "recognition";
    bool callMode = Flags::has("callMode");
    jni::env()->CallStaticVoidMethod(sound().cls, sound().openMicrophone, jni::activity(), jlong(handle), jboolean(recognition), jboolean(callMode));
    logLine(std::string("[voice] microphone: ") + (recognition ? "VOICE_RECOGNITION" : "VOICE_COMMUNICATION") + (callMode ? ", in call mode" : ""));
    return std::make_shared<AndroidMicrophone>(handle);
}

SoundRef playSound(const std::string& path, std::function<void(bool played)> done) {
    int64_t handle = nextHandle++;
    {
        std::lock_guard<std::mutex> g(registry);
        playing[handle] = std::move(done);
    }
    JNIEnv* e = jni::env();
    jstring jpath = e->NewStringUTF(path.c_str());
    e->CallStaticVoidMethod(sound().cls, sound().play, jni::activity(), jpath, jlong(handle));
    e->DeleteLocalRef(jpath);
    return std::make_shared<AndroidSound>(handle);
}

StreamRef playStream(int rate, std::function<void(bool played)> done) {
    int64_t handle = nextHandle++;
    {
        std::lock_guard<std::mutex> g(registry);
        playing[handle] = std::move(done);
    }
    jni::env()->CallStaticVoidMethod(sound().cls, sound().openStream, jint(rate), jlong(handle));
    return std::make_shared<AndroidStream>(handle);
}

}  // namespace platform

extern "C" {

JNIEXPORT void JNICALL Java_com_kaifengwu_mindpalace_Sound_heard(JNIEnv* e, jclass, jlong handle, jshortArray samples, jint count) {
    std::function<void(const float*, size_t)> heard;
    {
        std::lock_guard<std::mutex> g(registry);
        auto m = microphones.find(handle);
        if (m == microphones.end()) return;
        heard = m->second.heard;
    }
    if (!heard || count <= 0) return;
    thread_local std::vector<jshort> raw;
    thread_local std::vector<float> floats;
    raw.resize(size_t(count));
    floats.resize(size_t(count));
    e->GetShortArrayRegion(samples, 0, count, raw.data());
    for (jint i = 0; i < count; i++) floats[size_t(i)] = float(raw[size_t(i)]) / 32768.f;
    heard(floats.data(), floats.size());
}

JNIEXPORT void JNICALL Java_com_kaifengwu_mindpalace_Sound_microphoneFailed(JNIEnv* e, jclass, jlong handle, jbyteArray why) {
    std::function<void(const std::string&)> failed;
    {
        std::lock_guard<std::mutex> g(registry);
        auto m = microphones.find(handle);
        if (m == microphones.end()) return;
        failed = m->second.failed;
    }
    jsize n = e->GetArrayLength(why);
    std::string text(size_t(n), '\0');
    e->GetByteArrayRegion(why, 0, n, reinterpret_cast<jbyte*>(text.data()));
    if (failed) failed(text);
}

JNIEXPORT void JNICALL Java_com_kaifengwu_mindpalace_Sound_microphoneDenied(JNIEnv*, jclass, jlong handle) {
    std::function<void()> denied;
    {
        std::lock_guard<std::mutex> g(registry);
        auto m = microphones.find(handle);
        if (m == microphones.end()) return;
        denied = m->second.denied;
    }
    if (denied) denied();
}

JNIEXPORT void JNICALL Java_com_kaifengwu_mindpalace_Sound_microphoneAsking(JNIEnv*, jclass, jlong handle) {
    std::function<void()> asking;
    {
        std::lock_guard<std::mutex> g(registry);
        auto m = microphones.find(handle);
        if (m == microphones.end()) return;
        asking = m->second.asking;
    }
    if (asking) asking();
}

JNIEXPORT void JNICALL Java_com_kaifengwu_mindpalace_Sound_played(JNIEnv*, jclass, jlong handle, jboolean toEnd) {
    std::function<void(bool)> done;
    {
        std::lock_guard<std::mutex> g(registry);
        auto p = playing.find(handle);
        if (p == playing.end()) return;
        done = std::move(p->second);
        playing.erase(p);
    }
    if (done) done(toEnd);
}

}  // extern "C"
