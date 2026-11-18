// Port of visionos/MindPalace/Ocean/OceanModel.swift: `// MARK: - Pressing`,
// `// MARK: - The shelf of covers` and `// MARK: - The strip: what you can say and do`.
#include "oceanmodel.h"

#include "../agent/bridge.h"
#include "../cards/cards.h"
#include "../cards/paint.h"

#include <cmath>
#include <cstdio>

// MARK: - Pressing

/// What a tree's cover shows. The pictures are of the cards that matter
/// most: a step of the path before any other card, a later layer before
/// an earlier one, and then by how much the card matters. The first of
/// them is a little larger. Each floats on the side of the tree its
/// card stands on, about as high as its layer.
OceanModel::CoverPlan OceanModel::coverPlan(const Tree& tree, const std::vector<Ref>& without, const std::vector<Ref>* only) const {
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
    plan.layers = layers;
    plan.treeFoot = foot;
    plan.treeRise = rise;
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
            if (f && *f >= 0 && *f < int(catalog->clips.size())) return Shown{Ref::film(*f), catalog->clips[*f].aspect};
            // AGENT: a card of the service's shows its own picture, which the service holds (`coverFace`): at its shape
            // once it has come, else at an image's usual shape, and cut to fill that when it comes.
            if (std::optional<std::string> src = coverSource(ref.id)) {
                std::optional<cards::Picture> had = cards::pictureAt(*src);
                bool known = had && had->image && had->image->height > 0;
                return Shown{ref, known ? float(had->image->width) / float(had->image->height) : 1.35f};
            }
            return std::nullopt;
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
        // AGENT: on a tree the service grows, any card: it keeps what the user keeps, and most of a tree is what it brought.
        if (!(!n.chip && (n.head || n.kept || !tree.grows))) continue;
        std::optional<Shown> shown = picture(n.ref);
        if (!shown || std::find(without.begin(), without.end(), shown->ref) != without.end()) continue;
        if (only && std::find(only->begin(), only->end(), shown->ref) == only->end()) continue;
        int host = n.head ? n.id : n.parent.value_or(tree.root);
        int layer = tree.generation(host);
        float high = layers > 1 ? float(layer) / float(layers - 1) : 0.5f;
        float x = spot(lifted(tree, host), layer).x;
        if (!n.head) x += n.xy.x * tree.spread(host) * Hologram::glitter;
        float score = n.imp.value_or(0.5f) + (n.head && routeIndex(tree, n.id) >= 0 ? 0.5f : 0) + 0.4f * (layers > 1 ? high : 0);
        if (!tree.grows && n.kept) score += 0.25f;        // AGENT: what the user kept before what was only brought
        candidates.push_back(Candidate{&n, shown->ref, shown->aspect, score, x, high});
    }
    std::stable_sort(candidates.begin(), candidates.end(), [](const Candidate& a, const Candidate& b) {
        // (`($0.score, -$0.node.id) > ($1.score, -$1.node.id)`)
        if (a.score != b.score) return a.score > b.score;
        return -a.node->id > -b.node->id;
    });
    const auto& slots = coverSlots;
    std::vector<int> free;
    for (int i = 0; i < int(slots.size()); i++) free.push_back(i);
    std::vector<Ref> seen;
    for (const Candidate& c : candidates) {
        if (std::find(seen.begin(), seen.end(), c.ref) == seen.end()) {
            plan.choices++;
            plan.ranked.push_back(c.ref);
        }
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
        if (plan.thumbs.size() >= usualPictures) w = 0.15f;         // NOTE(port): the three added for Quest are smaller
        Vec2 size;
        if (c.ref.kind == Ref::Kind::work || c.ref.kind == Ref::Kind::note) {       // (a service card's picture, sized as a work)
            size = Metrics::work(w * w * 0.6f, c.aspect, w * 1.15f, w * 1.05f);
        } else {
            size = Metrics::film(w, w * 0.72f, c.aspect);
        }
        plan.thumbs.push_back(CoverPlan::Thumb{c.node->id, c.ref, Vec3{slot.x, plan.foot + slot.y * room, slot.z}, size});
    }
    plan.picks = int(plan.thumbs.size());
    return plan;
}

// AGENT: added for the service's cards, whose pictures the service holds and the headset fetches (agent::Bridge::fetchPictures).

std::optional<std::string> OceanModel::coverSource(const std::string& noteID) const {
    if (noteID.rfind("agent-", 0) != 0) return std::nullopt;
    for (const std::string& src : cards::pictures(noteID)) {
        // (A drawn stand-in, `sample:`, is no picture of the card's own.)
        if (src.rfind("sample:", 0) == 0) continue;
        std::optional<cards::Picture> had = cards::pictureAt(src);
        if (!(had && had->missing)) return src;
    }
    return std::nullopt;
}

EntityRef OceanModel::coverFace(const std::string& noteID, Vec2 size) {
    std::optional<std::string> src = coverSource(noteID);
    std::optional<cards::Picture> had = src ? cards::pictureAt(*src) : std::nullopt;
    if (!art || !had || !had->image || had->image->width <= 0 || had->image->height <= 0) return nullptr;
    ImageRef image = had->image;
    float w = size.x * Art::ppm, h = size.y * Art::ppm;
    std::string key = fmt("cover-%s-%.0fx%.0f", src->c_str(), double(w), double(h));
    // Cut to fill: as wide as the place, or as tall, whichever leaves none of it bare.
    std::optional<Piece> piece = art->piece(key, w, h, [image](Canvas& ctx, CGSize box) {
        float fit = std::max(box.width / float(image->width), box.height / float(image->height));
        float iw = float(image->width) * fit, ih = float(image->height) * fit;
        ctx.drawImage(image, CGRect((box.width - iw) / 2, (box.height - ih) / 2, iw, ih));
    });
    return piece ? art->quad(*piece) : nullptr;
}

void OceanModel::coverPicturesCame() { tendCovers(); }

std::optional<OceanModel::CoverPicture> OceanModel::coverPicture(const CoverPlan::Thumb& thumb) {
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
    // AGENT: a service card's own picture, once it has come; until then nothing is drawn for it (`shownPlan`).
    if (thumb.ref.kind == Ref::Kind::note) {
        EntityRef face = coverFace(thumb.ref.id, thumb.size);
        if (!face) return std::nullopt;
        e->addChild(face);
    } else if (!e->model) {
        return std::nullopt;
    }
    if (EntityRef glow = art->glow(thumb.size)) {
        glow->position.z = -0.003f;
        e->addChild(glow);
    }
    e->position = thumb.at;
    return CoverPicture{thumb.id, thumb.ref, e, thumb.size.x, thumb.at, thumb.size.y};
}

bool OceanModel::onHand(const Ref& ref) const {
    if (ref.kind != Ref::Kind::note) return true;
    std::optional<std::string> src = coverSource(ref.id);
    std::optional<cards::Picture> had = src ? cards::pictureAt(*src) : std::nullopt;
    return had && had->image;
}

OceanModel::CoverPlan OceanModel::shownPlan(const Tree& tree) const {
    CoverPlan plan = coverPlan(tree);
    if (tree.grows) return plan;
    std::vector<Ref> here;
    for (const CoverPlan::Thumb& t : plan.thumbs) {
        if (onHand(t.ref)) here.push_back(t.ref);
    }
    if (here.size() == plan.thumbs.size()) return plan;
    // What has come so far, placed as a cover of that many would place them, each the size it will be.
    CoverPlan shown = coverPlan(tree, {}, &here);
    for (CoverPlan::Thumb& t : shown.thumbs) {
        auto full = std::find_if(plan.thumbs.begin(), plan.thumbs.end(), [&](const CoverPlan::Thumb& f) { return f.id == t.id && f.ref == t.ref; });
        if (full != plan.thumbs.end()) t.size = full->size;
    }
    shown.choices = plan.choices;
    shown.ranked = plan.ranked;
    shown.picks = plan.picks;
    return shown;
}

Vec3 OceanModel::placeOf(const CoverPicture& p) const {
    if (p.moveStart < 0) return p.at;
    float u = std::min(1.f, std::max(0.f, float(time - p.moveStart) / coverEase));
    return p.from + (p.at - p.from) * Ease::glide(u);
}

void OceanModel::tendCovers() {
    for (Shelved& s : shelf) {
        if (!s.tree || s.tree->grows) continue;      // (Kai's trees show films and works, which never wait)
        CoverPlan plan = shownPlan(*s.tree);
        bool same = plan.thumbs.size() == s.pictures.size();
        for (size_t k = 0; same && k < plan.thumbs.size(); k++) {
            const CoverPicture& p = s.pictures[k];
            const CoverPlan::Thumb& t = plan.thumbs[k];
            same = p.id == t.id && p.ref == t.ref && distance(p.at, t.at) < 1e-4f && std::fabs(p.width - t.size.x) < 1e-4f;
        }
        if (!same) relayout(s, plan);
    }
}

void OceanModel::relayout(Shelved& s, const CoverPlan& plan) {
    EntityRef holder = s.mover->entity;
    // A picture already there eases to its new place; one that has come fades in at its own; one no longer picked goes.
    std::vector<CoverPicture> pictures;
    std::vector<EntityRef> made;
    for (const CoverPlan::Thumb& thumb : plan.thumbs) {
        auto old = std::find_if(s.pictures.begin(), s.pictures.end(), [&](const CoverPicture& p) {
            return p.id == thumb.id && p.ref == thumb.ref && std::fabs(p.width - thumb.size.x) < 1e-4f;
        });
        if (old != s.pictures.end()) {
            CoverPicture p = *old;
            s.pictures.erase(old);
            if (distance(p.at, thumb.at) > 1e-4f) {
                p.from = placeOf(p);
                p.at = thumb.at;
                p.moveStart = time;
            }
            pictures.push_back(p);
            continue;
        }
        std::optional<CoverPicture> picture = coverPicture(thumb);
        if (!picture) continue;
        holder->addChild(picture->entity);
        made.push_back(picture->entity);
        pictures.push_back(*picture);
    }
    for (const CoverPicture& gone : s.pictures) {
        s.tilts.erase(std::remove(s.tilts.begin(), s.tilts.end(), gone.entity), s.tilts.end());
        fadeOut(gone.entity, 0.25f);
    }
    tip(made, s.el.value(time));
    for (const EntityRef& e : made) {
        s.tilts.push_back(e);
        e->opacity = 0.f;
    }
    s.pictures = pictures;
    layPictures(s.pictures, s.huddle.value(time));
    // On the ocean's floor only the first five show.
    for (size_t k = 0; k < s.pictures.size(); k++) {
        bool shows = !forestDown || k < usualPictures;
        bool fresh = std::find(made.begin(), made.end(), s.pictures[k].entity) != made.end();
        bool showing = !(s.pictures[k].entity->opacity && *s.pictures[k].entity->opacity < 0.5f);
        if (fresh || shows != showing) fadeTo(s.pictures[k].entity, shows ? 1.f : 0.f, 0.0, 0.3f);
    }
    holder->collision = coverCollision(s.trunk, s.pictures, s.caption != nullptr, s.nameSize, s.foot);
    if (int(s.pictures.size()) >= plan.picks) {
        logLine(fmt("[ocean] cover of %s: its %d pictures all shown", s.tree->title.c_str(), int(s.pictures.size())));
    } else {
        logLine(fmt("[ocean] cover of %s: now showing %d of its %d pictures", s.tree->title.c_str(), int(s.pictures.size()), plan.picks));
    }
    touch(time + double(coverEase) + 0.1);
}

/// Builds a tree's cover. `el` is how high it hangs, in degrees up
/// from eye level: the tree stands upright, as a tree does, and its
/// pictures and its name are tipped to face you. Returns the cover,
/// what on it is tipped, and the box it is picked by.
std::optional<OceanModel::Cover> OceanModel::makeCover(const Tree& tree, float el, bool planted) {
    if (!art || !catalog) return std::nullopt;
    CoverPlan plan = shownPlan(tree);       // AGENT: what has come so far, on a service tree
    EntityRef holder = Entity::make();
    std::vector<EntityRef> tilts;
    EntityRef tree3d, name;                     // NOTE(port): kept for Quest, with `pictures` (see `Cover`)
    std::vector<Shape> shapes;
    Vec2 nameSize = Vec2::zero();
    {
        // The trunk, to as high as its last layer.
        float high = (plan.treeFoot + float(plan.layers - 1) * plan.treeRise) * coverTree + 0.04f;
        shapes.push_back(Shape::generateBox({0.16f, high, 0.16f}).offsetBy(Vec3{0, plan.foot + high / 2, 0}));
    }
    std::vector<CoverPicture> pictures;
    if (lineMaterial) {
        if (EntityRef branches = Hologram::still(plan.nodes, 1.9f, *lineMaterial)) {
            branches->scale = Vec3::repeating(coverTree);
            branches->position = {0, plan.foot, 0};
            holder->addChild(branches);
            tree3d = branches;
        }
    }
    float wide = 0.24f;
    for (const CoverPlan::Thumb& thumb : plan.thumbs) {
        std::optional<CoverPicture> made = coverPicture(thumb);
        if (!made) continue;
        holder->addChild(made->entity);
        tilts.push_back(made->entity);
        pictures.push_back(*made);
        wide = std::max(wide, std::fabs(thumb.at.x) + thumb.size.x / 2);
    }
    float low = plan.foot;
    if (std::optional<Piece> piece = art->coverCaption(tree.title, tree.maker, tree.sent)) {
        EntityRef caption = art->quad(*piece);
        caption->position = {0, plan.foot - 0.04f - piece->size.y / 2, 0.03f};
        // NOTE(port): added for Quest. A tree that stands on the desk has its name in front of its foot,
        // as a plant has its label, and nothing under the desk's top.
        if (planted) caption->position = {0, plan.foot + piece->size.y / 2 + 0.01f, 0.1f};
        holder->addChild(caption);
        tilts.push_back(caption);
        name = caption;
        nameSize = piece->size;
        wide = std::max(wide, piece->size.x / 2);
        low = planted ? plan.foot : plan.foot - 0.04f - piece->size.y;
    }
    tip(tilts, el);
    Cover cover{holder, tilts, Cover::Box{Vec3{0, (plan.top + low) / 2, 0}, Vec3{2 * wide, plan.top - low, planted ? 0.3f : 0.16f}}, plan.foot};
    cover.shapes = shapes;
    cover.nameSize = nameSize;
    if (planted && lineMaterial) {
        // Each tree's ground is raked its own way, the same way every time.
        uint32_t seed = uint32_t(std::hash<std::string>()(tree.title)) ^ uint32_t(tree.nodes.size() * 131);
        if (std::shared_ptr<Gravel> gravel = Gravel::make(*lineMaterial, seed)) {
            gravel->entity->position = {0, plan.foot + 0.004f, 0};
            holder->addChild(gravel->entity);
            cover.gravel = gravel;
        }
    }
    cover.branches = tree3d;
    cover.caption = name;
    cover.pictures = pictures;
    cover.choices = plan.choices;
    cover.picks = plan.picks;
    cover.layers = plan.layers;
    cover.treeFoot = plan.treeFoot;
    cover.treeRise = plan.treeRise;
    return cover;
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
    guideDid("press");
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
    CoverPlan plan = shownPlan(*tree);
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
    std::optional<Vec2> plot = standingPlot;       // NOTE(port): added for Quest: its place on the desk goes with it
    standingPlot = std::nullopt;
    after(double(Pace::press) - 0.04, [this, tree, front, at, spot, plot, send, quiet] {
        if (!quiet) sound(send ? "send" : "put_away", 1, 0.2);
        // The live cards give way to the one card they've become.
        std::map<int, CardRef> old = std::move(cards);
        cards.clear();
        buildQueue.clear();
        marks.clear();
        inks.clear();
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
            after(0.6, [this, holder, tree, slot, spot, plot] {
                holder->orientation = deskFacing(slot);
                shelve(tree, slot, nullptr, spot, plot);
            });
            logLine("[ocean] sent: " + tree->title);
        } else {
            // NOTE(port): changed for Quest: the Swift's flight to the shelf takes 0.42 s (`removeAt` 0.16 + 0.42,
            // gone from 0.5). Down to the desk it shrinks to a quarter on the way, which wants the long settle (see `shelve`).
            m->removeAt = time + 0.16 + 0.8;
            m->alpha.go(0, time, 0.16 + 0.58, 0.08f, Ease::out);
            shelve(tree, at, m, spot, plot);
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
        // AGENT: an agent service's tree can come while a tree taken off the shelf stands: the place it goes back to is kept.
        if (standingSpot && distance(*standingSpot, s) < 14) taken = true;
        if (!taken) return s;
    }
    return Vec2{float(int(shelf.size()) % 5) * 20 - 40, 44};
}

std::vector<Shape> OceanModel::coverCollision(const std::vector<Shape>& trunk, const std::vector<CoverPicture>& pictures, bool caption,
                                              Vec2 nameSize, float foot) const {
    std::vector<Shape> shapes = trunk;
    for (const CoverPicture& picture : pictures) {
        Vec3 at{picture.at.x * huddleUp, picture.at.y, picture.at.z};
        shapes.push_back(Shape::generateBox({picture.width * huddleUp, picture.height * huddleUp, 0.06f}).offsetBy(at));
    }
    if (caption) {
        Vec2 plate = nameSize * huddleUp;
        shapes.push_back(Shape::generateBox({plate.x, plate.y, 0.04f}).offsetBy(Vec3{0, foot + plate.y / 2 + 0.01f, 0.03f + 0.07f * huddleUp}));
    }
    return shapes;
}

/// Hangs a pressed tree's cover on the shelf, above the tree. It stays
/// where it was last put. `hand` is the card already in flight, which
/// this one meets.
void OceanModel::shelve(const TreeRef& tree, std::optional<Vec3> from, const MoverRef& hand, std::optional<Vec2> known, std::optional<Vec2> stood) {
    // AGENT: one to let go is put away to nothing: what it was pressed into fades where it is (`letGo`).
    if (tree && lettingGo.erase(tree.get())) {
        logLine("[ocean] put away and let go: " + tree->title);
        return;
    }
    // NOTE(port): added for Quest. There is only ever one welcome tree among the kept ones: the walk taken
    // again (by the next person, or from the gesture sheet) replaces the one put away before.
    if (tree && tree->walk()) {
        for (auto i = shelf.begin(); i != shelf.end();) {
            if (i->tree && i->tree->walk()) {
                picks.erase(i->mover->entity.get());
                i->mover->entity->inputTarget = false;
                fadeOut(i->mover->entity, 0.4f);
                i = shelf.erase(i);
            } else {
                ++i;
            }
        }
    }
    Vec2 spot = known ? *known : freeSpot();
    // NOTE(port): changed for Quest, at Kai's request (2026-11-15). The Swift hangs a cover far off and
    // high, `spot` degrees round you (`makeCover(for: tree, el: spot.y)` at `shelfPoint(spot)`, at
    // `coverRest` of its size). Here it grows from the desk, behind the small tree, among the others
    // (oceanmodel_desk.cpp); `spot` is still kept, for the file.
    // (The desk is taken to be large: a place is good wherever it is, so long as it is far enough off.)
    bool on = stood && farEnough(*stood);
    // (A place kept from another day, when the desk and what stood on it were different, may now be in another tree's way.)
    for (const Shelved& cover : shelf) {
        if (on && Forest::crowd(desk, stage.origin, cover.plot, *stood)) on = false;
    }
    Vec2 plot = on ? *stood : freePlot();
    logLine(fmt("[ocean] on the desk: %s at %.3f, %.3f, ", tree->title.c_str(), double(plot.x), double(plot.y)) + (on ? "its own place" : "a free place"));
    // On the desk while no tree is open; with one open (or on its way), straight to the ocean's floor, small.
    bool down = wantDown();
    std::optional<Cover> made = makeCover(*tree, restEl(plot, down), true);
    if (!made) return;
    logLine(fmt("[ocean] cover of %s: %d pictures of the %d its cards have, %d of them while it lies on the ocean's floor; %d still to come",
                tree->title.c_str(), made->picks, made->choices, std::min(made->picks, int(usualPictures)),
                made->picks - int(made->pictures.size())));
    Vec3 p = restPoint(plot, made->foot, down);
    EntityRef holder = made->entity;
    holder->orientation = stage.upright(p).orientation;
    // NOTE(port): changed for Quest: one box round the whole cover in the Swift (`made.box`), which far off
    // and small is what a look can find. Here the trees are large and stand one behind another.
    holder->collision = coverCollision(made->shapes, made->pictures, made->caption != nullptr, made->nameSize, made->foot);
    holder->inputTarget = !down;
    holder->hover = down ? Hover::none() : Art::hover();
    for (size_t k = usualPictures; down && k < made->pictures.size(); k++) made->pictures[k].entity->opacity = 0.f;
    root_->addChild(holder);
    int uid = nextUID;
    nextUID += 1;
    picks[holder.get()] = Pick::shelf(uid);
    float rest = down ? Forest::scale() : Forest::grown();      // NOTE(port): `coverRest` in the Swift (see above)
    MoverRef m = std::make_shared<Mover>(holder, from ? *from : p, !from ? rest : (!hand ? 0.2f : 1.f));
    if (from) {
        double delay = !hand ? 0.0 : 0.16;
        // NOTE(port): changed for Quest: 0.42 s and `.inOut` in the Swift. It shrinks to a quarter as it
        // comes down: a departure, clear travel and a long soft arrival, or it lurches.
        float fly = 0.72f;
        m->position.go(p, time, delay, fly, Ease::travel);
        m->scale.go(rest, time, delay, fly, Ease::travel);
        if (hand) {
            // NOTE(port): changed for Quest. In the Swift the card in flight (`hand`) and this cover fly the
            // same way and one is swapped for the other near the end; as its tweens are written the card
            // in flight never shows, so the cover appears at its place out of nothing. Here this cover
            // makes the whole trip itself: it takes the pressed card's place as the cards fade, turned and
            // tipped as that was, and comes round to its own facing on the way down.
            hand->alpha.set(0);
            hand->removeAt = time;
            m->alpha.set(0);
            m->alpha.go(1, time, 0.1f);
            holder->orientation = hand->entity->orientation;
            tip(made->tilts, 0);
            coverLandsAt = time + delay + double(fly);
        }
        touch(time + delay + double(fly) + 0.2);
    }
    movers.push_back(m);
    Shelved kept{uid, tree, m, made->tilts, spot, plot, made->foot};
    kept.top = made->box.center.y + made->box.size.y / 2;
    kept.branches = made->branches;
    kept.caption = made->caption;
    kept.pictures = made->pictures;
    kept.trunk = made->shapes;
    kept.layers = made->layers;
    kept.treeFoot = made->treeFoot;
    kept.treeRise = made->treeRise;
    kept.el.set(restEl(plot, down));
    kept.gravel = made->gravel;
    kept.nameSize = made->nameSize;
    kept.huddle.set(down ? huddleDown : huddleUp);
    if (from && kept.gravel) {
        // Its rings spread over the ground it comes to, as it arrives: a stone into water.
        kept.ripple.set(0);
        kept.ripple.go(1, time, (!hand ? 0.0 : 0.16) + 0.5, 1.2f, Ease::out);
        kept.gravel->show(0);
        touch(time + 2.1);
    }
    if (from && hand) {
        // The pressed card's pictures are where its cards were: they draw in to the trunk on the way down.
        kept.huddle.set(1);
        kept.huddle.go(down ? huddleDown : huddleUp, time, 0.16, 0.72f, Ease::travel);
        kept.el.set(0);
        kept.el.go(restEl(plot, down), time, 0.16, 0.72f, Ease::travel);
        kept.turnFrom = hand->entity->orientation;
        kept.turnTo = stage.upright(p).orientation;
        kept.turnStart = time + 0.16;
        kept.turnOver = 0.72f;
    }
    layPictures(kept.pictures, kept.huddle.value(time));
    layName(kept.caption, kept.nameSize, kept.foot, kept.huddle.value(time));
    shelf.push_back(kept);
    rakeForest();
    if (shelfLoaded) shelfDirty = true;
}

/// A cover carried by hand: it follows, at arm's length, around you.
std::optional<Vec2> OceanModel::carry(int uid, Vec3 from, Vec3 d) {
    auto s = std::find_if(shelf.begin(), shelf.end(), [&](const Shelved& cover) { return cover.uid == uid; });
    if (s == shelf.end()) return std::nullopt;
    // NOTE(port): changed for Quest (see oceanmodel.h). The Swift: "A hand moves a little; the cover, far
    // off, moves by the same angle", `spot` being degrees round you. Here the tree slides over the desk's
    // top and stays under the pinched point as the eyes see it: both ends of the hand's move are carried
    // along the line of sight down onto the desk.
    std::optional<Mat4> head = platform::head();
    Vec3 eye = head ? head->position() : stage.origin;
    float over = eye.y - desk.front.y;
    auto onDesk = [&](Vec3 q) -> std::optional<Vec2> {
        float down = eye.y - q.y;
        if (!(down > 0.03f && over > 0.03f)) return std::nullopt;
        return desk.plot(eye + (q - eye) * (over / down));
    };
    std::optional<Vec2> a = onDesk(from), b = onDesk(from + d);
    Vec2 plot = s->plot;
    if (a && b) {
        plot = s->plot + (*b - *a);
        plot = {std::min(Forest::wide + 0.8f, std::max(-Forest::wide - 0.8f, plot.x)), std::min(forestNear() + Forest::deep + 0.8f, std::max(0.03f, plot.y))};
        // No nearer than a tree may stand: held off at that distance, on its own line from you.
        Vec2 e = desk.plot(stage.origin);
        if (!farEnough(plot)) plot = e + normalize(plot - e + Vec2{0, 1e-4f}) * 1.5f;
    }
    Vec3 p = plantPoint(plot, s->foot);
    s->mover->position.set(p);
    s->mover->entity->orientation = stage.upright(p).orientation;
    tip(s->tilts, plantEl(plot));
    touch(time + 0.2);
    return plot;
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
        // NOTE(port): changed for Quest, at Kai's request (2026-11-15). In the Swift "the cover comes forward
        // and opens into its tree": it flies to the layer you work on, grows to full size and fades over
        // 0.3 s, and the tree stands 0.1 s in. Here the cover's tree goes to the front of the desk, where
        // the small tree stands, and becomes it; its pictures stay where they are for a beat and then rise,
        // one after another, each into its card on the layers; its name goes. (The others sink: `watchForest`.)
        double now = time;
        Vec3 seatAt = desk.at(0, treeBack());
        float small = 1 / coverTree;                    // its tree in the small tree's own measure
        float squash = Hologram::rise(s.layers) / std::max(s.treeRise, 1e-4f);
        // So that level for level its tree ends where the small tree's is.
        Vec3 to = seatAt + stage.u * (Hologram::foot - s.treeFoot * squash - s.foot * small);
        float over = 0.9f;          // (0.75 at first; the forest stands twice as far off now, and the way is longer)
        s.mover->position.go(to, now, over, Ease::travel);
        s.mover->scale.go(small, now, over, Ease::travel);
        s.mover->alpha.go(0, now, double(over) - 0.2, 0.32f, Ease::out);       // it gives way to the small tree over the last of the way
        s.mover->removeAt = now + double(over) + 0.16;
        Becoming b;
        b.mover = s.mover;
        b.branches = s.branches;
        b.from = s.mover->entity->orientation;
        b.to = stage.upright(seatAt).orientation;
        b.start = now;
        b.over = over;
        b.squash.go(squash, now, over, Ease::travel);
        becoming = b;
        holoShowAt = now + double(over) - 0.3;
        if (s.caption) fadeOut(s.caption, 0.2f);
        if (s.gravel) fadeOut(s.gravel->entity, 0.3f);
        rakeForest();           // (a tree whose rings stopped short of this one's has the ground to itself again)
        // Its pictures are let go of where they stand, as they stand.
        for (auto& [id, r] : rising) r.thumb->removeFromParent();
        rising.clear();
        int order = 0;
        for (const CoverPicture& p : s.pictures) {
            Vec3 at = p.entity->transformMatrix(nullptr).position();
            Quat turn = s.mover->entity->orientation * p.entity->orientation;
            float size = s.mover->entity->scale.x * p.entity->scale.x;
            bool shown = !(p.entity->opacity && *p.entity->opacity < 0.5f);
            p.entity->removeFromParent();
            if (!shown || Flags::has("noRise")) continue;       // `-noRise`: the pictures just go, to compare what the rising costs
            // (A work's card draws from the work's own file: it is asked for now, to be there when the card is made.)
            if (p.ref.kind == Ref::Kind::work && art && catalog) art->smallReady(catalog->works[p.ref.index]);
            p.entity->position = at;
            p.entity->orientation = turn;
            p.entity->scale = Vec3::repeating(size);
            root_->addChild(p.entity);
            rising[p.id] = Rising{p.entity, at, turn, p.width * size, p.ref, order++};
        }
        touch(now + double(over) + 1.6);
        standingSpot = s.spot;
        standingPlot = s.plot;
        stand(s.tree);
        // Any picture no card came for (its card is folded away) goes quietly.
        after(2.2, [this] {
            for (auto& [id, r] : rising) fadeOut(r.thumb, 0.3f);
            rising.clear();
        });
    });
}

// The shelf as it is kept between runs: every cover's tree and where it hangs.
// (Codable in the Swift. The keys are the property names; `spot` is an array of two, and `works`
// is left out when there is none.)
std::optional<OceanModel::ShelfFile::Item> OceanModel::ShelfFile::Item::from(const Json& j) {
    Item item;
    if (!j.isObject() || !decode::value(j["tree"], item.tree) || !decode::vec2(j["spot"], item.spot)) return std::nullopt;
    Vec2 plot;
    if (decode::vec2(j["plot"], plot)) item.plot = plot;
    return item;
}

Json OceanModel::ShelfFile::Item::json() const {
    Json j = Json::object();
    j.set("tree", tree.json());
    j.set("spot", Json::list({Json(spot.x), Json(spot.y)}));
    if (plot) j.set("plot", Json::list({Json(plot->x), Json(plot->y)}));
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
    // AGENT: joined to the agent service, the shelf holds the service's trees only (the bridge hangs them),
    // so the trees this app keeps itself, and the two it starts with, stay in their file untouched.
    if (agentBridge) return;
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
        // NOTE(port): added for Quest: of the welcome trees a file may hold from before there was only ever one, the last is kept.
        auto welcome = [](const ShelfFile::Item& item) {
            for (const TreeNode& n : item.tree.nodes) {
                if (n.ref.kind == Ref::Kind::note && n.ref.id == "welcome") return true;
            }
            return false;
        };
        const ShelfFile::Item* lastWelcome = nullptr;
        for (const ShelfFile::Item& item : file->trees) {
            if (welcome(item)) lastWelcome = &item;
        }
        for (const ShelfFile::Item& item : file->trees) {
            if (welcome(item) && &item != lastWelcome) continue;
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
    if (TreeRef t = Tree::make(item.tree, catalog)) shelve(t, std::nullopt, nullptr, item.spot, item.plot);
    shelfLoaded = loaded;
    // It is older than every one hung before it this way: it goes in front of them, so the shelf keeps the file's order.
    if (shelf.size() > before) std::rotate(shelf.begin(), shelf.end() - 1, shelf.end());
    touch(time + 0.2);
}

/// Writes the shelf down. A tree taken off the shelf and still standing is kept at the place it left.
void OceanModel::saveShelf() {
    shelfDirty = false;
    // AGENT: joined to the agent service, the shelf holds the service's trees, which the service keeps; the bridge writes
    // down where they stand on the desk (core/agent/plots.h), and the headset's own shelf file is left as it was.
    if (agentBridge) {
        agentBridge->saveShelf();
        return;
    }
    std::string url = shelfURL();
    if (url.empty() || !catalog) return;
    std::vector<ShelfFile::Item> items = shelfWaiting;     // (none, by the time anything is written: see `update`)
    for (const Shelved& cover : shelf) items.push_back(ShelfFile::Item{cover.tree->saved(), cover.spot, cover.plot});
    if (tree && standingSpot) items.push_back(ShelfFile::Item{tree->saved(), *standingSpot, standingPlot});
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
    // NOTE(port): changed for Quest: `isEnabled = false` at once in the Swift; here it fades (nothing pops).
    if (!tree || pressing) hideHologram();
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
        // NOTE(port): changed for Quest: `stage.point(0, -19, 1.25)` in the Swift. The forest on the desk
        // now stands in that part of the view, so the briefs stand as far above -19 degrees as clears its tops.
        holder->position = stage.point(0, briefsEl(), 1.25f);
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
        // NOTE(port): added for Quest: every gesture, a pinch away (oceanmodel_guide.cpp).
        if (teach.on) {
            add(art->line("Gestures", Art::Size::label, Font::Weight::medium, Color::white(1, 0.8f), Art::ink, Art::buttonPad), left,
                0.032f - float(briefs.size()) * 0.052f - 0.004f, Pick::guide(103));
        }
        // NOTE(port): changed for Quest: `delay: 0.1` in the Swift. A cover on its way down to the desk
        // passes through where the briefs stand: they come once it has landed.
        fadeIn(holder, std::max(0.1, coverLandsAt - 0.1 - time), 0.3f);
        return;
    }
    // NOTE(port): changed for Quest: `stage.point(29, -27, 1.02)` in the Swift, low and near to the right.
    // Here it stands on the desk, to the right of the small tree, a quarter nearer than it was and so a
    // fifth smaller.
    Vec2 on = controlsPlot();
    holder->position = desk.at(on.x, on.y, 0.06f);
    holder->orientation = deskFacing(holder->position);
    holder->scale = Vec3::repeating(0.8f);
    float left = -0.16f;
    add(art->line(tree->title + " · " + label(tree->maker), Art::Size::label, Font::Weight::medium, Color::white(1, 0.8f)), left, 0.024f, std::nullopt);
    float x = left;
    // (`pad:` follows `fg:` and `bg:`, which these two leave as they are: they are written out.)
    x += add(art->line("Put away", Art::Size::label, Font::Weight::medium, Color::white(), Art::ink, Art::buttonPad), x, -0.018f, Pick::putAway()) + 0.01f;
    // (On the Quest a button is to press the tree as surely as the clap does. This one already
    // does: a pinch on it is `pressTree(send: true)`, the very call the clap makes in `handle`.
    // So nothing is added to the strip.) AGENT: joined to the service, nothing is sent by hand: a tree is handed off by
    // voice, so the button is not there.
    if (!agentBridge) {
        x += add(art->line("Send to image generation", Art::Size::label, Font::Weight::semibold, Color::white(), Art::hot, Art::buttonPad), x, -0.018f, Pick::send()) + 0.01f;
    }
    // NOTE(port): added for Quest: every gesture, a pinch away (oceanmodel_guide.cpp).
    if (teach.on) add(art->line("Gestures", Art::Size::label, Font::Weight::medium, Color::white(1, 0.8f), Art::ink, Art::buttonPad), x, -0.018f, Pick::guide(103));
    fadeIn(holder, 0.15, 0.3f);
}
