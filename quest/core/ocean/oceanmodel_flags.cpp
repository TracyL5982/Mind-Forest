// Port of visionos/MindPalace/Ocean/OceanModel.swift: `// MARK: - Pinches`, `// MARK: - Hands`
// and `// MARK: - Launch flags, for running it without hands`.
#include "oceanmodel.h"

#include <cmath>
#include <cstdlib>

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
    }
    if (press->cancelled) return;
    // (A copy of what the cases below read: nothing they call changes `press`.)
    const Pick held = press->pick;
    const Vec3 began = press->start;
    Vec3 d = point - began;
    switch (held.kind) {
    case Pick::Kind::card: {
        int id = held.index;
        CardRef c = card(id);
        if (!c) return;
        if (tree && tree->focus() == id) {
            // A drag across the open card marks part of it.
            if (!marking && length(d) > 0.02f) markBegin(id, onCard(*c, began));
            if (marking) markMove(onCard(*c, point));
        } else if (movable(id) && length(d) > 0.02f) {
            // A card follows the hand that holds it, and what hangs from it comes along.
            Vec3 lifted = d + c->normal * 0.02f;
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
        if (length(d) > 0.035f) carry(uid, d);
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
    if (marking) {
        markEnd();
        if (moved >= 0.035f) return;
    }
    if (moved < 0.035f) {
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
        if (movable(id)) drop(id, p.riders, d);
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
        if (std::optional<Vec2> spot = carry(uid, d)) {
            auto i = std::find_if(shelf.begin(), shelf.end(), [&](const Shelved& cover) { return cover.uid == uid; });
            if (i != shelf.end()) {
                i->spot = *spot;
                shelfDirty = true;
            }
        }
        break;
    }
    default:
        break;
    }
}

void OceanModel::tap(const Pick& pick) {
    switch (pick.kind) {
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
        stepOut();
        break;
    }
}

/// Both hands pinching and spreading, on anything: into the open card, as far as you like.
void OceanModel::magnifyChanged(float ratio) {
    if (!tree) return;
    if (!magnifyBase) magnifyBase = zoom.target();
    if (press) press->cancelled = true;
    setZoom(magnifyBase.value_or(0) + 0.8f * std::log2(std::max(ratio, 0.05f)), 0.08f);
}

// MARK: - Hands

void OceanModel::handle(const Hands::Event& event) {
    switch (event.kind) {
    case Hands::Event::Kind::layer: {
        int d = event.steps;
        logLine(fmt("[ocean] fist: layer %d", d));
        moveLayer(d);
        break;
    }
    case Hands::Event::Kind::pan:
        panBy(event.move);
        break;
    case Hands::Event::Kind::panEnded:
        panRelease(event.move);
        break;
    case Hands::Event::Kind::clap:
        logLine("[ocean] clap");
        pressTree(true);
        break;
    case Hands::Event::Kind::cut:
        if (std::optional<int> id = threadCrossed(event.from, event.to)) {
            logLine(fmt("[ocean] knife: cut %d", *id));
            hands->cutLanded();
            prune(*id);
        }
        break;
    }
}

/// The thread a blade crosses, as you see it: both are flattened onto
/// your view, and the first thread the blade's stroke passes over is cut.
std::optional<int> OceanModel::threadCrossed(Vec3 from, Vec3 to) const {
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
    Vec2 a2 = *a - (*b - *a) * 0.5f, b2 = *b + (*b - *a) * 1.5f;
    auto crosses = [&](Vec2 p, Vec2 q) -> bool {
        auto side = [](Vec2 u, Vec2 v, Vec2 w) -> float { return (v.x - u.x) * (w.y - u.y) - (v.y - u.y) * (w.x - u.x); };
        return side(a2, b2, p) * side(a2, b2, q) < 0 && side(p, q, a2) * side(p, q, b2) < 0;
    };
    for (const Drawn& item : drawn) {
        if (!(item.child > 0)) continue;
        std::vector<Vec2> points;
        for (Vec3 p : Threads::points(item.thread, stage.origin)) {
            if (std::optional<Vec2> s = seen(p)) points.push_back(*s);
        }
        for (size_t k = 1; k < std::max(points.size(), size_t(1)); k++) {
            if (crosses(points[k - 1], points[k])) return item.child;
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
/// `-demo` plays the whole flow. `-freshShelf` forgets the kept covers.
void OceanModel::runFlags() {
    // NOTE(port): `let d = UserDefaults.standard` and `let args = CommandLine.arguments` are both `Flags` (base.h).
    if (Flags::has("demo")) {
        runDemo();
        return;
    }
    auto at = [this](const std::string& key, std::function<void(OceanModel&)> run) {
        double t = Flags::number(key);
        if (t > 0) after(t, [this, run] { run(*this); });
    };
    int brief = Flags::integer("brief");
    if (brief > 0) after(0.8, [this, brief] { startBrief(brief - 1); });
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
    at("askAt", [](OceanModel& m) {
        if (std::optional<int> id = m.tree ? m.tree->focus() : std::nullopt) m.askGardener(*id, Flags::integer("ask"));
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
    markBegin(*focus, a);
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
    at(1.6, [](OceanModel& m) { m.zoomIn(); });
    at(1.4, [](OceanModel& m) { m.zoomIn(); });
    at(1.6, [](OceanModel& m) { m.zoomIn(); });
    at(1.2, [](OceanModel& m) { m.peekAt(76); });
    at(1.4, [](OceanModel& m) { m.bringIn(76); });
    at(1.8, [](OceanModel& m) { m.pressTree(true); });
    at(2.8, [](OceanModel& m) {
        if (!m.shelf.empty()) m.unfold(m.shelf.front().uid);
    });
}
