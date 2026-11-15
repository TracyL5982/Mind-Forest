// Port of visionos/MindPalace/Ocean/OceanModel.swift: `// MARK: - Cards`.
#include "oceanmodel.h"

#include "../agent/bridge.h"

#include <cmath>

#include "../cards/ocean.h"
#include "../cards/pieces.h"

// MARK: - Cards

OceanModel::Bodies OceanModel::bodies(const Ref& ref) const {
    if (!art || !catalog) return Bodies{{0.1f, 0.1f}, {0.2f, 0.2f}};
    // NOTE(port): added for Quest. A piece drawn as a card takes its card's sizes (core/cards).
    if (std::optional<std::string> card = cards::ocean::cardOf(ref)) {
        std::optional<Vec2> small = cards::ocean::smallSize(*card), open = cards::ocean::openSize(*card);
        if (small && open) return Bodies{*small, *open};
    }
    switch (ref.kind) {
    case Ref::Kind::film: {
        int i = ref.index;
        return Bodies{art->filmSize(catalog->clips[i], false), art->filmSize(catalog->clips[i], true)};
    }
    case Ref::Kind::work: {
        int i = ref.index;
        return Bodies{art->workPicture(catalog->works[i], false), art->workOpenBody(catalog->works[i])};
    }
    case Ref::Kind::note: {
        auto note = catalog->notes.find(ref.id);
        if (note == catalog->notes.end()) return Bodies{{Metrics::smallNoteWidth, 0.1f}, {Metrics::openNoteWidth, 0.27f}};
        return Bodies{art->noteSmallSize(note->second, catalog), catalog->openSize(note->second)};
    }
    case Ref::Kind::tag: {
        auto tag = catalog->tags.find(ref.id);
        float w = art->chipWidth(tag != catalog->tags.end() ? tag->second.name : std::string());
        return Bodies{{w, Metrics::chipHeight}, Vec2{w, Metrics::chipHeight} * 2.08f};
    }
    }
    return Bodies{{0.1f, 0.1f}, {0.2f, 0.2f}};
}

void OceanModel::makeCard(const TreeNode& n, double delay) {
    if (!tree || cards.count(n.id)) return;
    const Tree& tree = *this->tree;
    Bodies b = bodies(n.ref);
    CardRef c = std::make_shared<CardView>(n, b.small, b.open);
    seatCard(*c, n);    // NOTE(port): added for Quest (core/cards).
    Rest at = rest(n, tree);
    c->xy.set(at.xy);
    c->plane.set(float(at.depth));
    c->pb.set(at.pan);
    c->float_.set(at.float_);
    c->tint.set(tree.color(n.id));
    c->bornAt = time + delay;
    std::optional<int> f = catalog ? catalog->piece(n.ref) : std::nullopt;
    if (f && shell && *f >= 0 && *f < int(shell->homes.size())) {
        // Out of the ocean, from its own place in it.
        c->source = shell->center(*f);
        c->sourceScale = shell->width(*f) / b.small.x;
        c->home = *f;
        c->emerge.go(1, time, delay, Pace::fly, Ease::travel);
        shell->setOut(*f, true);
    } else {
        // Out of the card it hangs from; a root, up out of the ocean straight ahead.
        c->source = stage.ocean(0, 2.2f);
        if (n.parent) {
            int p = *n.parent;
            const CardRef& parent = card(p);
            bool there = parent ? parent->root->isEnabled && time >= parent->bornAt + 0.05 : false;
            c->source = there ? parent->position : treePoint(find(tree, p));
        }
        c->sourceScale = 0.15f;
        c->emerge.go(1, time, delay, Pace::pop, Ease::arrive);
    }
    Look look = style(n, tree);
    c->scale.set(look.scale);
    c->alpha.set(look.alpha);
    c->openMix.set(look.open);
    c->dim.set(look.dim);
    c->solid.set(n.kept ? 1 : 0);
    std::vector<int> path = tree.path();
    c->onPath.set(std::find(path.begin(), path.end(), n.id) != path.end() ? 1 : 0);
    c->stepMix.set(look.label);
    if (look.label > 0.5f && catalog) {
        int d = routeIndex(tree, n.id);
        if (d >= 0) buildStep(*c, d + 1, catalog->short_(n.ref));
    }
    treeRoot->addChild(c->root);
    cards[n.id] = c;
    picks[c->root.get()] = Pick::card(n.id);
    setHit(*c, look);
    if (look.open > 0.5f) {
        buildSmall(*c);
        buildOpen(*c, n);
    } else if (look.alpha > 0) {
        buildQueue.push_back(n.id);
        // NOTE(port): added for Quest (see `ghosts`). A picture that never arrives: the renderer draws its
        // placeholder for it, after a moment, until `buildSmall` puts the card's own picture in its place.
        if (catalog) {
            static const ImageRef never = [] {
                auto image = std::make_shared<Image>();
                image->width = image->height = 1;
                image->ready.store(false);
                return image;
            }();
            Vec2 size = catalog->smallSize(n.ref);
            EntityRef ghost = Entity::make(Mesh::generatePlane(size.x, size.y), {Material::unlit(Color::white(), Texture::make(never))});
            c->smallHolder->addChild(ghost);
            ghosts[n.id] = ghost;
        }
    }
    touch(c->settles() + 0.4);          // and the moment after it lands, when its thread runs out to it
}

/// Every layer up to the one you work on. Each layer back draws in
/// toward the card your path left it by, which keeps standing under the
/// group it started, and sits a share nearer the middle of the view, so
/// a long path that keeps branching one way doesn't walk its early
/// layers off the edge.
std::vector<OceanModel::LayerFrame> OceanModel::layerFrames(const Tree& tree) const {
    int top = tree.standDepth();
    std::vector<LayerFrame> out(size_t(top + 1), LayerFrame{});
    float keep = 1 - Stage::recentre;
    int i = top - 1;
    while (i >= 0) {
        // The card the path left this layer by: at home here, in the middle of its group one layer on.
        int next = tree.route[i + 1], here = tree.route[i];
        Vec2 up = lifted(tree, next);
        const TreeNode* nextNode = find(tree, next);
        Vec2 down = lifted(tree, here) + (nextNode ? nextNode->xy : Vec2::zero()) * tree.spread(here);
        float g = Stage::gather(float(top - i));
        LayerFrame after = out[i + 1];
        out[i] = LayerFrame{(after.origin + up * after.gather) * keep - down * g, g, after.pan * keep};
        i -= 1;
    }
    return out;
}

/// Where a node rests in the view before the view's pan: its place on
/// its layer, through how that layer lies; how large its place in a
/// condensed group makes it, and how far it floats.
OceanModel::Rest OceanModel::rest(const TreeNode& n, const Tree& tree, const std::vector<LayerFrame>* given) const {
    Seat at = tree.seat(n);
    std::vector<LayerFrame> made;
    if (!given) made = layerFrames(tree);
    const std::vector<LayerFrame>& frames = given ? *given : made;
    if (!(at.depth >= 0 && at.depth < int(frames.size()))) return Rest{at.xy, at.depth, 1, at.scale, at.float_, at.visible};
    const LayerFrame& f = frames[at.depth];
    return Rest{f.origin + at.xy * f.gather, at.depth, f.pan, at.scale, at.float_, at.visible};
}

/// Where a node rests right now (ignoring any motion of its own).
Vec3 OceanModel::treePoint(const TreeNode* n) const {
    if (!n || !tree) return stage.page(0).center;
    Rest at = rest(*n, *tree);
    float behind = focusLevel.target() - float(at.depth);
    return stage.sheet(behind).at(stage.squeeze(at.xy - pan.target() * at.pan).at).position;
}

void OceanModel::buildSmall(CardView& c) {
    if (!(art && catalog && tree && find(*tree, c.id) && !c.built)) return;
    c.built = true;
    if (auto ghost = ghosts.find(c.id); ghost != ghosts.end()) {
        ghost->second->removeFromParent();
        ghosts.erase(ghost);
    }
    std::optional<Piece> piece;
    EntityRef holder = c.smallHolder;
    // NOTE(port): added for Quest. A piece drawn as a card shows the pictures it has, and its open frame and
    // panel are made with its small face, so they are there before the card can open (core/cards).
    if (std::optional<std::string> card = cards::ocean::cardOf(c.ref)) {
        cardPictures(*card);
        piece = cards::ocean::small(*art, *card);
        cards::ocean::open(*art, *card);
        cards::ocean::panel(*art, *card);
        // A card still composing is drawn in a holder of its own, so it can ease to its finished card's size, and
        // a soft light runs across it (composeFrame).
        if (cards::ocean::composing(*card)) {
            c.shape = Entity::make();
            c.smallHolder->addChild(c.shape);
            holder = c.shape;
            c.shimmer = shimmerBand(*art, c.smallBody);
            // Its frame without its words lies under its face all along, so it is ready to ease to the finished size
            // when the face gives way (settleCard).
            if (std::optional<Piece> frame = cards::ocean::frame(*art, *card)) {
                EntityRef bare = art->quad(*frame);
                bare->position.z = -0.0002f;
                holder->addChild(bare);
            }
            touch(time + 0.1);
        }
    } else switch (c.ref.kind) {
    case Ref::Kind::film:
        piece = art->filmSmall(catalog->clips[c.ref.index]);    // its why rides on its thread
        break;
    case Ref::Kind::work:
        piece = art->workSmall(catalog->works[c.ref.index]);
        break;
    case Ref::Kind::note:
        if (auto note = catalog->notes.find(c.ref.id); note != catalog->notes.end()) piece = art->noteSmall(note->second, catalog);
        break;
    case Ref::Kind::tag:
        if (auto tag = catalog->tags.find(c.ref.id); tag != catalog->tags.end()) piece = art->chip(tag->second);
        break;
    }
    if (piece) {
        EntityRef quad = art->quad(*piece);
        holder->addChild(quad);
        c.smallQuad = CardView::SmallQuad{quad, piece->texture};
        // (`[weak art]` in the Swift: the art lives as long as the model does.)
        c.shade = [art = art.get()](const EntityRef& quad, const TextureRef& texture, float dim) { art->shade(quad, texture, dim); };
    }
    if (c.shimmer) holder->addChild(c.shimmer);
    c.addGlow(art->glow(c.smallBody), holder);
    if (EntityRef rim = art->gazeRim(c.smallBody, gazeMaterial)) holder->addChild(rim);
}

// NOTE(port): added for Quest (core/cards), with `settleCard` and `composeFrame`.

namespace {
/// How long an in-progress card takes to ease to its finished card's size, and the finished card to come up inside it, s.
constexpr float SETTLE = 0.32f, APPEAR = 0.22f;
/// The light that runs across a composing card: a third of its width, and once across every 1.6 s.
constexpr float BAND = 0.32f;
constexpr double PASS = 1.6;
}  // namespace

/// A soft band of light as tall as a composing card, brightest down its middle and gone at its sides: thin strips of
/// flat light, which need no picture, so nothing stands in for one while it is on its way to the GPU.
EntityRef OceanModel::shimmerBand(Art& art, Vec2 body) {
    constexpr int strips = 13;
    float wide = body.x * BAND, tall = std::max(body.y - 0.004f, 0.01f), each = wide / strips;
    EntityRef band = Entity::make();
    for (int i = 0; i < strips; i++) {
        float x = (float(i) + 0.5f) / strips - 0.5f;
        EntityRef strip = art.swatch(Color::white(), {each, tall}, 0.12f * std::exp(-x * x / 0.05f));
        // Light only: it hides nothing drawn after it, as the face under it may be when the band stands nearer the eye.
        strip->model->materials[0].writesDepth = false;
        strip->position.x = x * wide;
        band->addChild(strip);
    }
    band->position.z = 0.0004f;
    return band;
}

void OceanModel::settleCard(int id) {
    auto found = cards.find(id);
    const TreeNode* n = tree ? find(*tree, id) : nullptr;
    if (!n || found == cards.end()) return;
    CardRef old = found->second;
    cards.erase(found);
    for (const Entity* e : old->extras) picks.erase(e);
    old->root->inputTarget = false;
    old->home = std::nullopt;
    buildQueue.erase(std::remove(buildQueue.begin(), buildQueue.end(), id), buildQueue.end());
    makeCard(*n, 0);
    CardRef made = card(id);
    leaving.push_back(old);
    if (!made) {
        old->alpha.go(0, time, 0.15f);
        old->goneAt = time + 0.16;
        return;
    }
    // The same card with its finished face carries on from where it was, and does not arrive again.
    made->source = old->source;
    made->sourceScale = old->sourceScale;
    made->emerge = old->emerge;
    made->bornAt = old->bornAt;
    buildSmall(*made);
    buildQueue.erase(std::remove(buildQueue.begin(), buildQueue.end(), id), buildQueue.end());
    // The in-progress card eases to the finished card's size and place, a hair behind it, and goes once the
    // finished card has come up inside it.
    old->settle = CardView::Settle{old->smallBody, made->smallBody, time};
    if (old->smallQuad) old->smallQuad->entity->isEnabled = false;
    if (old->shimmer) old->shimmer->isEnabled = false;
    // Opened, it keeps its frame, which is the finished card's, and the words of its panel go.
    if (old->openPanel) old->openPanel->isEnabled = false;
    old->openHolder->position.z = -0.002f;
    old->xy.go(made->xy.target(), time, SETTLE);
    if (old->shape) old->shape->position.z = -0.002f;
    old->goneAt = time + SETTLE + APPEAR + 0.05;
    float shown = made->alpha.target();
    made->alpha.set(0);
    made->alpha.go(shown, time, SETTLE * 0.55f, APPEAR, Ease::out);
    touch(old->goneAt + 0.1);
}

void OceanModel::composeFrame(double now) {
    auto run = [&](CardView& c) {
        if (c.shimmer) {
            // It comes in at the left, brightest across the middle, and goes at the right.
            float t = float(std::fmod(std::max(0.0, now - c.bornAt), PASS) / PASS);
            c.shimmer->position.x = (t - 0.5f) * c.smallBody.x * (1 - BAND);
            c.shimmer->opacity = std::clamp(std::sin(float(M_PI) * t), 0.f, 1.f);
            c.changed();
        }
        if (c.settle && c.shape) {
            float t = std::clamp(float((now - c.settle->start) / SETTLE), 0.f, 1.f), e = t * t * (3 - 2 * t);
            Vec2 from = c.settle->from, to = c.settle->to;
            c.shape->scale = {1 + (to.x / std::max(from.x, 1e-4f) - 1) * e, 1 + (to.y / std::max(from.y, 1e-4f) - 1) * e, 1};
            c.changed();
        }
    };
    for (const auto& [id, c] : cards) {
        if (c) run(*c);
    }
    for (const CardRef& c : leaving) run(*c);
}

/// A card as an earlier step of the path: its number and name.
void OceanModel::buildStep(CardView& c, int number, const std::string& words) {
    if (!art) return;
    std::string key = fmt("%d:", number) + words;
    if (key == c.stepKey) return;
    std::optional<Piece> piece = art->stepLabel(number, words);
    if (!piece) return;
    c.stepKey = key;
    std::vector<EntityRef> children = c.stepHolder->children;
    for (const EntityRef& child : children) child->removeFromParent();
    c.stepHolder->addChild(art->quad(*piece));
    if (EntityRef rim = art->gazeRim(piece->size, gazeMaterial)) c.stepHolder->addChild(rim);
    c.stepBody = piece->size;
    c.refresh();
}

void OceanModel::buildOpen(CardView& c, const TreeNode& node) {
    if (!(art && catalog && !c.openBuilt)) return;
    c.openBuilt = true;
    // NOTE(port): added for Quest. A piece drawn as a card opens to its card's frame, with the whole panel
    // behind a window in it, at its top, and the bar that says where the window is while the panel runs on
    // past it (core/cards).
    if (std::optional<std::string> card = cards::ocean::cardOf(c.ref)) {
        cards::ocean::scrollTo(*card, 0);
        c.layout = cards::ocean::layout(*card);
        if (std::optional<Piece> piece = cards::ocean::open(*art, *card)) {
            c.openFace = art->quad(*piece);
            c.openHolder->addChild(c.openFace);
        }
        if (std::optional<Piece> piece = cards::ocean::panel(*art, *card)) {
            c.openPanel = art->quad(*piece);
            solid(c.openPanel);
            c.openPanel->position.z = 0.0003f;
            cards::ocean::showPanel(c.openPanel, *card);
            c.openHolder->addChild(c.openPanel);
        }
        c.scrollBar = art->swatch(Color::white(), {cards::ocean::INDICATOR_WIDE * cards::ocean::openScale / Art::ppm, cards::ocean::INDICATOR_UNIT}, 0.4f);
        cards::ocean::showIndicator(c.scrollBar, *card);
        c.openHolder->addChild(c.scrollBar);
        c.addGlow(art->glow(c.openBody), c.openHolder);
        if (EntityRef rim = art->gazeRim(c.openBody, gazeMaterial)) c.openHolder->addChild(rim);
    } else switch (c.ref.kind) {
    case Ref::Kind::film: {
        const Clip& clip = catalog->clips[c.ref.index];
        if (MeshRef mesh = art->stillMesh(clip, c.openBody)) {
            c.openHolder->addChild(Entity::make(mesh, {art->atlasMaterial()}));
        }
        if (std::optional<Piece> caption = art->filmCaption(clip, node.why, node.tone)) c.openHolder->addChild(art->quad(*caption));
        // One card: the picture and the panel under it share one edge of light.
        EntityRef glow = art->glow({c.openBody.x, c.openBody.y + Metrics::filmCaption});
        if (glow) glow->position.y = -Metrics::filmCaption / 2;
        c.addGlow(glow, c.openHolder);
        if (EntityRef rim = art->gazeRim({c.openBody.x, c.openBody.y + Metrics::filmCaption}, gazeMaterial)) {
            rim->position.y = -Metrics::filmCaption / 2;
            c.openHolder->addChild(rim);
        }
        break;
    }
    case Ref::Kind::work: {
        const Work& work = catalog->works[c.ref.index];
        Vec2 picture = art->workPicture(work, true);
        // Narrower than its caption: the picture stands on a dark mount.
        if (c.openBody.x > picture.x + 0.001f) {
            EntityRef mount = art->swatch(Art::ink, c.openBody);
            mount->position.z = -0.001f;
            c.openHolder->addChild(mount);
        }
        // From the atlas at once; from its own file a moment later (showFull).
        EntityRef e = Entity::make();
        if (MeshRef mesh = art->workMesh(work, picture)) {
            if (std::optional<Material> m = art->workAtlasMaterial()) e->model = ModelComponent{mesh, {*m}};
        }
        c.openHolder->addChild(e);
        c.picture = e;
        if (std::optional<Piece> caption = art->workCaption(work, node.why, node.tone)) c.openHolder->addChild(art->quad(*caption));
        EntityRef glow = art->glow({c.openBody.x, c.openBody.y + Metrics::workCaption});
        if (glow) glow->position.y = -Metrics::workCaption / 2;
        c.addGlow(glow, c.openHolder);
        if (EntityRef rim = art->gazeRim({c.openBody.x, c.openBody.y + Metrics::workCaption}, gazeMaterial)) {
            rim->position.y = -Metrics::workCaption / 2;
            c.openHolder->addChild(rim);
        }
        // Part of the picture can be marked: the picture is the whole of what the layout knows.
        CGSize size(picture.x * Art::ppm, picture.y * Art::ppm);
        NoteLayout layout;
        layout.size = size;
        layout.picture = CGRect(CGPoint::zero(), size);
        c.layout = layout;
        showFull(c);
        break;
    }
    case Ref::Kind::note: {
        auto found = catalog->notes.find(c.ref.id);
        if (found == catalog->notes.end()) break;
        const OceanNote& note = found->second;
        c.layout = art->noteLayout(note, catalog);
        if (std::optional<Piece> piece = art->noteOpen(note, catalog)) {
            c.openFace = art->quad(*piece);
            c.openHolder->addChild(c.openFace);
        }
        c.addGlow(art->glow(c.openBody), c.openHolder);
        if (EntityRef rim = art->gazeRim(c.openBody, gazeMaterial)) c.openHolder->addChild(rim);
        break;
    }
    case Ref::Kind::tag: {
        auto tag = catalog->tags.find(c.ref.id);
        if (tag != catalog->tags.end()) {
            if (std::optional<Piece> piece = art->tagOpen(tag->second)) c.openHolder->addChild(art->quad(*piece));
        }
        break;
    }
    }
    c.openHolder->addChild(c.askHolder);
    c.asks = catalog->asks(c.ref, previousPiece(node.id));
    if (agentBridge) agentBridge->rows(node, c.asks);     // AGENT
    buildRows(c);
    c.refresh();
}

/// What stands under the card in focus, in one column: following its
/// link, and, under one "Ask" heading, what you
/// can ask the gardener about it. Rebuilt only when it changes, and
/// then the lines trade places over a moment.
void OceanModel::buildRows(CardView& c) {
    if (!(art && catalog && tree)) return;
    /// (The Swift's `(piece: Piece?, pick: Pick?, gap: Float)`.)
    struct Row {
        std::optional<Piece> piece;
        std::optional<Pick> pick;
        float gap;
    };
    std::vector<Row> rows;
    std::string key;
    if (c.ref.kind == Ref::Kind::note) {
        auto note = catalog->notes.find(c.ref.id);
        if (note != catalog->notes.end() && note->second.link) {
            const LinkSpec& link = *note->second.link;
            float gap = rows.empty() ? 0 : 0.008f;
            rows.push_back(Row{art->row("Open " + link.site + "  ↗"), Pick::openLink(c.id), gap});
            key += "link|";
        }
    }
    std::vector<std::pair<std::string, Pick>> questions;
    if (marks.count(c.id)) questions.push_back({"More on what you marked", Pick::askMark(c.id)});
    for (size_t k = 0; k < c.asks.size(); k++) questions.push_back({c.asks[k].question, Pick::ask(c.id, int(k))});
    if (!questions.empty()) {
        float gap = rows.empty() ? 0 : 0.012f;
        rows.push_back(Row{art->heading("Ask", Tone::question), std::nullopt, gap});
        for (const std::pair<std::string, Pick>& q : questions) {
            rows.push_back(Row{art->row(q.first), q.second, 0.004f});
            key += q.first + "|";
        }
    }
    if (key == c.rowsKey) return;
    bool first = c.rowsKey.empty();
    c.rowsKey = key;
    std::vector<EntityRef> children = c.askHolder->children;
    for (const EntityRef& child : children) {
        picks.erase(child.get());
        c.extras.erase(std::remove(c.extras.begin(), c.extras.end(), child.get()), c.extras.end());
        child->inputTarget = false;
        fadeOut(child, 0.15f);
    }
    float down = tree->openExtent(c.ref).down;
    float y = -down - 0.014f;
    for (size_t i = 0; i < rows.size(); i++) {
        const Row& row = rows[i];
        if (!row.piece) continue;
        const Piece& piece = *row.piece;
        y -= row.gap;
        EntityRef e = art->quad(piece);
        e->position = {-c.openBody.x / 2 + piece.size.x / 2, y - piece.size.y / 2, 0.001f};
        if (row.pick) {
            e->collision = {Shape::generateBox({piece.size.x, piece.size.y + 0.004f, 0.01f})};
            e->inputTarget = true;
            e->hover = Art::hover();
            picks[e.get()] = *row.pick;
            c.extras.push_back(e.get());
        }
        c.askHolder->addChild(e);
        if (!first) fadeIn(e, 0.08 + double(i) * 0.04);
        y -= piece.size.y;
    }
    c.rowsDown = std::max(0.f, -y - down);
    c.changed();
}

/// The film or work before `id` on its way from the root, if there is one (its place among the pieces).
std::optional<int> OceanModel::previousPiece(int id) const {
    if (!tree || !catalog) return std::nullopt;
    const TreeNode* from = find(*tree, id);
    std::optional<int> at = from ? from->parent : std::nullopt;
    while (at) {
        const TreeNode* n = find(*tree, *at);
        if (!n) break;
        if (std::optional<int> p = catalog->piece(n->ref)) return p;
        at = n->parent;
    }
    return std::nullopt;
}

// NOTE(port): added for Quest (core/cards), to the end of `pictureNow`.

// Its why is left to the label on its thread, as the card library's own tree leaves it: said again on the card it
// would push the picture of nearly half the films to a second page.
void OceanModel::seatCard(CardView& c, const TreeNode& n) {
    std::optional<std::string> id = cards::ocean::cardOf(n.ref);
    if (id && cards::ocean::seat(*id, cards::Node{.pick = !n.kept, .root = !n.parent, .tone = n.tone})) redrawCard(c);
}

void OceanModel::redrawCard(CardView& c) {
    std::optional<std::string> id = art ? cards::ocean::cardOf(c.ref) : std::nullopt;
    if (!id) return;
    auto repaint = [&](const EntityRef& quad, const std::optional<Piece>& piece) {
        if (!(quad && piece)) return;
        repaints.erase(std::remove_if(repaints.begin(), repaints.end(), [&](const Repaint& r) { return r.quad == quad; }), repaints.end());
        repaints.push_back(Repaint{c.id, quad, piece->texture});
    };
    if (c.smallQuad) repaint(c.smallQuad->entity, cards::ocean::small(*art, *id));
    if (c.openFace) {
        repaint(c.openFace, cards::ocean::open(*art, *id));
        // Drawn anew, it may run less far: it keeps its scroll as far as it can.
        cards::ocean::scrollTo(*id, cards::ocean::scroll(*id));
        if (c.openPanel) {
            repaint(c.openPanel, cards::ocean::panel(*art, *id));
            cards::ocean::showPanel(c.openPanel, *id);
            c.remade(c.openPanel);
        }
        cards::ocean::showIndicator(c.scrollBar, *id);
        c.layout = cards::ocean::layout(*id);
        if (tree && tree->focus() == c.id) buildRows(c);
    }
    touch(time + 0.3);
}

/// The panel's picture has no clear pixel, so it is drawn with what is solid: a mark's stroke, which is
/// see-through, then always lies over it, wherever the bend puts the two.
void OceanModel::solid(const EntityRef& quad) {
    if (quad && quad->model && !quad->model->materials.empty()) quad->model->materials[0].transparent = false;
}

void OceanModel::scrollCard(CardView& c, float offset) {
    std::optional<std::string> id = c.openPanel ? cards::ocean::cardOf(c.ref) : std::nullopt;
    if (!id) return;
    float was = cards::ocean::scroll(*id);
    if (!cards::ocean::scrollTo(*id, offset)) return;
    float moved = (cards::ocean::scroll(*id) - was) * cards::ocean::openScale / Art::ppm;
    bool pictured = c.layout && c.layout->picture;
    cards::ocean::showPanel(c.openPanel, *id);
    c.remade(c.openPanel);
    cards::ocean::showIndicator(c.scrollBar, *id);
    c.layout = cards::ocean::layout(*id);
    // What is marked goes with the words under it, and shows only while all of it is in the window.
    if (c.markHolder) {
        c.markHolder->position.y += moved;
        std::optional<Vec2> span = cards::ocean::window(*id);
        bool inside = true;
        for (const EntityRef& part : c.markHolder->children) {
            if (!(part->model && part->model->mesh && span)) continue;
            const BoundingBox& box = part->model->mesh->bounds;
            float y = c.markHolder->position.y + part->position.y;
            inside = inside && y + box.min.y * part->scale.y >= span->x && y + box.max.y * part->scale.y <= span->y;
        }
        c.markHolder->isEnabled = inside;
    }
    c.changed();
    touch(time + 0.2);
    // Its film plays only while its picture is in view.
    if (pictured != (c.layout && c.layout->picture)) restyle(false);
}

double OceanModel::settledAt(const CardView& c) const {
    return std::max({c.openMix.end(), c.xy.end(), c.nudge.end(), focusLevel.end(), pan.end()});
}

bool OceanModel::arm(CardView& c, Vec2 a) {
    if (!(art && c.layout)) return false;
    const NoteLayout& layout = *c.layout;
    PictureFrame picture = pictureFrame(c);
    bool inPicture = layout.picture && std::fabs(a.x - picture.center.x) <= picture.size.x / 2 && std::fabs(a.y - picture.center.y) <= picture.size.y / 2;
    CGPoint p = layout.pixels(a);
    int k = -1;
    for (size_t i = 0; !inPicture && i < layout.blocks.size(); i++) {
        if (layout.blocks[i]->frame().insetBy(-10, -10).contains(p)) {
            k = int(i);
            break;
        }
    }
    if (!inPicture && k < 0) return false;
    EntityRef holder = Entity::make();
    holder->position = {0, 0, 0.004f};
    if (inPicture) {
        // The picture's frame takes a 2 px outline.
        float w = 2 * cards::ocean::openScale / Art::ppm;
        Vec2 h = picture.size / 2;
        for (const auto& [at, size] : std::vector<std::pair<Vec2, Vec2>>{{{0, h.y - w / 2}, {picture.size.x, w}},
                                                                          {{0, -h.y + w / 2}, {picture.size.x, w}},
                                                                          {{-h.x + w / 2, 0}, {w, picture.size.y}},
                                                                          {{h.x - w / 2, 0}, {w, picture.size.y}}}) {
            EntityRef side = art->swatch(Art::hot, size);
            side->position = {picture.center.x + at.x, picture.center.y + at.y, 0};
            holder->addChild(side);
        }
    } else {
        // The word under the pinch takes the mark's own stroke, as `markMove` draws a marked word.
        if (std::optional<TextBlock::Words> found = layout.blocks[size_t(k)]->words(p, p)) {
            for (const CGRect& rect : found->rects) {
                EntityRef stroke = art->swatch(Art::hot, {rect.width() / Art::ppm + 0.004f, rect.height() / Art::ppm}, 0.45f);
                Vec2 mid = layout.meters(CGPoint(rect.midX(), rect.midY()));
                stroke->position = {mid.x, mid.y, 0};
                holder->addChild(stroke);
            }
        }
    }
    disarm(c);
    c.openHolder->addChild(holder);
    c.armHolder = holder;
    c.changed();
    touch(time + 0.2);
    return true;
}

void OceanModel::disarm(CardView& c) {
    if (!c.armHolder) return;
    c.armHolder->removeFromParent();
    c.armHolder = nullptr;
    c.changed();
    touch(time + 0.1);
}

void OceanModel::holdPress() {
    if (!(cardGestures && press && !press->cancelled && !press->armed && press->claim == Press::Claim::open && press->pick.kind == Pick::Kind::card)) return;
    int id = press->pick.index;
    CardRef c = card(id);
    if (!(c && c->openBuilt && tree && tree->focus() == id)) return;
    double settled = settledAt(*c);
    if (time < settled || time - std::max(press->began, settled) < 0.4 || length(press->at - press->start) > 0.02f) return;
    // On the margin, away from any block, it never arms, and a drag after it scrolls.
    if (arm(*c, onCard(*c, press->start))) press->armed = true;
}

void OceanModel::repaintCards() {
    for (auto r = repaints.begin(); r != repaints.end();) {
        if (r->texture->pending && !r->texture->pending->ready.load()) {
            ++r;
            continue;
        }
        if (CardRef c = card(r->id); c && art) {
            bool small = c->smallQuad && c->smallQuad->entity == r->quad;
            if (small) c->smallQuad->texture = r->texture;
            if (small || c->openFace == r->quad || c->openPanel == r->quad) art->shade(r->quad, r->texture, small ? c->dimNow() : 0);
            if (c->openPanel == r->quad) solid(r->quad);
            c->changed();
        }
        r = repaints.erase(r);
        touch(time + 0.1);
    }
}

bool OceanModel::cardPictures(const std::string& id) {
    bool all = true;
    for (const std::string& src : cards::pictures(id)) {
        if (cards::pictureAt(src) || !cards::oceanPicture(src)) continue;
        if (std::optional<ImageRef> image = pictureNow(src)) {
            handPicture(src, *image);
        } else {
            all = false;
            if (std::find(picturesDue.begin(), picturesDue.end(), src) == picturesDue.end()) picturesDue.push_back(src);
        }
    }
    return all;
}

void OceanModel::landPictures() {
    std::vector<std::string> due = picturesDue;
    for (const std::string& src : due) {
        std::optional<ImageRef> image;
        if (!cards::pictureAt(src)) {
            image = pictureNow(src);
            if (!image) continue;
        }
        picturesDue.erase(std::find(picturesDue.begin(), picturesDue.end(), src));
        if (image) handPicture(src, *image);
    }
}

void OceanModel::handPicture(const std::string& src, const ImageRef& image) {
    for (const std::string& changed : cards::picture(src, image)) {
        for (const auto& [id, c] : cards) {
            if (c && cards::ocean::cardOf(c->ref) == changed) redrawCard(*c);
        }
    }
}

std::optional<ImageRef> OceanModel::pictureNow(const std::string& src) {
    std::optional<cards::OceanPicture> at = cards::oceanPicture(src);
    if (!(at && art && catalog)) return ImageRef();
    // A file is unpacked on the background thread; until it is, the card shows the library's dark frame.
    auto unpacked = [](const std::string& path, int maxPixel) -> std::optional<ImageRef> {
        if (path.empty()) return ImageRef();
        if (platform::imageReady(path, maxPixel)) return platform::loadImage(path, maxPixel);
        platform::prefetchImage(path, maxPixel);
        return std::nullopt;
    };
    switch (at->kind) {
    case cards::OceanPicture::Kind::still:
        return at->index >= 0 && at->index < int(catalog->clips.size()) ? art->stillPicture(catalog->clips[size_t(at->index)]) : ImageRef();
    case cards::OceanPicture::Kind::work: {
        if (!(at->index >= 0 && at->index < int(catalog->works.size()))) return ImageRef();
        Art::Source source = art->pictureSource(catalog->works[size_t(at->index)], 512);
        return unpacked(source.url, source.maxPixel);
    }
    case cards::OceanPicture::Kind::file: return unpacked(platform::resourcePath(at->file), 0);
    }
    return ImageRef();
}

/// Shows an open work from its own file, at full size, as soon as it is read.
void OceanModel::showFull(CardView& c) {
    if (!(art && catalog && c.ref.kind == Ref::Kind::work && c.picture && !c.pictureFull)) return;
    c.pictureFull = true;
    int id = c.id;
    const Work& work = catalog->works[c.ref.index];
    // NOTE(port): a Task in the Swift: the picture is read off the main thread's time and what
    // follows runs when it is there, a few frames on, the atlas's small picture showing until
    // then. Here the file is unpacked on a background thread (`Art::fullReady` asks for it), and
    // `update` calls `finishFull` on the first frame it is there. What follows is as the Swift has
    // it, the checks that the card is still there and still wants it included.
    if (!art->fullReady(work)) {
        if (std::find(fullWaiting.begin(), fullWaiting.end(), id) == fullWaiting.end()) fullWaiting.push_back(id);
        touch(time + 0.6);          // keep frames coming until it lands
        return;
    }
    finishFull(id);
}

/// The second half of `showFull`: the picture is there.
void OceanModel::finishFull(int id) {
    CardRef found = card(id);
    if (!(art && catalog && found && found->ref.kind == Ref::Kind::work)) return;
    const Work& work = catalog->works[found->ref.index];
    TextureRef texture = art->fullTexture(work);
    {
        CardRef c = card(id);
        if (!(c && c->pictureFull && c->picture)) return;
        EntityRef e = c->picture;
        if (!texture) {
            c->pictureFull = false;
            return;
        }
        Vec2 size = art->workPicture(work, true);
        e->model = ModelComponent{Mesh::generatePlane(size.x, size.y), {art->pictureMaterial(texture)}};
        c->remade(e);
        touch(time + 0.2);          // a bent card bends its new picture on the next frame
        fullPictures.erase(std::remove(fullPictures.begin(), fullPictures.end(), id), fullPictures.end());
        fullPictures.push_back(id);
        while (int(fullPictures.size()) > fullKept) {
            int old = fullPictures.front();
            fullPictures.erase(fullPictures.begin());
            CardRef oc = card(old);
            if (!(oc && oc->ref.kind == Ref::Kind::work && !(tree && tree->focus() == old))) continue;
            const Work& w = catalog->works[oc->ref.index];
            if (MeshRef mesh = art->workMesh(w, art->workPicture(w, true))) {
                if (std::optional<Material> m = art->workAtlasMaterial()) {
                    if (oc->picture) oc->picture->model = ModelComponent{mesh, {*m}};
                }
            }
            oc->pictureFull = false;
        }
    }
}

/// How a node shows, given where you stand in the tree and what is in focus.
OceanModel::Look OceanModel::style(const TreeNode& n, const Tree& tree) const {
    Seat at = tree.seat(n);
    // Put away: gathered small into the card it came back to.
    if (!at.visible) return Look{0.15f, 0, 0, false};
    // In a condensed group: as small as its place there makes it. A pinch on it goes to the group's layer.
    if (tree.condensed(n)) return Look{at.scale, 1, 0, true};
    std::optional<int> focus = tree.focus();
    if (focus == n.id) return Look{1, 1, 1, true};
    bool beside = focus.has_value() && n.parent == focus;
    // A tag still beside its card shows only while that card is open.
    if (n.chip) return Look{1, beside ? 1.f : 0.f, 0, beside};
    if (at.depth == tree.standDepth()) {
        // On the layer you work on: with nothing in focus every card is whole; with one, the other groups stand back a little.
        if (!focus || beside || n.id == tree.stand) return Look{1, 1, 0, true};
        return Look{0.8f, 1, 0, true};
    }
    // On an earlier layer: the path's own card is a step, shown as its number and name; the rest small.
    if (n.head && routeIndex(tree, n.id) >= 0 && tree.generation(n.id) == at.depth) return Look{1.2f, 1, 0, true, 0, 1};
    return Look{0.62f, 1, 0, true};
}

void OceanModel::setHit(CardView& c, const Look& look) {
    if (look.pickable) {
        const TreeNode* n = tree ? find(*tree, c.id) : nullptr;
        if (n && n->head && tree->folded(*n) && look.open < 0.5f) {
            // The middle card of a condensed group: a pinch anywhere on the group lands on it.
            int level = std::max(1, tree->generation(c.id) - tree->standDepth());
            Box room = tree->foot(*n, look.scale, level).grown(0.03f);
            float inv = 1 / std::max(look.scale, 0.01f);
            Vec2 size = (room.hi - room.lo) * inv, mid = (room.hi + room.lo) / 2 * inv;
            c.root->collision = {Shape::generateBox({size.x, size.y, 0.01f}).offsetBy(Vec3{mid.x, mid.y, -0.004f})};
        } else if (look.open > 0.5f) {
            // Open: the picture itself.
            c.root->collision = {Shape::generateBox({c.openBody.x, c.openBody.y, 0.01f})};
        } else {
            Vec2 s = vmax((look.label > 0.5f ? c.stepBody : c.smallBody) * look.scale, Vec2::repeating(0.06f));
            // The box is in the card's own space, which is scaled with it.
            float inv = 1 / std::max(look.scale, 0.01f);
            c.root->collision = {Shape::generateBox({s.x * inv, s.y * inv * 1.5f, 0.01f}).offsetBy(Vec3{0, -s.y * inv * 0.25f, 0})};
        }
        c.root->inputTarget = true;
        // Looked at, a card in the tree is lit around its edge, not across its face.
        c.root->hover = gazeMaterial ? Art::gaze() : Art::hover();
    } else {
        c.root->inputTarget = false;
        c.root->hover = Hover::none();
    }
}

/// Moves every card to how it should look from where you stand.
void OceanModel::restyle(bool stirring) {
    if (!(tree && art && catalog)) return;
    const Tree& tree = *this->tree;
    double now = time;
    std::optional<int> focus = tree.focus();
    const TreeNode* current = focus ? find(tree, *focus) : nullptr;
    // (`let path = Set(tree.path)`)
    std::vector<int> path = tree.path();
    if (zoomedFor != focus) {
        zoomedFor = focus;
        if (zoom.target() != 0) zoom.go(0, now, Pace::grow, Ease::out);
    }
    // A change of layer moves everything, so everything about it glides
    // together: where cards are, how large, how bright.
    bool moving = focusLevel.target() != float(tree.standDepth()) || panStand != tree.stand;
    std::vector<LayerFrame> frames = layerFrames(tree);
    Vec2 to = panTarget(tree);
    if (distance(pan.target(), to) > 0.004f) {
        pan.go(to, now, Pace::step, Ease::glide);
        wakeGrid(double(Pace::step));
    }
    if (moving) wakeGrid(double(Pace::step) + 0.1);
    panStand = tree.stand;
    settleSheets(tree, frames, now);
    focusLevel.go(float(tree.standDepth()), now, Pace::step, Ease::glide);
    float pace = moving ? Pace::step : Pace::grow;
    Ease ease = moving ? Ease::glide : Ease::out;
    touch(now + double(Pace::step));
    // (In the order of their ids; a Swift dictionary has none.)
    for (const auto& [nid, n] : tree.nodes) {
        const CardRef& held = card(n.id);
        if (!held) continue;
        CardView& c = *held;
        seatCard(c, n);     // NOTE(port): added for Quest (core/cards).
        Look look = style(n, tree);
        Rest at = rest(n, tree, &frames);
        c.step = n.head && routeIndex(tree, n.id) >= 0 && !tree.folded(n);
        c.lit = !n.chip;
        if (c.float_.target() != at.float_) c.float_.go(at.float_, now, Pace::step, Ease::glide);
        Vec3 colour = tree.color(n.id);
        if (distance(c.tint.target(), colour) > 0.004f) c.tint.go(colour, now, 0.9f, Ease::inOut);
        if (distance(c.xy.target(), at.xy) > 1e-4f) c.xy.go(at.xy, now, Pace::step, Ease::glide);
        if (c.plane.target() != float(at.depth)) c.plane.go(float(at.depth), now, Pace::step, Ease::glide);
        if (std::fabs(c.pb.target() - at.pan) > 1e-4f) c.pb.go(at.pan, now, Pace::step, Ease::glide);
        if (c.scale.target() != look.scale) c.scale.go(look.scale, now, pace, ease);
        if (look.alpha > 0 && !c.built && look.open < 0.5f && std::find(buildQueue.begin(), buildQueue.end(), n.id) == buildQueue.end()) {
            buildQueue.push_back(n.id);
        }
        if (c.alpha.target() != look.alpha) {
            if (look.alpha > 0) {
                c.alpha.go(look.alpha, now, std::min(pace, 0.4f), Ease::out);
            } else {
                // Folding away: it gathers into its layer's first card, and is gone only as it gets there.
                c.alpha.go(0, now, double(Pace::step) * 0.45, Pace::step * 0.4f, Ease::out);
            }
        }
        if (c.dim.target() != look.dim) c.dim.go(look.dim, now, 0.3f, Ease::out);
        if (look.label > 0.5f) {
            int d = routeIndex(tree, n.id);
            if (d >= 0) buildStep(c, d + 1, catalog->short_(n.ref));
        }
        if (c.stepMix.target() != look.label) c.stepMix.go(look.label, now, pace, ease);
        // Its thread fills in when it is confirmed, and thickens when it joins the path.
        float solid = n.kept ? 1 : 0, on = std::find(path.begin(), path.end(), n.id) != path.end() ? 1 : 0;
        if (c.solid.target() != solid) c.solid.go(solid, now, 0.3f, Ease::out);
        if (c.onPath.target() != on) c.onPath.go(on, now, 0.45f, Ease::out);
        if (c.openMix.target() != look.open) {
            if (look.open > 0.5f) {
                buildSmall(c);
                buildOpen(c, n);
                showFull(c);
                // NOTE(port): added for Quest. Each time a card opens, its panel stands at its top (core/cards).
                scrollCard(c, 0);
            }
            c.openMix.go(look.open, now, Pace::grow, Ease::out);
        }
        setHit(c, look);
        // A condensed group moves aside as one, with the card it stands on.
        const TreeNode* mover = &n;
        while (tree.condensed(*mover) && mover->parent) {
            const TreeNode* host = find(tree, *mover->parent);
            if (!host) break;
            mover = host;
        }
        Vec2 aside = look.alpha > 0 ? nudge(*mover, tree) : Vec2::zero();
        if (distance(c.nudge.target(), aside) > 0.004f) c.nudge.go(aside, now, Pace::step, Ease::glide);
        // A step of the path carries its number.
        std::string key;
        if (n.head) {
            int d = routeIndex(tree, n.id);
            if (d >= 0 && !tree.folded(n)) key = fmt("%d:%s", d + 1, n.id == tree.stand ? "true" : "false");
        }
        // An earlier step carries its number in its name; nothing hidden carries one.
        if (look.alpha <= 0 || look.label > 0.5f) key = "";
        if (key != c.badgeKey) {
            c.badgeKey = key;
            if (c.badge) fadeOut(c.badge, 0.18f);
            c.badge = nullptr;
            std::optional<Piece> piece;
            if (!key.empty() && n.head) {
                int d = routeIndex(tree, n.id);
                if (d >= 0) piece = art->badge(d + 1, n.id == tree.stand);
            }
            if (piece) {
                EntityRef b = art->quad(*piece);
                c.root->addChild(b);
                c.badge = b;
                c.refresh();
                fadeIn(b, 0, 0.22f);
            }
        }
        touch(c.settles());
    }
    if (focus) {
        if (CardRef c = card(*focus); c && c->openBuilt) buildRows(*c);
    }
    // The open card's video plays; nothing else does.
    std::optional<int> film;
    if (current && !pressing) {
        switch (current->ref.kind) {
        case Ref::Kind::film:
            film = current->ref.index;
            break;
        case Ref::Kind::note:
            if (auto note = catalog->notes.find(current->ref.id); note != catalog->notes.end()) film = note->second.clip;
            break;
        case Ref::Kind::work:
        case Ref::Kind::tag:
            break;
        }
        // NOTE(port): added for Quest. A card plays its film where its picture is, so not on a page without it (core/cards).
        if (CardRef c = card(current->id); c && c->layout && !c->layout->picture) film = std::nullopt;
    }
    if (film && current) {
        if (screenNode != current->id) {
            screen->hide();
            screenNode = current->id;
            int id = current->id;
            after(double(Pace::step) + 0.05, [this, id, film = *film] {
                if (!(this->tree && this->tree->focus() == id && !pressing)) return;
                CardRef c = card(id);
                if (!(c && library && film >= 0 && film < int(library->clips.size()))) return;
                PictureFrame frame = pictureFrame(*c);
                screen->show(film, library->fullURL(library->clips[film]), frame.size, c->openHolder, frame.center);
                // NOTE(port): added for Quest. An agent's card's poster has round corners, and the film over it takes them (core/cards).
                if (cards::ocean::cardOf(c->ref)) {
                    if (std::optional<Piece> round = cards::ocean::corners(*art, frame.size)) screen->cover(art->quad(*round));
                }
                if (auto mark = marks.find(id); mark != marks.end() && mark->second.kind == Mark::Kind::time) {
                    screen->loop(Screen::Span{mark->second.from, mark->second.to});
                }
            });
        }
    } else {
        screen->hide();
        screenNode = std::nullopt;
    }
    rebuildStrip();
    logState();
    if (stirring) stir();
    if (standingSpot) shelfDirty = true;
}

/// Where the view should rest. It never jumps to a new layer's first
/// card: starting a layer moves nothing sideways. It moves only as far
/// as it must to keep the card in focus comfortably near the middle;
/// zoomed into a card, that card is the middle.
Vec2 OceanModel::panTarget(const Tree& tree) const {
    const TreeNode* current = find(tree, tree.current);
    Vec2 here = current ? rest(*current, tree).xy : Vec2::zero();
    if (tree.focused && zoom.target() > 0.01f) return here;
    Vec2 reach{0.42f, 0.2f};
    Vec2 off = here - pan.target();
    return pan.target() + (off - clamp(off, -reach, reach));
}

/// Where the picture sits on an open card, in the card's own meters: a
/// film's is the card itself, a note's is the top of it.
OceanModel::PictureFrame OceanModel::pictureFrame(const CardView& c) const {
    if (!(c.layout && c.layout->picture)) return PictureFrame{Vec2::zero(), c.openBody};
    const NoteLayout& layout = *c.layout;
    CGRect r = *layout.picture;
    return PictureFrame{layout.meters(CGPoint(r.midX(), r.midY())), {r.width() / Art::ppm, r.height() / Art::ppm}};
}

void OceanModel::logState() {
    if (!tree || !catalog) return;
    const Tree& tree = *this->tree;
    int standDepth = tree.standDepth();
    std::string steps;
    bool any = false;
    for (size_t i = 0; i < tree.route.size(); i++) {
        const TreeNode* n = find(tree, tree.route[i]);
        if (!n) continue;
        if (any) steps += " > ";
        any = true;
        steps += (int(i) == standDepth ? "[" : "") + catalog->short_(n->ref) + (int(i) == standDepth ? "]" : "");
    }
    std::optional<int> focus = tree.focus();
    const TreeNode* focused = focus ? find(tree, *focus) : nullptr;
    std::string open = focused ? catalog->short_(focused->ref) : "nothing";
    int onLayer = 0, groups = 0, small = 0, away = 0;
    for (const auto& [id, n] : tree.nodes) {
        std::optional<Tree::Place> shown = tree.shown(n);
        if (shown && shown->depth == standDepth && !n.chip) {
            onLayer += 1;
            if (tree.condensed(n)) small += 1;
        }
        if (n.head && tree.generation(n.id) == standDepth) groups += 1;
        if (!shown) away += 1;
    }
    logLine(fmt("[ocean] layers: %s | in focus: %s | %d on this layer in %d groups, %d condensed onto it, %d put away, %d nodes", steps.c_str(),
                open.c_str(), onLayer - small, groups, small, away, int(tree.nodes.size())));
}
