// Port of visionos/MindPalace/Ocean/OceanModel.swift: `// MARK: - Starting, picking, layers`,
// `// MARK: - Placing by hand`, `// MARK: - Marking` and `// MARK: - The ocean: peeking and bringing in`.
#include "oceanmodel.h"

#include <cmath>
#include <cstdlib>

#include "../cards/ocean.h"

// MARK: - Starting, picking, layers

/// Stands a tree up out of the ocean.
void OceanModel::stand(TreeRef t) {
    tree = t;
    pressing = false;
    marks.clear();
    t->focus(t->current);           // a tree kept with nothing in focus gets its suggestions back
    const TreeNode* current = find(*t, t->current);
    pan.set(current ? rest(*current, *t).xy : Vec2::zero());
    sheetStates.clear();
    panStand = t->stand;
    focusLevel.set(float(t->standDepth()));
    std::vector<const TreeNode*> order;
    for (const auto& [id, n] : t->nodes) order.push_back(&n);
    std::stable_sort(order.begin(), order.end(), [](const TreeNode* a, const TreeNode* b) {
        int ah = a->head ? 0 : 1, bh = b->head ? 0 : 1;
        if (ah != bh) return ah < bh;
        int ao = a->opened ? 0 : 1, bo = b->opened ? 0 : 1;
        if (ao != bo) return ao < bo;
        return a->id < b->id;
    });
    // NOTE(port): changed for Quest. The Swift makes every card here, in the one frame, each to appear a
    // little after the last. Making them is what takes the time (each measures its text), and a tree of
    // forty cards held the headset's frame for two. Here each is given the moment it is due, and they are
    // made over the next few frames, a few milliseconds' worth at a time and always before they are due
    // (`standMore`): what is seen is the same, card after card.
    standQueue.clear();
    standNext = 0;
    standTree = t.get();
    for (size_t i = 0; i < order.size(); i++) {
        standQueue.push_back(StandWaiting{order[i]->id, time + 0.02 + double(std::min(int(i), 40)) * Pace::stagger * 0.8});
    }
    standMore();
}

/// Makes the next cards of a tree that has just been stood up, for as long as this frame can spare.
void OceanModel::standMore() {
    if (standNext >= standQueue.size()) return;
    if (!tree || tree.get() != standTree) {
        standQueue.clear();
        standNext = 0;
        return;
    }
    static const double budget = Flags::number("standBudget") > 0 ? Flags::number("standBudget") : 3;      // ms a frame
    double began = mediaTime();
    while (standNext < standQueue.size()) {
        StandWaiting next = standQueue[standNext++];
        const TreeNode* n = find(*tree, next.id);
        if (n && !card(next.id)) makeCard(*n, std::max(0.02, next.due - time));
        if ((mediaTime() - began) * 1000 > budget) break;
    }
    touch(time + 0.3);
    if (standNext >= standQueue.size()) {
        standQueue.clear();
        standNext = 0;
        restyle();
    }
}

void OceanModel::startBrief(int i) {
    if (!(catalog && i >= 0 && i < int(catalog->briefs.size()))) return;
    std::optional<Ref> ref = Ref::make(catalog->briefs[i].root);
    if (!ref) return;
    Brief brief = catalog->briefs[i];
    clearPeek();
    whenClear([this, ref = *ref, brief] {
        if (!catalog) return;
        standingSpot = std::nullopt;
        stand(std::make_shared<Tree>(ref, brief.title, Maker::gardener, catalog));
    });
}

/// Runs `next` once no tree stands: at once, or after the standing one
/// has pressed itself back onto the shelf.
void OceanModel::whenClear(std::function<void()> next) {
    if (!tree) {
        next();
    } else {
        pressTree(false);
        after(double(Pace::press) + 0.25, std::move(next));
    }
}

/// A pinch on a card asks about it: it rises to the next layer and
/// opens there, the gardener thinks for a moment, and what it brings
/// comes up round the card. A card already asked about is gone back to.
/// A pinch anywhere on a condensed group goes to that group's layer.
void OceanModel::take(int id) {
    if (!tree) return;
    const TreeNode* node = find(*tree, id);
    if (!node || pressing) return;
    int target = id;
    if (tree->condensed(*node) && !node->head && node->parent) target = *node->parent;
    const TreeNode* asked = find(*tree, target);
    bool fresh = asked ? asked->children.empty() : true;
    Tree::Change moved = tree->focus(target);
    if (fresh && !moved.added.empty()) {
        think(target, Pace::think);
        arrive(moved.added, double(Pace::think));
    } else {
        arrive(moved.added);
    }
    restyle();
}

/// While the gardener works on a card, a word above it says so.
void OceanModel::think(int id, float seconds) {
    if (!art) return;
    CardRef c = card(id);
    if (!c) return;
    std::optional<Piece> piece = art->line("Thinking…", Art::Size::label, Font::Weight::medium, Color::white(1, 0.9f));
    if (!piece) return;
    EntityRef e = art->quad(*piece);
    e->position = {0, c->openBody.y / 2 + 0.03f, 0.004f};
    c->root->addChild(e);
    fadeIn(e, 0.3, 0.3f);
    after(double(seconds), [this, e] { fadeOut(e, 0.3f); });
}

/// Cards for what the gardener just suggested, one after another.
void OceanModel::arrive(const std::vector<int>& added, double delay) {
    if (!tree) return;
    for (size_t i = 0; i < added.size(); i++) {
        if (const TreeNode* n = find(*tree, added[i])) makeCard(*n, delay + double(i) * Pace::stagger);
    }
}

/// Cards that have left the tree go back where they came from: films
/// to their place in the ocean, the rest into the card they hung from
/// (or, cut away, down into the water).
void OceanModel::dismiss(const std::vector<TreeNode>& gone, bool cut) {
    double now = time;
    for (size_t i = 0; i < gone.size(); i++) {
        const TreeNode& n = gone[i];
        marks.erase(n.id);
        auto found = cards.find(n.id);
        if (found == cards.end()) continue;
        CardRef c = found->second;
        cards.erase(found);
        double delay = double(i) * 0.02;
        CardRef parent = !cut && n.parent ? card(*n.parent) : nullptr;
        if (c->home && shell) {
            int h = *c->home;
            c->source = shell->center(h);
            c->sourceScale = shell->width(h) / c->smallBody.x;
        } else if (parent) {
            c->source = parent->position;
            c->sourceScale = 0.1f;
        } else {
            c->source = c->position + stage.f * 0.3f - stage.u * 0.45f;
            c->sourceScale = 0.05f;
        }
        c->drag.go(Vec3::zero(), now, 0.12f);
        c->emerge.go(0, now, delay, Pace::leave + 0.08f, Ease::inOut);
        c->alpha.go(!c->home ? 0 : c->alpha.target(), now, delay, Pace::leave, Ease::out);
        c->goneAt = now + delay + double(Pace::leave) + 0.1;
        c->root->inputTarget = false;
        leaving.push_back(c);
        touch(c->goneAt);
    }
    buildQueue.erase(std::remove_if(buildQueue.begin(), buildQueue.end(), [&](int id) { return cards.count(id) == 0; }), buildQueue.end());
    for (auto ghost = ghosts.begin(); ghost != ghosts.end();) {
        if (cards.count(ghost->first) == 0) ghost = ghosts.erase(ghost); else ++ghost;
    }
}

/// On a pinch at nothing: out of a zoom, then out of the focus (the card closes, and its group draws in).
void OceanModel::stepOut() {
    if (peek) {
        clearPeek();
        return;
    }
    if (!tree || pressing) return;
    if (zoom.target() > 0.01f) {
        setZoom(0, 0.7f);
        return;
    }
    if (!tree->focused) return;
    tree->unfocus();
    logLine("[ocean] stepped out of the focus");
    restyle(false);
}

void OceanModel::goTo(int head) {
    if (!tree || pressing) return;
    std::optional<Tree::Change> moved = tree->go(head);
    if (!moved) return;
    dismiss(moved->gone);
    arrive(moved->added, 0.5);
    restyle();
}

/// Into the open card: each pinch on it brings it up a size, until it
/// fills much of the view; one more lets it back. What hangs from it
/// moves out of its way.
void OceanModel::zoomIn() {
    float next = zoom.target() < 0.2f ? 0.45f : (zoom.target() < 0.7f ? 1.f : 0.f);
    setZoom(next, 0.7f);
}

void OceanModel::setZoom(float z, float over) {
    if (!tree || pressing) return;
    if (!tree->focused) return;
    zoom.go(std::min(1.f, std::max(0.f, z)), time, over, over > 0.2f ? Ease::glide : Ease::out);
    // Zoomed into, the card comes to the middle.
    Vec2 to = panTarget(*tree);
    if (distance(pan.target(), to) > 0.004f) {
        pan.go(to, time, std::max(over, 0.5f), Ease::glide);
        wakeGrid(double(std::max(over, 0.5f)));
    }
    touch(time + double(std::max(over, 0.5f)) + 0.1);
    // Everything else keeps clear of the card at its new size.
    for (const auto& [id, n] : tree->nodes) {
        if (!(n.id != tree->current && n.parent != tree->current)) continue;
        const CardRef& c = card(n.id);
        if (!(c && c->alpha.target() > 0)) continue;
        Vec2 aside = nudge(n, *tree);
        if (distance(c->nudge.target(), aside) > 0.004f) c->nudge.go(aside, time, 0.7f, Ease::glide);
    }
}

/// Puts one of the open card's questions to the gardener.
void OceanModel::askGardener(int nodeID, int k) {
    if (!(tree && catalog && tree->focus() == nodeID)) return;
    CardRef c = card(nodeID);
    if (!(c && k >= 0 && k < int(c->asks.size()) && !pressing)) return;
    std::optional<OceanNote> note = catalog->answer(c->asks[k], c->ref, tree->held());
    if (!note) return;
    logLine("[ocean] asked: " + c->asks[k].question);
    bring(*note, "You asked");
}

/// Asks the gardener about the part of the open card that was marked.
void OceanModel::askMark(int nodeID) {
    if (!(tree && catalog && tree->focus() == nodeID)) return;
    auto found = marks.find(nodeID);
    if (found == marks.end()) return;
    Mark mark = found->second;
    CardRef c = card(nodeID);
    if (!c || pressing) return;
    std::optional<OceanNote> note = catalog->answer(mark, c->ref, tree->held());
    if (!note) return;
    logLine("[ocean] asked about a mark: " + described(mark));
    bring(*note, "You marked");
}

/// An answer lands beside the open card and is picked: what it points
/// to grows around it, and it ties back across the tree to anything it
/// mentions that is already here.
void OceanModel::bring(const OceanNote& note, const std::string& why) {
    if (!tree) return;
    Ref ref = Ref::note(note.id);
    if (std::optional<TreeNode> there = tree->node(ref)) {
        take(there->id);
        return;
    }
    std::vector<Tree::Pointing> links;
    for (const NoteLink& link : note.links) {
        if (std::optional<Ref> to = Ref::make(link.to)) links.push_back(Tree::Pointing{*to, link.why});
    }
    std::optional<Tree::Asked> made = tree->ask(ref, links, why);
    if (!made) return;
    if (const TreeNode* n = find(*tree, made->id)) makeCard(*n, 0);
    think(made->id, Pace::think);
    arrive(made->added, double(Pace::think));
    logLine(fmt("[ocean] answer: %d new, %d ties", int(made->added.size()), int(tree->links.size())));
    restyle();
}

void OceanModel::openLink(int nodeID) {
    const CardRef& c = card(nodeID);
    if (!(c && c->ref.kind == Ref::Kind::note && catalog)) return;
    auto note = catalog->notes.find(c->ref.id);
    if (note == catalog->notes.end() || !note->second.link) return;
    const LinkSpec& link = *note->second.link;
    // (`URL(string: link.url)`: nothing that isn't an address.)
    if (link.url.empty()) return;
    logLine("[ocean] opening " + link.url);
    // `UIApplication.shared.open(url)`: on the Quest the system's browser opens over the app.
    platform::openURL(link.url);
}

void OceanModel::moveLayer(int direction) {
    if (!tree || pressing) return;
    std::optional<Tree::Change> moved = direction > 0 ? tree->stepBack() : tree->stepForward();
    if (!moved) return;
    dismiss(moved->gone);
    arrive(moved->added, 0.5);
    restyle();
}

void OceanModel::prune(int id) {
    if (!tree || pressing) return;
    std::vector<TreeNode> gone = tree->prune(id);
    if (gone.empty()) return;
    dismiss(gone, true);
    logLine(fmt("[ocean] pruned %d", int(gone.size())));
    restyle();
}

// MARK: - Placing by hand

/// Whether a card can be picked up and put somewhere else: anything on
/// the layer you work on, but for a card that has a group of its own
/// (the path may run through it) and the open card (a drag on that marks it).
bool OceanModel::movable(int id) const {
    if (!tree) return false;
    const TreeNode* n = find(*tree, id);
    if (!(n && !(tree->focus() == id) && !n->head && !n->chip && !tree->condensed(*n))) return false;
    std::optional<Tree::Place> shown = tree->shown(*n);
    return shown && shown->depth == tree->standDepth();
}

/// Lets go of a card that was carried `d` from where it was: it stays
/// there, with what hangs from it.
void OceanModel::drop(int id, const std::vector<int>& riders, Vec3 d) {
    if (!tree) return;
    const TreeNode* found = find(*tree, id);
    CardRef held = card(id);
    if (!found || !held) return;
    // (A copy, as the Swift's `n` is: the tree is about to move it.)
    TreeNode n = *found;
    // Along the sheet where the card lies, which curves around you.
    Vec2 delta{dot(d, held->right), dot(d, held->up)};
    tree->place(id, n.xy + delta / tree->spread(tree->host(id)));
    // What the carry had left over (toward you or away) eases out; the rest is now where the card is.
    Vec3 left = d - (held->right * delta.x + held->up * delta.y);
    std::vector<LayerFrame> frames = layerFrames(*tree);
    // (`for m in [id] + riders`)
    auto settle = [&](int m) {
        const CardRef& c = card(m);
        const TreeNode* node = find(*tree, m);
        if (!c || !node) return;
        c->xy.set(rest(*node, *tree, &frames).xy);
        c->drag.set(left);
        c->drag.go(Vec3::zero(), time, 0.15f, Ease::out);
    };
    settle(id);
    for (int m : riders) settle(m);
    touch(time + 0.3);
    logLine("[ocean] placed " + (catalog ? catalog->short_(n.ref) : std::string()) + fmt(" by hand, with %d more", int(riders.size())));
    restyle(false);
}

// MARK: - Marking

/// Starts a mark where a drag on the open card began: on its picture
/// (a stretch of a video, or part of a still) or on its words.
void OceanModel::markBegin(int id, Vec2 a) {
    const CardRef& held = card(id);
    if (!(held && tree && tree->focus() == id && held->openBuilt)) return;
    const CardView& c = *held;
    PictureFrame picture = pictureFrame(c);
    bool inPicture = std::fabs(a.x - picture.center.x) <= picture.size.x / 2 && std::fabs(a.y - picture.center.y) <= picture.size.y / 2;
    bool video = false;
    if (c.ref.kind == Ref::Kind::note && catalog) {
        auto note = catalog->notes.find(c.ref.id);
        if (note != catalog->notes.end() && note->second.clip) video = true;
    }
    // NOTE(port): added for Quest. A film drawn as a card has words besides its picture, and is marked as a video note is (core/cards).
    if (c.ref.kind == Ref::Kind::film && c.layout) video = true;
    if (c.ref.kind == Ref::Kind::film && !c.layout) {
        marking = Marking{id, MarkKind::time(), a, a, std::nullopt, ""};
    } else if (c.layout) {
        const NoteLayout& layout = *c.layout;
        if (layout.picture && inPicture) {
            marking = Marking{id, video ? MarkKind::time() : MarkKind::region(), a, a, std::nullopt, ""};
        } else {
            CGPoint p = layout.pixels(a);
            int k = -1;
            for (size_t i = 0; i < layout.blocks.size(); i++) {
                if (layout.blocks[i]->frame().insetBy(-10, -10).contains(p)) {
                    k = int(i);
                    break;
                }
            }
            if (k < 0) return;
            marking = Marking{id, MarkKind::words(k), a, a, std::nullopt, ""};
        }
    }
}

/// Carries the mark on to where the hand is now, and shows it.
void OceanModel::markMove(Vec2 b) {
    if (!marking) return;
    Marking m = *marking;
    CardRef held = card(m.id);
    if (!held || !art) return;
    CardView& c = *held;
    m.to = b;
    PictureFrame picture = pictureFrame(c);
    Vec2 lo = picture.center - picture.size / 2, hi = picture.center + picture.size / 2;
    if (!c.markHolder) {
        EntityRef e = Entity::make();
        e->position = {0, 0, 0.004f};
        c.openHolder->addChild(e);
        c.markHolder = e;
    }
    EntityRef holder = c.markHolder;
    auto clear = [&] {
        std::vector<EntityRef> children = holder->children;
        for (const EntityRef& child : children) child->removeFromParent();
    };
    switch (m.kind.kind) {
    case MarkKind::Kind::time: {
        // Across the picture is along the film: left edge its start, right edge its end.
        double duration = 30.0;
        if (c.ref.kind == Ref::Kind::film) duration = library ? library->clips[c.ref.index].full.duration : 30;
        if (c.ref.kind == Ref::Kind::note && catalog) {
            auto note = catalog->notes.find(c.ref.id);
            if (note != catalog->notes.end() && note->second.clip) duration = library ? library->clips[*note->second.clip].full.duration : 30;
        }
        float x0 = std::min(std::max(std::min(m.from.x, b.x), lo.x), hi.x), x1 = std::min(std::max(std::max(m.from.x, b.x), lo.x), hi.x);
        double t0 = double((x0 - lo.x) / picture.size.x) * duration, t1 = double((x1 - lo.x) / picture.size.x) * duration;
        m.made = t1 - t0 >= 0.5 ? std::optional<Mark>(Mark::time(t0, t1)) : std::nullopt;
        clear();
        float y = lo.y + 0.011f;
        EntityRef track = art->swatch(Color::white(0, 1), {picture.size.x, 0.008f}, 0.55f);
        track->position = {picture.center.x, y, 0};
        holder->addChild(track);
        EntityRef span = art->swatch(Art::hot, {std::max(x1 - x0, 0.003f), 0.008f});
        span->position = {(x0 + x1) / 2, y, 0.001f};
        holder->addChild(span);
        if (m.made) {
            if (std::optional<Piece> piece = art->line(Catalog::clock(t0) + " – " + Catalog::clock(t1), Art::Size::micro, Font::Weight::semibold,
                                                       Color::white(), Art::hot)) {
                EntityRef label = art->quad(*piece);
                label->position = {std::min(std::max((x0 + x1) / 2, lo.x + piece->size.x / 2), hi.x - piece->size.x / 2),
                                   y + 0.004f + 0.006f + piece->size.y / 2, 0.001f};
                holder->addChild(label);
            }
        }
        break;
    }
    case MarkKind::Kind::region: {
        Vec2 a = clamp(vmin(m.from, b), lo, hi), z = clamp(vmax(m.from, b), lo, hi);
        Vec2 size = z - a;
        m.made = size.x > 0.02f && size.y > 0.02f
            ? std::optional<Mark>(Mark::region(Vec2{(a.x + z.x) / 2 - lo.x, hi.y - (a.y + z.y) / 2} / picture.size, size / picture.size)) : std::nullopt;
        clear();
        if (m.made) {
            if (std::optional<Piece> piece = art->ring(size)) {
                EntityRef ring = art->quad(*piece);
                ring->position = {(a.x + z.x) / 2, (a.y + z.y) / 2, 0};
                holder->addChild(ring);
            }
        }
        break;
    }
    case MarkKind::Kind::words: {
        int k = m.kind.block;
        if (!(c.layout && k >= 0 && k < int(c.layout->blocks.size()))) break;
        const NoteLayout& layout = *c.layout;
        std::optional<TextBlock::Words> found = layout.blocks[k]->words(layout.pixels(m.from), layout.pixels(b));
        if (!found) break;
        if (found->text != m.words) {
            m.words = found->text;
            m.made = Mark::words(found->text);
            clear();
            for (const CGRect& rect : found->rects) {
                EntityRef stroke = art->swatch(Art::hot, {rect.width() / Art::ppm + 0.004f, rect.height() / Art::ppm}, 0.45f);
                Vec2 mid = layout.meters(CGPoint(rect.midX(), rect.midY()));
                stroke->position = {mid.x, mid.y, 0};
                holder->addChild(stroke);
            }
        }
        break;
    }
    }
    marking = m;
    c.changed();
    touch(time + 0.2);
}

/// The hand let go: the mark stays on the card, and can be asked about.
void OceanModel::markEnd() {
    if (!marking) return;
    Marking m = *marking;
    CardRef held = card(m.id);
    if (!held) return;
    CardView& c = *held;
    marking = std::nullopt;
    if (!m.made) {
        // Too small to mean anything: the card keeps the mark it had, or none.
        if (marks.count(m.id) == 0) {
            if (c.markHolder) c.markHolder->removeFromParent();
            c.markHolder = nullptr;
        }
        c.changed();
        return;
    }
    Mark made = *m.made;
    marks[m.id] = made;
    if (made.kind == Mark::Kind::time && screenNode == m.id) screen->loop(Screen::Span{made.from, made.to});
    buildRows(c);
    if (tree) {
        if (const TreeNode* n = find(*tree, m.id)) {
            // A row was added under the card: what sits there makes room.
            for (const auto& [id, other] : tree->nodes) {
                if (!(other.id != n->id && other.parent != n->id)) continue;
                const CardRef& oc = card(other.id);
                if (!(oc && oc->alpha.target() > 0)) continue;
                Vec2 aside = nudge(other, *tree);
                if (distance(oc->nudge.target(), aside) > 0.004f) oc->nudge.go(aside, time, Pace::grow, Ease::out);
            }
        }
    }
    touch(time + 0.6);
    logLine("[ocean] marked: " + described(made));
}

// MARK: - The ocean: peeking and bringing in

/// Where a film comes to when it is lifted for a look: up off the water, most of the way to you.
Vec3 OceanModel::peekPoint(int film) const {
    if (!shell) return Vec3::zero();
    Vec3 home = shell->homes[film];
    Vec3 away = home - stage.origin;
    float dist = std::min(2.3f, std::max(1.5f, length(away) * 0.6f));
    return stage.origin + normalize(away) * dist + stage.u * 0.16f;
}

/// Lifts a film or a work out of the ocean just far enough to see what it is.
void OceanModel::peekAt(int film) {
    if (!(art && catalog && shell && !pressing && film < catalog->pieceCount())) return;
    Ref ref = catalog->ref(film);
    if (tree) {
        if (std::optional<TreeNode> node = tree->node(ref)) {
            // Already in the tree: go to it instead.
            take(node->id);
            return;
        }
    }
    if (peek && peek->film == film) return;
    clearPeek();
    std::optional<Piece> made;
    float width = 0.2f;         // the picture's, on the peek card
    switch (ref.kind) {
    case Ref::Kind::work: {
        int i = ref.index;
        made = art->workPeek(catalog->works[i], catalog->tagsOf(film));
        width = art->workPeekWidth(catalog->works[i]);
        break;
    }
    default:
        made = art->filmPeek(catalog->clips[film], catalog->tagsOf(film));
    }
    if (!made) return;
    const Piece& piece = *made;
    EntityRef holder = Entity::make();
    holder->addChild(art->quad(piece));
    Vec3 home = shell->center(film), to = peekPoint(film);
    holder->orientation = stage.facing(to);
    holder->collision = {Shape::generateBox({piece.size.x, piece.size.y, 0.01f}).offsetBy(Vec3{piece.offset.x, piece.offset.y, 0})};
    holder->inputTarget = true;
    holder->hover = Art::hover();
    root_->addChild(holder);
    picks[holder.get()] = Pick::peek();
    float rest = length(to - stage.origin) / 2.3f * 1.6f;       // the same size to the eye wherever it stops
    MoverRef m = std::make_shared<Mover>(holder, home, shell->width(film) / width);
    m->position.go(to, time, Pace::fly, Ease::out);
    m->scale.go(rest, time, Pace::fly, Ease::out);
    movers.push_back(m);
    peek = Peek{film, m, width};
    shell->setOut(film, true);
    touch(time + double(Pace::fly));
    logLine("[ocean] peek: " + catalog->title(ref));
}

void OceanModel::clearPeek(bool returning) {
    if (!peek || !shell) return;
    Peek p = *peek;
    peek = std::nullopt;
    picks.erase(p.mover->entity.get());
    p.mover->entity->inputTarget = false;
    if (returning) {
        p.mover->position.go(shell->center(p.film), time, Pace::leave, Ease::inOut);
        p.mover->scale.go(shell->width(p.film) / p.width, time, Pace::leave, Ease::inOut);
        p.mover->removeAt = time + double(Pace::leave);
        int film = p.film;
        after(double(Pace::leave), [this, film] {
            if (!catalog) return;
            Ref ref = catalog->ref(film);
            if (!(tree && tree->node(ref)) && !(peek && peek->film == film)) {
                if (shell) shell->setOut(film, false);
            }
        });
    } else {
        p.mover->alpha.go(0, time, 0.12f);
        p.mover->removeAt = time + 0.13;
    }
    touch(time + double(Pace::leave) + 0.1);
}

/// The peeked film or work, confirmed: it joins the open card, or starts a tree of its own.
void OceanModel::bringIn(int film) {
    if (!(catalog && !pressing && film < catalog->pieceCount())) return;
    Ref ref = catalog->ref(film);
    std::optional<Peek> from = peek && peek->film == film ? peek : std::nullopt;
    std::optional<Vec3> fromPoint = from ? std::optional<Vec3>(from->mover->entity->position) : std::nullopt;
    float fromScale = from ? from->mover->scale.target() : 1.6f, fromWidth = from ? from->width : 0.2f;
    if (tree) {
        std::optional<int> id = tree->attach(ref);
        const TreeNode* n = id ? find(*tree, *id) : nullptr;
        if (!n) {
            clearPeek();
            return;
        }
        clearPeek(false);
        makeCard(*n, 0);
        if (fromPoint) {
            if (const CardRef& c = card(*id)) {
                c->source = *fromPoint;
                c->sourceScale = fromScale * fromWidth / c->smallBody.x;
            }
        }
        logLine("[ocean] brought in: " + catalog->title(ref));
        restyle();
    } else {
        clearPeek(false);
        TreeRef t = std::make_shared<Tree>(ref, catalog->short_(ref), Maker::you, catalog);
        standingSpot = std::nullopt;
        stand(t);
        if (fromPoint) {
            if (const CardRef& c = card(t->root)) {
                c->source = *fromPoint;
                c->sourceScale = fromScale * fromWidth / c->smallBody.x;
            }
        }
    }
}

// NOTE(port): the two below are not in the Swift (see the end of oceanmodel.h).

namespace {

/// A number as Swift writes one out: the fewest digits that say it exactly, and never without a point.
std::string swiftDouble(double v) {
    std::string out;
    for (int digits = 1; digits <= 17; digits++) {
        out = fmt("%.*g", digits, v);
        if (std::strtod(out.c_str(), nullptr) == v) break;
    }
    if (out.find_first_of(".en") == std::string::npos) out += ".0";
    return out;
}

std::string swiftFloat(float v) {
    std::string out;
    for (int digits = 1; digits <= 9; digits++) {
        out = fmt("%.*g", digits, double(v));
        if (std::strtof(out.c_str(), nullptr) == v) break;
    }
    if (out.find_first_of(".en") == std::string::npos) out += ".0";
    return out;
}

}  // namespace

/// How Swift writes a mark out in a line of the log (`"\(mark)"`).
std::string OceanModel::described(const Mark& mark) {
    switch (mark.kind) {
    case Mark::Kind::words:
        return "words(\"" + mark.text + "\")";
    case Mark::Kind::time:
        return "time(from: " + swiftDouble(mark.from) + ", to: " + swiftDouble(mark.to) + ")";
    case Mark::Kind::region:
        return "region(center: SIMD2<Float>(" + swiftFloat(mark.center.x) + ", " + swiftFloat(mark.center.y) + "), size: SIMD2<Float>(" +
               swiftFloat(mark.size.x) + ", " + swiftFloat(mark.size.y) + "))";
    }
    return "";
}

/// `a.lowercased() == b.lowercased()`, without making either.
///
/// NOTE(port): asked of every note's thread on every frame the tree moves, where the Swift makes
/// two strings each time. Letters of the plain alphabet are compared in place; only if either
/// string holds anything else are both made over (in capitals, which canvas.h can do), and compared.
bool OceanModel::sameLowercased(const std::string& a, const std::string& b) {
    bool plain = true;
    for (unsigned char ch : a) plain = plain && ch < 0x80;
    for (unsigned char ch : b) plain = plain && ch < 0x80;
    if (!plain) return uppercased(a) == uppercased(b);
    if (a.size() != b.size()) return false;
    auto lower = [](char ch) { return ch >= 'A' && ch <= 'Z' ? char(ch + 32) : ch; };
    for (size_t i = 0; i < a.size(); i++) {
        if (lower(a[i]) != lower(b[i])) return false;
    }
    return true;
}
