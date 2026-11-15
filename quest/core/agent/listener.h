// The agent's ears on the device. It waits for its name ("hey Momo", "hi Momo"), then records until the speaker pauses and hands
// that recording over. Before the name it keeps only the last three seconds of sound, so the words just after the name are not
// lost, and nothing it hears leaves the device unless it began with the name. The rules are the web client's
// (agents/client/js/wake-worker.js and wake.js; agents/DECISIONS.md 38).
//
// Not thread-safe: one thread hears and is told things, the host's microphone thread or a test's.
#pragma once
#include <deque>
#include <memory>
#include <optional>
#include <string>
#include <variant>
#include <vector>

#include "spotter.h"

namespace agent {

class Listener {
public:
    static constexpr int rate = 16000;
    /// Every rule is counted in pieces of a tenth of a second.
    static constexpr int pieceLength = rate / 10;

    enum class State {
        waiting,        // for its name
        hearing,        // recording what follows the name
        working,        // the recording was handed over and has not been dealt with yet
        speaking,       // a reply plays, or its echo fades: nothing is heard
    };

    struct Woke {
        std::string keyword;
    };
    /// What followed the name, from a tenth of a second before it to the pause.
    struct Recorded {
        std::string wav;    // 16 kHz mono 16-bit
        double seconds = 0;
    };
    /// The name, then nothing for 8 seconds: nothing is sent.
    struct NothingSaid {};
    using Event = std::variant<Woke, Recorded, NothingSaid>;

    explicit Listener(std::unique_ptr<Spotter> spotter);

    /// 16 kHz mono samples in -1...1, in runs of any length. What came of them, in order.
    std::vector<Event> hear(const float* samples, size_t count);
    /// The recording has been dealt with: it listens for its name again.
    void done();
    /// A reply started or stopped playing. Nothing is heard while it plays, nor for 300 ms after, while its echo fades.
    void replyPlaying(bool playing);
    /// Listens for another name from now on.
    void respell(std::unique_ptr<Spotter> spotter);
    State state() const;

    /// How hard it works: CPU seconds spent spotting, over seconds of sound spotted in.
    struct Busy {
        double spotting = 0;
        double heard = 0;
    };
    Busy busy() const { return busy_; }

private:
    struct Piece {
        std::vector<float> samples;
        float level = 0;            // RMS
    };
    /// Between recordings: spotting, unless a reply plays.
    struct Between {
        int quiet = 0;              // pieces in a row without speech
    };
    struct Recording {
        std::vector<Piece> pieces;
        float quietest = 0;
        bool spoke = false;
        int sinceWake = 0;          // pieces since the name was spotted
        int lastVoice = 0;          // the piece of the last speech, counted as `sinceWake` is
    };
    struct Working {};
    struct Reply {
        enum class Kind { none, playing, echo } kind = Kind::none;
        int pieces = 0;             // since it started playing, or stopped
    };

    std::unique_ptr<Spotter> spotter;
    std::deque<Piece> ring;         // the last three seconds
    std::vector<float> partial;     // samples not yet a whole piece
    std::variant<Between, Recording, Working> phase = Between{};
    Reply reply;
    /// Whether it was spotting after the last change, so a fresh stream starts each time spotting starts again.
    bool spotting = true;
    Busy busy_;

    void hearPiece(Piece piece, std::vector<Event>& events);
    void spot(const Piece& piece, std::vector<Event>& events);
    void wake(const Spotter::Found& found, std::vector<Event>& events);
    void record(const Piece& piece, std::vector<Event>& events);
    /// A fresh stream: the spotter clears itself after 1.5 seconds of quiet and loses a phrase that begins as it does.
    void listen();
    void settle();
};

/// Two short rising notes, played when the name is heard: the web client's chime (agents/client/js/wake.js).
std::vector<float> chime();

/// A 16 kHz mono 16-bit WAV file.
std::string wavFile(const std::vector<float>& samples);
/// The samples of a 16 kHz mono 16-bit PCM WAV file, or nullopt for any other.
std::optional<std::vector<float>> readWav(const std::string& bytes);

}  // namespace agent
