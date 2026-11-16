#include "listener.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <ctime>
#include <limits>

namespace agent {
namespace {

constexpr int ringPieces = 30;
/// The phrase is spotted at least 0.2 seconds after it ends, and its last word piece lasts about a quarter second.
/// So it began no later than its span between first and last piece plus 0.45 seconds before it was spotted.
constexpr double afterLastPiece = 0.45;
/// How far before that guess the start of the phrase is looked for, at most.
constexpr int lookBack = 5;
/// The spotter clears itself after 1.5 seconds without speech; a fresh stream after each second of quiet comes first.
/// After 1.5 and 3 seconds of quiet, 7 and 0 of 60 phrases were caught without it, 52 and 57 with it.
constexpr int freshAfterQuiet = 10;
constexpr int pause = 12;
constexpr int nothingSaid = 80;
/// The user's rule: the conversation stays open until nobody has talked for 8 seconds.
constexpr int conversationQuiet = 80;
constexpr int longest = 600;
constexpr int echo = 3;
/// The chime (synth.py's momo_chime) lasts 0.28 s; one that never says it ended is taken to have ended after this.
constexpr int longestChime = 10;
/// A reply that never says it ended stops holding the listener after this long.
constexpr int longestReply = 900;
/// Streaming, a turn goes out from this long before its first word, so a word begun while the chime played, when
/// nothing counts as words, is kept whole. The name alone and the pause after it are never sent, so the model cannot
/// take the pause for the end of the turn.
constexpr int heldBack = 8;
/// In an open conversation a turn begins once 3 of the last 4 pieces were words: a cough or a knock is shorter, and
/// a word that dips for a moment still counts. Momo stops 0.3 s into what the user says.
constexpr int wordsToBegin = 3;
constexpr int wordsWindow = 4;

/// Speech is louder than both a floor and three times the quietest moment, the rule the web client's recorder uses.
bool speech(float level, float quietest) { return level > std::max(0.015f, quietest * 3); }

double cpuSeconds() {
    timespec t{};
    clock_gettime(CLOCK_THREAD_CPUTIME_ID, &t);
    return double(t.tv_sec) + double(t.tv_nsec) * 1e-9;
}

}  // namespace

Listener::Listener(std::unique_ptr<Spotter> spotter) : spotter(std::move(spotter)) {}

Listener::State Listener::state() const {
    if (std::holds_alternative<Recording>(phase) || std::holds_alternative<Streaming>(phase)) return State::hearing;
    if (std::holds_alternative<Working>(phase)) return State::working;
    if (std::holds_alternative<Open>(phase)) return State::open;
    return reply.kind == Own::Kind::none ? State::waiting : State::speaking;
}

std::vector<Listener::Event> Listener::hear(const float* samples, size_t count) {
    std::vector<Event> events;
    partial.insert(partial.end(), samples, samples + count);
    size_t at = 0;
    for (; partial.size() - at >= size_t(pieceLength); at += pieceLength) {
        Piece p;
        p.samples.assign(partial.begin() + long(at), partial.begin() + long(at + pieceLength));
        double sum = 0;
        for (float s : p.samples) sum += double(s) * s;
        p.level = float(std::sqrt(sum / pieceLength));
        hearPiece(std::move(p), events);
    }
    partial.erase(partial.begin(), partial.begin() + long(at));
    return events;
}

void Listener::hearPiece(Piece p, std::vector<Event>& events) {
    ring.push_back(std::move(p));
    while (int(ring.size()) > ringPieces) ring.pop_front();
    const Piece& piece = ring.back();
    if (spotsNow()) spot(piece, events);
    else if (std::holds_alternative<Recording>(phase)) record(piece, events);
    else if (std::holds_alternative<Open>(phase)) open(piece, events);
    else if (std::holds_alternative<Streaming>(phase)) stream(piece, events);
    chiming.tick(longestChime);
    if (reply.kind != Own::Kind::none) {
        reply.tick(longestReply);
        settle();
    }
}

void Listener::Own::tick(int longest) {
    if (kind == Kind::none) return;
    pieces++;
    if (kind == Kind::playing && pieces >= longest) *this = Own{Kind::echo, 0};
    else if (kind == Kind::echo && pieces >= echo) *this = Own{};
}

void Listener::spot(const Piece& piece, std::vector<Event>& events) {
    double began = cpuSeconds();
    Between& between = std::get<Between>(phase);
    between.quiet = speech(piece.level, quietestHeard()) ? 0 : between.quiet + 1;
    if (between.quiet >= freshAfterQuiet) listen();
    std::optional<Spotter::Found> found = spotter->hear(piece.samples.data(), pieceLength);
    busy_.spotting += cpuSeconds() - began;
    busy_.heard += 1.0 / 10;
    if (found) wake(*found, events);
}

/// Starts the recording one piece before the phrase, so what follows it is kept whole and what came before is not sent.
/// The spotter's timestamps place the phrase only by its span. From the latest it can have begun, the start moves back to
/// where its sound begins, or forward past quiet to it. A short command said straight after the name ("hey Momo, more")
/// can end before the name is spotted, so speech after the phrase counts and the pause is timed from it. The phrase ends at
/// the first dip once its span has passed (its first piece is reported after its sound begins, its last near the end). A dip
/// is a piece under a fifth of the phrase's loudest, since a quick speaker may not go quiet, and only a piece as loud as that
/// after the dip is a word, so the fading end of "Momo" is not taken for one.
void Listener::wake(const Spotter::Found& found, std::vector<Event>& events) {
    const std::vector<float>& times = found.timestamps;
    double span = times.size() > 1 ? double(times.back()) - double(times.front()) : 0;
    int n = int(ring.size());
    float floor = std::numeric_limits<float>::infinity();
    for (const Piece& r : ring) floor = std::min(floor, r.level);
    int guess = std::max(0, n - int(std::ceil((span + afterLastPiece) / 0.1)));
    int start = guess;
    if (speech(ring[start].level, floor)) {
        while (start > 0 && guess - start < lookBack && speech(ring[start - 1].level, floor)) start--;
    } else {
        while (start < n - 1 && !speech(ring[start].level, floor)) start++;
    }
    int from = std::max(0, start - 1);
    float quietest = std::numeric_limits<float>::infinity();
    for (int i = from; i < n; i++) quietest = std::min(quietest, ring[i].level);
    int phraseEnd = start + std::max(0, int(std::lround(span / 0.1)) - 1);
    float loudest = -std::numeric_limits<float>::infinity();
    for (int i = start; i <= phraseEnd && i < n; i++) loudest = std::max(loudest, ring[i].level);
    float dip = loudest / 5;
    while (phraseEnd < n && ring[phraseEnd].level >= dip) phraseEnd++;
    auto word = [&](int i) { return i > phraseEnd && ring[i].level >= dip; };
    if (mode == Mode::stream) {
        events.push_back(Woke{found.keyword});
        // A request said straight after the name goes out with it; otherwise the conversation is open, and the turn
        // begins just before its first word.
        bool spoke = false;
        for (int i = from; i < n; i++) spoke = spoke || word(i);
        std::deque<Streamed> held;
        if (spoke) {
            for (int i = from; i < n; i++) held.push_back(Streamed{ring[i].samples, word(i)});
            begin(std::move(held), quietest, events);
            return;
        }
        for (int i = std::max(phraseEnd + 1, n - heldBack); i < n; i++) held.push_back(Streamed{ring[i].samples, false});
        phase = Open{0, std::move(held)};
        settle();
        return;
    }
    Recording r;
    r.pieces.assign(ring.begin() + from, ring.end());
    r.quietest = quietest;
    for (int i = phraseEnd + 1; i < n; i++) {
        if (!word(i)) continue;
        r.spoke = true;
        r.lastVoice = i + 1 - n;
    }
    phase = std::move(r);
    settle();
    events.push_back(Woke{found.keyword});
}

/// Nothing goes out until a turn begins. Momo's voice, playing or fading, counts as someone talking, and so does Momo
/// thinking or its reply being on its way.
void Listener::open(const Piece& piece, std::vector<Event>& events) {
    Open& o = std::get<Open>(phase);
    float quietest = quietestHeard();
    bool words = chiming.kind == Own::Kind::none && speech(piece.level, quietest);
    o.held.push_back(Streamed{piece.samples, words});
    if (int(o.held.size()) > heldBack) o.held.pop_front();
    int recent = 0;
    for (size_t i = o.held.size() - std::min(o.held.size(), size_t(wordsWindow)); i < o.held.size(); i++) recent += o.held[i].speech;
    if (recent >= wordsToBegin) {
        begin(std::move(o.held), quietest, events);
        return;
    }
    o.quiet = words || thinking || reply.kind != Own::Kind::none ? 0 : o.quiet + 1;
    if (o.quiet < conversationQuiet) return;
    phase = Between{};
    settle();
    events.push_back(Closed{});
}

void Listener::begin(std::deque<Streamed> held, float quietest, std::vector<Event>& events) {
    phase = Streaming{quietest, 0};
    settle();
    events.push_back(Began{});
    for (Streamed& piece : held) events.push_back(std::move(piece));
}

/// Every piece is handed over, marked as words or not by the recording's rule. It does not end on a pause: the turn is
/// over when the service says so (`turnOver`), or at 60 seconds.
void Listener::stream(const Piece& piece, std::vector<Event>& events) {
    Streaming& st = std::get<Streaming>(phase);
    st.pieces++;
    st.quietest = std::min(st.quietest, piece.level);
    events.push_back(Streamed{piece.samples, chiming.kind == Own::Kind::none && speech(piece.level, st.quietest)});
    if (st.pieces < longest) return;
    phase = Open{};
    settle();
    events.push_back(Cut{});
}

float Listener::quietestHeard() const {
    float least = std::numeric_limits<float>::infinity();
    for (const Piece& r : ring) least = std::min(least, r.level);
    return least;
}

void Listener::record(const Piece& piece, std::vector<Event>& events) {
    Recording& r = std::get<Recording>(phase);
    r.pieces.push_back(piece);
    r.sinceWake++;
    r.quietest = std::min(r.quietest, piece.level);
    if (chiming.kind == Own::Kind::none && speech(piece.level, r.quietest)) {
        r.spoke = true;
        r.lastVoice = r.sinceWake;
    }
    bool paused = r.spoke && r.sinceWake - r.lastVoice >= pause;
    bool silent = !r.spoke && r.sinceWake >= nothingSaid;
    if (!paused && !silent && r.sinceWake < longest) return;
    if (!r.spoke) {
        phase = Between{};
        events.push_back(NothingSaid{});
        ended(events);
        return;
    }
    std::vector<float> samples;
    samples.reserve(r.pieces.size() * piece.samples.size());
    for (const Piece& p : r.pieces) samples.insert(samples.end(), p.samples.begin(), p.samples.end());
    Recorded done{wavFile(samples), double(r.pieces.size()) / 10};
    phase = Working{};
    events.push_back(std::move(done));
    ended(events);
}

void Listener::ended(std::vector<Event>& events) {
    if (replyHeld) {
        replyHeld = false;
        reply = Own{Own::Kind::playing, 0};
        events.push_back(Speak{});
    }
    settle();
}

void Listener::done() {
    if (!std::holds_alternative<Working>(phase)) return;
    phase = Between{};
    settle();
}

void Listener::setMode(Mode m) {
    mode = m;
    if (mode == Mode::record && (std::holds_alternative<Open>(phase) || std::holds_alternative<Streaming>(phase))) phase = Between{};
    settle();
}

void Listener::turnOver() {
    if (!std::holds_alternative<Streaming>(phase)) return;
    phase = Open{};
    settle();
}

bool Listener::askToSpeak() {
    if (std::holds_alternative<Recording>(phase)) {
        replyHeld = true;
        return false;
    }
    reply = Own{Own::Kind::playing, 0};
    settle();
    return true;
}

void Listener::replyStreams() {
    if (reply.kind != Own::Kind::playing) reply = Own{Own::Kind::playing, 0};
    if (mode == Mode::stream && std::holds_alternative<Between>(phase)) phase = Open{};
    settle();
}

void Listener::replyEnded() {
    reply = Own{Own::Kind::echo, 0};
    settle();
}

void Listener::momoThinks(bool t) { thinking = t; }

void Listener::chimeStarted() { chiming = Own{Own::Kind::playing, 0}; }

void Listener::chimeEnded() {
    if (chiming.kind == Own::Kind::playing) chiming = Own{Own::Kind::echo, 0};
}

std::unique_ptr<Spotter> Listener::respell(std::unique_ptr<Spotter> next) {
    std::swap(spotter, next);
    if (spotsNow()) listen();
    return next;
}

void Listener::listen() {
    spotter->fresh();
    if (Between* between = std::get_if<Between>(&phase)) between->quiet = 0;
}

bool Listener::spotsNow() const { return std::holds_alternative<Between>(phase) && reply.kind == Own::Kind::none; }

void Listener::settle() {
    bool now = spotsNow();
    if (now && !spotting) listen();
    spotting = now;
}

// MARK: - WAV

namespace {

void put16(std::string& s, uint16_t v) {
    s += char(v & 0xff);
    s += char(v >> 8);
}
void put32(std::string& s, uint32_t v) {
    put16(s, uint16_t(v & 0xffff));
    put16(s, uint16_t(v >> 16));
}
uint32_t get32(const std::string& s, size_t at) {
    return uint32_t(uint8_t(s[at])) | uint32_t(uint8_t(s[at + 1])) << 8 | uint32_t(uint8_t(s[at + 2])) << 16 | uint32_t(uint8_t(s[at + 3])) << 24;
}
uint16_t get16(const std::string& s, size_t at) { return uint16_t(uint8_t(s[at]) | uint8_t(s[at + 1]) << 8); }

}  // namespace

std::string wavFile(const std::vector<float>& samples) {
    uint32_t bytes = uint32_t(samples.size() * 2);
    std::string s = "RIFF";
    put32(s, 36 + bytes);
    s += "WAVEfmt ";
    put32(s, 16);
    put16(s, 1);
    put16(s, 1);
    put32(s, Listener::rate);
    put32(s, Listener::rate * 2);
    put16(s, 2);
    put16(s, 16);
    s += "data";
    put32(s, bytes);
    s.reserve(s.size() + bytes);
    for (float v : samples) put16(s, uint16_t(int16_t(std::clamp(v, -1.f, 1.f) * 32767)));
    return s;
}

std::optional<std::vector<float>> readWav(const std::string& s) {
    if (s.size() < 12 || s.compare(0, 4, "RIFF") != 0 || s.compare(8, 4, "WAVE") != 0) return std::nullopt;
    bool format = false;
    for (size_t at = 12; at + 8 <= s.size();) {
        std::string id = s.substr(at, 4);
        size_t size = get32(s, at + 4);
        size_t body = at + 8;
        if (size > s.size() - body) return std::nullopt;
        if (id == "fmt ") {
            if (size < 16 || get16(s, body) != 1 || get16(s, body + 2) != 1 || get32(s, body + 4) != uint32_t(Listener::rate) ||
                get16(s, body + 14) != 16) {
                return std::nullopt;
            }
            format = true;
        } else if (id == "data") {
            if (!format) return std::nullopt;
            std::vector<float> out(size / 2);
            for (size_t i = 0; i < out.size(); i++) out[i] = float(int16_t(get16(s, body + 2 * i))) / 32768;
            return out;
        }
        at = body + size + (size & 1);
    }
    return std::nullopt;
}

}  // namespace agent
