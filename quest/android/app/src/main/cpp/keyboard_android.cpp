// platform.h's keyboard on the Quest: the system keyboard over the app, through Keyboard.kt.
#include <jni.h>

#include <mutex>

#include "jni_bridge.h"
#include "platform.h"

namespace {

std::mutex lock;
platform::KeyboardEvents current;

std::string utf8(JNIEnv* e, jbyteArray a) {
    jsize n = e->GetArrayLength(a);
    std::string s(size_t(n), '\0');
    e->GetByteArrayRegion(a, 0, n, reinterpret_cast<jbyte*>(s.data()));
    return s;
}

jclass keyboard() {
    static jclass cls = jni::findClass("com/kaifengwu/mindpalace/Keyboard");
    return cls;
}

}  // namespace

namespace platform {

bool showKeyboard(const std::string& text, KeyboardEvents events) {
    {
        std::lock_guard<std::mutex> g(lock);
        current = std::move(events);
    }
    JNIEnv* e = jni::env();
    jclass cls = keyboard();
    if (!cls) return false;
    static jmethodID show = e->GetStaticMethodID(cls, "show", "(Landroid/app/Activity;Ljava/lang/String;)V");
    jstring jtext = e->NewStringUTF(text.c_str());
    e->CallStaticVoidMethod(cls, show, jni::activity(), jtext);
    e->DeleteLocalRef(jtext);
    return true;
}

void hideKeyboard() {
    JNIEnv* e = jni::env();
    jclass cls = keyboard();
    if (!cls) return;
    static jmethodID hide = e->GetStaticMethodID(cls, "hide", "(Landroid/app/Activity;)V");
    e->CallStaticVoidMethod(cls, hide, jni::activity());
}

}  // namespace platform

extern "C" {

JNIEXPORT void JNICALL Java_com_kaifengwu_mindpalace_Keyboard_typed(JNIEnv* e, jclass, jbyteArray text) {
    std::function<void(const std::string&)> typed;
    {
        std::lock_guard<std::mutex> g(lock);
        typed = current.typed;
    }
    if (typed) typed(utf8(e, text));
}

JNIEXPORT void JNICALL Java_com_kaifengwu_mindpalace_Keyboard_done(JNIEnv* e, jclass, jbyteArray text, jboolean sent) {
    std::function<void(const std::string&, bool)> done;
    {
        std::lock_guard<std::mutex> g(lock);
        done = current.done;
        current = {};
    }
    if (done) done(utf8(e, text), sent);
}

}  // extern "C"
