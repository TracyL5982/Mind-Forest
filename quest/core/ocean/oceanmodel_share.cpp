// FILM: sharing a tree with someone. It builds on the Send and Share
// buttons tracy/agents put over a tree in the forest (oceanmodel_desk.cpp, `tendHover`), where Share told the service at
// once and said "Shared".
//
// Kai, 2026-11-17: "look at the share button implementation. I would like you to continue to build on that and flesh out
// the share flow (if not already done so), and add profile pics. Reference the SNAPCrop project for its own
// implementation, and also source the profile pics there. Put "Tracy" at the top of the list. Once shared, do a fun
// little animation - the tree (only the tree, not the thumbnails) will have a copy that drifts up, gradually becoming
// smaller and transparent, and fly off with the wind."
//
// What SNAPCrop does (Assets/Scripts/CardButtons/ShareDrawer.ts): Share is a toggle; on, it opens a row of profile
// pictures beside itself, in a set order; a pinch on one chooses it, the others go at once and it grows and fades; a
// pinch anywhere else, or Share again, shuts the row. Here the same, as a list, because a name has to be read:
//
//   Share with Friends
//                    The button fills with its colour (it is on) and the people drop in under it, one after another
//                    from the top, in a column from its left edge: each their round picture and their name, with
//                    nothing behind them; they and the buttons stand well before the tree. Tracy is first, right
//                    under the button, where the hand already is. A ray on one brings them a little forward.
//   the button again, or a pinch on anything else
//                    The list goes, all of it at once, and the button is as it was.
//   the ray gone from the tree, its buttons and the list for 2.5 s
//                    The buttons go, as they do, and the list with them.
//   a person         The service is told (`share`, as before: it does not yet take who). The others go, the one chosen
//                    gets a tick in the button's colour and takes the first place, and the button says "Shared with
//                    <name>". Both stay a moment, then go with the buttons.
//   and at once      A copy of the tree's light, and only that (its pictures and name stay), comes away from the tree:
//                    it lifts slowly and sways, then the wind takes it, across the middle of what you see and up,
//                    leaning and turning as a seed does, smaller and fainter all the way until it is gone. 4.8 s.
//
// The pictures are SNAPCrop's (Assets/Textures/profilePics), kept with the app's media as people/<name>.png.
// Later the same day, of the pills the buttons and the people then were: "The pill shaped send and share buttons don't
// fit too well with our design otherwise. Please switch to square design with colored accents. On the buttons, they
// should say: Send to Agents and Share with Friends". And of a first square version, the two one above the other, the
// friends' colour People's violet, each person on a dark rectangle: "The buttons should still sit side by side. The
// dropdowns don't need a black bar behind. Avoid the purple color." The buttons are drawn in `showButtons`
// (oceanmodel_desk.cpp) with `Art::action`, the people here with `Art::face`.
// Everything measured here, and who is in the list after Tracy, is mine.
#include "oceanmodel.h"

#include <cmath>

#include "../agent/bridge.h"

namespace {

/// Who a tree can be shared with, first at the top.
const char* const people[] = {"Tracy", "Char", "Signe", "Stephanie", "Uttam"};
constexpr int peopleCount = int(sizeof people / sizeof people[0]);

/// How far toward you the list hangs from the trunk, in the cover's own measure: a hair before the buttons (0.1), before
/// both are brought nearer (`bringNearer`).
constexpr float listNear = 0.105f;
/// m the buttons and the list are brought toward you from there, so that they stand clear of the tree's light and its
/// pictures: with nothing behind the names, the branches would otherwise run through them. (Kai, 2026-11-17, of a version
/// that turned the tree's light down instead: "dimming the tree seems like a strange way to solve this issue vs just
/// moving the buttons a bit to the front?")
constexpr float broughtNearer = 0.45f;
/// Degrees between the buttons' targets and the first person's.
constexpr float listGap = 0.2f;

/// Each row comes from this far above its place, degrees, over `rowIn` s, `rowApart` s after the one above it.
constexpr float rowDrop = 0.9f, rowIn = 0.42f;
constexpr double rowApart = 0.06;
/// The others go from the bottom up, this far apart and over this long; the one chosen takes the first place.
constexpr double goApart = 0.04;
constexpr float goOver = 0.16f, toTop = 0.5f, turnOver = 0.2f;
/// s "Shared" and the one chosen stay.
constexpr double sharedSay = 2.4;

// The copy on the wind. All of it runs on one clock, `driftOver` s long.
constexpr double driftOver = 4.8;
/// s before the wind is felt, and how far it carries the copy by the end: m sideways, m away from you.
constexpr double gustAt = 0.9;
constexpr float carried = 3.0f, carriedAway = 0.5f;

float smooth(float u) {
    u = std::min(1.f, std::max(0.f, u));
    return u * u * (3 - 2 * u);
}

}  // namespace

std::string OceanModel::actionWords(const Shelved& s, int which, bool done) const {
    if (which == 0) return done ? "Sent to Agents" : "Send to Agents";
    if (!done) return "Share with Friends";
    // AGENT: through Telegram, the link to forward is in the sharer's own chat (the lead, WS88).
    if (agentBridge && agentBridge->sharesByTelegram()) return "Sent to your Telegram";
    return sharing.uid == s.uid && !sharing.with.empty() ? "Shared with " + sharing.with : "Shared with Friends";
}

float OceanModel::coverDegree(const Shelved& s, float& crown) const {
    // (As `showButtons` works it out: the buttons and the list are sized together.)
    float k = std::max(1e-3f, s.mover->scale.target());
    crown = s.foot + (s.treeFoot + float(s.layers - 1) * s.treeRise) * coverTree;
    float d = std::max(0.5f, distance(stage.origin, s.mover->position.target() + stage.u * (crown * k)));
    return std::tan(floatPi / 180) * d / k;
}

void OceanModel::bringNearer(const Shelved& s, const EntityRef& e) const {
    // Along the line from your eyes, and smaller by as much, so it is where it was to the eye and as large: only nearer.
    Entity* holder = s.mover->entity.get();
    Vec3 at = holder->convertTo(e->position, root_.get());
    float far = distance(stage.origin, at);
    float f = std::max(0.5f, 1 - broughtNearer / std::max(far, 0.1f));
    e->position = holder->convertFrom(stage.origin + (at - stage.origin) * f, root_.get());
    e->scale = e->scale * f;
}

void OceanModel::openPeople(Shelved& s) {
    if (!art || !s.buttons) return;
    if (sharing.list) closePeople(true);
    sharing = Sharing{};
    sharing.uid = s.uid;
    sharing.list = Entity::make();          // (so that Share is drawn as on: `showButtons`)
    showButtons(s, -1);
    const EntityRef& share = s.pills[1];
    if (!share || !share->parent || !share->model || !share->model->mesh) {
        sharing = Sharing{};
        return;
    }
    float crown = 0, degree = coverDegree(s, crown);
    // As large as the buttons are drawn, so their letters are one size; each picture `faceTall` degrees across.
    // (The buttons have been brought nearer and made smaller by as much, `bringNearer`: the list is laid out by where their
    // parts stand within them, which that does not change, and is brought nearer after them.)
    float size = share->scale.x, pitch = facePitch * degree, tall = float(peopleCount) * pitch;
    float facePx = faceTall * degree / size * Art::ppm;
    // They hang under Share, their pictures in a column from its left edge: a list under its button lines up with it.
    BoundingBox button = share->model->mesh->bounds;
    float left = share->parent->position.x + share->position.x + button.min.x * size;
    std::vector<std::optional<Piece>> pieces;
    float widest = 0;
    for (int i = 0; i < peopleCount; i++) {
        std::string file = platform::resourcePath(std::string("people/") + people[i] + ".png");
        ImageRef picture = file.empty() ? nullptr : platform::loadImage(file, 256);
        if (!picture && i == 0) logLine("[film] no pictures of people: people/*.png are not with the app's media (tools/push_media.sh sends them)");
        // (Measured with the tick it has once chosen, so the column is wide enough for that too.)
        if (std::optional<Piece> ticked = art->face(people[i], picture, buttonText, facePx, true, actionAccent(1))) widest = std::max(widest, ticked->size.x * size);
        pieces.push_back(art->face(people[i], picture, buttonText, facePx));
    }
    float wide = widest + 2 * degree;
    EntityRef list = sharing.list;
    // Its middle is what is tipped toward you, so neither end swings. The first of them is close under the buttons.
    list->position = {left + widest / 2, crown - listGap * degree - tall / 2, listNear};
    for (int i = 0; i < peopleCount; i++) {
        if (!pieces[size_t(i)]) continue;
        const Piece& piece = *pieces[size_t(i)];
        Sharing::Row row;
        row.size = size;
        row.rest = tall / 2 - (float(i) + 0.5f) * pitch;
        row.target = Entity::make();
        row.target->collision = {Shape::generateBox({wide, pitch, 0.04f})};
        // A ray on a person lights them and brings them a little forward (`tendShare`): they answer, not the tree behind.
        row.target->hover = Hover::highlight(Color::white(), 0.25f);
        picks[row.target.get()] = Pick::person(s.uid, i);
        row.bar = art->quad(piece);
        row.bar->scale = Vec3::repeating(size);
        row.bar->position = {(piece.size.x * size - widest) / 2, 0, 0.004f};
        row.target->addChild(row.bar);
        // Whole, from just above its place, the first one first.
        double delay = double(i) * rowApart;
        row.rise.set(rowDrop * degree);
        row.rise.go(0, time, delay, rowIn, Ease::arrive);
        row.alpha.set(0);
        row.alpha.go(1, time, delay, 0.22f, Ease::out);
        row.target->position = {0, row.rest + row.rise.value(time), 0};
        row.target->opacity = 0.f;
        list->addChild(row.target);
        sharing.rows.push_back(row);
    }
    // Its own ground, a hand's breadth round them: a pinch that misses a person lands here and does nothing, rather than
    // on the tree behind, which it would open. Nothing is drawn on it.
    EntityRef ground = Entity::make();
    ground->position = {0, 0, -0.01f};
    ground->collision = {Shape::generateBox({wide + 2 * degree, tall + 1.5f * degree, 0.02f})};
    picks[ground.get()] = Pick::person(s.uid, -1);
    list->addChild(ground);
    s.mover->entity->addChild(list);
    s.tilts.push_back(list);
    tip({list}, s.el.value(time));
    bringNearer(s, list);
    sharing.forced = hoverForced >= 0;
    s.hoverSeen = time;
    soundAt("lift", list->convertTo(Vec3::zero(), root_.get()), 0.8f);
    touch(time + double(peopleCount) * rowApart + double(rowIn) + 0.1);
    logLine(fmt("[film] Share over %s opens the list: %d people, %s first, each a picture %.1f° across and a target %.0f° by %.1f°", s.tree->title.c_str(),
                int(sharing.rows.size()), people[0], double(faceTall), double(wide / degree), double(facePitch)));
}

void OceanModel::closePeople(bool redraw) {
    if (!sharing.list) return;
    int uid = sharing.uid;
    for (const EntityRef& child : sharing.list->children) picks.erase(child.get());
    auto s = std::find_if(shelf.begin(), shelf.end(), [&](const Shelved& cover) { return cover.uid == uid; });
    if (s != shelf.end()) s->tilts.erase(std::remove(s->tilts.begin(), s->tilts.end(), sharing.list), s->tilts.end());
    // What Share added leaves as one thing.
    fadeOut(sharing.list, 0.18f);
    bool chose = sharing.chosen >= 0;
    sharing = Sharing{};
    if (redraw && !chose && s != shelf.end() && s->buttons) showButtons(*s, -1);
    logLine("[film] the list of people goes");
}

void OceanModel::sharePerson(int uid, int who) {
    auto s = std::find_if(shelf.begin(), shelf.end(), [&](const Shelved& cover) { return cover.uid == uid; });
    if (s == shelf.end() || !s->tree || !agentBridge) return;
    if (!sharing.list || sharing.uid != uid || sharing.chosen >= 0 || who < 0 || who >= int(sharing.rows.size())) return;
    bool told = agentBridge->shareTree(*s->tree);
    logLine(fmt("[film] %s shared with %s%s", s->tree->title.c_str(), people[who], told ? "" : ", but the service could not be told"));
    if (!told) return;
    sharing.chosen = who;
    sharing.with = people[who];
    for (const EntityRef& child : sharing.list->children) picks.erase(child.get());
    // The others go from the bottom up; the one chosen takes the first place, and turns to the accent with a tick as it
    // sets off: the same row, drawn again over itself, so nothing shows through while it turns.
    int gone = 0;
    for (int i = int(sharing.rows.size()) - 1; i >= 0; i--) {
        Sharing::Row& row = sharing.rows[size_t(i)];
        // (Lit no longer, by a ray or by the tree's own glow, which a row with no light of its own would take.)
        row.target->hover = Hover::highlight(Color::white(), 0);
        if (i == who) continue;
        row.alpha.go(0, time, double(gone++) * goApart, goOver, Ease::out);
    }
    Sharing::Row& chosen = sharing.rows[size_t(who)];
    chosen.rise.go(sharing.rows.front().rest - chosen.rest, time, 0.08, toTop, Ease::travel);
    std::string file = platform::resourcePath(std::string("people/") + people[who] + ".png");
    float facePx = chosen.bar->model && chosen.bar->model->mesh ? chosen.bar->model->mesh->bounds.extents().y * Art::ppm : 0;
    if (std::optional<Piece> piece = art->face(people[who], file.empty() ? nullptr : platform::loadImage(file, 256), buttonText, facePx, true, actionAccent(1))) {
        EntityRef turned = art->quad(*piece);
        float before = chosen.bar->model->mesh->bounds.extents().x;
        turned->scale = Vec3::repeating(chosen.size);
        turned->position = {chosen.bar->position.x + (piece->size.x - before) * chosen.size / 2, 0, 0.007f};
        chosen.target->addChild(turned);
        fadeIn(turned, 0, turnOver);
    }
    s->buttonsUntil = time + sharedSay;
    showButtons(*s, 1);
    sound("send", 0.8f);
    driftOff(*s);
    touch(time + sharedSay + 0.3);
}

void OceanModel::shareTaken(const Tree& tree) {
    auto s = std::find_if(shelf.begin(), shelf.end(), [&](const Shelved& cover) { return cover.tree.get() == &tree; });
    if (s == shelf.end()) return;
    if (sharing.uid == s->uid) sharing = Sharing{};
    // One tree shows its buttons at a time: another's go, and a list of people with them.
    if (sharing.list) closePeople(false);
    for (Shelved& other : shelf) {
        if (&other == &*s || !other.buttons) continue;
        for (const EntityRef& b : other.buttons->children) picks.erase(b.get());
        other.tilts.erase(std::remove(other.tilts.begin(), other.tilts.end(), other.buttons), other.tilts.end());
        fadeOut(other.buttons, 0.2f);
        other.buttons = nullptr;
        other.pills = {};
        other.buttonsUntil = -1;
    }
    s->buttonsUntil = time + sharedSay;
    showButtons(*s, 1);
    sound("send", 0.8f);
    driftOff(*s);
    touch(time + sharedSay + 0.3);
    logLine("[ocean] Share says: Sent to your Telegram, over " + tree.title);
}

void OceanModel::driftOff(const Shelved& s) {
    if (!s.branches || !s.branches->model || !s.branches->model->mesh) return;
    Drift d;
    // The tree's own light, drawn a second time: no pictures, no name, no rings.
    d.entity = Entity::make(s.branches->model->mesh, s.branches->model->materials);
    d.from = s.branches->convertTo(Vec3::zero(), root_.get());
    d.size = length(s.branches->convertTo(Vec3{0, 1, 0}, root_.get()) - d.from);
    d.facing = s.mover->entity->orientation;
    d.up = stage.u;
    // The wind blows across the middle of what you see, so the copy is watched all the way: from a tree on your left,
    // to the right; from one on your right, to the left. And a little away from you.
    float side = dot(d.from - stage.origin, stage.r) > 0 ? -1.f : 1.f;
    d.wind = stage.r * side;
    d.across = stage.f;
    d.start = time;
    d.seed = float(s.uid) * 1.7f;
    d.entity->position = d.from;
    d.entity->orientation = d.facing;
    d.entity->scale = Vec3::repeating(d.size);
    d.entity->opacity = 0.f;
    root_->addChild(d.entity);
    drifts.push_back(d);
    touch(time + driftOver + 0.1);
    logLine(fmt("[film] a copy of %s's tree lifts off and goes with the wind, to the %s, over %.1f s", s.tree->title.c_str(), side > 0 ? "right" : "left", driftOver));
}

void OceanModel::tendShare(double now) {
    // A ray on one of a tree's two buttons lights the button, not the tree: it counts as a ray on the tree all the same.
    for (Shelved& s : shelf) {
        if (!s.buttons) continue;
        for (const EntityRef& pill : s.pills) {
            if (pill && pill->parent && pill->parent->hovered > 0.05f) s.hoverSeen = now;
        }
    }
    if (sharing.list) {
        auto s = std::find_if(shelf.begin(), shelf.end(), [&](const Shelved& cover) { return cover.uid == sharing.uid; });
        if (s == shelf.end() || forestDown) {
            closePeople(false);
        } else {
            bool lit = sharing.forced && hoverForced >= 0;
            for (Sharing::Row& row : sharing.rows) {
                row.target->position = {0, row.rest + row.rise.value(now), 0};
                row.target->opacity = row.alpha.value(now);
                if (row.target->hovered > 0.05f) lit = true;
                // The one a ray is on is a little larger (unless it is held pressed, which has its own look).
                if (sharing.chosen < 0 && teach.pressed != row.bar) row.bar->scale = Vec3::repeating(row.size * (1 + 0.08f * row.target->hovered));
            }
            // A ray on a row is a ray on the tree's own things: the buttons and the list stay while it is there.
            // (Left alone for `peopleGrace` s, the buttons go, and the list with them: `tendHover`.)
            if (lit) s->hoverSeen = now;
        }
    }
    if (drifts.empty()) return;
    for (Drift& d : drifts) {
        float t = float(now - d.start), u = std::min(1.f, t / float(driftOver));
        // It lifts on its own at first, slowly, then the wind takes it: sideways faster and faster, and up with it.
        float g = t <= float(gustAt) ? 0 : std::pow((t - float(gustAt)) / float(driftOver - gustAt), 2.2f);
        float tall = d.size * 0.22f;                // about the height of the tree's light, m
        float lift = tall * (0.5f * smooth(t / 2.2f) + 0.8f * g);
        // It sways as it goes, a little before the wind and more in it: across the wind, and up and down.
        float sway = (0.012f + 0.07f * g) * std::sin(2 * floatPi * 0.55f * t + d.seed);
        float bob = 0.03f * g * std::sin(2 * floatPi * 0.8f * t + d.seed * 2);
        d.entity->position = d.from + d.up * (lift + bob) + d.wind * (carried * g + sway * 0.4f) + d.across * (carriedAway * g + sway);
        // Its crown leans the way it is blown, and it turns about its own stem, as a seed does.
        float lean = (0.55f * smooth(g * 1.6f) + 0.08f * std::sin(2 * floatPi * 1.1f * t + d.seed) * smooth(g * 3)) * (dot(d.wind, stage.r) > 0 ? -1.f : 1.f);
        float turn = 1.1f * g + 0.1f * std::sin(2 * floatPi * 0.4f * t);     // never edge on: its light is nearly flat
        d.entity->orientation = Quat::angleAxis(lean, stage.f) * d.facing * Quat::angleAxis(turn, {0, 1, 0});
        // Smaller and fainter all the way. It comes out of the tree's own light, so it is not there and then is.
        // (And a breath larger as it comes loose.)
        float loose = 1 + 0.05f * std::sin(floatPi * std::min(1.f, t / 0.6f));
        d.entity->scale = Vec3::repeating(d.size * loose * (1 - 0.55f * smooth(u)));
        d.entity->opacity = smooth(t / 0.3f) * (1 - std::pow(u, 2.6f));
    }
    for (auto d = drifts.begin(); d != drifts.end();) {
        if (now - d->start >= driftOver) {
            d->entity->removeFromParent();
            d = drifts.erase(d);
        } else {
            ++d;
        }
    }
    if (!drifts.empty()) touch(now + 0.1);
}
