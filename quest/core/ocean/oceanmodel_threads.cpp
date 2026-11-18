// The ocean's model: the threads.
#include "oceanmodel.h"

#include <cmath>
#include <limits>
#include <map>

namespace {
/// m round the card at a thread's far end that its label keeps out of: about half a label's width across, and its height
/// and the card's title below.
constexpr float labelOffX = 0.06f, labelOffY = 0.04f;
}  // namespace

// MARK: - Threads

/// A point as you see it: how far around to the right and how far up
/// it appears, measured on the sheet that wraps around you at the open
/// layer's distance, and how far away it is.
OceanModel::Seen OceanModel::seen(Vec3 p) const {
    Vec3 v = p - stage.origin;
    float x = dot(v, stage.r), z = dot(v, stage.f);
    float away = std::max(std::sqrt(x * x + z * z), 0.2f);
    return Seen{Vec2{std::atan2(x, z) * Stage::focus, dot(v, stage.u) * (Stage::focus / away)}, away};
}

/// A move of `move` as seen (right, up), as a move in the room for something at `p`.
Vec3 OceanModel::aside(Vec3 p, Vec2 move) const {
    return stage.upright(p).right * move.x + stage.u * move.y;
}

/// How far a point at `at` must move to be clear of the box from `lo`
/// to `hi`: out through its nearest side.
Vec2 OceanModel::clear(Vec2 at, Vec2 lo, Vec2 hi) const {
    if (!(at.x > lo.x && at.x < hi.x && at.y > lo.y && at.y < hi.y)) return Vec2::zero();
    float left = lo.x - at.x, right = hi.x - at.x, down = lo.y - at.y, up = hi.y - at.y;
    float x = -left < right ? left : right, y = -down < up ? down : up;
    return std::fabs(x) < std::fabs(y) ? Vec2{x, 0} : Vec2{0, y};
}

/// The open card on its own sheet, m from its middle: its caption and
/// the rows under it included, at the size the zoom gives it.
OceanModel::Reach OceanModel::openReach(const TreeNode& node) const {
    if (!tree) return Reach{Vec2::zero(), Vec2::zero()};
    Tree::Extent e = tree->openExtent(node.ref);
    float z = 1 + zoomGrowth * zoom.target();
    const CardRef& c = card(node.id);
    float rows = c ? (c->rowsDown > 0 ? c->rowsDown + 0.014f : 0.13f) : 0.13f;
    return Reach{Vec2{-e.half, -e.down - rows} * z, Vec2{e.half, e.up} * z};
}

/// The open card as you see it, with a margin.
std::optional<OceanModel::Reach> OceanModel::openBox(const TreeNode* node, float margin) const {
    if (!node) return std::nullopt;
    Reach reach = openReach(*node);
    // On the sheet around you, what is seen and what is measured along the sheet agree.
    Vec2 at = seen(treePoint(node)).at;
    return Reach{at + reach.lo - Vec2::repeating(margin), at + reach.hi + Vec2::repeating(margin)};
}

/// How far aside (on its own sheet) a card must move so it doesn't sit
/// under the open card, or behind it.
Vec2 OceanModel::nudge(const TreeNode& n, const Tree& tree) const {
    std::optional<int> focus = tree.focus();
    const TreeNode* current = focus ? find(tree, *focus) : nullptr;
    // AGENT: round a card opened where it stands, and on a tree the agent service grows, the layer makes room together. A card
    // opened where it stands grows where it stood, stepped aside or not (`stood`); one that leads its layer stands at its place.
    if (current && roomy(tree) && n.id == current->id) return stood(tree);
    if (current && roomy(tree)) {
        // So does every layer in line behind it, round the card the path left it by: a layer that stops making room as you
        // go on from it would lay its cards over each other again.
        std::optional<Tree::Place> me = tree.shown(n), it = tree.shown(*current);
        if (me && it && me->depth <= it->depth) {
            std::map<int, Vec2> room = makeRoom(tree, me->depth);
            auto aside = room.find(n.id);
            return aside != room.end() ? aside->second : Vec2::zero();
        }
    }
    if (!(current && n.id != current->id && n.parent != current->id)) return Vec2::zero();
    std::optional<Tree::Place> me = tree.shown(n), it = tree.shown(*current);
    if (!me || !it) return Vec2::zero();
    if (me->depth == it->depth) {
        // The same sheet: out from under it, by the nearest side.
        Reach reach = openReach(*current);
        // With the group condensed on it, if it holds one.
        const CardRef& c = card(n.id);
        Box room = n.head && tree.folded(n) ? tree.foot(n, 1, 1)
                                            : Box::centerSize(Vec2::zero(), (c ? c->smallBody : Vec2{0.17f, 0.12f}) * style(n, tree).scale);
        Vec2 margin{0.025f, 0.035f};
        return clear(me->xy, it->xy + reach.lo - room.hi - margin, it->xy + reach.hi - room.lo + margin);
    }
    return outFromBehind(n, tree);
}

/// An earlier layer: the path's own card keeps its place; the rest move out from behind the open card.
Vec2 OceanModel::outFromBehind(const TreeNode& n, const Tree& tree) const {
    std::optional<int> focus = tree.focus();
    const TreeNode* current = focus ? find(tree, *focus) : nullptr;
    std::optional<Tree::Place> me = tree.shown(n);
    if (!current || !me || (n.head && routeIndex(tree, n.id) >= 0)) return Vec2::zero();
    std::optional<Reach> box = openBox(current, 0.05f);
    if (!box) return Vec2::zero();
    float behind = focusLevel.target() - float(me->depth);
    Seen s = seen(treePoint(&n));
    Vec2 move = clear(s.at, box->lo, box->hi);
    return move * (s.depth / Stage::focus) / Stage::gather(behind);
}

// AGENT: added for the agents' trees, where a pinch opens a card where it stands (agent::Bridge::opens), and a card's own cards
// come with their own cards condensed round them (huddles), which the places on its rings were not made to hold.
bool OceanModel::roomy(const Tree& tree) const {
    std::optional<int> focus = tree.focus();
    const TreeNode* current = focus ? find(tree, *focus) : nullptr;
    return current && (!current->head || !tree.grows);
}

Vec2 OceanModel::stood(const Tree& tree) const {
    std::optional<int> focus = tree.focus();
    const TreeNode* current = focus ? find(tree, *focus) : nullptr;
    // (One that leads a layer and is only opened there, a click on a branch, grows where it stood too; the card that leads
    // the layer you stand on stands at its place.)
    if (!current || current->id == tree.stand) return Vec2::zero();
    const CardRef& c = card(current->id);
    return c ? c->nudge.target() : Vec2::zero();
}

std::map<int, Vec2> OceanModel::makeRoom(const Tree& tree, int depth) const {
    std::map<int, Vec2> out;
    std::optional<int> focus = tree.focus();
    const TreeNode* current = focus ? find(tree, *focus) : nullptr;
    std::optional<Tree::Place> open = current ? tree.shown(*current) : std::nullopt;
    if (!open || depth > open->depth) return out;
    // What the layer makes room round, and keeps where it is: the open card on its own layer; on a layer behind, the card
    // the path left it by, whose next layer hangs from it (none on a layer it does not show on).
    const bool own = depth == open->depth;
    const TreeNode* still = current;
    if (!own) {
        still = nullptr;
        for (int id : tree.route) {
            const TreeNode* r = find(tree, id);
            std::optional<Tree::Place> at = r ? tree.shown(*r) : std::nullopt;
            if (r && at && at->depth == depth && routeIndex(tree, id) >= 0) still = r;
        }
    }
    std::optional<Tree::Place> it = still ? tree.shown(*still) : std::nullopt;
    // A card, or a group condensed onto one, which moves as one. What is condensed onto the open card moves on its own.
    struct Unit {
        Box rest;
        Vec2 aside = Vec2::zero();
        std::vector<int> members;
        Box now() const { return rest.moved(aside); }
    };
    std::vector<Unit> units;
    std::map<int, size_t> unitOf;        // by the card the unit stands on
    for (const auto& [id, n] : tree.nodes) {
        std::optional<Tree::Place> me = tree.shown(n);
        if ((still && n.id == still->id) || n.chip || !me || me->depth != depth) continue;
        Look look = style(n, tree);
        if (look.alpha <= 0) continue;
        const TreeNode* mover = &n;
        while (tree.condensed(*mover) && mover->parent && !(still && *mover->parent == still->id)) {
            const TreeNode* host = find(tree, *mover->parent);
            if (!host) break;
            mover = host;
        }
        const CardRef& c = card(n.id);
        Box b = Box::centerSize(me->xy, (c ? c->smallBody : catalog->smallSize(n.ref)) * look.scale);
        auto [at, made] = unitOf.try_emplace(mover->id, units.size());
        // On a layer behind, each starts from where it steps out from behind the open card, as on Kai's trees.
        if (made) units.push_back(Unit{b, own ? Vec2::zero() : outFromBehind(*mover, tree)});
        else units[at->second].rest = units[at->second].rest.joined(b);
        units[at->second].members.push_back(n.id);
    }
    const Vec2 margin{0.025f, 0.035f}, middle = it ? it->xy + (own ? stood(tree) : Vec2::zero()) : Vec2::zero();
    Box keep(middle, middle);
    if (it && own) {
        Reach reach = openReach(*current);
        keep = Box(middle + reach.lo - margin, middle + reach.hi + margin);
    } else if (it) {
        const CardRef& c = card(still->id);
        keep = Box::centerSize(middle, (c ? c->smallBody : catalog->smallSize(still->ref)) * style(*still, tree).scale).grown(0.012f);
    }
    const float pad = 0.012f, huddleGap = 0.075f, infinity = std::numeric_limits<float>::infinity();
    auto centre = [](const Box& b) { return (b.lo + b.hi) / 2; };
    // Straight out from the middle of what is kept, through `b`'s.
    auto outward = [&](const Box& b) {
        Vec2 d = centre(b) - middle;
        return length(d) > 1e-4f ? d / length(d) : Vec2{1, 0};
    };
    // How far `b` must go along `d` to be clear of `o`.
    auto clearAlong = [&](const Box& b, const Box& o, Vec2 d) {
        auto axis = [&](float lo, float hi, float olo, float ohi, float v) {
            return v > 1e-4f ? (ohi - lo) / v : v < -1e-4f ? (olo - hi) / v : infinity;
        };
        return std::max(0.f, std::min(axis(b.lo.x, b.hi.x, o.lo.x, o.hi.x, d.x), axis(b.lo.y, b.hi.y, o.lo.y, o.hi.y, d.y))) + 0.001f;
    };
    // Out from under what is kept, straight away from it; then of two cards that touch, the one farther from it goes on out
    // past the other. Everything moves outward, so the arrangement keeps its shape round it.
    for (int round = 0; round < 60; round++) {
        bool moved = false;
        for (Unit& u : units) {
            if (!it || !u.now().hits(keep, 0)) continue;
            Vec2 d = outward(u.now());
            u.aside += d * clearAlong(u.now(), keep, d);
            moved = true;
        }
        for (size_t i = 0; i < units.size(); i++) {
            for (size_t j = i + 1; j < units.size(); j++) {
                // (A card with others condensed onto it has a pane of its own round them, which keeps more room.)
                float gap = units[i].members.size() > 1 || units[j].members.size() > 1 ? huddleGap : pad;
                if (!units[i].now().hits(units[j].now(), gap)) continue;
                bool iFarther = distance(centre(units[i].now()), middle) >= distance(centre(units[j].now()), middle);
                Unit& far = iFarther ? units[i] : units[j];
                const Unit& near = iFarther ? units[j] : units[i];
                Vec2 d = outward(far.now());
                far.aside += d * clearAlong(far.now(), near.now().grown(gap), d);
                moved = true;
            }
        }
        if (!moved) break;
    }
    for (const auto& [mover, k] : unitOf) {
        out[mover] = units[k].aside;
        for (int id : units[k].members) out[id] = units[k].aside;
    }
    return out;
}

void OceanModel::drawThreads(double now, float dt) {
    if (!threads || !art) return;
    // `list`, `words`, `grown`, `straight` and `touching` here, and `hubs`, `hubIDs`, `said`, `live` and
    // `spots` further down, are the model's own, emptied before they are filled (see oceanmodel.h), so
    // no memory is asked for on every frame the tree moves.
    list.clear();
    words.clear();          // the label on a thread: its text, color and size
    grown.clear();          // how much of a thread is drawn yet
    straight.clear();       // threads that are a plain line, the same every frame
    touching.clear();       // threads that end on the open card: they can't step aside from it
    float level = focusLevel.value(now);
    if (tree && catalog) {
        const Tree& tree = *this->tree;
        std::optional<int> focus = tree.focus();
        // Tags that are the reason for some of the suggestions stand on
        // the way to them: those threads run through the tag, which
        // says the reason once, instead of each carrying it as a label.
        hubs.clear();
        hubIDs.clear();
        said.clear();           // reasons already on a label: each is said once
        auto hub = [&](const std::string& name) -> CardView* {
            for (const std::pair<std::string, CardView*>& h : hubs) {
                if (h.first == name) return h.second;
            }
            return nullptr;
        };
        if (const TreeNode* open = focus ? find(tree, *focus) : nullptr) {
            // (`let kids = open.children.compactMap { tree.nodes[$0] }` and
            // `let reasons = Set(kids.filter { !$0.chip }.map(\.why))`: asked of the children as they stand.)
            auto reasons = [&](const std::string& name) {
                for (int id : open->children) {
                    const TreeNode* kid = find(tree, id);
                    if (kid && !kid->chip && kid->why == name) return true;
                }
                return false;
            };
            for (int id : open->children) {
                const TreeNode* chip = find(tree, id);
                if (!chip || !chip->chip) continue;
                std::string name = catalog->title(chip->ref);
                if (!reasons(name)) continue;
                const CardRef& held = card(chip->id);
                if (!held) continue;
                bool known = false;
                for (std::pair<std::string, CardView*>& h : hubs) {
                    if (h.first == name) {
                        h.second = held.get();
                        known = true;
                    }
                }
                if (!known) hubs.push_back({std::move(name), held.get()});
                hubIDs.insert(chip->id);
            }
        }
        // (`tree.nodes.values.sorted(by: { $0.id < $1.id })`: the map is in that order.)
        for (const auto& [nid, n] : tree.nodes) {
            if (!n.parent) continue;
            int p = *n.parent;
            const CardRef& mine = card(n.id);
            const CardRef& theirs = card(p);
            if (!(mine && theirs && now >= mine->bornAt)) continue;
            const CardView& c = *mine;
            const CardView* parent = theirs.get();
            if (n.chip && !hubIDs.contains(n.id)) continue;
            float shown = std::min(c.alpha.value(now), parent->alpha.value(now));
            if (!(shown > 0.03f)) continue;
            // A thread is as faint as the fainter layer it touches.
            shown *= Stage::opacity(level - std::min(c.plane.value(now), parent->plane.value(now)));
            // A card is connected only once it has landed. Its thread
            // then runs out to it from the card it hangs from, instead of
            // being whipped along behind it on the way in.
            float landed = float((now - c.emerge.end()) / 0.32);
            if (!(c.emerge.target() > 0.5f && landed > 0)) continue;
            if (landed < 1) {
                grown.set(n.id, Ease::out(landed));
                touch(now + 0.1);
            }
            // Through its tag, if a tag stands on the way.
            bool through = false;
            if (focus == p && !n.chip) {
                CardView* h = hub(n.why);
                if (h && now >= h->emerge.end()) {
                    parent = h;
                    through = true;
                    shown = std::min(shown, h->alpha.value(now));
                }
            }
            // How much it belongs to the layer you work on: 1 there, 0 a
            // layer back or more. Weights follow it, so a layer that
            // sinks away thins as it goes instead of all at once.
            float cPlane = c.plane.value(now);
            float near = 1 - std::min(1.f, std::max(0.f, level - cPlane));
            // Confirmed, its thread fills in; on the path, it brightens and thickens. Neither in one frame.
            float solid = c.solid.value(now), on = c.onPath.value(now);
            float rest = 0.0032f + (0.0026f + 0.0014f * near - 0.0032f) * solid;
            // A thread is the colour of the branch it belongs to. In a condensed group it is as fine as its cards are small.
            float fine = std::min(1.f, c.scale.value(now) + 0.25f);
            Threads::Thread t{edge(*parent, c), edge(c, *parent), c.tint.value(now), (0.72f + 0.28f * on) * shown, (rest + (0.0075f - rest) * on) * fine,
                              1 - solid, n.id % 2 == 0 ? 0.03f : -0.03f};
            float label = on > 0.5f ? 0.8f : (focus == p ? 1.f : 0.7f);
            label *= near;
            if (tree.condensed(n)) label = 0;
            if (std::fabs(parent->plane.value(now) - cPlane) > 0.01f) {
                // Up to a layer's first card from the layer below: no label, no bow.
                straight.insert(n.id);
                t.bow = 0;
                label = 0;
            }
            // Said once: its tag says it, or (in focus) the card says it under itself.
            if (through || n.chip || focus == n.id) label = 0;
            if (n.chip) {
                // The short run from the card out to its tag.
                straight.insert(n.id);
                t.bow = 0;
                t.width = 0.0028f;
            }
            if ((focus == p && !through) || focus == n.id) touching.insert(n.id);
            list.push_back(Drawn{t, n.id});
            // A note already says what it is; everything else carries its why on the thread.
            bool redundant = false;
            if (n.ref.kind == Ref::Kind::note) {
                auto note = catalog->notes.find(n.ref.id);
                if (note != catalog->notes.end() && sameLowercased(note->second.kicker, n.why)) redundant = true;
            }
            // Several things there for one reason: the first carries the label.
            if (focus == p && label > 0.02f) {
                bool inserted = true;
                for (const std::string* reason : said) {
                    if (*reason == n.why) inserted = false;
                }
                if (inserted) said.push_back(&n.why); else label = 0;
            }
            if (label > 0.02f && !n.why.empty() && !redundant && !pressing) {
                const float* g = grown.find(n.id);
                words.set(n.id, Words{&n.why, n.tone, label * (g ? *g : 1)});
            }
        }
        for (size_t i = 0; i < tree.links.size(); i++) {
            const Tree::Link& link = tree.links[i];
            int k = int(i);
            const CardRef& a = card(link.a);
            const CardRef& b = card(link.b);
            if (!a || !b) continue;
            float shown = std::min(a->alpha.value(now), b->alpha.value(now));
            if (!(shown > 0.03f)) continue;
            list.push_back(Drawn{Threads::Thread{edge(*a, *b), edge(*b, *a), linear(link.tone), 0.9f * shown, 0.003f, 1, 0.1f}, -100 - k});
            if (focus == link.a || focus == link.b) touching.insert(-100 - k);
            if (!pressing && shown > 0.9f) words.set(-100 - k, Words{&link.why, link.tone, 0.85f});
        }
        // The root keeps a faint line down to where it came from.
        if (const CardRef& rootCard = card(tree.root); rootCard && rootCard->home && shell && now >= rootCard->emerge.end()) {
            list.push_back(Drawn{Threads::Thread{shell->homes[*rootCard->home], rootCard->position - rootCard->normal * 0.012f, linear(Tone::path), 0.28f,
                                                 0.0014f, 0, 0.02f},
                                 -1});
        }
    }

    // A tag can stand under the open card, with threads running out from it. A flat card
    // covers all of that; a bent one lies as close to its sheet as the threads do, and they
    // would show through it. So a thread that starts under a bent card starts at its edge,
    // and one that also ends under it is not drawn.
    if (std::optional<int> id = tree ? tree->focus() : std::nullopt) {
        if (const CardRef& open = card(*id); open && open->curve > 0) {
            Tree::Extent e = tree->openExtent(open->ref);
            float size = std::max(open->root->scale.x, 1e-4f);
            Vec2 lo = Vec2{-e.half, -e.down} - Vec2::repeating(0.004f), hi = Vec2{e.half, e.up} + Vec2::repeating(0.004f);
            auto under = [&](Vec3 p) { return p.x > lo.x && p.x < hi.x && p.y > lo.y && p.y < hi.y && p.z < 0.03f; };
            // Where the way from `p` (under the card) to `q` comes out from under it.
            auto edge = [&](Vec3 p, Vec3 q) -> Vec3 {
                Vec2 d{q.x - p.x, q.y - p.y};
                float ux = std::fabs(d.x) > 1e-6f ? ((d.x > 0 ? hi.x : lo.x) - p.x) / d.x : INFINITY;
                float uy = std::fabs(d.y) > 1e-6f ? ((d.y > 0 ? hi.y : lo.y) - p.y) / d.y : INFINITY;
                return open->point((Vec2{p.x, p.y} + d * std::min({ux, uy, 1.f})) * size, -0.012f);
            };
            for (Drawn& item : list) {
                Vec3 a = open->unbent(item.thread.a), b = open->unbent(item.thread.b);
                bool underA = under(a), underB = under(b);
                if (underA && underB) item.thread.alpha = 0;
                else if (underA) item.thread.a = edge(a, b);
                else if (underB) item.thread.b = edge(b, a);
            }
        }
    }

    // Each thread is a gentle arc. Its bow moves aside where it would
    // cross the open card, easing there without any swing; it rides
    // with the thread's ends, so a moving tree never sets it wobbling.
    std::optional<int> focus = tree ? tree->focus() : std::nullopt;
    std::optional<Reach> box = openBox(focus ? find(*tree, *focus) : nullptr, 0.05f);
    live.clear();
    bool swinging = false;
    spots.clear();          // where each thread's label rides
    for (Drawn& item : list) {
        const Threads::Thread t = item.thread;
        int key = item.child;
        if (!(key >= 0 || key <= -100)) continue;
        Vec3 mid = (t.a + t.b) / 2;
        float len = distance(t.a, t.b);
        Vec3 rest = mid;
        if (!straight.contains(key)) {
            // The sheet curves around you, and a straight line between two cards on it cuts the corner: its middle goes back out to the sheet.
            auto out = [&](Vec3 p) -> Vec3 {
                Vec3 v = p - stage.origin;
                return stage.r * dot(v, stage.r) + stage.f * dot(v, stage.f);
            };
            Vec3 flat = out(mid);
            float far = (length(out(t.a)) + length(out(t.b))) / 2;
            if (length(flat) > 0.05f && far > length(flat)) rest += normalize(flat) * (far - length(flat));
            rest -= stage.u * std::min(0.03f, 0.03f * len);
            Vec3 side = cross(t.b - t.a, mid - stage.origin);
            side = length(side) > 1e-6f ? normalize(side) : Vec3::zero();
            rest += side * (t.bow * len);
            if (box && !touching.contains(key)) {
                Seen s = seen(rest);
                Vec2 move = clear(s.at, box->lo, box->hi) * (s.depth / Stage::focus);
                rest += aside(rest, move);
            }
        }
        const Strand* had = strands.find(key);
        Strand strand = had ? *had : Strand{rest - mid};
        ease(strand, rest - mid, dt);
        // Never so far that the thread doubles back.
        bool held = length(strand.p) > 0.45f * len;
        if (held) strand.p = normalize(strand.p) * 0.45f * len;
        // AGENT: held back short of a rest it can't reach, it is still once it stops moving. (It swung on toward that rest
        // for ever, and the scene never came to rest, so the shelf was never written down.)
        if (held ? !had || distance(strand.p, had->p) > 0.0002f : length(strand.v) > 0.01f || distance(strand.p, rest - mid) > 0.002f) swinging = true;
        live.set(key, strand);
        item.thread.via = mid + strand.p;
        const Threads::Thread whole = item.thread;
        Vec3 control = Threads::control(whole, stage.origin);
        auto along = [&](float u) -> Vec3 {
            float w = 1 - u;
            return whole.a * (w * w) + control * (2 * w * u) + whole.b * (u * u);
        };
        if (words.contains(key)) {
            // A label rides its thread's middle; on a thread that
            // leaves the open card, further out, clear of the card and
            // of what stands under it.
            float u = 0.5f;
            if (touching.contains(key) && box) {
                Vec2 room{0.07f, 0.02f};
                u = 0.58f;
                // ... but not onto the card at the thread's other end: on a short thread it would stand over that card's
                // picture and its title (WS76, the walk's "Pick me up").
                const CardView* far = nullptr;
                if (key >= 0) {
                    far = card(key).get();
                } else if (tree && size_t(-100 - key) < tree->links.size()) {
                    const Tree::Link& link = tree->links[size_t(-100 - key)];
                    if (focus && *focus == link.a) far = card(link.b).get();
                }
                // (Its face as drawn: a picture's title can reach wider than the picture.)
                Vec2 farHalf = far ? far->half : Vec2::zero();
                if (far && far->smallQuad && far->smallQuad->entity && far->smallQuad->entity->model && far->smallQuad->entity->model->mesh) {
                    Vec3 drawn = far->smallQuad->entity->model->mesh->bounds.extents() * (far->root->scale.x / 2);
                    farHalf = {std::max(farHalf.x, drawn.x), std::max(farHalf.y, drawn.y)};
                }
                auto offFar = [&](float v) {
                    if (!far) return true;
                    Vec2 at = seen(far->position).at, half{farHalf.x + labelOffX, farHalf.y + labelOffY};
                    return clear(seen(along(v)).at, at - half, at + half) == Vec2::zero();
                };
                // (A thread so short that even there it would: its middle, as any other thread's.)
                if (!offFar(u)) u = 0.5f;
                while (u < 0.86f && offFar(u + 0.07f) && clear(seen(along(u)).at, box->lo - room, box->hi + room) != Vec2::zero()) u += 0.07f;
            }
            spots.set(key, along(u));
        }
        if (const float* g = grown.find(key)) {
            // Only the first part of it yet, along the same curve.
            item.thread.b = along(*g);
            item.thread.via = along(*g / 2);
        }
    }
    // (`strands = live`)
    std::swap(strands, live);
    if (swinging) touch(now + 0.2);

    // The labels stand upright, turned toward you. They grow in and fade out; none blinks.
    // (`for key in Set(words.keys).union(labels.keys)`, in the order of the keys.)
    labelKeys.clear();
    for (const std::pair<int, Words>& w : words.items) labelKeys.push_back(w.first);
    for (const auto& [key, label] : labels) labelKeys.push_back(key);
    std::sort(labelKeys.begin(), labelKeys.end());
    labelKeys.erase(std::unique(labelKeys.begin(), labelKeys.end()), labelKeys.end());
    for (int key : labelKeys) {
        const Words* want = words.find(key);
        auto have = labels.find(key);
        if (want && (have == labels.end() || have->second.words != *want->text)) {
            if (have != labels.end()) {
                have->second.entity->removeFromParent();
                labels.erase(have);
            }
            labelSize.erase(key);
            if (std::optional<Piece> piece = art->line(*want->text, Art::Size::label, Font::Weight::semibold, ink(want->tone), color(want->tone))) {
                EntityRef e = art->quad(*piece);
                treeRoot->addChild(e);
                labels[key] = Label{e, *want->text};
            }
            have = labels.find(key);
        }
        if (have == labels.end()) continue;
        EntityRef e = have->second.entity;
        float target = want ? want->size : 0;
        auto sized = labelSize.find(key);
        float size = sized != labelSize.end() ? sized->second : 0;
        size += (target - size) * (1 - std::exp(-11 * dt));
        if (!want && size < 0.04f) {
            e->removeFromParent();
            labels.erase(have);
            labelSize.erase(key);
            continue;
        }
        labelSize[key] = size;
        if (std::fabs(target - size) > 0.01f) touch(now + 0.15);
        if (const Vec3* spot = spots.find(key)) {
            Stage::Upright facing = stage.upright(*spot);
            e->orientation = facing.orientation;
            e->position = *spot + facing.normal * 0.02f;
        }
        e->scale = Vec3::repeating(std::max(0.001f, size));
    }

    // (`drawn = list`: the two change places, and `list` is emptied when it is next filled.)
    std::swap(drawn, list);
    // (`list.map(\.thread)`)
    threadList.clear();
    for (const Drawn& d : drawn) threadList.push_back(d.thread);
    threads->draw(threadList, stage.origin);
}

/// One step of easing toward `rest` with no overshoot (a critically
/// damped follow, worked out exactly, so no frame time can upset it).
void OceanModel::ease(Strand& s, Vec3 rest, float dt) {
    float omega = 5;
    Vec3 a = s.p - rest;
    Vec3 b = s.v + a * omega;
    float e = std::exp(-omega * dt);
    s.p = rest + (a + b * dt) * e;
    s.v = (s.v - b * (omega * dt)) * e;
}

/// Where a thread leaves `c` on its way to `other`: the edge of its
/// picture, not its middle, and a hair under it so the card covers it.
/// Two cards with next to no room between them share the way out, each
/// by its size, so the ends never pass each other. (Each used to stop
/// at 0.45 of the way, which left a thread starting well inside a card
/// grown large, and showing over it.)
Vec3 OceanModel::edge(const CardView& c, const CardView& other) const {
    Vec3 d = other.position - c.position;
    // How far along the way a card's own edge is.
    auto out = [&](const CardView& k) -> float {
        float dx = std::fabs(dot(d, k.right)), down = dot(d, k.up) * (&k == &c ? 1 : -1), dy = std::fabs(down);
        Vec2 h = k.half + Vec2::repeating(0.006f);
        // The open card's caption hangs under its picture: downward, its edge is the caption's.
        if (down < 0 && tree && tree->focus() == k.id && tree->focused) {
            Tree::Extent e = tree->openExtent(k.ref);
            h.y *= 1 + (e.down / std::max(e.up, 1e-4f) - 1) * k.openMix.target();
        }
        return std::min({dx > 1e-4f ? h.x / dx : 4.f, dy > 1e-4f ? h.y / dy : 4.f, 4.f});
    };
    float mine = out(c), theirs = out(other);
    float t = mine + theirs > 0.9f ? 0.9f * mine / (mine + theirs) : mine;
    return c.point(Vec2{dot(d, c.right), dot(d, c.up)} * t, -0.012f);
}
