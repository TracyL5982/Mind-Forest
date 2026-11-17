#include "presence_demo.h"

#include <algorithm>
#include <cmath>

#include "base.h"
#include "json.h"
#include "voice.h"
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
    if (std::optional<std::string> path = Flags::string("presenceTake")) {
        std::optional<std::string> text = platform::readFile(*path);
        std::optional<Json> j = text ? Json::parse(*text) : std::nullopt;
        if (!j) {
            logLine(fmt("[presence] take: can't read %s", path->c_str()));
            return nullptr;
        }
        auto demo = std::make_shared<PresenceDemo>(model);
        double last = 0;
        int n = 0;
        for (const Json& s : (*j)["steps"].array()) {
            std::string id = fmt("take%d", n++), role = s["role"].string("scout");
            double at = takeFrom + s["at"].number() / 1000, end = takeFrom + s["end"].number() / 1000;
            demo->take.push_back({at, id, role, s["label"].string()});
            demo->take.push_back({end, id, role, ""});
            last = std::max(last, end);
        }
        for (const Json& l : (*j)["lines"].array()) {
            double at = takeFrom + l["at"].number() / 1000, ms = l["ms"].number() / 1000;
            if (ms > 0) demo->said.push_back({at, ms, l["text"].string()});
            last = std::max(last, at + ms);
        }
        std::stable_sort(demo->take.begin(), demo->take.end(), [](const Step& a, const Step& b) { return a.at < b.at; });
        demo->length = last + takeAfter;
        logLine(fmt("[presence] take: %d labels and %d lines of Momo's from %s, on a %.1f s loop", n, int(demo->said.size()), path->c_str(),
                    demo->length));
        return demo;
    }
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
    double t = std::fmod(now, length);
    if (t < played) {
        crew = Crew{};
        played = -1;
    }
    auto play = [&](double when, const std::string& id, const std::string& role, const std::string& label) {
        if (when <= played || when > t) return;
        Activity a;
        a.id = id;
        a.role = role;
        a.state = !label.empty() ? Activity::State::start : Activity::State::done;
        a.message = label;
        if (!label.empty()) a.label = label;
        crew.activity(a, t);
    };
    if (take.empty()) {
        for (const Scripted& s : steps) play(s.at, s.id, s.role, s.label);
    } else {
        for (const Step& s : take) play(s.at, s.id, s.role, s.label);
    }
    played = t;
    crew.update(t);
    if (take.empty()) {
        at(now, presence);
    } else {
        presence.state = crew.working() ? Presence::State::working : Presence::State::waiting;
        if (t < takeFrom) presence.momoText.clear();
        for (const Said& s : said) {
            if (t < s.at || t >= s.at + s.length) continue;
            presence.state = Presence::State::responding;
            presence.momoText = revealed(s.text, (t - s.at + Voice::wordsAhead) / s.length);
        }
    }
    presence.agents = crew.lines("Momo");
    model.conversing = presence.conversing();
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

    if (now - loggedAt < length) return;
    loggedAt = now;
    std::sort(took.begin(), took.end());
    auto percentile = [&](double share) { return took[std::min(took.size() - 1, size_t(share * double(took.size())))]; };
    logLine(fmt("[presence] the view took %.3f ms a frame at the median, %.3f at the 95th percentile, %.3f at most, over %d frames",
                percentile(0.5), percentile(0.95), took.back(), int(took.size())));
    took.clear();
}

}  // namespace agent
