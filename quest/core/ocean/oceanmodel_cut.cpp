// Not a port: there is nothing like it in the visionOS app, where a flat hand swept across a thread
// cuts it at once. That was hard to find, easy to do by accident and impossible to see coming, so here:
//
// - A flat hand shows as a blade (handglow.h), and the thread it points at lights: you can see that the
//   gesture is read, and what it would cut.
// - The first slice across a thread only marks it for cutting: it turns to the accent, and "Cut" stands
//   on it while a ring round the place runs down (five seconds).
// - A second slice across it, or a pinch on "Cut", cuts it. A pinch on nothing, or waiting, lets it be.
// - A pinch on a thread marks it the same way, so nothing here needs the flat hand at all.
#include "oceanmodel.h"

#include <cmath>
#include <set>

namespace {
const double armedFor = 5;
}

std::vector<Vec3> OceanModel::threadLine(int child) const {
    for (const Drawn& item : drawn) {
        if (item.child == child) return Threads::points(item.thread, stage.origin);
    }
    return {};
}

/// The thread a flat hand points at, as you see it: the one whose line passes nearest the point a little
/// beyond the fingertips, if any passes near. Returns the card it runs to and the place on it.
std::optional<std::pair<int, Vec3>> OceanModel::threadAimed(Vec3 tip, Vec3 along) const {
    std::optional<Mat4> head = platform::head();
    Vec3 eye = head ? head->position() : stage.origin;
    auto seen = [&](Vec3 p) -> std::optional<Vec2> {
        Vec3 v = p - eye;
        float z = dot(v, stage.f);
        return z > 0.05f ? std::optional<Vec2>(Vec2{dot(v, stage.r), dot(v, stage.u)} / z) : std::nullopt;
    };
    std::optional<Vec2> aim = seen(tip + along * 0.05f);
    if (!aim) return std::nullopt;
    std::optional<std::pair<int, Vec3>> best;
    float nearest = 0.11f;          // about six degrees: further than that it points at nothing
    for (const Drawn& item : drawn) {
        if (!(item.child > 0)) continue;
        std::vector<Vec3> line = Threads::points(item.thread, stage.origin);
        for (size_t k = 1; k < line.size(); k++) {
            std::optional<Vec2> a = seen(line[k - 1]), b = seen(line[k]);
            if (!a || !b) continue;
            Vec2 ab = *b - *a;
            float along2 = length_squared(ab);
            float t = along2 > 1e-9f ? std::min(1.f, std::max(0.f, dot(*aim - *a, ab) / along2)) : 0;
            float off = length(*aim - (*a + ab * t));
            if (off < nearest) {
                nearest = off;
                best = std::make_pair(item.child, mix(line[k - 1], line[k], t));
            }
        }
    }
    return best;
}

/// Gives every thread something a hand's ray can land on: a few thin boxes along its middle (its ends
/// are left to the cards they run under). They are moved with the threads, a few times a second.
void OceanModel::layThreadHits() {
    std::set<int> live;
    if (tree && !pressing) {
        for (const Drawn& item : drawn) {
            if (!(item.child > 0)) continue;
            std::vector<Vec3> line = Threads::points(item.thread, stage.origin);
            if (line.size() < 5) continue;
            live.insert(item.child);
            EntityRef& e = threadHits[item.child];
            if (!e) {
                e = Entity::make();
                e->name = "thread";
                e->inputTarget = true;
                e->hover = Hover::shader();
                root_->addChild(e);
                picks[e.get()] = Pick::thread(item.child);
            }
            e->collision.clear();
            for (size_t k = 2; k + 2 < line.size(); k++) {
                Vec3 d = line[k] - line[k - 1];
                float far = length(d);
                if (far < 1e-4f) continue;
                e->collision.push_back(Shape::generateBox({far, 0.024f, 0.024f}).offsetBy(Quat::fromTo({1, 0, 0}, d / far), (line[k] + line[k - 1]) * 0.5f));
            }
        }
    }
    for (auto it = threadHits.begin(); it != threadHits.end();) {
        if (live.count(it->first)) {
            ++it;
            continue;
        }
        picks.erase(it->second.get());
        it->second->removeFromParent();
        it = threadHits.erase(it);
    }
}

/// Marks a thread for cutting: "Cut" stands on it for a few seconds.
void OceanModel::armCut(int child, Vec3 at) {
    if (!tree || pressing || !art) return;
    disarmCut();
    std::optional<Piece> piece = art->line("Cut", Art::Size::label, Font::Weight::semibold, Color::white(), Art::hot, Art::buttonPad);
    if (!piece) return;
    std::optional<Mat4> head = platform::head();
    Vec3 eye = head ? head->position() : stage.origin;
    EntityRef chip = art->quad(*piece);
    // Just under the place, and a little toward you, clear of the thread and its ring.
    Vec3 toEye = normalize(eye - at);
    chip->position = at - stage.u * 0.05f + toEye * 0.02f;
    Vec3 x = normalize(cross(stage.u, toEye));
    chip->orientation = Quat(Mat3(x, cross(toEye, x), toEye));
    chip->collision = {Shape::generateBox({piece->size.x + 0.012f, piece->size.y + 0.012f, 0.01f})};
    chip->inputTarget = true;
    chip->hover = Art::hover();
    picks[chip.get()] = Pick::cut(child);
    root_->addChild(chip);
    fadeIn(chip, 0, 0.2f);
    cutArmed = CutArmed{child, at, time + armedFor, chip};
    soundAt("mark_begin", at);
    touch(time + armedFor + 0.5);
}

void OceanModel::disarmCut() {
    if (!cutArmed) return;
    picks.erase(cutArmed->chip.get());
    cutArmed->chip->inputTarget = false;
    fadeOut(cutArmed->chip, 0.2f);
    cutArmed = std::nullopt;
}

void OceanModel::confirmCut() {
    if (!cutArmed) return;
    int child = cutArmed->child;
    Vec3 at = cutArmed->at;
    disarmCut();
    soundAt("cut", at);
    prune(child);
    guideDid("cut");
}

/// What the hands and the threads show of all this, each frame: the blades, the thread aimed at or
/// under a ray, and the thread marked for cutting with its time running down.
void OceanModel::updateCut(double now, float dt) {
    if (!handGlow) return;
    handGlow->blades.clear();
    handGlow->cuts.clear();
    // Palms held together (hands.h): the ring that counts the second. `-glowDemo hold` shows it without hands.
    handGlow->hold = std::nullopt;
    if (std::optional<Hands::Held> held = tree && !pressing ? hands->held() : std::nullopt) handGlow->hold = HandGlow::Hold{held->at, held->progress};
    if (Flags::string("glowDemo") == std::optional<std::string>("hold") && tree && !pressing) {
        handGlow->hold = HandGlow::Hold{stage.point(0, -22, 0.45f), float(std::fmod(time, 1.6) / 1.0 > 1 ? 1 : std::fmod(time, 1.6) / 1.0)};
    }
    if (++threadHitsTick % 6 == 0) layThreadHits();
    if (cutArmed && (now > cutArmed->until || !tree || pressing || threadLine(cutArmed->child).empty())) disarmCut();

    std::vector<Hands::Blade> flat = tree && !pressing ? hands->blades() : std::vector<Hands::Blade>();
    // `-glowDemo blade` shows a blade without a hand: low on the right, pointing up at the tree.
    if (Flags::string("glowDemo") == std::optional<std::string>("blade") && tree && !pressing) {
        // (At the last thread drawn, which is on the layer you work on.)
        std::vector<Vec3> line;
        for (const Drawn& item : drawn) {
            if (item.child > 0) line = Threads::points(item.thread, stage.origin);
        }
        std::optional<Mat4> head = platform::head();
        Vec3 eye = head ? head->position() : stage.origin;
        Vec3 to = line.empty() ? stage.point(4, -6, 1.5f) : line[line.size() / 2];
        Hands::Blade b;
        b.hand = 1;
        b.palm = eye + (to - eye) * 0.36f + stage.r * 0.07f - stage.u * 0.09f;
        b.tip = b.palm + normalize(eye + (to - eye) * 0.5f - b.palm) * 0.11f;
        flat.push_back(b);
    }
    std::optional<std::pair<int, Vec3>> aimed;
    Vec3 aimedFrom = Vec3::zero();
    for (int k = 0; k < 2; k++) {
        const Hands::Blade* found = nullptr;
        for (const Hands::Blade& b : flat) {
            if (b.hand == k) found = &b;
        }
        bladeGlow[k] += ((found ? 1.f : 0.f) - bladeGlow[k]) * std::min(1.f, 10 * dt);
        if (found) bladeLast[k] = *found;
        if (bladeGlow[k] < 0.02f) continue;
        handGlow->blades.push_back(HandGlow::Blade{bladeLast[k].tip, bladeLast[k].palm, bladeGlow[k]});
        if (found && !aimed) {
            Vec3 along = found->tip - found->palm;
            if (length(along) > 1e-4f) aimed = threadAimed(found->tip, normalize(along));
            aimedFrom = found->tip;
        }
    }
    int armed = cutArmed ? cutArmed->child : -1;
    if (aimed && aimed->first != armed) {
        HandGlow::Cut c;
        c.line = threadLine(aimed->first);
        c.at = aimed->second;
        c.lit = 1;
        c.leader = true;
        c.from = aimedFrom;
        handGlow->cuts.push_back(c);
    }
    for (const auto& [child, e] : threadHits) {
        if (e->hovered < 0.02f || child == armed || (aimed && aimed->first == child)) continue;
        HandGlow::Cut c;
        c.line = threadLine(child);
        if (c.line.empty()) continue;
        c.at = c.line[c.line.size() / 2];
        c.lit = e->hovered;
        handGlow->cuts.push_back(c);
    }
    if (cutArmed) {
        HandGlow::Cut c;
        c.line = threadLine(cutArmed->child);
        c.at = cutArmed->at;
        c.armed = 1;
        c.left = float(std::max(0.0, (cutArmed->until - now) / armedFor));
        handGlow->cuts.push_back(c);
    }
    if (!handGlow->blades.empty() || !handGlow->cuts.empty() || handGlow->hold) touch(time + 0.2);
}
