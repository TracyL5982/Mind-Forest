#include "spotter.h"

#include <cctype>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <fstream>
#include <limits>

#include "sherpa-onnx/c-api/c-api.h"

namespace agent {

// MARK: - The model's word pieces

namespace {

/// One protobuf field: its number, and its bytes (a varint's value is in `number`).
struct Field {
    uint64_t field = 0;
    int wire = 0;
    uint64_t number = 0;
    std::string_view bytes;
};

/// The fields of a protobuf message, or nullopt when it is not one.
std::optional<std::vector<Field>> fields(std::string_view m) {
    std::vector<Field> out;
    size_t at = 0;
    auto varint = [&](uint64_t& n) {
        n = 0;
        for (int shift = 0; at < m.size() && shift < 64; shift += 7) {
            uint8_t b = uint8_t(m[at++]);
            n |= uint64_t(b & 0x7f) << shift;
            if (b < 0x80) return true;
        }
        return false;
    };
    while (at < m.size()) {
        uint64_t key = 0;
        if (!varint(key)) return std::nullopt;
        Field f;
        f.field = key >> 3;
        f.wire = int(key & 7);
        size_t size = 0;
        if (f.wire == 0) {
            if (!varint(f.number)) return std::nullopt;
        } else if (f.wire == 1 || f.wire == 5) {
            size = f.wire == 1 ? 8 : 4;
        } else if (f.wire == 2) {
            uint64_t n = 0;
            if (!varint(n) || n > m.size() - at) return std::nullopt;
            size = size_t(n);
        } else {
            return std::nullopt;
        }
        if (size > m.size() - at) return std::nullopt;
        f.bytes = m.substr(at, size);
        at += size;
        out.push_back(f);
    }
    return out;
}

/// The best split of one word into the model's pieces. It is a unigram SentencePiece model, so the split with the
/// highest total log probability is the one it was trained on.
std::optional<std::vector<std::string>> split(const std::string& word, const Vocabulary& vocabulary) {
    const std::string s = "\xE2\x96\x81" + word;  // ▁, which starts a word
    struct Best {
        float score = -std::numeric_limits<float>::infinity();
        std::optional<std::vector<std::string>> pieces;
    };
    std::vector<Best> best(s.size() + 1);
    best[0] = Best{0, std::vector<std::string>{}};
    for (size_t end = 1; end <= s.size(); end++) {
        for (size_t start = 0; start < end; start++) {
            auto piece = vocabulary.find(s.substr(start, end - start));
            if (piece == vocabulary.end() || !best[start].pieces) continue;
            if (best[start].score + piece->second > best[end].score) {
                best[end].score = best[start].score + piece->second;
                best[end].pieces = *best[start].pieces;
                best[end].pieces->push_back(piece->first);
            }
        }
    }
    return best[s.size()].pieces;
}

}  // namespace

std::optional<Vocabulary> readVocabulary(const std::string& bytes) {
    std::optional<std::vector<Field>> model = fields(bytes);
    if (!model) return std::nullopt;
    Vocabulary out;
    for (const Field& f : *model) {
        if (f.field != 1 || f.wire != 2) continue;
        std::optional<std::vector<Field>> inner = fields(f.bytes);
        if (!inner) return std::nullopt;
        std::string piece;
        float score = 0;
        for (const Field& g : *inner) {
            if (g.field == 1 && g.wire == 2) piece = std::string(g.bytes);
            if (g.field == 2 && g.wire == 5) std::memcpy(&score, g.bytes.data(), 4);
        }
        out[piece] = score;
    }
    if (out.empty()) return std::nullopt;
    return out;
}

std::optional<std::string> keywordLines(const std::string& name, const Vocabulary& vocabulary) {
    // Letters, digits and apostrophes, in capitals; anything else parts words. Bytes past ASCII are kept as they are.
    std::string cleaned;
    for (unsigned char c : name) {
        bool kept = c >= 0x80 || std::isalnum(c) || c == '\'';
        cleaned += kept ? char(std::toupper(c)) : ' ';
    }
    std::vector<std::string> words;
    for (size_t at = 0; at < cleaned.size();) {
        size_t start = cleaned.find_first_not_of(' ', at);
        if (start == std::string::npos) break;
        size_t end = cleaned.find(' ', start);
        words.push_back(cleaned.substr(start, end == std::string::npos ? std::string::npos : end - start));
        at = end == std::string::npos ? cleaned.size() : end;
    }
    if (words.empty()) return std::nullopt;
    std::string label;
    for (const std::string& w : words) label += (label.empty() ? "" : "_") + w;

    std::string lines;
    for (const char* greeting : {"HEY", "HI", "HIGH"}) {
        std::string pieces;
        std::vector<std::string> phrase = {greeting};
        phrase.insert(phrase.end(), words.begin(), words.end());
        for (const std::string& word : phrase) {
            std::optional<std::vector<std::string>> parts = split(word, vocabulary);
            if (!parts) return std::nullopt;
            for (const std::string& p : *parts) pieces += (pieces.empty() ? "" : " ") + p;
        }
        std::string tag = std::string(greeting) == "HIGH" ? "HI" : greeting;
        lines += (lines.empty() ? "" : "\n") + pieces + " @" + tag + "_" + label;
    }
    return lines;
}

// MARK: - The spotter

std::unique_ptr<Spotter> Spotter::make(const std::string& modelDir, const std::string& keywords) {
    const std::string encoder = modelDir + "/encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx";
    const std::string decoder = modelDir + "/decoder-epoch-12-avg-2-chunk-16-left-64.onnx";
    const std::string joiner = modelDir + "/joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx";
    const std::string tokens = modelDir + "/tokens.txt";
    for (const std::string* file : {&encoder, &decoder, &joiner, &tokens}) {
        if (!std::ifstream(*file).good()) return nullptr;
    }
    SherpaOnnxKeywordSpotterConfig config;
    std::memset(&config, 0, sizeof config);
    config.feat_config.sample_rate = 16000;
    config.feat_config.feature_dim = 80;
    config.model_config.transducer.encoder = encoder.c_str();
    config.model_config.transducer.decoder = decoder.c_str();
    config.model_config.transducer.joiner = joiner.c_str();
    config.model_config.tokens = tokens.c_str();
    config.model_config.num_threads = 1;
    config.model_config.provider = "cpu";
    config.model_config.model_type = "";
    config.model_config.modeling_unit = "bpe";
    config.model_config.bpe_vocab = "";
    // The search keeps 32 readings of the sound alive, not 4: with 4 the name's own reading was often dropped before
    // its end, most of all when the request ran straight on from it ("hi Momo what is this"). At these settings it
    // also wakes on one near miss in eight, so the service checks what woke it before Momo acts (agents/DECISIONS.md
    // 69 and 70).
    config.max_active_paths = 32;
    config.num_trailing_blanks = 1;
    config.keywords_score = 1.5f;
    config.keywords_threshold = 0.05f;
    config.keywords_buf = keywords.c_str();
    config.keywords_buf_size = int32_t(keywords.size());

    const SherpaOnnxKeywordSpotter* made = SherpaOnnxCreateKeywordSpotter(&config);
    if (!made) return nullptr;
    std::unique_ptr<Spotter> s(new Spotter);
    s->spotter = made;
    s->stream = SherpaOnnxCreateKeywordStream(made);
    return s;
}

Spotter::~Spotter() {
    if (stream) SherpaOnnxDestroyOnlineStream(stream);
    if (spotter) SherpaOnnxDestroyKeywordSpotter(spotter);
}

void Spotter::fresh() {
    SherpaOnnxDestroyOnlineStream(stream);
    stream = SherpaOnnxCreateKeywordStream(spotter);
}

std::optional<Spotter::Found> Spotter::hear(const float* samples, int count) {
    SherpaOnnxOnlineStreamAcceptWaveform(stream, 16000, samples, count);
    while (SherpaOnnxIsKeywordStreamReady(spotter, stream)) {
        SherpaOnnxDecodeKeywordStream(spotter, stream);
        const SherpaOnnxKeywordResult* r = SherpaOnnxGetKeywordResult(spotter, stream);
        std::optional<Found> found;
        if (r && r->keyword && r->keyword[0]) found = Found{r->keyword, std::vector<float>(r->timestamps, r->timestamps + r->count)};
        if (r) SherpaOnnxDestroyKeywordResult(r);
        if (found) {
            SherpaOnnxResetKeywordStream(spotter, stream);
            return found;
        }
    }
    return std::nullopt;
}

}  // namespace agent
