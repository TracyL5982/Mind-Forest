// The voice between the listener and the service: what it sends, and when it speaks. The host's network, sound and
// microphone are fakes that record what they are asked; the listener is the real one on spoken clips.
#include "sound.h"

#include <cstdlib>

#include "../../async.h"
#include "../../audio.h"
#include "../voice.h"

using namespace agent;
using namespace check;

namespace {

struct Fetch {
    platform::Request request;
    std::function<void(platform::Response)> done;
};
struct Silent : platform::Sound {
    bool stopped = false;
    void stop() override { stopped = true; }
};
struct Play {
    std::string path;
    std::function<void(bool)> done;
    std::shared_ptr<Silent> sound;
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
    /// The app is in front again, until the voice is told.
    bool resumed = false;
    /// As the Mac preview's microphone, which hears the chime; false is the headset's, which does not.
    bool hearsOwnSounds = true;
    /// The mixer's: the sounds played, by name, in order, and the level each loop was last asked for.
    std::vector<std::string> sounds;
    std::map<std::string, float> levels;
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

/// How a test's voice is made: what the service's hello says, and whether `-mute` is on.
struct Made {
    bool serviceSpeaks = true;
    std::string name = "momo";
    bool live = true;
    bool muted = false;
};

/// A voice on a live connection to the scripted session, in the tree "t1" with the card "n1" open.
struct Talking {
    std::shared_ptr<Transport> transport = std::make_shared<Transport>();
    Client client{*Address::parse("127.0.0.1:8790", "tok"), transport};
    Voice voice;
    double now = 0;

    explicit Talking(Made made) : voice(client, [] { return Scene{NodeId{"n1"}, {}, TreeId{"t1"}}; }, std::nullopt, made.muted) {
        host = Host{};
        client.tick(100);
        transport->socket->events.opened();
        transport->socket->events.text(sessionTexts().front());
        client.drain();
        Settings settings;
        settings.agentName = made.name;
        voice.joined(settings, made.serviceSpeaks, made.live);
    }
    explicit Talking(bool serviceSpeaks, const std::string& name = "momo") : Talking(Made{serviceSpeaks, name}) {}
    /// The microphone hears the sound, a tenth of a second at a time, and the frame thread runs after each, then `each`.
    void hear(const Sound& sound, const std::function<void()>& each = nullptr) {
        std::vector<float> s = sound.withHiss();
        for (size_t at = 0; at < s.size(); at += Listener::pieceLength) {
            host.microphone.heard(s.data() + at, std::min(size_t(Listener::pieceLength), s.size() - at));
            frame(0.1);
            if (each) each();
        }
    }
    Presence::State shows() const { return voice.presence().state; }
    /// The voice's own sounds, by name, in the order played.
    std::vector<std::string> played() const { return host.sounds; }
    /// Whether the thinking loop sounds.
    bool looping() const { return host.levels.count("momo_thinking") && host.levels.at("momo_thinking") > 0; }
    void frame(double seconds = 0) {
        now += seconds;
        voice.frame(now);
    }
    /// As `hear`, with the chime the voice plays heard back through the microphone, as on the headset. `after` is what
    /// is said once it has played.
    void hearWithChime(const Sound& before, std::function<void(Sound&)> after) {
        std::vector<float> s = before.withHiss();
        std::vector<float> ring = ownSound("momo_chime");
        size_t chimeEnds = 0;
        bool chimed = false;
        for (size_t at = 0;; at += Listener::pieceLength) {
            if (chimed && at >= chimeEnds) {
                chimed = false;
                Sound rest;
                after(rest);
                std::vector<float> more = rest.withHiss();
                s.resize(std::max(s.size(), at + more.size()), 0.f);
                for (size_t i = 0; i < more.size(); i++) s[at + i] += more[i];
            }
            if (at + Listener::pieceLength > s.size()) break;
            size_t sounds = host.sounds.size();
            host.microphone.heard(s.data() + at, Listener::pieceLength);
            frame(0.1);
            if (host.sounds.size() > sounds && host.sounds.back() == "momo_chime") {
                chimed = true;
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

namespace audio {
bool on() { return true; }
void play(const std::string& name, float, double, float) { host.sounds.push_back(name); }
void level(const std::string& name, float level, float) { host.levels[name] = level; }
double seconds(const std::string& name) { return name == "momo_chime" ? 0.28 : 0; }
}  // namespace audio

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
    auto sound = std::make_shared<Silent>();
    host.plays.push_back({path, std::move(done), sound});
    return sound;
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
bool microphoneHearsOwnSounds() { return host.hearsOwnSounds; }
bool resumed() { return std::exchange(host.resumed, false); }
MicrophoneRef openMicrophone(MicrophoneEvents events) {
    host.opens++;
    host.microphone = std::move(events);
    return std::make_shared<Quiet>();
}

}  // namespace platform

/// When set, work handed to Async waits here until the test runs it, as when the listener's model is slow to load.
std::vector<std::function<void()>>* asyncHeld = nullptr;

namespace Async {
void run(std::function<void()> work, std::function<void()> then) {
    auto both = [work = std::move(work), then = std::move(then)] {
        work();
        if (then) then();
    };
    if (asyncHeld) asyncHeld->push_back(both);
    else both();
}
}  // namespace Async

TEST(voiceSendsWhatFollowsTheNameAsAnUtter) {
    Talking t(false);
    CHECK(t.voice.state() == std::nullopt, "no sign until sound comes");
    t.hear(Sound().quiet(1).say("command").quiet(2));
    CHECK(t.played() == std::vector<std::string>({"momo_chime", "momo_sent"}) && t.looping(),
          "a chime on the name, the sent tone as the recording ends, then the thinking loop");
    CHECK(t.shows() == Presence::State::thinking, "thinking");
    auto posts = t.fetchesTo("/api/transcribe");
    CHECK_EQ(posts.size(), size_t(1));
    if (posts.empty()) return;
    const platform::Request& r = posts[0].request;
    CHECK_EQ(r.method, "POST");
    CHECK_EQ(r.url, "http://127.0.0.1:8790/api/transcribe?woke=1&tree=t1");
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
    CHECK_EQ(t.voice.presence().userText, "Show me more like this.");
    t.hear(Sound().quiet(0.2));
    CHECK(t.voice.state() == Listener::State::waiting, "listening for the name again");
    CHECK(t.shows() == Presence::State::thinking, "thinking until the reply is heard");
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
    CHECK(t.played() == std::vector<std::string>({"momo_chime"}), "the chime");
    CHECK_EQ(t.fetchesTo("/api/transcribe").size(), size_t(0));
    CHECK(t.voice.state() == Listener::State::waiting, "listening for the name again");
}

// On the headset the microphone does not hear the chime (`-chimeCheck`, agents/DECISIONS.md 71), so the listener is not
// made deaf while it plays, and a short word said just after the name is kept. Where the microphone does hear it, as in
// the Mac preview, the word is lost in the chime, the price of not taking the chime itself for words: "more" after a
// pause of 0.5 to 0.9 s, which is when the chime plays.
TEST(voiceKeepsAShortWordSaidAsTheChimePlaysWhereTheMicrophoneDoesNotHearIt) {
    for (bool hears : {false, true}) {
        Talking t(false);
        host.hearsOwnSounds = hears;
        t.hear(Sound().quiet(1).say("hey-momo").quiet(0.6).say("more").quiet(9));
        CHECK(t.played().size() >= 1 && t.played()[0] == "momo_chime", "the chime plays either way");
        CHECK_EQ(t.fetchesTo("/api/transcribe").size(), size_t(hears ? 0 : 1));
    }
}

TEST(liveBeginsATurnOnAShortWordSaidAsTheChimePlaysWhereTheMicrophoneDoesNotHearIt) {
    for (bool hears : {false, true}) {
        Talking t(true);
        host.hearsOwnSounds = hears;
        t.goLive();
        t.hear(Sound().quiet(1).say("hey-momo").quiet(0.6).say("more").quiet(1.5));
        CHECK_EQ(t.liveSent("start").size(), size_t(hears ? 0 : 1));
    }
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

TEST(voiceOpensTheMicrophoneAgainAsSoonAsTheAppIsInFront) {
    Talking t(false);
    t.hear(Sound().quiet(0.5));
    CHECK_EQ(host.opens, 1);
    // Started while the headset is not worn: the system will not let it record, so each try fails and the waits grow.
    host.microphone.failed("AudioRecord did not start recording");
    t.frame();
    t.frame(1.1);
    CHECK_EQ(host.opens, 2);
    host.microphone.failed("AudioRecord did not start recording");
    t.frame();
    t.frame(0.5);
    CHECK_EQ(host.opens, 2);
    host.resumed = true;
    t.frame(0.1);
    CHECK_EQ(host.opens, 3);
    t.hear(Sound().quiet(0.5).say("command").quiet(2));
    CHECK_EQ(t.fetchesTo("/api/transcribe").size(), size_t(1));
    host.resumed = true;
    t.frame();
    CHECK_EQ(host.opens, 3);
    host.microphone.failed("AudioRecord stopped recording");
    t.frame();
    t.frame(1.1);
    CHECK_EQ(host.opens, 4);
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

TEST(theMicrophonesReasonShowsWhileTheUserIsAsked) {
    Talking t(true);
    CHECK(t.voice.presence().notice.empty(), "nothing to say before the headset asks");
    host.microphone.asking();
    t.frame();
    CHECK_EQ(t.voice.presence().notice, std::string("Allow the microphone to talk to Momo"));
    t.hear(Sound().quiet(0.3));
    CHECK(t.voice.presence().notice.empty(), "allowed, sound comes and the line goes");
}

TEST(aRefusedMicrophoneSaysHowToAskMomoWithoutIt) {
    Talking t(true);
    host.microphone.asking();
    t.frame();
    host.microphone.denied();
    t.frame();
    CHECK_EQ(t.voice.presence().notice, std::string("No microphone, so type or pick to ask Momo"));
    t.frame(Voice::refusalShown + 0.1);
    CHECK(t.voice.presence().notice.empty(), "it goes after %g s", Voice::refusalShown);
    t.voice.asked("What else did Vermeer paint?");
    t.frame();
    CHECK(t.shows() == Presence::State::sent, "a question picked or typed is still sent and thought about");
    t.voice.say("He painted few.");
    t.frame();
    CHECK_EQ(t.fetchesTo("/api/speak").size(), size_t(1));
}

TEST(momoSaysWhileTheServiceCantBeReached) {
    Talking t(true);
    t.frame();
    CHECK(t.voice.presence().notice.empty(), "joined, nothing to say");
    t.transport->socket->events.closed("the service restarted");
    t.client.drain();
    t.frame();
    CHECK_EQ(t.voice.presence().notice, std::string("Can’t reach Momo, retrying"));
    t.client.tick(100 + Client::retryDelays[0]);
    t.transport->socket->events.opened();
    t.transport->socket->events.text(sessionTexts().front());
    t.client.drain();
    t.frame();
    CHECK(t.voice.presence().notice.empty(), "back, the line goes");
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
    t.hear(Sound().say("hey-momo").quiet(2.5));
    CHECK_EQ(t.liveSent("name").size(), size_t(1));
    CHECK_EQ(t.liveSent().size(), size_t(1));
    CHECK(t.voice.state() == Listener::State::open, "the name alone opens the conversation and sends only its own sound, to be checked");
    t.hear(Sound().say("more").quiet(0.5));
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
    CHECK(host.sockets[0]->sent.size() > 1 && tOf(host.sockets[0]->sent[0]) == "name" && tOf(host.sockets[0]->sent[1]) == "start",
          "the sound of the wake goes first, to be checked, and the start comes before any sound of the turn");
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
    t.hear(Sound().quiet(1));
    CHECK_EQ(t.liveSent().size(), frames + 2);
    CHECK(t.voice.state() == Listener::State::open, "the conversation stays open, and nothing goes out while nobody talks");
    t.hear(Sound().say("more").quiet(1));
    auto again = t.liveSent("start");
    CHECK_EQ(again.size(), size_t(2));
    if (again.size() == 2) CHECK_EQ(again[1]["turn"].integer(0), 2);
    CHECK(t.liveSent("audio").size() > frames, "the next words stream without the name");
    CHECK_EQ(t.fetchesTo("/api/transcribe").size(), size_t(0));
}

// The spotter also wakes on what only sounds like the name, so the service checks the sound of each wake
// (agents/DECISIONS.md 70).
TEST(liveSendsTheSoundOfAWakeToBeChecked) {
    Talking t(true);
    t.goLive();
    Sound sound = Sound().quiet(1).say("hey-momo").quiet(1);
    t.hear(sound);
    auto names = t.liveSent("name");
    CHECK_EQ(names.size(), size_t(1));
    CHECK_EQ(t.liveSent().size(), size_t(1));
    if (names.empty()) return;
    std::string bytes = base64Decode(names[0]["pcm"].string("")).value_or("");
    double seconds = double(bytes.size()) / 2 / second;
    CHECK(seconds >= 0.5 && seconds <= 2, "%.2f s of sound: the name, and no more than was heard since a moment before it", seconds);
    CHECK(t.voice.state() == Listener::State::open, "the conversation opens at once, without waiting for the check");
    t.serviceSays(R"({"t":"name","ok":true})");
    CHECK(t.voice.state() == Listener::State::open, "and stays open when it was the name");
}

TEST(liveClosesWhatAWakeOpenedWhenTheServiceSaysItWasNotTheName) {
    Talking t(true);
    t.goLive();
    t.hear(Sound().quiet(1).say("hey-momo").quiet(1));
    t.serviceSays(R"({"t":"name","ok":false})");
    t.hear(Sound().quiet(0.2));
    CHECK(t.voice.state() == Listener::State::waiting, "it waits for its name again");
    CHECK(t.shows() == Presence::State::waiting, "and shows that it does");
    t.hear(Sound().say("also").quiet(1));
    CHECK_EQ(t.liveSent("start").size(), size_t(0));

    // Said while a turn streams, the turn stops going out.
    t.hear(whole(Sound().quiet(1).say("command")));
    CHECK_EQ(t.liveSent("start").size(), size_t(1));
    CHECK(t.voice.state() == Listener::State::hearing, "a turn streams");
    size_t frames = t.liveSent("audio").size();
    t.serviceSays(R"({"t":"name","ok":false})");
    t.hear(Sound().say("also").quiet(1));
    CHECK_EQ(t.liveSent("audio").size(), frames);
    CHECK(t.voice.state() == Listener::State::waiting, "it waits for its name again");
    CHECK(t.shows() == Presence::State::waiting, "and shows that it does");
    CHECK_EQ(t.fetchesTo("/api/transcribe").size(), size_t(0));
}

TEST(voiceMakesNothingOfARecordingTheServiceFindsNoNameIn) {
    Talking t(false);
    t.hear(Sound().quiet(1).say("command").quiet(2));
    auto posts = t.fetchesTo("/api/transcribe");
    CHECK_EQ(posts.size(), size_t(1));
    if (posts.empty()) return;
    CHECK(posts[0].request.url.find("woke=1") != std::string::npos, "the service is told a wake began the recording (%s)", posts[0].request.url.c_str());
    posts[0].done(ok(R"({"text":"","named":false})"));
    t.frame();
    CHECK_EQ(t.utters().size(), size_t(0));
    t.hear(Sound().quiet(0.6));
    CHECK(t.voice.state() == Listener::State::waiting, "listening for the name again");
    CHECK(t.shows() != Presence::State::thinking, "and Momo does not think about it");
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
    CHECK(t.shows() == Presence::State::responding, "speaking");
    CHECK(t.voice.state() == Listener::State::open, "with the conversation open");
    CHECK(!p.finished, "more may come");
    t.serviceSays(R"({"t":"done","id":"r1","usage":{}})");
    CHECK(p.finished && !p.stopped, "finished, to play out what is queued");
    p.done(true);
    t.frame();
    CHECK_EQ(t.voice.saying(), "");
    t.hear(Sound().quiet(0.3));
    CHECK(t.voice.state() == Listener::State::open && t.shows() == Presence::State::waiting, "then Momo hears the user without its name, and shows idle");
    CHECK_EQ(host.players.size(), size_t(1));
}

TEST(liveTalkingOverMomoStopsItAndStartsATurn) {
    Talking t(true);
    t.askLive();
    t.serviceSays(audioFrame("r1", std::vector<int16_t>(4800, 100)));
    t.serviceSays(R"({"t":"text","id":"r1","text":"Momo here. I found"})");
    CHECK_EQ(host.players.size(), size_t(1));
    if (host.players.empty()) return;
    size_t frames = t.liveSent().size();
    Sound sound;
    sound.quiet(0.5);
    double word = double(sound.size()) / second;
    sound.say("more").quiet(1);
    std::optional<double> stopped;
    double heard = 0;
    t.hear(sound, [&] {
        heard += 0.1;
        if (!stopped && host.players[0]->stopped) stopped = heard;
    });
    auto starts = t.liveSent("start");
    CHECK_EQ(starts.size(), size_t(2));
    if (starts.size() == 2) CHECK_EQ(starts[1]["turn"].integer(0), 2);
    std::vector<Json> sent = t.liveSent();
    std::vector<Json> after(sent.begin() + long(std::min(frames, sent.size())), sent.end());
    CHECK(!after.empty() && after.front()["t"].string("") == "start", "the start comes before the words that cut Momo off");
    CHECK(stopped.has_value(), "the player stopped");
    if (stopped) CHECK(*stopped - word <= 0.45, "Momo stopped %.2f s into the word", *stopped - word);
    CHECK_EQ(t.voice.saying(), "");
    host.players[0]->done(false);
    t.serviceSays(audioFrame("r1", {7, 7}));
    CHECK_EQ(host.players[0]->written.size(), size_t(4800));
    CHECK_EQ(host.players.size(), size_t(1));
    CHECK(t.voice.state() == Listener::State::hearing, "streaming turn 2");
    CHECK(t.shows() == Presence::State::listening, "listening to it");
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
    t.hear(Sound().quiet(1));
    CHECK_EQ(t.liveSent("audio").size(), frames);
    CHECK(t.voice.state() == Listener::State::open, "the conversation stays open");
    t.hear(Sound().say("more").quiet(1));
    CHECK_EQ(t.liveSent("start").size(), size_t(2));
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
    CHECK(t.shows() == Presence::State::responding, "speaking");
    CHECK(t.voice.state() == Listener::State::open, "Momo's voice opens the conversation");
}

TEST(liveClosesTheConversationAfterEightSecondsOfQuiet) {
    using S = Presence::State;
    Talking t(true);
    t.goLive();
    double heard = 0;
    std::optional<double> woke, closed;
    t.hear(Sound().quiet(1).say("hey-momo").quiet(10), [&] {
        heard += 0.1;
        if (!woke && t.shows() == S::listening) woke = heard;
        if (woke && !closed && t.shows() == S::listening) CHECK(t.voice.presence().conversing(), "the ocean draws back while Momo listens");
        if (woke && !closed && t.shows() != S::listening) closed = heard;
    });
    CHECK(woke && closed, "listening after the name, then not");
    CHECK(!t.voice.presence().conversing(), "the ocean's sounds come back once the conversation is over");
    if (woke && closed) CHECK(*closed - *woke >= 7.95 && *closed - *woke <= 8.4, "for %.2f s", *closed - *woke);
    CHECK(t.shows() == S::waiting, "waiting for the name again once nobody has talked for 8 s");
    CHECK(t.voice.state() == Listener::State::waiting, "the listener too");
    CHECK_EQ(t.liveSent().size(), t.liveSent("name").size());
    t.hear(Sound().say("more").quiet(1));
    CHECK_EQ(t.liveSent().size(), t.liveSent("name").size());
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

TEST(liveThinkingKeepsTheConversationOpen) {
    Talking t(true);
    t.askLive();
    t.frame(0.5);
    CHECK(t.shows() == Presence::State::thinking, "thinking");
    t.hear(Sound().quiet(12));
    CHECK(t.voice.state() == Listener::State::open, "the conversation stays open while Momo thinks, 12 s on");
    t.hear(Sound().say("more").quiet(1));
    CHECK_EQ(t.liveSent("start").size(), size_t(2));
    t.serviceSays(R"({"t":"over","turn":2})");
    t.frame(0.5);
    t.serviceSays(R"({"t":"quiet","turn":2})");
    CHECK(t.voice.state() == Listener::State::open && t.shows() == Presence::State::waiting, "no answer is coming: open, showing idle");
    t.hear(Sound().quiet(8.5));
    CHECK(t.voice.state() == Listener::State::waiting, "then the 8 s count runs, and the conversation closes");
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
    t.hear(Sound().quiet(9));
    CHECK(t.voice.state() == Listener::State::open, "the conversation stays open while the first reply plays");
    host.players[0]->done(true);
    t.frame();
    t.hear(Sound().quiet(8.5));
    CHECK(t.voice.state() == Listener::State::waiting, "and closes 8 s after it has played, not held by the wordless one");
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
    CHECK(t.shows() == Presence::State::responding, "Momo is still speaking between the two");
}

TEST(liveStreamsWhenReadyBeforeTheListenerHasLoaded) {
    std::vector<std::function<void()>> held;
    asyncHeld = &held;
    Talking t(true);
    asyncHeld = nullptr;
    t.goLive();
    for (auto& run : held) run();
    t.hear(whole(Sound().quiet(1).say("command").quiet(1.5)));
    CHECK_EQ(t.liveSent("start").size(), size_t(1));
    CHECK_EQ(t.fetchesTo("/api/transcribe").size(), size_t(0));
}

namespace {

Activity started(const std::string& id, const std::string& message, std::optional<std::string> label = std::nullopt) {
    return Activity{.id = id, .role = "scout", .state = Activity::State::start, .message = message, .nodeId = std::nullopt, .label = label};
}
Activity ended(const std::string& id) { return Activity{.id = id, .role = "scout", .state = Activity::State::done, .message = "", .nodeId = std::nullopt, .label = std::nullopt}; }

/// A second of Momo's voice, loud as speech.
std::vector<int16_t> aSecondOfVoice() {
    std::vector<int16_t> out(24000);
    for (size_t i = 0; i < out.size(); i++) out[i] = int16_t(6000 * std::sin(2 * M_PI * 220 * double(i) / 24000));
    return out;
}

}  // namespace

TEST(presenceFollowsALiveTurn) {
    using S = Presence::State;
    Talking t(true);
    t.goLive();
    float loudest = 0;
    std::vector<S> seen;
    t.hear(whole(Sound().quiet(1).say("command").quiet(1.5)), [&] {
        if (seen.empty() || seen.back() != t.shows()) seen.push_back(t.shows());
        if (t.shows() == S::listening) loudest = std::max(loudest, t.voice.presence().level);
    });
    CHECK(seen == std::vector<S>({S::waiting, S::listening}), "waiting, then listening from the name (%zu states)", seen.size());
    CHECK(loudest >= 0.5f && loudest <= 1, "the level follows the voice heard (%.2f at its loudest)", loudest);
    CHECK(t.played() == std::vector<std::string>({"momo_chime"}), "only the chime while the user speaks");
    t.serviceSays(R"({"t":"over","turn":1})");
    CHECK(t.shows() == S::sent, "sent as the turn is over");
    CHECK(t.played() == std::vector<std::string>({"momo_chime", "momo_sent"}), "with the sent tone");
    CHECK_EQ(t.voice.presence().userText, "");
    t.serviceSays(R"({"t":"heard","turn":1,"text":"Show me more","final":false})");
    CHECK_EQ(t.voice.presence().userText, "Show me more");
    CHECK(!t.voice.presence().userFinal, "partial words");
    t.serviceSays(R"({"t":"heard","turn":1,"text":"Show me more like this.","final":true})");
    CHECK_EQ(t.voice.presence().userText, "Show me more like this.");
    CHECK(t.voice.presence().userFinal, "the final words");
    t.frame(0.3);
    CHECK(t.shows() == S::sent, "sent for 0.4 s");
    CHECK(!t.looping(), "no loop yet");
    t.frame(0.15);
    CHECK(t.shows() == S::thinking, "then thinking");
    CHECK(t.looping(), "the loop as the sent tone ends");
    t.voice.activity(started("a1", "Looking for films with a slow dolly zoom in them"));
    t.frame(0.1);
    CHECK(t.shows() == S::thinking, "a spoken turn thinks on while work starts, until Momo answers");
    t.serviceSays(audioFrame("r1", aSecondOfVoice()));
    CHECK(t.shows() == S::responding, "responding at the first sound of the reply");
    CHECK(t.voice.presence().searching(), "and the Scout is still at work while Momo speaks: the monocle stays on");
    CHECK(!t.looping(), "the loop stops at once");
    t.serviceSays(R"({"t":"text","id":"r1","text":"Here are three older films with one."})");
    t.frame(0.5);
    std::string half = t.voice.presence().momoText;
    CHECK(!half.empty() && half.size() < std::string("Here are three older films with one.").size(), "Momo's words come as they are heard: \"%s\"", half.c_str());
    CHECK(std::fabs(t.voice.presence().level - levelOf(6000 / 32768.f / std::sqrt(2.f))) < 0.02f,
          "the level follows Momo's voice, as AgentSphere's does: its RMS three times over (%.2f)", t.voice.presence().level);
    t.serviceSays(R"({"t":"done","id":"r1"})");
    t.frame(0.6);
    CHECK(!host.players.empty() && host.players[0]->finished, "finished");
    host.players[0]->done(true);
    t.frame();
    CHECK(t.voice.state() == Listener::State::open, "open once Momo is done, while the work goes on: Momo hears the user without its name");
    CHECK(t.shows() == S::working, "and, nobody speaking, Momo shows the work, not listening");
    CHECK_EQ(t.voice.presence().momoText, "");
    CHECK(t.voice.presence().agents == std::vector<AgentLine>({{"scout", "Scout", "Looking for films with a slow…", false}}), "the Scout's line");
    t.voice.activity(started("a2", "Reading three articles about it", "Reading 3 articles"));
    t.frame(1);
    CHECK(t.voice.presence().agents == std::vector<AgentLine>({{"scout", "Scout", "Reading 3 articles", false}}), "its newest step");
    size_t plays = host.sounds.size(), players = host.players.size();
    t.frame(5);
    CHECK_EQ(host.sounds.size(), plays);
    CHECK_EQ(host.players.size(), players);
    t.voice.activity(ended("a2"));
    t.voice.activity(ended("a1"));
    t.frame();
    CHECK(t.voice.state() == Listener::State::open && t.shows() == S::waiting, "still open once the work is done, and Momo shows idle");
    CHECK(t.voice.presence().agents == std::vector<AgentLine>({{"scout", "Scout", "", true}}), "the Scout finished working");
    t.frame(Crew::finishedFor);
    CHECK(t.voice.presence().agents.empty(), "and its line gone 3 s later");
    t.hear(Sound().quiet(8.5));
    CHECK(t.shows() == S::waiting, "waiting once nobody has talked for 8 s");
    CHECK_EQ(host.sounds.size(), plays);
    t.serviceSays(R"({"t":"text","id":"r2","text":"I found two more.","kind":"results"})");
    CHECK_EQ(t.voice.presence().userText, "");
}

TEST(presenceRevealsWordsWithoutSpacesAWholeCharacterAtATime) {
    Talking t(true);
    t.askLive();
    const std::string said = "我在找更多关于老地图的东西。";
    t.serviceSays(audioFrame("r1", aSecondOfVoice()));
    t.serviceSays(Json::object().set("t", "text").set("id", "r1").set("text", said).dump());
    t.frame(0.5);
    std::string half = t.voice.presence().momoText;
    CHECK(!half.empty() && half.size() < said.size(), "some of it, not all: \"%s\"", half.c_str());
    CHECK(said.compare(0, half.size(), half) == 0 && (uint8_t(said[half.size()]) & 0xC0) != 0x80, "a prefix that ends on a whole character");
}

namespace {

/// A demo take's line as the service sends it: its words once, whole, with the recording's length and where its sound
/// starts; then the sound a tenth of a second at a time, kept a quarter of a second ahead of its playing, for `seconds`.
std::string playRecordedLine(Talking& t, const std::string& id, const std::string& said, double ms, double from, double seconds) {
    t.serviceSays(Json::object().set("t", "text").set("id", id).set("text", said).set("kind", "results").set("ms", ms).set("from", from).dump());
    std::vector<int16_t> tenth(2400, 3000);
    double sent = 0, at = 0;
    while (at < seconds - 1e-9) {
        while (sent < at + 0.25) {
            t.serviceSays(audioFrame(id, tenth));
            sent += 0.1;
        }
        t.frame(1.0 / 90);
        at += 1.0 / 90;
    }
    return t.voice.presence().momoText;
}

/// How many characters of `said` are `share` of it.
double charactersOf(const std::string& said, double share) { return share * double(said.size()); }

}  // namespace

TEST(aRecordedLinesWordsShowByHowFarIntoItHerVoiceIsALittleAhead) {
    const std::string said = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen "
                             "eighteen nineteen twenty twenty-one twenty-two twenty-three twenty-four";
    {
        Talking t(true);
        t.askLive();
        std::string shown = playRecordedLine(t, "d1", said, 4000, 0, 1);
        double wanted = charactersOf(said, (1 + Voice::wordsAhead) / 4);
        CHECK(said.compare(0, shown.size(), shown) == 0, "a prefix of the line: \"%s\"", shown.c_str());
        CHECK(double(shown.size()) <= wanted && double(shown.size()) > wanted - 14,
              "1 s into a 4 s recording, its first (1 + %.1f) / 4: %zu characters for %.0f", Voice::wordsAhead, shown.size(), wanted);
        shown = playRecordedLine(t, "d1", said, 4000, 0, 2);
        wanted = charactersOf(said, (3 + Voice::wordsAhead) / 4);
        CHECK(double(shown.size()) <= wanted && double(shown.size()) > wanted - 14, "and at 3 s, (3 + %.1f) / 4: %zu for %.0f",
              Voice::wordsAhead, shown.size(), wanted);
    }
    {
        // The take began mid-line: the sound starts 2 s into the recording, and so do the words.
        Talking t(true);
        t.askLive();
        std::string shown = playRecordedLine(t, "d2", said, 4000, 2000, 0.5);
        double wanted = charactersOf(said, (2.5 + Voice::wordsAhead) / 4);
        CHECK(double(shown.size()) <= wanted && double(shown.size()) > wanted - 14, "from 2 s in: %zu for %.0f", shown.size(), wanted);
    }
}

TEST(aReplyThatHasComeIsComingUntilItSoundsAndThinkingAloneIsNot) {
    Talking t(true);
    t.askLive();
    t.frame(0.5);
    CHECK(t.shows() == Presence::State::thinking, "thinking");
    CHECK(!t.voice.lineComing(), "nothing is coming while Momo works out the reply");
    t.voice.say("Back to the start.");
    t.frame();
    CHECK(t.voice.lineComing(), "the reply has come and is about to sound");
    t.serviceSays(audioFrame("r1", aSecondOfVoice()));
    CHECK(!t.voice.lineComing(), "it sounds");
    Talking quiet(true);
    quiet.askLive();
    quiet.voice.say("A line the voice never says.");
    quiet.frame(Voice::lineWait + 0.1);
    CHECK(!quiet.voice.lineComing(), "a reply that never sounds is waited for at most lineWait");
}

TEST(presenceQuietEndsThinking) {
    using S = Presence::State;
    Talking t(true);
    t.askLive();
    t.frame(0.5);
    CHECK(t.shows() == S::thinking, "thinking");
    CHECK(t.looping(), "the loop");
    t.serviceSays(R"({"t":"quiet","turn":2})");
    CHECK(t.shows() == S::thinking, "quiet for another turn does not end this one");
    t.serviceSays(R"({"t":"quiet","turn":1})");
    CHECK(t.voice.state() == Listener::State::open, "open: no reply is coming, and the user may go on");
    CHECK(t.shows() == S::waiting, "and, nobody speaking, Momo shows idle");
    CHECK(!t.looping(), "the loop stopped");
    t.frame(1);
    CHECK(!t.looping() && t.played().size() == 2, "and nothing more plays");
}

TEST(presenceThinksNoLongerThanItsCap) {
    Talking t(true);
    t.askLive();
    t.frame(0.5);
    t.frame(Voice::longestThought - 0.2);
    CHECK(t.shows() == Presence::State::thinking, "thinking");
    t.frame(0.3);
    CHECK(t.voice.state() == Listener::State::open && t.shows() == Presence::State::waiting, "not past the cap: open, showing idle");
}

TEST(presenceTalkingWhileThinkingStopsTheLoop) {
    Talking t(true);
    t.askLive();
    t.frame(0.5);
    CHECK(t.looping(), "thinking");
    t.hear(Sound().quiet(0.5).say("hey-momo").quiet(0.5));
    CHECK(t.shows() == Presence::State::listening, "listening to the new turn");
    CHECK(!t.looping(), "the loop stopped");
    CHECK_EQ(t.liveSent("start").size(), size_t(2));
}

TEST(presenceARowPickIsSentThenThinksUntilTheWorkStarts) {
    using S = Presence::State;
    Talking t(true);
    t.goLive();
    t.hear(Sound().quiet(0.5));
    t.voice.asked("How did Hitchcock use the dolly zoom?");
    t.frame();
    CHECK(t.shows() == S::sent, "sent");
    CHECK(t.played() == std::vector<std::string>({"momo_sent"}), "with the sent tone");
    CHECK_EQ(t.voice.presence().userText, "How did Hitchcock use the dolly zoom?");
    CHECK(t.voice.presence().userFinal, "as asked");
    t.frame(0.5);
    CHECK(t.shows() == S::thinking, "thinking");
    CHECK(t.played() == std::vector<std::string>({"momo_sent"}) && t.looping(), "with the loop");
    t.voice.activity(started("a1", "Looking for dolly zooms", "Finding dolly zooms"));
    t.frame();
    CHECK(t.shows() == S::working, "working once the work starts");
    CHECK(t.voice.presence().agents.size() == 1 && t.voice.presence().agents[0].step == "Finding dolly zooms", "the Scout's line");
    CHECK(!t.looping(), "the loop stopped");

    t.voice.activity(ended("a1"));
    t.voice.asked("Show me a dolly zoom on film");
    t.voice.activity(started("a2", "Looking for films"));
    t.frame(0.2);
    CHECK(t.shows() == S::sent, "sent for its while, though the work started at once");
    t.frame(0.3);
    CHECK(t.shows() == S::working, "then working, without thinking");
    CHECK(t.played().size() == 2 && !t.looping(), "the tone again, and no loop");
}

TEST(presenceMutedMakesNoSoundYetTakesTheTime) {
    using S = Presence::State;
    Talking t(Made{.muted = true});
    t.goLive();
    t.hear(whole(Sound().quiet(1).say("command").quiet(1.5)));
    CHECK(t.shows() == S::listening, "listening, without a chime");
    t.serviceSays(R"({"t":"over","turn":1})");
    t.frame(0.5);
    CHECK(t.shows() == S::thinking, "thinking, without the tone or the loop");
    t.serviceSays(audioFrame("r1", aSecondOfVoice()));
    t.serviceSays(R"({"t":"text","id":"r1","text":"Here are three."})");
    t.serviceSays(R"({"t":"done","id":"r1"})");
    t.frame(0.5);
    CHECK(t.shows() == S::responding, "responding for as long as Momo's voice lasts");
    CHECK(std::fabs(t.voice.presence().level - levelOf(6000 / 32768.f / std::sqrt(2.f))) < 0.02f, "with the level of the voice (%.2f)",
          t.voice.presence().level);
    t.frame(0.4);
    CHECK(t.shows() == S::responding, "still");
    t.frame(0.2);
    CHECK(t.voice.state() == Listener::State::open && t.shows() == S::waiting, "then open, showing idle");
    t.voice.asked("What else is like this?");
    t.frame(1);
    CHECK_EQ(host.plays.size(), size_t(0));
    CHECK(host.sounds.empty() && host.levels.empty(), "nothing through the mixer");
    CHECK_EQ(host.players.size(), size_t(0));

    Talking old(Made{.live = false, .muted = true});
    old.hear(Sound().quiet(1).say("command").quiet(2));
    old.voice.say("Bringing more.");
    old.frame();
    CHECK_EQ(old.fetchesTo("/api/transcribe").size(), size_t(1));
    std::vector<Fetch> speech = old.fetchesTo("/api/speak");
    CHECK_EQ(speech.size(), size_t(1));
    if (speech.size() != 1) return;
    speech[0].done(ok(""));
    old.frame(0.1);
    CHECK(old.shows() == Presence::State::responding, "the reply is heard, silently");
    CHECK_EQ(old.voice.presence().momoText, "Bringing more.");
    old.frame(0.5);
    CHECK(old.shows() == Presence::State::responding, "for as long as its words take");
    old.frame(1);
    CHECK(old.shows() != Presence::State::responding, "and then it is over");
    CHECK_EQ(host.plays.size(), size_t(0));
}

TEST(liveNamesItsConnectionAndOpensAgainForANewOne) {
    Talking t(Made{.live = false});
    Settings settings;
    t.voice.joined(settings, true, true, "c-1");
    t.frame();
    CHECK_EQ(host.sockets.size(), size_t(1));
    if (host.sockets.empty()) return;
    CHECK_EQ(host.sockets[0]->url, "ws://127.0.0.1:8790/live?token=tok&connection=c-1");
    host.sockets[0]->events.opened();
    t.serviceSays(R"({"t":"ready","rate":24000})");
    t.voice.joined(settings, true, true, "c-1");
    t.frame();
    CHECK_EQ(host.sockets.size(), size_t(1));
    t.voice.joined(settings, true, true, "c-2");
    CHECK(host.sockets[0]->closed, "a reconnect's new connection closes /live, which named the old one");
    t.frame();
    CHECK_EQ(host.sockets.size(), size_t(2));
    if (host.sockets.size() < 2) return;
    CHECK_EQ(host.sockets[1]->url, "ws://127.0.0.1:8790/live?token=tok&connection=c-2");
}

TEST(liveOpensOnlyWhileTheHelloOffersIt) {
    Talking t(Made{.live = false});
    t.frame();
    t.frame(10);
    CHECK_EQ(host.sockets.size(), size_t(0));
    Settings settings;
    t.voice.joined(settings, true, true);
    t.goLive();
    if (host.sockets.empty()) return;
    t.voice.joined(settings, true, false);
    CHECK(host.sockets[0]->closed, "a hello without a live voice closes /live");
    t.frame(10);
    CHECK_EQ(host.sockets.size(), size_t(1));
    t.hear(Sound().quiet(0.5).say("command").quiet(2));
    CHECK_EQ(t.fetchesTo("/api/transcribe").size(), size_t(1));
    CHECK_EQ(t.liveSent("start").size(), size_t(0));
    t.voice.joined(settings, true, true);
    t.frame();
    CHECK_EQ(host.sockets.size(), size_t(2));
    if (host.sockets.size() < 2) return;
    host.sockets[1]->events.closed("status 404");
    t.frame();
    t.frame(4.9);
    CHECK_EQ(host.sockets.size(), size_t(2));
    t.frame(0.2);
    CHECK_EQ(host.sockets.size(), size_t(3));
}

namespace {

/// Momo says something on a live voice and is done: the conversation is open, and nobody speaks.
void openedByMomo(Talking& t) {
    t.goLive();
    t.hear(Sound().quiet(0.5));
    t.serviceSays(audioFrame("a1", aSecondOfVoice()));
    t.serviceSays(R"({"t":"done","id":"a1"})");
    t.frame(1.2);
    if (!host.players.empty()) host.players[0]->done(true);
    t.frame();
}

}  // namespace

// The user, 2026-11-17: "listening should only show when USER IS TALKING, if mic is open but user is not talking, mic
// stays open but momo appears idle".
TEST(openAndSilentShowsIdle) {
    using S = Presence::State;
    Talking t(true);
    openedByMomo(t);
    CHECK(t.voice.state() == Listener::State::open, "the conversation is open: the user may answer without the name");
    CHECK(t.shows() == S::waiting, "and Momo shows idle, not listening");
    CHECK(t.voice.presence().level == 0, "its ring not moved by the room");
    t.hear(Sound().quiet(2));
    CHECK(t.voice.state() == Listener::State::open && t.shows() == S::waiting, "2 s on, nobody speaking: still open, still idle");
}

TEST(openAndSilentWithAnAgentWorkingShowsWorking) {
    using S = Presence::State;
    Talking t(true);
    openedByMomo(t);
    t.voice.activity(started("w1", "Looking for films with a slow dolly zoom"));
    t.frame();
    CHECK(t.voice.state() == Listener::State::open, "the conversation is open");
    CHECK(t.shows() == S::working, "and Momo shows the work, not listening");
}

TEST(openAndTheUserSpeakingShowsListening) {
    using S = Presence::State;
    Talking t(true);
    openedByMomo(t);
    bool listened = false;
    float loudest = 0;
    t.hear(Sound().say("more"), [&] {
        if (t.shows() == S::listening) listened = true;
        loudest = std::max(loudest, t.voice.presence().level);
    });
    CHECK(listened, "speaking in the open conversation, without the name, Momo listens");
    CHECK(loudest > 0, "its ring moved by the voice (%.2f)", double(loudest));
}
