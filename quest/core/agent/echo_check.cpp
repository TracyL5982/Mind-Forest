#include "echo_check.h"

#include <algorithm>
#include <cmath>
#include <mutex>

#include "async.h"
#include "base.h"
#include "listener.h"
#include "ocean/oceanmodel.h"
#include "spotter.h"

namespace agent {

/// The listener and what crosses to and from it: the microphone's thread hears, the frame thread tells it what Momo
/// does and takes what came of it. In the conversation the listener only measures loudness, so holding it is brief.
struct EchoCheck::Ears {
    std::mutex lock;
    std::unique_ptr<Listener> listener;
    std::vector<Listener::Event> events;
    std::vector<int> ended;         // the players that ended, by number
    bool sound = false;

    void heard(const float* samples, size_t count) {
        std::lock_guard<std::mutex> g(lock);
        sound = true;
        double now = mediaTime();
        for (Listener::Event& e : listener->hear(samples, count)) {
            if (auto* piece = std::get_if<Listener::Streamed>(&e)) piece->heard = now;
            events.push_back(std::move(e));
        }
    }
};

namespace {

uint32_t u32(const std::string& s, size_t at) {
    return uint32_t(uint8_t(s[at])) | uint32_t(uint8_t(s[at + 1])) << 8 | uint32_t(uint8_t(s[at + 2])) << 16 | uint32_t(uint8_t(s[at + 3])) << 24;
}
uint16_t u16(const std::string& s, size_t at) { return uint16_t(uint8_t(s[at]) | uint8_t(s[at + 1]) << 8); }

/// As voice.cpp's: loudness 0 to 1 by decibels, so a voice sits at 0.5 to 0.9.
float levelOf(float rms) {
    float db = 20 * std::log10(std::max(rms, 1e-6f));
    return std::clamp((db + 48) / 36, 0.f, 1.f);
}

}  // namespace

std::optional<EchoCheck::Clip> EchoCheck::readClip(const std::string& s) {
    if (s.size() < 12 || s.compare(0, 4, "RIFF") != 0 || s.compare(8, 4, "WAVE") != 0) return std::nullopt;
    int rate = 0;
    for (size_t at = 12; at + 8 <= s.size();) {
        size_t size = u32(s, at + 4), body = at + 8;
        if (size > s.size() - body) return std::nullopt;
        if (s.compare(at, 4, "fmt ") == 0) {
            if (size < 16 || u16(s, body) != 1 || u16(s, body + 2) != 1 || u16(s, body + 14) != 16) return std::nullopt;
            rate = int(u32(s, body + 4));
        } else if (s.compare(at, 4, "data") == 0) {
            if (rate < 8000 || rate > 48000) return std::nullopt;
            Clip clip;
            clip.rate = rate;
            clip.samples.resize(size / 2);
            for (size_t i = 0; i < clip.samples.size(); i++) clip.samples[i] = int16_t(u16(s, body + 2 * i));
            return clip;
        }
        at = body + size + (size & 1);
    }
    return std::nullopt;
}

std::shared_ptr<EchoCheck> EchoCheck::fromFlags(OceanModel& model) {
    std::optional<std::string> flag = Flags::string("echoCheck");
    if (!flag) return nullptr;
    std::string path = !flag->empty() && (*flag)[0] == '/' ? *flag : platform::resourcePath(*flag);
    std::optional<std::string> bytes = path.empty() ? std::nullopt : platform::readFile(path);
    std::optional<Clip> clip = bytes ? readClip(*bytes) : std::nullopt;
    if (!clip) {
        logLine("[echo] -echoCheck " + *flag + " is not a 16-bit mono PCM WAV file it can read, so there is no check");
        return nullptr;
    }
    logLine(fmt("[echo] a %.1f s reply at %d Hz, played %d times while the user is quiet, then %d times they talk over",
                double(clip->samples.size()) / clip->rate, clip->rate, plays, plays));
    auto check = std::make_shared<EchoCheck>(model, std::move(clip->samples), clip->rate);
    check->start();
    return check;
}

EchoCheck::EchoCheck(OceanModel& model, std::vector<int16_t> reply, int rate) : model(model), reply(std::move(reply)), rate(rate) {}

EchoCheck::~EchoCheck() {
    if (microphone) microphone->stop();
    if (player) player->stop();
}

void EchoCheck::start() {
    std::string tokens = platform::resourcePath("kws/tokens.txt");
    if (tokens.empty()) {
        logLine("[echo] the listener's model is not here (quest/tools/fetch-voice.sh), so there is no check");
        step = Finished{};
        return;
    }
    std::string dir = tokens.substr(0, tokens.rfind('/'));
    auto made = std::make_shared<std::unique_ptr<Spotter>>();
    Async::run(
        [made, dir] {
            std::optional<std::string> bpe = platform::readFile(dir + "/bpe.model");
            std::optional<Vocabulary> v = bpe ? readVocabulary(*bpe) : std::nullopt;
            std::optional<std::string> lines = v ? keywordLines("momo", *v) : std::nullopt;
            if (lines) *made = Spotter::make(dir, *lines);
        },
        [this, made] {
            if (!*made) {
                logLine("[echo] the keyword spotter could not be made, so there is no check");
                step = Finished{};
                return;
            }
            ears = std::make_shared<Ears>();
            ears->listener = std::make_unique<Listener>(std::move(*made));
            ears->listener->setMode(Listener::Mode::stream);
            std::weak_ptr<Ears> weak = ears;
            microphone = platform::openMicrophone({
                [weak](const float* samples, size_t count) {
                    if (auto e = weak.lock()) e->heard(samples, count);
                },
                [](const std::string& why) { logLine("[echo] the microphone stopped: " + why); },
                [] { logLine("[echo] the microphone is not allowed, so there is no check"); },
                [] {},
            });
        });
}

void EchoCheck::frame(double now) {
    model.conversing = !std::holds_alternative<Finished>(step);
    std::vector<Listener::Event> events;
    std::vector<int> ended;
    bool sound = false;
    if (ears) {
        std::lock_guard<std::mutex> g(ears->lock);
        events.swap(ears->events);
        ended.swap(ears->ended);
        sound = ears->sound;
    }
    if (std::holds_alternative<Loading>(step) && sound) step = Waiting{now + turnAround};

    for (size_t i = 0; i < events.size(); i++) {
        if (!std::holds_alternative<Listener::Began>(events[i])) continue;
        // The pieces that follow are the turn's, from just before its first word, the last of them heard at `heard`.
        size_t pieces = 0;
        std::optional<size_t> first;
        double heard = 0;
        for (size_t k = i + 1; k < events.size(); k++) {
            const auto* piece = std::get_if<Listener::Streamed>(&events[k]);
            if (!piece) break;
            if (piece->speech && !first) first = pieces;
            heard = piece->heard;
            pieces++;
        }
        double wordAt = heard - double(pieces - first.value_or(pieces ? pieces - 1 : 0)) / 10;
        {
            std::lock_guard<std::mutex> g(ears->lock);
            ears->listener->turnOver();
        }
        auto* playing = std::get_if<Playing>(&step);
        if (!playing) {
            if (!talkingHalf() && played > 0) {
                roomStarts++;
                logLine("[echo] something in the room began a turn between plays");
            }
            continue;
        }
        double into = now - playing->began, sounded = playing->sounded;
        int number = talkingHalf() ? played - plays : played;
        stop(now, pause(), false);
        if (talkingHalf() && wordAt < sounded) {
            early++;
            logLine(fmt("[echo] talked over %d of %d: the user was still talking as it began, so it is not timed", number, plays));
        } else if (talkingHalf()) {
            double took = mediaTime() - wordAt;
            stops.push_back(took);
            logLine(fmt("[echo] talked over %d of %d: Momo stopped %.2f s after the first word, %.1f s into the reply", number, plays, took, into));
        } else {
            falseStarts++;
            logLine(fmt("[echo] quiet %d of %d: Momo's own voice began a turn %.1f s into the reply", number, plays, into));
        }
    }
    for (int number : ended) {
        auto* playing = std::get_if<Playing>(&step);
        if (!playing || playing->number != number) continue;
        if (talkingHalf()) {
            unstopped++;
            logLine(fmt("[echo] talked over %d of %d: it played to its end", played - plays, plays));
        } else {
            logLine(fmt("[echo] quiet %d of %d: played to its end", played, plays));
        }
        stop(now, pause(), true);
    }
    if (auto* w = std::get_if<Waiting>(&step); w && now >= w->until) {
        if (played < 2 * plays) {
            play(now);
        } else {
            report();
            step = Finished{};
        }
    }

    using S = Presence::State;
    presence.state = std::holds_alternative<Playing>(step) ? S::responding : S::open;
    presence.level = 0;
    if (auto* p = std::get_if<Playing>(&step)) {
        size_t span = size_t(rate / 50), at = size_t(std::max(0.0, now - p->began) * rate);
        if (at + span <= reply.size()) {
            double sum = 0;
            for (size_t k = at; k < at + span; k++) sum += double(reply[k]) * reply[k];
            presence.level = levelOf(float(std::sqrt(sum / double(span)) / 32768));
        }
    }
    if (std::holds_alternative<Loading>(step)) presence.notice = "Echo check: allow the microphone";
    else if (std::holds_alternative<Finished>(step)) presence.notice = fmt("Echo check done: taken for you %d of %d, stopped %d of %d", falseStarts, plays, int(stops.size()), plays);
    else if (played == plays && !std::holds_alternative<Playing>(step)) presence.notice = "Echo check: next, talk over Momo to stop it";
    else if (talkingHalf()) presence.notice = fmt("Echo check: talk over Momo to stop it (%d of %d)", played - plays, plays);
    else presence.notice = fmt("Echo check: stay quiet while Momo talks (%d of %d)", std::max(played, 1), plays);
    if (!view) {
        if (!model.art || !model.lineMaterial) return;
        view = std::make_unique<PresenceView>(model.art, *model.lineMaterial, model.root_);
    }
    Mat4 head = platform::head().value_or(Mat4::trs(model.stage.origin, Quat::identity(), {1, 1, 1}));
    view->frame(presence, "Momo", head, now);
}

void EchoCheck::play(double now) {
    played++;
    int number = ++players;
    std::weak_ptr<Ears> weak = ears;
    player = platform::playStream(rate, [weak, number](bool) {
        if (auto e = weak.lock()) {
            std::lock_guard<std::mutex> g(e->lock);
            e->ended.push_back(number);
        }
    });
    if (!player) {
        logLine("[echo] Momo's voice could not be played, so there is no check");
        step = Finished{};
        return;
    }
    {
        std::lock_guard<std::mutex> g(ears->lock);
        ears->listener->replyStreams();
    }
    player->write(reply.data(), reply.size());
    player->finish();
    step = Playing{now, mediaTime(), number};
    if (played == 1) logLine("[echo] stay quiet while Momo talks");
    if (played == plays + 1) logLine("[echo] now talk over Momo, each time");
}

void EchoCheck::stop(double now, double wait, bool ended) {
    if (player && !ended) player->stop();
    player.reset();
    {
        std::lock_guard<std::mutex> g(ears->lock);
        ears->listener->replyEnded();
    }
    step = Waiting{now + wait};
}

void EchoCheck::report() {
    std::vector<double> s = stops;
    std::sort(s.begin(), s.end());
    std::string took = s.empty() ? "" : fmt(", %.2f s after the first word at the median and %.2f at most", s[s.size() / 2], s.back());
    logLine(fmt("[echo] done: Momo's own voice began a turn %d times in %d quiet plays (and the room %d times between them); talked over, "
                "Momo stopped %d of %d times%s (%d played to the end, %d begun while the user still talked)",
                falseStarts, plays, roomStarts, int(stops.size()), plays, took.c_str(), unstopped, early));
}

}  // namespace agent
