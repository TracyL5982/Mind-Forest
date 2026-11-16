#include "audio.h"

#include <atomic>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <map>
#include <memory>
#include <thread>
#include <vector>

#include "base.h"
#include "json.h"
#include "platform.h"

namespace audio {
namespace {

/// One sound, read from its file: interleaved stereo.
struct Clip {
    std::vector<int16_t> samples;
    int frames = 0;
};

struct Slot {
    std::string name;
    float gain = 1;
    double seconds = 0;
    bool loop = false;
    std::atomic<const Clip*> clip{nullptr};     // set once, by the reading thread; never freed
    // The frame thread's: what was last asked of a loop.
    float asked = 0;
    float askedOver = 0;
    // The audio thread's: where a loop is.
    float now = 0, target = 0, over = 0.1f;
    int64_t at = 0;
};

/// What the frame thread asks of the audio thread.
struct Command {
    enum class Kind : uint8_t { play, level };
    Kind kind = Kind::play;
    int slot = 0;
    float left = 1, right = 1;      // play: the gains; level: `left` is the level, `right` the seconds
    int64_t wait = 0;               // play: frames from now
};

struct Voice {
    const Clip* clip = nullptr;
    int64_t at = 0;                 // the next frame; negative while it waits its turn
    float left = 0, right = 0;
    uint32_t born = 0;
};

constexpr int queueSize = 512;      // a power of two
constexpr int voiceCount = 64;

std::vector<std::unique_ptr<Slot>> slots;
std::map<std::string, int> byName;
std::atomic<bool> ready{false};
float master = 0.8f;

// One writer (the frame thread), one reader (the audio thread).
Command queue[queueSize];
std::atomic<uint32_t> queueHead{0}, queueTail{0};

Voice voices[voiceCount];
uint32_t born = 0;

std::atomic<int> played{0}, dropped{0}, sounding{0};
std::atomic<float> loudest{0};

// The sync sound: made once on the frame thread, played by the audio thread from the frame after it is asked for.
std::vector<float> sweep;
std::atomic<bool> syncAsked{false};
std::atomic<int64_t> renderedFrames{0}, syncBeganAt{-1};
int syncAt = -1;                    // the audio thread's: the next sample of the sweep, or -1
void mix(float* out, int frames);

void push(const Command& c) {
    uint32_t head = queueHead.load(std::memory_order_relaxed);
    if (head - queueTail.load(std::memory_order_acquire) >= queueSize) {
        dropped.fetch_add(1, std::memory_order_relaxed);
        return;
    }
    queue[head & (queueSize - 1)] = c;
    queueHead.store(head + 1, std::memory_order_release);
}

uint32_t u32(const unsigned char* p) { return uint32_t(p[0]) | uint32_t(p[1]) << 8 | uint32_t(p[2]) << 16 | uint32_t(p[3]) << 24; }
uint16_t u16(const unsigned char* p) { return uint16_t(p[0] | p[1] << 8); }

/// A 16 bit PCM wav at 48 kHz, one or two channels: null for anything else.
Clip* readWav(const std::string& path) {
    std::optional<std::string> file = platform::readFile(path);
    if (!file || file->size() < 44) return nullptr;
    const unsigned char* d = reinterpret_cast<const unsigned char*>(file->data());
    size_t size = file->size();
    if (std::memcmp(d, "RIFF", 4) != 0 || std::memcmp(d + 8, "WAVE", 4) != 0) return nullptr;
    int channels = 0, bits = 0, rate = 0, format = 0;
    for (size_t at = 12; at + 8 <= size;) {
        uint32_t length = u32(d + at + 4);
        const unsigned char* body = d + at + 8;
        if (at + 8 + length > size) length = uint32_t(size - at - 8);
        if (std::memcmp(d + at, "fmt ", 4) == 0 && length >= 16) {
            format = u16(body);
            channels = u16(body + 2);
            rate = int(u32(body + 4));
            bits = u16(body + 14);
        } else if (std::memcmp(d + at, "data", 4) == 0) {
            if (format != 1 || bits != 16 || rate != sampleRate || (channels != 1 && channels != 2)) return nullptr;
            Clip* clip = new Clip;
            clip->frames = int(length / (2 * channels));
            clip->samples.resize(size_t(clip->frames) * 2);
            if (channels == 2) {
                std::memcpy(clip->samples.data(), body, size_t(clip->frames) * 4);
            } else {
                for (int i = 0; i < clip->frames; i++) {
                    int16_t s;
                    std::memcpy(&s, body + i * 2, 2);
                    clip->samples[size_t(i) * 2] = clip->samples[size_t(i) * 2 + 1] = s;
                }
            }
            return clip;
        }
        at += 8 + length + (length & 1);
    }
    return nullptr;
}

}  // namespace

void start() {
    if (ready.load() || Flags::has("mute") || Flags::has("noSound")) return;
    std::optional<std::string> text = platform::readText("sounds/manifest.json");
    std::optional<Json> manifest = text ? Json::parse(*text) : std::nullopt;
    if (!manifest || !(*manifest)["sounds"].isObject()) {
        logLine("[sound] no sounds: sounds/manifest.json is missing (quest/tools/push_media.sh makes and sends them)");
        return;
    }
    if (Flags::has("sound")) master = float(std::min(1.0, std::max(0.0, Flags::number("sound"))));
    for (const auto& [name, info] : (*manifest)["sounds"].members()) {
        auto slot = std::make_unique<Slot>();
        slot->name = name;
        slot->gain = float(info["gain"].number(1));
        slot->seconds = info["seconds"].number(0);
        slot->loop = info.has("loop");
        byName[name] = int(slots.size());
        slots.push_back(std::move(slot));
    }
    ready.store(true);
    // On a thread of its own, not the one pictures are unpacked on: a tree's cards must not wait for this.
    std::thread reading([] {
        double began = mediaTime();
        int read = 0;
        size_t bytes = 0;
        for (auto& slot : slots) {
            std::string path = platform::resourcePath("sounds/" + slot->name + ".wav");
            Clip* clip = path.empty() ? nullptr : readWav(path);
            if (!clip) {
                logLine("[sound] could not read sounds/" + slot->name + ".wav");
                continue;
            }
            bytes += clip->samples.size() * 2;
            slot->clip.store(clip, std::memory_order_release);
            read++;
        }
        logLine(fmt("[sound] %d of %d sounds read, %.0f MB, in %.2f s", read, int(slots.size()), double(bytes) / 1e6, mediaTime() - began));
    });
    // (The preview writing its sound to a file runs faster than time passes: it waits, so nothing is missed.)
    if (Flags::has("soundOut")) reading.join(); else reading.detach();
}

bool on() { return ready.load(std::memory_order_relaxed); }

void play(const std::string& name, float gain, double after, float pan) {
    if (!on()) return;
    auto found = byName.find(name);
    if (found == byName.end()) return;
    const Slot& slot = *slots[size_t(found->second)];
    // Equal power, and no louder in the middle than a sound that isn't moved at all.
    float a = (std::min(1.f, std::max(-1.f, pan)) + 1) * float(M_PI) / 4;
    Command c;
    c.kind = Command::Kind::play;
    c.slot = found->second;
    c.left = slot.gain * gain * std::cos(a) * float(M_SQRT2);
    c.right = slot.gain * gain * std::sin(a) * float(M_SQRT2);
    c.wait = int64_t(std::max(0.0, after) * sampleRate);
    push(c);
    played.fetch_add(1, std::memory_order_relaxed);
    // `-soundLog`: each sound as it is asked for, to check a run against.
    static const bool log = Flags::has("soundLog");
    if (log) logLine(fmt("[sound] %s%s", name.c_str(), after > 0 ? fmt(" in %.2f s", after).c_str() : ""));
}

double seconds(const std::string& name) {
    if (!on()) return 0;
    auto found = byName.find(name);
    return found == byName.end() ? 0 : slots[size_t(found->second)]->seconds;
}

void level(const std::string& name, float level, float over) {
    if (!on()) return;
    auto found = byName.find(name);
    if (found == byName.end()) return;
    Slot& slot = *slots[size_t(found->second)];
    if (!slot.loop) return;
    level = std::min(2.f, std::max(0.f, level));
    if (std::fabs(slot.asked - level) < 0.004f && slot.askedOver == over) return;
    slot.asked = level;
    slot.askedOver = over;
    Command c;
    c.kind = Command::Kind::level;
    c.slot = found->second;
    c.left = level;
    c.right = over;
    push(c);
}

void sync() {
    if (sweep.empty()) {
        int n = int(syncSeconds * sampleRate), edge = int(0.02 * sampleRate);
        sweep.resize(size_t(n));
        for (int i = 0; i < n; i++) {
            double t = double(i) / sampleRate;
            double phase = 2 * M_PI * (syncFrom * t + (syncTo - syncFrom) * t * t / (2 * syncSeconds));
            // Its two ends are eased over 20 ms, so it neither clicks in nor out.
            double ease = i < edge ? 0.5 - 0.5 * std::cos(M_PI * i / edge) : i >= n - edge ? 0.5 - 0.5 * std::cos(M_PI * (n - 1 - i) / edge) : 1;
            sweep[size_t(i)] = float(0.5 * ease * std::sin(phase));
        }
    }
    syncAsked.store(true, std::memory_order_release);
}

int64_t rendered() { return renderedFrames.load(std::memory_order_acquire); }
int64_t syncBegan() { return syncBeganAt.load(std::memory_order_acquire); }

void render(float* out, int frames) {
    std::memset(out, 0, size_t(frames) * 2 * sizeof(float));
    if (ready.load(std::memory_order_acquire)) mix(out, frames);
    // The sync sound goes on top of everything, after the mix has been kept from clipping, so its shape is exact.
    int64_t count = renderedFrames.load(std::memory_order_relaxed);
    if (syncAsked.exchange(false, std::memory_order_acq_rel)) {
        syncAt = 0;
        syncBeganAt.store(count, std::memory_order_release);
    }
    if (syncAt >= 0) {
        int n = std::min(frames, int(sweep.size()) - syncAt);
        for (int k = 0; k < n; k++) {
            float s = sweep[size_t(syncAt + k)];
            out[k * 2] = std::min(1.f, std::max(-1.f, out[k * 2] * 0.5f + s));
            out[k * 2 + 1] = std::min(1.f, std::max(-1.f, out[k * 2 + 1] * 0.5f + s));
        }
        syncAt += n;
        if (syncAt >= int(sweep.size())) syncAt = -1;
    }
    renderedFrames.store(count + frames, std::memory_order_release);
}

namespace {
void mix(float* out, int frames) {

    for (uint32_t tail = queueTail.load(std::memory_order_relaxed); tail != queueHead.load(std::memory_order_acquire);) {
        const Command& c = queue[tail & (queueSize - 1)];
        Slot& slot = *slots[size_t(c.slot)];
        if (c.kind == Command::Kind::level) {
            slot.target = c.left;
            slot.over = std::max(0.005f, c.right);
        } else if (const Clip* clip = slot.clip.load(std::memory_order_acquire)) {
            // A free voice, or else the one that has been sounding longest.
            Voice* use = &voices[0];
            for (Voice& v : voices) {
                if (!v.clip) {
                    use = &v;
                    break;
                }
                if (born - v.born > born - use->born) use = &v;
            }
            *use = Voice{clip, -c.wait, c.left, c.right, born++};
        }
        queueTail.store(++tail, std::memory_order_release);
    }

    const float scale = 1.f / 32768;
    int active = 0;
    for (Voice& v : voices) {
        if (!v.clip) continue;
        active++;
        int i = 0;
        if (v.at < 0) {
            int64_t wait = std::min<int64_t>(-v.at, frames);
            v.at += wait;
            i = int(wait);
            if (v.at < 0) continue;
        }
        int n = int(std::min<int64_t>(frames - i, v.clip->frames - v.at));
        const int16_t* s = v.clip->samples.data() + v.at * 2;
        float l = v.left * scale, r = v.right * scale;
        for (int k = 0; k < n; k++) {
            out[(i + k) * 2] += float(s[k * 2]) * l;
            out[(i + k) * 2 + 1] += float(s[k * 2 + 1]) * r;
        }
        v.at += std::max(n, 0);
        if (v.at >= v.clip->frames) v.clip = nullptr;
    }
    for (auto& held : slots) {
        Slot& slot = *held;
        if (!slot.loop || (slot.now < 1e-4f && slot.target < 1e-4f)) {
            slot.at = 0;
            slot.now = 0;
            continue;
        }
        const Clip* clip = slot.clip.load(std::memory_order_acquire);
        if (!clip || clip->frames == 0) continue;
        active++;
        // It eases toward what was asked: a straight line across these frames, from where it is to where the easing has it by their end.
        float end = slot.target + (slot.now - slot.target) * std::exp(-float(frames) / (slot.over * sampleRate));
        float g = slot.now * slot.gain * scale, step = (end - slot.now) * slot.gain * scale / float(frames);
        const int16_t* s = clip->samples.data();
        int64_t at = slot.at % clip->frames;
        for (int k = 0; k < frames; k++) {
            out[k * 2] += float(s[at * 2]) * g;
            out[k * 2 + 1] += float(s[at * 2 + 1]) * g;
            g += step;
            if (++at == clip->frames) at = 0;
        }
        slot.at = at;
        slot.now = end;
    }

    // Many sounds at once must not clip: above about half scale it bends over, and never passes 1.
    float peak = 0;
    for (int k = 0; k < frames * 2; k++) {
        float x = std::min(3.f, std::max(-3.f, out[k] * master));
        x = x * (27 + x * x) / (27 + 9 * x * x);
        out[k] = x;
        peak = std::max(peak, std::fabs(x));
    }
    if (peak > loudest.load(std::memory_order_relaxed)) loudest.store(peak, std::memory_order_relaxed);
    sounding.store(active, std::memory_order_relaxed);
}
}  // namespace

std::string describe() {
    if (!on()) return "no sound";
    return fmt("%d played, %d sounding, loudest %.2f, %d dropped", played.load(), sounding.load(), double(loudest.load()), dropped.load());
}

}  // namespace audio
