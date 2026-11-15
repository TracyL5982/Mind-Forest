// The voice between the listener and the service: what it sends, and when it speaks. The host's network, sound and
// microphone are fakes that record what they are asked; the listener is the real one on spoken clips.
#include "sound.h"

#include <cstdlib>

#include "../../async.h"
#include "../voice.h"

using namespace agent;
using namespace check;

namespace {

struct Fetch {
    platform::Request request;
    std::function<void(platform::Response)> done;
};
struct Play {
    std::string path;
    std::function<void(bool)> done;
};

/// The /live socket as the voice opened it: what it sent, and the events the test plays the service with.
struct LiveSocket : platform::Socket {
    std::string url;
    platform::SocketEvents events;
    std::vector<std::string> sent;
    bool closed = false;
    bool send(const std::string& text) override {
        sent.push_back(text);
        return !closed;
    }
    void close() override { closed = true; }
};
/// A stream player: what was written to it, and whether it was finished or stopped. The test says when it is done.
struct Player : platform::Stream {
    int rate = 0;
    std::function<void(bool)> done;
    std::vector<int16_t> written;
    bool finished = false;
    bool stopped = false;
    void write(const int16_t* samples, size_t count) override { written.insert(written.end(), samples, samples + count); }
    void finish() override { finished = true; }
    void stop() override { stopped = true; }
};

/// What the voice asked of the host.
struct Host {
    std::vector<Fetch> fetches;
    std::vector<Play> plays;
    std::vector<std::shared_ptr<LiveSocket>> sockets;
    std::vector<std::shared_ptr<Player>> players;
    platform::MicrophoneEvents microphone;
    int opens = 0;
};
Host host;

std::string dataDir() {
    static const std::string dir = [] {
        std::string d = (std::filesystem::temp_directory_path() / "mind-palace-voice-test").string();
        std::filesystem::create_directories(d);
        return d;
    }();
    return dir;
}

struct Quiet : platform::Microphone {
    void stop() override {}
};
struct Silent : platform::Sound {
    void stop() override {}
};

struct Socket : agent::Socket {
    SocketEvents events;
    std::vector<std::string> sent;
    bool send(const std::string& text) override {
        sent.push_back(text);
        return true;
    }
    void close() override {}
};
struct Transport : agent::Transport {
    std::shared_ptr<Socket> socket = std::make_shared<Socket>();
    std::shared_ptr<agent::Socket> open(const std::string&, SocketEvents events) override {
        socket->events = std::move(events);
        return socket;
    }
};

/// The sound made whole tenths of a second long, so the next sound heard starts on a piece.
Sound whole(Sound s) {
    s.samples.resize((s.size() + Listener::pieceLength - 1) / Listener::pieceLength * Listener::pieceLength, 0.f);
    return s;
}

/// A voice on a live connection to the scripted session, in the tree "t1" with the card "n1" open.
struct Talking {
    std::shared_ptr<Transport> transport = std::make_shared<Transport>();
    Client client{*Address::parse("127.0.0.1:8790", "tok"), transport};
    Voice voice{client, [] { return Scene{NodeId{"n1"}, {}, TreeId{"t1"}}; }, std::nullopt};
    double now = 0;

    explicit Talking(bool serviceSpeaks, const std::string& name = "momo") {
        host = Host{};
        client.tick(100);
        transport->socket->events.opened();
        transport->socket->events.text(sessionTexts().front());
        client.drain();
        Settings settings;
        settings.agentName = name;
        voice.joined(settings, serviceSpeaks);
    }
    /// The microphone hears the sound, a tenth of a second at a time, and the frame thread runs after each.
    void hear(const Sound& sound) {
        std::vector<float> s = sound.withHiss();
        for (size_t at = 0; at < s.size(); at += Listener::pieceLength) {
            host.microphone.heard(s.data() + at, std::min(size_t(Listener::pieceLength), s.size() - at));
            frame(0.1);
        }
    }
    void frame(double seconds = 0) {
        now += seconds;
        voice.frame(now);
    }
    /// As `hear`, with the chime the voice plays heard back through the microphone, as on the headset, and said to
    /// have ended once it has played. `after` is what is said once it has.
    void hearWithChime(const Sound& before, std::function<void(Sound&)> after) {
        std::vector<float> s = before.withHiss();
        std::vector<float> ring = chime();
        size_t chimeEnds = 0;
        std::optional<size_t> chimed;
        for (size_t at = 0;; at += Listener::pieceLength) {
            if (chimed && at >= chimeEnds) {
                host.plays[*chimed].done(true);
                chimed.reset();
                Sound rest;
                after(rest);
                std::vector<float> more = rest.withHiss();
                s.resize(std::max(s.size(), at + more.size()), 0.f);
                for (size_t i = 0; i < more.size(); i++) s[at + i] += more[i];
            }
            if (at + Listener::pieceLength > s.size()) break;
            size_t plays = host.plays.size();
            host.microphone.heard(s.data() + at, Listener::pieceLength);
            frame(0.1);
            if (host.plays.size() > plays && host.plays.back().path == dataDir() + "/agent-chime.wav") {
                chimed = host.plays.size() - 1;
                size_t from = at + 2 * Listener::pieceLength;
                s.resize(std::max(s.size(), from + ring.size()), 0.f);
                for (size_t i = 0; i < ring.size(); i++) s[from + i] += ring[i];
                chimeEnds = from + ring.size();
            }
        }
    }
    std::vector<std::string> utters() const {
        std::vector<std::string> out;
        for (const std::string& t : transport->socket->sent) {
            if (tOf(t) == "utter") out.push_back(t);
        }
        return out;
    }
    /// /live opens on the frame after the join, and the service says it is ready.
    void goLive() {
        frame();
        CHECK_EQ(host.sockets.size(), size_t(1));
        if (host.sockets.empty()) return;
        CHECK_EQ(host.sockets[0]->url, "ws://127.0.0.1:8790/live?token=tok");
        host.sockets[0]->events.opened();
        serviceSays(R"({"t":"ready","rate":24000})");
    }
    /// A frame from the service on the newest /live socket, then a frame of the app.
    void serviceSays(const std::string& text) {
        if (!host.sockets.empty()) host.sockets.back()->events.text(text);
        frame();
    }
    /// What the voice sent on /live, every socket, as JSON.
    std::vector<Json> liveSent(const std::string& t = "") const {
        std::vector<Json> out;
        for (const auto& socket : host.sockets) {
            for (const std::string& text : socket->sent) {
                if (t.empty() || tOf(text) == t) out.push_back(Json::parse(text).value_or(Json()));
            }
        }
        return out;
    }
    /// The microphone's samples in every `audio` frame sent, in order.
    std::vector<int16_t> streamed() const {
        std::vector<int16_t> out;
        for (const Json& frame : liveSent("audio")) {
            std::string bytes = base64Decode(frame["pcm"].string("")).value_or("?");
            CHECK(bytes.size() % 2 == 0, "16-bit samples (%zu bytes)", bytes.size());
            for (size_t i = 0; i + 1 < bytes.size(); i += 2) out.push_back(int16_t(uint16_t(uint8_t(bytes[i])) | uint16_t(uint8_t(bytes[i + 1])) << 8));
        }
        return out;
    }
    /// "Hey Momo, show me more like this." on a live voice, and the service says the turn is over.
    void askLive() {
        goLive();
        hear(whole(Sound().quiet(1).say("command").quiet(1.5)));
        serviceSays(R"({"t":"over","turn":1})");
    }
    std::vector<Fetch> fetchesTo(const std::string& path) const {
        std::vector<Fetch> out;
        for (const Fetch& f : host.fetches) {
            if (f.request.url.find(path) != std::string::npos) out.push_back(f);
        }
        return out;
    }
};

bool hasHeader(const platform::Request& r, const std::string& name, const std::string& value) {
    for (const auto& [n, v] : r.headers) {
        if (n == name && v == value) return true;
    }
    return false;
}

/// The service's `audio` frame carrying these samples.
std::string audioFrame(const std::string& id, const std::vector<int16_t>& samples) {
    std::string bytes;
    for (int16_t v : samples) {
        bytes += char(uint16_t(v) & 0xff);
        bytes += char(uint16_t(v) >> 8);
    }
    return Json::object().set("t", "audio").set("id", id).set("pcm", base64Encode(bytes)).dump();
}

platform::Response ok(const std::string& body) {
    platform::Response r;
    r.status = 200;
    r.body = body;
    return r;
}

}  // namespace

namespace platform {

std::string resourcePath(const std::string& name) { return name == "kws/tokens.txt" ? (check::model / "tokens.txt").string() : ""; }
std::optional<std::string> readFile(const std::string& path) {
    std::string s = check::bytesOf(path);
    if (s.empty()) return std::nullopt;
    return s;
}
bool writeFile(const std::string& path, const std::string& contents) {
    std::ofstream(path, std::ios::binary) << contents;
    return true;
}
std::string dataDirectory() { return dataDir(); }
void fetch(Request request, std::function<void(Response)> done) { host.fetches.push_back({std::move(request), std::move(done)}); }
SoundRef playSound(const std::string& path, std::function<void(bool)> done) {
    host.plays.push_back({path, std::move(done)});
    return std::make_shared<Silent>();
}
SocketRef openSocket(const std::string& url, SocketEvents events) {
    auto socket = std::make_shared<LiveSocket>();
    socket->url = url;
    socket->events = std::move(events);
    host.sockets.push_back(socket);
    return socket;
}
StreamRef playStream(int rate, std::function<void(bool)> done) {
    auto player = std::make_shared<Player>();
    player->rate = rate;
    player->done = std::move(done);
    host.players.push_back(player);
    return player;
}
MicrophoneRef openMicrophone(MicrophoneEvents events) {
    host.opens++;
    host.microphone = std::move(events);
    return std::make_shared<Quiet>();
}

}  // namespace platform

namespace Async {
void run(std::function<void()> work, std::function<void()> then) {
    work();
    if (then) then();
}
}  // namespace Async

TEST(voiceSendsWhatFollowsTheNameAsAnUtter) {
    Talking t(false);
    CHECK(t.voice.state() == std::nullopt, "no sign until sound comes");
    t.hear(Sound().quiet(1).say("command").quiet(2));
    CHECK_EQ(host.plays.size(), size_t(1));
    CHECK(!host.plays.empty() && host.plays[0].path == dataDir() + "/agent-chime.wav", "a chime on the name");
    auto posts = t.fetchesTo("/api/transcribe");
    CHECK_EQ(posts.size(), size_t(1));
    if (posts.empty()) return;
    const platform::Request& r = posts[0].request;
    CHECK_EQ(r.method, "POST");
    CHECK_EQ(r.url, "http://127.0.0.1:8790/api/transcribe?tree=t1");
    CHECK(hasHeader(r, "Authorization", "Bearer tok") && hasHeader(r, "Content-Type", "audio/wav"), "the token in a header, the body a WAV");
    CHECK(readWav(r.body).has_value(), "a 16 kHz mono WAV");
    CHECK(t.voice.state() == Listener::State::working, "working while it is transcribed");
    CHECK_EQ(t.utters().size(), size_t(0));
    posts[0].done(ok(R"({"text":"Show me more like this."})"));
    t.frame();
    CHECK_EQ(t.utters().size(), size_t(1));
    if (!t.utters().empty()) {
        Json u = Json::parse(t.utters()[0]).value_or(Json());
        CHECK_EQ(u["text"].string(""), "Show me more like this.");
        CHECK(u["final"].boolean(false), "a final utterance");
        CHECK_EQ(u["scene"]["treeId"].string(""), "t1");
        CHECK_EQ(u["scene"]["focus"].string(""), "n1");
    }
    t.hear(Sound().quiet(0.2));
    CHECK(t.voice.state() == Listener::State::waiting, "listening for the name again");
}

TEST(voiceSendsNothingWhenNothingWasHeard) {
    Talking t(false);
    t.hear(Sound().quiet(1).say("command").quiet(2));
    auto posts = t.fetchesTo("/api/transcribe");
    CHECK_EQ(posts.size(), size_t(1));
    if (posts.empty()) return;
    posts[0].done(ok(R"({"text":"  "})"));
    t.frame();
    CHECK_EQ(t.utters().size(), size_t(0));
    t.hear(Sound().quiet(0.2));
    CHECK(t.voice.state() == Listener::State::waiting, "listening for the name again");
}

TEST(voiceHoldsAReplyThatArrivesWhileItRecords) {
    Talking t(true);
    t.hear(Sound().quiet(1).say("command"));
    CHECK(t.voice.state() == Listener::State::hearing, "recording the command");
    t.voice.say("Looking into that.");
    t.frame();
    CHECK_EQ(t.fetchesTo("/api/speak").size(), size_t(0));
    t.hear(Sound().quiet(2));
    auto speaks = t.fetchesTo("/api/speak");
    CHECK_EQ(speaks.size(), size_t(1));
    CHECK_EQ(t.fetchesTo("/api/transcribe").size(), size_t(1));
    auto posts = t.fetchesTo("/api/transcribe");
    if (!posts.empty()) CHECK(readWav(posts[0].request.body).value_or(std::vector<float>{}).size() < 5 * second, "the reply was not recorded into the command");
    if (speaks.empty()) return;
    CHECK_EQ(speaks[0].request.url, "http://127.0.0.1:8790/api/speak?text=Looking%20into%20that.");
    CHECK(hasHeader(speaks[0].request, "Authorization", "Bearer tok"), "the token in a header, not the address");
}

TEST(voiceHearsNothingWhileItSpeaks) {
    Talking t(true);
    t.hear(Sound().quiet(0.5));
    t.voice.say("Bringing more.");
    t.frame();
    auto speaks = t.fetchesTo("/api/speak");
    CHECK_EQ(speaks.size(), size_t(1));
    if (speaks.empty()) return;
    speaks[0].done(ok(""));
    t.frame();
    CHECK_EQ(host.plays.size(), size_t(1));
    t.hear(Sound().say("command").quiet(2));
    CHECK(t.voice.state() == Listener::State::speaking, "speaking");
    CHECK_EQ(t.fetchesTo("/api/transcribe").size(), size_t(0));
    if (host.plays.empty()) return;
    host.plays[0].done(true);
    t.hear(Sound().quiet(0.4).say("command").quiet(2));
    CHECK_EQ(t.fetchesTo("/api/transcribe").size(), size_t(1));
}

TEST(voiceSpeaksOnlyWhenTheServiceHasAVoice) {
    Talking t(false);
    t.hear(Sound().quiet(0.5));
    t.voice.say("Bringing more.");
    t.frame();
    CHECK_EQ(t.fetchesTo("/api/speak").size(), size_t(0));
    CHECK(t.voice.state() == Listener::State::waiting, "still listening");
}

TEST(voiceAnswersToTheNameTheServiceGives) {
    Talking t(false, "juno");
    CHECK_EQ(t.voice.name(), "Juno");
    t.hear(Sound().quiet(0.2).say("hey-juno").quiet(1));
    CHECK(t.voice.state() == Listener::State::hearing, "\"Hey Juno\" wakes it");
}

TEST(voiceSendsACommandSaidAWhileAfterTheChime) {
    Talking t(false);
    t.hearWithChime(Sound().quiet(1).say("hey-momo").quiet(1), [&](Sound& s) {
        s.quiet(1.5).say("also");
        CHECK_EQ(t.fetchesTo("/api/transcribe").size(), size_t(0));
        s.quiet(3);
    });
    auto posts = t.fetchesTo("/api/transcribe");
    CHECK_EQ(posts.size(), size_t(1));
    if (posts.empty()) return;
    double seconds = double(readWav(posts[0].request.body).value_or(std::vector<float>{}).size()) / second;
    CHECK(seconds > 1.5 + 1.2 + 1.0, "the command 1.5 s after the chime is in what was sent (%.1f s)", seconds);
}

TEST(voiceSendsNothingWhenOnlyItsChimeFollowsTheName) {
    Talking t(false);
    t.hearWithChime(Sound().quiet(1).say("hey-momo").quiet(1), [](Sound& s) { s.quiet(10); });
    CHECK_EQ(host.plays.size(), size_t(1));
    CHECK_EQ(t.fetchesTo("/api/transcribe").size(), size_t(0));
    CHECK(t.voice.state() == Listener::State::waiting, "listening for the name again");
}

TEST(voiceOpensTheMicrophoneAgainAfterItFails) {
    Talking t(false);
    t.hear(Sound().quiet(0.5));
    CHECK_EQ(host.opens, 1);
    host.microphone.failed("ERROR_DEAD_OBJECT");
    t.frame();
    CHECK(t.voice.state() == std::nullopt, "no sign while the microphone is down");
    t.frame(0.9);
    CHECK_EQ(host.opens, 1);
    t.frame(0.2);
    CHECK_EQ(host.opens, 2);
    host.microphone.failed("ERROR_DEAD_OBJECT");
    t.frame();
    t.frame(1.5);
    CHECK_EQ(host.opens, 2);
    t.frame(0.6);
    CHECK_EQ(host.opens, 3);
    t.hear(Sound().quiet(0.5).say("command").quiet(2));
    CHECK_EQ(t.fetchesTo("/api/transcribe").size(), size_t(1));
}

TEST(voiceStillSpeaksWhileTheMicrophoneIsDown) {
    Talking t(true);
    t.hear(Sound().quiet(0.5));
    host.microphone.failed("ERROR_DEAD_OBJECT");
    t.frame();
    t.voice.say("Bringing more.");
    t.frame();
    CHECK_EQ(t.fetchesTo("/api/speak").size(), size_t(1));
}

TEST(voiceStopsListeningWhenTheMicrophoneIsRefused) {
    Talking t(true);
    host.microphone.denied();
    t.frame();
    for (int i = 0; i < 60; i++) t.frame(1);
    CHECK_EQ(host.opens, 1);
    CHECK(t.voice.state() == std::nullopt, "no sign");
    t.voice.say("Bringing more.");
    t.frame();
    CHECK_EQ(t.fetchesTo("/api/speak").size(), size_t(1));
}

TEST(base64IsRfc4648) {
    const char* cases[][2] = {{"", ""}, {"f", "Zg=="}, {"fo", "Zm8="}, {"foo", "Zm9v"}, {"foob", "Zm9vYg=="}, {"fooba", "Zm9vYmE="}, {"foobar", "Zm9vYmFy"}};
    for (const auto& c : cases) {
        CHECK_EQ(base64Encode(c[0]), std::string(c[1]));
        CHECK_EQ(base64Decode(c[1]).value_or("?"), std::string(c[0]));
    }
    std::string every;
    for (int i = 0; i < 256; i++) every += char(i);
    CHECK(base64Decode(base64Encode(every)) == every, "every byte comes back");
    CHECK(!base64Decode("Zm9") && !base64Decode("Zm=v") && !base64Decode("Zm9v!A=="), "not base64");
}

TEST(liveSendsNothingBeforeTheName) {
    Talking t(true);
    t.goLive();
    t.hear(Sound().quiet(0.5).say("talk").quiet(0.6).say("near").quiet(2));
    CHECK_EQ(t.liveSent().size(), size_t(0));
    CHECK_EQ(t.fetchesTo("/api/transcribe").size(), size_t(0));
    t.hear(Sound().say("hey-momo").quiet(0.5));
    CHECK_EQ(t.liveSent("start").size(), size_t(1));
}

TEST(liveStreamsWhatFollowsTheNameUntilTheTurnIsOver) {
    Talking t(true);
    t.goLive();
    Sound sound = whole(Sound().quiet(1).say("command").quiet(1.5));
    std::vector<float> heard = sound.withHiss();
    t.hear(sound);
    CHECK(t.voice.state() == Listener::State::hearing, "streaming does not end on a pause");
    t.serviceSays(R"({"t":"over","turn":1})");
    auto starts = t.liveSent("start");
    CHECK_EQ(starts.size(), size_t(1));
    if (!starts.empty()) {
        CHECK_EQ(starts[0]["turn"].integer(0), 1);
        CHECK_EQ(starts[0]["scene"]["focus"].string(""), "n1");
        CHECK_EQ(starts[0]["scene"]["treeId"].string(""), "t1");
    }
    CHECK(!host.sockets[0]->sent.empty() && tOf(host.sockets[0]->sent.front()) == "start", "the start comes before any sound");
    std::vector<int16_t> sent = t.streamed();
    CHECK(!sent.empty() && sent.size() <= heard.size(), "%zu samples sent of %zu heard", sent.size(), heard.size());
    if (sent.empty() || sent.size() > heard.size()) return;
    size_t begins = heard.size() - sent.size();
    CHECK(begins <= second && begins + second * 3 / 10 >= second, "the sound sent begins %.2f s into what was heard; the name at 1.0 s",
          double(begins) / second);
    size_t wrong = 0;
    for (size_t i = 0; i < sent.size(); i++) wrong += std::abs(float(sent[i]) / 32767 - std::clamp(heard[begins + i], -1.f, 1.f)) > 2.f / 32767;
    CHECK_EQ(wrong, size_t(0));
    size_t frames = t.liveSent("audio").size();
    t.hear(Sound().quiet(1).say("more").quiet(1));
    CHECK_EQ(t.liveSent("audio").size(), frames);
    CHECK_EQ(t.liveSent().size(), frames + 1);
    CHECK(t.voice.state() == Listener::State::waiting, "listening for the name again");
    CHECK_EQ(t.fetchesTo("/api/transcribe").size(), size_t(0));
}

TEST(livePlaysMomosVoiceAsItArrives) {
    Talking t(true);
    t.askLive();
    t.serviceSays(audioFrame("r1", {1, 2, 3}));
    t.serviceSays(R"({"t":"text","id":"r1","text":"Here are three"})");
    t.serviceSays(audioFrame("r1", {4, -5}));
    t.serviceSays(audioFrame("r1", {32767, -32768}));
    t.serviceSays(R"({"t":"text","id":"r1","text":"Here are three older films."})");
    CHECK_EQ(host.players.size(), size_t(1));
    if (host.players.empty()) return;
    Player& p = *host.players[0];
    CHECK_EQ(p.rate, 24000);
    CHECK(p.written == std::vector<int16_t>({1, 2, 3, 4, -5, 32767, -32768}), "every sound written, in order (%zu samples)", p.written.size());
    CHECK_EQ(t.voice.saying(), "Here are three older films.");
    t.hear(Sound().quiet(0.2));
    CHECK(t.voice.state() == Listener::State::speaking, "speaking");
    CHECK(!p.finished, "more may come");
    t.serviceSays(R"({"t":"done","id":"r1","usage":{}})");
    CHECK(p.finished && !p.stopped, "finished, to play out what is queued");
    p.done(true);
    t.frame();
    CHECK_EQ(t.voice.saying(), "");
    t.hear(Sound().quiet(0.2));
    CHECK(t.voice.state() == Listener::State::speaking, "200 ms after, its echo may still be in the room");
    t.hear(Sound().quiet(0.1));
    CHECK(t.voice.state() == Listener::State::waiting, "listening for the name again");
    CHECK_EQ(host.players.size(), size_t(1));
}

TEST(liveNameStopsMomoUnlessMomoIsSayingItsName) {
    for (bool namesItself : {false, true}) {
        Talking t(true);
        t.askLive();
        t.serviceSays(audioFrame("r1", std::vector<int16_t>(4800, 100)));
        t.serviceSays(namesItself ? R"({"t":"text","id":"r1","text":"Momo here. I found"})" : R"({"t":"text","id":"r1","text":"I found three"})");
        CHECK_EQ(host.players.size(), size_t(1));
        if (host.players.empty()) continue;
        t.hear(Sound().quiet(0.5).say("hey-momo").quiet(1));
        auto starts = t.liveSent("start");
        if (namesItself) {
            CHECK_EQ(starts.size(), size_t(1));
            CHECK(!host.players[0]->stopped, "Momo saying its own name does not stop it");
            continue;
        }
        CHECK_EQ(starts.size(), size_t(2));
        if (starts.size() == 2) CHECK_EQ(starts[1]["turn"].integer(0), 2);
        CHECK(host.players[0]->stopped, "the player stopped at once");
        CHECK_EQ(t.voice.saying(), "");
        host.players[0]->done(false);
        t.serviceSays(audioFrame("r1", {7, 7}));
        CHECK_EQ(host.players[0]->written.size(), size_t(4800));
        CHECK_EQ(host.players.size(), size_t(1));
        CHECK(t.voice.state() == Listener::State::hearing, "streaming turn 2");
    }
}

TEST(liveDropsMomosVoiceWhileTheUserIsHeardAndStopsOnFailure) {
    Talking t(true);
    t.goLive();
    t.hear(Sound().quiet(1).say("command"));
    CHECK(t.voice.state() == Listener::State::hearing, "streaming");
    t.serviceSays(audioFrame("r0", {1, 2, 3}));
    t.serviceSays(R"({"t":"text","id":"r0","text":"An older answer"})");
    t.serviceSays(R"({"t":"done","id":"r0"})");
    CHECK_EQ(host.players.size(), size_t(0));
    CHECK_EQ(t.voice.saying(), "");
    size_t frames = t.liveSent("audio").size();
    CHECK(frames > 0, "the command streams");
    t.serviceSays(R"({"t":"failed","why":"the realtime session closed"})");
    t.hear(Sound().quiet(1).say("more").quiet(1));
    CHECK_EQ(t.liveSent("audio").size(), frames);
    CHECK(t.voice.state() == Listener::State::waiting, "listening for the name again");
}

TEST(livePlaysAnAnnouncement) {
    Talking t(true);
    t.goLive();
    t.hear(Sound().quiet(0.5));
    t.serviceSays(audioFrame("a1", {9, 8, 7}));
    CHECK_EQ(host.players.size(), size_t(1));
    if (host.players.empty()) return;
    CHECK(host.players[0]->written == std::vector<int16_t>({9, 8, 7}), "written");
    t.hear(Sound().quiet(0.1));
    CHECK(t.voice.state() == Listener::State::speaking, "speaking");
}

TEST(liveCancelsATurnWithNothingSaid) {
    Talking t(true);
    t.goLive();
    t.hear(Sound().quiet(1).say("hey-momo").quiet(9));
    CHECK_EQ(t.liveSent("start").size(), size_t(1));
    CHECK_EQ(t.liveSent("cancel").size(), size_t(1));
    size_t frames = t.liveSent("audio").size();
    t.hear(Sound().quiet(0.5));
    CHECK_EQ(t.liveSent("audio").size(), frames);
}

TEST(liveOffUsesTheOldPath) {
    Talking t(true);
    t.frame();
    CHECK_EQ(host.sockets.size(), size_t(1));
    if (host.sockets.empty()) return;
    host.sockets[0]->events.closed("status 404");
    t.frame();
    t.frame(4.9);
    CHECK_EQ(host.sockets.size(), size_t(1));
    t.frame(0.2);
    CHECK_EQ(host.sockets.size(), size_t(2));
    t.hear(Sound().quiet(0.5).say("command").quiet(2));
    CHECK_EQ(t.fetchesTo("/api/transcribe").size(), size_t(1));
    t.voice.say("Bringing more.");
    t.frame();
    CHECK_EQ(t.fetchesTo("/api/speak").size(), size_t(1));
    CHECK_EQ(t.liveSent().size(), size_t(0));
}

TEST(liveReadyLeavesSayingToTheService) {
    Talking t(true);
    t.goLive();
    t.voice.say("Bringing more.");
    t.frame();
    CHECK_EQ(t.fetchesTo("/api/speak").size(), size_t(0));
    host.sockets[0]->events.closed("the service went away");
    t.frame();
    t.hear(Sound().quiet(0.5).say("command").quiet(2));
    CHECK_EQ(t.fetchesTo("/api/transcribe").size(), size_t(1));
    t.voice.say("Bringing more.");
    t.frame();
    CHECK_EQ(t.fetchesTo("/api/speak").size(), size_t(1));
}

TEST(liveListensAgainOnceAReplyPlaysOutUnderAWordlessOne) {
    Talking t(true);
    t.askLive();
    t.serviceSays(audioFrame("r1", {1, 2, 3}));
    t.serviceSays(R"({"t":"done","id":"r1"})");
    t.serviceSays(R"({"t":"text","id":"r2","text":"Anything else?"})");
    t.serviceSays(R"({"t":"done","id":"r2"})");
    CHECK_EQ(host.players.size(), size_t(1));
    if (host.players.empty()) return;
    CHECK(host.players[0]->finished, "the first reply was finished");
    t.hear(Sound().quiet(0.2));
    CHECK(t.voice.state() == Listener::State::speaking, "the first reply still plays");
    host.players[0]->done(true);
    t.frame();
    t.hear(Sound().quiet(0.4));
    CHECK(t.voice.state() == Listener::State::waiting, "listening for the name again once it has played");
}

TEST(liveSaysTwoRepliesOneAfterTheOther) {
    Talking t(true);
    t.askLive();
    t.serviceSays(audioFrame("r1", {1, 2, 3}));
    t.serviceSays(R"({"t":"done","id":"r1"})");
    t.serviceSays(audioFrame("r2", {4, 5}));
    t.serviceSays(audioFrame("r2", {6}));
    t.serviceSays(R"({"t":"done","id":"r2"})");
    CHECK_EQ(host.players.size(), size_t(1));
    if (host.players.empty()) return;
    CHECK(host.players[0]->written == std::vector<int16_t>({1, 2, 3}), "the second reply waits while the first plays out");
    host.players[0]->done(true);
    t.frame();
    CHECK_EQ(host.players.size(), size_t(2));
    if (host.players.size() < 2) return;
    CHECK(host.players[1]->written == std::vector<int16_t>({4, 5, 6}), "then it plays, all of it");
    CHECK(host.players[1]->finished, "and ends, as all of it had come");
    CHECK(t.voice.state() == Listener::State::speaking, "Momo is still speaking between the two");
}
