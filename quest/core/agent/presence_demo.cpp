#include "presence_demo.h"

#include <algorithm>
#include <cmath>

#include "base.h"
#include "platform.h"
#include "ocean/oceanmodel.h"

namespace agent {
namespace {

const std::string question = "Who won the Booker this year, and is anyone dancing in it?";
const std::string reply =
    "The Booker went to a novel about a dance hall. Let me look on the web for this year's winner, and I'll find you "
    "pictures of people dancing.";
const std::string results = "Two new things under dancing people, and one more picture is on its way.";

/// How loud a voice is `t` s in: a syllable every so often, louder and softer as a sentence goes.
float voice(double t) {
    float syllables = float(std::fabs(std::sin(t * 2 * M_PI * 2.6)));
    float phrase = float(0.55 + 0.45 * std::sin(t * 2 * M_PI * 0.9 + 1));
    return std::min(1.f, 0.12f + 0.75f * syllables * phrase);
}

/// The first `count` words of `text`.
void firstWords(const std::string& text, int count, std::string& into) {
    size_t end = 0;
    for (int i = 0; i < count && end != std::string::npos; i++) end = text.find(' ', end + (i > 0 ? 1 : 0));
    into.assign(text, 0, end == std::string::npos ? text.size() : end);
}

/// The agents' steps through the loop: Momo searches the web as it answers, the Scout and the Renderer bring cards,
/// and while the Scout's picture is still being made, a dropped link is read, filed and the cards reorganized.
struct Scripted {
    double at;
    const char* id;
    const char* role;
    const char* label;      // empty: the step ends
};
constexpr Scripted steps[] = {
    {14.5, "m1", "momo", "Searching the web for the Booker winner"},
    {17.0, "m1", "momo", ""},
    {17.5, "s1", "scout", "Looking into dancing people"},
    {18.0, "s2", "scout", "Searching museum collections for dancing people"},
    {18.5, "r1", "renderer", "Laying out 2 cards"},
    {21.0, "r1", "renderer", ""},
    {21.2, "s2", "scout", ""},
    {21.3, "s3", "scout", "Making a picture of Night stairs in a Weimar dance hall"},
    {22.0, "i1", "intake", "Reading what you dropped"},
    {22.4, "f1", "filer", "Filing a link under Dance"},
    {22.8, "o1", "organizer", "Reorganizing your cards"},
    {26.0, "i1", "intake", ""},
    {26.5, "f1", "filer", ""},
    {27.0, "o1", "organizer", ""},
    {31.0, "s3", "scout", ""},
    {31.0, "s1", "scout", ""},
};

}  // namespace

std::shared_ptr<PresenceDemo> PresenceDemo::fromFlags(OceanModel& model) {
    if (!Flags::has("presenceDemo")) return nullptr;
    logLine(fmt("[presence] demo: every state and look on a %.0f s loop", loop));
    return std::make_shared<PresenceDemo>(model);
}

void PresenceDemo::at(double t, Presence& p) {
    using S = Presence::State;
    t = std::fmod(t, loop);
    p.level = 0;
    auto phase = [&](double from, double to) { return t >= from && t < to; };
    if (phase(0, 3)) {
        p.state = S::waiting;
        p.userText.clear();
        p.momoText.clear();
    } else if (phase(3, 7.4)) {
        p.state = S::listening;
        // Words come a little after the voice; one is heard wrong at first, and put right.
        int heard = int((t - 3.5) * 3.2);
        firstWords(question, std::max(0, heard), p.userText);
        if (heard == 2) p.userText = "Who one";
        p.userFinal = t >= 7;
        p.level = t < 6.9 ? voice(t) : 0.05f;
    } else if (phase(7.4, 7.8)) {
        p.state = S::sent;
    } else if (phase(7.8, 10.2)) {
        p.state = S::thinking;
    } else if (phase(10.2, 16)) {
        p.state = S::responding;
        firstWords(reply, int((t - 10.2) * 5.2) + 1, p.momoText);
        // Softly at first, then in full voice.
        p.level = t < 15.6 ? voice(t) * (t < 12.4 ? 0.4f : 1.f) : 0.05f;
    } else if (phase(16, 24)) {
        p.state = S::working;
    } else if (phase(24, 28.5)) {
        p.state = S::responding;
        p.userText.clear();
        firstWords(results, int((t - 24) * 3.6) + 1, p.momoText);
        p.level = t < 28 ? voice(t) : 0.05f;
    } else if (phase(28.5, 31)) {
        p.state = S::working;
    } else if (phase(31, 37)) {
        p.state = S::waiting;
    } else {
        p.state = S::off;
    }
}

void PresenceDemo::frame(double now) {
    if (!view) {
        if (!model.art || !model.lineMaterial) return;
        view = std::make_unique<PresenceView>(model.art, *model.lineMaterial, model.root_);
    }
    double t = std::fmod(now, loop);
    if (t < played) {
        crew = Crew{};
        played = -1;
    }
    for (const Scripted& s : steps) {
        if (s.at <= played || s.at > t) continue;
        Activity a;
        a.id = s.id;
        a.role = s.role;
        a.state = *s.label ? Activity::State::start : Activity::State::done;
        a.message = s.label;
        if (*s.label) a.label = std::string(s.label);
        crew.activity(a, t);
    }
    played = t;
    crew.update(t);
    at(now, presence);
    presence.agents = crew.lines("Momo");
    Mat4 head = platform::head().value_or(Mat4::trs(model.stage.origin, Quat::identity(), {1, 1, 1}));
    double began = mediaTime();
    view->frame(presence, "Momo", head, now);
    took.push_back((mediaTime() - began) * 1000);

    const Face::Look& l = view->looks().look();
    if (l.openness < 0.5f && !shut) logLine(fmt("[presence] blink at %.2f", t));
    shut = l.openness < 0.5f;
    int way = l.gaze.x < -0.15f ? -1 : l.gaze.x > 0.15f ? 1 : 0;
    if (way != 0 && way != looking) logLine(fmt("[presence] eyes %s at %.2f", way < 0 ? "left" : "right", t));
    if (way != 0) looking = way;

    if (now - loggedAt < loop) return;
    loggedAt = now;
    std::sort(took.begin(), took.end());
    auto percentile = [&](double share) { return took[std::min(took.size() - 1, size_t(share * double(took.size())))]; };
    logLine(fmt("[presence] the view took %.3f ms a frame at the median, %.3f at the 95th percentile, %.3f at most, over %d frames",
                percentile(0.5), percentile(0.95), took.back(), int(took.size())));
    took.clear();
}

}  // namespace agent
