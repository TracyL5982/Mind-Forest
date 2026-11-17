// `-echoCheck <reply.wav>`: whether Momo's own voice is ever taken for the user's, measured on the headset with no
// service and no cost. The microphone opens as it does for talking to Momo, and the listener's conversation is open, as
// it is while Momo speaks. A recorded reply (16-bit mono PCM at its own rate, a path or a name among the media) plays
// through the player Momo's live voice plays through, with the ocean drawn back as it is then.
//
// First it plays `plays` times while the user stays quiet: each turn the listener begins is Momo taken for the user, a
// false barge-in, and stops the reply as a real one would. Then `plays` times while the user talks over it: each logs
// how long after the first word Momo stopped. Momo's caption says which half it is in; the log ("[echo]") has the counts.
//
// `-chimeCheck`: the same question of the chime that says the name was heard. The conversation is open with nothing
// telling the listener that the chime plays, and the chime plays `chimes` times through the app's own sounds while the
// room stays quiet. Each turn the listener begins is the chime taken for the user. Then it plays `chimesTalked` times
// more while the user says a short word over each ("undo", "more"): each turn begun is the user heard through the chime,
// and its loudness shows the microphone hears a voice at all, without which the quiet half proves nothing. The log
// ("[chime]") has how loud each reached the microphone, beside the room just before it and the level that counts as
// words (agents/DECISIONS.md 71).
#pragma once
#include <cstdint>
#include <memory>
#include <optional>
#include <string>
#include <variant>
#include <vector>

#include "listener.h"
#include "platform.h"
#include "presence.h"
#include "presence_view.h"

class OceanModel;

namespace agent {

class EchoCheck {
public:
    /// The check `-echoCheck` asks for, or null.
    static std::shared_ptr<EchoCheck> fromFlags(OceanModel& model);
    EchoCheck(OceanModel& model, std::vector<int16_t> reply, int rate);
    /// The check of the chime.
    explicit EchoCheck(OceanModel& model);
    ~EchoCheck();
    EchoCheck(const EchoCheck&) = delete;
    EchoCheck& operator=(const EchoCheck&) = delete;

    /// Once a frame, on the frame thread.
    void frame(double now);

    static constexpr int plays = 10;
    /// `-chimeCheck`: how many times the chime plays, and the seconds between, under the 8 s after which the
    /// conversation would close.
    static constexpr int chimes = 12;
    /// And how many times more, while the user says a word over each.
    static constexpr int chimesTalked = 8;
    static constexpr double chimeGap = 4;
    /// Seconds after a chime begins in which a turn begun is the chime's doing, and its loudness is read.
    static constexpr double chimeHeardFor = 1.5;
    /// Seconds between one play and the next, under the 8 s after which the conversation would close.
    static constexpr double gap = 2;
    /// Seconds between the halves, to read that the user is to talk now.
    static constexpr double turnAround = 5;

    /// A 16-bit mono PCM WAV file's samples and rate, or nullopt for any other.
    struct Clip {
        std::vector<int16_t> samples;
        int rate = 0;
    };
    static std::optional<Clip> readClip(const std::string& bytes);

private:
    struct Ears;
    /// Until the listener's model has loaded and sound comes.
    struct Loading {};
    struct Waiting {
        double until = 0;
    };
    struct Playing {
        double began = 0;
        double sounded = 0;         // when it began, on `mediaTime`'s clock, as the listener's pieces are
        int number = 0;             // the player's, so the end of one stopped is let go
    };
    struct Finished {};
    using Step = std::variant<Loading, Waiting, Playing, Finished>;

    OceanModel& model;
    std::vector<int16_t> reply;
    int rate;
    std::shared_ptr<Ears> ears;
    platform::MicrophoneRef microphone;
    platform::StreamRef player;
    Step step = Loading{};
    int played = 0;                 // plays begun, both halves
    int players = 0;
    /// What it found.
    int falseStarts = 0;            // the quiet half: turns begun while Momo spoke
    int roomStarts = 0;             // the quiet half: turns begun between plays
    std::vector<double> stops;      // the talking half: seconds from the first word to Momo stopping
    int unstopped = 0;              // the talking half: plays nobody talked over
    int early = 0;                  // the talking half: plays begun while the user still talked
    std::unique_ptr<PresenceView> view;
    Presence presence;
    /// `-chimeCheck`: the chime plays, not a reply.
    bool chime = false;
    int chimeStarts = 0;            // quiet chimes that began a turn
    int talkedStarts = 0;           // chimes talked over that began a turn
    bool chimeBegan = false;        // the one playing did
    double chimeBeganAfter = 0;     // and how long after it began to play, s
    std::vector<float> talkedLoudest;   // each talked-over chime's loudest tenth of a second
    bool chimeTalking() const { return played > chimes; }
    std::vector<float> chimeLoudest;    // each chime's loudest tenth of a second at the microphone, RMS
    std::vector<float> roomLoudest;     // and the room's in the second before it
    void chimeFrame(double now, const std::vector<Listener::Event>& events);
    void openConversation();

    bool talkingHalf() const { return played > plays; }
    /// Seconds before the next play: longer once the quiet half is over, to read that the user is to talk now.
    double pause() const { return played == plays ? turnAround : gap; }
    void start();
    void play(double now);
    /// The reply stops: it `ended`, or a turn began. Then the next waits `wait`.
    void stop(double now, double wait, bool ended);
    void report();
};

}  // namespace agent
