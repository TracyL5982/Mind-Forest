#include "jni_bridge.h"

#include <pthread.h>

namespace jni {

static JavaVM* vm = nullptr;
static jobject activityRef = nullptr;
static jobject classLoader = nullptr;
static jmethodID loadClass = nullptr;
static pthread_key_t detachKey;

static void detach(void*) {
    if (vm) vm->DetachCurrentThread();
}

/// Called once from MainActivity.nativeStart, on the UI thread.
void attach(JNIEnv* e, jobject activity) {
    e->GetJavaVM(&vm);
    if (activityRef) e->DeleteGlobalRef(activityRef);
    activityRef = e->NewGlobalRef(activity);
    jclass activityClass = e->GetObjectClass(activity);
    jclass classClass = e->FindClass("java/lang/Class");
    jmethodID getLoader = e->GetMethodID(classClass, "getClassLoader", "()Ljava/lang/ClassLoader;");
    jobject loader = e->CallObjectMethod(activityClass, getLoader);
    if (classLoader) e->DeleteGlobalRef(classLoader);
    classLoader = e->NewGlobalRef(loader);
    jclass loaderClass = e->FindClass("java/lang/ClassLoader");
    loadClass = e->GetMethodID(loaderClass, "loadClass", "(Ljava/lang/String;)Ljava/lang/Class;");
    static bool keyed = false;
    if (!keyed) {
        pthread_key_create(&detachKey, detach);
        keyed = true;
    }
}

JavaVM* javaVM() { return vm; }

JNIEnv* env() {
    JNIEnv* e = nullptr;
    if (vm->GetEnv((void**)&e, JNI_VERSION_1_6) == JNI_OK) return e;
    vm->AttachCurrentThread(&e, nullptr);
    pthread_setspecific(detachKey, (void*)1);       // detached again when the thread ends
    return e;
}

jobject activity() { return activityRef; }

jclass findClass(const char* name) {
    JNIEnv* e = env();
    std::string dotted(name);
    for (char& c : dotted) {
        if (c == '/') c = '.';
    }
    jstring jname = e->NewStringUTF(dotted.c_str());
    jclass local = (jclass)e->CallObjectMethod(classLoader, loadClass, jname);
    e->DeleteLocalRef(jname);
    if (e->ExceptionCheck()) {
        e->ExceptionDescribe();
        e->ExceptionClear();
        return nullptr;
    }
    jclass global = (jclass)e->NewGlobalRef(local);
    e->DeleteLocalRef(local);
    return global;
}

}  // namespace jni
