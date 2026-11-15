#include "presence_demo.h"

#include <algorithm>
#include <cmath>

#include "base.h"
#include "platform.h"
#include "ocean/oceanmodel.h"

namespace agent {
namespace {

const std::string question = "What does a dolly zoom do to the audience?";
const std::string reply =
    "It pulls the background away while the subject stays the same size, so the room seems to stretch around them. "
    "Hitchcock used it in Vertigo to make a fall feel like dread.";

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

}  // namespace

std::shared_ptr<PresenceDemo> PresenceDemo::fromFlags(OceanModel& model) {
    if (!Flags::has("presenceDemo")) return nullptr;
    logLine("[presence] demo: every state on a 34 s loop");
    return std::make_shared<PresenceDemo>(model);
}

void PresenceDemo::at(double t, Presence& p) {
    using S = Presence::State;
    t = std::fmod(t, loop);
    p.level = 0;
    p.workingOn.reset();
    p.doing.clear();
    auto phase = [&](double from, double to) { return t >= from && t < to; };
    if (phase(0, 3)) {
        p.state = S::waiting;
        p.userText.clear();
        p.momoText.clear();
    } else if (phase(3, 7.4)) {
        p.state = S::listening;
        // Words come a little after the voice; one is heard wrong at first, and put right.
        int heard = int((t - 3.5) * 2.4);
        firstWords(question, std::max(0, heard), p.userText);
        if (heard == 4) p.userText = "What does a dull";
        p.userFinal = t >= 7;
        p.level = t < 6.9 ? voice(t) : 0.05f;
    } else if (phase(7.4, 7.8)) {
        p.state = S::sent;
    } else if (phase(7.8, 10.2)) {
        p.state = S::thinking;
    } else if (phase(10.2, 20.5)) {
        p.state = S::responding;
        firstWords(reply, int((t - 10.2) * 3.3) + 1, p.momoText);
        p.level = t < 20 ? voice(t) : 0.05f;
    } else if (phase(20.5, 29.5)) {
        p.state = S::working;
        p.workingOn = 0;
        p.doing = t < 23.5 ? "Searching films with a dolly zoom" : t < 26.5 ? "Reading 3 articles" : "Laying out 2 cards";
    } else if (phase(29.5, 33)) {
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
    at(now, presence);
    std::optional<Vec3> working;
    if (presence.workingOn && model.tree) {
        if (std::optional<int> open = model.tree->focus()) {
            if (const auto& c = model.card(*open)) working = c->root->transformMatrix(nullptr).position();
        }
    }
    Mat4 head = platform::head().value_or(Mat4::trs(model.stage.origin, Quat::identity(), {1, 1, 1}));
    double began = mediaTime();
    view->frame(presence, "Momo", working, head, now);
    took.push_back((mediaTime() - began) * 1000);
    if (now - loggedAt < loop) return;
    loggedAt = now;
    std::sort(took.begin(), took.end());
    auto percentile = [&](double share) { return took[std::min(took.size() - 1, size_t(share * double(took.size())))]; };
    logLine(fmt("[presence] the view took %.3f ms a frame at the median, %.3f at the 95th percentile, %.3f at most, over %d frames",
                percentile(0.5), percentile(0.95), took.back(), int(took.size())));
    took.clear();
}

}  // namespace agent
