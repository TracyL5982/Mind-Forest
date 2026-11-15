#include "voice.h"

#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <thread>

#include "async.h"
#include "base.h"
#include "json.h"

namespace agent {

struct Voice::Ears {
    std::unique_ptr<Listener> listener;     // the sound thread's alone, once it hears
    std::mutex lock;
    std::vector<Command> commands;
    std::vector<Listener::Event> events;
    Listener::Busy busy;
    std::atomic<Listener::State> state{Listener::State::waiting};
    /// Sound has come (on the Quest, only once the user allows the microphone), and the microphone has not failed since.
    std::atomic<bool> live{false};

    explicit Ears(std::unique_ptr<Spotter> spotter) : listener(std::make_unique<Listener>(std::move(spotter))) {}

    void heard(const float* samples, size_t count) {
        std::vector<Command> todo;
        {
            std::lock_guard<std::mutex> g(lock);
            todo.swap(commands);
        }
        for (Command& c : todo) {
            std::visit(overloaded{
                           [&](Done&) { listener->done(); },
                           [&](ReplyPlaying& r) { listener->replyPlaying(r.playing); },
                           [&](Respell& r) { listener->respell(std::move(r.spotter)); },
                       },
                       c);
        }
        std::vector<Listener::Event> out = listener->hear(samples, count);
        state = listener->state();
        live = true;
        std::lock_guard<std::mutex> g(lock);
        busy = listener->busy();
        for (Listener::Event& e : out) events.push_back(std::move(e));
    }
};

namespace {

/// `-wakeClip`: a recording heard as the microphone would hear it, a tenth of a second every tenth of a second, then quiet.
class ClipMicrophone : public platform::Microphone {
public:
    ClipMicrophone(std::vector<float> sound, platform::MicrophoneEvents events) {
        thread = std::thread([this, sound = std::move(sound), events = std::move(events)] {
            std::vector<float> quiet(Listener::pieceLength, 0.f);
            auto next = std::chrono::steady_clock::now();
            for (size_t at = 0; !stopped; at += Listener::pieceLength) {
                next += std::chrono::milliseconds(100);
                std::this_thread::sleep_until(next);
                if (at + Listener::pieceLength <= sound.size()) events.heard(sound.data() + at, Listener::pieceLength);
                else events.heard(quiet.data(), quiet.size());
            }
        });
    }
    ~ClipMicrophone() override { stop(); }
    void stop() override {
        stopped = true;
        if (thread.joinable()) thread.join();
    }

private:
    std::atomic<bool> stopped{false};
    std::thread thread;
};

std::string titled(const std::string& name) {
    std::string out = name;
    bool start = true;
    for (char& c : out) {
        if (start && c >= 'a' && c <= 'z') c = char(c - 'a' + 'A');
        start = c == ' ' || c == '-';
    }
    return out;
}

}  // namespace

Voice::Voice(Client& client, std::function<Scene()> scene, std::optional<std::string> clip)
    : client(client), scene(std::move(scene)), clip(std::move(clip)) {}

Voice::~Voice() {
    if (microphone) microphone->stop();
    if (sound) sound->stop();
}

std::optional<Listener::State> Voice::state() const {
    if (!ears || !ears->live) return std::nullopt;
    return ears->state.load();
}

std::string Voice::name() const { return titled(spelled); }

void Voice::joined(const Settings& settings, bool speaks) {
    serviceSpeaks = speaks;
    wanted = settings.agentName;
    if (!started) start();
    else if (ears && wanted != spelled && wanted != refused) respell();
}

void Voice::renamed(const std::string& name) {
    wanted = name;
    if (ears && wanted != spelled && wanted != refused) respell();
}

void Voice::start() {
    started = true;
    std::string tokens = platform::resourcePath("kws/tokens.txt");
    if (tokens.empty()) {
        logLine("[voice] the listener's model is not here (quest/tools/fetch-voice.sh), so the headset does not listen");
        return;
    }
    modelDir = tokens.substr(0, tokens.rfind('/'));
    chimePath = platform::dataDirectory() + "/agent-chime.wav";
    struct Made {
        std::shared_ptr<const Vocabulary> vocabulary;
        std::unique_ptr<Spotter> spotter;
        std::optional<std::vector<float>> clip;
        std::string why;
    };
    auto made = std::make_shared<Made>();
    std::string dir = modelDir, name = wanted, chimeFile = chimePath;
    std::optional<std::string> clipFile = clip;
    Async::run(
        [made, dir, name, chimeFile, clipFile] {
            platform::writeFile(chimeFile, wavFile(chime()));
            if (clipFile) {
                std::optional<std::string> bytes = platform::readFile(*clipFile);
                made->clip = bytes ? readWav(*bytes) : std::nullopt;
                if (!made->clip) {
                    made->why = "-wakeClip " + *clipFile + " is not a 16 kHz mono 16-bit WAV file";
                    return;
                }
            }
            std::optional<std::string> bpe = platform::readFile(dir + "/bpe.model");
            std::optional<Vocabulary> v = bpe ? readVocabulary(*bpe) : std::nullopt;
            if (!v) {
                made->why = "the model's word pieces (bpe.model) could not be read";
                return;
            }
            made->vocabulary = std::make_shared<const Vocabulary>(std::move(*v));
            std::optional<std::string> lines = keywordLines(name, *made->vocabulary);
            if (!lines) lines = keywordLines("momo", *made->vocabulary);
            made->spotter = Spotter::make(dir, *lines);
            if (!made->spotter) made->why = "the keyword spotter could not be made from " + dir;
        },
        [this, made, name] {
            if (!made->spotter) {
                logLine("[voice] not listening: " + made->why);
                return;
            }
            vocabulary = made->vocabulary;
            spelled = keywordLines(name, *vocabulary) ? name : "momo";
            ears = std::make_shared<Ears>(std::move(made->spotter));
            std::weak_ptr<Ears> weak = ears;
            platform::MicrophoneEvents events{
                [weak](const float* samples, size_t count) {
                    if (auto e = weak.lock()) e->heard(samples, count);
                },
                [weak](const std::string& why) {
                    if (auto e = weak.lock()) e->live = false;
                    logLine("[voice] the microphone stopped: " + why);
                },
            };
            if (made->clip) microphone = std::make_shared<ClipMicrophone>(std::move(*made->clip), std::move(events));
            else microphone = platform::openMicrophone(std::move(events));
            if (!microphone) {
                ears.reset();
                return;
            }
            logLine("[voice] listening for \"Hey " + this->name() + "\"" + (clip ? " in " + *clip : ""));
            if (wanted != spelled) respell();
        });
}

void Voice::respell() {
    std::string name = wanted;
    std::optional<std::string> lines = keywordLines(name, *vocabulary);
    if (!lines) {
        logLine("[voice] \"" + name + "\" cannot be spelled in the listener's word pieces, so it still listens for \"" + this->name() + "\"");
        refused = name;
        return;
    }
    auto made = std::make_shared<std::unique_ptr<Spotter>>();
    std::string dir = modelDir;
    Async::run([made, dir, lines] { *made = Spotter::make(dir, *lines); },
               [this, made, name] {
                   if (!*made) return;
                   send(Respell{std::move(*made)});
                   spelled = name;
                   logLine("[voice] listening for \"Hey " + this->name() + "\"");
               });
}

void Voice::send(Command command) {
    if (!ears) return;
    std::lock_guard<std::mutex> g(ears->lock);
    ears->commands.push_back(std::move(command));
}

void Voice::say(const std::string& text) {
    if (!serviceSpeaks || !ears) return;
    if (ears->state.load() == Listener::State::hearing) {
        held = text;
        return;
    }
    speak(text);
}

void Voice::speak(const std::string& text) {
    if (sound) sound->stop();
    sound.reset();
    int number = ++reply;
    spoken = text;
    send(ReplyPlaying{true});
    platform::Request request;
    request.url = client.address().http + "/api/speak?text=" + queryEscape(text);
    request.headers = {{"Authorization", "Bearer " + client.address().token}};
    request.saveTo = platform::dataDirectory() + "/agent-reply-" + std::to_string(number % 4) + ".mp3";
    std::weak_ptr<Inbox> box = inbox;
    std::string file = request.saveTo;
    platform::fetch(request, [box, number, file](platform::Response r) {
        auto b = box.lock();
        if (!b) return;
        bool ok = r.status == 200 && r.error.empty();
        std::lock_guard<std::mutex> g(b->lock);
        b->fetched.push_back(Fetched{number, ok, file, r.error.empty() ? fmt("status %d", r.status) : r.error});
    });
}

void Voice::transcribe(const std::string& wav) {
    platform::Request request;
    request.method = "POST";
    std::optional<TreeId> tree = scene().treeId;
    request.url = client.address().http + "/api/transcribe" + (tree ? "?tree=" + queryEscape(tree->value) : "");
    request.headers = {{"Authorization", "Bearer " + client.address().token}, {"Content-Type", "audio/wav"}};
    request.body = wav;
    request.timeout = 60;
    std::weak_ptr<Inbox> box = inbox;
    platform::fetch(request, [box](platform::Response r) {
        auto b = box.lock();
        if (!b) return;
        Transcript t;
        if (r.status == 200 && r.error.empty()) {
            std::optional<Json> j = Json::parse(r.body);
            t.ok = j && (*j)["text"].isString();
            if (t.ok) t.text = (*j)["text"].string();
        }
        if (!t.ok) t.why = r.error.empty() ? fmt("status %d", r.status) : r.error;
        std::lock_guard<std::mutex> g(b->lock);
        b->transcripts.push_back(std::move(t));
    });
}

void Voice::frame() {
    if (!ears) return;
    std::vector<Listener::Event> events;
    Listener::Busy busy;
    {
        std::lock_guard<std::mutex> g(ears->lock);
        events.swap(ears->events);
        busy = ears->busy;
    }
    for (Listener::Event& e : events) {
        std::visit(overloaded{
                       [&](Listener::Woke& w) {
                           logLine("[voice] heard " + w.keyword);
                           platform::playSound(chimePath, nullptr);
                       },
                       [&](Listener::Recorded& r) {
                           logLine(fmt("[voice] recorded %.1f s, sending it to be transcribed", r.seconds));
                           transcribe(r.wav);
                       },
                       [&](Listener::NothingSaid&) { logLine("[voice] nothing was said after the name"); },
                   },
                   e);
    }

    std::vector<Transcript> transcripts;
    std::vector<Fetched> fetched;
    std::vector<int> played;
    {
        std::lock_guard<std::mutex> g(inbox->lock);
        transcripts.swap(inbox->transcripts);
        fetched.swap(inbox->fetched);
        played.swap(inbox->played);
    }
    for (const Transcript& t : transcripts) {
        std::string text = t.text;
        size_t first = text.find_first_not_of(" \t\n"), last = text.find_last_not_of(" \t\n");
        text = first == std::string::npos ? "" : text.substr(first, last - first + 1);
        if (!t.ok) logLine("[voice] the recording could not be turned into text (" + t.why + ")");
        else if (text.empty()) logLine("[voice] nothing was heard after the name");
        else if (!client.send(Outbound::utter(text, true, scene()))) logLine("[voice] not connected, so \"" + text + "\" was not sent");
        else logLine("[voice] said: " + text);
        send(Done{});
    }
    for (const Fetched& f : fetched) {
        if (f.reply != reply) continue;
        if (!f.ok) {
            logLine("[voice] the reply could not be spoken (" + f.why + ")");
            send(ReplyPlaying{false});
            spoken.clear();
            continue;
        }
        std::weak_ptr<Inbox> box = inbox;
        int number = f.reply;
        sound = platform::playSound(f.file, [box, number](bool) {
            if (auto b = box.lock()) {
                std::lock_guard<std::mutex> g(b->lock);
                b->played.push_back(number);
            }
        });
        if (sound) logLine("[voice] speaking: " + spoken);
    }
    for (int number : played) {
        if (number != reply) continue;
        sound.reset();
        spoken.clear();
        send(ReplyPlaying{false});
        logLine("[voice] done speaking");
    }
    if (held && ears->state.load() != Listener::State::hearing) {
        std::string text = *held;
        held.reset();
        speak(text);
    }
    if (Flags::has("agentLog") && busy.heard - busyLogged >= 60) {
        busyLogged = busy.heard;
        logLine(fmt("[voice] spotting takes %.1f ms of CPU a second of sound (%.0f s heard)", 1000 * busy.spotting / busy.heard, busy.heard));
    }
}

}  // namespace agent
