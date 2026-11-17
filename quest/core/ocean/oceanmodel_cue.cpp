// FILM: the greeting Momo gives when it is asked for from the filming panel (core/ocean/filmpanel.h,
// quest/film/README.md).
//
// Kai, 2026-11-17: "a quick custom sequence with Momo that I can trigger from the film panel, when we are in the
// all tree closed state, and starts about 5 seconds after I click on the button. Here is the script rundown:
// Audio: Momo: "Hi there! I grew a new tree today on the topics you love!" -> I look at a tree which we mark with
// UI as a freshly curated tree, and opens it". And, the same day, of the first version (a "New" tab on a tree where
// it stood): the line goes on "Would you like to check it out?", and "Tree highlight can have a more ceremonial
// sequence: The tree should be foregrounded, near the center. at the start of the sequence, hide that tree. Then,
// once Momo finishes her line, the tree sprouts and grows in, the base plate ripples expand, and the thumbnails
// also pop in along the sequence."
//
// What happens, from the pinch:
//   0 s      The tree fades out where it stands. Unseen, it is given the middle of the clearing, 1.5 m before the
//            eyes; a tree that would stand in its way, or whose name would run into its name, glides aside round
//            you, and the briefs, which have the middle of the desk, fade (its name would be behind them).
//   5 s      Momo says her line: a recording of her live voice (agents/scripts/say-line.ts), kept with the app's
//            media as film/greeting.pcm (16-bit mono, 24 kHz), its words beside it in film/greeting.txt. It is
//            given through her own voice (Voice::recite), so her presence speaks it and shows its words as any
//            reply's; with no agent it only sounds.
//   the line's end, and a breath
//            The rings spread over the ground from its foot, the trunk comes up out of them and its branches
//            open, each picture comes as the tree reaches its height, lowest first, then its name, then a "New"
//            tab beside the name in the look of the name's own "Sent" tab. About 3.6 s.
// Pinched again while it waits, it is called off and everything goes back. Once the tree has been opened, it and
// the trees that made room have their old places again: the forest is as it was arranged, and the briefs and the
// tree are never in each other's way.
#include "oceanmodel.h"

#include <cctype>
#include <cstring>

#include "../agent/bridge.h"

namespace {

/// s the tree takes to fade as the sequence starts, and before it is moved, unseen.
constexpr float hideOver = 0.4f;
constexpr double stagedAfter = 0.45;
/// s after Momo's last word before anything grows.
constexpr double breath = 0.35;
/// s the rings take to spread, the trunk waits after they start, and the trunk takes to come up.
constexpr float ringsOver = 2.0f, trunkOver = 1.6f;
constexpr double trunkAfter = 0.25;
/// The share of the trunk's rise at which the lowest picture comes and the highest, and s between two at the least.
constexpr float firstPop = 0.3f, lastPop = 0.95f;
constexpr double popApart = 0.09;
/// s a picture takes to come, and how small it starts.
constexpr float popOver = 0.5f, popFrom = 0.6f;
/// s after the last picture that the name comes, and after the name that the tab does.
constexpr double nameAfter = 0.3, markAfter = 0.4;
/// m the tab comes down through as it arrives, and s it takes ("pills arrive whole from just above").
constexpr float dropFrom = 0.012f, dropOver = 0.8f;

const char* fallbackWords = "Hi there! I grew a new tree today on the topics you love! Would you like to check it out?";

std::string lowered(std::string s) {
    for (char& c : s) c = char(std::tolower(static_cast<unsigned char>(c)));
    return s;
}

}  // namespace

bool OceanModel::cueLoaded() {
    Cue& g = greeting;
    if (g.looked) return !g.sound.empty();
    g.looked = true;
    std::string path = platform::resourcePath("film/greeting.pcm");
    std::optional<std::string> bytes = path.empty() ? std::nullopt : platform::readFile(path);
    if (!bytes || bytes->size() < 2) {
        logLine("[film] no greeting: film/greeting.pcm is not with the app's media (tools/push_media.sh sends it)");
        return false;
    }
    g.sound.resize(bytes->size() / 2);
    std::memcpy(g.sound.data(), bytes->data(), g.sound.size() * 2);
    std::string beside = platform::resourcePath("film/greeting.txt");
    g.words = beside.empty() ? "" : platform::readFile(beside).value_or("");
    while (!g.words.empty() && std::isspace(static_cast<unsigned char>(g.words.back()))) g.words.pop_back();
    if (g.words.empty()) g.words = fallbackWords;
    logLine(fmt("[film] the greeting is %.1f s: %s", double(g.sound.size()) / Cue::rate, g.words.c_str()));
    return true;
}

bool OceanModel::cueReady() {
    // Every tree closed and standing on the desk, none on its way up or down.
    return built && !wantDown() && !forestDown && !pressing && !becoming && !shelf.empty() && cueLoaded();
}

double OceanModel::cueIn() {
    switch (greeting.phase) {
    case Cue::Phase::waiting: return std::max(0.001, greeting.startAt - time);
    case Cue::Phase::speaking:
    case Cue::Phase::growing: return 0;
    case Cue::Phase::none: break;
    }
    return -1;
}

OceanModel::Shelved* OceanModel::cueTree() {
    for (Shelved& s : shelf) {
        if (s.uid == greeting.fresh) return &s;
    }
    return nullptr;
}

OceanModel::Shelved* OceanModel::freshTree() {
    // The tree named; else the last the gardener made, since Momo says it grew it; else the last put away.
    Shelved* named = nullptr;
    Shelved* grown = nullptr;
    Shelved* last = nullptr;
    std::string want = lowered(greeting.tree);
    for (Shelved& s : shelf) {
        if (!s.caption || !s.tree) continue;
        if (!want.empty() && !named && lowered(s.tree->title).find(want) != std::string::npos) named = &s;
        // (Not the tree of lessons, "Welcome to Mind Forest", oceanmodel_guide.cpp: that one is the app's, and old.)
        if (s.tree->title == "Welcome to Mind Forest") continue;
        if (s.tree->maker == Maker::gardener) grown = &s;
        last = &s;
    }
    if (!want.empty() && !named) logLine("[film] no closed tree has \"" + greeting.tree + "\" in its name, so another is taken");
    return named ? named : grown ? grown : last;
}

Vec2 OceanModel::cuePlot() const {
    // Straight ahead, as near as a tree may stand (`farEnough`): nearer than the two the forest keeps before you to
    // left and right (desk.cpp, 1.7 m), and in front of everything else. `-cueFar 1.8` stands it further off.
    static const float far = Flags::has("cueFar") ? float(Flags::number("cueFar")) : 1.5f;
    Vec2 e = desk.plot(stage.origin);
    return {e.x, e.y + std::max(1.5f, far)};
}

float OceanModel::cueRings(const Shelved& s) const {
    const Cue& g = greeting;
    if (s.uid != g.fresh) return 1;
    switch (g.phase) {
    case Cue::Phase::waiting:
    case Cue::Phase::speaking: return 0;
    case Cue::Phase::growing: return std::min(1.f, std::max(0.f, s.ripple.value(time)));
    case Cue::Phase::none: break;
    }
    return 1;
}

void OceanModel::moveTree(Shelved& s, Vec2 plot, double delay) {
    // As `settle`: a glide, its rings drawn in before it leaves and spread again where it comes to rest; and it turns
    // to face you from there.
    float over = Pace::step;
    s.plot = plot;
    Vec3 p = restPoint(plot, s.foot, forestDown);
    s.mover->position.go(p, time, delay, over, Ease::glide);
    s.el.go(restEl(plot, forestDown), time, delay, over, Ease::glide);
    s.turnFrom = s.mover->entity->orientation;
    s.turnTo = stage.upright(p).orientation;
    s.turnStart = time + delay;
    s.turnOver = over;
    s.ripple.go(0, time, delay, 0.3f, Ease::out);
    s.rippleAgainAt = time + delay + double(over) - 0.25;
    touch(time + delay + double(over) + 1.6);
}

void OceanModel::cue(double after, const std::string& tree) {
    Cue& g = greeting;
    if (g.phase == Cue::Phase::waiting) {
        undoCue();
        logLine("[film] the greeting is called off");
        return;
    }
    if (g.phase != Cue::Phase::none || !cueReady()) return;
    g.tree = tree;
    Shelved* s = freshTree();
    if (!s) return;
    // (Asked for again before the last one's tree was opened: for another tree, the last one's go home first.)
    if (!g.moved.empty() && g.fresh != s->uid) {
        for (const Cue::Moved& m : g.moved) {
            auto t = std::find_if(shelf.begin(), shelf.end(), [&](const Shelved& c) { return c.uid == m.uid; });
            if (t != shelf.end()) moveTree(*t, m.from, 0);
        }
        g.moved.clear();
    }
    g.run++;
    g.phase = Cue::Phase::waiting;
    // (No sooner than the tree is out of sight and in its place.)
    g.startAt = time + std::max(stagedAfter + 0.1, after);
    g.fresh = s->uid;
    g.freshRef = s->tree;
    g.staged = false;
    g.pops.clear();
    g.goneAt = -1;
    if (g.mark) g.mark->removeFromParent();
    g.mark = nullptr;
    logLine(fmt("[film] the greeting starts in %.0f s, for ", after) + s->tree->title);
    stageFresh(time);
}

void OceanModel::stageFresh(double now) {
    Cue& g = greeting;
    Shelved* s = cueTree();
    if (!s) return;
    // It goes from where it stands, its rings drawn back in to its foot.
    s->mover->alpha.go(0, now, hideOver, Ease::out);
    s->ripple.go(0, now, 0.3f, Ease::out);
    s->rippleAgainAt = 0;
    s->mover->entity->inputTarget = false;
    s->mover->entity->hover = Hover::none();
    Vec2 e = desk.plot(stage.origin), middle = cuePlot();
    auto has = [&](int uid) { return std::any_of(g.moved.begin(), g.moved.end(), [&](const Cue::Moved& m) { return m.uid == uid; }); };
    if (!has(s->uid)) g.moved.push_back({s->uid, s->plot});
    s->plot = middle;
    // A tree in the way of the middle is turned about you, away from it, as far as clears it: one whose trunk would
    // be right behind the new tree's, or stand too near it (`Forest::crowd`), and one that stands beside it so near
    // that the two names, which lie before their feet in one line, would run into each other. No nearer any other
    // tree than the forest allows.
    g.tab = art ? art->coverTab("New") : std::nullopt;
    float tabWide = g.tab ? Art::coverTabGap + g.tab->size.x : 0;
    auto inWay = [&](const Shelved& t, Vec2 p) {
        if (Forest::crowd(desk, stage.origin, middle, p)) return true;
        bool beside = distance(p, e) - distance(middle, e) < 0.8f;
        // (A name is made smaller with its tree's pictures, `layName`; and a hand's width between the two.)
        float names = (s->nameSize.x / 2 + tabWide + t.nameSize.x / 2) * huddleUp * Forest::grown() + 0.1f;
        return beside && distance(p, middle) < names;
    };
    auto clear = [&](const Shelved& moving, Vec2 p) {
        if (!farEnough(p) || inWay(moving, p)) return false;
        for (const Shelved& t : shelf) {
            if (t.uid != moving.uid && t.uid != s->uid && Forest::crowd(desk, stage.origin, t.plot, p)) return false;
        }
        return true;
    };
    double delay = 0.1;
    for (Shelved& t : shelf) {
        if (t.uid == s->uid || !inWay(t, t.plot)) continue;
        Vec2 v = t.plot - e;
        float az = std::atan2(v.x, v.y), far = length(v), side = az < 0 ? -1.f : 1.f;
        std::optional<Vec2> to;
        for (int step = 1; step <= 70 && !to; step++) {
            float a = az + side * float(step) * floatPi / 180;
            Vec2 p{e.x + far * std::sin(a), e.y + far * std::cos(a)};
            if (clear(t, p)) to = p;
        }
        if (!to) to = freePlot();
        if (!has(t.uid)) g.moved.push_back({t.uid, t.plot});
        logLine(fmt("[film] %s makes room: from %.2f, %.2f to %.2f, %.2f", t.tree ? t.tree->title.c_str() : "a tree", double(t.plot.x),
                    double(t.plot.y), double(to->x), double(to->y)));
        moveTree(t, *to, delay);
        delay += 0.08;
    }
    // The briefs stand in the middle of the desk, before the forest's feet: the new tree's name would be behind them.
    if (!tree && !pressing && strip && strip->parent) {
        g.briefs = strip;
        fadeTo(strip, 0, 0, 0.35f);
        for (const EntityRef& child : strip->children) child->inputTarget = false;
    }
    // Its neighbours' rings, which stopped short of its own, have the ground to themselves from now.
    rakeForest();
    int run = g.run;
    after(stagedAfter, [this, run] { bareFresh(run); });
    touch(now + stagedAfter + 0.2);
}

/// Out of sight, the tree takes the middle, with nothing of it showing: each part then comes by itself.
void OceanModel::bareFresh(int run) {
    Cue& g = greeting;
    Shelved* s = cueTree();
    if (run != g.run || g.phase == Cue::Phase::none || !s) return;
    Vec3 p = restPoint(s->plot, s->foot, forestDown);
    s->mover->position.set(p);
    s->mover->entity->orientation = stage.upright(p).orientation;
    s->turnOver = 0;
    s->el.set(restEl(s->plot, forestDown));
    tip(s->tilts, s->el.value(time));
    if (s->branches) s->branches->scale = Vec3::repeating(0.001f);
    for (const CoverPicture& picture : s->pictures) picture.entity->opacity = 0.f;
    if (s->caption) s->caption->opacity = 0.f;
    s->ripple.set(0);
    if (s->gravel) s->gravel->show(0);
    s->mover->alpha.set(1);
    g.staged = true;
    rakeForest();
    touch(time + 0.3);
}

/// Everything of the tree as it is when nothing is going on: for when the sequence is cut short.
void OceanModel::showFresh(Shelved& s) {
    if (s.branches) s.branches->scale = Vec3::repeating(coverTree);
    layPictures(s.pictures, s.huddle.value(time));
    for (size_t k = 0; k < s.pictures.size(); k++) {
        bool shows = !forestDown || k < usualPictures;
        if (shows) s.pictures[k].entity->opacity.reset(); else s.pictures[k].entity->opacity = 0.f;
    }
    if (s.caption) s.caption->opacity.reset();
    s.ripple.go(1, time, 1.2f, Ease::out);
    s.mover->entity->inputTarget = !forestDown;
    s.mover->entity->hover = forestDown ? Hover::none() : Art::hover();
    touch(time + 1.4);
}

void OceanModel::undoCue() {
    Cue& g = greeting;
    g.run++;
    g.phase = Cue::Phase::none;
    g.startAt = g.endsAt = g.growAt = g.nameAt = g.markAt = g.grownAt = -1;
    g.pops.clear();
    for (const Cue::Moved& m : g.moved) {
        auto t = std::find_if(shelf.begin(), shelf.end(), [&](const Shelved& c) { return c.uid == m.uid; });
        if (t == shelf.end()) continue;
        if (m.uid != g.fresh) {
            moveTree(*t, m.from, 0);
            continue;
        }
        // The tree itself comes back where it stood, as it went.
        t->plot = m.from;
        Vec3 p = restPoint(t->plot, t->foot, forestDown);
        t->mover->position.set(p);
        t->mover->entity->orientation = stage.upright(p).orientation;
        t->turnOver = 0;
        t->el.set(restEl(t->plot, forestDown));
        tip(t->tilts, t->el.value(time));
        t->mover->alpha.set(0);
        t->mover->alpha.go(1, time, hideOver, Ease::out);
        showFresh(*t);
    }
    g.moved.clear();
    g.staged = false;
    g.fresh = -1;
    g.freshRef = nullptr;
    if (g.briefs && g.briefs == strip && strip->parent) {
        fadeTo(strip, 1, 0, 0.35f);
        for (const EntityRef& child : strip->children) child->inputTarget = picks.count(child.get()) > 0;
    }
    g.briefs = nullptr;
    rakeForest();
}

void OceanModel::growFresh(double now) {
    Cue& g = greeting;
    Shelved* s = cueTree();
    if (!s) return;
    g.phase = Cue::Phase::growing;
    // The ground first: the rings spread from its foot, and the trunk comes up out of them.
    s->ripple.set(0);
    s->ripple.go(1, now, ringsOver, Ease::out);
    g.growAt = now + trunkAfter;
    // Each picture comes as the tree reaches it: the lowest first.
    std::vector<const CoverPicture*> order;
    for (const CoverPicture& picture : s->pictures) order.push_back(&picture);
    std::stable_sort(order.begin(), order.end(), [&](const CoverPicture* a, const CoverPicture* b) { return placeOf(*a).y < placeOf(*b).y; });
    float low = order.empty() ? 0 : placeOf(*order.front()).y, high = order.empty() ? 1 : placeOf(*order.back()).y;
    double last = g.growAt + double(trunkOver) * firstPop;
    std::vector<double> sounds;
    g.pops.clear();
    for (size_t k = 0; k < order.size(); k++) {
        float share = high - low > 1e-3f ? (placeOf(*order[k]).y - low) / (high - low) : 0;
        double at = g.growAt + double(trunkOver) * double(firstPop + (lastPop - firstPop) * share);
        if (k > 0) at = std::max(at, last + popApart);
        last = at;
        g.pops.push_back({order[k]->id, at});
        fadeTo(order[k]->entity, 1, at - now, 0.25f);
        sounds.push_back(at - now);
    }
    g.nameAt = last + nameAfter;
    g.markAt = g.nameAt + markAfter;
    g.grownAt = g.markAt + double(dropOver);
    if (s->caption) fadeTo(s->caption, 1, g.nameAt - now, 0.45f);
    soundSprout(s->mover->entity->convertTo(Vec3{0, s->foot, 0}, nullptr), sounds);
    touch(g.grownAt + 0.3);
    logLine(fmt("[film] %s grows in: %d pictures, %.1f s", s->tree->title.c_str(), int(order.size()), g.grownAt - now));
}

void OceanModel::markFresh(double now) {
    Cue& g = greeting;
    Shelved* s = cueTree();
    std::optional<Piece> piece = s && s->caption ? g.tab : std::nullopt;
    if (!piece) return;
    g.mark = art->quad(*piece);
    // Beside its name, on the name's own line; a hair in front, so that neither hides the other when the name is tipped.
    g.markRest = {s->nameSize.x / 2 + Art::coverTabGap + piece->size.x / 2, 0, 0.001f};
    g.drop.set(dropFrom);
    g.drop.go(0, now, dropOver, Ease::arrive);
    g.mark->position = g.markRest + Vec3{0, dropFrom, 0};
    s->caption->addChild(g.mark);
    fadeIn(g.mark, 0, 0.45f);
    touch(now + double(dropOver) + 0.2);
}

void OceanModel::tendCue(double now) {
    Cue& g = greeting;
    Shelved* s = g.fresh >= 0 ? cueTree() : nullptr;
    if (g.phase != Cue::Phase::none && !s) {
        // (The tree went while it was going on: the service took it back.)
        logLine("[film] the greeting's tree is gone, so it ends");
        undoCue();
    }
    if (g.phase == Cue::Phase::waiting && now >= g.startAt) {
        if (!cueReady() || !g.staged) {
            logLine("[film] the greeting is not given: a tree was opened while it waited");
            undoCue();
        } else {
            agent::Voice* voice = agentBridge ? agentBridge->talk() : nullptr;
            bool said = voice && voice->recite(g.words, g.sound, Cue::rate);
            if (!said && !Flags::has("mute")) {
                g.plain = platform::playStream(Cue::rate, [](bool) {});
                if (g.plain) {
                    g.plain->write(g.sound.data(), g.sound.size());
                    g.plain->finish();
                }
                logLine("[film] Momo is not here to say the greeting, so it only sounds");
            }
            g.phase = Cue::Phase::speaking;
            g.endsAt = now + double(g.sound.size()) / Cue::rate;
        }
    }
    if (g.phase == Cue::Phase::speaking && now >= g.endsAt + breath) {
        g.plain = nullptr;
        if (forestDown) {
            // (A tree was opened as she spoke: this one is simply there, down with the others.)
            showFresh(*s);
            g.phase = Cue::Phase::none;
        } else {
            growFresh(now);
        }
    }
    if (g.phase == Cue::Phase::growing && s) {
        // The trunk comes up from its foot and opens as it rises: thin at first, as a shoot is.
        float u = std::min(1.f, std::max(0.f, float(now - g.growAt) / trunkOver));
        float tall = Ease::travel(u), wide = 0.3f + 0.7f * Ease::travel(std::max(0.f, (u - 0.2f) / 0.8f));
        if (s->branches) s->branches->scale = {coverTree * std::max(0.001f, wide * std::min(1.f, tall * 4)), coverTree * std::max(0.001f, tall), coverTree * std::max(0.001f, wide * std::min(1.f, tall * 4))};
        // Its rings take the ground as they spread, and its neighbours' give way before them: one neighbour raked
        // every other frame (a rake is about a millisecond on the headset), each in turn.
        if (now <= s->ripple.end() + 0.1 && ++cueRaked % 2 == 0) {
            float mine = Gravel::reach * Forest::grown();
            Vec3 at = restPoint(s->plot, 0, false);
            std::vector<size_t> near;
            for (size_t i = 0; i < shelf.size(); i++) {
                Vec3 d = restPoint(shelf[i].plot, 0, false) - at;
                if (shelf[i].uid != s->uid && shelf[i].gravel && std::sqrt(d.x * d.x + d.z * d.z) < 2 * mine) near.push_back(i);
            }
            if (!near.empty()) {
                size_t i = near[size_t(cueRaked / 2) % near.size()];
                shelf[i].cuts = ringCuts(i);
                shelf[i].gravel->rake(shelf[i].cuts);
                shelf[i].gravel->show(shelf[i].ripple.value(now));
                shelf[i].rakeDue = false;
            }
        }
        // A picture comes a little small and settles to its size, past it by a hair ("pop in").
        float k = s->huddle.value(now);
        for (const Cue::Pop& pop : g.pops) {
            if (now < pop.at || now > pop.at + double(popOver) + 0.05) continue;
            for (const CoverPicture& picture : s->pictures) {
                if (picture.id != pop.id) continue;
                float v = std::min(1.f, float(now - pop.at) / popOver);
                picture.entity->scale = Vec3::repeating(k * (popFrom + (1 - popFrom) * Ease::pop(v)));
            }
        }
        if (g.markAt >= 0 && now >= g.markAt) {
            g.markAt = -1;
            markFresh(now);
        }
        if (now >= g.grownAt) {
            if (s->branches) s->branches->scale = Vec3::repeating(coverTree);
            layPictures(s->pictures, k);
            s->mover->entity->inputTarget = !forestDown;
            s->mover->entity->hover = forestDown ? Hover::none() : Art::hover();
            g.phase = Cue::Phase::none;
            g.pops.clear();
            g.staged = false;
            rakeForest();
            logLine("[film] the new tree stands: " + s->tree->title);
        } else {
            touch(now + 0.2);
        }
    }
    if (g.mark) {
        if (g.fresh < 0 || !s) g.mark = nullptr;        // (its tree opened: the name went, and the tab with it)
        else if (now <= g.drop.end() + 0.05) g.mark->position = g.markRest + Vec3{0, g.drop.value(now), 0};
    }
    // Opened, the tree that had the middle is to stand where it stood before when it is next put away (the briefs
    // have the middle of the desk), and the trees that made room go back to where they stood.
    if (g.phase == Cue::Phase::none && !g.moved.empty() && g.freshRef && !s) {
        bool opened = tree == g.freshRef && standingPlot;
        if (opened) {
            for (const Cue::Moved& m : g.moved) {
                auto t = std::find_if(shelf.begin(), shelf.end(), [&](const Shelved& c) { return c.uid == m.uid; });
                if (m.uid == g.fresh) standingPlot = m.from;
                else if (t != shelf.end()) moveTree(*t, m.from, 0);
            }
            rakeForest();
        }
        if (g.goneAt < 0) g.goneAt = now;
        // (Or it left some other way: a few seconds on, it is no longer waited for.)
        if (opened || now > g.goneAt + 4) {
            g.moved.clear();
            g.freshRef = nullptr;
            g.fresh = -1;
            g.goneAt = -1;
        }
    }
}
