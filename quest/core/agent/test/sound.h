// Spoken clips as the listener's and the voice's tests hear them: fixtures/voice (make-voice-clips.sh) with quiet
// between, and the real keyword model, which quest/tools/fetch-voice.sh puts in quest/vendor/.
#pragma once
#include "support.h"

#include "../listener.h"
#include "json.h"

namespace check {

inline const std::filesystem::path model = std::filesystem::path(__FILE__).parent_path() / "../../../vendor/sherpa-onnx/assets/kws";

inline std::string bytesOf(const std::filesystem::path& file) {
    std::ifstream in(file, std::ios::binary);
    std::stringstream s;
    s << in.rdbuf();
    return s.str();
}

inline const agent::Vocabulary& vocabulary() {
    static const agent::Vocabulary v = agent::readVocabulary(bytesOf(model / "bpe.model")).value_or(agent::Vocabulary{});
    return v;
}

inline std::unique_ptr<agent::Spotter> spotterFor(const std::string& name) {
    std::optional<std::string> lines = agent::keywordLines(name, vocabulary());
    if (!lines) return nullptr;
    return agent::Spotter::make(model.string(), *lines);
}

constexpr size_t second = agent::Listener::rate;

inline const std::filesystem::path sounds = std::filesystem::path(__FILE__).parent_path() / "../../../../media-src/quest/sounds";

/// One of the app's own sounds (synth.py's, 48 kHz stereo 16 bit) as it leaves the speaker, at its manifest gain and the
/// mixer's 0.8, and as the microphone hears it: 16 kHz mono, every third sample of its left side.
inline std::vector<float> ownSound(const std::string& name) {
    std::optional<Json> manifest = Json::parse(bytesOf(sounds / "manifest.json"));
    double gain = manifest ? (*manifest)["sounds"][name]["gain"].number(0) : 0;
    std::string wav = bytesOf(sounds / (name + ".wav"));
    std::vector<float> out;
    size_t data = wav.find("data");
    if (gain <= 0 || data == std::string::npos) {
        std::fprintf(stderr, "    no sound %s\n", name.c_str());
        return out;
    }
    for (size_t at = data + 8; at + 4 <= wav.size(); at += 12) {
        int16_t left = int16_t(uint16_t(uint8_t(wav[at])) | uint16_t(uint8_t(wav[at + 1])) << 8);
        out.push_back(float(left / 32768.0 * gain * 0.8));
    }
    return out;
}

/// Sound as a test builds it, with a faint hiss under all of it as a microphone has.
struct Sound {
    std::vector<float> samples;

    size_t size() const { return samples.size(); }
    Sound& quiet(double seconds) {
        samples.resize(samples.size() + size_t(seconds * second), 0.f);
        return *this;
    }
    /// A clip with the quiet at its ends cut off.
    Sound& say(const std::string& clip) {
        std::vector<float> s =
            agent::readWav(bytesOf(std::filesystem::path(__FILE__).parent_path() / "fixtures/voice" / (clip + ".wav"))).value_or(std::vector<float>{});
        auto loud = [](float v) { return std::abs(v) > 0.02f; };
        auto first = std::find_if(s.begin(), s.end(), loud);
        auto last = std::find_if(s.rbegin(), s.rend(), loud).base();
        if (first < last) samples.insert(samples.end(), first, last);
        else std::fprintf(stderr, "    no clip %s\n", clip.c_str());
        return *this;
    }
    std::vector<float> withHiss() const {
        std::vector<float> out = samples;
        uint32_t seed = 7;
        for (float& v : out) {
            seed = seed * 1664525u + 1013904223u;
            v += (float(seed >> 8) / float(1 << 24) - 0.5f) * 0.0035f;
        }
        return out;
    }
};

}  // namespace check
