// Momo's presence apart from drawing it: where the orb rests as the head turns, how it answers each state, and which
// words show beside it. Each is driven frame by frame at the headset's 90 frames a second.
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

Presence doing(std::string what, std::string momo = "Because.") {
    Presence p = say(S::working, "", std::move(momo));
    p.doing = std::move(what);
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

TEST(workingSaysWhatTheAgentIsDoingUnderMomosLastWords) {
    Caption c = caption();
    run(c, say(S::listening, "Why?"), 0.3);
    run(c, say(S::responding, "Why?", "Because."), 1);
    run(c, doing("Searching films"), 1);
    auto rest = resting(c);
    CHECK(rest.size() == 2 && rest[0]->text == "Because." && rest[1]->text == "Searching films", "Momo's words over what it is doing");
    CHECK(rest.size() == 2 && rest[1]->who == Speaker::status, "what it is doing is set as status, not speech");
    run(c, doing("Searching films"), Caption::linger);
    rest = resting(c);
    CHECK(rest.size() == 1 && rest[0]->text == "Searching films", "once Momo's words have stayed their while, only what it is doing");
}

TEST(whatTheAgentIsDoingRollsToTheNextWithoutTheTwoStandingTogether) {
    Caption c = caption();
    run(c, say(S::listening, "Why?"), 0.3);
    run(c, say(S::responding, "Why?", "Because."), 1);
    run(c, doing("Searching films"), 1);
    const Caption::Line* above = shown(c, "Because.");
    float aboveY = above ? above->y : 0;
    bool together = false, crossed = false, intoAbove = false;
    float risen = 0;
    for (int f = 0; f < 90; f++) {
        run(c, doing("Reading 3 articles"), frame);
        const Caption::Line* was = shown(c, "Searching films");
        const Caption::Line* now = shown(c, "Reading 3 articles");
        if (was && now && was->opacity > 0.05f && now->opacity > 0.05f) {
            crossed = true;
            together = together || std::fabs(was->y - now->y) < 0.25f;
        }
        if (was && was->opacity > 0.05f) intoAbove = intoAbove || aboveY - was->y < 0.6f;
        if (was && now) risen = std::max(risen, was->y - now->toY);
    }
    CHECK(crossed, "the two cross-fade, the new coming in as the old goes");
    CHECK(!together, "but never on the same line");
    CHECK(!intoAbove, "nor does the old one reach Momo's line above it");
    CHECK(risen > 0.15f, "the old one lifts as it goes: %.2f lines", double(risen));
    CHECK(!shown(c, "Searching films"), "and is gone");
    auto rest = resting(c);
    CHECK(rest.size() == 2 && rest[1]->text == "Reading 3 articles", "the new one rests where the old one was");
}

TEST(whatTheAgentIsDoingIsOneLineCutShort) {
    Caption c = caption();
    run(c, say(S::listening, "Why?"), 0.3);
    run(c, doing("Searching every film that has used a dolly zoom", ""), 1);
    auto rest = resting(c);
    CHECK(rest.size() == 1, "%zu lines", rest.size());
    CHECK(rest.size() == 1 && rest[0]->text == "Searching every…", "cut short: \"%s\"", rest.empty() ? "" : rest[0]->text.c_str());
    CHECK(rest.size() == 1 && rest[0]->width <= 0.2f + 1e-4f, "within a line");
}

TEST(offTakesEveryWordAway) {
    Caption c = caption();
    run(c, say(S::listening, "Why?"), 0.3);
    run(c, say(S::thinking, "Why?"), 0.3);
    run(c, say(S::off), 1);
    CHECK(c.lines().empty(), "%zu lines left", c.lines().size());
}

TEST(theOrbSwellsWithTheVoiceItAnswersOnly) {
    Glow g;
    double now = 0;
    auto step = [&](const Presence& p, float seconds) {
        for (float t = 0; t < seconds; t += frame) g.update(p, now += frame, frame);
    };
    step(say(S::waiting, "", "", true, 0.8f), 1);
    CHECK(g.look().voice < 0.05f, "waiting, the room's noise does not move it: %.2f", double(g.look().voice));
    step(say(S::listening, "", "", true, 0.8f), 0.3);
    CHECK(g.look().voice > 0.5f, "listening, it swells with the voice: %.2f", double(g.look().voice));
    step(say(S::listening, "", "", true, 0), 0.05f);
    CHECK(g.look().voice > 0.4f, "and falls away slowly, not flickering: %.2f", double(g.look().voice));
    step(say(S::listening, "", "", true, 0), 1);
    CHECK(g.look().voice < 0.05f, "quiet again: %.2f", double(g.look().voice));
    step(say(S::listening), 1.5f);
    CHECK(g.look().warmth < 0.1f, "listening, it takes the user's white: %.2f", double(g.look().warmth));
    step(say(S::responding, "", "", true, 0.7f), 1.5f);
    CHECK(g.look().warmth > 0.9f && g.look().voice > 0.5f, "speaking, Momo's amber, swelling with its voice");
}

TEST(workingTheOrbRipplesGentlyAndDoesNotTakeTheThinkingLights) {
    Glow g;
    double now = 0;
    for (float t = 0; t < 2; t += frame) g.update(say(S::thinking), now += frame, frame);
    CHECK(g.look().shimmer > 0.9f && g.look().ripple < 0.05f, "thinking: lights circle it");
    for (float t = 0; t < 2.5f; t += frame) g.update(doing("Reading"), now += frame, frame);
    CHECK(g.look().ripple > 0.9f && g.look().shimmer < 0.05f, "working: rings go out from it, and no lights circle it");
}

TEST(sendingGathersTheOrbOnceAndOffFadesIt) {
    Glow g;
    double now = 0;
    for (float t = 0; t < 1; t += frame) g.update(say(S::listening), now += frame, frame);
    g.update(say(S::sent), now += frame, frame);
    CHECK(g.look().gather >= 0 && g.look().gather < 0.05f, "it starts to gather: %.2f", double(g.look().gather));
    float last = g.look().gather;
    bool rising = true;
    for (float t = 0; t < Glow::gathering - 0.05f; t += frame) {
        g.update(say(t < 0.2f ? S::sent : S::thinking), now += frame, frame);
        rising = rising && g.look().gather > last;
        last = g.look().gather;
    }
    CHECK(rising, "through to the end, even once thinking");
    for (float t = 0; t < 0.2f; t += frame) g.update(say(S::thinking), now += frame, frame);
    CHECK(g.look().gather < 0, "and only once");
    for (float t = 0; t < 2; t += frame) g.update(say(S::off), now += frame, frame);
    CHECK(g.look().shown < 0.01f, "off, it is gone: %.3f", double(g.look().shown));
}
