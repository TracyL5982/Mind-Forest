// The small things every file of the scene leans on: the clock, the log, launch
// flags, string formatting, and the seeded random the layouts share.
#pragma once
#include <cstdarg>
#include <cstdint>
#include <cstdio>
#include <map>
#include <optional>
#include <string>
#include <vector>

/// Seconds on a clock that never goes back: CACurrentMediaTime().
double mediaTime();

/// printf-style formatting into a std::string: String(format:).
std::string fmt(const char* format, ...) __attribute__((format(printf, 1, 2)));

/// Bytes as base64 (RFC 4648, padded), and back. nullopt for text that is not base64.
std::string base64Encode(const std::string& bytes);
std::optional<std::string> base64Decode(const std::string& text);

/// NSLog. On the headset it goes to logcat under the tag "ocean"; on the Mac to stderr.
void logLine(const std::string& line);

/// Launch flags: `-demo`, `-walk 3`, `-frameWidth 120`.
///   Flags::has("demo")        whether it was given
///   Flags::number("walk")     its value as a number (0 when absent)
///   Flags::integer("walk")    as a whole number (0 when absent)
///   Flags::string("mark")     as text (nullopt when absent)
/// Keys are given without the leading dash.
namespace Flags {
/// The flags a list of launch arguments holds, as `set` reads them: "-walk 3" is walk: "3", "-demo" is demo: "".
std::map<std::string, std::string> parse(const std::vector<std::string>& arguments);
void set(const std::vector<std::string>& arguments);
bool has(const std::string& key);
double number(const std::string& key);
int integer(const std::string& key);
std::optional<std::string> string(const std::string& key);
const std::vector<std::string>& arguments();
}

/// A seeded random (splitmix64): the same numbers on every host.
struct SeededRandom {
    uint64_t state;
    explicit SeededRandom(uint64_t state) : state(state) {}
    float next() {
        state += 0x9E3779B97F4A7C15ULL;
        uint64_t z = state;
        z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9ULL;
        z = (z ^ (z >> 27)) * 0x94D049BB133111EBULL;
        z ^= z >> 31;
        return float(z >> 40) / float(1 << 24);
    }
};

/// Where a frame's time went inside the host calls a card build makes, for
/// finding hitches: each kind's calls and milliseconds since the frame began.
namespace Cost {
enum Kind { layout, raster, decode, texture, kinds };
struct Entry {
    int calls = 0;
    double ms = 0;
};
Entry& of(Kind kind);
void reset();
/// One more call of a kind, from any thread.
void add(Kind kind, double ms);
/// Adds the time from its making to its end to one kind.
struct Scope {
    Kind kind;
    double began;
    explicit Scope(Kind kind) : kind(kind), began(mediaTime()) {}
    ~Scope() { add(kind, (mediaTime() - began) * 1000); }
};
}
