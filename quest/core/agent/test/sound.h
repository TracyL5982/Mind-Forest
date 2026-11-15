// Spoken clips as the listener's and the voice's tests hear them: fixtures/voice (make-voice-clips.sh) with quiet
// between, and the real keyword model, which quest/tools/fetch-voice.sh puts in quest/vendor/.
#pragma once
#include "support.h"

#include "../listener.h"

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
