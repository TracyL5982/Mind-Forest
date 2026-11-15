// Port of visionos/MindPalace/Ocean/OceanModel.swift: `// MARK: - Pressing`,
// `// MARK: - The shelf of covers` and `// MARK: - The strip: what you can say and do`.
#include "oceanmodel.h"

#include <cmath>
#include <cstdio>

// MARK: - Pressing

/// What a tree's cover shows. The pictures are of the cards that matter
/// most: a step of the path before any other card, a later layer before
/// an earlier one, and then by how much the card matters. The first of
/// them is a little larger. Each floats on the side of the tree its
/// card stands on, about as high as its layer.
OceanModel::CoverPlan OceanModel::coverPlan(const Tree& tree) const {
    if (!catalog) return CoverPlan{};
    CoverPlan plan;
    int deepest = 0;
    for (const auto& [id, n] : tree.nodes) {
        if (n.head) deepest = std::max(deepest, tree.generation(n.id));
    }
    int layers = deepest + 1;
    // A cover's tree is taller for its width than the one at your hand, so that a tree of two layers is still a tree.
    float foot = layers == 1 ? 0.045f : 0.03f;
    float rise = std::min(0.055f, 0.17f / float(std::max(layers - 1, 1)));
    auto spot = [&](Vec2 p, int layer) -> Vec3 {
        Vec3 q = Hologram::spot(p, layer, layers);
        q.y = foot + float(layer) * rise;
        return q;
    };
    std::map<int, int> sizes;
    auto count = [&](auto&& count, int id) -> int {
        int n = 1;
        if (const TreeNode* node = find(tree, id)) {
            for (int child : node->children) n += count(count, child);
        }
        sizes[id] = n;
        return n;
    };
    float total = float(std::max(count(count, tree.root), 1));
    // (`tree.nodes.values.sorted(by: { $0.id < $1.id })`: the map is in that order.)
    for (const auto& [id, n] : tree.nodes) {
        if (!n.head) continue;
        int layer = tree.generation(n.id);
        auto size = sizes.find(n.id);
        Hologram::Node node{n.id, n.parent, true, layer, spot(lifted(tree, n.id), layer), tree.color(n.id)};
        node.weight = float(size != sizes.end() ? size->second : 1) / total;
        node.onPath = routeIndex(tree, n.id) >= 0;
        plan.nodes.push_back(node);
    }
    float height = (foot + float(layers - 1) * rise) * coverTree;
    float room = std::max(height, 0.36f);
    plan.foot = -0.56f * room + 0.012f;
    plan.top = plan.foot + 1.12f * room + 0.09f;

    // The picture a card would show here, if it has one.
    /// (The Swift's `(ref: Ref, aspect: Float)`.)
    struct Shown {
        Ref ref;
        float aspect;
    };
    auto picture = [&](const Ref& ref) -> std::optional<Shown> {
        switch (ref.kind) {
        case Ref::Kind::film: {
            int f = ref.index;
            return f >= 0 && f < int(catalog->clips.size()) ? std::optional<Shown>(Shown{ref, catalog->clips[f].aspect}) : std::nullopt;
        }
        case Ref::Kind::work: {
            int i = ref.index;
            return i >= 0 && i < int(catalog->works.size()) ? std::optional<Shown>(Shown{ref, catalog->works[i].aspect}) : std::nullopt;
        }
        case Ref::Kind::note: {
            auto note = catalog->notes.find(ref.id);
            if (note == catalog->notes.end()) return std::nullopt;
            std::optional<int> f = note->second.stillFilm();
            if (!(f && *f >= 0 && *f < int(catalog->clips.size()))) return std::nullopt;
            return Shown{Ref::film(*f), catalog->clips[*f].aspect};
        }
        case Ref::Kind::tag:
            return std::nullopt;
        }
        return std::nullopt;
    };
    struct Candidate {
        const TreeNode* node;
        Ref ref;
        float aspect;
        float score;
        float side;             // where its card stands: left of the trunk or right
        float up;               // and how high, 0…1
    };
    std::vector<Candidate> candidates;
    for (const auto& [id, n] : tree.nodes) {
        if (!(!n.chip && (n.head || n.kept))) continue;
        std::optional<Shown> shown = picture(n.ref);
        if (!shown) continue;
        int host = n.head ? n.id : n.parent.value_or(tree.root);
        int layer = tree.generation(host);
        float high = layers > 1 ? float(layer) / float(layers - 1) : 0.5f;
        float x = spot(lifted(tree, host), layer).x;
        if (!n.head) x += n.xy.x * tree.spread(host) * Hologram::glitter;
        float score = n.imp.value_or(0.5f) + (n.head && routeIndex(tree, n.id) >= 0 ? 0.5f : 0) + 0.4f * (layers > 1 ? high : 0);
        candidates.push_back(Candidate{&n, shown->ref, shown->aspect, score, x, high});
    }
    std::stable_sort(candidates.begin(), candidates.end(), [](const Candidate& a, const Candidate& b) {
        // (`($0.score, -$0.node.id) > ($1.score, -$1.node.id)`)
        if (a.score != b.score) return a.score > b.score;
        return -a.node->id > -b.node->id;
    });
    const std::array<Vec3, 5>& slots = coverSlots;
    std::vector<int> free;
    for (int i = 0; i < int(slots.size()); i++) free.push_back(i);
    std::vector<Ref> seen;
    for (const Candidate& c : candidates) {
        if (free.empty()) continue;
        if (std::find(seen.begin(), seen.end(), c.ref) != seen.end()) continue;
        seen.push_back(c.ref);
        // The free place nearest where its card stands.
        auto cost = [&](int i) -> float {
            Vec3 s = slots[i];
            return std::fabs(std::min(s.y, 1.f) - c.up) + (std::fabs(c.side) > 0.004f && (s.x < 0) != (c.side < 0) ? 0.6f : 0.f);
        };
        // (`free.min { (cost($0), $0) < (cost($1), $1) } ?? free[0]`)
        int k = free[0];
        for (int i : free) {
            float ci = cost(i), ck = cost(k);
            if (ci < ck || (ci == ck && i < k)) k = i;
        }
        free.erase(std::remove(free.begin(), free.end(), k), free.end());
        Vec3 slot = slots[k];
        float w = plan.thumbs.empty() ? 0.24f : 0.19f;
        Vec2 size;
        if (c.ref.kind == Ref::Kind::work) {
            size = Metrics::work(w * w * 0.6f, c.aspect, w * 1.15f, w * 1.05f);
        } else {
            size = Metrics::film(w, w * 0.72f, c.aspect);
        }
        plan.thumbs.push_back(CoverPlan::Thumb{c.node->id, c.ref, Vec3{slot.x, plan.foot + slot.y * room, slot.z}, size});
    }
    return plan;
}

/// Builds a tree's cover. `el` is how high it hangs, in degrees up
/// from eye level: the tree stands upright, as a tree does, and its
/// pictures and its name are tipped to face you. Returns the cover,
/// what on it is tipped, and the box it is picked by.
std::optional<OceanModel::Cover> OceanModel::makeCover(const Tree& tree, float el) {
    if (!art || !catalog) return std::nullopt;
    CoverPlan plan = coverPlan(tree);
    EntityRef holder = Entity::make();
    std::vector<EntityRef> tilts;
    if (lineMaterial) {
        if (EntityRef branches = Hologram::still(plan.nodes, 1.9f, *lineMaterial)) {
            branches->scale = Vec3::repeating(coverTree);
            branches->position = {0, plan.foot, 0};
            holder->addChild(branches);
        }
    }
    float wide = 0.24f;
    for (const CoverPlan::Thumb& thumb : plan.thumbs) {
        EntityRef e = Entity::make();
        switch (thumb.ref.kind) {
        case Ref::Kind::film:
            if (MeshRef mesh = art->stillMesh(catalog->clips[thumb.ref.index], thumb.size)) e->model = ModelComponent{mesh, {art->atlasMaterial()}};
            break;
        case Ref::Kind::work:
            if (MeshRef mesh = art->workMesh(catalog->works[thumb.ref.index], thumb.size)) {
                if (std::optional<Material> m = art->workAtlasMaterial()) e->model = ModelComponent{mesh, {*m}};
            }
            break;
        default:
            break;
        }
        if (!e->model) continue;
        if (EntityRef glow = art->glow(thumb.size)) {
            glow->position.z = -0.003f;
            e->addChild(glow);
        }
        e->position = thumb.at;
        holder->addChild(e);
        tilts.push_back(e);
        wide = std::max(wide, std::fabs(thumb.at.x) + thumb.size.x / 2);
    }
    float low = plan.foot;
    if (std::optional<Piece> piece = art->coverCaption(tree.title, tree.maker, tree.sent)) {
        EntityRef caption = art->quad(*piece);
        caption->position = {0, plan.foot - 0.04f - piece->size.y / 2, 0.03f};
        holder->addChild(caption);
        tilts.push_back(caption);
        wide = std::max(wide, piece->size.x / 2);
        low = plan.foot - 0.04f - piece->size.y;
    }
    tip(tilts, el);
    return Cover{holder, tilts, Cover::Box{Vec3{0, (plan.top + low) / 2, 0}, Vec3{2 * wide, plan.top - low, 0.16f}}};
}

/// Tips a cover's pictures and its name toward eyes `el` degrees below them.
void OceanModel::tip(const std::vector<EntityRef>& entities, float el) {
    Quat q = Quat::angleAxis(el * floatPi / 180, {1, 0, 0});
    for (const EntityRef& e : entities) e->orientation = q;
}

/// The clap: the tree flattens into one card, which leaves for the tray
/// (sent on to the next stage) or for the shelf (put away).
void OceanModel::pressTree(bool send) {
    if (!this->tree || pressing) return;
    // (The Swift's `guard let tree`: the tree is held here, and by what is put off below, after the model lets it go.)
    TreeRef tree = this->tree;
    pressing = true;
    marking = std::nullopt;
    clearPeek();
    screen->hide();
    screenNode = std::nullopt;
    stir();
    // Every voice of the tree draws in to one note; then the card it has become leaves.
    bool quiet = quietPress;
    sound("press", quiet ? 0.45f : 1);
    double now = time;
    if (send) tree->sent = true;
    // The cards whose pictures the cover shows go to where those float; the rest give way.
    CoverPlan plan = coverPlan(*tree);
    std::vector<int> ids;
    for (const CoverPlan::Thumb& thumb : plan.thumbs) ids.push_back(thumb.id);
    Vec2 f = pan.target();
    float level = focusLevel.target();
    for (size_t k = 0; k < plan.thumbs.size(); k++) {
        const CoverPlan::Thumb& thumb = plan.thumbs[k];
        const CardRef& c = card(thumb.id);
        if (!c) continue;
        if (!c->built) buildSmall(*c);
        c->xy.go(f + Vec2{thumb.at.x, thumb.at.y}, now, Pace::press, Ease::inOut);
        c->pb.go(1, now, Pace::press, Ease::inOut);
        c->nudge.go(Vec2::zero(), now, Pace::press, Ease::inOut);
        // All on one sheet, a hair apart.
        c->plane.go(level + float(k) * 0.002f, now, Pace::press, Ease::inOut);
        c->scale.go(thumb.size.x / c->smallBody.x, now, Pace::press, Ease::inOut);
        c->openMix.go(0, now, Pace::press * 0.7f, Ease::out);
        c->alpha.go(1, now, 0.1f);
        c->root->inputTarget = false;
        if (c->badge) c->badge->isEnabled = false;
    }
    for (const auto& [id, c] : cards) {
        if (std::find(ids.begin(), ids.end(), c->id) == ids.end()) c->alpha.go(0, now, 0.12f);
    }
    panStand = std::nullopt;
    touch(now + double(Pace::press) + 1.4);
    rebuildStrip();

    Stage::Page front = stage.page(0);
    Vec3 at = front.center + front.normal * 0.02f;
    std::optional<Vec2> spot = standingSpot;
    standingSpot = std::nullopt;
    after(double(Pace::press) - 0.04, [this, tree, front, at, spot, send, quiet] {
        if (!quiet) sound(send ? "send" : "put_away", 1, 0.2);
        // The live cards give way to the one card they've become.
        std::map<int, CardRef> old = std::move(cards);
        cards.clear();
        buildQueue.clear();
        marks.clear();
        for (const auto& [id, c] : old) {
            for (const Entity* e : c->extras) picks.erase(e);
            c->alpha.go(0, time, 0.1f);
            c->goneAt = time + 0.11;
            c->home = std::nullopt;
            leaving.push_back(c);
        }
        if (shell) {
            for (const auto& [id, n] : tree->nodes) {
                if (std::optional<int> p = catalog ? catalog->piece(n.ref) : std::nullopt) shell->setOut(*p, false);
            }
        }
        this->tree = nullptr;
        pressing = false;
        std::optional<Cover> made = makeCover(*tree, 0);
        if (!made) {
            rebuildStrip();
            return;
        }
        EntityRef holder = made->entity;
        holder->orientation = front.orientation;
        root_->addChild(holder);
        MoverRef m = std::make_shared<Mover>(holder, at, 1);
        m->alpha.set(0);
        m->alpha.go(1, time, 0.1f);
        movers.push_back(m);
        if (send) {
            // To the tray, then a copy takes its place on the shelf, marked sent.
            Vec3 slot = trayPoint() + stage.u * (0.004f + 0.006f * float(trayCount));
            trayCount += 1;
            m->position.go(slot, time, 0.16, 0.4f, Ease::inOut);
            m->scale.go(0.2f, time, 0.16, 0.4f, Ease::inOut);
            after(0.6, [this, holder, tree, slot, spot] {
                holder->orientation = stage.facing(slot);
                shelve(tree, slot, nullptr, spot);
            });
            logLine("[ocean] sent: " + tree->title);
        } else {
            m->removeAt = time + 0.16 + 0.42;
            m->alpha.go(0, time, 0.5, 0.08f, Ease::out);
            shelve(tree, at, m, spot);
            logLine("[ocean] put away: " + tree->title);
        }
        rebuildStrip();
    });
}

// MARK: - The shelf of covers

/// The first usual place with no cover near it.
Vec2 OceanModel::freeSpot() const {
    for (Vec2 s : shelfSpots) {
        bool taken = false;
        for (const Shelved& cover : shelf) {
            if (distance(cover.spot, s) < 14) taken = true;
        }
        if (!taken) return s;
    }
    return Vec2{float(int(shelf.size()) % 5) * 20 - 40, 44};
}

/// Hangs a pressed tree's cover on the shelf, above the tree. It stays
/// where it was last put. `hand` is the card already in flight, which
/// this one meets.
void OceanModel::shelve(const TreeRef& tree, std::optional<Vec3> from, const MoverRef& hand, std::optional<Vec2> known) {
    Vec2 spot = known ? *known : freeSpot();
    std::optional<Cover> made = makeCover(*tree, spot.y);
    if (!made) return;
    Vec3 p = shelfPoint(spot);
    EntityRef holder = made->entity;
    holder->orientation = stage.upright(p).orientation;
    holder->collision = {Shape::generateBox(made->box.size).offsetBy(made->box.center)};
    holder->inputTarget = true;
    holder->hover = Art::hover();
    root_->addChild(holder);
    int uid = nextUID;
    nextUID += 1;
    picks[holder.get()] = Pick::shelf(uid);
    float rest = coverRest;
    MoverRef m = std::make_shared<Mover>(holder, from ? *from : p, !from ? rest : (!hand ? 0.2f : 1.f));
    if (from) {
        double delay = !hand ? 0.0 : 0.16;
        m->position.go(p, time, delay, 0.42f, Ease::inOut);
        m->scale.go(rest, time, delay, 0.42f, Ease::inOut);
        if (hand) {
            m->alpha.set(0);
            m->alpha.go(1, time, 0.5, 0.08f, Ease::out);
            hand->position.go(p, time, delay, 0.42f, Ease::inOut);
            hand->scale.go(rest, time, delay, 0.42f, Ease::inOut);
        }
        touch(time + delay + 0.6);
    }
    movers.push_back(m);
    shelf.push_back(Shelved{uid, tree, m, made->tilts, spot});
    if (shelfLoaded) shelfDirty = true;
}

/// A cover carried by hand: it follows, at arm's length, around you.
std::optional<Vec2> OceanModel::carry(int uid, Vec3 d) {
    auto s = std::find_if(shelf.begin(), shelf.end(), [&](const Shelved& cover) { return cover.uid == uid; });
    if (s == shelf.end()) return std::nullopt;
    // A hand moves a little; the cover, far off, moves by the same angle.
    float arm = 0.55f;
    float az = s->spot.x + std::atan2(dot(d, stage.r), arm) * 180 / floatPi;
    float el = s->spot.y + std::atan2(dot(d, stage.u), arm) * 180 / floatPi;
    Vec2 spot{std::min(100.f, std::max(-100.f, az)), std::min(52.f, std::max(14.f, el))};
    Vec3 p = shelfPoint(spot);
    s->mover->position.set(p);
    s->mover->entity->orientation = stage.upright(p).orientation;
    tip(s->tilts, spot.y);
    touch(time + 0.2);
    return spot;
}

void OceanModel::unfold(int uid) {
    auto i = std::find_if(shelf.begin(), shelf.end(), [&](const Shelved& cover) { return cover.uid == uid; });
    if (i == shelf.end() || pressing) return;
    Shelved s = *i;
    shelf.erase(i);
    picks.erase(s.mover->entity.get());
    s.mover->entity->inputTarget = false;
    clearPeek();
    whenClear([this, s] {
        // The cover comes forward and opens into its tree.
        Stage::Page front = stage.page(0);
        Vec3 to = front.center - front.normal * 0.4f;
        s.mover->position.go(to, time, 0.3f, Ease::out);
        s.mover->scale.go(1, time, 0.3f, Ease::out);
        s.mover->alpha.go(0, time, 0.12, 0.18f, Ease::out);
        s.mover->removeAt = time + 0.32;
        touch(time + 0.4);
        after(0.1, [this, s] {
            standingSpot = s.spot;
            stand(s.tree);
        });
    });
}

// The shelf as it is kept between runs: every cover's tree and where it hangs.
// (Codable in the Swift. The keys are the property names; `spot` is an array of two, and `works`
// is left out when there is none.)
std::optional<OceanModel::ShelfFile::Item> OceanModel::ShelfFile::Item::from(const Json& j) {
    Item item;
    if (!j.isObject() || !decode::value(j["tree"], item.tree) || !decode::vec2(j["spot"], item.spot)) return std::nullopt;
    return item;
}

Json OceanModel::ShelfFile::Item::json() const {
    Json j = Json::object();
    j.set("tree", tree.json());
    j.set("spot", Json::list({Json(spot.x), Json(spot.y)}));
    return j;
}

std::optional<OceanModel::ShelfFile> OceanModel::ShelfFile::from(const Json& j) {
    ShelfFile file;
    if (!j.isObject() || !decode::integer(j["version"], file.version) || !decode::integer(j["films"], file.films)) return std::nullopt;
    file.works = j["works"].optionalString();       // anything else there: read as none
    if (!decode::list(j["trees"], file.trees)) return std::nullopt;
    return file;
}

Json OceanModel::ShelfFile::json() const {
    Json j = Json::object();
    j.set("version", version);
    j.set("films", films);
    if (works) j.set("works", *works);
    Json list = Json::list();
    for (const Item& item : trees) list.push(item.json());
    j.set("trees", list);
    return j;
}

std::string OceanModel::shelfURL() {
    // NOTE(port): Application Support is platform::dataDirectory(), a folder the host has already made.
    std::string folder = platform::dataDirectory();
    if (folder.empty()) return "";
    return folder + "/ocean-shelf.json";
}

/// The covers from last time, each where it was left; the first time
/// (or with `-freshShelf`), the two trees ocean.json starts with.
void OceanModel::loadShelf(const std::shared_ptr<Catalog>& catalog) {
    // (`defer { shelfLoaded = true }`)
    struct Done {
        bool& flag;
        ~Done() { flag = true; }
    } done{shelfLoaded};
    std::string url = shelfURL();
    if (Flags::has("freshShelf") && !url.empty()) std::remove(url.c_str());
    std::optional<std::string> data = url.empty() ? std::nullopt : platform::readFile(url);
    std::optional<Json> json = data ? Json::parse(*data) : std::nullopt;
    std::optional<ShelfFile> file = json ? ShelfFile::from(*json) : std::nullopt;
    if (file && file->version == 3 && file->films == int(catalog->clips.size())) {
        // A work is kept by its place in the library, which changes when the works are chosen
        // again: a tree that holds works from another choice of them can't stand, the rest can.
        bool sameWorks = file->works == catalog->worksKey;
        int dropped = 0;
        for (const ShelfFile::Item& item : file->trees) {
            bool holdsWorks = false;
            for (const TreeNode& n : item.tree.nodes) {
                if (n.ref.kind == Ref::Kind::work) holdsWorks = true;
            }
            if (holdsWorks && !sameWorks) {
                dropped += 1;
            } else {
                // NOTE(port): the Swift makes each tree and hangs its cover here, before the first frame.
                // Here they wait, and `shelveWaiting` hangs one a frame, the newest first.
                shelfWaiting.push_back(item);
            }
        }
        if (dropped > 0) logLine(fmt("[ocean] shelf: %d covers held works the library has since changed, and were let go", dropped));
        logLine(fmt("[ocean] shelf: %d covers kept from last time", int(shelfWaiting.size())));
        return;
    }
    for (const SavedSpec& spec : catalog->saved) {
        if (TreeRef t = Tree::replay(spec, catalog)) shelve(t, std::nullopt);
    }
}

/// Hangs one more of the saved trees read at launch: the most lately saved of those still waiting.
void OceanModel::shelveWaiting() {
    if (shelfWaiting.empty() || !catalog || !built) return;
    ShelfFile::Item item = std::move(shelfWaiting.back());
    shelfWaiting.pop_back();
    size_t before = shelf.size();
    bool loaded = shelfLoaded;
    shelfLoaded = false;        // hanging what was read is not a change to write back
    if (TreeRef t = Tree::make(item.tree, catalog)) shelve(t, std::nullopt, nullptr, item.spot);
    shelfLoaded = loaded;
    // It is older than every one hung before it this way: it goes in front of them, so the shelf keeps the file's order.
    if (shelf.size() > before) std::rotate(shelf.begin(), shelf.end() - 1, shelf.end());
    touch(time + 0.2);
}

/// Writes the shelf down. A tree taken off the shelf and still standing is kept at the place it left.
void OceanModel::saveShelf() {
    shelfDirty = false;
    std::string url = shelfURL();
    if (url.empty() || !catalog) return;
    std::vector<ShelfFile::Item> items = shelfWaiting;     // (none, by the time anything is written: see `update`)
    for (const Shelved& cover : shelf) items.push_back(ShelfFile::Item{cover.tree->saved(), cover.spot});
    if (tree && standingSpot) items.push_back(ShelfFile::Item{tree->saved(), *standingSpot});
    std::string data = ShelfFile(int(catalog->clips.size()), catalog->worksKey, items).json().dump();
    platform::writeFile(url, data);
}

// MARK: - The strip: what you can say and do

/// With no tree standing: the gardener's briefs, under where a tree
/// would be. With one: its name and what can be done with the whole of
/// it, low and near, at hand, in front of anything the tree puts
/// there. (What can be done with one card stands under that card.)
/// Rebuilt only when what it says changes, and then one fades as the
/// other comes.
void OceanModel::rebuildStrip() {
    if (!art || !catalog) return;
    if ((!tree || pressing) && hologram && hologram->entity->isEnabled) hologram->entity->isEnabled = false;
    if (tree && !pressing) refreshHologram(*tree);
    std::string key = pressing ? "pressing" : (tree ? tree->title + "|" + label(tree->maker) : "briefs");
    if (key == stripKey) return;
    stripKey = key;
    for (const Entity* id : stripPicks) picks.erase(id);
    stripPicks.clear();
    for (const EntityRef& child : strip->children) child->inputTarget = false;
    if (strip->parent != nullptr) fadeOut(strip, 0.18f);
    EntityRef holder = Entity::make();
    strip = holder;
    root_->addChild(holder);
    auto add = [&](const std::optional<Piece>& piece, float x, float y, const std::optional<Pick>& pick) -> float {
        if (!piece) return 0;
        EntityRef e = art->quad(*piece);
        e->position = {x + piece->size.x / 2, y, 0};
        if (pick) {
            e->collision = {Shape::generateBox({piece->size.x, piece->size.y + 0.008f, 0.01f})};
            e->inputTarget = true;
            e->hover = Art::hover();
            picks[e.get()] = *pick;
            stripPicks.push_back(e.get());
        }
        holder->addChild(e);
        return piece->size.x;
    };
    if (!tree || pressing) {
        if (tree) return;
        holder->position = stage.point(0, -19, 1.25f);
        holder->orientation = stage.facing(holder->position);
        // One left edge for the heading and every brief under it.
        std::vector<std::optional<Piece>> briefs;
        for (const Brief& b : catalog->briefs) briefs.push_back(art->brief("“" + b.line + "”"));
        std::optional<float> widest;
        for (const std::optional<Piece>& piece : briefs) {
            if (piece) widest = widest ? std::max(*widest, piece->size.x) : piece->size.x;
        }
        float left = -widest.value_or(0.3f) / 2;
        add(art->heading("Ask the gardener", Tone::question), left, 0.078f, std::nullopt);
        for (size_t i = 0; i < briefs.size(); i++) add(briefs[i], left, 0.032f - float(i) * 0.052f, Pick::brief(int(i)));
        fadeIn(holder, 0.1, 0.3f);
        return;
    }
    holder->position = stage.point(29, -27, 1.02f);
    holder->orientation = stage.facing(holder->position);
    float left = -0.16f;
    add(art->line(tree->title + " · " + label(tree->maker), Art::Size::label, Font::Weight::medium, Color::white(1, 0.8f)), left, 0.024f, std::nullopt);
    float x = left;
    // (`pad:` follows `fg:` and `bg:`, which these two leave as they are: they are written out.)
    x += add(art->line("Put away", Art::Size::label, Font::Weight::medium, Color::white(), Art::ink, Art::buttonPad), x, -0.018f, Pick::putAway()) + 0.01f;
    // (On the Quest a button is to press the tree as surely as the clap does. This one already
    // does: a pinch on it is `pressTree(send: true)`, the very call the clap makes in `handle`.
    // So nothing is added to the strip.)
    add(art->line("Send to image generation", Art::Size::label, Font::Weight::semibold, Color::white(), Art::hot, Art::buttonPad), x, -0.018f, Pick::send());
    fadeIn(holder, 0.15, 0.3f);
}
