// The agent's ears on the device. It waits for its name ("hey Momo", "hi Momo"), then records until the speaker pauses and
// hands that recording over, or, streaming, opens a conversation. Before the name it keeps only the last three seconds of
// sound, so the words just after the name are not lost, and nothing it hears leaves the device unless it began with the
// name or came while the conversation the name opened was open. The rules are the web client's
// (agents/client/js/wake-worker.js and wake.js; agents/DECISIONS.md 38).
//
// Streaming, the name opens a conversation, and so does Momo's voice. While it is open no name is needed: speech begins
// a turn, whether Momo is speaking or not, and the turn streams until the service says it is over. The conversation
// closes once nobody, neither the user nor Momo, has talked for 8 seconds. Momo's voice is not taken out here: the
// headset's echo cancelling does that (Sound.kt).
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

    /// What it does after the name: records until a pause, or streams every piece until the turn is over.
    enum class Mode { record, stream };

    enum class State {
        waiting,        // for its name
        hearing,        // recording or streaming a turn
        working,        // the recording was handed over and has not been dealt with yet
        speaking,       // recording, a reply plays or its echo fades: nothing is heard
        open,           // streaming, the conversation is open between turns: speech begins the next, a reply playing or not
    };

    struct Woke {
        std::string keyword;
    };
    /// Streaming, a turn begins: `Streamed` pieces follow, from just before its first word. It begins on the first words
    /// after the name, or on any words while the conversation is open.
    struct Began {};
    /// Streaming, nobody has talked for 8 seconds: the conversation is over, and the name is listened for again.
    struct Closed {};
    /// What followed the name, from a tenth of a second before it to the pause.
    struct Recorded {
        std::string wav;    // 16 kHz mono 16-bit
        double seconds = 0;
    };
    /// Streaming: a tenth of a second of the turn, in order.
    struct Streamed {
        std::vector<float> samples;
        /// It counted as words, not as quiet, the name or the chime.
        bool speech = false;
        /// When it was heard, on `mediaTime`'s clock. The listener leaves it 0; whoever hands the event on stamps it.
        double heard = 0;
    };
    /// Recording, the name, then nothing for 8 seconds: nothing is sent.
    struct NothingSaid {};
    /// Streaming for 60 seconds without the turn being over: it stops.
    struct Cut {};
    /// A reply held while the user was recorded may play now (see `askToSpeak`).
    struct Speak {};
    using Event = std::variant<Woke, Began, Closed, Recorded, NothingSaid, Speak, Streamed, Cut>;

    explicit Listener(std::unique_ptr<Spotter> spotter);

    /// 16 kHz mono samples in -1...1, in runs of any length. What came of them, in order.
    std::vector<Event> hear(const float* samples, size_t count);
    /// The recording has been dealt with: it listens for its name again.
    void done();
    /// From the next time it hears its name. It starts recording. Back to recording, an open conversation closes.
    void setMode(Mode mode);
    /// Streaming, the turn is over: the conversation stays open.
    void turnOver();
    /// A reply would play. True when it may now. From then nothing is heard until `replyEnded`, nor for 300 ms after,
    /// while its echo fades. While the user is being recorded it waits, so it is not recorded into what they say:
    /// `Speak` comes as the recording ends.
    bool askToSpeak();
    /// Streaming, Momo's voice plays as it arrives. It opens the conversation, and words cut it off.
    void replyStreams();
    /// The reply ended, or could not play.
    void replyEnded();
    /// Momo thinks, or its reply is on its way, or neither any more. While it does, the open conversation stays open as
    /// if Momo were talking, so the user may still talk without the name.
    void momoThinks(bool thinking);
    /// The chime that says the name was heard started, or ended. Sound is still heard while it plays and for 300 ms
    /// after, but is not taken for words.
    void chimeStarted();
    void chimeEnded();
    /// Listens for another name from now on. The spotter it listened with before, to be let go.
    std::unique_ptr<Spotter> respell(std::unique_ptr<Spotter> spotter);
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
    /// Streaming, the conversation is open and no turn streams.
    struct Open {
        int quiet = 0;              // pieces since anyone talked
        /// The last pieces heard, which go out just before the first word of the turn they begin.
        std::deque<Streamed> held;
    };
    struct Streaming {
        float quietest = 0;
        int pieces = 0;             // since the turn began
    };
    struct Working {};
    /// A sound of the agent's own, a reply or the chime: playing, or its echo fading after it ended.
    struct Own {
        enum class Kind { none, playing, echo } kind = Kind::none;
        int pieces = 0;             // since it started playing, or stopped
        /// Counts a piece. A sound that never says it ended is taken to have ended after `longest` pieces.
        void tick(int longest);
    };

    std::unique_ptr<Spotter> spotter;
    std::deque<Piece> ring;         // the last three seconds
    std::vector<float> partial;     // samples not yet a whole piece
    std::variant<Between, Recording, Open, Streaming, Working> phase = Between{};
    Mode mode = Mode::record;
    Own reply;
    bool thinking = false;          // Momo thinks, or its reply is on its way
    Own chiming;
    bool replyHeld = false;         // a reply asked to play while the user was recorded
    /// Whether it was spotting after the last change, so a fresh stream starts each time spotting starts again.
    bool spotting = true;
    Busy busy_;

    void hearPiece(Piece piece, std::vector<Event>& events);
    void spot(const Piece& piece, std::vector<Event>& events);
    void wake(const Spotter::Found& found, std::vector<Event>& events);
    void record(const Piece& piece, std::vector<Event>& events);
    void open(const Piece& piece, std::vector<Event>& events);
    void stream(const Piece& piece, std::vector<Event>& events);
    /// The quietest of the last three seconds.
    float quietestHeard() const;
    /// A turn begins with what was held, the last pieces its first words.
    void begin(std::deque<Streamed> held, float quietest, std::vector<Event>& events);
    /// Between recordings, it spots its name.
    bool spotsNow() const;
    /// The recording ended: a held reply may play.
    void ended(std::vector<Event>& events);
    /// A fresh stream: the spotter clears itself after 1.5 seconds of quiet and loses a phrase that begins as it does.
    void listen();
    void settle();
};

/// A 16 kHz mono 16-bit WAV file.
std::string wavFile(const std::vector<float>& samples);
/// The samples of a 16 kHz mono 16-bit PCM WAV file, or nullopt for any other.
std::optional<std::vector<float>> readWav(const std::string& bytes);

}  // namespace agent
