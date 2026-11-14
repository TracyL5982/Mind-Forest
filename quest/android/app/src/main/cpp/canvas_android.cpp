// The Quest's side of canvas.h. The drawing itself is Kotlin's
// (CanvasRenderer.kt, with android.graphics): a canvas's whole command list
// goes over in one call and the pixels come back in a buffer this side owns.
// Everything here runs on the frame thread.
#include <jni.h>

#include <algorithm>
#include <cmath>
#include <string>
#include <vector>

#include "base.h"
#include "canvas.h"
#include "jni_bridge.h"

namespace {

/// CanvasRenderer and its three static methods, found once.
struct Renderer {
    jclass cls = nullptr;
    jmethodID fontMetrics = nullptr;
    jmethodID layoutText = nullptr;
    jmethodID rasterize = nullptr;
    jclass stringClass = nullptr;
    jclass bufferClass = nullptr;
    bool ok = false;
};

/// Says so in the log and clears it, if the last call into Kotlin threw. True if it did.
bool threw(JNIEnv* env, const char* where) {
    if (!env->ExceptionCheck()) return false;
    env->ExceptionDescribe();
    env->ExceptionClear();
    logLine(std::string("[canvas] ") + where + " threw");
    return true;
}

/// A class of the system's, kept as a global reference.
jclass systemClass(JNIEnv* env, const char* name) {
    jclass local = env->FindClass(name);
    if (!local) {
        env->ExceptionClear();
        return nullptr;
    }
    jclass global = jclass(env->NewGlobalRef(local));
    env->DeleteLocalRef(local);
    return global;
}

const Renderer& renderer() {
    static Renderer r = [] {
        Renderer r;
        JNIEnv* env = jni::env();
        r.cls = jni::findClass("com/kaifengwu/mindpalace/CanvasRenderer");
        if (!r.cls) {
            env->ExceptionClear();
            logLine("[canvas] CanvasRenderer not found");
            return r;
        }
        r.fontMetrics = env->GetStaticMethodID(r.cls, "fontMetrics", "(FI)[F");
        r.layoutText = env->GetStaticMethodID(r.cls, "layoutText", "(Ljava/lang/String;FIZFFFIZ)[F");
        r.rasterize = env->GetStaticMethodID(
            r.cls, "rasterize", "(IIFZ[F[Ljava/lang/String;[Ljava/nio/ByteBuffer;[ILjava/nio/ByteBuffer;)Z");
        if (threw(env, "finding CanvasRenderer's methods")) return r;
        r.stringClass = systemClass(env, "java/lang/String");
        r.bufferClass = systemClass(env, "java/nio/ByteBuffer");
        r.ok = r.fontMetrics && r.layoutText && r.rasterize && r.stringClass && r.bufferClass;
        return r;
    }();
    return r;
}

/// A Java string from UTF-8, by way of UTF-16: NewStringUTF wants "modified" UTF-8, which is
/// not what a std::string holds once a character is past U+FFFF.
jstring javaString(JNIEnv* env, const std::string& text) {
    std::u16string s = utf16(text);
    return env->NewString(reinterpret_cast<const jchar*>(s.data()), jsize(s.size()));
}

}  // namespace

FontMetrics platform::fontMetrics(const Font& font) {
    // Roboto's own numbers, should Kotlin not answer.
    FontMetrics fallback{font.pointSize * 0.928f, font.pointSize * 0.244f, 0};
    const Renderer& r = renderer();
    if (!r.ok) return fallback;
    JNIEnv* env = jni::env();
    jfloatArray made = jfloatArray(env->CallStaticObjectMethod(r.cls, r.fontMetrics, jfloat(font.pointSize), jint(int(font.weight))));
    if (threw(env, "fontMetrics") || !made) return fallback;
    FontMetrics m = fallback;
    if (env->GetArrayLength(made) >= 3) {
        jfloat v[3];
        env->GetFloatArrayRegion(made, 0, 3, v);
        m = {v[0], v[1], v[2]};
    }
    env->DeleteLocalRef(made);
    return m;
}

TextFrame platform::layoutText(const std::string& text, const Font& font, std::optional<float> kern, float lineHeight, float width,
                               int maxLines, bool carets) {
    Cost::Scope cost(Cost::layout);
    TextFrame frame;
    const Renderer& r = renderer();
    if (!r.ok) return frame;
    JNIEnv* env = jni::env();
    jstring string = javaString(env, text);
    jfloatArray made = jfloatArray(env->CallStaticObjectMethod(
        r.cls, r.layoutText, string, jfloat(font.pointSize), jint(int(font.weight)), jboolean(kern ? JNI_TRUE : JNI_FALSE),
        jfloat(kern.value_or(0)), jfloat(lineHeight), jfloat(width), jint(maxLines), jboolean(carets ? JNI_TRUE : JNI_FALSE)));
    env->DeleteLocalRef(string);
    if (threw(env, "layoutText") || !made) return frame;
    // What comes back: width, height, the number of lines; then for each line x, y, width, height,
    // baseline, start, end, truncated (0 or 1), the number of carets, and the carets.
    jsize n = env->GetArrayLength(made);
    std::vector<jfloat> v(static_cast<size_t>(n));
    if (n > 0) env->GetFloatArrayRegion(made, 0, n, v.data());
    env->DeleteLocalRef(made);
    if (v.size() < 3) return frame;
    frame.width = v[0];
    frame.height = v[1];
    int lines = int(v[2]);
    size_t i = 3;
    for (int k = 0; k < lines && i + 9 <= v.size(); k++) {
        TextLine line;
        line.x = v[i];
        line.y = v[i + 1];
        line.width = v[i + 2];
        line.height = v[i + 3];
        line.baseline = v[i + 4];
        line.start = int(v[i + 5]);
        line.end = int(v[i + 6]);
        line.truncated = v[i + 7] != 0;
        size_t count = size_t(v[i + 8]);
        i += 9;
        if (i + count > v.size()) break;
        line.carets.assign(v.begin() + long(i), v.begin() + long(i + count));
        i += count;
        frame.lines.push_back(std::move(line));
    }
    return frame;
}

ImageRef platform::rasterize(const Canvas& canvas) {
    Cost::Scope cost(Cost::raster);
    int w = std::max(1, int(std::ceil(canvas.size.width * canvas.scale)));
    int h = std::max(1, int(std::ceil(canvas.size.height * canvas.scale)));
    auto image = std::make_shared<Image>();
    image->width = w;
    image->height = h;
    image->scale = canvas.scale;
    image->rgba.assign(size_t(w) * size_t(h) * 4, 0);
    const Renderer& r = renderer();
    if (!r.ok) return image;
    JNIEnv* env = jni::env();
    // One frame for every local reference made here, however many strings and pictures there are.
    if (env->PushLocalFrame(jint(16 + canvas.strings.size() + canvas.images.size())) != 0) {
        threw(env, "PushLocalFrame");
        return image;
    }

    jfloatArray commands = env->NewFloatArray(jsize(canvas.commands.size()));
    if (commands && !canvas.commands.empty()) {
        env->SetFloatArrayRegion(commands, 0, jsize(canvas.commands.size()), canvas.commands.data());
    }
    jobjectArray strings = env->NewObjectArray(jsize(canvas.strings.size()), r.stringClass, nullptr);
    for (size_t i = 0; strings && i < canvas.strings.size(); i++) {
        jstring s = javaString(env, canvas.strings[i]);
        env->SetObjectArrayElement(strings, jsize(i), s);
    }
    // Each picture's pixels are read where they are (the canvas keeps them alive for the call), with its size beside them.
    jobjectArray pictures = env->NewObjectArray(jsize(canvas.images.size()), r.bufferClass, nullptr);
    std::vector<jint> sizes;
    for (size_t i = 0; pictures && i < canvas.images.size(); i++) {
        const ImageRef& picture = canvas.images[i];
        bool whole = picture && picture->width > 0 && picture->height > 0 &&
                     picture->rgba.size() >= size_t(picture->width) * size_t(picture->height) * 4;
        sizes.push_back(whole ? picture->width : 0);
        sizes.push_back(whole ? picture->height : 0);
        if (!whole) continue;
        jobject buffer = env->NewDirectByteBuffer(const_cast<uint8_t*>(picture->rgba.data()),
                                                  jlong(size_t(picture->width) * size_t(picture->height) * 4));
        env->SetObjectArrayElement(pictures, jsize(i), buffer);
    }
    jintArray pictureSizes = env->NewIntArray(jsize(sizes.size()));
    if (pictureSizes && !sizes.empty()) env->SetIntArrayRegion(pictureSizes, 0, jsize(sizes.size()), sizes.data());
    // Kotlin copies the finished bitmap's pixels straight into the picture's own memory.
    jobject out = env->NewDirectByteBuffer(image->rgba.data(), jlong(image->rgba.size()));

    if (commands && strings && pictures && pictureSizes && out && !env->ExceptionCheck()) {
        jboolean drawn = env->CallStaticBooleanMethod(r.cls, r.rasterize, jint(w), jint(h), jfloat(canvas.scale),
                                                      jboolean(canvas.opaque ? JNI_TRUE : JNI_FALSE), commands, strings, pictures,
                                                      pictureSizes, out);
        if (threw(env, "rasterize") || !drawn) logLine(fmt("[canvas] a %d x %d picture was not drawn", w, h));
    } else {
        threw(env, "handing a canvas over");
    }
    env->PopLocalFrame(nullptr);
    return image;
}
