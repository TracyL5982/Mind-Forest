// The small things every ported file leans on: the clock, the log, launch
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

/// NSLog. On the headset it goes to logcat under the tag "ocean"; on the Mac to stderr.
void logLine(const std::string& line);

/// Launch flags, as the visionOS app reads them from UserDefaults and
/// CommandLine: `-demo`, `-walk 3`, `-frameWidth 120`.
///   CommandLine.arguments.contains("-demo")          -> Flags::has("demo")
///   UserDefaults.standard.double(forKey: "walk")     -> Flags::number("walk")   (0 when absent)
///   UserDefaults.standard.integer(forKey: "walk")    -> Flags::integer("walk")  (0 when absent)
///   UserDefaults.standard.string(forKey: "mark")     -> Flags::string("mark")   (nullopt when absent)
///   UserDefaults.standard.object(forKey: "x") != nil -> Flags::has("x")
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

/// Layout/Sphere.swift's SeededRandom (splitmix64): the same numbers on both platforms.
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
