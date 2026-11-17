// 
//
// The desk: where the scene sits, what stands on the desk and where, and
// bringing the whole scene to where you are when you have turned or moved
// away from it. (See desk.h, and `// MARK: The desk` in oceanmodel.h.)
#include "oceanmodel.h"

#include "../agent/bridge.h"

#include <cmath>
#include <cstddef>
#include <cstring>

// MARK: - Sitting down

/// Chooses where the scene sits. The head and the tables are as the host has
/// them when the scene is built, which it holds back a moment for the room.
void OceanModel::sit() {
    Chair ahead;
    ahead.eyes = {0, 1.5f, 0};
    Mat4 head = platform::head().value_or(ahead.matrix());
    Seating s = Seating::choose(head, noDesk() ? std::vector<platform::Table>() : platform::tables());
    stage = Stage(s.seat.matrix());
    desk = s.desk;
    platform::holdTo(desk.table);
    plantForest();
    seatedAt = time;
    logLine("[desk] seated at " + s.note);
}

float OceanModel::treeBack() const {
    // Within easy reach of a finger: about 36 cm ahead of the eyes, and on the desk whatever its edge does.
    float before = -desk.plot(stage.origin).y;          // m the eyes are in front of the near edge
    float z = std::max(0.11f, 0.36f - before);
    if (desk.found) z = std::min(z, std::max(0.06f, desk.depth - 0.09f));
    return z;
}

/// What can be done with the standing tree: on the desk to the right of the small tree, a little further back.
Vec2 OceanModel::controlsPlot() const {
    float x = desk.found ? std::max(0.24f, std::min(0.33f, desk.right - 0.2f)) : 0.33f;
    return {x, treeBack() + 0.1f};
}

/// The tray trees are sent to: to the right, further back.
Vec2 OceanModel::trayPlot() const {
    float x = desk.found ? std::max(0.34f, std::min(0.62f, desk.right - 0.14f)) : 0.62f;
    return {x, treeBack() + 0.36f};
}

float OceanModel::briefsEl() const {
    // 19 degrees down and 1.25 m off. While the forest stood near and low they
    // had to stand above its tops; now it begins further off than they are and rises past eye level, and
    // they stand before its feet, over the desk.
    return -19;
}

Quat OceanModel::deskFacing(Vec3 p) const {
    Vec3 v = stage.origin - p;
    float tip = std::atan2(v.y, std::max(0.05f, std::sqrt(v.x * v.x + v.z * v.z)));
    Vec3 z = normalize(stage.u * std::sin(tip) - desk.back * std::cos(tip));
    return Quat(Mat3(desk.across, cross(z, desk.across), z));
}

void OceanModel::plantForest() {
    // The forest stands on the desk only while no tree is open, and then neither the small tree nor
    // what stands to its right is there: only the tray is to be kept clear of.
    std::vector<Forest::Clearing> clearings{{trayPlot(), 0.13f}};
    plots = Forest::plots(desk, stage.origin, forestNear(), clearings);
}

Vec3 OceanModel::plantPoint(Vec2 plot, float foot) const { return restPoint(plot, foot, false); }

float OceanModel::plantEl(Vec2 plot) const { return restEl(plot, false); }

Vec3 OceanModel::restPoint(Vec2 plot, float foot, bool down) const {
    if (!down) return desk.at(plot.x, plot.y, -foot * Forest::grown());
    // Down onto the ocean, and half as far off again along its own line of sight. (Straight down at
    // first. With the trees a metre tall and a metre and a half off, the nearest then lay, half a metre
    // tall, right behind the small tree and what stands beside it; further out they lie past the foot
    // of the layer you work on, where its cards are small.)
    // (And no nearer than 3.3 m: nearer, the first two lay right behind what stands on the desk to the right of the small tree.)
    Vec2 e = desk.plot(stage.origin);
    float far = distance(plot, e);
    Vec2 out = e + (plot - e) * (std::max(far * 1.5f, 3.3f) / std::max(far, 0.1f));
    Vec3 p = desk.at(out.x, out.y);
    p.y = stage.origin.y - stage.drop + 0.02f - foot * Forest::scale();
    return p;
}

float OceanModel::restEl(Vec2 plot, bool down) const {
    float size = down ? Forest::scale() : Forest::grown();
    Vec3 v = stage.origin - (restPoint(plot, 0, down) + stage.u * (0.3f * Forest::tall * size));
    return -std::atan2(v.y, std::max(0.05f, std::sqrt(v.x * v.x + v.z * v.z))) * 180 / floatPi;
}

/// One tree put away goes to the desk or to the floor: a glide, as anything large that moves.
void OceanModel::settle(Shelved& s, bool down, double delay) {
    float over = Pace::step;
    s.mover->position.go(restPoint(s.plot, s.foot, down), time, delay, over, Ease::glide);
    s.mover->scale.go(down ? Forest::scale() : Forest::grown(), time, delay, over, Ease::glide);
    s.el.go(restEl(s.plot, down), time, delay, over, Ease::glide);
    s.huddle.go(down ? huddleDown : huddleUp, time, delay, over, Ease::glide);
    // Its rings draw back in to its foot as it leaves, and spread again where it comes to rest.
    s.ripple.go(0, time, delay, 0.3f, Ease::out);
    s.rippleAgainAt = time + delay + double(over) - 0.25;
    // On the floor it is not to be pointed at; on the desk it is, from the moment it starts up.
    s.mover->entity->inputTarget = !down;
    s.mover->entity->hover = down ? Hover::none() : Art::hover();
    // Its further pictures go as it leaves the desk, and come back as it arrives.
    for (size_t k = usualPictures; k < s.pictures.size(); k++) {
        fadeTo(s.pictures[k].entity, down ? 0.f : 1.f, delay + (down ? 0.0 : double(over) * 0.55), 0.4f);
    }
    touch(time + delay + double(over) + 0.15);
}

void OceanModel::watchForest() {
    if (!built) return;
    bool down = wantDown();
    if (down == forestDown) return;
    forestDown = down;
    // From left to right, each a moment after the last.
    std::vector<size_t> order;
    for (size_t i = 0; i < shelf.size(); i++) order.push_back(i);
    std::stable_sort(order.begin(), order.end(), [&](size_t a, size_t b) { return shelf[a].plot.x < shelf[b].plot.x; });
    for (size_t k = 0; k < order.size(); k++) settle(shelf[order[k]], down, double(std::min(k, size_t(12))) * 0.05);
    rakeForest();
    logLine(fmt("[desk] the forest %s (%d trees)", down ? "sinks to the ocean's floor" : "rises to the desk", int(shelf.size())));
}

void OceanModel::tendForest(double now) {
    if (becoming) {
        Becoming& b = *becoming;
        float u = std::min(1.f, std::max(0.f, float(now - b.start) / b.over));
        b.mover->entity->orientation = slerp(b.from, b.to, Ease::travel(u));
        if (b.branches) b.branches->scale = {coverTree, coverTree * b.squash.value(now), coverTree};
        if (now > b.start + double(b.over) + 0.25) becoming = std::nullopt;
    }
    bool raked = false;
    for (Shelved& s : shelf) {
        if (s.rakeDue && s.gravel && !raked) {
            s.rakeDue = false;
            raked = true;
            s.gravel->rake(s.cuts);
        }
        if (now <= s.el.end() + 0.05) tip(s.tilts, s.el.value(now));
        if (s.gravel) {
            if (s.rippleAgainAt > 0 && now >= s.rippleAgainAt) {
                s.rippleAgainAt = 0;
                s.ripple.go(1, now, 1.2f, Ease::out);
                touch(now + 1.35);
            }
            if (now <= s.ripple.end() + 0.05) s.gravel->show(s.ripple.value(now));
        }
        // AGENT: and while a picture eases to a new place (`relayout`).
        bool easing = std::any_of(s.pictures.begin(), s.pictures.end(), [&](const CoverPicture& p) {
            return p.moveStart >= 0 && now <= p.moveStart + double(coverEase) + 0.05;
        });
        if (now <= s.huddle.end() + 0.05 || easing) {
            layPictures(s.pictures, s.huddle.value(now));
            layName(s.caption, s.nameSize, s.foot, s.huddle.value(now));
        }
        if (s.turnOver > 0) {
            float u = std::min(1.f, std::max(0.f, float(now - s.turnStart) / s.turnOver));
            s.mover->entity->orientation = slerp(s.turnFrom, s.turnTo, Ease::travel(u));
            if (u >= 1) s.turnOver = 0;
        }
    }
}

void OceanModel::layPictures(const std::vector<CoverPicture>& pictures, float k) const {
    for (const CoverPicture& p : pictures) {
        // Smaller, and as much nearer the trunk; as high on the tree as before. (AGENT: on its way to its place, `placeOf`.)
        Vec3 at = placeOf(p);
        p.entity->scale = Vec3::repeating(k);
        p.entity->position = {at.x * k, at.y, at.z};
    }
}

void OceanModel::layName(const EntityRef& caption, Vec2 size, float foot, float k) {
    if (!caption) return;
    // (Kai asked this of the pictures. The name is done with them: at a metre tall a tree's name was a
    // plate nearly a metre wide, larger than anything else on it.)
    caption->scale = Vec3::repeating(k);
    caption->position = {0, foot + size.y * k / 2 + 0.01f, 0.03f + 0.07f * k};
}

std::vector<Gravel::Cut> OceanModel::ringCuts(size_t i) const {
    bool down = wantDown();
    /// Where a tree's foot is (or is going), how large it is there, and how far from the eyes.
    struct Stood {
        Vec3 at;
        float size;
        float far;
    };
    auto stood = [&](const Shelved& s) {
        Vec3 p = restPoint(s.plot, 0, down);
        Vec3 v = p - stage.origin;
        return Stood{p, down ? Forest::scale() : Forest::grown(), std::sqrt(v.x * v.x + v.z * v.z)};
    };
    Stood mine = stood(shelf[i]);
    std::vector<Gravel::Cut> cuts;
    Quat turn = stage.upright(mine.at).orientation.inverse();
    for (size_t j = 0; j < shelf.size(); j++) {
        if (j == i) continue;
        // FILM: a tree whose rings are not all out has only the ground they have come to (`cueRings`).
        float share = cueRings(shelf[j]);
        if (share <= 0.001f) continue;
        Stood other = stood(shelf[j]);
        // Only a nearer tree's rings are in the way: its are whole, and these stop short of them.
        bool nearer = other.far < mine.far || (other.far == mine.far && j < i);
        if (!nearer) continue;
        Vec3 d = other.at - mine.at;
        if (std::sqrt(d.x * d.x + d.z * d.z) > Gravel::reach * (mine.size + other.size * share)) continue;
        Vec3 local = turn.act(d) / mine.size;
        // (Just clear of its last ring: they run up to that line and end at it.)
        cuts.push_back(Gravel::Cut{Vec2{local.x, local.z}, Gravel::reach * other.size / mine.size * 1.025f * share});
    }
    return cuts;
}

void OceanModel::rakeForest() {
    for (size_t i = 0; i < shelf.size(); i++) {
        if (!shelf[i].gravel) continue;
        shelf[i].cuts = ringCuts(i);
        shelf[i].rakeDue = true;
    }
    touch(time + 0.1 + 0.02 * double(shelf.size()));
}

void OceanModel::fadeTo(const EntityRef& e, float to, double delay, float over) {
    float from = e->opacity.value_or(1);
    fades.erase(std::remove_if(fades.begin(), fades.end(), [&](const Fade& f) { return f.entity == e; }), fades.end());
    Tween<float> alpha(from);
    alpha.go(to, time, delay, over, Ease::out);
    fades.push_back(Fade{e, alpha, false});
    touch(time + delay + double(over) + 0.05);
}

/// The small tree goes with its tree: it fades, then is put away.
void OceanModel::hideHologram() {
    if (!hologram || !hologram->entity->isEnabled || holoHiding) return;
    holoHiding = true;
    fadeTo(hologram->entity, 0, 0, 0.25f);
    after(0.28, [this] {
        if (!holoHiding || !hologram) return;
        holoHiding = false;
        hologram->entity->isEnabled = false;
    });
}

Vec2 OceanModel::freePlot() const {
    for (Vec2 p : plots) {
        bool taken = false;
        for (const Shelved& cover : shelf) {
            if (Forest::crowd(desk, stage.origin, cover.plot, p)) taken = true;
        }
        if (standingPlot && Forest::crowd(desk, stage.origin, *standingPlot, p)) taken = true;
        if (!taken) return p;
    }
    // More trees than places: on past the last row.
    int n = int(shelf.size());
    return Vec2{float(n % 7 - 3) * 1.0f, forestNear() + Forest::deep + 0.6f + 0.8f * float(n / 7 % 4)};
}

/// Stands everything that belongs on the desk where the desk now is.
void OceanModel::layDesk() {
    plantForest();
    if (hologram) seat(hologram->entity);
    if (trayEntity) {
        trayEntity->position = trayPoint() + stage.u * 0.012f;
        trayEntity->orientation = deskFacing(trayPoint());
    }
    // A tree that stood where this desk has no top is given a place on it.
    std::vector<Shelved> kept;
    kept.swap(shelf);
    for (Shelved& s : kept) {
        bool on = farEnough(s.plot);
        if (!on) {
            s.plot = freePlot();
            shelfDirty = true;
        }
        Vec3 p = restPoint(s.plot, s.foot, forestDown);
        s.mover->position.set(p);
        s.mover->entity->orientation = stage.upright(p).orientation;
        s.el.set(restEl(s.plot, forestDown));
        tip(s.tilts, s.el.value(time));
        shelf.push_back(s);
    }
    rakeForest();
    stripKey.clear();
    rebuildStrip();
    touch(time + 0.5);
}

// MARK: - Bringing the scene along

/// Brings the whole scene to where you are now. It does not travel there: it
/// fades away, is laid at the new place (squared to the desk there, if there
/// is one), and comes back. Everything in it is as it was.
void OceanModel::reseat(const std::string& why) {
    if (!built || reseating) return;
    reseating = true;
    hideSeatPrompt();
    leaveHologram();
    if (press) press->cancelled = true;
    platform::readRoom();
    logLine("[desk] bringing the scene along: " + why);
    veil_.go(0, time, 0.3f, Ease::out);
    touch(time + 1.3);
    after(0.36, [this] {
        std::optional<Mat4> head = platform::head();
        Chair here{stage.origin, stage.f};
        Seating s = Seating::choose(head.value_or(here.matrix()), noDesk() ? std::vector<platform::Table>() : platform::tables(), stage.f);
        // The scene's own space stays; the room is laid under it so that the new seat is the stage's.
        Mat4 t = here.matrix() * s.seat.matrix().inverse();
        platform::carryScene(t);
        desk = s.desk;
        desk.front = t.point(desk.front);
        desk.across = stage.r;
        desk.back = stage.f;
        platform::holdTo(desk.table);
        // The hands have jumped with the room: that was no gesture.
        handsStillUntil = time + 0.5;
        hands->hold(0.8);
        layDesk();
        veil_.go(1, time, 0.12, 0.6f, Ease::out);
        sound("place", 0.8f, 0.15);
        touch(time + 1.0);
        reseating = false;
        seatedAt = time;
        awaySince = backSince = -1;
        seatDeclined = false;
        logLine("[desk] seated at " + s.note);
    });
}

/// You have turned or moved far enough that the scene is hard to see or out
/// of reach, and stayed so for a few seconds: a small card comes up in front
/// of you offering to bring everything along. It stays where it came up
/// (nothing follows the head); if you turn on, away from it too, it comes up
/// again where you now look. Back at the scene, it goes.
void OceanModel::watchSeat(float dt) {
    if (!built || reseating) return;
    // The headset was recentred: that is the user saying "here".
    if (platform::recentred()) {
        after(0.3, [this] { reseat("the headset was recentred"); });
        return;
    }
    std::optional<Mat4> head = platform::head();
    if (!head) return;
    double now = time;
    // The room was read after the scene had sat down at an assumed desk (the permission was only
    // just given, say): sit at the real one, while nothing is being worked on.
    static size_t tablesKnown = 0;
    static double tablesAt = 0;
    if (!noDesk() && now - tablesAt > 1) {
        tablesAt = now;
        size_t n = platform::tables().size();
        if (n != tablesKnown) {
            tablesKnown = n;
            if (!desk.found && !tree && n > 0 && Seating::choose(*head, platform::tables(), stage.f).desk.found) {
                reseat("a table has been found");
                return;
            }
        }
    }
    if (Flags::has("noSeatPrompt")) return;

    Vec3 v = head->position() - stage.origin;
    float moved = std::sqrt(dot(v, stage.r) * dot(v, stage.r) + dot(v, stage.f) * dot(v, stage.f));
    Vec3 look = head->forward();
    float turned = 0;
    if (std::fabs(look.y) < 0.9f) {
        look.y = 0;
        turned = std::acos(std::min(1.f, std::max(-1.f, dot(normalize(look), stage.f)))) * 180 / floatPi;
    }
    // Further than an arm from the small tree; stood up or sat down; or turned so far that the
    // middle of the layer you work on has left the view.
    bool away = moved > 0.85f || std::fabs(v.y) > 0.4f || turned > 75;
    // (Coming back counts from a little nearer than going away, so it does not flicker at the line.)
    bool back = moved < 0.6f && std::fabs(v.y) < 0.3f && turned < 55;
    if (away) {
        if (awaySince < 0) awaySince = now;
        backSince = -1;
    } else if (back) {
        if (backSince < 0) backSince = now;
        awaySince = -1;
        if (now - backSince > 1.0) {
            seatDeclined = false;
            if (seatPrompt && !seatPrompt->held) hideSeatPrompt();
        }
    }
    bool handsBusy = press.has_value() || hands->carrying() || pressing;
    if (!seatPrompt) {
        if (awaySince >= 0 && now - awaySince > (moved > 0.85f ? 2.5 : 4.0) && !seatDeclined && !handsBusy && now - seatedAt > 3) showSeatPrompt();
        return;
    }
    // Shown, but you have turned away from it as well.
    Vec3 to = seatPrompt->entity->position - head->position();
    bool seen = length(to) < 1.6f && dot(normalize(to), head->forward()) > 0.64f;        // within about 50 degrees
    if (seen) {
        seatPrompt->unseenSince = -1;
    } else {
        if (seatPrompt->unseenSince < 0) seatPrompt->unseenSince = now;
        if (now - seatPrompt->unseenSince > 2.5 && !handsBusy) showSeatPrompt(seatPrompt->held);
    }
}

void OceanModel::showSeatPrompt(bool held) {
    std::optional<Mat4> head = platform::head();
    if (!head || !art) return;
    hideSeatPrompt();
    Vec3 eye = head->position();
    Vec3 look = head->forward();
    look.y = 0;
    look = length(look) > 1e-3f ? normalize(look) : stage.f;
    // Right where the eyes rest: a little below where the headset points, 85 cm off.
    float down = 9 * floatPi / 180;
    Vec3 p = eye + (look * std::cos(down) - stage.u * std::sin(down)) * 0.85f;
    EntityRef holder = Entity::make();
    Vec3 z = normalize(eye - p), x = normalize(cross(stage.u, z));
    holder->orientation = Quat(Mat3(x, cross(z, x), z));

    // What happened, then what can be done about it. (At first "Everything stayed where you set it up",
    // "Bring it here", "Leave it there": Kai, 2026-11-15, "the language is not clear", and asked for
    // something like "you moved away - reset the space?". Then, the same day: "too small and hard to
    // notice". It was one line of label type and two small buttons. Now what happened is a headline, the
    // question a line under it, the answers buttons a finger wide, all on a dark card with a lit edge, as
    // the card in focus has; it comes up into place as it appears, and is heard.)
    Vec3 gone = eye - stage.origin;
    bool walked = std::sqrt(dot(gone, stage.r) * dot(gone, stage.r) + dot(gone, stage.f) * dot(gone, stage.f)) > 0.6f || std::fabs(gone.y) > 0.3f;
    std::optional<Piece> what = art->line(walked || held ? "You moved away" : "You turned away", Art::Size::title, Font::Weight::semibold, Color::white(),
                                          Color::clear(), Vec2::zero());
    std::optional<Piece> ask = art->line("Reset the space here?", Art::Size::lead, Font::Weight::medium, Color::white(1, 0.78f), Color::clear(), Vec2::zero());
    const Vec2 button{0.018f, 0.011f};
    std::optional<Piece> yes = art->line("Reset", Art::Size::lead, Font::Weight::semibold, Color::white(), Art::hot, button);
    std::optional<Piece> no = art->line("Not now", Art::Size::lead, Font::Weight::medium, Color::white(), Color::hex(0x2A2E36), button);
    if (!what || !ask || !yes || !no) return;
    SeatPrompt prompt;
    prompt.entity = holder;
    prompt.held = held;
    auto add = [&](const Piece& piece, float x, float y, const std::optional<Pick>& pick) {
        EntityRef e = art->quad(piece);
        e->position = {x + piece.size.x / 2, y, 0.004f};
        if (pick) {
            e->collision = {Shape::generateBox({piece.size.x, piece.size.y + 0.01f, 0.01f})};
            e->inputTarget = true;
            e->hover = Art::hover();
            picks[e.get()] = *pick;
            prompt.picks.push_back(e.get());
        }
        holder->addChild(e);
    };
    // One left edge for the words and the first button; even room all round.
    float gap = 0.012f, margin = 0.026f;
    float buttons = yes->size.x + gap + no->size.x;
    float wide = std::max({what->size.x, ask->size.x, buttons});
    float high = what->size.y + 0.01f + ask->size.y + 0.024f + yes->size.y;
    float left = -wide / 2, top = high / 2;
    add(*what, left, top - what->size.y / 2, std::nullopt);
    add(*ask, left, top - what->size.y - 0.01f - ask->size.y / 2, std::nullopt);
    float row = -top + yes->size.y / 2;
    add(*yes, left, row, Pick::reseat());
    add(*no, left + yes->size.x + gap, row, Pick::stay());
    Vec2 card{wide + 2 * margin, high + 2 * margin};
    {
        Material dark = Material::unlit(Art::ink.withAlphaComponent(0.9f));
        dark.transparent = true;
        dark.opacity = 1;
        holder->addChild(Entity::make(Mesh::generatePlane(card.x, card.y), {dark}));
        if (EntityRef glow = art->glow(card)) {
            glow->position.z = -0.003f;
            holder->addChild(glow);
        }
    }
    root_->addChild(holder);
    // It comes up a hand's breadth into place as it appears: something that arrives is seen, where
    // something that is merely there is not.
    // (Half as large again as its type is set: a card 30 cm wide at 85 cm, as wide as a system dialog is.)
    MoverRef m = std::make_shared<Mover>(holder, p - stage.u * 0.05f, 1.5f);
    m->position.go(p, time, 0.6f, Ease::arrive);
    m->alpha.set(0);
    m->alpha.go(1, time, 0.35f, Ease::out);
    movers.push_back(m);
    apply(*m, time);
    touch(time + 0.7);
    prompt.mover = m;
    seatPrompt = prompt;
    sound("holo_wake", 0.9f);
    logLine("[desk] offered to bring the scene along");
}

void OceanModel::hideSeatPrompt() {
    if (!seatPrompt) return;
    for (const Entity* e : seatPrompt->picks) picks.erase(e);
    for (const EntityRef& child : seatPrompt->entity->children) child->inputTarget = false;
    if (seatPrompt->mover) {
        seatPrompt->mover->alpha.go(0, time, 0.2f, Ease::out);
        seatPrompt->mover->removeAt = time + 0.22;
        touch(time + 0.3);
    } else {
        fadeOut(seatPrompt->entity, 0.2f);
    }
    seatPrompt = std::nullopt;
}

// MARK: - AGENT: Send and Share over a tree in the forest

void OceanModel::tendHover(double now) {
    if (hoverForced >= 0 && now > hoverForcedUntil) {
        if (hoverForced < int(shelf.size())) shelf[size_t(hoverForced)].mover->entity->hovered = 0;
        hoverForced = -1;
    }
    // The tree a ray rests on most, on the desk (a ray finds no tree on the ocean's floor), and the one that shows its buttons.
    int most = -1, showing = -1;
    float strongest = 0.3f;
    for (size_t i = 0; i < shelf.size(); i++) {
        if (int(i) == hoverForced) shelf[i].mover->entity->hovered = 1;
        float h = shelf[i].mover->entity->hovered;
        if (h > strongest) {
            strongest = h;
            most = int(i);
        }
        if (shelf[i].buttons) showing = int(i);
    }
    auto served = [&](const Shelved& s) { return !forestDown && agentBridge && s.tree && agentBridge->serves(*s.tree); };
    if (most >= 0 && served(shelf[size_t(most)])) shelf[size_t(most)].hoverSeen = now;
    // One tree shows them at a time. It keeps them while a ray is anywhere on it or on them (they hang from it, and their
    // targets reach down to its crown), and `hoverGrace` s after; a button that says it took keeps them its while, even
    // when the tree is no longer the service's (a tree shared is taken out of the forest at once, and its cover stays).
    if (showing >= 0) {
        Shelved& s = shelf[size_t(showing)];
        // (FILM: longer while its list of people is open.)
        double grace = sharing.list && sharing.uid == s.uid ? peopleGrace : hoverGrace;
        bool on = s.mover->entity->hovered > 0.05f || (s.hoverSeen >= 0 && now - s.hoverSeen < grace);
        if (!((served(s) && on) || (!forestDown && now < s.buttonsUntil))) {
            logLine("[ocean] Send and Share go from " + s.tree->title);
            if (sharing.uid == s.uid) closePeople(false);       // FILM: the list of people goes with them
            if (sharing.uid == s.uid && sharing.waiting) sharing = Sharing{};     // (AGENT: a late answer brings them back)
            for (const EntityRef& b : s.buttons->children) picks.erase(b.get());
            s.tilts.erase(std::remove(s.tilts.begin(), s.tilts.end(), s.buttons), s.tilts.end());
            fadeOut(s.buttons, 0.2f);
            s.buttons = nullptr;
            s.pills = {};
            s.buttonsUntil = -1;
            showing = -1;
        }
    }
    if (showing < 0 && most >= 0 && served(shelf[size_t(most)])) {
        showButtons(shelf[size_t(most)], -1);
        logLine("[ocean] Send and Share over " + shelf[size_t(most)].tree->title);
        showing = most;
    }
}

void OceanModel::showButtons(Shelved& s, int pressed, const std::string& said) {
    if (!art) return;
    EntityRef holder = s.mover->entity;
    bool again = s.buttons != nullptr;
    if (again) {
        for (const EntityRef& b : s.buttons->children) picks.erase(b.get());
        s.tilts.erase(std::remove(s.tilts.begin(), s.tilts.end(), s.buttons), s.tilts.end());
        s.buttons->removeFromParent();
    }
    // FILM: Kai, 2026-11-17, of the two pills tracy/agents had here (each a target 12 by 6 degrees, side by side on the crown):
    // "The pill shaped send and share buttons don't fit too well with our design otherwise. Please switch to square design
    // with colored accents. On the buttons, they should say: Send to Agents and Share with Friends"; and of a first version
    // that stood them one above the other: "The buttons should still sit side by side." So each is a dark rectangle as wide
    // as its words, with a bar of its colour down its left edge, as a brief is: the accent for what is sent, green for
    // friends. Sized by the eye, at the tree's distance: `actionTall` degrees tall, `actionGap` apart, the pair centred over
    // the trunk; their targets `actionReach` tall, a degree past each outer end, and meeting half way between the two, so a
    // ray between them is on the nearer. They stand on the crown, a little toward you, in front of the tree's pictures.
    float k = std::max(1e-3f, s.mover->scale.target());
    float crown = s.foot + (s.treeFoot + float(s.layers - 1) * s.treeRise) * coverTree;
    float d = std::max(0.5f, distance(stage.origin, s.mover->position.target() + stage.u * (crown * k)));
    float degree = std::tan(float(M_PI) / 180) * d / k;          // m of the tree's own measure that a degree takes there
    float tall = actionReach * degree, pillTall = actionTall * degree, gap = actionGap * degree;
    // AGENT: each target at least `targetWide` by `targetTall` (the lead's aims, WS73), wider outward only, so the two still
    // meet half way between, and taller upward only, clear of the list Share opens under them.
    float reach = std::max(actionReach, targetTall) * degree, lift = (reach - tall) / 2;
    // The one pressed says it took, filled with its colour, and takes no press. Share is filled too while its list of
    // people is open: it is on, and a pinch on it shuts the list. A button is never narrower for what it then says.
    std::optional<Piece> pieces[2];
    float wides[2] = {0, 0}, size = 1;
    for (int b = 0; b < 2; b++) {
        // (AGENT: and while a share sent through Telegram waits for its answer.)
        bool waiting = b == 1 && sharing.waiting && sharing.uid == s.uid;
        bool open = (b == 1 && sharing.list && sharing.uid == s.uid && sharing.chosen < 0) || waiting;
        std::optional<Piece> rest = art->action(actionWords(s, b, false), buttonText, actionAccent(b), actionOn(b), false);
        if (!rest) return;
        // AGENT: why a share was not taken (`shareRefused`) is said in Share's place, as it was; not filled, since it has not
        // done its work.
        bool refused = b == pressed && !said.empty();
        pieces[b] = art->action(refused ? said : actionWords(s, b, b == pressed), buttonText, actionAccent(b), actionOn(b), open || (b == pressed && !refused),
                                rest->size.x * Art::ppm);
        if (!pieces[b]) return;
        size = pillTall / pieces[b]->size.y;
        wides[b] = pieces[b]->size.x * size;
    }
    EntityRef row = Entity::make();
    row->position = {0, crown + tall / 2, 0.1f};
    float left = -(wides[0] + gap + wides[1]) / 2;
    float reaches[2] = {0, 0};
    for (int b = 0; b < 2; b++) {
        float x = b == 0 ? left + wides[0] / 2 : left + wides[0] + gap + wides[1] / 2;
        // (Its target: from the middle of the gap to a degree past its outer end, or further out, to `targetWide`.)
        float inner = left + wides[0] + gap / 2;
        float outer = b == 0 ? std::min(left - degree, inner - targetWide * degree) : std::max(-left + degree, inner + targetWide * degree);
        float wide = std::abs(outer - inner), centre = (inner + outer) / 2;
        reaches[b] = wide;
        EntityRef target = Entity::make();
        target->position = {centre, lift, 0};
        target->collision = {Shape::generateBox({wide, reach, 0.04f})};
        // A ray on one lights that one, and neither takes the glow of the tree behind them, which turns a dark label tan
        // (`tendShare` counts a ray on a button as a ray on its tree, since the tree itself is then not what is lit).
        target->hover = Hover::highlight(Color::white(), b == pressed ? 0 : 0.35f);
        if (b != pressed && !(b == 1 && sharing.waiting && sharing.uid == s.uid)) picks[target.get()] = Pick::coverButton(s.uid, b);
        row->addChild(target);
        if (Flags::has("showHitAreas")) {
            if (std::optional<Piece> area = art->piece(fmt("hit-area:%.0fx%.0f", double(wide * Art::ppm), double(reach * Art::ppm)), wide * Art::ppm, reach * Art::ppm,
                                                       [](Canvas&, CGSize box) {
                                                           setFill(Color::white(1, 0.22f));
                                                           UIRectFill(CGRect(0, 0, box.width, box.height));
                                                           setFill(Color::white(1, 0.6f));
                                                           UIRectFill(CGRect(0, 0, box.width, 3));
                                                           UIRectFill(CGRect(0, box.height - 3, box.width, 3));
                                                           UIRectFill(CGRect(0, 0, 3, box.height));
                                                           UIRectFill(CGRect(box.width - 3, 0, 3, box.height));
                                                       })) {
                EntityRef shown = art->quad(*area);
                shown->position = {centre, lift, -0.002f};
                row->addChild(shown);
            }
        }
        EntityRef pill = art->quad(*pieces[b]);
        pill->scale = Vec3::repeating(size);
        pill->position = {x - centre, -lift, 0.004f};
        target->addChild(pill);
        s.pills[size_t(b)] = pill;
    }
    holder->addChild(row);
    s.tilts.push_back(row);
    tip({row}, s.el.value(time));
    bringNearer(s, row);        // FILM: clear of the tree's light and pictures, as large to the eye
    if (!again) fadeIn(row, 0, 0.2f);
    s.buttons = row;
    touch(time + 0.3);
    logLine(fmt("[ocean] Send and Share over %s: buttons %.0f° and %.0f° wide and %.0f° tall, side by side, their targets %.0f° and %.0f° wide and %.0f° tall, at %.2f m, "
                "on the crown",
                s.tree->title.c_str(), double(wides[0] / degree), double(wides[1] / degree), double(actionTall), double(reaches[0] / degree), double(reaches[1] / degree),
                double(reach / degree), double(d)));
}

void OceanModel::coverButton(int uid, int which) {
    auto i = std::find_if(shelf.begin(), shelf.end(), [&](const Shelved& cover) { return cover.uid == uid; });
    if (i == shelf.end() || !i->tree || !agentBridge) return;
    // AGENT: through Telegram (the hosted service), Share asks at once, with no list: those people are the film's, and a judge
    // shares by forwarding the link the service sends to their own Telegram. It says so when the service answers
    // (`shareTaken`, `shareRefused`); meanwhile it is on and takes no second pinch (the lead, WS88).
    if (which == 1 && agentBridge->sharesByTelegram()) {
        if (sharing.waiting && sharing.uid == uid) {
            logLine("[ocean] Share over " + i->tree->title + ": asked already, the answer awaited");
            return;
        }
        if (sharing.list) closePeople(false);
        bool told = agentBridge->shareTree(*i->tree);
        logLine(fmt("[ocean] Share pressed over %s%s", i->tree->title.c_str(), told ? ": through Telegram, the answer awaited" : ", but the service could not be told"));
        if (!told) return;
        sharing = Sharing{};
        sharing.uid = uid;
        sharing.waiting = true;
        i->buttonsUntil = time + buttonsSay;
        showButtons(*i, -1);
        return;
    }
    // FILM: Share opens the list of people to share it with, and shuts it again (oceanmodel_share.cpp): the service is told
    // once one of them is picked (`sharePerson`).
    if (which == 1) {
        if (sharing.list && sharing.uid == uid) closePeople(true);
        else openPeople(*i);
        return;
    }
    if (sharing.list) closePeople(true);
    bool told = which == 0 ? agentBridge->sendTree(*i->tree) : agentBridge->shareTree(*i->tree);
    logLine(fmt("[ocean] %s pressed over %s%s", which == 0 ? "Send" : "Share", i->tree->title.c_str(), told ? "" : ", but the service could not be told"));
    if (!told) return;
    i->buttonsUntil = time + buttonsSay;
    showButtons(*i, which);
}

void OceanModel::letGo(const TreeRef& tree) {
    if (!tree) return;
    if (this->tree == tree) {
        lettingGo.insert(tree.get());
        logLine("[ocean] " + tree->title + " stands until it is put away, and is then let go");
        return;
    }
    for (auto i = shelf.begin(); i != shelf.end(); ++i) {
        if (i->tree != tree) continue;
        EntityRef holder = i->mover->entity;
        picks.erase(holder.get());
        if (i->buttons) {
            for (const EntityRef& b : i->buttons->children) picks.erase(b.get());
        }
        holder->inputTarget = false;
        i->mover->alpha.go(0, time, 0.4f);
        i->mover->removeAt = time + 0.45;
        touch(time + 0.5);
        logLine("[ocean] its cover leaves the desk: " + tree->title);
        shelf.erase(i);
        rakeForest();
        shelfDirty = true;
        return;
    }
}

void OceanModel::shareRefused(const Tree& tree, const std::string& reason) {
    auto i = std::find_if(shelf.begin(), shelf.end(), [&](const Shelved& cover) { return cover.tree.get() == &tree; });
    if (i == shelf.end()) return;
    std::string said = reason == "unpaired" ? "Pair Telegram first" : reason == "limit" ? "No more shares today"
                     : reason == "too-big"  ? "Too big to share"
                     : reason == "not-shared" ? "Not shared"
                                            : "Try again later";
    if (sharing.waiting && sharing.uid == i->uid) sharing = Sharing{};
    // One tree shows its buttons at a time: another's go, and the list of people with them. This one's list goes too, and
    // with it whom it was shared with: "Shared with <name>" does not stay when the service would not (WS88).
    if (sharing.list) closePeople(false);
    for (Shelved& other : shelf) {
        if (&other == &*i || !other.buttons) continue;
        for (const EntityRef& b : other.buttons->children) picks.erase(b.get());
        other.tilts.erase(std::remove(other.tilts.begin(), other.tilts.end(), other.buttons), other.tilts.end());
        fadeOut(other.buttons, 0.2f);
        other.buttons = nullptr;
        other.pills = {};
        other.buttonsUntil = -1;
    }
    i->buttonsUntil = time + buttonsSay;
    showButtons(*i, 1, said);
    logLine("[ocean] Share says: " + said + ", over " + tree.title);
}
