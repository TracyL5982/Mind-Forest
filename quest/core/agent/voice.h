// Talking to the agent on the headset, as in the web client: its name wakes it ("hey Momo"), what follows is recorded,
// transcribed by the service (POST /api/transcribe) and sent as an `utter`, and the agent's replies (`say`) are heard
// through the service's voice (GET /api/speak). Nothing it hears leaves the headset unless it began with the name.
//
// When the service has a live voice (its /live socket), the words go another way: after the
// name the microphone streams to the service until it says the turn is over, and Momo's voice streams back and plays as it
// arrives. "Hey Momo" while Momo speaks stops it, unless what it is saying names itself. Without /live, or while it is
// closed, everything is as above.
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

namespace agent {

class Voice {
public:
    /// `scene` says where the user is when they speak. `clip` feeds a recording instead of the microphone.
    Voice(Client& client, std::function<Scene()> scene, std::optional<std::string> clip);
    ~Voice();
    Voice(const Voice&) = delete;
    Voice& operator=(const Voice&) = delete;

    /// Every connect: the name to listen for, and whether the service reads replies aloud. The first starts listening and
    /// opens /live.
    void joined(const Settings& settings, bool serviceSpeaks);
    void renamed(const std::string& name);
    /// A reply to speak. One that arrives while the user is recorded waits until the recording ends. While /live is
    /// ready the service voices it there, and this only logs it.
    void say(const std::string& text);
    /// Once a frame, on the frame thread, with the frame's clock in seconds.
    void frame(double now);

    /// Seconds before each try to open the microphone again after it failed. The last repeats.
    static constexpr double reopenDelays[] = {1, 2, 4, 8, 15};
    /// Seconds before each try to open /live again after it closed or was refused.
    static constexpr double liveRetry = 5;

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
    struct LiveText {
        std::string id;
        std::string text;
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
    using LiveFrame = std::variant<LiveReady, LiveOver, LiveAudio, LiveText, LiveDone, LiveFailed, LiveClosed>;
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
        int chimesEnded = 0;
        bool microphoneFailed = false;
        bool microphoneRefused = false;
    };

    Client& client;
    std::function<Scene()> scene;
    std::optional<std::string> clip;
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

    /// /live: not opened before the first join; then shut until a retry, connecting, or ready.
    struct Unopened {};
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
    std::variant<Unopened, Shut, Connecting, Ready> link = Unopened{};
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
        int player = 0;             // the number of the player its first sound started; 0 before it
        bool interruptible = true;  // whether "hey Momo" stops it: not while what it says names itself
        /// Its sound while an earlier reply still plays out, so the two are heard one after the other.
        std::vector<int16_t> held;
        bool finished = false;      // all of it came while it was held
    };
    std::optional<LiveReply> live;
    /// The player sounding: the last one started, which a finished response's may still be as the next one's text comes.
    /// While it sounds the listener is told a reply plays.
    struct Sounding {
        int number = 0;
        platform::StreamRef player;
    };
    std::optional<Sounding> sounding;
    int players = 0;
    std::string chimePath;          // the file the waking chime plays from
    double busyLogged = 0;

    void start();
    void openMicrophone();
    void respell();
    void send(Command command);
    void transcribe(const std::string& wav);
    void speak(const std::string& text);
    void openLive(double now);
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
