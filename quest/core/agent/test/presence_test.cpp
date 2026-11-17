// Momo's presence apart from drawing it: where Momo rests as the head turns, how it looks in each state, which words
// show beside it, and the agents' lines above them. Each is driven frame by frame at the headset's 90 frames a second.
#include "support.h"

#include <cmath>

#include "../presence_look.h"

using namespace agent;
using S = Presence::State;

namespace {

constexpr float frame = 1.f / 90;

/// The head at eye height, turned `yaw` degrees right and `pitch` up.
Mat4 headAt(float yaw, float pitch) {
    float y = yaw * float(M_PI) / 180, p = pitch * float(M_PI) / 180;
    Quat q = Quat::angleAxis(-y, {0, 1, 0}) * Quat::angleAxis(p, {1, 0, 0});
    return Mat4::trs({0, 1.5f, 0}, q, {1, 1, 1});
}

/// Holds the head still for `seconds`; returns the most the orb turned round the eyes in any one frame, degrees.
float hold(Follow& f, float yaw, float pitch, float seconds) {
    const Vec3 eye{0, 1.5f, 0};
    float most = 0;
    for (float t = 0; t < seconds; t += frame) {
        Vec3 before = normalize(f.position() - eye);
        f.update(headAt(yaw, pitch), frame);
        float turned = std::acos(std::min(1.f, dot(before, normalize(f.position() - eye)))) * 180 / float(M_PI);
        most = std::max(most, turned);
    }
    return most;
}

Presence say(S state, std::string user = "", std::string momo = "", bool final = true, float level = 0) {
    Presence p;
    p.state = state;
    p.userText = std::move(user);
    p.userFinal = final;
    p.momoText = std::move(momo);
    p.level = level;
    return p;
}

/// Each character a centimetre wide, so a 20 cm line holds 20.
Caption caption() {
    return Caption([](const std::string& s, Speaker) { return 0.01f * float(s.size()); }, 0.2f);
}

double clock = 0;

void run(Caption& c, const Presence& p, double seconds) {
    for (double t = 0; t < seconds; t += frame) {
        clock += frame;
        c.update(p, "Momo", clock, frame);
    }
}

/// The lines at rest, top to bottom.
std::vector<const Caption::Line*> resting(const Caption& c) {
    std::vector<const Caption::Line*> out;
    for (const Caption::Line& l : c.lines()) {
        if (l.toOpacity > 0) out.push_back(&l);
    }
    std::sort(out.begin(), out.end(), [](const Caption::Line* a, const Caption::Line* b) { return a->toY > b->toY; });
    return out;
}

const Caption::Line* shown(const Caption& c, const std::string& text) {
    for (const Caption::Line& l : c.lines()) {
        if (l.text == text) return &l;
    }
    return nullptr;
}

}  // namespace

TEST(theOrbRestsLowAndToTheLeftOfAhead) {
    Follow f;
    f.update(headAt(0, 0), frame);
    CHECK(std::fabs(f.pitch() + Follow::below) < 0.01f, "pitch %.2f", double(f.pitch()));
    CHECK(std::fabs(f.yaw() - Follow::aside) < 0.01f, "yaw %.2f", double(f.yaw()));
    Vec3 eye{0, 1.5f, 0};
    CHECK(std::fabs(length(f.position() - eye) - Follow::distance) < 0.001f, "%.3f m away", double(length(f.position() - eye)));
    Vec3 facing = f.orientation().act({0, 0, 1});
    CHECK(dot(facing, normalize(eye - f.position())) > 0.9999f, "its face points at the eyes");
}

TEST(aTurnInsideTheSlackLeavesTheOrbWhereItIs) {
    Follow f;
    f.update(headAt(0, 0), frame);
    hold(f, 20, -10, 3);
    CHECK(std::fabs(f.yaw() - Follow::aside) < 0.01f, "yaw %.2f", double(f.yaw()));
    CHECK(std::fabs(f.pitch() + Follow::below) < 0.01f, "pitch %.2f", double(f.pitch()));
}

TEST(aGlanceShorterThanTheDelayLeavesTheOrbWhereItIs) {
    Follow f;
    f.update(headAt(0, 0), frame);
    hold(f, 50, 0, Follow::delay - 0.1f);
    hold(f, 0, 0, 2);
    CHECK(std::fabs(f.yaw() - Follow::aside) < 0.01f, "yaw %.2f", double(f.yaw()));
}

TEST(aTurnHeldBringsTheOrbRoundGentlyWithoutOvershooting) {
    Follow f;
    f.update(headAt(0, 0), frame);
    hold(f, 70, 0, Follow::delay - 0.05f);
    CHECK(std::fabs(f.yaw() - Follow::aside) < 0.01f, "still waiting out the delay: yaw %.2f", double(f.yaw()));
    float most = 0, furthest = -1e9f;
    for (float t = 0; t < 3; t += frame) {
        most = std::max(most, hold(f, 70, 0, frame));
        furthest = std::max(furthest, f.yaw());
    }
    float target = 70 + Follow::aside;
    CHECK(std::fabs(f.yaw() - target) < 0.6f, "came to rest at %.2f, not %.2f", double(f.yaw()), double(target));
    CHECK(furthest <= target + 0.01f, "went past to %.2f", double(furthest));
    CHECK(most <= Follow::fastest * frame + 0.01f, "turned %.2f degrees in one frame", double(most));
    CHECK(!f.moving(), "at rest");
}

TEST(theOrbTurnsTheShortWayRoundBehindTheUser) {
    Follow f;
    f.update(headAt(150, 0), frame);
    float most = hold(f, -150, 0, 3);
    CHECK(std::fabs(f.yaw() - (-150 + Follow::aside)) < 0.6f, "yaw %.2f", double(f.yaw()));
    CHECK(most < 10, "it went the long way: %.1f degrees in a frame", double(most));
}

TEST(lookingUpTheOrbStaysBelowTheOpenCard) {
    Follow f;
    f.update(headAt(0, 0), frame);
    for (float pitch : {20.f, 45.f, 70.f}) {
        hold(f, 0, pitch, 3);
        CHECK(f.pitch() <= Follow::highest + 0.01f, "looking up %.0f degrees it rose to %.2f", double(pitch), double(f.pitch()));
    }
}

TEST(lookingDownAtTheOrbToReadItLeavesItWhereItIs) {
    Follow f;
    f.update(headAt(0, 0), frame);
    for (float pitch : {-Follow::below, -45.f, -60.f}) {
        hold(f, Follow::aside, pitch, 3);
        CHECK(std::fabs(f.pitch() + Follow::below) < 0.01f, "looking %.0f degrees down it moved to %.2f", double(pitch), double(f.pitch()));
    }
    hold(f, 0, -80, 3);
    CHECK(f.pitch() < -Follow::below - 20, "looking right down at the floor, it comes down too: %.2f", double(f.pitch()));
    CHECK(f.pitch() >= Follow::lowest - 0.01f, "but no lower than %.0f: %.2f", double(Follow::lowest), double(f.pitch()));
}

TEST(theUsersWordsStreamInAndTheFinalTextReplacesThePartials) {
    Caption c = caption();
    run(c, say(S::waiting), 0.5);
    run(c, say(S::listening), 0.5);
    CHECK(resting(c).size() == 1 && resting(c)[0]->text == "Listening…", "listening, before any words");
    bool overlapped = false;
    for (int f = 0; f < 30; f++) {
        run(c, say(S::listening, "what does", "", false), frame);
        const Caption::Line* was = shown(c, "Listening…");
        const Caption::Line* now = shown(c, "what does");
        overlapped = overlapped || (was && now && was->opacity > 0.03f && now->opacity > 0.03f);
    }
    CHECK(!overlapped, "Listening… and the first words never stand over each other");
    const Caption::Line* partial = shown(c, "what does");
    CHECK(partial && partial->who == Speaker::user, "the partial shows as the user's");
    int key = partial ? partial->key : -1;
    CHECK(partial && partial->opacity < 0.85f, "a partial is a little faint: %.2f", partial ? double(partial->opacity) : 0.0);
    run(c, say(S::listening, "What does a dolly", "", false), 0.5);
    auto rest = resting(c);
    CHECK(rest.size() == 1 && rest[0]->text == "What does a dolly" && rest[0]->key == key, "the partial's line takes the new words");
    run(c, say(S::listening, "What does a dolly zoom do?", "", true), 0.5);
    rest = resting(c);
    CHECK(rest.size() == 2 && rest[0]->key == key, "the first line keeps its place as the words grow");
    CHECK(rest.size() == 2 && rest[1]->text == "zoom do?", "the rest wraps under it");
    CHECK(!shown(c, "what does"), "the partial is gone");
    CHECK(rest.size() == 2 && rest[0]->opacity < rest[1]->opacity, "the upper line is fainter");
}

TEST(thinkingShowsUnderTheQuestionAndMomosWordsTakeItsPlace) {
    Caption c = caption();
    run(c, say(S::listening, "Why the dread?"), 0.5);
    run(c, say(S::sent, "Why the dread?"), 0.3);
    run(c, say(S::thinking, "Why the dread?"), 0.5);
    auto rest = resting(c);
    CHECK(rest.size() == 2 && rest[0]->who == Speaker::user && rest[1]->text == "Thinking…", "the question above, Thinking… under it");
    bool overlapped = false;
    for (int f = 0; f < 45; f++) {
        run(c, say(S::responding, "Why the dread?", "The room stretches."), frame);
        const Caption::Line* was = shown(c, "Thinking…");
        const Caption::Line* now = shown(c, "The room stretches.");
        overlapped = overlapped || (was && now && was->opacity > 0.03f && now->opacity > 0.03f);
    }
    CHECK(!overlapped, "Thinking… and Momo's first words never stand over each other");
    rest = resting(c);
    CHECK(rest.size() == 2 && rest[1]->who == Speaker::momo && rest[1]->text == "The room stretches.", "Momo's words under the question");
    run(c, say(S::responding, "Why the dread?", "The room stretches."), 1);
    CHECK(!shown(c, "Thinking…"), "Thinking… has faded");
}

TEST(aLongReplyScrollsAndOnlyTheLastTwoLinesRest) {
    Caption c = caption();
    run(c, say(S::listening, "Why?"), 0.3);
    std::string reply = "It pulls the background away while the subject stays the same size so the room stretches";
    std::string spoken;
    std::vector<std::string> words;
    for (size_t at = 0; at < reply.size();) {
        size_t end = reply.find(' ', at);
        words.push_back(reply.substr(at, end == std::string::npos ? std::string::npos : end - at));
        at = end == std::string::npos ? reply.size() : end + 1;
    }
    for (const std::string& w : words) {
        spoken += (spoken.empty() ? "" : " ") + w;
        run(c, say(S::responding, "Why?", spoken), 0.25);
        auto rest = resting(c);
        CHECK(rest.size() <= size_t(Caption::rows), "%zu lines at rest", rest.size());
        for (const Caption::Line* l : rest) CHECK(l->width <= 0.2f + 1e-4f, "\"%s\" is wider than a line may be", l->text.c_str());
    }
    run(c, say(S::responding, "Why?", spoken), 1);
    auto rest = resting(c);
    CHECK(rest.size() == 2 && rest[0]->text == "so the room" && rest[1]->text == "stretches", "the last words rest at the bottom");
    for (const Caption::Line& l : c.lines()) {
        CHECK(l.toOpacity > 0 || l.opacity < 0.05f, "an older line \"%s\" still shows at %.2f", l.text.c_str(), double(l.opacity));
    }
}

TEST(theReplyLingersThenFadesAndNoHintFollowsATurnWithWords) {
    Caption c = caption();
    run(c, say(S::listening, "Why?"), 0.3);
    run(c, say(S::responding, "Why?", "Because."), 1);
    run(c, say(S::waiting), Caption::linger - 1);
    CHECK(resting(c).size() == 2, "still there a while after: %zu lines", resting(c).size());
    run(c, say(S::waiting), 2);
    CHECK(c.lines().empty(), "gone after %g s: %zu lines left", Caption::linger, c.lines().size());
    run(c, say(S::waiting), 3);
    CHECK(c.lines().empty(), "no hint after a turn with words");
}

TEST(theHintShowsAtFirstAndAfterAWakeWithNothingSaid) {
    Caption c = caption();
    run(c, say(S::waiting), 0.5);
    auto rest = resting(c);
    CHECK(rest.size() == 1 && rest[0]->text == "Say “Hey Momo”" && rest[0]->who == Speaker::status, "the hint at first");
    run(c, say(S::waiting), Caption::hintFor + 0.5);
    CHECK(c.lines().empty(), "the hint goes after %g s", Caption::hintFor);
    run(c, say(S::listening), 2);
    run(c, say(S::waiting), 0.5);
    CHECK(resting(c).size() == 1 && resting(c)[0]->text == "Say “Hey Momo”", "woken with nothing said, the hint comes back");
}

TEST(theOceanDrawsBackWhileMomoListensThinksOrSpeaks) {
    for (S state : {S::listening, S::open, S::sent, S::thinking, S::responding}) {
        CHECK(say(state).conversing(), "conversing in state %d", int(state));
    }
    for (S state : {S::off, S::waiting, S::working}) CHECK(!say(state).conversing(), "not in state %d", int(state));
}

TEST(theOpenConversationShowsListeningUnderTheReplyAndClosingBringsTheHint) {
    Caption c = caption();
    run(c, say(S::listening, "Why?"), 0.3);
    run(c, say(S::responding, "Why?", "Because the room stretches."), 1);
    run(c, say(S::open), 0.5);
    auto rest = resting(c);
    CHECK(rest.size() == 2 && rest[0]->who == Speaker::momo && rest[1]->text == "Listening…", "the reply's last line over Listening…");
    run(c, say(S::open), 7.5);
    rest = resting(c);
    CHECK(rest.size() == 1 && rest[0]->text == "Listening…", "Listening… while the conversation stays open");
    run(c, say(S::listening, "And Jaws?", "", false), 0.6);
    CHECK(shown(c, "And Jaws?") && !shown(c, "Listening…"), "the user's words take Listening…'s place, as in a turn");
    run(c, say(S::responding, "And Jaws?", "The beach stretches."), 1);
    run(c, say(S::open), 8);
    run(c, say(S::waiting), 0.5);
    rest = resting(c);
    CHECK(rest.size() == 1 && rest[0]->text == "Say “Hey Momo”", "closed, the hint says how to open it again");
}

TEST(theNextTurnPushesTheLastReplyUpAndOut) {
    Caption c = caption();
    run(c, say(S::listening, "Why?"), 0.3);
    run(c, say(S::responding, "Why?", "Because the room stretches."), 1);
    run(c, say(S::waiting), 1);
    run(c, say(S::listening), 0.5);
    auto rest = resting(c);
    CHECK(rest.size() == 2 && rest[0]->who == Speaker::momo && rest[1]->text == "Listening…", "the reply's last line over Listening…");
    run(c, say(S::listening, "And in Jaws, how does the shot work?", "", false), 0.6);
    rest = resting(c);
    CHECK(rest.size() == 2 && rest[0]->who == Speaker::user && rest[1]->who == Speaker::user, "the new question fills both lines");
    const Caption::Line* old = shown(c, "room stretches.");
    CHECK(!old || (old->toOpacity == 0 && old->y > rest[0]->y), "the reply's line rises out above them");
}

TEST(aNoticeTakesTheWordsPlaceAndShowsMomoEvenWhenOff) {
    Caption c = caption();
    run(c, say(S::listening, "Why?"), 0.3);
    Presence p = say(S::thinking, "Why?");
    p.notice = "Can’t reach Momo";
    run(c, p, 0.5);
    auto rest = resting(c);
    CHECK(rest.size() == 1 && rest[0]->text == "Can’t reach Momo" && rest[0]->who == Speaker::status, "the notice alone");
    run(c, say(S::thinking, "Why?"), 0.5);
    CHECK(!shown(c, "Can’t reach Momo") || shown(c, "Can’t reach Momo")->toOpacity == 0, "gone with the notice");
    Face f;
    Presence away = say(S::off);
    away.notice = "Can’t reach Momo";
    for (int i = 0; i < 180; i++) f.update(away, frame);
    CHECK(f.look().shown > 0.99f, "Momo shows to say it: %.2f", double(f.look().shown));
    for (int i = 0; i < 180; i++) f.update(say(S::off), frame);
    CHECK(f.look().shown < 0.01f, "and goes after: %.2f", double(f.look().shown));
}

TEST(offTakesEveryWordAway) {
    Caption c = caption();
    run(c, say(S::listening, "Why?"), 0.3);
    run(c, say(S::thinking, "Why?"), 0.3);
    run(c, say(S::off), 1);
    CHECK(c.lines().empty(), "%zu lines left", c.lines().size());
}

TEST(workingSaysNothingInTheWordsBesideMomo) {
    Caption c = caption();
    run(c, say(S::listening, "Why?"), 0.3);
    run(c, say(S::responding, "Why?", "Because."), 1);
    Presence p = say(S::working, "", "Because.");
    p.agents = {AgentLine{"scout", "Scout", "Searching films", false}};
    run(c, p, 1);
    auto rest = resting(c);
    CHECK(rest.size() == 2 && rest[0]->text == "Why?" && rest[1]->text == "Because.", "the turn's words, and only those");
    run(c, p, Caption::linger);
    CHECK(resting(c).empty(), "then nothing: what the agents do is on their own lines");
}

namespace {

Presence searching(S state, float level = 0) {
    Presence p = say(state, "", "", true, level);
    p.agents = {AgentLine{"scout", "Scout", "Searching films", false}};
    return p;
}

void run(Face& f, const Presence& p, float seconds) {
    for (float t = 0; t < seconds; t += frame) f.update(p, frame);
}

}  // namespace

TEST(quietMomoIsAWhiteRingAndItsOwnVoicePartsItIntoColour) {
    Face f;
    run(f, say(S::waiting), 2);
    CHECK(f.look().divergence < 1e-4f && std::fabs(f.look().distortion - Face::quietDistortion) < 1e-3f,
          "waiting: the three rings as one, white, gently bent (%.3f, %.2f)", double(f.look().divergence), double(f.look().distortion));
    run(f, say(S::waiting, "", "", true, 0.9f), 1);
    CHECK(f.look().voice < 0.01f, "the room's noise does not move it: %.2f", double(f.look().voice));
    run(f, say(S::listening, "", "", true, 0.9f), 0.5f);
    float bent = f.look().distortion - Face::quietDistortion;
    CHECK(bent > 1.5f && f.look().scale > 1.1f, "listening, the ring moves with the user's voice: %.2f", double(f.look().distortion));
    CHECK(f.look().divergence < 0.05f, "and stays white: %.3f", double(f.look().divergence));
    run(f, say(S::responding, "", "", true, 0.9f), 0.5f);
    CHECK(f.look().divergence > 1, "Momo's own voice parts it into colour: %.2f", double(f.look().divergence));
    float own = f.look().distortion - Face::quietDistortion;
    CHECK(f.look().distortion > 5 && std::fabs(bent / own - Face::userMorph) < 0.05f,
          "and bends it all the way, the user's %.1f as far: %.2f against %.2f", double(Face::userMorph), double(bent), double(own));
    run(f, say(S::responding, "", "", true, 0), 1.f / 18);
    CHECK(f.look().voice > 0.5f, "and falls away slower than it rose (%.2f), as AgentSphere's envelope does", double(f.look().voice));
    run(f, say(S::responding), 1.5f);
    CHECK(f.look().voice < 0.01f && f.look().divergence < 0.01f, "quiet again, white again");
}

TEST(momoBlinksAsCurioCitysDoes) {
    Face f;
    std::vector<float> starts, shut;
    bool closed = false;
    float t = 0;
    for (; t < 60; t += frame) {
        f.update(say(S::waiting), frame);
        bool now = f.look().openness < 0.5f;
        if (now && !closed) starts.push_back(t);
        if (now) shut.push_back(t);
        closed = now;
    }
    CHECK(starts.size() >= 13 && starts.size() <= 33, "%zu blinks in a minute, one every 1.8 to 4 s", starts.size());
    bool spaced = true;
    for (size_t i = 1; i < starts.size(); i++) spaced = spaced && starts[i] - starts[i - 1] >= Face::blinkMin && starts[i] - starts[i - 1] <= Face::blinkMax + 0.2f;
    CHECK(spaced, "each 1.8 to 4 s after the last");
    CHECK(shut.size() <= starts.size() * 7, "each shut for less than its 0.1 s: %zu frames for %zu blinks", shut.size(), starts.size());
}

TEST(searchingMomoWearsAMonocleAndGlancesAboutWiderAndSlowerThanItDarts) {
    // How far the eyes go, how long each move of theirs takes (s, the median), and how often they cross from side to side.
    auto watch = [](const Presence& p, float& widest, float& moving, int& sides) {
        Face f;
        widest = 0;
        sides = 0;
        int side = 0, frames = 0;
        std::vector<float> moves;
        Vec2 was;
        for (float t = 0; t < 30; t += frame) {
            f.update(p, frame);
            widest = std::max(widest, std::fabs(f.look().gaze.x));
            bool now = length(f.look().gaze - was) / frame > 0.5f;
            if (now) frames++;
            if (!now && frames > 0) moves.push_back(float(frames) * frame), frames = 0;
            was = f.look().gaze;
            int at = f.look().gaze.x < -0.12f ? -1 : f.look().gaze.x > 0.12f ? 1 : 0;
            if (at != 0 && at != side) sides++;
            if (at != 0) side = at;
        }
        std::sort(moves.begin(), moves.end());
        moving = moves.empty() ? 0 : moves[moves.size() / 2];
    };
    float idleWidest, idleMoving, wideWidest, wideMoving;
    int idleSides, searchSides;
    watch(say(S::waiting), idleWidest, idleMoving, idleSides);
    watch(searching(S::working), wideWidest, wideMoving, searchSides);
    CHECK(idleWidest <= Face::dartAmount + 1e-3f, "idle, the eyes dart no further than CurioCity's %.2f cm: %.2f", double(Face::dartAmount), double(idleWidest));
    CHECK(wideWidest > idleWidest, "searching, they glance wider: %.2f against %.2f cm", double(wideWidest), double(idleWidest));
    CHECK(wideMoving > 2 * idleMoving, "and slower: a glance takes %.2f s, a dart %.2f s", double(wideMoving), double(idleMoving));
    CHECK(searchSides >= 15, "from side to side, %d times in 30 s", searchSides);

    Face f;
    run(f, searching(S::working), 0.8f);
    CHECK(f.look().monocle > 0.95f && f.glancing(), "the monocle is on while an agent works: %.2f", double(f.look().monocle));
    Presence done = say(S::waiting);
    done.agents = {AgentLine{"scout", "Scout", "", true}};
    run(f, done, 0.8f);
    CHECK(f.look().monocle < 0.05f && !f.glancing(), "and off once the work is finished, while its line still says so");
}

TEST(theLooksTakePrecedenceAsPlanned) {
    Face f;
    run(f, say(S::listening), 0.5f);
    run(f, say(S::sent), 0.4f);
    CHECK(f.look().dots > 0.9f, "the thinking dots come as the turn is sent: %.2f", double(f.look().dots));
    run(f, searching(S::thinking), 1);
    CHECK(f.look().dots > 0.99f && f.look().monocle > 0.95f, "thinking while an agent works: the dots show with the monocle");
    CHECK(f.look().rising > 1.3f, "the dots kept their beat from where they were: %.2f s", double(f.look().rising));
    run(f, searching(S::responding, 0.8f), 0.35f);
    CHECK(f.look().dots < 0.05f, "they fade as Momo starts speaking: %.2f", double(f.look().dots));
    CHECK(f.look().monocle > 0.95f && f.look().divergence > 0.5f, "speaking keeps the monocle on while an agent works");
    run(f, say(S::responding, "", "", true, 0.8f), 0.8f);
    CHECK(f.look().monocle < 0.05f && f.look().divergence > 0.5f, "and with no agent at work, speaking alone");
    run(f, say(S::thinking), 0.1f);
    CHECK(f.look().rising < 0.2f, "a new thought's dots come from the start: %.2f s", double(f.look().rising));
    run(f, say(S::off), 2);
    CHECK(f.look().shown < 0.01f && f.look().dots < 0.01f, "off, Momo is gone");
    run(f, say(S::listening), 0.5f);
    run(f, say(S::sent), 0.2f);
    run(f, say(S::responding, "", "", true, 0.8f), Face::dotsAtLeast - f.look().rising - 0.02f);
    CHECK(f.look().dots > 0.95f && Face::dot(2, f.look().rising).radius > 0,
          "Momo answering 0.2 s after the turn is sent: the bubbles stay until all three have settled (%.2f)", double(f.look().dots));
    run(f, say(S::responding, "", "", true, 0.8f), 0.6f);
    CHECK(f.look().dots < 0.05f, "then fade: %.2f", double(f.look().dots));
}

TEST(thinkingBubblesFormOneByOneEasingTheOthersOutThenCircle) {
    auto d = [](int j, float t) { return Face::dot(j, t); };
    float width = 2 * Face::radius;
    CHECK(d(0, 0).radius == 0 && d(1, 0.3f).radius == 0 && d(2, 0.65f).radius == 0, "none before its turn");
    CHECK(d(0, 0.15f).radius > 0 && d(0, 0.15f).radius < 0.24f && length(d(0, 0.15f).at - d(2, 1.1f).at) < 0.01f,
          "the first swells up at the base");
    Vec2 base = d(2, 1.1f).at, middle = d(1, 1.1f).at, end = d(0, 1.1f).at;
    Face::Dot first = d(0, 0.55f), second = d(1, 0.55f);
    CHECK(second.radius > 0 && length(second.at - base) < 0.01f, "the second swells up at the base");
    CHECK(first.at.y > base.y + 0.2f && first.at.y < middle.y - 0.2f && first.radius > 0.24f && first.radius < 0.36f,
          "easing the first out toward the middle place, growing as it goes");
    Face::Dot third = d(2, 0.9f);
    CHECK(third.radius > 0 && d(1, 0.9f).at.y > base.y + 0.2f && d(0, 0.9f).at.y > middle.y + 0.2f, "the third eases both out");
    CHECK(std::fabs(2 * d(0, 1.1f).radius / width - 0.25f) < 0.005f && std::fabs(2 * d(1, 1.1f).radius / width - 0.18f) < 0.005f &&
              std::fabs(2 * d(2, 1.1f).radius / width - 0.12f) < 0.005f && Face::dotsAtLeast <= 1.11f,
          "settled by %.2f s: the first the largest, at the far end; 0.25, 0.18 and 0.12 of Momo's width, as drawn", double(Face::dotsAtLeast));
    CHECK(length(base) < length(middle) && length(middle) < length(end) && base.x > 0 && end.y > base.y, "a trail up and right from Momo's upper right");

    // Forming, they float: never faster than gliding a place in its time, eased, and never shrinking but a hair.
    float fastest = 0, shrank = 0, most = 0;
    for (int j = 0; j < 3; j++) {
        Face::Dot was = d(j, 0);
        for (float t = 0.01f; t <= Face::dotsAtLeast; t += 0.01f) {
            Face::Dot now = d(j, t);
            fastest = std::max(fastest, length(now.at - was.at) / 0.01f);
            shrank = std::max(shrank, was.radius - now.radius);
            if (j == 2) most = std::max(most, now.radius);
            was = now;
        }
    }
    CHECK(fastest < 8, "floating, not shot: %.1f cm/s at most", double(fastest));
    CHECK(shrank < 0.005f && most < 0.24f * 1.02f, "swelling with at most a hair past its size: %.3f cm back", double(shrank));

    float bent = 0, straight = 1e9f, wandered = 0;
    bool clear = true;
    for (float t = 2; t < 2 + Face::dotTurn; t += 0.01f) {
        Vec2 p[3];
        for (int j = 0; j < 3; j++) {
            Face::Dot u = d(j, t);
            p[j] = u.at;
            wandered = std::max(wandered, length(u.at - d(j, Face::dotsAtLeast).at));
            // Clear of Momo's ring, even bent its furthest, and of the words beside it, and the same each turn.
            clear = clear && length(u.at) - u.radius > Face::radius * 1.15f && (u.at.x + u.radius < Face::radius * 1.5f || u.at.y - u.radius > Face::radius) &&
                    u.at.y + u.radius <= Face::bubblesTop && length(d(j, t + Face::dotTurn).at - u.at) < 1e-3f;
        }
        Vec2 along = p[0] - p[2];
        float off = std::fabs(along.x * (p[1].y - p[2].y) - along.y * (p[1].x - p[2].x)) / length(along);
        bent = std::max(bent, off);
        straight = std::min(straight, off);
    }
    CHECK(bent > 0.4f, "settled, they turn through a triangle: the middle one %.2f cm off the line of the others", double(bent));
    CHECK(straight < 0.05f, "and through a line: %.3f cm", double(straight));
    CHECK(wandered < 0.5f, "each about its own place, and only three: %.2f cm at most", double(wandered));
    CHECK(clear, "clear of Momo and its words, below where the agents' lines are lifted to, the same each turn");
}

namespace {

Roster roster() {
    return Roster([](const std::string& s) { return 0.003f * float(s.size()); }, 0.2f);
}

void run(Roster& r, const std::vector<AgentLine>& agents, float seconds) {
    for (float t = 0; t < seconds; t += frame) r.update(agents, frame);
}

const Roster::Line* line(const Roster& r, const std::string& role) {
    for (const Roster::Line& l : r.lines()) {
        if (l.role == role) return &l;
    }
    return nullptr;
}

}  // namespace

TEST(eachAgentAtWorkHasALineTheFirstLowestCutToOneLine) {
    Roster r = roster();
    run(r, {{"momo", "Momo (librarian)", "Searching the web for the Booker winner", false},
            {"scout", "Scout", "Searching museum collections for dancing people at night in Weimar", false},
            {"renderer", "Renderer", "", true}},
        1);
    CHECK_EQ(r.resting(), 3);
    const Roster::Line *momo = line(r, "momo"), *scout = line(r, "scout"), *renderer = line(r, "renderer");
    if (!momo || !scout || !renderer) return;
    CHECK_EQ(momo->text, std::string("Momo (librarian) · Searching the web for the Booker winner"));
    CHECK(momo->toY == 0 && scout->toY == 1 && renderer->toY == 2, "in the order they began, the first lowest");
    CHECK_EQ(scout->text, std::string("Scout · Searching museum collections for dancing people at…"));
    CHECK(scout->width <= 0.2f, "within one line: %.3f m", double(scout->width));
    CHECK_EQ(scout->text.substr(0, scout->name), std::string("Scout"));
    CHECK_EQ(renderer->text, std::string("Renderer · finished working"));
}

TEST(aLineThatGoesFadesAndTheLinesAboveTakeItsPlace) {
    Roster r = roster();
    AgentLine momo{"momo", "Momo (librarian)", "", true}, scout{"scout", "Scout", "Searching", false};
    // (The crew lets an agent go once it has finished for its while.)
    run(r, {momo, scout}, float(Crew::finishedFor));
    run(r, {scout}, 0.1f);
    const Roster::Line* going = line(r, "momo");
    CHECK(going && going->opacity < 0.5f, "the finished line fades quickly");
    run(r, {scout}, 0.6f);
    CHECK(!line(r, "momo"), "and is gone");
    const Roster::Line* rest = line(r, "scout");
    CHECK(rest && std::fabs(rest->y) < 0.02f && rest->opacity > 0.95f, "the Scout's line has come down into its place");
}

TEST(aLinesWordsChangeAtMostEveryHoldTheLatestWinning) {
    Roster r = roster();
    auto step = [](const char* words) { return AgentLine{"scout", "Scout", words, false}; };
    run(r, {step("Looking into dancing people")}, Roster::holdWords + 0.1f);
    run(r, {step("Searching museum collections")}, 0.1f);
    const Roster::Line* l = line(r, "scout");
    CHECK(l && l->text == "Scout · Looking into dancing people", "new words wait a moment, in case more come: \"%s\"", l ? l->text.c_str() : "");
    run(r, {step("Searching museum collections")}, 0.1f);
    l = line(r, "scout");
    CHECK(l && l->text == "Scout · Searching museum collections", "then show: \"%s\"", l ? l->text.c_str() : "");
    run(r, {step("Making a picture")}, 0.5f);
    run(r, {step("Laying out 2 cards")}, 0.5f);
    l = line(r, "scout");
    CHECK(l && l->text == "Scout · Searching museum collections", "two more steps within the hold: the words stay: \"%s\"", l ? l->text.c_str() : "");
    run(r, {step("Laying out 2 cards")}, Roster::holdWords - 0.9f);
    l = line(r, "scout");
    CHECK(l && l->text == "Scout · Laying out 2 cards", "then the latest, the step between passed over: \"%s\"", l ? l->text.c_str() : "");
    CHECK(l && l->opacity > 0.99f, "and the line never fades as its words change");
}

TEST(eachOfALinesWordsStaysAtLeastTheHoldThoughItsStepsComeFaster) {
    Roster r = roster();
    // A step every 0.2 s for 8 s, each a new one, then the run ends.
    std::string shown;
    float since = 0, shortest = 1e9f, t = 0;
    int changes = 0;
    for (; t < 14; t += frame) {
        int n = int(t / 0.2f);
        std::string words = "Step " + std::to_string(n);
        r.update({t < 8 ? AgentLine{"scout", "Scout", words, false} : AgentLine{"scout", "Scout", "", true}}, frame);
        const Roster::Line* l = line(r, "scout");
        if (!l || l->going) break;
        if (l->text != shown) {
            if (!shown.empty()) {
                shortest = std::min(shortest, t - since);
                changes++;
            }
            shown = l->text;
            since = t;
        }
    }
    CHECK(changes >= 4, "the words do change, %d times", changes);
    CHECK(shortest >= Roster::holdWords - 0.02f, "and each stood at least %.2f s: %.2f", double(Roster::holdWords), double(shortest));
    CHECK(shown == "Scout · finished working", "the line goes saying \"finished working\": \"%s\"", shown.c_str());
    CHECK(t - since >= float(Crew::finishedFor) - 0.02f, "after it has said so for %.2f s", double(t - since));
}

TEST(aLineWhoseAgentHasGoneFadesWithItsNewestWords) {
    // Gone at work (the crew is cleared on a new connection): it goes at once, saying what it last said it was doing.
    Roster r = roster();
    run(r, {{"scout", "Scout", "Searching museum collections", false}}, Roster::holdWords + 0.1f);
    run(r, {{"scout", "Scout", "Reading 8 results", false}}, 0.3f);
    run(r, {}, 0.05f);
    const Roster::Line* l = line(r, "scout");
    CHECK(l && l->going && l->text == "Scout · Reading 8 results", "fading, it says what it last said it was doing: \"%s\"", l ? l->text.c_str() : "gone");
    // Let go after it finished, before its last words had their while: those first, then "finished working" for its
    // while, and only then it fades.
    Roster q = roster();
    run(q, {{"scout", "Scout", "Searching museum collections", false}}, 1);
    run(q, {{"scout", "Scout", "", true}}, 0.05f);
    float t = 0, finishedFrom = -1;
    bool stale = false;
    for (; t < 8; t += frame) {
        q.update({}, frame);
        const Roster::Line* m = line(q, "scout");
        if (!m || m->going) break;
        if (finishedFrom < 0 && m->text == "Scout · finished working") finishedFrom = t;
        if (finishedFrom >= 0 && m->text != "Scout · finished working") stale = true;
    }
    const Roster::Line* m = line(q, "scout");
    CHECK(finishedFrom >= 0 && !stale, "it said \"finished working\", and nothing after");
    CHECK(m && m->text == "Scout · finished working", "fading, it says so: \"%s\"", m ? m->text.c_str() : "gone");
    CHECK(t - finishedFrom >= float(Crew::finishedFor) - 0.02f, "after %.2f s", double(t - finishedFrom));
}

TEST(theLastStepOfARunShowsForItsWhileBeforeFinishedWorking) {
    Roster r = roster();
    auto step = [](const char* words) { return AgentLine{"scout", "Scout", words, false}; };
    run(r, {step("Searching museum collections")}, 1);
    // The run's last step comes, and ends at once: no sooner shown than over.
    run(r, {step("Reading 8 results")}, 0.05f);
    float t = 0, readFrom = -1, finishedFrom = -1;
    for (; t < 2 * Roster::holdWords + 0.5f; t += frame) {
        r.update({{"scout", "Scout", "", true}}, frame);
        const Roster::Line* l = line(r, "scout");
        if (l && readFrom < 0 && l->text == "Scout · Reading 8 results") readFrom = t;
        if (l && finishedFrom < 0 && l->text == "Scout · finished working") finishedFrom = t;
    }
    CHECK(readFrom >= 0, "the last step is shown, though the run had ended before its words had stood their moment");
    CHECK(finishedFrom > readFrom && finishedFrom - readFrom >= Roster::holdWords - 0.02f,
          "then \"finished working\", after it has stood %.2f s", double(finishedFrom - readFrom));
}

TEST(atMostThreeLinesShowAnotherAtWorkWaitsForAFinishedLinesPlace) {
    Roster r = roster();
    AgentLine intake{"intake", "Intake", "Reading what you dropped", false}, filer{"filer", "Filer", "Filing a link", false},
        scout{"scout", "Scout", "Searching", false}, renderer{"renderer", "Renderer", "Laying out a card", false};
    run(r, {intake, filer, scout, renderer}, 1);
    CHECK_EQ(r.resting(), Roster::mostLines);
    CHECK(!line(r, "renderer"), "the fourth waits for a place");
    intake.step.clear();
    intake.finished = true;
    run(r, {intake, filer, scout, renderer}, Roster::holdWords + 0.2f);
    const Roster::Line* done = line(r, "intake");
    CHECK(done && !done->going && done->text == "Intake · finished working", "a line that has finished says so for its while first");
    CHECK(!line(r, "renderer"), "while the fourth still waits");
    run(r, {intake, filer, scout, renderer}, Roster::holdWords);
    done = line(r, "intake");
    CHECK(!done || done->going, "then it gives its place up");
    const Roster::Line *waited = line(r, "renderer"), *filing = line(r, "filer");
    CHECK(waited && waited->toY == 2 && waited->text == "Renderer · Laying out a card", "to the fourth, above the others");
    CHECK(filing && filing->toY == 0, "which come down in their order");
    CHECK_EQ(r.resting(), Roster::mostLines);
}

TEST(aLineStaysInItsPlaceBetweenItsAgentsSteps) {
    Roster r = roster();
    AgentLine scout{"scout", "Scout", "Thinking of directions", false};
    AgentLine laying{"renderer", "Renderer", "Laying out a card", false}, done{"renderer", "Renderer", "", true};
    run(r, {scout, laying}, 0.12f);
    run(r, {scout, done}, 2.5f);
    const Roster::Line* l = line(r, "renderer");
    CHECK(l && l->text == "Renderer · finished working", "the Renderer finished: \"%s\"", l ? l->text.c_str() : "gone");
    float y = l ? l->toY : -1, least = 1;
    AgentLine again{"renderer", "Renderer", "Laying out 2 cards", false};
    for (float t = 0; t < 2; t += frame) {
        r.update({scout, again}, frame);
        if (const Roster::Line* m = line(r, "renderer")) least = std::min(least, m->opacity);
        else least = 0;
    }
    l = line(r, "renderer");
    CHECK(l && l->text == "Renderer · Laying out 2 cards", "at work again, its words change: \"%s\"", l ? l->text.c_str() : "gone");
    CHECK(l && l->toY == y, "where it was");
    CHECK(least > 0.99f, "and it never left: %.2f at the least", double(least));
}

TEST(theTopLineSaysHowManyWaitTheCountChangingAtMostEveryHold) {
    Roster r = roster();
    AgentLine intake{"intake", "Intake", "Reading what you dropped", false}, filer{"filer", "Filer", "Filing a link", false},
        scout{"scout", "Scout", "Searching", false}, renderer{"renderer", "Renderer", "Laying out a card", false},
        organizer{"organizer", "Organizer", "Reorganizing your cards", false};
    run(r, {intake, filer, scout, renderer, organizer}, 0.5f);
    const Roster::Line *top = line(r, "scout"), *low = line(r, "intake");
    CHECK(top && top->toY == 2 && top->text == "Scout · Searching · +2 more", "two wait: \"%s\"", top ? top->text.c_str() : "");
    CHECK(low && low->text == "Intake · Reading what you dropped", "said once, on the top line");
    CHECK(top && top->width <= 0.2f, "still one line");
    renderer.step.clear();
    renderer.finished = true;
    run(r, {intake, filer, scout, renderer, organizer}, 0.6f);
    top = line(r, "scout");
    CHECK(top && top->text == "Scout · Searching · +2 more", "one done while waiting: the count stays its while: \"%s\"",
          top ? top->text.c_str() : "");
    run(r, {intake, filer, scout, renderer, organizer}, Roster::holdWords - 0.6f);
    top = line(r, "scout");
    CHECK(top && top->text == "Scout · Searching · +1 more", "then says one: \"%s\"", top ? top->text.c_str() : "");
    intake.step.clear();
    intake.finished = true;
    run(r, {intake, filer, scout, renderer, organizer}, 2 * Roster::holdWords + 0.3f);
    const Roster::Line *came = line(r, "organizer");
    top = line(r, "scout");
    CHECK(came && came->toY == 2 && came->text == "Organizer · Reorganizing your cards", "the last at work takes a place, on top: \"%s\"",
          came ? came->text.c_str() : "");
    CHECK(top && top->text == "Scout · Searching", "and nobody waits: \"%s\"", top ? top->text.c_str() : "");
}
