// How native code on the Quest reaches the Kotlin side (MainActivity and its
// helpers in com.kaifengwu.mindpalace) from the frame thread.
#pragma once
#include <jni.h>
#include <string>

namespace jni {
/// The calling thread's JNIEnv; the thread is attached to the VM if it wasn't.
JNIEnv* env();
/// The running MainActivity (a global reference).
jobject activity();
/// An app class by its slashed name, from any thread:
/// `jni::findClass("com/kaifengwu/mindpalace/CanvasRenderer")`. A global reference; cache it.
jclass findClass(const char* name);
/// The host's own: set up once from MainActivity.nativeStart, and the VM for OpenXR.
void attach(JNIEnv* env, jobject activity);
JavaVM* javaVM();
}
