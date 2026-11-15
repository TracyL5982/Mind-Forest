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

/// What the voice asked of the host.
struct Host {
    std::vector<Fetch> fetches;
    std::vector<Play> plays;
    platform::MicrophoneEvents microphone;
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

/// A voice on a live connection to the scripted session, in the tree "t1" with the card "n1" open.
struct Talking {
    std::shared_ptr<Transport> transport = std::make_shared<Transport>();
    Client client{*Address::parse("127.0.0.1:8790", "tok"), transport};
    Voice voice{client, [] { return Scene{NodeId{"n1"}, {}, TreeId{"t1"}}; }, std::nullopt};

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
            voice.frame();
        }
    }
    std::vector<std::string> utters() const {
        std::vector<std::string> out;
        for (const std::string& t : transport->socket->sent) {
            if (tOf(t) == "utter") out.push_back(t);
        }
        return out;
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
MicrophoneRef openMicrophone(MicrophoneEvents events) {
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
    t.voice.frame();
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
    t.voice.frame();
    CHECK_EQ(t.utters().size(), size_t(0));
    t.hear(Sound().quiet(0.2));
    CHECK(t.voice.state() == Listener::State::waiting, "listening for the name again");
}

TEST(voiceHoldsAReplyThatArrivesWhileItRecords) {
    Talking t(true);
    t.hear(Sound().quiet(1).say("command"));
    CHECK(t.voice.state() == Listener::State::hearing, "recording the command");
    t.voice.say("Looking into that.");
    t.voice.frame();
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
    auto speaks = t.fetchesTo("/api/speak");
    CHECK_EQ(speaks.size(), size_t(1));
    if (speaks.empty()) return;
    speaks[0].done(ok(""));
    t.voice.frame();
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
    t.voice.frame();
    CHECK_EQ(t.fetchesTo("/api/speak").size(), size_t(0));
    CHECK(t.voice.state() == Listener::State::waiting, "still listening");
}

TEST(voiceAnswersToTheNameTheServiceGives) {
    Talking t(false, "juno");
    CHECK_EQ(t.voice.name(), "Juno");
    t.hear(Sound().quiet(0.2).say("hey-juno").quiet(1));
    CHECK(t.voice.state() == Listener::State::hearing, "\"Hey Juno\" wakes it");
}
