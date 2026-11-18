#include "voice.h"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <thread>

#include "async.h"
#include "audio.h"
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
    /// The RMS of the last sound heard.
    std::atomic<float> loudness{0};

    explicit Ears(std::unique_ptr<Spotter> spotter) : listener(std::make_unique<Listener>(std::move(spotter))) {}

    /// The sound thread.
    void heard(const float* samples, size_t count) {
        std::lock_guard<std::mutex> h(hearing);
        double sum = 0;
        for (size_t i = 0; i < count; i++) sum += double(samples[i]) * samples[i];
        if (count) loudness = float(std::sqrt(sum / double(count)));
        std::vector<Listener::Event> out;
        std::vector<std::unique_ptr<Spotter>> retired = apply(out);
        double now = mediaTime();
        for (Listener::Event& e : listener->hear(samples, count)) {
            if (auto* piece = std::get_if<Listener::Streamed>(&e)) piece->heard = now;
            out.push_back(std::move(e));
        }
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
                           [&](SetMode& m) { listener->setMode(m.mode); },
                           [&](TurnOver&) { listener->turnOver(); },
                           [&](NotNamed&) { listener->notNamed(); },
                           [&](ReplyStreams&) { listener->replyStreams(); },
                           [&](MomoThinks& m) { listener->momoThinks(m.thinking); },
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

/// The service's /live socket, beside its /ws: ws://host:port/live?token=…&connection=…
std::string liveUrl(const Address& address, const std::string& connection) {
    std::string base = address.http;
    if (base.rfind("https:", 0) == 0) base = "wss:" + base.substr(6);
    else if (base.rfind("http:", 0) == 0) base = "ws:" + base.substr(5);
    return base + "/live?token=" + queryEscape(address.token) + (connection.empty() ? "" : "&connection=" + queryEscape(connection));
}

/// 16-bit little-endian PCM, as /live carries the microphone.
std::string pcm16(const std::vector<float>& samples) {
    std::string out;
    out.reserve(samples.size() * 2);
    for (float v : samples) {
        uint16_t s = uint16_t(int16_t(std::clamp(v, -1.f, 1.f) * 32767));
        out += char(s & 0xff);
        out += char(s >> 8);
    }
    return out;
}

std::optional<std::vector<int16_t>> samplesOf(const std::string& base64) {
    std::optional<std::string> bytes = base64Decode(base64);
    if (!bytes || bytes->size() % 2) return std::nullopt;
    std::vector<int16_t> out(bytes->size() / 2);
    for (size_t i = 0; i < out.size(); i++) out[i] = int16_t(uint16_t(uint8_t((*bytes)[2 * i])) | uint16_t(uint8_t((*bytes)[2 * i + 1])) << 8);
    return out;
}

/// How long a reply file would take to hear, for `-mute`, which plays none: about 2.6 words a second, as a voice speaks.
double spokenSeconds(const std::string& text) {
    int words = 0;
    bool inWord = false;
    for (char c : text) {
        bool space = c == ' ' || c == '\n';
        if (!space && !inWord) words++;
        inWord = !space;
    }
    return std::max(1.0, words / 2.6);
}

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

std::string revealed(const std::string& text, double share) {
    if (share >= 1) return text;
    size_t upTo = size_t(std::max(0.0, share) * double(text.size()));
    if (text.find(' ') == std::string::npos) {
        while (upTo > 0 && (uint8_t(text[upTo]) & 0xC0) == 0x80) upTo--;
        return text.substr(0, upTo);
    }
    size_t space = text.rfind(' ', upTo);
    return space == std::string::npos ? "" : text.substr(0, space);
}

/// Momo's voice played to no one. It ends once the voice has had as long as it takes to hear what was written, which the
/// voice tells it (`caughtUp`).
class Voice::Unheard : public platform::Stream {
public:
    explicit Unheard(std::function<void(bool)> done) : done(std::move(done)) {}
    void write(const int16_t*, size_t) override {}
    void finish() override { finished = true; }
    void stop() override { end(false); }
    void caughtUp() {
        if (finished) end(true);
    }

private:
    std::function<void(bool)> done;
    bool finished = false;
    void end(bool played) {
        if (!done) return;
        auto d = std::move(done);
        done = nullptr;
        d(played);
    }
};

Voice::Voice(Client& client, std::function<Scene()> scene, std::optional<std::string> clip, bool muted)
    : client(client), scene(std::move(scene)), clip(std::move(clip)), muted(muted) {}

Voice::~Voice() {
    if (microphone) microphone->stop();
    if (sound) sound->stop();
    if (std::holds_alternative<Thinking>(turn) && !muted) audio::level("momo_thinking", 0);
    if (sounding) sounding->player->stop();
    if (auto* c = std::get_if<Connecting>(&link)) c->socket->close();
    if (auto* r = std::get_if<Ready>(&link)) r->socket->close();
}

std::optional<Listener::State> Voice::state() const {
    if (!ears || !ears->live) return std::nullopt;
    return ears->state.load();
}

std::string Voice::name() const { return titled(spelled); }

// GUIDE (voice.h): the welcome walk's ear.
void Voice::tutor(std::optional<Tutor> t) {
    bool was = tutoring.has_value();
    tutoring = std::move(t);
    tutorEpoch++;
    if (was == tutoring.has_value() || !std::holds_alternative<Ready>(link)) return;
    send(SetMode{tutoring ? Listener::Mode::record : Listener::Mode::stream});
}

Voice::Hearing Voice::hearing() const {
    if (microphoneRefusedAt >= 0) return microphoneSettingsOnly ? Hearing::settingsOnly : Hearing::refused;
    if (microphoneUnasked) return Hearing::unasked;
    if (askingForMicrophone) return Hearing::asking;
    if (!ears) return started ? Hearing::off : Hearing::starting;
    return ears->live ? Hearing::ready : Hearing::starting;
}

std::optional<RecordedLine> recordedLine(const std::string& name) {
    static std::mutex lock;
    static std::map<std::string, RecordedLine> lines;
    static bool read = false;
    std::lock_guard<std::mutex> g(lock);
    if (!read) {
        read = true;
        std::string manifest = platform::resourcePath("voice/manifest.json");
        std::optional<std::string> text = manifest.empty() ? std::nullopt : platform::readFile(manifest);
        std::optional<Json> j = text ? Json::parse(*text) : std::nullopt;
        if (!j) logLine("[voice] the walk's recorded lines are not here (voice/manifest.json)");
        for (const Json& line : j ? (*j)["lines"].array() : std::vector<Json>{}) {
            std::string path = platform::resourcePath("voice/" + line["file"].string(""));
            if (!path.empty()) lines[line["name"].string("")] = RecordedLine{path, line["text"].string(""), line["seconds"].number(0)};
        }
    }
    auto found = lines.find(name);
    if (found == lines.end()) return std::nullopt;
    return found->second;
}

std::optional<RecordedSound> recordedSound(const RecordedLine& line, std::string& why) {
    std::optional<std::string> bytes = platform::readFile(line.path);
    if (!bytes) {
        why = "it can't be read (" + line.path + ")";
        return std::nullopt;
    }
    const std::string& s = *bytes;
    auto u16 = [&](size_t at) { return uint32_t(uint8_t(s[at])) | uint32_t(uint8_t(s[at + 1])) << 8; };
    auto u32 = [&](size_t at) { return u16(at) | u16(at + 2) << 16; };
    if (s.size() < 12 || s.compare(0, 4, "RIFF") != 0 || s.compare(8, 4, "WAVE") != 0) {
        why = "it is not a WAV";
        return std::nullopt;
    }
    RecordedSound out;
    bool format = false;
    for (size_t at = 12; at + 8 <= s.size();) {
        std::string id = s.substr(at, 4);
        size_t size = u32(at + 4), body = at + 8;
        if (size > s.size() - body) size = s.size() - body;
        if (id == "fmt ") {
            if (size < 16 || u16(body) != 1 || u16(body + 2) != 1 || u16(body + 14) != 16) {
                why = "it is not 16-bit PCM in one channel";
                return std::nullopt;
            }
            out.rate = int(u32(body + 4));
            format = true;
        } else if (id == "data" && format) {
            out.samples.resize(size / 2);
            for (size_t i = 0; i < out.samples.size(); i++) out.samples[i] = int16_t(u16(body + 2 * i));
            if (out.samples.empty() || out.rate <= 0) {
                why = "it holds no sound";
                return std::nullopt;
            }
            return out;
        }
        at = body + size + (size & 1);
    }
    why = "it has no sound in it";
    return std::nullopt;
}

platform::StreamRef playRecordedAlone(const RecordedLine& line, std::function<void(bool played)> done) {
    std::string why;
    std::optional<RecordedSound> sound = recordedSound(line, why);
    if (!sound) {
        logLine("[voice] the walk's recorded line can't be played: " + why);
        return nullptr;
    }
    platform::StreamRef player = platform::playStream(sound->rate, std::move(done));
    if (!player) return nullptr;
    player->write(sound->samples.data(), sound->samples.size());
    player->finish();
    return player;
}

std::optional<double> Voice::tellRecorded(const std::string& name) {
    std::optional<RecordedLine> r = recordedLine(name);
    if (!r) {
        logLine("[voice] the walk has no recorded line " + name);
        return std::nullopt;
    }
    std::string why;
    std::optional<RecordedSound> sound = recordedSound(*r, why);
    if (!sound) {
        logLine("[voice] the walk's recorded line " + name + " can't be played: " + why);
        return std::nullopt;
    }
    double seconds = double(sound->samples.size()) / sound->rate;
    pendingRecorded = std::make_pair(*r, std::move(*sound));
    pending.reset();
    if (ears) send(AskToSpeak{});
    else {
        auto [line, samples] = std::move(*pendingRecorded);
        pendingRecorded.reset();
        playRecorded(line, samples);
    }
    return seconds;
}

// As a reply streamed from the service is (`startPlayer`): her stream player, her level from its loudness, her words
// shown by how far into it she is.
void Voice::playRecorded(const RecordedLine& line, const RecordedSound& sound) {
    std::weak_ptr<Inbox> box = inbox;
    int number = ++players;
    auto played = [box, number](bool) {
        if (auto b = box.lock()) {
            std::lock_guard<std::mutex> g(b->lock);
            b->streamsPlayed.push_back(number);
        }
    };
    std::shared_ptr<Unheard> unheard = muted ? std::make_shared<Unheard>(played) : nullptr;
    platform::StreamRef player = unheard ? unheard : platform::playStream(sound.rate, played);
    if (!player) {
        logLine("[voice] the walk's recorded line could not be played: no player for it");
        failedRecordings++;
        send(ReplyEnded{});
        return;
    }
    if (sounding) sounding->player->stop();
    sounding = Sounding{};
    sounding->number = number;
    sounding->player = player;
    sounding->unheard = unheard;
    sounding->rate = sound.rate;
    sounding->text = line.text;
    sounding->length = double(sound.samples.size()) / sound.rate;
    sounding->recorded = true;
    shown.momoText.clear();
    spoken = line.text;
    sounding->walk = true;
    sounding->queued = sound.samples;
    sounding->ending = true;
    feedWalk();
    logLine(fmt("[voice] speaking the walk's own line (%.1f s): ", sounding->length) + line.text);
    if (awaiting()) turnTo(Idle{});
}

void Voice::askLesson(const LessonAsk& ask, const std::string& fallback) {
    auto* ready = std::get_if<Ready>(&link);
    if (!ready) {
        logLine("[voice] the live voice is not open, so the walk's own line");
        tellRecorded(fallback);
        return;
    }
    // (Within the service's limits, which drop a frame past them.)
    auto cut = [](const std::string& s, size_t most) {
        if (s.size() <= most) return s;
        size_t at = most;
        while (at > 0 && (uint8_t(s[at]) & 0xC0) == 0x80) at--;
        return s.substr(0, at);
    };
    Json cards = Json::list();
    for (size_t i = 0; i < ask.cards.size() && i < 8; i++) {
        cards.push(Json::object().set("title", cut(ask.cards[i].first, 120)).set("says", cut(ask.cards[i].second, 240)));
    }
    int turn = ++turns;
    sendLive(Json::object().set("t", "lesson").set("turn", turn).set("words", cut(ask.words.empty() ? "(nothing)" : ask.words, 500))
                 .set("picture", cut(ask.picture, 600)).set("cards", cards));
    lesson = Lesson{turn, clock, fallback, ""};
    logLine(fmt("[voice] the lesson's words go to the live Momo (turn %d)", turn));
}

void Voice::joined(const Settings& settings, bool speaks, bool live, const std::string& id) {
    serviceSpeaks = speaks;
    liveOffered = live;
    if (id != connection) {
        connection = id;
        // /live names the old connection: what Momo starts there would be no one's. It opens again for this one.
        bool open = !std::holds_alternative<Shut>(link);
        if (auto* c = std::get_if<Connecting>(&link)) c->socket->close();
        if (auto* r = std::get_if<Ready>(&link)) r->socket->close();
        if (open) liveDown("the connection changed", clock);
    }
    wanted = settings.agentName;
    // Work going on before a reconnect may have ended unseen.
    crew = Crew{};
    if (live) {
        if (auto* shut = std::get_if<Shut>(&link)) shut->retryAt = 0;
    } else {
        if (auto* c = std::get_if<Connecting>(&link)) c->socket->close();
        if (auto* r = std::get_if<Ready>(&link)) r->socket->close();
        liveDown("the service has no live voice", clock);
    }
    if (!started) start();
    else if (ears && wanted != spelled && wanted != refused) respell();
}

void Voice::renamed(const std::string& name) {
    wanted = name;
    if (ears && wanted != spelled && wanted != refused) respell();
}

void Voice::start(bool ask) {
    started = true;
    std::string tokens = platform::resourcePath("kws/tokens.txt");
    if (tokens.empty()) {
        logLine("[voice] the listener's model is not here (quest/tools/fetch-voice.sh), so the headset does not listen");
        return;
    }
    modelDir = tokens.substr(0, tokens.rfind('/'));
    struct Made {
        std::shared_ptr<const Vocabulary> vocabulary;
        std::unique_ptr<Spotter> spotter;
        std::optional<std::vector<float>> clip;
        std::string why;
    };
    auto made = std::make_shared<Made>();
    std::string dir = modelDir, name = wanted;
    std::optional<std::string> clipFile = clip;
    Async::run(
        [made, dir, name, clipFile] {
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
        [this, made, name, ask] {
            if (!made->spotter) {
                logLine("[voice] not listening: " + made->why);
                return;
            }
            vocabulary = made->vocabulary;
            spelled = keywordLines(name, *vocabulary) ? name : "momo";
            ears = std::make_shared<Ears>(std::move(made->spotter));
            // /live can be ready before the listener's model has loaded, and what was sent then had no ears to reach.
            if (std::holds_alternative<Ready>(link) && !tutoring) send(SetMode{Listener::Mode::stream});
            if (made->clip) {
                std::weak_ptr<Ears> weak = ears;
                platform::MicrophoneEvents events;
                events.heard = [weak](const float* samples, size_t count) {
                    if (auto e = weak.lock()) e->heard(samples, count);
                };
                microphone = std::make_shared<ClipMicrophone>(std::move(*made->clip), std::move(events));
                logLine("[voice] listening for \"Hey " + this->name() + "\" in " + *clip);
            } else {
                // WS95: the microphone is opened at launch only where it is allowed. Never asked for, it is asked for where
                // it is first needed; refused on an earlier run, it stays so (its mark shows) until asked for again.
                platform::MicrophoneLeave leave = platform::microphoneLeave();
                bool wanted = askWhenLoaded && leave == platform::MicrophoneLeave::unasked;
                askWhenLoaded = false;
                if (ask || wanted || leave == platform::MicrophoneLeave::given) {
                    openMicrophone();
                    logLine("[voice] listening for \"Hey " + this->name() + "\"");
                } else if (leave == platform::MicrophoneLeave::unasked) {
                    microphoneUnasked = true;
                    logLine("[voice] the microphone has never been asked for: it is asked for where it is first needed");
                } else {
                    microphoneRefusedAt = clock;
                    microphoneSettingsOnly = leave == platform::MicrophoneLeave::settingsOnly;
                    logLine(std::string("[voice] the microphone was refused before, so the headset does not listen") +
                            (microphoneSettingsOnly ? ": the system no longer asks, so only its Settings can allow it" : ""));
                }
            }
            if (wanted != spelled) respell();
        });
}

void Voice::askForMicrophone(bool orSettings, const std::string& why) {
    askingWhy = why;
    if (microphoneUnasked) {
        microphoneUnasked = false;
        logLine("[voice] the microphone is asked for, where it is first needed");
        openMicrophone();
        return;
    }
    // (Wanted before the listener's model has loaded: asked for once it has, if it was never asked for.)
    if (!ears && microphoneRefusedAt < 0) {
        askWhenLoaded = true;
        return;
    }
    if (microphoneRefusedAt < 0) return;
    if (!microphoneSettingsOnly) {
        logLine("[voice] the microphone was not allowed: the user is asked again");
        listenAgain();
        return;
    }
    if (!orSettings) return;
    if (platform::openAppSettings()) {
        logLine("[voice] the system no longer asks for the microphone: its Settings for this app are opened");
        return;
    }
    logLine("[voice] the system's Settings could not be opened from here: the note says where to switch the microphone on");
    settingsUnopened = true;
    noteUntil = clock + refusalShown;
}

void Voice::askForMicrophoneFirst(const std::string& why) {
    if (microphoneRefusedAt >= 0) return;
    askForMicrophone(false, why);
}

void Voice::addressedWithoutMicrophone() {
    if (microphoneUnasked) {
        askForMicrophone();
        return;
    }
    if (microphoneRefusedAt < 0) return;
    noteUntil = clock + refusalShown;
}

void Voice::listenAgain() {
    microphoneRefusedAt = -1;
    noteUntil = -1;
    microphoneSettingsOnly = false;
    microphoneFailures = 0;
    reopenAt = -1;
    start(true);
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
        [box] {
            if (auto b = box.lock()) {
                std::lock_guard<std::mutex> g(b->lock);
                b->microphoneAsking = true;
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
    if (std::holds_alternative<Ready>(link) || serviceSpeaks) lineAt = clock;
    if (std::holds_alternative<Ready>(link)) {
        logLine("[voice] on the live voice Momo tells it in its own words");
        return;
    }
    if (!serviceSpeaks) {
        // No voice of the service's (hello's `voice` false: the hosted and demo servers, WS97), and /live not ready: her
        // words show as her caption for as long as they would take to say, with nothing fetched, as `-mute` shows a reply;
        // then it ends as a reply heard does (`unheardReply`).
        if (sound) sound->stop();
        spoken = text;
        sound = std::make_shared<UnheardFile>();
        unheardReply = UnheardReply{++reply, clock + spokenSeconds(text)};
        shown.momoText = text;
        if (awaiting()) endThinking();
        logLine("[voice] no voice of the service's, so her words show: " + text);
        return;
    }
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

void Voice::transcribe(const std::string& wav, int walk) {
    platform::Request request;
    request.method = "POST";
    std::optional<TreeId> tree = scene().treeId;
    // `woke=1`: the recording began with what the spotter took for the name, and the service checks that it was.
    request.url = client.address().http + "/api/transcribe?woke=1" + (tree ? "&tree=" + queryEscape(tree->value) : "");
    request.headers = {{"Authorization", "Bearer " + client.address().token}, {"Content-Type", "audio/wav"}};
    request.body = wav;
    request.timeout = 60;
    std::weak_ptr<Inbox> box = inbox;
    platform::fetch(request, [box, walk](platform::Response r) {
        auto b = box.lock();
        if (!b) return;
        Transcript t;
        t.walk = walk;
        if (r.status == 200 && r.error.empty()) {
            std::optional<Json> j = Json::parse(r.body);
            t.ok = j && (*j)["text"].isString();
            if (t.ok) t.text = (*j)["text"].string();
            if (t.ok) t.named = (*j)["named"].boolean(true);
        }
        if (!t.ok) t.why = r.error.empty() ? fmt("status %d", r.status) : r.error;
        std::lock_guard<std::mutex> g(b->lock);
        b->transcripts.push_back(std::move(t));
    });
}

void Voice::frame(double now) {
    double dt = std::max(0.0, now - clock);
    clock = now;
    if (sounding) {
        sounding->played = std::min(sounding->played + dt, double(sounding->written) / sounding->rate);
        feedWalk();
        if (sounding->unheard && sounding->played * sounding->rate >= double(sounding->written)) sounding->unheard->caughtUp();
    }
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
                           if (!muted && audio::on()) {
                               audio::play("momo_chime");
                               // Only where the microphone hears the chime is the listener told of it, and deaf to
                               // words while it plays: on the headset it does not, and a short word said just after
                               // the name ("hi Momo… undo") would be lost in that stretch (agents/DECISIONS.md 71).
                               if (platform::microphoneHearsOwnSounds()) {
                                   send(ChimeStarted{});
                                   chimeEnds = clock + audio::seconds("momo_chime");
                               }
                           }
                           turnTo(Listening{});
                           if (tutoring && tutoring->woke) tutoring->woke();        // GUIDE
                           // The spotter also wakes on what only sounds like the name, so the service checks the sound
                           // that woke it. Nothing waits for the answer here: Momo's own doings wait there. A recording
                           // is checked where it is transcribed.
                           if (!tutoring) sendLive(Json::object().set("t", "name").set("pcm", base64Encode(pcm16(w.sound))));
                       },
                       [&](Listener::Began&) {
                           turnTo(Listening{});
                           beginTurn();
                       },
                       [&](Listener::Closed&) {
                           logLine("[voice] nobody talked for 8 s, so the conversation is over");
                           if (std::holds_alternative<Listening>(turn) || std::holds_alternative<Open>(turn)) turnTo(Idle{});
                       },
                       [&](Listener::Streamed& piece) {
                           if (!streaming) return;
                           sendLive(Json::object().set("t", "audio").set("pcm", base64Encode(pcm16(piece.samples))));
                           if (piece.speech) lastWord = piece.heard;
                       },
                       [&](Listener::Cut&) {
                           if (!streaming) return;
                           logLine("[voice] a minute went by without the turn being over, so it stops streaming");
                           sendLive(Json::object().set("t", "end"));
                           streaming.reset();
                           turnTo(Sent{clock});
                       },
                       [&](Listener::Recorded& r) {
                           logLine(fmt("[voice] recorded %.1f s, sending it to be transcribed", r.seconds));
                           transcribe(r.wav, tutoring ? tutorEpoch : -1);
                           turnTo(Sent{clock, !serviceSpeaks});
                       },
                       [&](Listener::NothingSaid&) {
                           logLine("[voice] nothing was said after the name");
                           turnTo(Idle{});
                           if (tutoring && tutoring->said) tutoring->said("");      // GUIDE
                       },
                       [&](Listener::Speak&) {
                           if (pendingRecorded) {
                               auto [line, sound] = std::move(*pendingRecorded);
                               pendingRecorded.reset();
                               playRecorded(line, sound);
                               return;
                           }
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
    std::vector<FromLive> fromLive;
    std::vector<int> streamsPlayed;
    bool failed = false, refused = false, asking = false;
    {
        std::lock_guard<std::mutex> g(inbox->lock);
        transcripts.swap(inbox->transcripts);
        fetched.swap(inbox->fetched);
        played.swap(inbox->played);
        fromLive.swap(inbox->live);
        streamsPlayed.swap(inbox->streamsPlayed);
        std::swap(failed, inbox->microphoneFailed);
        std::swap(refused, inbox->microphoneRefused);
        std::swap(asking, inbox->microphoneAsking);
    }
    if (asking) askingForMicrophone = true;
    if (chimeEnds >= 0 && now >= chimeEnds) {
        chimeEnds = -1;
        send(ChimeEnded{});
    }
    if (refused) {
        // It stops listening, and replies are still spoken. Asked again (`askForMicrophone`), the headset asks the user
        // again, unless the system has stopped asking: then only its Settings can allow it.
        microphoneSettingsOnly = platform::microphoneLeave() == platform::MicrophoneLeave::settingsOnly;
        logLine(std::string("[voice] the microphone is not allowed, so the headset does not listen") +
                (microphoneSettingsOnly ? ": the system no longer asks, so only its Settings can allow it" : ""));
        askingForMicrophone = false;
        microphoneRefusedAt = now;
        noteUntil = now + refusalShown;
        if (microphone) microphone->stop();
        microphone.reset();
        ears.reset();
        reopenAt = -1;
        if (pendingRecorded) playRecorded(pendingRecorded->first, pendingRecorded->second);
        else if (pending) speak(*pending);
        pending.reset();
        pendingRecorded.reset();
    } else if (failed && ears) {
        if (microphone) microphone->stop();
        microphone.reset();
        double wait = reopenDelays[std::min(microphoneFailures, int(std::size(reopenDelays)) - 1)];
        microphoneFailures++;
        reopenAt = now + wait;
        logLine(fmt("[voice] opening the microphone again in %.0f s", wait));
    }
    // In front again (the headset put back on, or the app brought back): a microphone the system would not let capture
    // meanwhile opens again now, not after its wait, and waits from the first again should it fail.
    bool back = platform::resumed();
    // In front again with the microphone refused, and allowed meanwhile (in the system's Settings, WS87): listening starts
    // again, with nothing to ask.
    if (back && microphoneRefusedAt >= 0 && platform::microphoneLeave() == platform::MicrophoneLeave::given) {
        logLine("[voice] the app is in front again and the microphone is allowed now, so the headset listens again");
        listenAgain();
    }
    // (Never asked for, and allowed in the system's Settings meanwhile: it listens, with nothing to ask.)
    if (back && microphoneUnasked && platform::microphoneLeave() == platform::MicrophoneLeave::given) {
        logLine("[voice] the app is in front again and the microphone is allowed now, so the headset listens");
        microphoneUnasked = false;
        openMicrophone();
    }
    if (back && ears && !microphone && reopenAt >= 0) {
        logLine("[voice] the app is in front again, so the microphone opens again now");
        microphoneFailures = 0;
        reopenAt = now;
    }
    if (ears && !microphone && reopenAt >= 0 && now >= reopenAt) {
        reopenAt = -1;
        openMicrophone();
    }
    if (ears && microphone && ears->live) {
        microphoneFailures = 0;
        askingForMicrophone = false;
    }
    for (const Transcript& t : transcripts) {
        std::string text = t.text;
        size_t first = text.find_first_not_of(" \t\n"), last = text.find_last_not_of(" \t\n");
        text = first == std::string::npos ? "" : text.substr(first, last - first + 1);
        bool sent = false;
        // GUIDE: recorded for the walk, but the walk's ears have changed hands since (it moved on, WS80): its words are
        // let be, never sent to the live Momo, who would answer them in a lesson they weren't asked in.
        if (t.walk >= 0 && !(tutoring && t.walk == tutorEpoch)) {
            logLine("[voice] what was said for the walk came back after it had moved on, so it is let be");
            endThinking();
            send(Done{});
            continue;
        }
        if (tutoring) {
            // GUIDE: the walk's turn. Its words are the walk's to answer, and the service is not told.
            if (!t.ok) logLine("[voice] the recording could not be turned into text (" + t.why + ")");
            else logLine("[voice] said to the walk: " + text);
            shown.userText = text;
            shown.userFinal = true;
            endThinking();
            send(Done{});
            if (tutoring->said) tutoring->said(t.ok ? text : "");
            continue;
        }
        if (!t.ok) logLine("[voice] the recording could not be turned into text (" + t.why + ")");
        else if (!t.named) logLine("[voice] the service did not find the name in what woke the headset, so nothing is made of it");
        else if (text.empty()) logLine("[voice] nothing was heard after the name");
        else if (!client.send(Outbound::utter(text, true, scene()))) logLine("[voice] not connected, so \"" + text + "\" was not sent");
        else sent = true;
        if (sent) {
            logLine("[voice] said: " + text);
            shown.userText = text;
            shown.userFinal = true;
        } else {
            endThinking();
        }
        send(Done{});
    }
    for (const Fetched& f : fetched) {
        if (f.reply != reply) continue;
        if (!f.ok) {
            logLine("[voice] the reply could not be spoken (" + f.why + ")");
            endThinking();
            send(ReplyEnded{});
            spoken.clear();
            continue;
        }
        std::weak_ptr<Inbox> box = inbox;
        int number = f.reply;
        if (muted) {
            sound = std::make_shared<UnheardFile>();
            unheardReply = UnheardReply{number, now + spokenSeconds(spoken)};
        } else {
            sound = play(f.file, [box, number](bool) {
                if (auto b = box.lock()) {
                    std::lock_guard<std::mutex> g(b->lock);
                    b->played.push_back(number);
                }
            });
        }
        if (!sound) continue;
        logLine("[voice] speaking: " + spoken);
        if (awaiting()) turnTo(Idle{});
        shown.momoText = spoken;
    }
    // GUIDE: the lesson put to the live Momo, and no sound from her yet: the walk's own line instead.
    if (lesson && now - lesson->sentAt >= lessonWait) {
        logLine(fmt("[voice] no sound from the live Momo %.0f s after the lesson's words, so the walk's own line", lessonWait));
        std::string fallback = lesson->fallback;
        lateLesson = lesson->id;
        lateTurn = lesson->turn;
        lesson.reset();
        tellRecorded(fallback);
    }
    if (unheardReply && now >= unheardReply->until) {
        played.push_back(unheardReply->number);
        unheardReply.reset();
    }
    for (int number : played) {
        if (number != reply) continue;
        sound.reset();
        spoken.clear();
        send(ReplyEnded{});
        logLine("[voice] done speaking");
    }
    for (FromLive& f : fromLive) {
        int current = 0;
        if (auto* c = std::get_if<Connecting>(&link)) current = c->number;
        if (auto* r = std::get_if<Ready>(&link)) current = r->number;
        if (f.socket == current) heardLive(f.frame, now);
    }
    for (int number : streamsPlayed) {
        if (!sounding || sounding->number != number) continue;
        shown.momoText = sounding->text;
        if (sounding->recorded) spoken.clear();
        sounding.reset();
        if (live && !live->player && !live->held.empty() && startPlayer(*live)) continue;
        send(ReplyEnded{});
        if (live && live->player == number) {
            live.reset();
            spoken.clear();
        }
        logLine("[voice] done speaking");
    }
    if (auto* sent = std::get_if<Sent>(&turn); sent && now - sent->at >= sentFor) {
        Thinking next;
        next.since = now;
        next.endsWithWork = sent->endsWithWork;
        if (sent->settled) turnTo(Idle{});
        else turnTo(std::move(next));
    }
    if (auto* t = std::get_if<Thinking>(&turn); t && now - t->since >= longestThought) {
        logLine(fmt("[voice] no answer came in %.0f s, so Momo stops thinking", longestThought));
        turnTo(Idle{});
    }
    if (auto* shut = std::get_if<Shut>(&link); shut && liveOffered && now >= shut->retryAt && client.state() == Client::State::live) {
        openLive(now);
    }
    if (sounding || sound) lineAt = -1;
    bool open = state() == Listener::State::open, speaks = sounding || sound;
    // Momo thinking (at most `longestThought`), or a reply come and not yet sounding (at most `lineWait`), keeps the
    // conversation open as its voice does.
    bool thinks = !speaks && (awaiting() || lineComing());
    if (ears && thinks != thinkingTold) {
        thinkingTold = thinks;
        send(MomoThinks{thinks});
    }
    if (std::holds_alternative<Idle>(turn) && open && !speaks) turnTo(Open{});
    else if (std::holds_alternative<Open>(turn) && (!open || speaks)) turnTo(Idle{});
    show();
    if (Flags::has("agentLog") && busy.heard - busyLogged >= 60) {
        busyLogged = busy.heard;
        logLine(fmt("[voice] spotting takes %.1f ms of CPU a second of sound (%.0f s heard)", 1000 * busy.spotting / busy.heard, busy.heard));
    }
}

}  // namespace agent

namespace agent {

void Voice::openLive(double now) {
    int number = ++sockets;
    std::weak_ptr<Inbox> box = inbox;
    auto deliver = [box, number](LiveFrame frame) {
        auto b = box.lock();
        if (!b) return;
        std::lock_guard<std::mutex> g(b->lock);
        b->live.push_back(FromLive{number, std::move(frame)});
    };
    platform::SocketRef socket = platform::openSocket(liveUrl(client.address(), connection), {
        [] {},
        [deliver](const std::string& text) {
            std::optional<Json> j = Json::parse(text);
            if (!j) return;
            const Json& m = *j;
            std::string t = m["t"].string("");
            if (t == "ready") deliver(LiveReady{m["rate"].integer(24000)});
            else if (t == "over") deliver(LiveOver{m["turn"].integer(0)});
            else if (t == "heard") deliver(LiveHeard{m["turn"].integer(0), m["text"].string(""), m["final"].boolean(false)});
            else if (t == "quiet") deliver(LiveQuiet{m["turn"].integer(0)});
            else if (t == "text") {
                deliver(LiveText{m["id"].string(""), m["turn"].integer(0), m["text"].string(""), m["kind"].string("") == "results",
                                 std::max(0.0, m["ms"].number(0)) / 1000, std::max(0.0, m["from"].number(0)) / 1000});
            }
            else if (t == "done") deliver(LiveDone{m["id"].string("")});
            else if (t == "failed") deliver(LiveFailed{m["why"].string("")});
            else if (t == "name") deliver(LiveNamed{m["ok"].boolean(true)});
            else if (t == "audio") {
                std::optional<std::vector<int16_t>> pcm = samplesOf(m["pcm"].string(""));
                if (pcm) deliver(LiveAudio{m["id"].string(""), std::move(*pcm)});
                else logLine("[voice] the live voice sent sound that is not base64 16-bit PCM");
            }
        },
        [deliver](const std::string& why) { deliver(LiveClosed{why}); },
    });
    if (socket) link = Connecting{socket, number};
    else link = Shut{now + liveRetry};
}

bool Voice::sendLive(const Json& frame) {
    auto* r = std::get_if<Ready>(&link);
    return r && r->socket->send(frame.dump());
}

void Voice::heardLive(LiveFrame& frame, double now) {
    std::visit(overloaded{
                   [&](LiveReady& r) {
                       auto* c = std::get_if<Connecting>(&link);
                       if (!c) return;
                       int rate = r.rate > 0 ? r.rate : 24000;
                       link = Ready{c->socket, c->number, rate};
                       liveWhy.clear();
                       if (!tutoring) send(SetMode{Listener::Mode::stream});     // GUIDE: the walk hears turns itself
                       logLine(fmt("[voice] Momo's live voice is on (%d Hz)", rate));
                   },
                   [&](LiveClosed& c) { liveDown(c.why, now); },
                   [&](LiveOver& o) {
                       if (streaming != o.turn) return;
                       endTurn();
                       turnTo(Sent{now});
                       if (lastWord <= 0) return;
                       logLine(fmt("[voice] turn %d over %.2f s after the last word", o.turn, mediaTime() - lastWord));
                       answering = lastWord;
                   },
                   [&](LiveHeard& h) {
                       if (h.turn != wordsOf) return;
                       shown.userText = h.text;
                       shown.userFinal = h.final;
                   },
                   [&](LiveQuiet& q) {
                       if (q.turn == wordsOf) endThinking();
                       if (lesson && q.turn == lesson->turn) {
                           logLine("[voice] the live Momo has nothing to say to the lesson, so the walk's own line");
                           std::string fallback = lesson->fallback;
                           lateLesson = lesson->id;
                           lateTurn = lesson->turn;
                           lesson.reset();
                           tellRecorded(fallback);
                       }
                   },
                   [&](LiveNamed& n) {
                       if (n.ok) return;
                       // What woke the headset only sounded like the name: the conversation it opened closes, and
                       // nothing the service made of it comes.
                       logLine("[voice] the service did not find the name in what woke the headset, so the conversation closes");
                       streaming.reset();
                       send(NotNamed{});
                       shown.userText.clear();
                       shown.userFinal = false;
                       if (!std::holds_alternative<Idle>(turn)) turnTo(Idle{});
                   },
                   [&](LiveFailed& f) {
                       logLine("[voice] the live voice failed: " + f.why);
                       endTurn();
                       hushLive();
                       if (!std::holds_alternative<Idle>(turn)) turnTo(Idle{});
                   },
                   [&](LiveAudio& a) {
                       if (streaming || !std::holds_alternative<Ready>(link)) return;
                       // GUIDE: the lesson's answer, too late: the walk's own line has been said in its place.
                       if (!lateLesson.empty() && a.id == lateLesson) return;
                       if (!hushedResults.empty() && a.id == hushedResults) return;
                       if (lesson && !lesson->id.empty() && a.id == lesson->id) {
                           walkReply = a.id;
                           lesson.reset();
                       }
                       if (!std::holds_alternative<Idle>(turn)) turnTo(Idle{});
                       LiveReply& r = liveReply(a.id);
                       if (!r.player && sounding) {
                           r.held.insert(r.held.end(), a.pcm.begin(), a.pcm.end());
                           return;
                       }
                       if (!r.player && !startPlayer(r)) return;
                       if (!sounding || sounding->number != r.player) return;
                       if (sounding->walk) {
                           sounding->queued.insert(sounding->queued.end(), a.pcm.begin(), a.pcm.end());
                           feedWalk();
                       } else {
                           sounding->write(a.pcm.data(), a.pcm.size());
                       }
                       if (answering) {
                           logLine(fmt("[voice] Momo answered %.2f s after the last word", mediaTime() - *answering));
                           answering.reset();
                       }
                   },
                   [&](LiveText& t) {
                       if (streaming) return;
                       // WS103: no tree stands, so what a piece of work brought to one put away is not said.
                       if (t.results && t.id != hushedResults && away && away()) {
                           hushedResults = t.id;
                           logLine("[voice] no tree stands, so what the work brought is not said");
                           if (live && live->id == t.id) hushLive();
                       }
                       if (!hushedResults.empty() && t.id == hushedResults) return;
                       if (lateTurn && t.turn == lateTurn) lateLesson = t.id;
                       if (!lateLesson.empty() && t.id == lateLesson) return;
                       if (lesson && t.turn == lesson->turn && lesson->id.empty()) lesson->id = t.id;
                       bool begins = !live || live->id != t.id;
                       LiveReply& r = liveReply(t.id);
                       r.text = t.text;
                       r.length = t.length;
                       r.from = t.from;
                       spoken = t.text;
                       if (sounding && sounding->number == r.player) {
                           sounding->text = t.text;
                           sounding->length = t.length;
                           sounding->from = t.from;
                       }
                       if (begins && t.results && std::holds_alternative<Idle>(turn)) {
                           shown.userText.clear();
                           shown.userFinal = false;
                       }
                   },
                   [&](LiveDone& d) {
                       if (streaming || !live || live->id != d.id) return;
                       if (!live->player && !live->held.empty()) {
                           live->finished = true;
                           return;
                       }
                       if (sounding && sounding->number == live->player) {
                           if (sounding->walk) {
                               sounding->ending = true;
                               feedWalk();
                           } else {
                               sounding->player->finish();
                           }
                           return;
                       }
                       live.reset();
                       if (!sounding) spoken.clear();
                   },
               },
               frame);
}

void Voice::beginTurn() {
    if (!std::holds_alternative<Ready>(link)) {
        logLine("[voice] the live voice closed as the user began talking, so nothing is sent");
        send(TurnOver{});
        turnTo(Idle{});
        return;
    }
    hushLive();
    streaming = wordsOf = ++turns;
    lastWord = 0;
    answering.reset();
    sendLive(Json::object().set("t", "start").set("turn", *streaming).set("scene", sceneJson(scene())));
}

void Voice::endTurn() {
    if (!streaming) return;
    send(TurnOver{});
    streaming.reset();
}

void Voice::hushLive() {
    if (sounding) {
        sounding->player->stop();
        sounding.reset();
        send(ReplyEnded{});
    }
    if (live) spoken.clear();
    live.reset();
}

bool Voice::startPlayer(LiveReply& r) {
    auto* ready = std::get_if<Ready>(&link);
    if (!ready) return false;
    std::weak_ptr<Inbox> box = inbox;
    int number = r.player = ++players;
    auto played = [box, number](bool) {
        if (auto b = box.lock()) {
            std::lock_guard<std::mutex> g(b->lock);
            b->streamsPlayed.push_back(number);
        }
    };
    std::shared_ptr<Unheard> unheard = muted ? std::make_shared<Unheard>(played) : nullptr;
    platform::StreamRef player = unheard ? unheard : platform::playStream(ready->rate, played);
    if (!player) {
        logLine("[voice] Momo's voice could not be played");
        return false;
    }
    sounding = Sounding{};
    sounding->number = number;
    sounding->player = player;
    sounding->unheard = unheard;
    sounding->rate = ready->rate;
    sounding->text = r.text;
    sounding->length = r.length;
    sounding->from = r.from;
    shown.momoText.clear();
    send(ReplyStreams{});
    // GUIDE: the lesson's live answer is the walk's, and is fed as its own lines are, so it can be faded (WS80).
    sounding->walk = !walkReply.empty() && r.id == walkReply;
    if (sounding->walk) {
        sounding->queued = r.held;
        sounding->ending = r.finished;
        feedWalk();
    } else {
        if (!r.held.empty()) sounding->write(r.held.data(), r.held.size());
        if (r.finished) player->finish();
    }
    r.held.clear();
    return true;
}

void Voice::feedWalk() {
    if (!sounding || !sounding->walk) return;
    Sounding& s = *sounding;
    size_t ahead = size_t((s.played + walkAhead) * s.rate);
    if (s.fed < s.queued.size() && s.written < ahead) {
        size_t n = std::min(s.queued.size() - s.fed, ahead - s.written);
        s.write(s.queued.data() + s.fed, n);
        s.fed += n;
    }
    if (s.ending && s.fed >= s.queued.size() && !s.finishedFeeding) {
        s.finishedFeeding = true;
        s.player->finish();
    }
}

void Voice::leaveWalkTurn() {
    tutorEpoch++;
    if (pendingRecorded) logLine("[voice] the walk moved on: her recorded line waiting its turn is let be");
    pendingRecorded.reset();
    if (lesson) {
        logLine("[voice] the walk moved on: the lesson's answer, when it comes, is let be, and so is the line said in its place");
        lateTurn = lesson->turn;
        lateLesson = lesson->id;
        lesson.reset();
    }
    if (!walkReply.empty()) lateLesson = walkReply;
    if (live && !walkReply.empty() && live->id == walkReply && !live->player) live.reset();
    // Hers for the walk, playing: the next moment of it faded out, the rest let go.
    if (sounding && sounding->walk && !sounding->finishedFeeding) {
        Sounding& s = *sounding;
        size_t n = std::min(s.queued.size() - s.fed, size_t(walkFade * s.rate));
        std::vector<int16_t> tail(s.queued.begin() + long(s.fed), s.queued.begin() + long(s.fed + n));
        for (size_t i = 0; i < tail.size(); i++) tail[i] = int16_t(float(tail[i]) * (1 - float(i + 1) / float(tail.size())));
        if (!tail.empty()) s.write(tail.data(), tail.size());
        s.fed = s.queued.size();
        s.ending = true;
        s.finishedFeeding = true;
        s.player->finish();
        logLine(fmt("[voice] the walk moved on: what she was saying for it fades out over %.2f s", walkFade));
    }
}

void Voice::Sounding::write(const int16_t* samples, size_t count) {
    player->write(samples, count);
    written += count;
    int fiftieth = std::max(1, rate / 50);
    for (size_t i = 0; i < count; i++) {
        double v = samples[i] / 32768.0;
        sum += v * v;
        if (++summed < fiftieth) continue;
        loudness.push_back(float(std::sqrt(sum / summed)));
        sum = 0;
        summed = 0;
    }
}

void Voice::liveDown(const std::string& why, double now) {
    bool wasReady = std::holds_alternative<Ready>(link);
    link = Shut{now + liveRetry};
    if (wasReady || why != liveWhy) logLine("[voice] the live voice is off (" + why + "), so the headset transcribes and speaks as before");
    liveWhy = why;
    if (!wasReady) return;
    send(SetMode{Listener::Mode::record});
    endTurn();
    hushLive();
    if (!std::holds_alternative<Idle>(turn)) turnTo(Idle{});
}

// MARK: - What it shows and its own sounds

platform::SoundRef Voice::play(const std::string& path, std::function<void(bool)> done) {
    if (muted) return nullptr;
    return platform::playSound(path, std::move(done));
}

void Voice::turnTo(Turn next) {
    bool wasThinking = std::holds_alternative<Thinking>(turn);
    turn = std::move(next);
    if (std::holds_alternative<Listening>(turn) || std::holds_alternative<Open>(turn)) {
        shown.userText.clear();
        shown.userFinal = false;
        shown.momoText.clear();
    }
    // The last turn's words, should they come late, are not the next one's.
    if (std::holds_alternative<Open>(turn)) wordsOf = 0;
    if (std::holds_alternative<Sent>(turn)) own("momo_sent");
    bool thinking = std::holds_alternative<Thinking>(turn);
    if (thinking != wasThinking && !muted) audio::level("momo_thinking", thinking ? 1 : 0, thinking ? 0.1f : 0.15f);
}

void Voice::own(const char* name) {
    if (!muted) audio::play(name);
}

void Voice::endThinking() {
    if (auto* sent = std::get_if<Sent>(&turn)) sent->settled = true;
    else if (std::holds_alternative<Thinking>(turn)) turnTo(Idle{});
}

void Voice::asked(const std::string& question) {
    // (Picked with the microphone never asked for, it is asked for; off, the note says so, until her reply sounds.)
    addressedWithoutMicrophone();
    wordsOf = 0;
    shown.momoText.clear();
    shown.userText = question;
    shown.userFinal = true;
    turnTo(Sent{clock, true});
}

void Voice::activity(const Activity& a) {
    crew.activity(a, clock);
    if (a.state != Activity::State::start) return;
    bool endsWithWork = std::visit(overloaded{
                                       [](const Sent& s) { return s.endsWithWork; },
                                       [](const Thinking& t) { return t.endsWithWork; },
                                       [](const auto&) { return false; },
                                   },
                                   turn);
    if (endsWithWork) endThinking();
}

void Voice::show() {
    using S = Presence::State;
    bool speaks = sounding || sound;
    shown.state = std::visit(overloaded{
                                 [](const Listening&) { return S::listening; },
                                 // The conversation is open and nobody speaks (speech begins a turn): the microphone stays
                                 // open, and Momo looks idle, or working while an agent is. The user, 2026-11-17:
                                 // "listening should only show when USER IS TALKING, if mic is open but user is not
                                 // talking, mic stays open but momo appears idle".
                                 [&](const Open&) { return crew.working() ? S::working : S::waiting; },
                                 [](const Sent&) { return S::sent; },
                                 [](const Thinking&) { return S::thinking; },
                                 [&](const Idle&) { return speaks ? S::responding : crew.working() ? S::working : state() ? S::waiting : S::off; },
                             },
                             turn);
    shown.level = 0;
    if ((shown.state == S::listening || shown.state == S::open) && ears) shown.level = levelOf(ears->loudness);
    if (shown.state == S::responding && sounding) {
        size_t at = size_t(sounding->played * 50);
        if (at < sounding->loudness.size()) shown.level = levelOf(sounding->loudness[at]);
        // How far the voice is: into the whole recording, a little ahead, when the service said how long it is; otherwise
        // the share of the sound come so far that has been heard, which a recording sent just ahead of its playing would
        // put near the whole of it from the start.
        // (Hers for the walk is fed a little at a time: the sound come so far is all that is queued.)
        double come = sounding->walk ? double(std::max(sounding->queued.size(), sounding->written)) : double(sounding->written);
        double heard = sounding->length > 0 ? (sounding->from + sounding->played + wordsAhead) / sounding->length
                       : come > 0 ? (sounding->played + liveAhead) * sounding->rate / come
                                  : 0;
        // More audio than words may have come, so what is shown only grows.
        std::string words = revealed(sounding->text, heard);
        if (words.size() > shown.momoText.size()) shown.momoText = words;
    }
    crew.update(clock);
    shown.agents = crew.lines(name());
    shown.notice.clear();
    shown.noticeButton.clear();
    shown.microphoneOff = microphoneOff();
    shown.microphoneUnasked = microphoneUnasked;
    // The note on a microphone that is off gives way to her reply, which is what was asked for.
    if (speaks) noteUntil = -1;
    if (client.unreachable()) {
        shown.notice = "Can’t reach " + name() + ", retrying";
    } else if (askingForMicrophone) {
        shown.notice = askingWhy.empty() ? "Allow the microphone to talk to " + name() : askingWhy;
    } else if (microphoneOff() && clock < noteUntil) {
        // (Two lines at most, beside Momo. Where the system no longer asks, the way to turn it on, in Meta's own words for
        // its Settings, takes the place of what is wrong.)
        shown.notice = microphoneSettingsOnly ? name() + " can’t hear you: turn on the microphone in Settings › Privacy and safety › App permissions"
                                              : name() + " can’t hear you: the microphone is off";
        if (!microphoneSettingsOnly || !settingsUnopened) shown.noticeButton = "Allow microphone";
    }
}

Voice::LiveReply& Voice::liveReply(const std::string& id) {
    if (!live || live->id != id) {
        live = LiveReply{};
        live->id = id;
    }
    return *live;
}

}  // namespace agent
