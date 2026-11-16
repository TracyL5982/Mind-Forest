// Port of visionos/MindPalace/Ocean/Tree.swift.
#include "tree.h"

#include <algorithm>
#include <functional>
#include <limits>

#include "../cards/ocean.h"

namespace {

/// `nodes[id]`, to read: null when it isn't there.
const TreeNode* find(const std::map<int, TreeNode>& nodes, int id) {
    auto it = nodes.find(id);
    return it == nodes.end() ? nullptr : &it->second;
}

/// `nodes[id]?`, to write to.
TreeNode* find(std::map<int, TreeNode>& nodes, int id) {
    auto it = nodes.find(id);
    return it == nodes.end() ? nullptr : &it->second;
}

/// `lifted[id] ?? .zero`
Vec2 orZero(const std::map<int, Vec2>& places, int id) {
    auto it = places.find(id);
    return it == places.end() ? Vec2::zero() : it->second;
}

template <class T>
bool contains(const std::vector<T>& list, const T& item) { return std::find(list.begin(), list.end(), item) != list.end(); }

}  // namespace

/// Linear RGB for a point on the wheel: lighter near white, a little
/// deeper as it gets purer, and pulled back inside what a display can show.
Vec3 Chroma::linear(Vec2 q) {
    float c = length(q);
    float h = std::atan2(q.y, q.x);
    float light = 0.98f - 0.3f * std::min(1.f, c / 0.26f);
    for (int i = 0; i < 60; i++) {
        float a = c * std::cos(h), b = c * std::sin(h);
        float l = std::pow(light + 0.3963377774f * a + 0.2158037573f * b, 3.f);
        float m = std::pow(light - 0.1055613458f * a - 0.0638541728f * b, 3.f);
        float s = std::pow(light - 0.0894841775f * a - 1.291485548f * b, 3.f);
        Vec3 rgb{4.0767416621f * l - 3.3077115913f * m + 0.2309699292f * s,
                 -1.2684380046f * l + 2.6097574011f * m - 0.3413193965f * s,
                 -0.0041960863f * l - 0.7034186147f * m + 1.707614701f * s};
        if (i == 59 || (rgb.min() >= -0.002f && rgb.max() <= 1.002f)) return clamp(rgb, Vec3::zero(), Vec3::one());
        c *= 0.96f;
    }
    return Vec3::one();
}

// TreeNode: Codable. Keys are the property names; `ref` is its key, `tone` its raw value, `xy`
// an array of two, and `parent` and `imp` are left out when there is none.
std::optional<TreeNode> TreeNode::from(const Json& j) {
    TreeNode n;
    if (!decode::integer(j["id"], n.id) || !decode::value(j["ref"], n.ref) || !decode::integer(j["parent"], n.parent) ||
        !decode::integers(j["children"], n.children) || !decode::boolean(j["opened"], n.opened) || !decode::boolean(j["kept"], n.kept) ||
        !decode::boolean(j["chip"], n.chip) || !decode::string(j["why"], n.why) || !decode::tone(j["tone"], n.tone) ||
        !decode::boolean(j["head"], n.head) || !decode::vec2(j["xy"], n.xy) || !decode::integer(j["slot"], n.slot) ||
        !decode::boolean(j["byHand"], n.byHand) || !decode::boolean(j["placed"], n.placed) || !decode::real(j["imp"], n.imp)) return std::nullopt;
    return n;
}

Json TreeNode::json() const {
    Json j = Json::object();
    j.set("id", id);
    j.set("ref", ref.json());
    if (parent) j.set("parent", *parent);
    Json kids = Json::list();
    for (int c : children) kids.push(c);
    j.set("children", kids);
    j.set("opened", opened);
    j.set("kept", kept);
    j.set("chip", chip);
    j.set("why", why);
    j.set("tone", rawValue(tone));
    j.set("head", head);
    j.set("xy", Json::list({Json(xy.x), Json(xy.y)}));
    j.set("slot", slot);
    j.set("byHand", byHand);
    j.set("placed", placed);
    if (imp) j.set("imp", *imp);
    return j;
}

std::optional<Tree::Link> Tree::Link::from(const Json& j) {
    Link l;
    if (!decode::integer(j["a"], l.a) || !decode::integer(j["b"], l.b) || !decode::string(j["why"], l.why) ||
        !decode::tone(j["tone"], l.tone)) return std::nullopt;
    return l;
}

Json Tree::Link::json() const {
    Json j = Json::object();
    j.set("a", a);
    j.set("b", b);
    j.set("why", why);
    j.set("tone", rawValue(tone));
    return j;
}

Tree::Tree(const Ref& ref, const std::string& title, Maker maker, const std::shared_ptr<Catalog>& catalog, bool grows)
    : title(title), maker(maker), catalog(catalog), grows(grows) {
    root = 0;
    current = 0;
    stand = 0;
    route = {0};
    TreeNode n;
    n.id = 0;
    n.ref = ref;
    n.parent = std::nullopt;
    n.opened = true;
    n.kept = true;
    n.chip = false;
    n.why = "";
    n.tone = catalog->tone(ref);
    n.head = true;
    n.xy = Vec2::zero();
    nodes[0] = n;
    nextID = 1;
    if (grows) grow(0);     // AGENT
    relayout();
}

std::set<Ref> Tree::held() const {
    std::set<Ref> out;
    for (const auto& [id, n] : nodes) out.insert(n.ref);
    return out;
}

/// Root to `id`.
std::vector<int> Tree::path(int id) const {
    std::vector<int> out;
    std::optional<int> at = id;
    while (at) {
        const TreeNode* n = find(nodes, *at);
        if (!n) break;
        out.push_back(*at);
        at = n->parent;
    }
    std::reverse(out.begin(), out.end());
    return out;
}

std::optional<TreeNode> Tree::node(const Ref& ref) const {
    for (const auto& [id, n] : nodes) {
        if (n.ref == ref) return n;
    }
    return std::nullopt;
}

// MARK: - Layers

/// The group `id` belongs to, by its first card: itself if it has been asked about, else the card it came back to.
int Tree::layer(int id) const {
    const TreeNode* n = find(nodes, id);
    if (!n) return root;
    return n->head ? id : n->parent.value_or(root);
}

/// The group a card came back in.
int Tree::host(int id) const {
    const TreeNode* n = find(nodes, id);
    return n && n->parent ? *n->parent : root;
}

/// Which layer a group lies on, by its first card: the root's is 0, and
/// each question is one more.
int Tree::generation(int id) const { return std::max(0, int(path(id).size()) - 1); }

int Tree::standDepth() const {
    auto it = std::find(route.begin(), route.end(), stand);
    return it == route.end() ? 0 : int(it - route.begin());
}

bool Tree::walk() const {
    const TreeNode* first = find(nodes, root);
    return first && first->ref.kind == Ref::Kind::note && first->ref.id == "welcome";
}

Vec2 Tree::home(const TreeNode& n, const TreeNode& host) const { return orZero(lifted, host.id) + n.xy * spread(host.id); }

/// Where a card shows, given the layer you work on.
/// - Asked about, and its group's layer is in view: in the middle of its group, on that layer.
/// - Its group's layer is nearer than the one you work on: at home, and its group condensed round it.
/// - Its own layer is nearer than the one you work on: small, huddled
///   round the card it came back to, if it matters enough; else put away into that card.
Seat Tree::seat(const TreeNode& n) const {
    int top = standDepth();
    const TreeNode* host = n.parent ? find(nodes, *n.parent) : nullptr;
    if (!host) return Seat{0, orZero(lifted, n.id)};
    int p = *n.parent;
    int born = generation(p);
    if (born <= top) {
        if (n.head && born + 1 <= top) return Seat{born + 1, orZero(lifted, n.id)};
        return Seat{born, home(n, *host), 1, n.head && Branching::deep >= 1 ? 1.f : 0.f};
    }
    Seat s = seat(*host);
    int level = born - top;
    float k = s.scale * Branching::small;
    std::optional<Vec2> at;
    if (level <= Branching::deep && s.visible) {
        std::map<int, Vec2> around = huddle(*host, s.scale, level);
        auto it = around.find(n.id);
        if (it != around.end()) at = it->second;
    }
    if (!at) {
        s.visible = false;
        s.scale = k;
        return s;
    }
    return Seat{s.depth, s.xy + *at, k, float(n.head && level < Branching::deep ? level + 1 : level)};
}

/// Where a card shows: nil when it is put away.
std::optional<Tree::Place> Tree::shown(const TreeNode& n) const {
    Seat s = seat(n);
    return s.visible ? std::optional<Place>(Place{s.depth, s.xy}) : std::nullopt;
}

/// Whether a card shows as part of a condensed group.
bool Tree::condensed(const TreeNode& n) const {
    if (!n.parent) return false;
    return generation(*n.parent) > standDepth();
}

/// Where a card lies with every layer open: for a picture of the whole
/// tree. Its layer, and where it stands from its group's first card.
std::optional<Tree::Place> Tree::flat(const TreeNode& n) const {
    if (n.head) return Place{generation(n.id), Vec2::zero()};
    if (!n.parent) return std::nullopt;
    return Place{generation(*n.parent), n.xy};
}

std::vector<int> Tree::heads(int id) const {
    std::vector<int> out;
    for (int a : path(id)) {
        const TreeNode* n = find(nodes, a);
        if (n && n->head) out.push_back(a);
    }
    return out;
}

/// The cards that hang from `id` without a group of their own between (in a tree kept before every question made a layer).
std::vector<int> Tree::riders(int id) const {
    std::vector<int> out;
    const TreeNode* top = find(nodes, id);
    std::vector<int> stack = top ? top->children : std::vector<int>{};
    while (!stack.empty()) {
        int a = stack.back();
        stack.pop_back();
        const TreeNode* n = find(nodes, a);
        if (!n) continue;
        out.push_back(a);
        if (!n->head) stack.insert(stack.end(), n->children.begin(), n->children.end());
    }
    return out;
}

// MARK: - Asking, focus, and layers

/// Everything the gardener brings is simply there now; this only marks an older tree's suggestion as taken.
bool Tree::confirm(int id) {
    TreeNode* n = find(nodes, id);
    if (!n || n->kept) return false;
    n->kept = true;
    return true;
}

/// Asks about a card, or goes back to one that was asked: it becomes
/// the first card of a group on the next layer, opens there, and that
/// layer is the one you work on. The first time, what the gardener
/// brings for it comes up round it. Returns what came.
Tree::Change Tree::focus(int id) {
    const TreeNode* found = find(nodes, id);
    if (!found) return {{}, {}};
    TreeNode n = *found;
    n.kept = true;
    n.head = true;
    n.chip = false;
    n.opened = true;
    nodes[id] = n;
    if (!contains(route, id)) route = path(id);
    stand = id;
    current = id;
    focused = true;
    // AGENT: a tree the agent service grows brings its own picks (`grows`).
    std::vector<int> added = n.children.empty() && grows ? grow(id) : std::vector<int>{};
    relayout();
    return {added, {}};
}

/// Steps out of the card in focus: it closes, and its group draws in.
std::vector<TreeNode> Tree::unfocus() {
    if (!focused) return {};
    focused = false;
    relayout();
    return {};
}

/// Stands on a layer in line, with its first card in focus.
std::optional<Tree::Change> Tree::go(int head) {
    if (!contains(route, head)) return std::nullopt;
    return focus(head);
}

/// One layer toward the root, or back out along the layers in line.
std::optional<Tree::Change> Tree::stepBack() {
    int d = standDepth();
    return d > 0 ? go(route[d - 1]) : std::nullopt;
}

std::optional<Tree::Change> Tree::stepForward() {
    int d = standDepth();
    return d + 1 < int(route.size()) ? go(route[d + 1]) : std::nullopt;
}

/// Brings something in by hand, beside the open card.
std::optional<int> Tree::attach(const Ref& ref, const std::string& why) {
    int to = current;
    if (held().count(ref)) return std::nullopt;
    std::vector<int> free = freeSlots(to, true);
    if (free.empty()) return std::nullopt;
    int slot = free.front();
    int id = add(ref, to, why, catalog->tone(ref) == Tone::path ? Tone::path : catalog->tone(ref), false, slot);
    if (TreeNode* n = find(nodes, id)) n->kept = true;
    if (TreeNode* n = find(nodes, id)) n->byHand = true;
    if (TreeNode* n = find(nodes, id)) n->imp = 1;
    if (maker == Maker::gardener) maker = Maker::both;
    relayout();
    return id;
}

/// A question put to the gardener about the card in focus. Its answer
/// (a note) comes back into that card's group and is asked in turn: it
/// rises to the next layer, where what it points to that the tree
/// doesn't hold yet stands round it; what the tree already holds is
/// tied to it across the tree. Returns the answer's node and what came.
std::optional<Tree::Asked> Tree::ask(const Ref& answer, const std::vector<Pointing>& links, const std::string& why) {
    int asked = current;
    std::optional<int> made = attach(answer, why);
    if (!made) return std::nullopt;
    int id = *made;
    Change landed = focus(id);
    for (const Pointing& link : links) {
        std::optional<TreeNode> n = node(link.ref);
        if (!n || n->id == id || n->id == asked || n->parent == id) continue;
        this->links.push_back(Link{id, n->id, link.why, Tone::question});
    }
    return Asked{id, landed.added, {}};
}

/// Cuts `id` away, with everything grown from it. Returns what left.
std::vector<TreeNode> Tree::prune(int id) {
    if (id == root) return {};
    const TreeNode* n = find(nodes, id);
    if (!n || !n->parent) return {};
    int p = *n->parent;
    std::vector<TreeNode> gone;
    std::vector<int> stack{id};
    while (!stack.empty()) {
        int a = stack.back();
        stack.pop_back();
        const TreeNode* node = find(nodes, a);
        if (!node) continue;
        gone.push_back(*node);
        stack.insert(stack.end(), node->children.begin(), node->children.end());
    }
    std::set<int> ids;
    for (const TreeNode& g : gone) ids.insert(g.id);
    if (TreeNode* parent = find(nodes, p)) std::erase(parent->children, id);
    for (int g : ids) nodes.erase(g);
    std::erase_if(links, [&](const Link& l) { return ids.count(l.a) > 0 || ids.count(l.b) > 0; });
    auto cut = std::find_if(route.begin(), route.end(), [&](int r) { return ids.count(r) > 0; });
    if (cut != route.end()) route = std::vector<int>(route.begin(), cut);
    if (route.empty()) route = {root};
    if (ids.count(stand)) stand = route.empty() ? root : route.back();
    if (ids.count(current)) current = stand;
    if (maker == Maker::gardener) maker = Maker::both;
    relayout();
    return gone;
}

/// Puts a card somewhere else in its group, by hand. Returns what moved.
std::vector<int> Tree::place(int id, Vec2 xy) {
    TreeNode* n = find(nodes, id);
    if (!n) return {};
    n->xy = xy;
    n->placed = true;
    if (maker == Maker::gardener) maker = Maker::both;
    relayout();
    return {id};
}

// MARK: - Layout

/// Half the open card's width, and how far it reaches up and down.
Tree::Extent Tree::openExtent(const Ref& ref) const {
    // NOTE(port): added for Quest. A piece drawn as a card is its card, with nothing under it (core/cards).
    if (std::optional<std::string> card = cards::ocean::cardOf(ref)) {
        if (std::optional<Vec2> s = cards::ocean::openSize(*card)) return {s->x / 2, s->y / 2, s->y / 2};
    }
    switch (ref.kind) {
    case Ref::Kind::film: {
        Vec2 s = Metrics::film(Metrics::openFilm, Metrics::openFilmMaxHeight, catalog->clips[size_t(ref.index)].aspect);
        return {s.x / 2, s.y / 2, s.y / 2 + Metrics::filmCaption};
    }
    case Ref::Kind::work: {
        Vec2 p = Metrics::work(Metrics::openWorkArea, catalog->works[size_t(ref.index)].aspect, 0.5f, 0.44f);
        return {std::max(p.x, Metrics::openWorkMinWidth) / 2, p.y / 2, p.y / 2 + Metrics::workCaption};
    }
    case Ref::Kind::note: {
        auto it = catalog->notes.find(ref.id);
        Vec2 s = it != catalog->notes.end() ? catalog->openSize(it->second) : Vec2{Metrics::openNoteWidth, 0.27f};
        return {s.x / 2, s.y / 2, s.y / 2};
    }
    case Ref::Kind::tag:
        return {0.16f, 0.04f, 0.07f};
    }
    return {0.16f, 0.04f, 0.07f};
}

Tree::Ring Tree::ring(const TreeNode& n) const {
    Extent e = openExtent(n.ref);
    if (n.ref.kind == Ref::Kind::tag) return {{0, -0.01f}, {0.5f, 0.32f}};
    return {{0.09f, (e.up - e.down) / 2}, {std::max(0.72f, e.half + 0.46f), (e.up + e.down) / 2 + 0.23f}};
}

/// Everything already lying on the sheet that `id`'s children would lie on.
std::vector<Vec2> Tree::neighbors(int sheet, int id) const {
    std::vector<Vec2> out;
    if (sheet != id) out.push_back(Vec2::zero());
    for (const auto& [key, n] : nodes) {
        if (n.id != id && n.id != sheet && !(n.chip && !n.opened) && n.parent == sheet) out.push_back(n.xy);
    }
    return out;
}

/// Places still free around a card. The first nine are the ring the
/// gardener fills; with `outer`, nine more follow on a wider ring. A
/// place is not free if something already lies there, or if it is
/// straight below the layer's first card, where the path runs down to
/// the earlier layers.
std::vector<int> Tree::freeSlots(int id, bool outer) const {
    const TreeNode* found = find(nodes, id);
    if (!found) return {};
    const TreeNode& n = *found;
    std::vector<int> free;
    for (int i = 0; i < (outer ? 2 * int(ringAngles.size()) : int(ringAngles.size())); i++) free.push_back(i);
    int sheet = layer(id);
    // Not back the way we came.
    const TreeNode* parent = !n.head && n.parent ? find(nodes, *n.parent) : nullptr;
    if (parent) {
        Vec2 back = center(*parent) - n.xy;
        if (length(back) > 1e-4f) {
            float a = std::atan2(back.y, back.x) * 180 / floatPi;
            std::erase_if(free, [&](int slot) { return std::fabs(wrap(angle(slot) - a)) < 50; });
        }
    }
    std::set<int> used;
    for (int c : n.children) {
        if (const TreeNode* child = find(nodes, c)) used.insert(child->slot);
    }
    std::erase_if(free, [&](int slot) { return used.count(slot) > 0; });
    std::vector<Vec2> taken = neighbors(sheet, id);
    Vec2 own = center(n);
    std::erase_if(free, [&](int slot) {
        Vec2 p = spot(slot, n);
        // Not straight below the layer's first card, nor straight below this one:
        // it may start a layer itself, and then the path runs down from it.
        if (std::fabs(p.x) < 0.32f && p.y < -0.2f) return true;
        if (std::fabs(p.x - own.x) < 0.32f && p.y - own.y < -0.2f) return true;
        return std::any_of(taken.begin(), taken.end(), [&](Vec2 t) { return std::fabs(t.x - p.x) < 0.2f && std::fabs(t.y - p.y) < 0.14f; });
    });
    return free;
}

float Tree::angle(int slot) const {
    int count = int(ringAngles.size());
    return ringAngles[size_t(slot % count)] + (slot >= count ? 20 : 0);
}

float Tree::wrap(float deg) const {
    float d = std::fmod(deg, 360.f);
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    return d;
}

Vec2 Tree::spot(int slot, const TreeNode& n) const {
    Ring e = ring(n);
    Vec2 c = e.center, axes = e.axes;
    if (slot >= int(ringAngles.size())) axes *= 1.45f;
    float a = angle(slot) * floatPi / 180;
    // A little off the ellipse, the same way every time, so it never looks ruled.
    // (`n.id &* 7919 &+ slot &* 104_729 &+ 17`: 64 bits, wrapping.)
    SeededRandom r(uint64_t(int64_t(n.id)) * 7919ULL + uint64_t(int64_t(slot)) * 104729ULL + 17ULL);
    float jx = r.next() - 0.5f;
    float jy = r.next() - 0.5f;
    Vec2 j = Vec2{jx, jy} * 0.05f;
    return center(n) + c + Vec2{std::cos(a), std::sin(a)} * axes + j;
}

int Tree::add(const Ref& ref, int parent, const std::string& why, Tone tone, bool chip, int slot) {
    const TreeNode* found = find(nodes, parent);
    if (!found) return -1;
    const TreeNode& p = *found;
    int id = nextID;
    nextID += 1;
    Vec2 xy = Vec2::zero();
    if (chip) {
        Extent e = openExtent(p.ref);
        float w = catalog->chipWidth(catalog->title(ref));
        xy = center(p) + Vec2{e.half + 0.022f + w / 2, e.up - Metrics::chipHeight / 2 - float(slot) * Metrics::chipGap};
    } else {
        xy = spot(slot, p);
    }
    TreeNode n;
    n.id = id;
    n.ref = ref;
    n.parent = parent;
    n.chip = chip;
    n.why = why;
    n.tone = tone;
    n.xy = xy;
    n.slot = chip ? -1 : slot;
    nodes[id] = n;
    if (TreeNode* host = find(nodes, parent)) host->children.push_back(id);
    return id;
}

/// Where a tag stands when it is the reason for some of the
/// suggestions: out on the way to them, just clear of the open card, so
/// their threads run through it and it is said once.
Vec2 Tree::junction(const std::string& title, const TreeNode& n, const std::vector<Vec2>& targets) const {
    Vec2 c = center(n);
    Vec2 mean = Vec2::zero();
    for (Vec2 t : targets) mean += t;
    mean /= float(targets.size());
    Vec2 away = mean - c;
    float far = length(away);
    if (!(far > 1e-3f)) return c;
    Vec2 d = away / far;
    Extent e = openExtent(n.ref);
    float w = catalog->chipWidth(title);
    // Out through the edge of the open card, with what stands under it, and a little more.
    float side = e.half + 0.035f + w / 2;
    float rise = d.y > 0 ? e.up + 0.04f : e.down + 0.17f;
    const float infinity = std::numeric_limits<float>::infinity();
    float out = std::min(std::fabs(d.x) > 1e-3f ? side / std::fabs(d.x) : infinity, std::fabs(d.y) > 1e-3f ? rise / std::fabs(d.y) : infinity);
    return c + d * std::min(out, far * 0.62f);
}

/// The gardener's suggestions around the card in focus. Those that are
/// there for the same reason stand side by side, and a tag that is the
/// reason stands on the way to them instead of beside the card.
std::vector<int> Tree::grow(int id) {
    const TreeNode* found = find(nodes, id);
    if (!found) return {};
    TreeNode n = *found;        // as it is now: what is added below is not in this copy, as in the Swift
    std::vector<Offer> offers = catalog->offers(n.ref, held());
    std::vector<int> added;
    // Same reason, side by side (keeping the order the reasons first came in).
    std::vector<Offer> ringOffers;
    std::vector<Offer> plain;
    for (const Offer& offer : offers) {
        if (!offer.chip) plain.push_back(offer);
    }
    for (const Offer& offer : plain) {
        std::set<Ref> taken;
        for (const Offer& o : ringOffers) taken.insert(o.ref);
        if (taken.count(offer.ref)) continue;
        for (const Offer& o : plain) {
            if (o.why == offer.why && !taken.count(o.ref)) ringOffers.push_back(o);
        }
    }
    // The near ring first; the wider one only for what doesn't fit.
    std::vector<int> near = freeSlots(id);
    std::vector<int> free = near;
    if (free.size() < ringOffers.size()) {
        for (int slot : freeSlots(id, true)) {
            if (!contains(near, slot)) free.push_back(slot);
        }
    }
    // Spread what there is over the free places, instead of bunching it at one end.
    int take = std::min(int(ringOffers.size()), int(free.size()));
    std::vector<int> slots;
    for (int i = 0; i < take; i++) {
        slots.push_back(free[size_t(take >= int(near.size()) ? i : int((float(i) + 0.5f) * float(near.size()) / float(take)))]);
    }
    // NOTE(port): added for Quest. On the welcome tree the way on is always in the same place, on the right
    // and a little up (it is the first thing a lesson's card links to), and the pictures stand clear of it.
    if (walk() && take > 0) {
        static const int others[3][3] = {{4, 4, 4}, {3, 5, 5}, {3, 5, 8}};
        // (More than three: what Momo can do, on the layer its answer makes. They take the left and the foot of
        // the card in order, and the way on keeps the right to itself.)
        static const int many[6] = {2, 3, 4, 5, 6, 7};
        int rest = std::min(take - 1, 6);
        slots = {0};
        for (int k = 0; k < rest; k++) slots.push_back(rest <= 3 ? others[rest - 1][k] : many[k]);
    }
    struct Around {
        std::string why;
        Vec2 xy;
    };
    std::vector<Around> around;
    for (int k = 0; k < std::min(int(ringOffers.size()), int(slots.size())); k++) {
        const Offer& offer = ringOffers[size_t(k)];
        int made = add(offer.ref, id, offer.why, offer.tone, false, slots[size_t(k)]);
        // What the gardener offers first matters most.
        if (TreeNode* m = find(nodes, made)) m->imp = 0.9f - 0.7f * float(k) / float(std::max(int(slots.size()), 1));
        added.push_back(made);
        if (const TreeNode* m = find(nodes, made)) around.push_back({offer.why, m->xy});
    }
    int stacked = 0;
    struct Tag {
        Vec2 xy;
        float width;
    };
    std::vector<Tag> tags;
    // The tags that only stand beside the card first, then the ones out on the way to something.
    std::vector<Offer> chips;
    for (const Offer& offer : offers) {
        if (offer.chip) chips.push_back(offer);
    }
    auto reasons = [&](const Offer& offer) {
        std::vector<Vec2> out;
        for (const Around& a : around) {
            if (a.why == catalog->title(offer.ref)) out.push_back(a.xy);
        }
        return out;
    };
    std::vector<Offer> ordered;
    for (const Offer& offer : chips) {
        if (reasons(offer).empty()) ordered.push_back(offer);
    }
    for (const Offer& offer : chips) {
        if (!reasons(offer).empty()) ordered.push_back(offer);
    }
    for (const Offer& offer : ordered) {
        std::string title = catalog->title(offer.ref);
        float width = catalog->chipWidth(title);
        std::vector<Vec2> targets = reasons(offer);
        int made = add(offer.ref, id, offer.why, offer.tone, true, targets.empty() ? stacked : 0);
        if (targets.empty()) {
            stacked += 1;
        } else {
            // Out on the way to what it explains, and further out if another tag is already there.
            Vec2 at = junction(title, n, targets);
            Vec2 away = at - center(n);
            Vec2 step = length(away) > 1e-4f ? normalize(away) * 0.045f : Vec2{0.045f, 0};
            int tries = 0;
            while (tries < 6 && std::any_of(tags.begin(), tags.end(), [&](const Tag& t) {
                       return std::fabs(t.xy.x - at.x) < (t.width + width) / 2 + 0.012f && std::fabs(t.xy.y - at.y) < Metrics::chipHeight + 0.008f;
                   })) {
                at += step;
                tries += 1;
            }
            if (TreeNode* m = find(nodes, made)) m->xy = at;
        }
        if (const TreeNode* m = find(nodes, made)) tags.push_back({m->xy, width});
        added.push_back(made);
    }
    for (int a : added) {
        if (TreeNode* m = find(nodes, a)) m->kept = true;
    }
    return added;
}

// MARK: - Condensing

/// Which cards of a group stay when it condenses: every card that was
/// asked about, since it carries a branch, then the most important of the rest.
std::vector<TreeNode> Tree::stays(const TreeNode& p, int level) const {
    int limit = level == 1 ? Branching::keep : (Branching::keep + 1) / 2;
    std::vector<TreeNode> kids;
    for (int c : p.children) {
        const TreeNode* n = find(nodes, c);
        if (n && !n->chip) kids.push_back(*n);
    }
    // ($0.head ? 1 : 0, $0.imp ?? 0.5, -$0.id) > ($1.head ? 1 : 0, $1.imp ?? 0.5, -$1.id)
    std::stable_sort(kids.begin(), kids.end(), [](const TreeNode& a, const TreeNode& b) {
        int ha = a.head ? 1 : 0, hb = b.head ? 1 : 0;
        if (ha != hb) return ha > hb;
        float ia = a.imp.value_or(0.5f), ib = b.imp.value_or(0.5f);
        if (ia != ib) return ia > ib;
        return -a.id > -b.id;
    });
    std::vector<TreeNode> out;
    for (const TreeNode& c : kids) {
        if (c.head || int(out.size()) < limit) out.push_back(c);
    }
    return out;
}

/// A condensed group huddles: each card that stays keeps its direction
/// from the middle card and moves in until it nearly touches. One with a
/// huddle of its own brings that whole huddle with it. `scale` is the
/// middle card's; `level` is 1 for a huddle on the layer you work on, 2
/// for one nested in it.
std::map<int, Vec2> Tree::huddle(const TreeNode& p, float scale, int level) const {
    float k = scale * Branching::small, pad = 0.02f * scale;
    std::vector<Box> boxes{Box::centerSize(Vec2::zero(), catalog->smallSize(p.ref) * scale)};
    std::map<int, Vec2> out;
    for (const TreeNode& c : stays(p, level)) {
        Vec2 d = length(c.xy) > 1e-4f ? normalize(c.xy) : Vec2{1, 0};
        Box f = foot(c, k, level + 1);
        float r = 0;
        do {
            r += 0.01f;
        } while (r < 3 && std::any_of(boxes.begin(), boxes.end(), [&](const Box& b) { return b.hits(f.moved(d * r), pad); }));
        out[c.id] = d * r;
        boxes.push_back(f.moved(d * r));
    }
    return out;
}

/// The room a card takes at home: itself, and its huddle if it has been asked about.
Box Tree::foot(const TreeNode& c, float scale, int level) const {
    Box box = Box::centerSize(Vec2::zero(), catalog->smallSize(c.ref) * scale);
    if (!(c.head && level <= Branching::deep)) return box;
    for (const auto& [id, at] : huddle(c, scale, level)) {
        if (const TreeNode* n = find(nodes, id)) box = box.joined(foot(*n, scale * Branching::small, level + 1).moved(at));
    }
    return box;
}

// MARK: - Where groups stand

/// A group's cards, round its first card. On the layer you work on, a
/// card that has been asked about is given the room its huddle needs;
/// on any other, the group is as it was before that card was asked.
std::vector<Box> Tree::boxes(const TreeNode& h, int top) const {
    bool open = focused && current == h.id;
    float s = spread(h.id);
    std::vector<Box> out;
    if (open) {
        Extent e = openExtent(h.ref);
        out.push_back(Box({-e.half, -e.down - 0.1f}, {e.half, e.up}));
    } else {
        out.push_back(Box::centerSize(Vec2::zero(), catalog->smallSize(h.ref)));
    }
    bool front = generation(h.id) == top;
    for (int id : h.children) {
        const TreeNode* found = find(nodes, id);
        if (!found) continue;
        const TreeNode& c = *found;
        if (c.chip) {
            if (open) out.push_back(Box::centerSize(c.xy, {catalog->chipWidth(catalog->title(c.ref)), Metrics::chipHeight}));
            continue;
        }
        Box own = c.head && front && Branching::deep >= 1 ? foot(c, 1, 1).grown(Branching::hug)
            : Box::centerSize(Vec2::zero(), catalog->smallSize(c.ref));
        out.push_back(own.moved(c.xy * s));
    }
    return out;
}

/// The direction in which two branches first parted: from the one card
/// to the other, in the last group their lines of questions share.
Vec2 Tree::parted(int a, int b) const {
    std::vector<int> pa = path(a), pb = path(b);
    size_t k = 0;
    while (k < pa.size() && k < pb.size() && pa[k] == pb[k]) k += 1;
    if (!(k < pa.size() && k < pb.size())) return {1, 0};
    const TreeNode* x = find(nodes, pa[k]);
    const TreeNode* y = find(nodes, pb[k]);
    if (!x || !y) return {1, 0};
    Vec2 d = y->xy - x->xy;
    return length(d) > 1e-5f ? normalize(d) : Vec2{1, 0};
}

/// Moves the groups of one layer apart, all together. Two groups only
/// ever part along the direction their branches first parted, and one
/// that has ended up on the wrong side of another along that direction
/// is brought back across: a branch keeps its side, and no group hops
/// over another to find room. Heavier groups give way less.
void Tree::part(std::vector<Group>& g) const {
    if (!(g.size() > 1)) return;
    float gap = Branching::gap();
    const float infinity = std::numeric_limits<float>::infinity();
    std::vector<std::vector<Vec2>> toward(g.size(), std::vector<Vec2>(g.size(), Vec2{1, 0}));
    for (size_t i = 0; i < g.size(); i++) {
        for (size_t j = i + 1; j < g.size(); j++) toward[i][j] = parted(g[i].node.id, g[j].node.id);
    }
    for (int round = 0; round < 400; round++) {
        bool moved = false;
        for (size_t i = 0; i < g.size(); i++) {
            for (size_t j = i + 1; j < g.size(); j++) {
                Vec2 u = toward[i][j];
                float along = dot(g[j].at - g[i].at, u);
                float s = along < 0.02f ? 0.02f - along : 0;
                int again = 0;
                bool any = true;
                while (any && again < 20) {
                    any = false;
                    again += 1;
                    for (const Box& p : g[i].boxes) {
                        for (const Box& q : g[j].boxes) {
                            Box a = p.moved(g[i].at), b = q.moved(g[j].at + u * s);
                            if (!a.hits(b, gap)) continue;
                            float sx = u.x > 1e-3f ? (a.hi.x + gap - b.lo.x) / u.x : (u.x < -1e-3f ? (b.hi.x - a.lo.x + gap) / -u.x : infinity);
                            float sy = u.y > 1e-3f ? (a.hi.y + gap - b.lo.y) / u.y : (u.y < -1e-3f ? (b.hi.y - a.lo.y + gap) / -u.y : infinity);
                            s += std::min(sx, sy) + 0.002f;
                            any = true;
                        }
                    }
                }
                if (!(s > 1e-4f && std::isfinite(s))) continue;
                moved = true;
                float ma = float(g[i].boxes.size()), mb = float(g[j].boxes.size());
                g[i].at -= u * (s * mb / (ma + mb));
                g[j].at += u * (s * ma / (ma + mb));
            }
        }
        if (!moved) break;
    }
}

/// Works out where every group stands, layer by layer from the first,
/// since each layer stands on the one below; then every branch's colour.
/// It depends on which layer you work on and which card is open, and is
/// done again whenever either changes.
void Tree::relayout() {
    int top = standDepth();
    std::map<int, std::vector<TreeNode>> layers;
    for (const auto& [id, n] : nodes) {
        if (n.head) layers[generation(n.id)].push_back(n);
    }
    lifted = {{root, Vec2::zero()}};
    if (!layers.empty() && layers.rbegin()->first >= 1) {
        int last = layers.rbegin()->first;
        for (int d = 1; d <= last; d++) {
            std::vector<TreeNode> heads = layers.count(d) ? layers[d] : std::vector<TreeNode>{};
            std::stable_sort(heads.begin(), heads.end(), [](const TreeNode& a, const TreeNode& b) { return a.id < b.id; });
            std::vector<Group> groups;
            for (const TreeNode& h : heads) {
                const TreeNode* host = h.parent ? find(nodes, *h.parent) : nullptr;
                if (!host) continue;
                groups.push_back(Group{h, boxes(h, top), home(h, *host) * (walk() ? 0 : 1 - Branching::gather())});
            }
            part(groups);
            for (const Group& group : groups) lifted[group.node.id] = group.at;
        }
    }
    tint();
}

/// Chroma separation. The first branch is white. When more than one
/// card of a group has been asked about, the group's colour comes apart
/// into theirs: each is a step away from it, in directions spread evenly
/// round it and to either side of the way the group itself was heading,
/// so that mixed again they give the colour they came from. The step
/// shrinks a little with each split but never to nothing.
void Tree::tint() {
    tints = {};
    std::function<void(int, Vec2, float, int)> go = [&](int id, Vec2 at, float heading, int depth) {
        const TreeNode* n = find(nodes, id);
        if (!n) return;
        tints[id] = at;
        std::vector<const TreeNode*> kids;
        for (int c : n->children) {
            if (const TreeNode* kid = find(nodes, c)) kids.push_back(kid);
        }
        for (const TreeNode* c : kids) {
            if (!c->head) tints[c->id] = at;
        }
        std::vector<const TreeNode*> branches;
        for (const TreeNode* c : kids) {
            if (c->head) branches.push_back(c);
        }
        if (branches.size() == 1) {
            go(branches[0]->id, at, heading, depth);        // one branch: nothing has separated yet
            return;
        }
        float r = Branching::step * std::max(0.5f, std::pow(0.84f, float(depth)));
        int count = int(branches.size());
        for (int j = 0; j < count; j++) {
            const TreeNode* c = branches[size_t(j)];
            float a = heading + float(2 * j + 1 - count) * floatPi / float(count);
            go(c->id, at + Vec2{std::cos(a), std::sin(a)} * r, a, depth + 1);
        }
    };
    go(root, Vec2::zero(), Branching::first, 0);
}

/// A card's colour, linear RGB: its branch's.
Vec3 Tree::color(int id) const { return Chroma::linear(orZero(tints, id)); }

// MARK: - Keeping

std::optional<Tree::Saved> Tree::Saved::from(const Json& j) {
    Saved s;
    std::string maker;
    if (!decode::string(j["title"], s.title) || !decode::string(j["maker"], maker) || !makerFrom(maker) ||
        !decode::boolean(j["sent"], s.sent) || !decode::list(j["nodes"], s.nodes) || !decode::integer(j["current"], s.current) ||
        !decode::integer(j["stand"], s.stand) || !decode::integers(j["route"], s.route) || !decode::list(j["links"], s.links) ||
        !decode::integer(j["nextID"], s.nextID) || !decode::list(j["notes"], s.notes)) return std::nullopt;
    s.maker = *makerFrom(maker);
    return s;
}

Json Tree::Saved::json() const {
    Json j = Json::object();
    j.set("title", title);
    j.set("maker", rawValue(maker));
    j.set("sent", sent);
    Json nodeList = Json::list();
    for (const TreeNode& n : nodes) nodeList.push(n.json());
    j.set("nodes", nodeList);
    j.set("current", current);
    j.set("stand", stand);
    Json routeList = Json::list();
    for (int id : route) routeList.push(id);
    j.set("route", routeList);
    Json linkList = Json::list();
    for (const Link& l : links) linkList.push(l.json());
    j.set("links", linkList);
    j.set("nextID", nextID);
    Json noteList = Json::list();
    for (const OceanNote& n : notes) noteList.push(n.json());
    j.set("notes", noteList);
    return j;
}

Tree::Saved Tree::saved() const {
    std::vector<OceanNote> made;
    for (const auto& [key, n] : nodes) {
        if (n.ref.kind != Ref::Kind::note || !catalog->made.count(n.ref.id)) continue;
        auto it = catalog->notes.find(n.ref.id);
        if (it != catalog->notes.end()) made.push_back(it->second);
    }
    std::vector<TreeNode> sorted;
    for (const auto& [key, n] : nodes) sorted.push_back(n);
    std::stable_sort(sorted.begin(), sorted.end(), [](const TreeNode& a, const TreeNode& b) { return a.id < b.id; });
    Saved s;
    s.title = title;
    s.maker = maker;
    s.sent = sent;
    s.nodes = sorted;
    s.current = current;
    s.stand = stand;
    s.route = route;
    s.links = links;
    s.nextID = nextID;
    s.notes = made;
    return s;
}

std::shared_ptr<Tree> Tree::make(const Saved& s, const std::shared_ptr<Catalog>& catalog) {
    if (!std::any_of(s.nodes.begin(), s.nodes.end(), [](const TreeNode& n) { return n.id == 0; })) return nullptr;
    for (const OceanNote& note : s.notes) catalog->keep(note);
    // Anything the library no longer holds means the tree can't stand.
    for (const TreeNode& n : s.nodes) {
        switch (n.ref.kind) {
        case Ref::Kind::film:
            if (!(n.ref.index >= 0 && n.ref.index < int(catalog->clips.size()))) return nullptr;
            break;
        case Ref::Kind::work:
            if (!(n.ref.index >= 0 && n.ref.index < int(catalog->works.size()))) return nullptr;
            break;
        case Ref::Kind::note:
            if (!catalog->notes.count(n.ref.id)) return nullptr;
            break;
        case Ref::Kind::tag:
            if (!catalog->tags.count(n.ref.id)) return nullptr;
            break;
        }
    }
    std::shared_ptr<Tree> tree(new Tree(catalog));
    Tree& t = *tree;
    t.title = s.title;
    t.maker = s.maker;
    t.sent = s.sent;
    t.root = 0;
    for (const TreeNode& n : s.nodes) t.nodes[n.id] = n;
    t.current = t.nodes.count(s.current) ? s.current : 0;
    t.route = {};
    for (int id : s.route) {
        if (std::any_of(s.nodes.begin(), s.nodes.end(), [&](const TreeNode& n) { return n.id == id && n.head; })) t.route.push_back(id);
    }
    if (t.route.empty() || t.route.front() != 0) t.route = {0};
    t.stand = contains(t.route, s.stand) ? s.stand : (t.route.empty() ? 0 : t.route.back());
    t.links = s.links;
    int most = 0;
    for (size_t i = 0; i < s.nodes.size(); i++) most = i == 0 ? s.nodes[i].id : std::max(most, s.nodes[i].id);
    t.nextID = std::max(s.nextID, most + 1);
    t.settle();
    return tree;
}

/// A tree kept before every question made a layer is brought into line:
/// what was only suggested is simply there, and any card with cards of
/// its own is the first card of their group, with them placed from it.
void Tree::settle() {
    for (auto& [id, n] : nodes) n.kept = true;
    std::function<void(int)> group = [&](int id) {
        const TreeNode* found = find(nodes, id);
        if (!found) return;
        TreeNode n = *found;        // as it was: the cards under it are walked from this copy, as in the Swift
        if (!n.head && !n.children.empty()) {
            for (int r : riders(id)) {
                if (TreeNode* rider = find(nodes, r)) rider->xy -= n.xy;
            }
            if (TreeNode* m = find(nodes, id)) m->head = true;
            if (TreeNode* m = find(nodes, id)) m->chip = false;
        }
        for (int c : n.children) group(c);
    };
    group(root);
    if (TreeNode* m = find(nodes, root)) m->head = true;
    int end = !route.empty() && find(nodes, route.back()) ? route.back() : root;
    route = path(end);
    if (!contains(route, stand)) stand = route.empty() ? root : route.back();
    current = stand;
    relayout();
}

/// A saved tree's steps, walked again: each is asked about where the
/// gardener brought it (or brought in by hand where it didn't).
std::shared_ptr<Tree> Tree::replay(const SavedSpec& spec, const std::shared_ptr<Catalog>& catalog) {
    std::vector<Ref> refs;
    for (const std::string& step : spec.steps) {
        if (std::optional<Ref> ref = Ref::make(step)) refs.push_back(*ref);
    }
    if (refs.empty()) return nullptr;
    std::shared_ptr<Tree> tree = std::make_shared<Tree>(refs.front(), spec.title, spec.maker, catalog);
    for (size_t i = 1; i < refs.size(); i++) {
        const Ref& ref = refs[i];
        std::optional<TreeNode> there = tree->node(ref);
        std::optional<int> id = there ? std::optional<int>(there->id) : tree->attach(ref);
        if (!id) continue;
        tree->focus(*id);
    }
    tree->maker = spec.maker;
    return tree;
}

// AGENT: see tree.h.
int Tree::graft(const Ref& ref, int parent, const std::string& why, Tone tone, bool kept, std::optional<float> imp) {
    if (!find(nodes, parent)) return -1;
    std::vector<int> slots = freeSlots(parent);
    if (slots.empty()) slots = freeSlots(parent, true);
    int slot = slots.empty() ? int(find(nodes, parent)->children.size()) : slots.front();
    int id = add(ref, parent, why, tone, false, slot);
    if (TreeNode* n = find(nodes, id)) {
        n->kept = kept;
        n->imp = imp;
    }
    relayout();
    return id;
}

void Tree::revise(int id, const std::string& why, bool kept, std::optional<float> imp) {
    TreeNode* n = find(nodes, id);
    if (!n) return;
    n->why = why;
    n->kept = kept;
    n->imp = imp;
}

bool Tree::open(int id) {
    if (!find(nodes, id)) return false;
    current = id;
    focused = true;
    relayout();
    return true;
}
