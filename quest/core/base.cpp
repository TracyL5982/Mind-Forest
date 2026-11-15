#include "base.h"

#include <algorithm>
#include <chrono>
#include <cstring>
#include <mutex>
#include <cstdlib>

#ifdef __ANDROID__
#include <android/log.h>
#endif

double mediaTime() {
    using namespace std::chrono;
    static const steady_clock::time_point zero = steady_clock::now();
    return duration<double>(steady_clock::now() - zero).count() + 1000.0;   // never near zero: "long ago" stamps stay in the past
}

std::string fmt(const char* format, ...) {
    va_list args, copy;
    va_start(args, format);
    va_copy(copy, args);
    int n = vsnprintf(nullptr, 0, format, copy);
    va_end(copy);
    std::string out(n > 0 ? size_t(n) : 0, '\0');
    if (n > 0) vsnprintf(out.data(), size_t(n) + 1, format, args);
    va_end(args);
    return out;
}

namespace {
const char base64Letters[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
}

std::string base64Encode(const std::string& bytes) {
    std::string out;
    out.reserve((bytes.size() + 2) / 3 * 4);
    for (size_t at = 0; at < bytes.size(); at += 3) {
        size_t n = std::min(size_t(3), bytes.size() - at);
        uint32_t v = 0;
        for (size_t i = 0; i < 3; i++) v = v << 8 | (i < n ? uint8_t(bytes[at + i]) : 0);
        for (size_t i = 0; i < 4; i++) out += i <= n ? base64Letters[(v >> (18 - 6 * i)) & 63] : '=';
    }
    return out;
}

std::optional<std::string> base64Decode(const std::string& text) {
    if (text.size() % 4) return std::nullopt;
    size_t pad = 0;
    while (pad < 2 && pad < text.size() && text[text.size() - 1 - pad] == '=') pad++;
    std::string out;
    out.reserve(text.size() / 4 * 3);
    uint32_t v = 0;
    size_t letters = text.size() - pad;
    for (size_t i = 0; i < letters; i++) {
        const char* found = text[i] ? std::strchr(base64Letters, text[i]) : nullptr;
        if (!found) return std::nullopt;
        v = v << 6 | uint32_t(found - base64Letters);
        if (i % 4 == 3) {
            out += char(v >> 16);
            out += char(v >> 8 & 0xff);
            out += char(v & 0xff);
            v = 0;
        }
    }
    if (letters % 4 == 2) out += char(v >> 4 & 0xff);
    if (letters % 4 == 3) {
        out += char(v >> 10 & 0xff);
        out += char(v >> 2 & 0xff);
    }
    return out;
}

void logLine(const std::string& line) {
#ifdef __ANDROID__
    __android_log_write(ANDROID_LOG_INFO, "ocean", line.c_str());
#else
    fprintf(stderr, "%s\n", line.c_str());
#endif
}

namespace Flags {

static std::vector<std::string> args;
static std::map<std::string, std::string> values;       // "-walk 3" -> walk: "3"; "-demo" -> demo: ""

/// A token that names a flag: a dash and then a letter (so "-0.5" is a value).
static bool isKey(const std::string& s) {
    return s.size() >= 2 && s[0] == '-' && !(s[1] >= '0' && s[1] <= '9') && s[1] != '.';
}

void set(const std::vector<std::string>& arguments) {
    args = arguments;
    values.clear();
    for (size_t i = 0; i < args.size(); i++) {
        if (!isKey(args[i])) continue;
        std::string key = args[i].substr(1);
        bool hasValue = i + 1 < args.size() && !isKey(args[i + 1]);
        values[key] = hasValue ? args[i + 1] : "";
    }
}

bool has(const std::string& key) { return values.count(key) > 0; }

double number(const std::string& key) {
    auto it = values.find(key);
    if (it == values.end() || it->second.empty()) return 0;
    char* end = nullptr;
    double v = strtod(it->second.c_str(), &end);
    return end == it->second.c_str() ? 0 : v;
}

int integer(const std::string& key) { return int(number(key)); }

std::optional<std::string> string(const std::string& key) {
    auto it = values.find(key);
    if (it == values.end() || it->second.empty()) return std::nullopt;
    return it->second;
}

const std::vector<std::string>& arguments() { return args; }

}  // namespace Flags

namespace Cost {
static Entry entries[kinds];
static std::mutex guard;
Entry& of(Kind kind) { return entries[kind]; }
void reset() {
    std::lock_guard<std::mutex> lock(guard);
    for (Entry& e : entries) e = {};
}
void add(Kind kind, double ms) {
    std::lock_guard<std::mutex> lock(guard);
    entries[kind].calls++;
    entries[kind].ms += ms;
}
}
