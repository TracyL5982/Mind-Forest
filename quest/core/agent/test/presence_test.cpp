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
    CHECK(f.look().distortion > 5 && f.look().scale > 1.1f, "listening, the ring moves with the user's voice: %.2f", double(f.look().distortion));
    CHECK(f.look().divergence < 0.05f, "and stays white: %.3f", double(f.look().divergence));
    run(f, say(S::responding, "", "", true, 0.9f), 0.5f);
    CHECK(f.look().divergence > 1, "Momo's own voice parts it into colour: %.2f", double(f.look().divergence));
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
            int at = f.look().gaze.x < -0.3f ? -1 : f.look().gaze.x > 0.3f ? 1 : 0;
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
    CHECK(f.look().bubble > 0.9f, "the thought bubble rises as the turn is sent: %.2f", double(f.look().bubble));
    run(f, searching(S::thinking), 1);
    CHECK(f.look().bubble > 0.99f && f.look().monocle > 0.95f, "thinking while an agent works: the cloud shows over the monocle");
    CHECK(f.look().rising > 1.3f, "the bubble kept rising from where it was: %.2f s", double(f.look().rising));
    run(f, searching(S::responding, 0.8f), 0.35f);
    CHECK(f.look().bubble < 0.05f, "it fades as Momo starts speaking: %.2f", double(f.look().bubble));
    CHECK(f.look().monocle > 0.95f && f.look().divergence > 0.5f, "speaking keeps the monocle on while an agent works");
    run(f, say(S::responding, "", "", true, 0.8f), 0.8f);
    CHECK(f.look().monocle < 0.05f && f.look().divergence > 0.5f, "and with no agent at work, speaking alone");
    run(f, say(S::thinking), 0.1f);
    CHECK(f.look().rising < 0.2f, "a new thought rises from the start: %.2f s", double(f.look().rising));
    run(f, say(S::off), 2);
    CHECK(f.look().shown < 0.01f && f.look().bubble < 0.01f, "off, Momo is gone");
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
    run(r, {momo, scout}, 1);
    run(r, {scout}, 0.1f);
    const Roster::Line* going = line(r, "momo");
    CHECK(going && going->opacity < 0.5f, "the finished line fades quickly");
    run(r, {scout}, 0.6f);
    CHECK(!line(r, "momo"), "and is gone");
    const Roster::Line* rest = line(r, "scout");
    CHECK(rest && std::fabs(rest->y) < 0.02f && rest->opacity > 0.95f, "the Scout's line has come down into its place");
}
