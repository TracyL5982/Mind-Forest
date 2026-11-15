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
    /// The listener's own: the sound thread holds it while it hears a run of sound, the frame thread only when it is free.
    std::mutex hearing;
    std::unique_ptr<Listener> listener;
    std::mutex lock;                        // the two queues
    std::vector<Command> commands;
    std::vector<Listener::Event> events;
    Listener::Busy busy;
    std::atomic<Listener::State> state{Listener::State::waiting};
    /// Sound has come (on the Quest, only once the user allows the microphone), and the microphone has not failed since.
    std::atomic<bool> live{false};

    explicit Ears(std::unique_ptr<Spotter> spotter) : listener(std::make_unique<Listener>(std::move(spotter))) {}

    /// The sound thread.
    void heard(const float* samples, size_t count) {
        std::lock_guard<std::mutex> h(hearing);
        std::vector<Listener::Event> out;
        std::vector<std::unique_ptr<Spotter>> retired = apply(out);
        for (Listener::Event& e : listener->hear(samples, count)) out.push_back(std::move(e));
        live = true;
        publish(out);
    }

    /// The frame thread: what was asked is done now, unless the sound thread is hearing, which then does it first.
    /// A spotter let go is unpacked from memory on the background thread, not the frame thread.
    void settle() {
        std::unique_lock<std::mutex> h(hearing, std::try_to_lock);
        if (!h.owns_lock()) return;
        std::vector<Listener::Event> out;
        auto retired = std::make_shared<std::vector<std::unique_ptr<Spotter>>>(apply(out));
        publish(out);
        h.unlock();
        if (!retired->empty()) Async::run([retired] { retired->clear(); });
    }

private:
    /// Under `hearing`.
    std::vector<std::unique_ptr<Spotter>> apply(std::vector<Listener::Event>& out) {
        std::vector<Command> todo;
        {
            std::lock_guard<std::mutex> g(lock);
            todo.swap(commands);
        }
        std::vector<std::unique_ptr<Spotter>> retired;
        for (Command& c : todo) {
            std::visit(overloaded{
                           [&](Done&) { listener->done(); },
                           [&](AskToSpeak&) {
                               if (listener->askToSpeak()) out.push_back(Listener::Speak{});
                           },
                           [&](ReplyEnded&) { listener->replyEnded(); },
                           [&](ChimeStarted&) { listener->chimeStarted(); },
                           [&](ChimeEnded&) { listener->chimeEnded(); },
                           [&](Respell& r) { retired.push_back(listener->respell(std::move(r.spotter))); },
                       },
                       c);
        }
        return retired;
    }

    void publish(std::vector<Listener::Event>& out) {
        state = listener->state();
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
            if (made->clip) {
                std::weak_ptr<Ears> weak = ears;
                platform::MicrophoneEvents events;
                events.heard = [weak](const float* samples, size_t count) {
                    if (auto e = weak.lock()) e->heard(samples, count);
                };
                microphone = std::make_shared<ClipMicrophone>(std::move(*made->clip), std::move(events));
            } else {
                openMicrophone();
            }
            logLine("[voice] listening for \"Hey " + this->name() + "\"" + (clip ? " in " + *clip : ""));
            if (wanted != spelled) respell();
        });
}

void Voice::openMicrophone() {
    std::weak_ptr<Ears> weak = ears;
    std::weak_ptr<Inbox> box = inbox;
    microphone = platform::openMicrophone({
        [weak](const float* samples, size_t count) {
            if (auto e = weak.lock()) e->heard(samples, count);
        },
        [weak, box](const std::string& why) {
            if (auto e = weak.lock()) e->live = false;
            logLine("[voice] the microphone stopped: " + why);
            if (auto b = box.lock()) {
                std::lock_guard<std::mutex> g(b->lock);
                b->microphoneFailed = true;
            }
        },
        [weak, box] {
            if (auto e = weak.lock()) e->live = false;
            if (auto b = box.lock()) {
                std::lock_guard<std::mutex> g(b->lock);
                b->microphoneRefused = true;
            }
        },
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
    if (!serviceSpeaks) return;
    pending = text;
    if (ears) {
        send(AskToSpeak{});
        return;
    }
    speak(text);
    pending.reset();
}

void Voice::speak(const std::string& text) {
    if (sound) sound->stop();
    sound.reset();
    int number = ++reply;
    spoken = text;
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

void Voice::frame(double now) {
    std::vector<Listener::Event> events;
    Listener::Busy busy;
    if (ears) {
        ears->settle();
        std::lock_guard<std::mutex> g(ears->lock);
        events.swap(ears->events);
        busy = ears->busy;
    }
    for (Listener::Event& e : events) {
        std::visit(overloaded{
                       [&](Listener::Woke& w) {
                           logLine("[voice] heard " + w.keyword);
                           send(ChimeStarted{});
                           std::weak_ptr<Inbox> box = inbox;
                           platform::playSound(chimePath, [box](bool) {
                               if (auto b = box.lock()) {
                                   std::lock_guard<std::mutex> g(b->lock);
                                   b->chimesEnded++;
                               }
                           });
                       },
                       [&](Listener::Recorded& r) {
                           logLine(fmt("[voice] recorded %.1f s, sending it to be transcribed", r.seconds));
                           transcribe(r.wav);
                       },
                       [&](Listener::NothingSaid&) { logLine("[voice] nothing was said after the name"); },
                       [&](Listener::Speak&) {
                           if (!pending) return;
                           speak(*pending);
                           pending.reset();
                       },
                   },
                   e);
    }

    std::vector<Transcript> transcripts;
    std::vector<Fetched> fetched;
    std::vector<int> played;
    int chimesEnded = 0;
    bool failed = false, refused = false;
    {
        std::lock_guard<std::mutex> g(inbox->lock);
        transcripts.swap(inbox->transcripts);
        fetched.swap(inbox->fetched);
        played.swap(inbox->played);
        std::swap(chimesEnded, inbox->chimesEnded);
        std::swap(failed, inbox->microphoneFailed);
        std::swap(refused, inbox->microphoneRefused);
    }
    for (int i = 0; i < chimesEnded; i++) send(ChimeEnded{});
    if (refused) {
        // Asked again, the headset would ask the user again: it stops listening, and replies are still spoken.
        logLine("[voice] the microphone is not allowed, so the headset does not listen");
        if (microphone) microphone->stop();
        microphone.reset();
        ears.reset();
        reopenAt = -1;
        if (pending) speak(*pending);
        pending.reset();
    } else if (failed && ears) {
        if (microphone) microphone->stop();
        microphone.reset();
        double wait = reopenDelays[std::min(microphoneFailures, int(std::size(reopenDelays)) - 1)];
        microphoneFailures++;
        reopenAt = now + wait;
        logLine(fmt("[voice] opening the microphone again in %.0f s", wait));
    }
    if (ears && !microphone && reopenAt >= 0 && now >= reopenAt) {
        reopenAt = -1;
        openMicrophone();
    }
    if (ears && microphone && ears->live) microphoneFailures = 0;
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
            send(ReplyEnded{});
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
        send(ReplyEnded{});
        logLine("[voice] done speaking");
    }
    if (Flags::has("agentLog") && busy.heard - busyLogged >= 60) {
        busyLogged = busy.heard;
        logLine(fmt("[voice] spotting takes %.1f ms of CPU a second of sound (%.0f s heard)", 1000 * busy.spotting / busy.heard, busy.heard));
    }
}

}  // namespace agent
