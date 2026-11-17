// How often the listener hears its name, and how often it hears it where it was not said: the whole listener, with the
// real spotter, on the spoken clips quest/tools/wake_measure.sh makes (agents/DECISIONS.md 69).
//   wake_measure <model dir> <clips dir> [-v] [-dump <dir>]
// -dump writes the sound of every wake, as the service is sent it to check, with a wakes.tsv that names each.
// <clips dir>/manifest.tsv names each clip: file, set, voice's language, voice, words. In the sets `alone`, `comma`,
// `straight` and `fast` the name is said, alone or before a request; in `near` and `talk` it is not.
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <fstream>
#include <map>
#include <sstream>
#include <string>
#include <vector>

#include "../listener.h"

using namespace agent;

namespace {

constexpr int rate = Listener::rate;
constexpr size_t piece = Listener::pieceLength;

std::string bytesOf(const std::string& file) {
    std::ifstream in(file, std::ios::binary);
    std::stringstream s;
    s << in.rdbuf();
    return s.str();
}

/// Where a clip's sound begins and ends, in samples.
std::pair<size_t, size_t> spoken(const std::vector<float>& clip) {
    auto loud = [](float v) { return std::abs(v) > 0.02f; };
    auto first = std::find_if(clip.begin(), clip.end(), loud);
    auto last = std::find_if(clip.rbegin(), clip.rend(), loud).base();
    return {size_t(first - clip.begin()), size_t(std::max(first, last) - clip.begin())};
}

/// The clip after `lead` seconds of room and before `after` more, with a faint hiss under all of it, as a microphone has.
std::vector<float> inARoom(const std::vector<float>& clip, double lead, double after) {
    std::vector<float> s(size_t(lead * rate), 0.f);
    s.insert(s.end(), clip.begin(), clip.end());
    s.resize(s.size() + size_t(after * rate), 0.f);
    uint32_t seed = 7;
    for (float& v : s) {
        seed = seed * 1664525u + 1013904223u;
        v += (float(seed >> 8) / float(1 << 24) - 0.5f) * 0.0035f;
    }
    return s;
}

struct Clip {
    std::string file, set, language, voice, words;
    bool native() const { return language.rfind("en", 0) == 0; }
    /// The voice and the greeting, which a request's clip shares with the clip of its name said alone.
    std::string greeting() const { return file.substr(0, file.find('_')) + (words.rfind("Hi", 0) == 0 ? " hi" : " hey"); }
};

struct Tally {
    int clips = 0, woke = 0, began = 0, whole = 0;
    double minutes = 0;
};

}  // namespace

int main(int argc, char** argv) {
    if (argc < 3) {
        std::fprintf(stderr, "usage: wake_measure <model dir> <clips dir> [-v] [-dump <dir>]\n");
        return 2;
    }
    const std::string model = argv[1], dir = argv[2];
    bool each = false;
    std::string dump;
    for (int i = 3; i < argc; i++) {
        if (std::string(argv[i]) == "-v") each = true;
        else if (std::string(argv[i]) == "-dump" && i + 1 < argc) dump = argv[++i];
    }
    std::ofstream dumped;
    if (!dump.empty()) dumped.open(dump + "/wakes.tsv");
    std::optional<Vocabulary> vocabulary = readVocabulary(bytesOf(model + "/bpe.model"));
    std::optional<std::string> lines = vocabulary ? keywordLines("momo", *vocabulary) : std::nullopt;
    if (!lines) {
        std::fprintf(stderr, "the model in %s could not be read\n", model.c_str());
        return 1;
    }

    std::vector<Clip> clips;
    std::ifstream manifest(dir + "/manifest.tsv");
    for (std::string line; std::getline(manifest, line);) {
        std::vector<std::string> f;
        std::stringstream fields(line);
        for (std::string field; std::getline(fields, field, '\t');) f.push_back(field);
        if (f.size() >= 5) clips.push_back(Clip{f[0], f[1], f[2], f[3], f[4]});
    }
    // How long each voice takes to say the name alone: in a request's clip the name ends about that long after it begins.
    std::map<std::string, double> nameTakes;
    for (const Clip& c : clips) {
        if (c.set != "alone") continue;
        std::optional<std::vector<float>> wav = readWav(bytesOf(dir + "/" + c.file + ".wav"));
        if (!wav) continue;
        auto [from, to] = spoken(*wav);
        nameTakes[c.greeting()] = double(to - from) / rate;
    }

    std::unique_ptr<Spotter> spotter = Spotter::make(model, *lines);
    if (!spotter) {
        std::fprintf(stderr, "the spotter could not be made from %s\n", model.c_str());
        return 1;
    }
    Listener listener(std::move(spotter));
    std::map<std::string, Tally> tallies;
    std::string falseWakes;
    // The name begins at different moments of the listener's own second-long rhythm.
    const double leads[] = {1.3, 1.75, 2.2, 2.65};
    int said = 0;
    for (const Clip& c : clips) {
        std::optional<std::vector<float>> wav = readWav(bytesOf(dir + "/" + c.file + ".wav"));
        if (!wav) {
            std::fprintf(stderr, "no clip %s\n", c.file.c_str());
            continue;
        }
        bool named = c.set != "near" && c.set != "talk";
        double lead = named ? leads[said++ % 4] : 1.3;
        std::vector<float> sound = inARoom(*wav, lead, 4);
        auto [from, to] = spoken(*wav);
        double nameEnds = lead + double(from) / rate + nameTakes[c.greeting()];

        // One listener hears every clip, as one long recording would be heard: whatever the last clip left open is closed.
        listener.setMode(Listener::Mode::record);
        listener.setMode(Listener::Mode::stream);
        int wakes = 0, chime = -1;
        bool began = false;
        long firstStreamed = -1;
        for (size_t at = 0; at + piece <= sound.size(); at += piece) {
            // The chime plays for three tenths of a second after the name is heard.
            if (chime >= 0 && ++chime == 3) {
                listener.chimeEnded();
                chime = -1;
            }
            std::vector<Listener::Event> events = listener.hear(sound.data() + at, piece);
            long streamed = std::count_if(events.begin(), events.end(), [](const Listener::Event& e) { return std::holds_alternative<Listener::Streamed>(e); });
            for (const Listener::Event& e : events) {
                if (const auto* woke = std::get_if<Listener::Woke>(&e)) {
                    wakes++;
                    if (!dump.empty()) {
                        std::string name = c.file + (wakes > 1 ? "-" + std::to_string(wakes) : "");
                        std::ofstream(dump + "/" + name + ".wav", std::ios::binary) << wavFile(woke->sound);
                        dumped << name << '\t' << c.set << '\t' << c.language << '\t' << c.voice << '\t' << c.words << '\n';
                    }
                    listener.chimeStarted();
                    chime = 0;
                }
                if (std::holds_alternative<Listener::Began>(e) && !began) {
                    began = true;
                    firstStreamed = long(at + piece) - streamed * long(piece);
                }
            }
            if (named) continue;
            // Where the name is not said, every wake counts: the conversation a false one opened is closed again.
            if (listener.state() != Listener::State::waiting) {
                listener.setMode(Listener::Mode::record);
                listener.setMode(Listener::Mode::stream);
            }
        }
        Tally& t = tallies[c.set + (named ? (c.native() ? ", native voices" : ", accented voices") : "")];
        t.clips++;
        t.minutes += double(wav->size()) / rate / 60;
        if (named) {
            t.woke += wakes > 0;
            t.began += began;
            // Whole: the turn went out from no later than 0.15 s after the name ended.
            t.whole += began && double(firstStreamed) / rate <= nameEnds + 0.15;
        } else {
            t.woke += c.set == "talk" ? wakes : wakes > 0;
            if (wakes) falseWakes += "  " + c.file + (c.set == "near" ? " (" + c.voice + ": " + c.words + ")" : "") + "\n";
        }
        if (each) std::printf("%s\t%s\twakes %d, turn %s\t%s\n", c.file.c_str(), c.set.c_str(), wakes, began ? "began" : "did not begin", c.words.c_str());
    }

    for (const auto& [name, t] : tallies) {
        if (name == "near") std::printf("%-26s woke on %d of %d near misses\n", name.c_str(), t.woke, t.clips);
        else if (name == "talk") std::printf("%-26s %d false wakes in %.0f minutes of talk\n", name.c_str(), t.woke, t.minutes);
        else if (name.rfind("alone", 0) == 0) std::printf("%-26s woke %d of %d\n", name.c_str(), t.woke, t.clips);
        else std::printf("%-26s woke %d of %d, a turn began in %d, the request went out whole in %d\n", name.c_str(), t.woke, t.clips, t.began, t.whole);
    }
    if (!falseWakes.empty()) std::printf("false wakes:\n%s", falseWakes.c_str());
    return 0;
}
