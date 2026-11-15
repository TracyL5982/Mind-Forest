// Talking to the agent on the headset, as in the web client: its name wakes it ("hey Momo"), what follows is recorded,
// transcribed by the service (POST /api/transcribe) and sent as an `utter`, and the agent's replies (`say`) are heard
// through the service's voice (GET /api/speak). Nothing it hears leaves the headset unless it began with the name.
//
// When the service has a live voice (hello's `live`, and its /live socket), the words go another way: after the
// name the microphone streams to the service until it says the turn is over, and Momo's voice streams back and plays as it
// arrives. "Hey Momo" while Momo speaks stops it, unless what it is saying names itself. Without /live, or while it is
// closed, everything is as above.
//
// It also says what it is doing, for Momo's presence in the scene (`presence`). It makes two sounds of its own besides
// the chime: a short tone as the user's turn is sent, and a quiet loop while Momo thinks, until the first sound of the
// answer. `-mute` silences all of them, and Momo's voice.
//
// The microphone, or `-wakeClip <file.wav>` in its place, feeds the listener on the host's sound thread. The frame
// thread asks things of the listener through a queue, applied by whichever thread holds the listener next, and hears
// what came of it through another; it never waits for the sound thread.
#pragma once
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <variant>
#include <vector>

#include "client.h"
#include "json.h"
#include "listener.h"
#include "platform.h"
#include "presence.h"

namespace agent {

class Voice {
public:
    /// `scene` says where the user is when they speak. `clip` feeds a recording instead of the microphone. `muted`
    /// plays no sound at all, yet takes the time Momo's voice would.
    Voice(Client& client, std::function<Scene()> scene, std::optional<std::string> clip, bool muted);
    ~Voice();
    Voice(const Voice&) = delete;
    Voice& operator=(const Voice&) = delete;

    /// Every connect: the name to listen for, whether the service reads replies aloud, and whether it has a live voice.
    /// The first starts listening. /live is opened only while the last hello offered it.
    void joined(const Settings& settings, bool serviceSpeaks, bool live);
    void renamed(const std::string& name);
    /// A reply to speak. One that arrives while the user is recorded waits until the recording ends. While /live is
    /// ready the service voices it there, and this only logs it.
    void say(const std::string& text);
    /// A question picked or typed under a card, which the service took: it is sent, and Momo thinks until the first
    /// sound of an answer or until the work on it starts.
    void asked(const std::string& question);
    /// Work the agent began or ended.
    void activity(const Activity& a);
    /// Once a frame, on the frame thread, with the frame's clock in seconds.
    void frame(double now);
    /// What it is doing, as of the last frame. `workingOn` is the caller's to fill.
    const Presence& presence() const { return shown; }

    /// Seconds before each try to open the microphone again after it failed. The last repeats.
    static constexpr double reopenDelays[] = {1, 2, 4, 8, 15};
    /// Seconds before each try to open /live again after it closed or was refused.
    static constexpr double liveRetry = 5;
    /// Seconds the turn shows as sent before Momo thinks.
    static constexpr double sentFor = 0.4;
    /// Seconds Momo thinks at most, should nothing ever end it.
    static constexpr double longestThought = 20;

    /// nullopt while it does not listen: until the model is ready and sound comes, while the microphone is down, and
    /// for good once the user refuses it.
    std::optional<Listener::State> state() const;
    /// The name it answers to, as said: "Momo".
    std::string name() const;
    /// The reply being spoken, while one is.
    const std::string& saying() const { return spoken; }

private:
    struct Done {};
    struct AskToSpeak {};
    struct ReplyEnded {};
    struct ChimeStarted {};
    struct ChimeEnded {};
    struct Respell {
        std::unique_ptr<Spotter> spotter;
    };
    struct SetMode {
        Listener::Mode mode;
    };
    struct TurnOver {};
    struct ReplyStreams {
        bool interruptible = false;
    };
    using Command = std::variant<Done, AskToSpeak, ReplyEnded, ChimeStarted, ChimeEnded, Respell, SetMode, TurnOver, ReplyStreams>;
    /// The listener and what crosses to it: the sound thread hears; the frame thread sends commands and takes events.
    struct Ears;
    struct Transcript {
        bool ok = false;
        std::string text;
        std::string why;
    };
    struct Fetched {
        int reply = 0;
        bool ok = false;
        std::string file;
        std::string why;
    };
    /// What the service says on /live, read on the socket's thread.
    struct LiveReady {
        int rate = 0;
    };
    struct LiveOver {
        int turn = 0;
    };
    struct LiveAudio {
        std::string id;
        std::vector<int16_t> pcm;
    };
    struct LiveHeard {
        int turn = 0;
        std::string text;
        bool final = false;
    };
    struct LiveQuiet {
        int turn = 0;
    };
    struct LiveText {
        std::string id;
        std::string text;
        bool results = false;       // what a piece of work brought, not the answer to what was just said
    };
    struct LiveDone {
        std::string id;
    };
    struct LiveFailed {
        std::string why;
    };
    struct LiveClosed {
        std::string why;
    };
    using LiveFrame = std::variant<LiveReady, LiveOver, LiveHeard, LiveQuiet, LiveAudio, LiveText, LiveDone, LiveFailed, LiveClosed>;
    /// Which socket said it: one closed or replaced is not listened to.
    struct FromLive {
        int socket = 0;
        LiveFrame frame;
    };
    /// What host threads hand back to the frame thread.
    struct Inbox {
        std::mutex lock;
        std::vector<Transcript> transcripts;
        std::vector<Fetched> fetched;
        std::vector<int> played;
        std::vector<FromLive> live;
        std::vector<int> streamsPlayed;
        std::vector<std::pair<int, bool>> loopsEnded;   // the loop's number, and whether it played to its end
        int chimesEnded = 0;
        bool microphoneFailed = false;
        bool microphoneRefused = false;
    };

    Client& client;
    std::function<Scene()> scene;
    std::optional<std::string> clip;
    bool muted;
    std::shared_ptr<Ears> ears;
    std::shared_ptr<Inbox> inbox = std::make_shared<Inbox>();
    platform::MicrophoneRef microphone;
    int microphoneFailures = 0;     // in a row, since sound last came
    double reopenAt = -1;
    std::shared_ptr<const Vocabulary> vocabulary;
    std::string modelDir;
    bool started = false;
    std::string spelled = "momo";   // the name the spotter listens for
    std::string wanted = "momo";    // the name the service gave
    std::string refused;            // a name the spotter cannot spell, already said so
    bool serviceSpeaks = false;
    std::optional<std::string> pending;     // a reply waiting for the listener's leave to play
    int reply = 0;                  // the reply playing or on its way; earlier ones are let go
    platform::SoundRef sound;
    std::string spoken;

    /// /live: shut until a retry while the last hello offered it, connecting, or ready.
    struct Shut {
        double retryAt = 0;
    };
    struct Connecting {
        platform::SocketRef socket;
        int number = 0;
    };
    struct Ready {
        platform::SocketRef socket;
        int number = 0;
        int rate = 0;
    };
    std::variant<Shut, Connecting, Ready> link = Shut{};
    bool liveOffered = false;       // the last hello said the service has a live voice
    int sockets = 0;
    std::string liveWhy;            // why /live last closed, already logged
    int turns = 0;
    /// The turn whose microphone streams to the service, if one does.
    std::optional<int> streaming;
    double lastWord = 0;            // when the turn's last word was heard, on `mediaTime`'s clock; 0 before one
    std::optional<double> answering;  // a turn is over and Momo's first sound for it has not come: its last word
    /// The response Momo is giving on /live, for the label and for whether it may be interrupted.
    struct LiveReply {
        std::string id;
        std::string text;
        int player = 0;             // the number of the player its first sound started; 0 before it
        bool interruptible = true;  // whether "hey Momo" stops it: not while what it says names itself
        /// Its sound while an earlier reply still plays out, so the two are heard one after the other.
        std::vector<int16_t> held;
        bool finished = false;      // all of it came while it was held
    };
    std::optional<LiveReply> live;
    /// `-mute`'s stand-in for the host's stream player.
    class Unheard;
    /// The player sounding: the last one started, which a finished response's may still be as the next one's text comes.
    /// While it sounds the listener is told a reply plays.
    struct Sounding {
        int number = 0;
        platform::StreamRef player;
        std::shared_ptr<Unheard> unheard;   // the player, when muted
        int rate = 0;
        std::string text;           // what the response says, all of it so far
        size_t written = 0;
        /// Seconds of it heard by now, as far as the frame clock tells: never ahead of what was written.
        double played = 0;
        /// The loudness of what was written, a fiftieth of a second at a time, for the presence's level.
        std::vector<float> loudness;
        double sum = 0;             // of squares, of the fiftieth being written
        int summed = 0;
        void write(const int16_t* samples, size_t count);
    };
    std::optional<Sounding> sounding;
    int players = 0;
    std::string chimePath;          // the file the waking chime plays from
    std::string sentPath, loopPath;
    double busyLogged = 0;
    double clock = 0;               // the last frame's

    /// The user's turn, as Momo's presence shows it: from the name to the first sound of Momo's answer. Outside a
    /// turn the presence is read from whether Momo's voice sounds and from the work in progress.
    struct Idle {};
    struct Listening {};
    /// The turn is sent and its tone plays; after `sentFor` Momo thinks. `endsWithWork`: no answer will be heard,
    /// so thinking also ends when the work starts. `settled`: what ends thinking came while it was sent.
    struct Sent {
        double at = 0;
        bool endsWithWork = false;
        bool settled = false;
    };
    /// Until the first sound of the answer, with the loop playing.
    struct Thinking {
        double since = 0;
        bool endsWithWork = false;
        platform::SoundRef loop;
        int number = 0;             // the loop's, so the end of one stopped is let go
    };
    using Turn = std::variant<Idle, Listening, Sent, Thinking>;
    Turn turn = Idle{};
    int loops = 0;
    /// The live turn whose words the presence shows, from `heard`; 0 for none.
    int wordsOf = 0;
    /// Work started and not ended, oldest first.
    std::vector<Activity> working;
    Presence shown;

    void start();
    /// Every change of turn goes through here: leaving thinking stops its loop, and being sent plays the tone.
    void turnTo(Turn next);
    /// No answer is coming, or the work began: thinking ends, once the turn has shown as sent.
    void endThinking();
    /// The turn is sent and its answer has not begun.
    bool awaiting() const { return std::holds_alternative<Sent>(turn) || std::holds_alternative<Thinking>(turn); }
    void startLoop(Thinking& t);
    /// Plays a sound file, unless muted.
    platform::SoundRef play(const std::string& path, std::function<void(bool)> done);
    /// The presence, from the turn, Momo's voice and the work in progress.
    void show();
    void openMicrophone();
    void respell();
    void send(Command command);
    void transcribe(const std::string& wav);
    void speak(const std::string& text);
    void openLive(double now);
    /// /live closed, or the service has no live voice: the old path from now on, tried again in `liveRetry` while the
    /// last hello offered it.
    void liveDown(const std::string& why, double now);
    bool sendLive(const Json& frame);
    void heardLive(LiveFrame& frame, double now);
    /// The user said the name: a new turn streams, and what Momo is saying stops.
    void beginTurn();
    void endTurn();
    /// Stops the live reply at once; its end, when the host reports it, is let go.
    void hushLive();
    LiveReply& liveReply(const std::string& id);
    /// Starts the player for the live reply, with what it held. False when the host cannot play.
    bool startPlayer(LiveReply& reply);
};

}  // namespace agent
