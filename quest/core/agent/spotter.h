// The keyword spotter that hears the agent's name on the device: sherpa-onnx's (Apache-2.0, v1.13.8, its C API) with the
// gigaspeech 3.3M keyword model, tuned as the web client is (agents/DECISIONS.md 38, 69 and 70). quest/tools/fetch-voice.sh fetches both.
#pragma once
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <vector>

struct SherpaOnnxKeywordSpotter;
struct SherpaOnnxOnlineStream;

namespace agent {

/// The model's word pieces and the log probability of each, from its SentencePiece file (bpe.model).
using Vocabulary = std::map<std::string, float>;
std::optional<Vocabulary> readVocabulary(const std::string& bytes);

/// The spotter's keyword lines for a name: "hey", "hi" and "high" (the model often hears "hi" as that) before it, each as the
/// model's word pieces with a label, one a line. For "momo": "▁HE Y ▁MO MO @HEY_MOMO", "▁HI ▁MO MO @HI_MOMO", "▁HIGH ▁MO MO @HI_MOMO".
/// nullopt when the name cannot be spelled in those pieces.
std::optional<std::string> keywordLines(const std::string& name, const Vocabulary& vocabulary);

class Spotter {
public:
    struct Found {
        std::string keyword;
        /// When each word piece of the phrase was heard, s. Only their span means anything: they restart when the
        /// spotter clears itself after quiet, and its start time does not.
        std::vector<float> timestamps;
    };

    /// Null when the model in `modelDir` cannot be read. Every line of `keywords` must come from `keywordLines`:
    /// sherpa-onnx ends the whole process on a keyword it cannot read.
    static std::unique_ptr<Spotter> make(const std::string& modelDir, const std::string& keywords);
    ~Spotter();
    Spotter(const Spotter&) = delete;
    Spotter& operator=(const Spotter&) = delete;

    /// Forgets what it has heard: a fresh stream.
    void fresh();
    /// Hears 16 kHz mono samples. The phrase, when it ends in them.
    std::optional<Found> hear(const float* samples, int count);

private:
    Spotter() = default;
    const SherpaOnnxKeywordSpotter* spotter = nullptr;
    const SherpaOnnxOnlineStream* stream = nullptr;
};

}  // namespace agent
