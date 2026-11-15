// Talking to the agent on the headset, as in the web client: its name wakes it ("hey Momo"), what follows is recorded,
// transcribed by the service (POST /api/transcribe) and sent as an `utter`, and the agent's replies (`say`) are heard
// through the service's voice (GET /api/speak). Nothing it hears leaves the headset unless it began with the name.
//
// The microphone, or `-wakeClip <file.wav>` in its place, feeds the listener on the host's sound thread. The frame
// thread hears what came of it through a locked queue and does the rest; nothing here blocks a frame.
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
    /// Once a frame, on the frame thread.
    void frame();

    /// nullopt while it does not listen: until the model is ready and sound comes, and once the microphone fails.
    std::optional<Listener::State> state() const;
    /// The name it answers to, as said: "Momo".
    std::string name() const;
    /// The reply being spoken, while one is.
    const std::string& saying() const { return spoken; }

private:
    struct Done {};
    struct ReplyPlaying {
        bool playing;
    };
    struct Respell {
        std::unique_ptr<Spotter> spotter;
    };
    using Command = std::variant<Done, ReplyPlaying, Respell>;
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
    };

    Client& client;
    std::function<Scene()> scene;
    std::optional<std::string> clip;
    std::shared_ptr<Ears> ears;
    std::shared_ptr<Inbox> inbox = std::make_shared<Inbox>();
    platform::MicrophoneRef microphone;
    std::shared_ptr<const Vocabulary> vocabulary;
    std::string modelDir;
    bool started = false;
    std::string spelled = "momo";   // the name the spotter listens for
    std::string wanted = "momo";    // the name the service gave
    std::string refused;            // a name the spotter cannot spell, already said so
    bool serviceSpeaks = false;
    std::optional<std::string> held;    // a reply that came while the user was recorded
    int reply = 0;                  // the reply playing or on its way; earlier ones are let go
    platform::SoundRef sound;
    std::string spoken;
    std::string chime;              // the file the waking chime plays from
    double busyLogged = 0;

    void start();
    void respell();
    void send(Command command);
    void transcribe(const std::string& wav);
    void speak(const std::string& text);
};

}  // namespace agent
