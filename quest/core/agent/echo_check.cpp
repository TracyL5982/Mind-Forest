#include "echo_check.h"

#include <algorithm>
#include <cmath>
#include <mutex>

#include "async.h"
#include "audio.h"
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
    /// The loudness (RMS) of each tenth of a second heard and when it ended, the last ten seconds: for `-chimeCheck`.
    std::deque<std::pair<double, float>> levels;
    double sum = 0;
    int summed = 0;

    void heard(const float* samples, size_t count) {
        std::lock_guard<std::mutex> g(lock);
        sound = true;
        double now = mediaTime();
        for (size_t i = 0; i < count; i++) {
            sum += double(samples[i]) * samples[i];
            if (++summed < Listener::pieceLength) continue;
            // The run's samples after this one were heard a little later than it.
            levels.emplace_back(now - double(count - 1 - i) / Listener::rate, float(std::sqrt(sum / summed)));
            if (levels.size() > 100) levels.pop_front();
            sum = 0;
            summed = 0;
        }
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
    if (Flags::has("chimeCheck")) {
        logLine(fmt("[chime] the chime plays %d times, %.0f s apart, with the conversation open and no deaf stretch, while the user stays quiet; "
                    "then %d times while they say a short word over each",
                    chimes, chimeGap, chimesTalked));
        auto check = std::make_shared<EchoCheck>(model);
        check->start();
        return check;
    }
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

EchoCheck::EchoCheck(OceanModel& model) : model(model), rate(Listener::rate), chime(true) {}

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
    if (std::holds_alternative<Loading>(step) && sound) {
        step = Waiting{now + turnAround};
        if (chime) openConversation();
    }
    if (chime) return chimeFrame(now, events);

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

/// The conversation as it is once the name has been heard: open, nothing playing, any speech begins a turn.
void EchoCheck::openConversation() {
    std::lock_guard<std::mutex> g(ears->lock);
    ears->listener->replyStreams();
    ears->listener->replyEnded();
}

void EchoCheck::chimeFrame(double now, const std::vector<Listener::Event>& events) {
    for (const Listener::Event& e : events) {
        if (!std::holds_alternative<Listener::Began>(e)) continue;
        {
            std::lock_guard<std::mutex> g(ears->lock);
            ears->listener->turnOver();
        }
        if (auto* playing = std::get_if<Playing>(&step)) {
            if (!chimeBegan) chimeBeganAfter = now - playing->began;
            chimeBegan = true;
        } else if (played > 0) {
            roomStarts++;
            logLine("[chime] something in the room began a turn between chimes");
        }
    }
    if (auto* p = std::get_if<Playing>(&step); p && now >= p->began + chimeHeardFor) {
        float loudest = 0, room = 0, quietest = 1;
        int pieces = 0, loud = 0;
        {
            std::lock_guard<std::mutex> g(ears->lock);
            for (const auto& [at, level] : ears->levels) {
                if (at > p->sounded - 3 && at <= p->sounded + chimeHeardFor) quietest = std::min(quietest, level);
            }
            // A tenth of a second counts as words when it is louder than both 0.015 and three times the quietest of
            // the last three seconds, the listener's own rule.
            float words = std::max(0.015f, quietest * 3);
            for (const auto& [at, level] : ears->levels) {
                if (at > p->sounded - 1 && at <= p->sounded) room = std::max(room, level);
                if (at <= p->sounded || at > p->sounded + chimeHeardFor) continue;
                pieces++;
                loudest = std::max(loudest, level);
                loud += level > words;
            }
        }
        auto db = [](float rms) { return 20 * std::log10(std::max(rms, 1e-6f)); };
        if (chimeTalking()) {
            talkedStarts += chimeBegan;
            talkedLoudest.push_back(loudest);
            logLine(fmt("[chime] talked over %d of %d: loudest %.4f (%.0f dB) in the %.1f s after it began; %d of %d tenths of a second count as words; %s",
                        played - chimes, chimesTalked, loudest, db(loudest), chimeHeardFor, loud, pieces,
                        chimeBegan ? fmt("a turn began %.2f s after the chime did", chimeBeganAfter).c_str() : "NO TURN BEGAN"));
        } else {
            chimeStarts += chimeBegan;
            chimeLoudest.push_back(loudest);
            roomLoudest.push_back(room);
            logLine(fmt("[chime] quiet %d of %d: loudest %.4f (%.0f dB) in the %.1f s after it began, the room %.4f (%.0f dB) in the second before; %d of %d "
                        "tenths of a second count as words; %s",
                        played, chimes, loudest, db(loudest), chimeHeardFor, room, db(room), loud, pieces, chimeBegan ? "IT BEGAN A TURN" : "no turn began"));
        }
        // The pause between the halves is longer, to read that the user is to talk now.
        step = Waiting{now + (played == chimes ? turnAround : chimeGap - chimeHeardFor)};
        openConversation();
    }
    if (auto* w = std::get_if<Waiting>(&step); w && now >= w->until) {
        if (played < chimes + chimesTalked && audio::on()) {
            played++;
            chimeBegan = false;
            if (played == chimes + 1) {
                logLine("[chime] now say a short word over each chime");
                openConversation();
            }
            audio::play("momo_chime");
            step = Playing{now, mediaTime(), ++players};
        } else {
            if (!audio::on()) logLine("[chime] the app has no sounds (quest/tools/push_media.sh), so there is no check");
            std::vector<float> c = chimeLoudest, r = roomLoudest, t = talkedLoudest;
            std::sort(c.begin(), c.end());
            std::sort(r.begin(), r.end());
            std::sort(t.begin(), t.end());
            if (!c.empty() && !t.empty()) {
                logLine(fmt("[chime] done: alone, the chime began a turn in %d of %d plays (and the room %d times between them); at the microphone its loudest "
                            "tenth of a second was %.4f at the median and %.4f at most, the room before it %.4f at the median. Talked over, a turn began in %d of "
                            "%d, the loudest tenth of a second %.4f at the median and %.4f at least. Words are louder than 0.0150",
                            chimeStarts, int(c.size()), roomStarts, c[c.size() / 2], c.back(), r[r.size() / 2], talkedStarts, int(t.size()), t[t.size() / 2], t.front()));
            }
            step = Finished{};
        }
    }
    using S = Presence::State;
    presence.state = S::open;
    presence.level = 0;
    if (std::holds_alternative<Loading>(step)) presence.notice = "Chime check: allow the microphone";
    else if (std::holds_alternative<Finished>(step)) {
        presence.notice = fmt("Chime check done: the chime alone was taken for you %d of %d, you were heard over it %d of %d", chimeStarts, int(chimeLoudest.size()),
                              talkedStarts, int(talkedLoudest.size()));
    } else if (played == chimes && !std::holds_alternative<Playing>(step)) presence.notice = "Chime check: next, say a short word over each chime";
    else if (chimeTalking()) presence.notice = fmt("Chime check: say a short word over each chime (%d of %d)", played - chimes, chimesTalked);
    else presence.notice = fmt("Chime check: stay quiet (%d of %d)", std::max(played, 1), chimes);
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
