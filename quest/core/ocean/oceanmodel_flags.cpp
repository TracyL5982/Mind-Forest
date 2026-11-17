// Port of visionos/MindPalace/Ocean/OceanModel.swift: `// MARK: - Pinches`, `// MARK: - Hands`
// and `// MARK: - Launch flags, for running it without hands`.
#include "oceanmodel.h"

#include <cmath>
#include <cstdlib>
#include <tuple>

#include "../cards/gallery.h"
#include "../cards/ocean.h"

// MARK: - Pinches

// NOTE(port): on visionOS the entity is the one the eyes rest on when the fingers pinch; on the
// Quest it is the one a hand's ray rests on (input.h). Either way it arrives here, and nothing
// below knows the difference.

std::optional<OceanModel::Pick> OceanModel::pick(const EntityRef& entity) const {
    const Entity* e = entity.get();
    while (const Entity* at = e) {
        auto p = picks.find(at);
        if (p != picks.end()) return p->second;
        e = at->parent;
    }
    return std::nullopt;
}

void OceanModel::pinchChanged(const EntityRef& entity, Vec3 point, Vec3 start) {
    if (!built) return;
    if (!press) {
        std::optional<Pick> p = pick(entity);
        if (!p) return;
        std::vector<int> riders;
        // A fist or a flat hand can read as a pinch; it isn't one.
        press = Press{*p, start, mediaTime() < hands->busyUntil, riders};
        press->began = time;
    }
    press->at = point;
    if (press->cancelled) return;
    press->reach = std::max(press->reach, length(point - press->start));
    // (A copy of what the cases below read: nothing they call changes `press`.)
    const Pick held = press->pick;
    const Vec3 began = press->start;
    Vec3 d = point - began;
    switch (held.kind) {
    case Pick::Kind::card: {
        int id = held.index;
        CardRef c = card(id);
        if (!c) return;
        if (tree && tree->focus() == id && cardGestures) {
            // NOTE(port): added for Quest (core/cards). Under `-cards` a drag on the open card scrolls it, unless the pen is up
            // on the card gone into: then it marks it, and never scrolls (`beginMark`). A pinch held still first, with the pen
            // down, asks for more like the card (`holdPress`).
            Press& p = *press;
            if (p.claim == Press::Claim::open && length(d) > 0.02f) {
                std::optional<std::string> drawn = cards::ocean::cardOf(c->ref);
                if (penOn && zoom.target() > 0.5f) {
                    p.claim = beginMark(*c, onCard(*c, began));
                } else if (drawn && time >= settledAt(*c) && cards::ocean::overflow(*drawn) > 0) {
                    p.claim = Press::Claim::scroll;
                    p.scrollFrom = cards::ocean::scroll(*drawn);
                    p.scrollAt = onCard(*c, point);
                } else {
                    p.claim = Press::Claim::spent;
                }
            }
            if (p.claim == Press::Claim::edit) moveEdit(*c, onCard(*c, point));
            if (p.claim == Press::Claim::mark) markMove(onCard(*c, point));
            // The panel follows the point along the face one to one, and stops at its top and its end.
            if (p.claim == Press::Claim::scroll) scrollCard(*c, p.scrollFrom + (onCard(*c, point).y - p.scrollAt.y) * Art::ppm / cards::ocean::openScale);
        } else if (tree && tree->focus() == id) {
            // A drag across the open card marks part of it.
            // NOTE(port): changed for Quest: only once it is gone into and a tool is picked (`layTools`).
            if (!marking && penOn && zoom.target() > 0.5f && length(d) > 0.02f) {
                markBegin(id, onCard(*c, began), std::nullopt);
                if (marking) sound("mark_begin");
            }
            if (marking) markMove(onCard(*c, point));
        } else if (movable(id) && length(d) > 0.02f) {
            // A card follows the hand that holds it, and what hangs from it comes along.
            Vec3 lifted = d + c->normal * 0.02f;
            if (!press->lifted) soundAt("lift", c->position);
            press->lifted = true;
            c->drag.set(lifted);
            for (int r : press->riders) {
                if (const CardRef& rider = card(r)) rider->drag.set(lifted);
            }
            touch(time + 0.3);
        }
        break;
    }
    case Pick::Kind::shelf: {
        int uid = held.index;
        if (length(d) > 0.035f) {
            if (!press->lifted) sound("lift");
            press->lifted = true;
            carry(uid, began, d);
        }
        break;
    }
    default:
        break;
    }
}

void OceanModel::pinchEnded(Vec3 point) {
    if (!press) return;
    Press p = *press;
    press = std::nullopt;
    if (p.cancelled) {
        marking = std::nullopt;
        return;
    }
    Vec3 d = point - p.start;
    float moved = length(d);
    // A pinch claimed for a mark, a scroll, or for nothing, is never a tap.
    switch (p.claim) {
    case Press::Claim::edit:
        if (const CardRef& c = card(p.pick.index)) endEdit(*c);
        return;
    case Press::Claim::mark:
        markEnd();
        return;
    case Press::Claim::scroll:
        if (std::optional<std::string> drawn = card(p.pick.index) ? cards::ocean::cardOf(card(p.pick.index)->ref) : std::nullopt) {
            logLine(fmt("[cards] scrolled to %.0f of %.0f px", double(cards::ocean::scroll(*drawn)), double(cards::ocean::overflow(*drawn))));
        }
        return;
    case Press::Claim::spent:
        return;
    case Press::Claim::open:
        break;
    }
    // NOTE(port): changed for Quest. A pinch is a tap when it never went anywhere, not when it ends where it
    // began: a line drawn round something comes back to its start, and was taken for a tap on the card (which
    // closes a card gone into). The Swift asks only how far apart the ends are.
    bool still = std::max(moved, p.reach) < 0.035f;
    if (marking) {
        markEnd();
        if (!still) return;
    }
    if (still) {
        if (p.pick.kind == Pick::Kind::card) {
            int id = p.pick.index;
            if (const CardRef& c = card(id)) c->drag.go(Vec3::zero(), time, 0.1f);
            for (int r : p.riders) {
                if (const CardRef& rider = card(r)) rider->drag.go(Vec3::zero(), time, 0.1f);
            }
        }
        tap(p.pick);
        return;
    }
    switch (p.pick.kind) {
    case Pick::Kind::card: {
        int id = p.pick.index;
        // Carried and let go: it stays where it was put.
        if (movable(id)) {
            drop(id, p.riders, d);
            guideDid("move");
        }
        break;
    }
    case Pick::Kind::speck: {
        int f = p.pick.index;
        if (moved > 0.1f) bringIn(f);
        break;
    }
    case Pick::Kind::peek:
        if (moved > 0.1f && peek) bringIn(peek->film);
        break;
    case Pick::Kind::shelf: {
        int uid = p.pick.index;
        // NOTE(port): changed for Quest: where it stands on the desk is what is kept (`i->spot = spot` in the Swift).
        if (std::optional<Vec2> plot = carry(uid, p.start, d)) {
            auto i = std::find_if(shelf.begin(), shelf.end(), [&](const Shelved& cover) { return cover.uid == uid; });
            if (i != shelf.end()) {
                i->plot = *plot;
                rakeForest();
                shelfDirty = true;
                soundAt("place", i->mover->entity->position);
            }
        }
        break;
    }
    default:
        break;
    }
}

void OceanModel::tap(const Pick& pick) {
    guideDid("pick");
    switch (pick.kind) {
    case Pick::Kind::guide:
        guideAct(pick.index);
        break;
    case Pick::Kind::tool:
        pickTool(pick.index, pick.question);
        break;
    case Pick::Kind::thread: {
        // A pinch on a connection marks it for cutting, as a slice across it does.
        std::vector<Vec3> line = threadLine(pick.index);
        if (!line.empty()) armCut(pick.index, line[line.size() / 2]);
        break;
    }
    case Pick::Kind::cut:
        confirmCut();
        break;
    case Pick::Kind::card:
        if (tree && tree->focus() == pick.index) zoomIn(); else take(pick.index);
        break;
    case Pick::Kind::ask:
        askGardener(pick.index, pick.question);
        break;
    case Pick::Kind::askMark:
        askMark(pick.index);
        break;
    case Pick::Kind::openLink:
        openLink(pick.index);
        break;
    case Pick::Kind::speck:
        peekAt(pick.index);
        break;
    case Pick::Kind::peek:
        if (peek) bringIn(peek->film);
        break;
    case Pick::Kind::brief:
        startBrief(pick.index);
        break;
    case Pick::Kind::shelf:
        unfold(pick.index);
        break;
    case Pick::Kind::send:
        pressTree(true);
        break;
    case Pick::Kind::putAway:
        pressTree(false);
        break;
    case Pick::Kind::background:
        // A pinch on nothing lets a thread marked for cutting be, before it does anything else.
        if (cutArmed) {
            disarmCut();
            break;
        }
        stepOut();
        break;
    // NOTE(port): added for Quest: the two answers to "bring everything here?" (oceanmodel_desk.cpp).
    case Pick::Kind::reseat:
        reseat("asked for");
        break;
    case Pick::Kind::stay:
        seatDeclined = true;
        hideSeatPrompt();
        break;
    }
}

/// Both hands pinching and spreading, on anything: into the open card, as far as you like.
void OceanModel::magnifyChanged(float ratio) {
    // NOTE(port): changed for Quest: nothing. On visionOS the eyes say what both hands are spreading;
    // here there is no gaze, and a card has only its two sizes (`zoomIn`), so two pinches are just two pinches.
    if ((true)) return;
    if (!tree) return;
    if (!magnifyBase) magnifyBase = zoom.target();
    if (press) press->cancelled = true;
    guideDid("zoom");
    setZoom(magnifyBase.value_or(0) + 0.8f * std::log2(std::max(ratio, 0.05f)), 0.08f);
}

// MARK: - Hands

void OceanModel::handle(const Hands::Event& event) {
    switch (event.kind) {
    case Hands::Event::Kind::layer: {
        int d = event.steps;
        logLine(fmt("[ocean] fist: layer %d", d));
        moveLayer(d);
        guideDid("step");
        break;
    }
    case Hands::Event::Kind::pan:
        panBy(event.move);
        guideDid("carry", length(event.move));
        break;
    case Hands::Event::Kind::panUndone:
        // NOTE(port): added for Quest (hands.h): the carry turned out to be a push. The tree goes back, and the guide does not count it.
        logLine(fmt("[ocean] fist: a carry of %.0f mm taken back, it was a push", double(length(event.move)) * 1000));
        panBy(event.move);
        break;
    case Hands::Event::Kind::panEnded:
        panRelease(event.move);
        break;
    case Hands::Event::Kind::clap:
        logLine("[ocean] clap");
        // (The welcome tree is only put away: there is nothing in it to send on.) AGENT: joined to the service, palms
        // together only closes, on every tree: a tree is handed off by voice ("hand this off").
        pressTree(!onWelcomeTree() && !agentBridge);
        break;
    case Hands::Event::Kind::cut:
        // NOTE(port): changed for Quest: the first slice across a thread marks it for cutting, the second cuts it (oceanmodel_cut.cpp).
        Vec3 where = event.to;
        if (std::optional<int> id = threadCrossed(event.from, event.to, &where)) {
            hands->cutLanded();
            if (cutArmed && cutArmed->child == *id) {
                logLine(fmt("[ocean] knife: cut %d", *id));
                confirmCut();
            } else {
                logLine(fmt("[ocean] knife: marked %d for cutting", *id));
                armCut(*id, where);
            }
        }
        break;
    }
}

/// The thread a blade crosses, as you see it: both are flattened onto
/// your view, and the first thread the blade's stroke passes over is cut.
std::optional<int> OceanModel::threadCrossed(Vec3 from, Vec3 to, Vec3* at) const {
    std::optional<Mat4> head = platform::head();
    Vec3 eye = head ? head->position() : stage.origin;
    auto seen = [&](Vec3 p) -> std::optional<Vec2> {
        Vec3 v = p - eye;
        float z = dot(v, stage.f);
        return z > 0.05f ? std::optional<Vec2>(Vec2{dot(v, stage.r), dot(v, stage.u)} / z) : std::nullopt;
    };
    std::optional<Vec2> a = seen(from), b = seen(to);
    if (!a || !b) return std::nullopt;
    // The stroke, carried a little past the hand both ways.
    // NOTE(port): changed for Quest (2026-11-15): the Swift carries it half its length back and one and a half on,
    // from one frame's travel. A stroke here is 60 ms of the blade's point, three times as long, and the place
    // it cuts is shown on the sheet, so it is carried only a little: it cuts where it is seen to pass.
    Vec2 a2 = *a - (*b - *a) * 0.15f, b2 = *b + (*b - *a) * 0.5f;
    auto crosses = [&](Vec2 p, Vec2 q) -> bool {
        auto side = [](Vec2 u, Vec2 v, Vec2 w) -> float { return (v.x - u.x) * (w.y - u.y) - (v.y - u.y) * (w.x - u.x); };
        return side(a2, b2, p) * side(a2, b2, q) < 0 && side(p, q, a2) * side(p, q, b2) < 0;
    };
    for (const Drawn& item : drawn) {
        if (!(item.child > 0)) continue;
        std::vector<Vec2> points;
        std::vector<Vec3> places;
        for (Vec3 p : Threads::points(item.thread, stage.origin)) {
            if (std::optional<Vec2> s = seen(p)) {
                points.push_back(*s);
                places.push_back(p);
            }
        }
        for (size_t k = 1; k < std::max(points.size(), size_t(1)); k++) {
            if (crosses(points[k - 1], points[k])) {
                if (at) *at = (places[k - 1] + places[k]) * 0.5f;
                return item.child;
            }
        }
    }
    return std::nullopt;
}

// MARK: - Launch flags, for running it without hands

/// `-brief <1…3>` stands a brief's tree; `-saved <i>` opens a cover.
/// Then, each at its time in seconds:
/// `-expand <n>` asks about one of the cards round the open one, n times, one every 3.2 s from 3.2 s;
/// `-branch <n>` then steps back a layer and asks about another card there, n times, so branches share a layer;
/// `-walk <n>` is `-expand` under its old name; `-outAt` steps out of the focus;
/// `-backAt`, `-backAgainAt`, `-forwardAt` step between layers;
/// `-openHuddleAt` pinches a small card of a condensed group; `-noGlass` leaves the panes out;
/// `-placeAt` carries a card aside by hand; `-zoomAt`, `-zoomAgainAt`;
/// `-askAt` with `-ask <i>`; `-markAt` with `-mark words|time|region`,
/// then `-askMarkAt`; `-peekFilm <index>` with `-peekAt`, `-bringAt`;
/// `-pressAt` puts the tree away, `-sendAt` sends it.
/// `-demo` plays the whole flow. `-freshShelf` forgets the kept covers. `-cards` draws the ocean as the agent's
/// cards, and stands the card library when no brief or cover is asked for.
void OceanModel::runFlags() {
    // NOTE(port): `let d = UserDefaults.standard` and `let args = CommandLine.arguments` are both `Flags` (base.h).
    if (Flags::has("demo")) {
        runDemo();
        return;
    }
    auto at = [this](const std::string& key, std::function<void(OceanModel&)> run) {
        double t = Flags::number(key);
        // NOTE(port): added for Quest. The log says when each one runs, so a check can tell what came of it.
        if (t > 0) after(t, [this, run, key] {
            logLine("[ocean] -" + key + " runs");
            run(*this);
        });
    };
    int brief = Flags::integer("brief");
    if (brief > 0) after(0.8, [this, brief] { startBrief(brief - 1); });
    // NOTE(port): added for Quest. `-cards` stands the agent's card library as a tree (core/cards/gallery.h), unless
    // `-brief` or `-saved` asks for another. With an agent (`-agent`) the service's trees take the stand, and the
    // library is left out, or hung on the shelf as a cover with `-cardsGallery`.
    bool agent = Flags::string("agent").has_value();
    if (int library = Flags::has("cards") && catalog && (!agent || Flags::has("cardsGallery")) ? cards::gallery(*catalog) : -1; library >= 0) {
        if (agent) {
            after(0.8, [this, library] {
                if (std::optional<Ref> ref = Ref::make(catalog->briefs[library].root)) {
                    shelve(std::make_shared<Tree>(*ref, catalog->briefs[library].title, Maker::gardener, catalog), std::nullopt);
                }
            });
        } else if (brief <= 0 && !Flags::has("saved")) {
            after(0.8, [this, library] { startBrief(library); });
        }
    }
    // (`d.object(forKey: "saved") as? Int ?? (d.string(forKey: "saved").flatMap { Int($0) })`: a whole number, or nothing.)
    std::optional<int> saved;
    if (std::optional<std::string> text = Flags::string("saved")) {
        char* end = nullptr;
        long v = std::strtol(text->c_str(), &end, 10);
        if (end == text->c_str() + text->size()) saved = int(v);
    }
    if (saved) {
        after(0.8, [this, saved = *saved] {
            if (saved >= 0 && saved < int(shelf.size())) unfold(shelf[saved].uid);
        });
    }
    int expand = Flags::integer("expand") + Flags::integer("walk");
    for (int k = 0; k < expand; k++) {
        after(3.2 + double(k) * 3.2, [this, k] { pickOffer(k); });
    }
    int branch = Flags::integer("branch");
    double from = 3.2 + double(expand) * 3.2;
    for (int k = 0; k < branch; k++) {
        after(from + double(k) * 5.2, [this] { moveLayer(1); });
        after(from + double(k) * 5.2 + 2.0, [this, k] { pickOffer(k + 1); });
    }
    if (Flags::has("peekFilm")) {
        int f = Flags::integer("peekFilm");
        after(Flags::number("peekAt") > 0 ? Flags::number("peekAt") : 1.2, [this, f] { peekAt(f); });
    }
    // `-pickRef note:dz-count -pickAt 3` picks one named thing (and `2`, `3` for more), bringing it in if it isn't there.
    for (const char* suffix : {"", "2", "3"}) {
        std::optional<std::string> key = Flags::string(std::string("pickRef") + suffix);
        std::optional<Ref> ref = key ? Ref::make(*key) : std::nullopt;
        if (!ref) continue;
        at(std::string("pickAt") + suffix, [ref = *ref](OceanModel& m) {
            if (!m.tree) return;
            if (std::optional<TreeNode> n = m.tree->node(ref)) {
                m.take(n->id);
            } else if (std::optional<int> id = m.tree->attach(ref)) {
                if (const TreeNode* n = find(*m.tree, *id)) {
                    m.makeCard(*n, 0);
                    m.take(*id);
                }
            }
        });
    }
    at("bringAt", [](OceanModel& m) {
        if (m.peek) m.bringIn(m.peek->film);
    });
    at("zoomAt", [](OceanModel& m) { m.zoomIn(); });
    at("zoomAgainAt", [](OceanModel& m) { m.zoomIn(); });
    // NOTE(port): added for Quest: `-armCutAt` marks the first thread for cutting, `-cutAt` then cuts it;
    // `-toolAt` with `-tool words|time|region` takes up a marking tool on the card gone into.
    at("armCutAt", [](OceanModel& m) {
        // (The last one drawn: it is on the layer you work on.)
        int child = 0;
        for (const Drawn& item : m.drawn) {
            if (item.child > 0) child = item.child;
        }
        std::vector<Vec3> line = m.threadLine(child);
        if (!line.empty()) m.armCut(child, line[line.size() / 2]);
    });
    at("cutAt", [](OceanModel& m) { m.confirmCut(); });
    // (`-tool pen` takes the pen up, as before; `-tool eraser` and `-tool send` are the other two. NOTE(port): added for
    // Quest (core/cards): `-toolAt2` with `-tool2`, and on to 4, pick one again later.)
    for (const char* suffix : {"", "2", "3", "4"}) {
        at(std::string("toolAt") + suffix, [suffix](OceanModel& m) {
            std::string tool = Flags::string(std::string("tool") + suffix).value_or("pen");
            if (m.tree && m.tree->focus()) m.pickTool(*m.tree->focus(), tool == "eraser" ? 1 : tool == "send" ? 2 : 0);
        });
    }
    // NOTE(port): added for Quest. `-askTimes n` picks the row n times, 0.4 s apart, as an impatient hand would.
    for (int k = 0; Flags::number("askAt") > 0 && k < std::max(1, Flags::integer("askTimes")); k++) {
        after(Flags::number("askAt") + 0.4 * double(k), [this] {
            if (std::optional<int> id = tree ? tree->focus() : std::nullopt) askGardener(*id, Flags::integer("ask"));
        });
    }
    // NOTE(port): added for Quest (core/cards). `-scrollAt t` drags the open card's panel by `-scrollBy` (a share of
    // how far it runs on, 1 if not given) as a hand would, which with the pen up marks it instead; `-holdAt t` holds a
    // pinch still on its first words for 0.6 s and then draws it across them, which with the pen up highlights them;
    // `-tapAt t` pinches it without moving; `-longPinchAt t` holds a pinch still for 0.7 s on the card's middle, or with
    // `-longPinchOn words` on its first words; `-drawAt t` holds one where there are no words and draws a ring round what
    // lies beside it. `-scrollAgainAt`, and `-longPinchAgainAt` with `-longPinchAgainOn`, do the same again.
    for (const char* name : {"scrollAt", "scrollAgainAt"}) {
        at(name, [](OceanModel& m) {
            CardRef c = m.tree && m.tree->focus() ? m.card(*m.tree->focus()) : nullptr;
            std::optional<std::string> drawn = c ? cards::ocean::cardOf(c->ref) : std::nullopt;
            if (!drawn) return;
            double share = Flags::has("scrollBy") ? Flags::number("scrollBy") : 1;
            float by = float(share) * cards::ocean::overflow(*drawn) * cards::ocean::openScale / Art::ppm;
            // (And the 2 cm a drag goes before it is claimed.)
            m.pinchByFlag({{0, -c->openBody.y / 4}, {0, -c->openBody.y / 4 + by + 0.02f}}, 0, 0.8);
        });
    }
    at("holdAt", [](OceanModel& m) {
        CardRef c = m.tree && m.tree->focus() ? m.card(*m.tree->focus()) : nullptr;
        if (!(c && c->layout && !c->layout->blocks.empty())) return;
        const NoteLayout& layout = *c->layout;
        const TextBlock& block = layout.blocks.size() > 1 ? *layout.blocks[1] : *layout.blocks.front();
        CGRect frame = block.frame();
        Vec2 a = layout.meters(CGPoint(frame.minX() + frame.width() * 0.08f, frame.minY() + 8));
        Vec2 b = layout.meters(CGPoint(frame.minX() + frame.width() * 0.7f, frame.minY() + std::min(block.height * 0.7f, 30.f)));
        m.pinchByFlag({a, b}, 0.6, 0.5);
    });
    at("tapAt", [](OceanModel& m) { m.pinchByFlag({{0, 0}, {0, 0}}, 0.1, 0); });
    // `-acrossPictureAt t` drags across the open card's picture, from 0.2 to 0.55 of its width, as a hand marking a stretch
    // of a video or drawing on a picture does with the pen up; `-acrossPictureAgainAt t` from 0.7 to 0.9, too far from the
    // first to take it by an end.
    for (const auto& [name, from, to] : {std::tuple{"acrossPictureAt", 0.2f, 0.55f}, std::tuple{"acrossPictureAgainAt", 0.7f, 0.9f}}) {
        float a = from, b = to;
        at(name, [a, b](OceanModel& m) {
            CardRef c = m.tree && m.tree->focus() ? m.card(*m.tree->focus()) : nullptr;
            if (!c) return;
            PictureFrame p = m.pictureFrame(*c);
            float left = p.center.x - p.size.x / 2;
            m.pinchByFlag({{left + p.size.x * a, p.center.y}, {left + p.size.x * b, p.center.y}}, 0, 0.6);
        });
    }
    auto open = [](OceanModel& m) { return m.tree && m.tree->focus() ? m.card(*m.tree->focus()) : nullptr; };
    // A point of the open face over words, or over none, in the window as it stands.
    auto spot = [](OceanModel& m, CardView& c, bool words) -> std::optional<Vec2> {
        if (words) {
            if (!(c.layout && !c.layout->blocks.empty())) return std::nullopt;
            CGRect f = c.layout->blocks.size() > 1 ? c.layout->blocks[1]->frame() : c.layout->blocks.front()->frame();
            return c.layout->meters(CGPoint(f.minX() + 12, f.minY() + 8));
        }
        m.contentRuns(c);
        for (float y : {0.55f, 0.5f, 0.45f, 0.4f, 0.35f, 0.3f, 0.25f, 0.2f, 0.6f, 0.65f, 0.7f, 0.75f, 0.8f}) {
            for (float x : {0.06f, 0.94f, 0.5f}) {
                Vec2 at{(x - 0.5f) * c.openBody.x, (y - 0.5f) * c.openBody.y};
                std::optional<CGPoint> p = m.onContent(c, at);
                if (p && m.runAt(c, *p) < 0) return at;
            }
        }
        return std::nullopt;
    };
    for (std::string name : {"longPinch", "longPinchAgain"}) {
        at(name + "At", [open, spot, name](OceanModel& m) {
            CardRef c = open(m);
            std::optional<Vec2> a = c && Flags::string(name + "On").value_or("middle") == "words" ? spot(m, *c, true) : Vec2::zero();
            if (a) m.pinchByFlag({*a, *a}, 0.7, 0);
        });
    }
    at("drawAt", [open, spot](OceanModel& m) {
        CardRef c = open(m);
        std::optional<Vec2> a = c ? spot(m, *c, false) : std::nullopt;
        if (!a) {
            logLine("[cards] -drawAt: no place without words on the open card");
            return;
        }
        // A ring round what lies beside it, as a hand circles words.
        float rx = c->openBody.x * 0.2f * (a->x < 0 ? 1 : -1), ry = c->openBody.y * 0.07f;
        std::vector<Vec2> path;
        for (int k = 0; k <= 18; k++) {
            float t = float(M_PI) * (1 + 2 * float(k) / 18);
            path.push_back(Vec2{a->x + rx + rx * std::cos(t), a->y - ry * std::sin(t)});
        }
        m.pinchByFlag(path, 0.6, 1.2);
    });
    at("backAt", [](OceanModel& m) { m.moveLayer(1); });
    at("backAgainAt", [](OceanModel& m) { m.moveLayer(1); });
    // `-backs <n>` steps back n layers, one every 2.4 s from `-backsAt` (or 4 s); `-forwards <n>` then comes forward again.
    int backs = Flags::integer("backs"), forwards = Flags::integer("forwards");
    double backsAt = Flags::number("backsAt") > 0 ? Flags::number("backsAt") : 4;
    for (int k = 0; k < backs; k++) {
        after(backsAt + double(k) * 2.4, [this] { moveLayer(1); });
    }
    for (int k = 0; k < forwards; k++) {
        after(backsAt + double(backs + k) * 2.4, [this] { moveLayer(-1); });
    }
    // A pinch on a small card of a condensed group: it should go to that group's layer.
    at("openHuddleAt", [](OceanModel& m) {
        if (!m.tree) return;
        const Tree& tree = *m.tree;
        // (`.sorted { $0.id < $1.id }` and then `.first`: the map is in that order.)
        const TreeNode* small = nullptr;
        for (const auto& [id, n] : tree.nodes) {
            if (tree.condensed(n) && !n.head && tree.shown(n)) {
                small = &n;
                break;
            }
        }
        if (small) {
            const TreeNode* parent = find(tree, small->parent.value_or(0));
            logLine("[ocean] pinch on a condensed card of " + (m.catalog ? m.catalog->short_(parent ? parent->ref : small->ref) : std::string()));
            m.take(small->id);
        }
    });
    at("outAt", [](OceanModel& m) { m.stepOut(); });
    at("forwardAt", [](OceanModel& m) { m.moveLayer(-1); });
    at("placeAt", [](OceanModel& m) { m.carryOne(); });
    // NOTE(port): added for Quest. `-carryAt t` carries the cover `-carry <i>` (the first, if not given) along the shelf,
    // drawn `-carryRight` and `-carryUp` metres.
    at("carryAt", [](OceanModel& m) {
        m.carryCoverByFlag(Flags::integer("carry"), m.stage.r * float(Flags::number("carryRight")) + m.stage.u * float(Flags::number("carryUp")));
    });
    at("markAt", [](OceanModel& m) { m.markByFlag(Flags::string("mark").value_or("words")); });
    at("askMarkAt", [](OceanModel& m) {
        if (std::optional<int> id = m.tree ? m.tree->focus() : std::nullopt) m.askMark(*id);
    });
    at("pressAt", [](OceanModel& m) { m.pressTree(false); });
    at("deckAt", [](OceanModel& m) { m.touchHologramByFlag(Flags::integer("deckPick")); });
    // A launch argument can't be negative: `-panLeft` and `-panDown` are the other way.
    at("panAt", [](OceanModel& m) {
        m.panByFlag(Vec2{float(Flags::number("panX") - Flags::number("panLeft")), float(Flags::number("panY") - Flags::number("panDown"))});
    });
    at("panAgainAt", [](OceanModel& m) { m.panByFlag(Vec2{float(Flags::number("panAgainX")), float(Flags::number("panAgainY"))}); });
    at("sendAt", [](OceanModel& m) { m.pressTree(true); });
    // NOTE(port): added for Quest (oceanmodel_desk.cpp): `-reseatAt` brings the scene to where the head
    // is then; `-seatPromptAt` shows the card that offers it, whether or not you have moved.
    at("reseatAt", [](OceanModel& m) { m.reseat("-reseatAt"); });
    at("seatPromptAt", [](OceanModel& m) { m.showSeatPrompt(true); });
}

Vec3 OceanModel::facePoint(const CardView& c, Vec2 at) const {
    float s = std::max(c.root->scale.x, 1e-4f);
    return c.point(at * s, openLift * s);
}

void OceanModel::pinchByFlag(const std::vector<Vec2>& path, double hold, double over) {
    std::optional<int> focus = tree ? tree->focus() : std::nullopt;
    CardRef c = focus ? card(*focus) : nullptr;
    if (!(c && c->openFace && !path.empty())) return;
    int id = *focus;
    EntityRef on = c->openFace;
    Vec3 start = facePoint(*c, path.front());
    float drawn = 0;
    for (size_t i = 1; i < path.size(); i++) drawn += length(path[i] - path[i - 1]);
    logLine(fmt("[cards] a pinch by flag on the open card, held %.1f s, drawn %.3f m", hold, double(drawn)));
    pinchChanged(on, start, start);
    // Twelve steps along each stretch of the path, spread over `over`.
    const int each = over > 0 ? 12 : 0, steps = each * int(path.size() - 1);
    for (int k = 1; k <= steps; k++) {
        size_t leg = size_t((k - 1) / each);
        float t = float(k - int(leg) * each) / float(each);
        Vec2 at = path[leg] + (path[leg + 1] - path[leg]) * t;
        after(hold + over * double(k) / steps, [this, id, on, at, start] {
            CardRef c = card(id);
            if (c && press) pinchChanged(on, facePoint(*c, at), start);
        });
    }
    after(hold + over + 0.05, [this, id, end = path.back()] {
        CardRef c = card(id);
        if (c && press) pinchEnded(facePoint(*c, end));
    });
}

/// What stands round the card in focus and has not been asked about, cards before tags.
std::vector<TreeNode> OceanModel::offers() const {
    if (!tree) return {};
    std::optional<int> focus = tree->focus();
    const TreeNode* current = focus ? find(*tree, *focus) : nullptr;
    if (!current) return {};
    std::vector<TreeNode> all;
    for (int id : current->children) {
        const TreeNode* n = find(*tree, id);
        if (n && !n->head && tree->shown(*n)) all.push_back(*n);
    }
    std::vector<TreeNode> out;
    for (const TreeNode& n : all) {
        if (!n.chip) out.push_back(n);
    }
    for (const TreeNode& n : all) {
        if (n.chip) out.push_back(n);
    }
    return out;
}

/// Asks about one of them (one pinch on it).
void OceanModel::pickOffer(int k) {
    if (!tree) return;
    if (!tree->focused) {
        take(tree->current);
        return;
    }
    std::vector<TreeNode> ring;
    for (const TreeNode& n : offers()) {
        if (!n.chip) ring.push_back(n);
    }
    if (ring.empty()) return;
    take(ring[size_t(k * 2) % ring.size()].id);
}

void OceanModel::carryCoverByFlag(int i, Vec3 d) {
    if (i < 0 || i >= int(shelf.size())) return;
    EntityRef on = shelf[size_t(i)].mover->entity;
    Vec3 start = on->position;
    logLine("[ocean] carrying the cover of " + shelf[size_t(i)].tree->title + " by flag" +
            fmt(", from %.3f, %.3f", double(shelf[size_t(i)].plot.x), double(shelf[size_t(i)].plot.y)));
    pinchChanged(on, start, start);
    const int steps = 12;
    for (int k = 1; k <= steps; k++) {
        after(0.5 * double(k) / steps, [this, on, start, d, k] {
            if (press) pinchChanged(on, start + d * (float(k) / float(steps)), start);
        });
    }
    after(0.55, [this, start, d] {
        if (press) pinchEnded(start + d);
    });
}

/// Carries one card on the layer aside, as a hand would.
void OceanModel::carryOne() {
    if (!tree) return;
    // (Each `.sorted { $0.id < $1.id }` and then `.first`: the map is in that order.)
    std::optional<int> able;
    for (const auto& [id, n] : tree->nodes) {
        if (movable(n.id) && n.kept) {
            able = n.id;
            break;
        }
    }
    if (!able) {
        for (const auto& [id, n] : tree->nodes) {
            if (movable(n.id)) {
                able = n.id;
                break;
            }
        }
    }
    if (!able) return;
    const CardRef& c = card(*able);
    drop(*able, {}, (c ? c->right : stage.r) * 0.22f + stage.u * 0.2f);
}

/// Marks part of the open card, as a drag across it would.
void OceanModel::markByFlag(const std::string& asked) {
    if (!tree) return;
    std::optional<int> focus = tree->focus();
    if (!focus) return;
    CardRef c = card(*focus);
    if (!c) return;
    PictureFrame picture = pictureFrame(*c);
    Vec2 a = Vec2::zero(), b = Vec2::zero();
    std::string kind = asked;
    if (kind == "any") {
        // Whatever the open card can take: a stretch of its video, or some of its words.
        if (c->ref.kind == Ref::Kind::film) kind = "time"; else if (c->ref.kind == Ref::Kind::work) kind = "region"; else kind = "words";
    }
    if (kind == "time") {
        a = picture.center + picture.size * Vec2{-0.3f, 0};
        b = picture.center + picture.size * Vec2{0.05f, 0.05f};
    } else if (kind == "region") {
        a = picture.center + picture.size * Vec2{-0.05f, 0.3f};
        b = picture.center + picture.size * Vec2{0.32f, -0.2f};
    } else {
        if (!(c->layout && !c->layout->blocks.empty())) return;
        const NoteLayout& layout = *c->layout;
        const TextBlock& block = *layout.blocks.back();
        CGRect frame = block.frame();
        a = layout.meters(CGPoint(frame.minX() + frame.width() * 0.12f, frame.minY() + 8));
        b = layout.meters(CGPoint(frame.minX() + frame.width() * 0.8f, frame.minY() + block.height * 0.7f));
    }
    // (By its tool, as a hand would now: the card need not be gone into for a flag.)
    if (kind == "region") {
        // Round part of the picture, as a hand with a marker would go: not quite a circle, and past where it began.
        Vec2 middle = picture.center + picture.size * Vec2{0.12f, 0.04f};
        auto round = [&](float u) {
            float turn = -2.3f + u * 7.0f, wobble = 1 + 0.07f * std::sin(3 * turn + 1);
            return middle + picture.size * Vec2{std::cos(turn) * 0.2f * wobble, std::sin(turn) * 0.24f * wobble};
        };
        markBegin(*focus, round(0), Mark::Kind::region);
        for (int k = 1; k <= 90; k++) markMove(round(float(k) / 90));
        markEnd();
        return;
    }
    markBegin(*focus, a, kind == "time" ? Mark::Kind::time : kind == "region" ? Mark::Kind::region : Mark::Kind::words);
    markMove(b);
    markEnd();
}

void OceanModel::runDemo() {
    double t = 1.0;
    auto at = [&](double gap, std::function<void(OceanModel&)> run) {
        t += gap;
        after(t, [this, run] { run(*this); });
    };
    at(0, [](OceanModel& m) { m.startBrief(1); });
    // A question: one of the cards round the first rises to the next layer, and the gardener brings what goes with it.
    at(3.4, [](OceanModel& m) { m.pickOffer(0); });
    at(3.6, [](OceanModel& m) { m.carryOne(); });
    at(1.2, [](OceanModel& m) { m.markByFlag("any"); });
    at(1.2, [](OceanModel& m) {
        if (std::optional<int> id = m.tree ? m.tree->focus() : std::nullopt) m.askMark(*id);
    });
    // Back a layer, and another question from there: two branches on one layer, and the colour parts.
    at(3.8, [](OceanModel& m) { m.moveLayer(1); });
    at(2.2, [](OceanModel& m) { m.pickOffer(1); });
    at(3.6, [](OceanModel& m) { m.pickOffer(0); });
    at(3.6, [](OceanModel& m) {
        if (std::optional<int> id = m.tree ? m.tree->focus() : std::nullopt) m.askGardener(*id, 0);
    });
    // Stepping back: the nearer layers condense onto the cards they came from.
    at(3.8, [](OceanModel& m) { m.moveLayer(1); });
    at(2.2, [](OceanModel& m) { m.moveLayer(1); });
    at(2.2, [](OceanModel& m) { m.moveLayer(-1); });
    at(1.8, [](OceanModel& m) { m.stepOut(); });
    at(1.6, [](OceanModel& m) {
        if (m.tree) m.take(m.tree->current);
    });
    // (Into the card, a look, and out again: the Swift's demo goes in by two sizes.)
    at(1.6, [](OceanModel& m) { m.zoomIn(); });
    at(1.4, [](OceanModel& m) {});
    at(1.6, [](OceanModel& m) { m.zoomIn(); });
    at(1.2, [](OceanModel& m) { m.peekAt(76); });
    at(1.4, [](OceanModel& m) { m.bringIn(76); });
    at(1.8, [](OceanModel& m) { m.pressTree(true); });
    at(2.8, [](OceanModel& m) {
        if (!m.shelf.empty()) m.unfold(m.shelf.front().uid);
    });
}
