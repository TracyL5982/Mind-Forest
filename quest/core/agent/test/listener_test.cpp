// The listener on spoken clips (fixtures/voice, made by make-voice-clips.sh) with the real spotter and model, which
// quest/tools/fetch-voice.sh puts in quest/vendor/.
#include "sound.h"

using namespace agent;
using namespace check;

namespace {

/// What the listener said, and where in the sound it said it.
struct Said {
    Listener::Event event;
    size_t at;
};

/// Hears the sound in the 100 ms runs a microphone gives. Each event is placed at the end of the run it came in.
std::vector<Said> hearAll(Listener& listener, const Sound& sound, size_t from = 0) {
    std::vector<float> s = sound.withHiss();
    std::vector<Said> out;
    for (size_t at = 0; at < s.size(); at += Listener::pieceLength) {
        size_t n = std::min(size_t(Listener::pieceLength), s.size() - at);
        for (Listener::Event& e : listener.hear(s.data() + at, n)) out.push_back(Said{std::move(e), from + at + n});
    }
    return out;
}

template <class E>
std::vector<std::pair<E, size_t>> only(const std::vector<Said>& said) {
    std::vector<std::pair<E, size_t>> out;
    for (const Said& s : said) {
        if (const E* e = std::get_if<E>(&s.event)) out.emplace_back(*e, s.at);
    }
    return out;
}

/// A recording's samples.
size_t samplesIn(const Listener::Recorded& r) { return readWav(r.wav).value_or(std::vector<float>{}).size(); }

}  // namespace

TEST(keywordLinesSpellTheNameInTheModelsPieces) {
    CHECK(!vocabulary().empty(), "bpe.model was not read from %s", model.c_str());
    CHECK_EQ(keywordLines("momo", vocabulary()).value_or(""), std::string("▁HE Y ▁MO MO @HEY_MOMO\n▁HI ▁MO MO @HI_MOMO\n▁HIGH ▁MO MO @HI_MOMO"));
    CHECK_EQ(keywordLines(" Momo! ", vocabulary()).value_or(""), keywordLines("momo", vocabulary()).value_or("-"));
    CHECK(!keywordLines("モモ", vocabulary()), "a name the model has no pieces for cannot be listened for");
    CHECK(!keywordLines("", vocabulary()), "no name");
}

TEST(listenerWakesOnItsName) {
    for (const char* phrase : {"hey-momo", "hi-momo", "command"}) {
        Listener listener(spotterFor("momo"));
        Sound sound;
        sound.quiet(1).say(phrase);
        size_t said = sound.size();
        sound.quiet(1);
        std::vector<Said> heard = hearAll(listener, sound);
        auto woke = only<Listener::Woke>(heard);
        CHECK_EQ(woke.size(), size_t(1));
        if (woke.empty()) continue;
        CHECK(woke[0].second <= said + second, "%s was spotted %.2f s after it ended", phrase, double(woke[0].second - said) / second);
        CHECK(listener.state() == Listener::State::hearing, "after %s it records what follows", phrase);
    }
}

TEST(listenerIgnoresOrdinaryTalkAndNearMisses) {
    Listener listener(spotterFor("momo"));
    Sound talk;
    talk.quiet(0.5).say("talk").quiet(0.6).say("near").quiet(1.5);
    std::vector<Said> heard = hearAll(listener, talk);
    CHECK_EQ(heard.size(), size_t(0));
    CHECK(listener.state() == Listener::State::waiting, "still waiting for its name");
    Sound name;
    name.say("hey-momo").quiet(1);
    CHECK_EQ(only<Listener::Woke>(hearAll(listener, name)).size(), size_t(1));
}

TEST(listenerSendsNothingSaidBeforeItsName) {
    Listener listener(spotterFor("momo"));
    Sound sound;
    sound.quiet(1).say("before").quiet(0.5);
    size_t phrase = sound.size();
    sound.say("command").quiet(2);
    std::vector<Said> heard = hearAll(listener, sound);
    auto recorded = only<Listener::Recorded>(heard);
    CHECK_EQ(recorded.size(), size_t(1));
    if (recorded.empty()) return;
    // The recording ends where it is handed over, so it began its length before that.
    long begins = long(recorded[0].second) - long(samplesIn(recorded[0].first));
    CHECK(begins <= long(phrase), "it begins %.2f s after the name", double(begins - long(phrase)) / second);
    CHECK(begins >= long(phrase) - long(second * 3 / 10), "it begins %.2f s before the name, into what was said before it",
          double(long(phrase) - begins) / second);
}

TEST(listenerTakesAQuickCommandSaidStraightAfterItsName) {
    Listener listener(spotterFor("momo"));
    Sound sound;
    sound.quiet(1).say("hey-momo").quiet(0.15).say("more");
    size_t spoken = sound.size();
    sound.quiet(3);
    std::vector<Said> heard = hearAll(listener, sound);
    auto recorded = only<Listener::Recorded>(heard);
    CHECK_EQ(recorded.size(), size_t(1));
    CHECK_EQ(only<Listener::NothingSaid>(heard).size(), size_t(0));
    if (recorded.empty()) return;
    CHECK(recorded[0].second <= spoken + second * 15 / 10, "handed over %.2f s after \"more\"", double(recorded[0].second - spoken) / second);
}

TEST(listenerEndsTheRecordingOnAPauseOfOnePointTwoSeconds) {
    Listener listener(spotterFor("momo"));
    Sound sound;
    sound.quiet(1).say("command").quiet(0.8).say("also");
    size_t spoken = sound.size();
    sound.quiet(3);
    std::vector<Said> heard = hearAll(listener, sound);
    auto recorded = only<Listener::Recorded>(heard);
    CHECK_EQ(recorded.size(), size_t(1));
    if (recorded.empty()) return;
    double after = (double(recorded[0].second) - double(spoken)) / second;
    CHECK(after >= 1.0 && after <= 1.5, "a 0.8 s pause goes on, and it ends %.2f s after the last word", after);
    CHECK(listener.state() == Listener::State::working, "the recording is handed over");
}

TEST(listenerSendsNothingWhenNothingFollowsItsNameForEightSeconds) {
    Listener listener(spotterFor("momo"));
    Sound sound;
    sound.quiet(1).say("hey-momo");
    size_t named = sound.size();
    sound.quiet(10);
    std::vector<Said> heard = hearAll(listener, sound);
    CHECK_EQ(only<Listener::Woke>(heard).size(), size_t(1));
    CHECK_EQ(only<Listener::Recorded>(heard).size(), size_t(0));
    auto nothing = only<Listener::NothingSaid>(heard);
    CHECK_EQ(nothing.size(), size_t(1));
    if (!nothing.empty()) {
        double after = (double(nothing[0].second) - double(named)) / second;
        CHECK(after >= 7.5 && after <= 8.8, "it gave up %.2f s after the name", after);
    }
    CHECK(listener.state() == Listener::State::waiting, "waiting for its name again");
    Sound again;
    again.say("command").quiet(2);
    CHECK_EQ(only<Listener::Recorded>(hearAll(listener, again)).size(), size_t(1));
}

TEST(listenerCatchesItsNameAfterLongQuiet) {
    for (double lead : {3.0, 6.0}) {
        for (const char* phrase : {"hey-momo", "hi-momo", "command"}) {
            Listener listener(spotterFor("momo"));
            Sound sound;
            sound.quiet(lead).say(phrase).quiet(1.5);
            CHECK_EQ(only<Listener::Woke>(hearAll(listener, sound)).size(), size_t(1));
        }
    }
}

TEST(listenerHearsNothingWhileAReplyPlaysNorForItsEcho) {
    Listener listener(spotterFor("momo"));
    CHECK(listener.askToSpeak(), "a reply may play while it waits for its name");
    Sound reply;
    reply.quiet(0.5).say("command").quiet(1.5);
    CHECK_EQ(hearAll(listener, reply).size(), size_t(0));
    CHECK(listener.state() == Listener::State::speaking, "a reply plays");
    listener.replyEnded();
    hearAll(listener, Sound().quiet(0.2));
    CHECK(listener.state() == Listener::State::speaking, "200 ms after the reply its echo may still be in the room");
    hearAll(listener, Sound().quiet(0.1));
    CHECK(listener.state() == Listener::State::waiting, "300 ms after the reply it listens again");
    Sound name;
    name.say("command").quiet(2);
    CHECK_EQ(only<Listener::Recorded>(hearAll(listener, name)).size(), size_t(1));
}

TEST(listenerWaitsForTheRecordingToBeDealtWith) {
    Listener listener(spotterFor("momo"));
    Sound sound;
    sound.quiet(1).say("command").quiet(2);
    CHECK_EQ(only<Listener::Recorded>(hearAll(listener, sound)).size(), size_t(1));
    CHECK(listener.state() == Listener::State::working, "the recording is handed over");
    CHECK_EQ(hearAll(listener, Sound().say("command").quiet(2)).size(), size_t(0));
    listener.done();
    CHECK(listener.state() == Listener::State::waiting, "dealt with, it waits for its name");
    CHECK_EQ(only<Listener::Recorded>(hearAll(listener, Sound().say("command").quiet(2))).size(), size_t(1));
}

TEST(listenerAnswersToANewName) {
    auto heard = [](const char* clip) {
        Listener listener(spotterFor("momo"));
        listener.respell(spotterFor("juno"));
        Sound sound;
        sound.quiet(0.2).say(clip).quiet(1.5);
        return only<Listener::Woke>(hearAll(listener, sound)).size();
    };
    CHECK_EQ(heard("hey-momo"), size_t(0));
    CHECK_EQ(heard("hey-juno"), size_t(1));
}

TEST(listenerHoldsAReplyAskedForWhileItRecords) {
    Listener listener(spotterFor("momo"));
    hearAll(listener, Sound().quiet(1).say("command"));
    CHECK(listener.state() == Listener::State::hearing, "recording the command");
    CHECK(!listener.askToSpeak(), "the reply waits while the user is recorded");
    std::vector<Said> heard = hearAll(listener, Sound().quiet(2));
    CHECK_EQ(heard.size(), size_t(2));
    CHECK(heard.size() == 2 && std::holds_alternative<Listener::Recorded>(heard[0].event) && std::holds_alternative<Listener::Speak>(heard[1].event),
          "the recording ends, then the reply may play");
    listener.done();
    CHECK(listener.state() == Listener::State::speaking, "nothing is heard while the held reply plays");
    CHECK_EQ(hearAll(listener, Sound().say("command").quiet(2)).size(), size_t(0));
}

/// Hears the sound as the headset would after waking: the chime starts a tenth of a second after the name is spotted,
/// is heard back through the microphone as it plays, and says it ended once it has. `after` is what is said then.
std::vector<Said> hearWithChime(Listener& listener, Sound before, std::function<void(Sound&)> after) {
    std::vector<float> s = before.withHiss();
    std::vector<float> ring = chime();
    std::vector<Said> heard;
    size_t chimeEnds = 0;
    bool afterAdded = false;
    for (size_t at = 0;; at += Listener::pieceLength) {
        if (chimeEnds && at >= chimeEnds && !afterAdded) {
            listener.chimeEnded();
            Sound rest;
            after(rest);
            std::vector<float> more = rest.withHiss();
            s.resize(std::max(s.size(), at + more.size()), 0.f);
            for (size_t i = 0; i < more.size(); i++) s[at + i] += more[i];
            afterAdded = true;
        }
        if (at + Listener::pieceLength > s.size()) break;
        for (Listener::Event& e : listener.hear(s.data() + at, Listener::pieceLength)) {
            if (std::holds_alternative<Listener::Woke>(e)) {
                listener.chimeStarted();
                size_t from = at + 2 * Listener::pieceLength;
                s.resize(std::max(s.size(), from + ring.size()), 0.f);
                for (size_t i = 0; i < ring.size(); i++) s[from + i] += ring[i];
                chimeEnds = from + ring.size();
            }
            heard.push_back(Said{std::move(e), at + Listener::pieceLength});
        }
    }
    return heard;
}

TEST(listenerDoesNotTakeItsOwnChimeForSpeech) {
    Listener listener(spotterFor("momo"));
    std::vector<Said> heard = hearWithChime(listener, Sound().quiet(1).say("hey-momo").quiet(1), [](Sound& s) { s.quiet(10); });
    CHECK_EQ(only<Listener::Woke>(heard).size(), size_t(1));
    CHECK_EQ(only<Listener::Recorded>(heard).size(), size_t(0));
    CHECK_EQ(only<Listener::NothingSaid>(heard).size(), size_t(1));
}

TEST(listenerTakesACommandSaidAWhileAfterTheChime) {
    Listener listener(spotterFor("momo"));
    size_t spoken = 0;
    std::vector<Said> heard = hearWithChime(listener, Sound().quiet(1).say("hey-momo").quiet(1), [&](Sound& s) {
        s.quiet(1.5).say("also");
        spoken = s.size();
        s.quiet(3);
    });
    auto recorded = only<Listener::Recorded>(heard);
    CHECK_EQ(recorded.size(), size_t(1));
    if (recorded.empty()) return;
    double longer = double(samplesIn(recorded[0].first)) / second;
    CHECK(longer >= double(spoken) / second + 1.2, "the recording holds the command said 1.5 s after the chime (%.1f s long)", longer);
}

namespace {

/// The streamed pieces' samples, end to end.
size_t samplesIn(const std::vector<std::pair<Listener::Streamed, size_t>>& pieces) {
    size_t n = 0;
    for (const auto& [piece, at] : pieces) n += piece.samples.size();
    return n;
}

}  // namespace

TEST(listenerStreamsWhatFollowsItsNameUntilTheTurnIsOver) {
    Listener listener(spotterFor("momo"));
    listener.setMode(Listener::Mode::stream);
    Sound sound;
    sound.quiet(1);
    size_t phrase = sound.size();
    sound.say("command");
    size_t spoken = sound.size();
    sound.quiet(3);
    std::vector<Said> heard = hearAll(listener, sound);
    auto woke = only<Listener::Woke>(heard);
    CHECK_EQ(woke.size(), size_t(1));
    CHECK(!woke.empty() && woke[0].first.streaming, "it says it streams");
    CHECK_EQ(only<Listener::Recorded>(heard).size(), size_t(0));
    CHECK_EQ(only<Listener::NothingSaid>(heard).size(), size_t(0));
    CHECK(listener.state() == Listener::State::hearing, "a pause does not end it");
    auto pieces = only<Listener::Streamed>(heard);
    CHECK(!pieces.empty(), "pieces were streamed");
    if (pieces.empty()) return;
    long begins = long(sound.size() / Listener::pieceLength * Listener::pieceLength) - long(samplesIn(pieces));
    CHECK(begins <= long(phrase) && begins >= long(phrase) - long(second * 3 / 10), "it begins %.2f s from the name",
          double(begins - long(phrase)) / second);
    long firstWord = -1, lastWord = -1;
    for (size_t i = 0; i < pieces.size(); i++) {
        if (!pieces[i].first.speech) continue;
        if (firstWord < 0) firstWord = begins + long(i * Listener::pieceLength);
        lastWord = begins + long((i + 1) * Listener::pieceLength);
    }
    CHECK(firstWord >= long(phrase) + long(second * 3 / 10), "the name is not words (the first word at %.2f s from it)",
          double(firstWord - long(phrase)) / second);
    CHECK(lastWord >= long(spoken) - long(second * 4 / 10) && lastWord <= long(spoken) + long(second * 2 / 10),
          "the last word ends %.2f s from the end of the command", double(lastWord - long(spoken)) / second);
    listener.turnOver();
    CHECK(listener.state() == Listener::State::waiting, "the turn is over");
    CHECK_EQ(only<Listener::Streamed>(hearAll(listener, Sound().quiet(1))).size(), size_t(0));
    CHECK_EQ(only<Listener::Woke>(hearAll(listener, Sound().say("hey-momo").quiet(1))).size(), size_t(1));
}

TEST(listenerStreamsNothingSaidAfterEightSeconds) {
    Listener listener(spotterFor("momo"));
    listener.setMode(Listener::Mode::stream);
    std::vector<Said> heard = hearAll(listener, Sound().quiet(1).say("hey-momo").quiet(10));
    CHECK_EQ(only<Listener::NothingSaid>(heard).size(), size_t(1));
    CHECK_EQ(only<Listener::Cut>(heard).size(), size_t(0));
    size_t words = 0;
    for (const auto& [piece, at] : only<Listener::Streamed>(heard)) words += piece.speech;
    CHECK_EQ(words, size_t(0));
    CHECK(listener.state() == Listener::State::waiting, "waiting for its name again");
}

TEST(listenerStopsStreamingAfterAMinute) {
    Listener listener(spotterFor("momo"));
    listener.setMode(Listener::Mode::stream);
    Sound sound;
    sound.quiet(1).say("command");
    while (sound.size() < 64 * second) sound.quiet(0.3).say("talk");
    std::vector<Said> heard = hearAll(listener, sound);
    auto woke = only<Listener::Woke>(heard);
    auto cut = only<Listener::Cut>(heard);
    CHECK_EQ(woke.size(), size_t(1));
    CHECK_EQ(cut.size(), size_t(1));
    if (woke.empty() || cut.empty()) return;
    double after = double(cut[0].second - woke[0].second) / second;
    CHECK(after >= 59.9 && after <= 60.2, "cut %.2f s after the name", after);
    CHECK_EQ(only<Listener::NothingSaid>(heard).size(), size_t(0));
}

TEST(listenerStreamingDoesNotTakeItsChimeForWords) {
    Listener listener(spotterFor("momo"));
    listener.setMode(Listener::Mode::stream);
    std::vector<Said> heard = hearWithChime(listener, Sound().quiet(1).say("hey-momo").quiet(1), [](Sound& s) { s.quiet(10); });
    size_t words = 0;
    for (const auto& [piece, at] : only<Listener::Streamed>(heard)) words += piece.speech;
    CHECK_EQ(words, size_t(0));
    CHECK_EQ(only<Listener::NothingSaid>(heard).size(), size_t(1));
}

TEST(listenerHearsItsNameWhileAnInterruptibleReplyStreams) {
    auto wakes = [](Listener::Mode mode, bool interruptible) {
        Listener listener(spotterFor("momo"));
        listener.setMode(mode);
        hearAll(listener, Sound().quiet(0.5));
        listener.replyStreams(interruptible);
        return only<Listener::Woke>(hearAll(listener, Sound().quiet(0.3).say("hey-momo").quiet(1))).size();
    };
    CHECK_EQ(wakes(Listener::Mode::stream, true), size_t(1));
    CHECK_EQ(wakes(Listener::Mode::stream, false), size_t(0));
    CHECK_EQ(wakes(Listener::Mode::record, true), size_t(0));
}

TEST(listenerStreamsNothingOfTheNameAndThePauseAfterIt) {
    Listener listener(spotterFor("momo"));
    listener.setMode(Listener::Mode::stream);
    Sound sound;
    sound.quiet(1).say("hey-momo").quiet(1.5);
    size_t asked = sound.size();
    sound.say("more").quiet(2);
    std::vector<Said> heard = hearAll(listener, sound);
    CHECK_EQ(only<Listener::Woke>(heard).size(), size_t(1));
    CHECK_EQ(only<Listener::NothingSaid>(heard).size(), size_t(0));
    auto pieces = only<Listener::Streamed>(heard);
    CHECK(!pieces.empty(), "what was asked was streamed");
    if (pieces.empty()) return;
    long begins = long(sound.size() / Listener::pieceLength * Listener::pieceLength) - long(samplesIn(pieces));
    CHECK(begins >= long(asked) - long(second), "it begins %.2f s before the request, after the name and most of the pause",
          double(long(asked) - begins) / second);
    CHECK(begins <= long(asked), "and before the request (%.2f s after it)", double(begins - long(asked)) / second);
}
