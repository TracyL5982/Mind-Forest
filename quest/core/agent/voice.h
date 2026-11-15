// Talking to the agent on the headset, as in the web client: its name wakes it ("hey Momo"), what follows is recorded,
// transcribed by the service (POST /api/transcribe) and sent as an `utter`, and the agent's replies (`say`) are heard
// through the service's voice (GET /api/speak). Nothing it hears leaves the headset unless it began with the name.
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

    /// Every connect: the name to listen for, and whether the service reads replies aloud. The first starts listening.
    void joined(const Settings& settings, bool serviceSpeaks);
    void renamed(const std::string& name);
    /// A reply to speak. One that arrives while the user is recorded waits until the recording ends.
    void say(const std::string& text);
    /// Once a frame, on the frame thread, with the frame's clock in seconds.
    void frame(double now);

    /// Seconds before each try to open the microphone again after it failed. The last repeats.
    static constexpr double reopenDelays[] = {1, 2, 4, 8, 15};

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
    using Command = std::variant<Done, AskToSpeak, ReplyEnded, ChimeStarted, ChimeEnded, Respell>;
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
    /// What host threads hand back to the frame thread.
    struct Inbox {
        std::mutex lock;
        std::vector<Transcript> transcripts;
        std::vector<Fetched> fetched;
        std::vector<int> played;
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
    std::string chimePath;          // the file the waking chime plays from
    double busyLogged = 0;

    void start();
    void openMicrophone();
    void respell();
    void send(Command command);
    void transcribe(const std::string& wav);
    void speak(const std::string& text);
};

}  // namespace agent
