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

// A speaker who does not stop after the name leaves no dip in the sound between it and the request.
TEST(listenerRecordsARequestSaidStraightOnFromItsName) {
    for (const char* clip : {"straight", "straight-hi"}) {
        Listener listener(spotterFor("momo"));
        Sound sound;
        sound.quiet(1);
        size_t phrase = sound.size();
        sound.say(clip);
        size_t spoken = sound.size();
        sound.quiet(3);
        std::vector<Said> heard = hearAll(listener, sound);
        CHECK_EQ(only<Listener::Woke>(heard).size(), size_t(1));
        CHECK_EQ(only<Listener::NothingSaid>(heard).size(), size_t(0));
        auto recorded = only<Listener::Recorded>(heard);
        CHECK_EQ(recorded.size(), size_t(1));
        if (recorded.empty()) continue;
        long begins = long(recorded[0].second) - long(samplesIn(recorded[0].first));
        CHECK(begins <= long(phrase), "%s: the recording begins %.2f s into the name", clip, double(begins - long(phrase)) / second);
        CHECK(recorded[0].second >= spoken + second && recorded[0].second <= spoken + second * 15 / 10, "%s: handed over %.2f s after the request",
              clip, double(long(recorded[0].second) - long(spoken)) / second);
    }
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
    std::vector<float> ring = ownSound("momo_chime");
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
    CHECK_EQ(only<Listener::Woke>(heard).size(), size_t(1));
    CHECK_EQ(only<Listener::Began>(heard).size(), size_t(1));
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
    CHECK(listener.state() == Listener::State::open, "the turn is over and the conversation open");
    CHECK_EQ(only<Listener::Streamed>(hearAll(listener, Sound().quiet(1))).size(), size_t(0));
    std::vector<Said> next = hearAll(listener, Sound().say("more").quiet(1));
    CHECK_EQ(only<Listener::Woke>(next).size(), size_t(0));
    CHECK_EQ(only<Listener::Began>(next).size(), size_t(1));
    CHECK(!only<Listener::Streamed>(next).empty(), "the next turn streams without the name");
}

TEST(listenerStreamsARequestSaidStraightOnFromItsNameWhole) {
    for (const char* clip : {"straight", "straight-hi"}) {
        Listener listener(spotterFor("momo"));
        listener.setMode(Listener::Mode::stream);
        Sound sound;
        sound.quiet(1);
        size_t phrase = sound.size();
        sound.say(clip);
        size_t spoken = sound.size();
        sound.quiet(2);
        std::vector<Said> heard = hearAll(listener, sound);
        auto woke = only<Listener::Woke>(heard);
        auto began = only<Listener::Began>(heard);
        CHECK_EQ(woke.size(), size_t(1));
        CHECK_EQ(began.size(), size_t(1));
        if (woke.empty() || began.empty()) continue;
        CHECK(woke[0].second < spoken, "%s: the name is spotted while the request is still being said", clip);
        CHECK_EQ(began[0].second, woke[0].second);
        CHECK(listener.state() == Listener::State::hearing, "%s: the turn streams until the service says it is over", clip);
        auto pieces = only<Listener::Streamed>(heard);
        long begins = long(sound.size() / Listener::pieceLength * Listener::pieceLength) - long(samplesIn(pieces));
        CHECK(begins <= long(phrase) && begins >= long(phrase) - long(second * 3 / 10), "%s: it begins %.2f s from the name, so none of the request is cut",
              clip, double(begins - long(phrase)) / second);
    }
}

// The spotter also wakes on what only sounds like the name, so the service checks the sound of each wake.
TEST(listenerHandsOverTheSoundThatWokeIt) {
    for (const char* clip : {"hey-momo", "straight"}) {
        Listener listener(spotterFor("momo"));
        listener.setMode(Listener::Mode::stream);
        Sound sound;
        sound.say("before").quiet(1);
        size_t phrase = sound.size();
        sound.say(clip).quiet(2);
        auto woke = only<Listener::Woke>(hearAll(listener, sound));
        CHECK_EQ(woke.size(), size_t(1));
        if (woke.empty()) continue;
        long begins = long(woke[0].second) - long(woke[0].first.sound.size());
        CHECK(begins <= long(phrase) && begins >= long(phrase) - long(second * 3 / 10), "%s: the sound begins %.2f s from the name, and nothing said before it is in it",
              clip, double(begins - long(phrase)) / second);
        CHECK(woke[0].first.sound.size() <= second * 2, "%s: %.2f s of sound", clip, double(woke[0].first.sound.size()) / second);
    }
}

TEST(listenerClosesWhatAWakeOpenedWhenItWasNotTheName) {
    Listener listener(spotterFor("momo"));
    listener.setMode(Listener::Mode::stream);
    // Told before anything is said, the conversation closes and what follows is not streamed.
    hearAll(listener, Sound().quiet(1).say("hey-momo").quiet(1));
    CHECK(listener.state() == Listener::State::open, "the name opened the conversation");
    listener.notNamed();
    CHECK(listener.state() == Listener::State::waiting, "it waits for its name again");
    std::vector<Said> after = hearAll(listener, Sound().say("also").quiet(1));
    CHECK_EQ(only<Listener::Began>(after).size(), size_t(0));
    CHECK_EQ(only<Listener::Streamed>(after).size(), size_t(0));
    // Told while a turn streams, the turn stops.
    hearAll(listener, Sound().quiet(1).say("command"));
    CHECK(listener.state() == Listener::State::hearing, "a turn streams");
    listener.notNamed();
    CHECK(listener.state() == Listener::State::waiting, "the turn is dropped");
    CHECK_EQ(only<Listener::Streamed>(hearAll(listener, Sound().say("also").quiet(1))).size(), size_t(0));
    // And its name still wakes it.
    CHECK_EQ(only<Listener::Woke>(hearAll(listener, Sound().quiet(1).say("hey-momo").quiet(1))).size(), size_t(1));
    // Recording, there is nothing to close: the service checks the recording itself.
    Listener recorder(spotterFor("momo"));
    hearAll(recorder, Sound().quiet(1).say("command"));
    recorder.notNamed();
    CHECK(recorder.state() == Listener::State::hearing, "a recording goes on");
}

TEST(listenerClosesTheConversationAfterEightSecondsOfQuiet) {
    Listener listener(spotterFor("momo"));
    listener.setMode(Listener::Mode::stream);
    std::vector<Said> heard = hearAll(listener, Sound().quiet(1).say("hey-momo").quiet(10));
    auto woke = only<Listener::Woke>(heard);
    auto closed = only<Listener::Closed>(heard);
    CHECK_EQ(woke.size(), size_t(1));
    CHECK_EQ(closed.size(), size_t(1));
    CHECK_EQ(only<Listener::Began>(heard).size(), size_t(0));
    CHECK_EQ(only<Listener::Streamed>(heard).size(), size_t(0));
    CHECK_EQ(only<Listener::NothingSaid>(heard).size(), size_t(0));
    if (!woke.empty() && !closed.empty()) {
        double after = double(closed[0].second - woke[0].second) / second;
        CHECK(after >= 7.9 && after <= 8.5, "closed %.2f s after the name", after);
    }
    CHECK(listener.state() == Listener::State::waiting, "waiting for its name again");
    CHECK_EQ(only<Listener::Woke>(hearAll(listener, Sound().quiet(0.5).say("hey-momo").quiet(1))).size(), size_t(1));
}

TEST(listenerClosesEightSecondsAfterMomoStopsTalking) {
    Listener listener(spotterFor("momo"));
    listener.setMode(Listener::Mode::stream);
    Sound asked;
    asked.quiet(1).say("command").quiet(1);
    asked.samples.resize((asked.size() / Listener::pieceLength + 1) * Listener::pieceLength, 0.f);
    hearAll(listener, asked);
    listener.turnOver();
    hearAll(listener, Sound().quiet(3));
    listener.replyStreams();
    std::vector<Said> speaking = hearAll(listener, Sound().quiet(12));
    CHECK_EQ(only<Listener::Closed>(speaking).size(), size_t(0));
    listener.replyEnded();
    std::vector<Said> after = hearAll(listener, Sound().quiet(10));
    auto closed = only<Listener::Closed>(after);
    CHECK_EQ(closed.size(), size_t(1));
    if (!closed.empty()) {
        double at = double(closed[0].second) / second;
        CHECK(at >= 8.2 && at <= 8.5, "closed %.2f s after Momo's voice ended, its echo 0.3 s of it", at);
    }
}

TEST(listenerKeepsTheConversationOpenWhileMomoThinks) {
    Listener listener(spotterFor("momo"));
    listener.setMode(Listener::Mode::stream);
    Sound asked;
    asked.quiet(1).say("command").quiet(1);
    asked.samples.resize((asked.size() / Listener::pieceLength + 1) * Listener::pieceLength, 0.f);
    hearAll(listener, asked);
    listener.turnOver();
    listener.momoThinks(true);
    CHECK_EQ(only<Listener::Closed>(hearAll(listener, Sound().quiet(12))).size(), size_t(0));
    CHECK(listener.state() == Listener::State::open, "open 12 s on while Momo thinks");
    listener.momoThinks(false);
    auto closed = only<Listener::Closed>(hearAll(listener, Sound().quiet(10)));
    CHECK_EQ(closed.size(), size_t(1));
    if (!closed.empty()) {
        double at = double(closed[0].second) / second;
        CHECK(at >= 7.9 && at <= 8.2, "closed %.2f s after Momo stopped thinking", at);
    }
}

TEST(listenerBeginsATurnWhenTheUserTalksOverMomo) {
    Listener listener(spotterFor("momo"));
    listener.setMode(Listener::Mode::stream);
    hearAll(listener, Sound().quiet(0.5));
    listener.replyStreams();
    CHECK(listener.state() == Listener::State::open, "Momo's voice opens the conversation");
    Sound sound;
    sound.quiet(0.5);
    size_t word = sound.size();
    sound.say("more").quiet(1);
    std::vector<Said> heard = hearAll(listener, sound);
    auto began = only<Listener::Began>(heard);
    CHECK_EQ(began.size(), size_t(1));
    CHECK_EQ(only<Listener::Woke>(heard).size(), size_t(0));
    CHECK(listener.state() == Listener::State::hearing, "the turn streams");
    if (began.empty()) return;
    double into = double(long(began[0].second) - long(word)) / second;
    CHECK(into >= 0.2 && into <= 0.4, "Momo is cut off %.2f s into the word", into);
    auto pieces = only<Listener::Streamed>(heard);
    long begins = long(sound.size() / Listener::pieceLength * Listener::pieceLength) - long(samplesIn(pieces));
    CHECK(begins <= long(word) && begins >= long(word) - long(second), "the turn goes out from %.2f s before the word",
          double(long(word) - begins) / second);
}

TEST(listenerTakesNoKnockForATurn) {
    Listener listener(spotterFor("momo"));
    listener.setMode(Listener::Mode::stream);
    hearAll(listener, Sound().quiet(0.5));
    listener.replyStreams();
    Sound sound;
    sound.quiet(0.5);
    for (int i = 0; i < int(second * 15 / 100); i++) sound.samples.push_back(i % 2 ? 0.3f : -0.3f);
    sound.quiet(1);
    std::vector<Said> heard = hearAll(listener, sound);
    CHECK_EQ(only<Listener::Began>(heard).size(), size_t(0));
    CHECK(listener.state() == Listener::State::open, "still open");
}

TEST(listenerRecordingAgainClosesTheConversation) {
    Listener listener(spotterFor("momo"));
    listener.setMode(Listener::Mode::stream);
    hearAll(listener, Sound().quiet(1).say("hey-momo").quiet(1));
    CHECK(listener.state() == Listener::State::open, "the name opens the conversation");
    listener.setMode(Listener::Mode::record);
    CHECK(listener.state() == Listener::State::waiting, "closed");
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
    CHECK_EQ(only<Listener::Began>(heard).size(), size_t(0));
    CHECK_EQ(only<Listener::Closed>(heard).size(), size_t(1));
}

TEST(listenerRecordingHearsNothingWhileAReplyStreams) {
    Listener listener(spotterFor("momo"));
    hearAll(listener, Sound().quiet(0.5));
    listener.replyStreams();
    std::vector<Said> heard = hearAll(listener, Sound().quiet(0.3).say("hey-momo").quiet(1));
    CHECK_EQ(only<Listener::Woke>(heard).size(), size_t(0));
    CHECK(listener.state() == Listener::State::speaking, "speaking");
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
    CHECK_EQ(only<Listener::Began>(heard).size(), size_t(1));
    auto pieces = only<Listener::Streamed>(heard);
    CHECK(!pieces.empty(), "what was asked was streamed");
    if (pieces.empty()) return;
    long begins = long(sound.size() / Listener::pieceLength * Listener::pieceLength) - long(samplesIn(pieces));
    CHECK(begins >= long(asked) - long(second), "it begins %.2f s before the request, after the name and most of the pause",
          double(long(asked) - begins) / second);
    CHECK(begins <= long(asked), "and before the request (%.2f s after it)", double(begins - long(asked)) / second);
}

TEST(momosOwnSoundsAreShortSoftAndApart) {
    auto peak = [](const std::vector<float>& s, size_t from, size_t to) {
        float most = 0;
        for (size_t i = from; i < std::min(to, s.size()); i++) most = std::max(most, std::abs(s[i]));
        return most;
    };
    std::vector<float> ring = ownSound("momo_chime"), tone = ownSound("momo_sent"), loop = ownSound("momo_thinking");
    double chimeSeconds = double(ring.size()) / Listener::rate, toneSeconds = double(tone.size()) / Listener::rate,
           loopSeconds = double(loop.size()) / Listener::rate;
    CHECK(chimeSeconds >= 0.2 && chimeSeconds <= 0.3, "the chime lasts %.2f s: words are not heard while it plays", chimeSeconds);
    CHECK(toneSeconds >= 0.15 && toneSeconds <= 0.2, "the sent tone lasts %.2f s", toneSeconds);
    CHECK(loopSeconds >= 1.2 && loopSeconds <= 2.4, "the thinking loop lasts %.2f s", loopSeconds);
    CHECK(peak(tone, 0, tone.size()) <= peak(ring, 0, ring.size()), "the tone no louder than the chime");
    CHECK(peak(loop, 0, loop.size()) < peak(tone, 0, tone.size()) / 2, "the loop quieter than the tone (%.3f)", peak(loop, 0, loop.size()));
    CHECK(peak(loop, 0, second / 20) < 0.001f && peak(loop, loop.size() - second / 20, loop.size()) < 0.001f,
          "the loop begins and ends in silence, so it repeats without a seam");
    CHECK(tone != std::vector<float>(ring.begin(), ring.begin() + long(std::min(ring.size(), tone.size()))), "the tone is not the chime");
}
