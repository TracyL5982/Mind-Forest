#include "voice.h"

#include <algorithm>
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
                           [&](ReplyStreams& r) { listener->replyStreams(r.interruptible); },
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

std::string lower(std::string s) {
    for (char& c : s) {
        if (c >= 'A' && c <= 'Z') c = char(c - 'A' + 'a');
    }
    return s;
}

/// The service's /live socket, beside its /ws: ws://host:port/live?token=…
std::string liveUrl(const Address& address) {
    std::string base = address.http;
    if (base.rfind("https:", 0) == 0) base = "wss:" + base.substr(6);
    else if (base.rfind("http:", 0) == 0) base = "ws:" + base.substr(5);
    return base + "/live?token=" + queryEscape(address.token);
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
    if (sounding) sounding->player->stop();
    if (auto* c = std::get_if<Connecting>(&link)) c->socket->close();
    if (auto* r = std::get_if<Ready>(&link)) r->socket->close();
}

std::optional<Listener::State> Voice::state() const {
    if (!ears || !ears->live) return std::nullopt;
    return ears->state.load();
}

std::string Voice::name() const { return titled(spelled); }

void Voice::joined(const Settings& settings, bool speaks) {
    serviceSpeaks = speaks;
    wanted = settings.agentName;
    if (std::holds_alternative<Unopened>(link)) link = Shut{};
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
    if (std::holds_alternative<Ready>(link)) {
        logLine("[voice] the live voice says it");
        return;
    }
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
                           if (w.streaming) beginTurn();
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
                       },
                       [&](Listener::Recorded& r) {
                           logLine(fmt("[voice] recorded %.1f s, sending it to be transcribed", r.seconds));
                           transcribe(r.wav);
                       },
                       [&](Listener::NothingSaid&) {
                           logLine("[voice] nothing was said after the name");
                           if (!streaming) return;
                           sendLive(Json::object().set("t", "cancel"));
                           streaming.reset();
                       },
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
    std::vector<FromLive> fromLive;
    std::vector<int> streamsPlayed;
    int chimesEnded = 0;
    bool failed = false, refused = false;
    {
        std::lock_guard<std::mutex> g(inbox->lock);
        transcripts.swap(inbox->transcripts);
        fetched.swap(inbox->fetched);
        played.swap(inbox->played);
        fromLive.swap(inbox->live);
        streamsPlayed.swap(inbox->streamsPlayed);
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
    for (FromLive& f : fromLive) {
        int current = 0;
        if (auto* c = std::get_if<Connecting>(&link)) current = c->number;
        if (auto* r = std::get_if<Ready>(&link)) current = r->number;
        if (f.socket == current) heardLive(f.frame, now);
    }
    for (int number : streamsPlayed) {
        if (!sounding || sounding->number != number) continue;
        sounding.reset();
        if (live && !live->player && !live->held.empty() && startPlayer(*live)) continue;
        send(ReplyEnded{});
        if (live && live->player == number) {
            live.reset();
            spoken.clear();
        }
        logLine("[voice] done speaking");
    }
    if (auto* shut = std::get_if<Shut>(&link); shut && now >= shut->retryAt && client.state() == Client::State::live) openLive(now);
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
    platform::SocketRef socket = platform::openSocket(liveUrl(client.address()), {
        [] {},
        [deliver](const std::string& text) {
            std::optional<Json> j = Json::parse(text);
            if (!j) return;
            const Json& m = *j;
            std::string t = m["t"].string("");
            if (t == "ready") deliver(LiveReady{m["rate"].integer(24000)});
            else if (t == "over") deliver(LiveOver{m["turn"].integer(0)});
            else if (t == "text") deliver(LiveText{m["id"].string(""), m["text"].string("")});
            else if (t == "done") deliver(LiveDone{m["id"].string("")});
            else if (t == "failed") deliver(LiveFailed{m["why"].string("")});
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
                       send(SetMode{Listener::Mode::stream});
                       logLine(fmt("[voice] Momo's live voice is on (%d Hz)", rate));
                   },
                   [&](LiveClosed& c) {
                       bool wasReady = std::holds_alternative<Ready>(link);
                       link = Shut{now + liveRetry};
                       if (wasReady || c.why != liveWhy) logLine("[voice] the live voice is off (" + c.why + "), so the headset transcribes and speaks as before");
                       liveWhy = c.why;
                       if (!wasReady) return;
                       send(SetMode{Listener::Mode::record});
                       endTurn();
                       hushLive();
                   },
                   [&](LiveOver& o) {
                       if (streaming != o.turn) return;
                       endTurn();
                       if (lastWord <= 0) return;
                       logLine(fmt("[voice] turn %d over %.2f s after the last word", o.turn, mediaTime() - lastWord));
                       answering = lastWord;
                   },
                   [&](LiveFailed& f) {
                       logLine("[voice] the live voice failed: " + f.why);
                       endTurn();
                       hushLive();
                   },
                   [&](LiveAudio& a) {
                       if (streaming || !std::holds_alternative<Ready>(link)) return;
                       LiveReply& r = liveReply(a.id);
                       if (!r.player && sounding) {
                           r.held.insert(r.held.end(), a.pcm.begin(), a.pcm.end());
                           return;
                       }
                       if (!r.player && !startPlayer(r)) return;
                       if (!sounding || sounding->number != r.player) return;
                       sounding->player->write(a.pcm.data(), a.pcm.size());
                       if (answering) {
                           logLine(fmt("[voice] Momo answered %.2f s after the last word", mediaTime() - *answering));
                           answering.reset();
                       }
                   },
                   [&](LiveText& t) {
                       if (streaming) return;
                       LiveReply& r = liveReply(t.id);
                       spoken = t.text;
                       bool interruptible = lower(t.text).find(lower(spelled)) == std::string::npos;
                       if (interruptible == r.interruptible) return;
                       r.interruptible = interruptible;
                       if (sounding && sounding->number == r.player) send(ReplyStreams{interruptible});
                   },
                   [&](LiveDone& d) {
                       if (streaming || !live || live->id != d.id) return;
                       if (!live->player && !live->held.empty()) {
                           live->finished = true;
                           return;
                       }
                       if (sounding && sounding->number == live->player) {
                           sounding->player->finish();
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
        logLine("[voice] the live voice closed as the name was heard, so nothing is sent");
        send(TurnOver{});
        return;
    }
    hushLive();
    streaming = ++turns;
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
    platform::StreamRef player = platform::playStream(ready->rate, [box, number](bool) {
        if (auto b = box.lock()) {
            std::lock_guard<std::mutex> g(b->lock);
            b->streamsPlayed.push_back(number);
        }
    });
    if (!player) {
        logLine("[voice] Momo's voice could not be played");
        return false;
    }
    sounding = Sounding{number, player};
    send(ReplyStreams{r.interruptible});
    if (!r.held.empty()) player->write(r.held.data(), r.held.size());
    r.held.clear();
    if (r.finished) player->finish();
    return true;
}

Voice::LiveReply& Voice::liveReply(const std::string& id) {
    if (!live || live->id != id) {
        live = LiveReply{};
        live->id = id;
    }
    return *live;
}

}  // namespace agent
