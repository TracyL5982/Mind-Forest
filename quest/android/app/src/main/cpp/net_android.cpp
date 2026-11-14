// platform.h's network on the Quest: OkHttp from Kotlin (Net.kt), reached through JNI.
#include <jni.h>

#include <atomic>
#include <map>
#include <mutex>

#include "jni_bridge.h"
#include "platform.h"

namespace {

struct NetClass {
    jclass cls = nullptr;
    jmethodID openSocket, send, close, fetch;
    NetClass() {
        JNIEnv* e = jni::env();
        cls = jni::findClass("com/kaifengwu/mindpalace/Net");
        openSocket = e->GetStaticMethodID(cls, "openSocket", "(Ljava/lang/String;J)Lokhttp3/WebSocket;");
        send = e->GetStaticMethodID(cls, "send", "(Lokhttp3/WebSocket;[B)Z");
        close = e->GetStaticMethodID(cls, "close", "(Lokhttp3/WebSocket;)V");
        fetch = e->GetStaticMethodID(cls, "fetch", "(Ljava/lang/String;Ljava/lang/String;[Ljava/lang/String;[BLjava/lang/String;JJ)V");
    }
};

const NetClass& net() {
    static NetClass c;
    return c;
}

jbyteArray bytes(JNIEnv* e, const std::string& s) {
    jbyteArray a = e->NewByteArray(jsize(s.size()));
    e->SetByteArrayRegion(a, 0, jsize(s.size()), reinterpret_cast<const jbyte*>(s.data()));
    return a;
}

std::string string(JNIEnv* e, jbyteArray a) {
    if (!a) return {};
    jsize n = e->GetArrayLength(a);
    std::string s(size_t(n), '\0');
    e->GetByteArrayRegion(a, 0, n, reinterpret_cast<jbyte*>(s.data()));
    return s;
}

std::string string(JNIEnv* e, jstring s) {
    if (!s) return {};
    const char* c = e->GetStringUTFChars(s, nullptr);
    std::string out(c);
    e->ReleaseStringUTFChars(s, c);
    return out;
}

class AndroidSocket;
std::mutex registry;
std::map<int64_t, std::weak_ptr<AndroidSocket>> sockets;   // an event for a socket already let go is dropped
std::map<int64_t, std::function<void(platform::Response)>> fetches;
std::atomic<int64_t> nextHandle{1};

class AndroidSocket : public platform::Socket {
public:
    AndroidSocket(int64_t handle, platform::SocketEvents events) : handle(handle), events(std::move(events)) {}
    ~AndroidSocket() override {
        {
            std::lock_guard<std::mutex> g(registry);
            sockets.erase(handle);
        }
        if (!socket) return;
        JNIEnv* e = jni::env();
        if (!done) e->CallStaticVoidMethod(net().cls, net().close, socket);
        e->DeleteGlobalRef(socket);
    }

    void start(const std::string& url) {
        JNIEnv* e = jni::env();
        jstring jurl = e->NewStringUTF(url.c_str());
        jobject local = e->CallStaticObjectMethod(net().cls, net().openSocket, jurl, jlong(handle));
        e->DeleteLocalRef(jurl);
        std::lock_guard<std::mutex> g(lock);
        if (local) {
            socket = e->NewGlobalRef(local);
            e->DeleteLocalRef(local);
        }
    }

    bool send(const std::string& text) override {
        if (done) return false;
        jobject s;
        {
            std::lock_guard<std::mutex> g(lock);
            s = socket;
        }
        if (!s) return false;
        JNIEnv* e = jni::env();
        jbyteArray a = bytes(e, text);
        bool queued = e->CallStaticBooleanMethod(net().cls, net().send, s, a);
        e->DeleteLocalRef(a);
        return queued;
    }

    void close() override {
        if (done) return;
        jobject s;
        {
            std::lock_guard<std::mutex> g(lock);
            s = socket;
        }
        if (s) jni::env()->CallStaticVoidMethod(net().cls, net().close, s);
        finish("closed by the app");
    }

    void opened() {
        if (!done && events.opened) events.opened();
    }
    void text(const std::string& t) {
        if (!done && events.text) events.text(t);
    }
    /// Ends it once, whichever of the paths that can end it comes first.
    void finish(const std::string& why) {
        if (done.exchange(true)) return;
        {
            std::lock_guard<std::mutex> g(registry);
            sockets.erase(handle);
        }
        if (events.closed) events.closed(why);
    }

private:
    int64_t handle;
    platform::SocketEvents events;
    std::atomic<bool> done{false};
    std::mutex lock;
    jobject socket = nullptr;
};

std::shared_ptr<AndroidSocket> socketFor(jlong handle) {
    std::lock_guard<std::mutex> g(registry);
    auto it = sockets.find(int64_t(handle));
    return it == sockets.end() ? nullptr : it->second.lock();
}

}  // namespace

namespace platform {

SocketRef openSocket(const std::string& url, SocketEvents events) {
    int64_t handle = nextHandle++;
    auto socket = std::make_shared<AndroidSocket>(handle, std::move(events));
    {
        std::lock_guard<std::mutex> g(registry);
        sockets[handle] = socket;
    }
    socket->start(url);
    return socket;
}

void fetch(Request request, std::function<void(Response)> done) {
    int64_t handle = nextHandle++;
    {
        std::lock_guard<std::mutex> g(registry);
        fetches[handle] = std::move(done);
    }
    JNIEnv* e = jni::env();
    jclass stringClass = e->FindClass("java/lang/String");
    jobjectArray headers = e->NewObjectArray(jsize(request.headers.size() * 2), stringClass, nullptr);
    for (size_t i = 0; i < request.headers.size(); i++) {
        jstring name = e->NewStringUTF(request.headers[i].first.c_str());
        jstring value = e->NewStringUTF(request.headers[i].second.c_str());
        e->SetObjectArrayElement(headers, jsize(i * 2), name);
        e->SetObjectArrayElement(headers, jsize(i * 2 + 1), value);
        e->DeleteLocalRef(name);
        e->DeleteLocalRef(value);
    }
    jstring method = e->NewStringUTF(request.method.c_str());
    jstring url = e->NewStringUTF(request.url.c_str());
    jstring saveTo = e->NewStringUTF(request.saveTo.c_str());
    jbyteArray body = bytes(e, request.body);
    e->CallStaticVoidMethod(net().cls, net().fetch, method, url, headers, body, saveTo, jlong(request.timeout * 1000), jlong(handle));
    for (jobject o : {(jobject)method, (jobject)url, (jobject)saveTo, (jobject)body, (jobject)headers, (jobject)stringClass}) e->DeleteLocalRef(o);
}

}  // namespace platform

extern "C" {

JNIEXPORT void JNICALL Java_com_kaifengwu_mindpalace_Net_socketOpened(JNIEnv*, jclass, jlong handle) {
    if (auto s = socketFor(handle)) s->opened();
}

JNIEXPORT void JNICALL Java_com_kaifengwu_mindpalace_Net_socketText(JNIEnv* e, jclass, jlong handle, jbyteArray text) {
    if (auto s = socketFor(handle)) s->text(string(e, text));
}

JNIEXPORT void JNICALL Java_com_kaifengwu_mindpalace_Net_socketClosed(JNIEnv* e, jclass, jlong handle, jstring why) {
    if (auto s = socketFor(handle)) s->finish(string(e, why));
}

JNIEXPORT void JNICALL Java_com_kaifengwu_mindpalace_Net_fetched(JNIEnv* e, jclass, jlong handle, jint status, jstring contentType,
                                                               jbyteArray body, jstring error) {
    std::function<void(platform::Response)> done;
    {
        std::lock_guard<std::mutex> g(registry);
        auto it = fetches.find(int64_t(handle));
        if (it == fetches.end()) return;
        done = std::move(it->second);
        fetches.erase(it);
    }
    platform::Response r;
    r.status = int(status);
    r.contentType = string(e, contentType);
    r.body = string(e, body);
    r.error = string(e, error);
    done(r);
}

}  // extern "C"
