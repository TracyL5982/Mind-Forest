// The ocean's model: starting a tree, picking, layers, placing by hand, marking, and peeking
// into the ocean and bringing in from it.
#include "oceanmodel.h"

#include "../agent/bridge.h"

#include <cmath>
#include <cstdlib>

#include "../cards/ocean.h"

// MARK: - Starting, picking, layers

/// Stands a tree up out of the ocean.
void OceanModel::stand(TreeRef t) {
    tree = t;
    pressing = false;
    sound("stand");
    marks.clear();
    inks.clear();
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
    // Each card is to appear a little after the last. Making them is what takes the time (each measures its
    // text), and a tree of forty cards made in one frame held the headset's frame for two. So each is given
    // the moment it is due, and they are
    // made over the next few frames, a few milliseconds' worth at a time and always before they are due
    // (`standMore`): what is seen is the same, card after card.
    standQueue.clear();
    standNext = 0;
    standTree = t.get();
    for (size_t i = 0; i < order.size(); i++) {
        standQueue.push_back(StandWaiting{order[i]->id, time + 0.02 + double(std::min(int(i), 40)) * Pace::stagger * 0.8});
    }
    // Cards that rise out of the pictures of the cover this tree was (see
    // `unfold`) are made first and lift off in turn, a beat after the cover begins to leave.
    if (!rising.empty()) {
        std::stable_partition(standQueue.begin(), standQueue.end(), [&](const StandWaiting& w) { return rising.count(w.id) > 0; });
        for (StandWaiting& w : standQueue) {
            auto r = rising.find(w.id);
            if (r != rising.end()) w.due = time + 0.16 + 0.06 * double(r->second.order);
        }
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
        standingPlot = std::nullopt;
        stand(std::make_shared<Tree>(ref, brief.title, Maker::gardener, catalog));
    });
}

/// Runs `next` once no tree stands: at once, or after the standing one
/// has pressed itself back onto the shelf.
void OceanModel::whenClear(std::function<void()> next) {
    if (!tree) {
        next();
    } else {
        quietPress = true;          // only making way: the tree that follows is what is heard
        pressTree(false);
        quietPress = false;
        // The forest stays down between the tree that goes and the one that comes.
        standPending = true;
        after(double(Pace::press) + 0.25, [this, next = std::move(next)] {
            standPending = false;
            next();
        });
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
    guideDid("ask");
    // AGENT: in a tree the agent service grows, a click opens the card clicked, to show it in detail, folded onto another or
    // not; a layer starts from it only with a long pinch or a conversation about it (agent::Bridge). So it has its note and
    // no chord, and as no layer of cards comes to sound the layer's notes in turn, the note is the card's own on its layer.
    if (agentBridge && agentBridge->serves(*tree)) {
        soundCard(id);
        if (agentBridge->opens(id)) {
            restyle();
            return;
        }
    }
    int target = id;
    if (tree->condensed(*node) && !node->head && node->parent) target = *node->parent;
    const TreeNode* asked = find(*tree, target);
    bool fresh = asked ? asked->children.empty() : true;
    // The card's own note now; its new layer's chord a moment later, as it rises (`updateSound`).
    if (!(agentBridge && agentBridge->serves(*tree))) {
        if (const CardRef& c = card(target)) soundAt("take", c->position);
        else sound("take");
    }
    soundLayerAfter = 0.14;
    Tree::Change moved = tree->focus(target);
    if (fresh && !moved.added.empty()) {
        think(target, Pace::think);
        arrive(moved.added, double(Pace::think));
        soundNotes(int(moved.added.size()), double(Pace::think));
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
    thinkFrom = time + 0.3;
    thinkUntil = time + double(seconds);
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
        inks.erase(n.id);
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
    guideDid("out");
    if (peek) {
        soundAt("peek_return", peek->mover->entity->position);
        clearPeek();
        return;
    }
    if (!tree || pressing) return;
    if (zoom.target() > 0.01f) {
        sound("zoom_out");
        setZoom(0, 0.7f);
        return;
    }
    if (!tree->focused) return;
    // (On the welcome tree's walk a pinch that misses does not close the lesson: there would be nothing to read.)
    if (teach.tour >= 0 && onWelcomeTree()) return;
    sound("step_out");
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

/// Into the open card: a pinch on it brings it up until it fills much of
/// the view; one more lets it back. What hangs from it moves out of its way.
///
/// There are two sizes, as it opens and gone into, and gone into is where the card's marking tools are (`layTools`).
void OceanModel::zoomIn() {
    // (On the welcome tree a lesson's card has nothing in it to go into: a pinch on it is the walk's business.)
    if (zoom.target() < 0.5f && tourPinchedOpen()) return;
    guideDid("zoom");
    float next = zoom.target() < 0.5f ? 1.f : 0.f;
    if (tree && !pressing && tree->focused) sound(next > zoom.target() ? "zoom_in" : "zoom_out");
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
    if (agentBridge && agentBridge->ask(nodeID, k)) return;     // AGENT
    std::optional<OceanNote> note = catalog->answer(c->asks[k], c->ref, tree->held());
    if (!note) return;
    logLine("[ocean] asked: " + c->asks[k].question);
    sound("ask");
    soundLayerAfter = 0.3;      // the question first, then the layer its answer makes
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
    sound("ask");
    soundLayerAfter = 0.3;      // the question first, then the layer its answer makes
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
    // The question was left open; what comes back closes it, and then a note for each thing it brings.
    sound("answer", 1, double(Pace::think));
    soundNotes(int(made->added.size()), double(Pace::think) + 0.35);
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
    sound("link");
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
    if (agentBridge) agentBridge->pruned(id, gone);     // AGENT
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
    // (A copy: the tree is about to move it.)
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
    soundAt("place", held->position);
    logLine("[ocean] placed " + (catalog ? catalog->short_(n.ref) : std::string()) + fmt(" by hand, with %d more", int(riders.size())));
    restyle(false);
}

// MARK: - Marking

/// Starts a mark where a drag on the open card began: on its picture
/// (a stretch of a video, or part of a still) or on its words.
void OceanModel::markBegin(int id, Vec2 a, std::optional<Mark::Kind> only) {
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
    // With a tool picked (`markTool`) the drag makes that kind of mark
    // wherever on the card it starts, rather than the kind the place it started would suggest.
    if (only) {
        std::vector<Mark::Kind> can = markKinds(c);
        if (std::find(can.begin(), can.end(), *only) == can.end()) return;
        if (*only == Mark::Kind::time) {
            Vec2 from = a;
            // A stretch already marked is taken by whichever end the hand is at: the other end stays.
            auto had = marks.find(id);
            if (had != marks.end() && had->second.kind == Mark::Kind::time) {
                double duration = markDuration(c);
                float left = picture.center.x - picture.size.x / 2;
                float x0 = left + float(had->second.from / duration) * picture.size.x, x1 = left + float(had->second.to / duration) * picture.size.x;
                float grab = std::max(0.012f, picture.size.x * 0.07f);
                if (std::fabs(a.x - x0) < grab && std::fabs(a.x - x0) <= std::fabs(a.x - x1)) from.x = x1;
                else if (std::fabs(a.x - x1) < grab) from.x = x0;
            }
            marking = Marking{id, MarkKind::time(), from, a, std::nullopt, ""};
        } else if (*only == Mark::Kind::region) {
            // A new stroke of the marker, on top of whatever is drawn there already.
            inks[id].strokes.push_back({});
            marking = Marking{id, MarkKind::region(), a, a, std::nullopt, ""};
        } else if (c.layout) {
            // The block of words the drag starts in, or the one nearest it.
            const NoteLayout& layout = *c.layout;
            CGPoint p = layout.pixels(a);
            int k = -1;
            float nearest = 0;
            for (size_t i = 0; i < layout.blocks.size(); i++) {
                CGRect frame = layout.blocks[i]->frame();
                float off = std::max(0.f, std::max(float(frame.minY() - p.y), float(p.y - frame.maxY())));
                if (k < 0 || off < nearest) {
                    k = int(i);
                    nearest = off;
                }
            }
            if (k < 0) return;
            marking = Marking{id, MarkKind::words(k), a, a, std::nullopt, ""};
        }
        return;
    }
    // A film drawn as a card has words besides its picture, and is marked as a video note is (core/cards).
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
    // (And the other way: marking a stretch or words takes the marker's strokes off.)
    if (m.kind.kind != MarkKind::Kind::region) inks.erase(m.id);
    switch (m.kind.kind) {
    case MarkKind::Kind::time: {
        // Across the picture is along the film: left edge its start, right edge its end.
        double duration = markDuration(c);
        float x0 = std::min(std::max(std::min(m.from.x, b.x), lo.x), hi.x), x1 = std::min(std::max(std::max(m.from.x, b.x), lo.x), hi.x);
        double t0 = double((x0 - lo.x) / picture.size.x) * duration, t1 = double((x1 - lo.x) / picture.size.x) * duration;
        m.made = t1 - t0 >= 0.5 ? std::optional<Mark>(Mark::time(t0, t1)) : std::nullopt;
        drawStretch(c, x0, x1, m.made.has_value(), t0, t1);
        break;
    }
    case MarkKind::Kind::region: {
        // The drag draws, as a marker does: the line goes where the hand goes (a little steadied), and stays.
        Ink& ink = inks[m.id];
        if (ink.strokes.empty()) ink.strokes.push_back({});
        std::vector<Vec2>& stroke = ink.strokes.back();
        if (stroke.empty()) {
            // (A card has one mark: a stretch or words marked on it before give way to the marker.)
            std::vector<EntityRef> children = holder->children;
            for (const EntityRef& child : children) {
                if (child != ink.entity) child->removeFromParent();
            }
            stroke.push_back(clamp(m.from, lo, hi));
        }
        Vec2 next = stroke.back() + (clamp(b, lo, hi) - stroke.back()) * 0.6f;
        if (distance(next, stroke.back()) > picture.size.x * 0.006f && stroke.size() < 600) stroke.push_back(next);
        float drawn = 0;
        for (size_t k = 1; k < stroke.size(); k++) drawn += distance(stroke[k], stroke[k - 1]);
        // What is marked is what the strokes cover between them, this one included once it is long enough to mean something.
        Vec2 a = hi, z = lo;
        for (const std::vector<Vec2>& s : ink.strokes) {
            for (Vec2 p : s) {
                a = vmin(a, p);
                z = vmax(z, p);
            }
        }
        Vec2 size = vmax(z - a, picture.size * 0.05f);
        m.made = drawn > picture.size.x * 0.06f
            ? std::optional<Mark>(Mark::region(Vec2{(a.x + z.x) / 2 - lo.x, hi.y - (a.y + z.y) / 2} / picture.size, size / picture.size)) : std::nullopt;
        drawInk(c, ink);
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

/// A stretch's bar along the foot of the card's picture, from `x0` to `x1` (m on the face), and its times over it once
/// it is long enough to be made (`made`).
void OceanModel::drawStretch(CardView& c, float x0, float x1, bool made, double t0, double t1) {
    if (!art) return;
    PictureFrame picture = pictureFrame(c);
    Vec2 lo = picture.center - picture.size / 2, hi = picture.center + picture.size / 2;
    if (!c.markHolder) {
        EntityRef e = Entity::make();
        e->position = {0, 0, 0.004f};
        c.openHolder->addChild(e);
        c.markHolder = e;
    }
    EntityRef holder = c.markHolder;
    std::vector<EntityRef> children = holder->children;
    for (const EntityRef& child : children) child->removeFromParent();
    // The bar is thick, and each end of the stretch has a
    // handle, which is what a later drag takes it by (`markBegin`).
    float y = lo.y + 0.014f;
    EntityRef track = art->swatch(Color::white(0, 1), {picture.size.x, 0.012f}, 0.6f);
    track->position = {picture.center.x, y, 0};
    holder->addChild(track);
    EntityRef span = art->swatch(Art::hot, {std::max(x1 - x0, 0.003f), 0.012f});
    span->position = {(x0 + x1) / 2, y, 0.001f};
    holder->addChild(span);
    for (float x : {x0, x1}) {
        EntityRef handle = art->swatch(Color::white(), {0.004f, 0.026f});
        handle->position = {x, y, 0.002f};
        holder->addChild(handle);
    }
    if (made) {
        if (std::optional<Piece> piece = art->line(Catalog::clock(t0) + " – " + Catalog::clock(t1), Art::Size::micro, Font::Weight::semibold,
                                                   Color::white(), Art::hot)) {
            EntityRef label = art->quad(*piece);
            label->position = {std::min(std::max((x0 + x1) / 2, lo.x + piece->size.x / 2), hi.x - piece->size.x / 2),
                               y + 0.013f + 0.006f + piece->size.y / 2, 0.001f};
            holder->addChild(label);
        }
    }
    c.changed();
}

/// The hand let go: the mark stays on the card, and can be asked about.
void OceanModel::markEnd() {
    if (!marking) return;
    Marking m = *marking;
    CardRef held = card(m.id);
    if (!held) return;
    CardView& c = *held;
    marking = std::nullopt;
    if (m.made) guideDid("mark");
    if (m.kind.kind == MarkKind::Kind::region && !m.made) {
        // A dab too short to be a stroke is taken off again; what was drawn before it stays.
        auto ink = inks.find(m.id);
        if (ink != inks.end() && !ink->second.strokes.empty()) {
            ink->second.strokes.pop_back();
            drawInk(c, ink->second);
        }
    }
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
    sound("mark_made");
    // A service card keeps its video's stretch with the service.
    if (made.kind == Mark::Kind::time && c.highlights) keepStretch(c, made);
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

// MARK: - Marking tools

// , where a drag on the open card marks it.

std::vector<Mark::Kind> OceanModel::markKinds(const CardView& c) const {
    if (c.ref.kind == Ref::Kind::film) return {Mark::Kind::time};
    std::vector<Mark::Kind> kinds;
    if (!c.layout) return kinds;
    bool video = false;
    if (c.ref.kind == Ref::Kind::note && catalog) {
        auto note = catalog->notes.find(c.ref.id);
        if (note != catalog->notes.end() && note->second.clip) video = true;
    }
    // (A lesson's stage in the welcome tree is where a gesture plays, not a picture to draw on.)
    bool stage = false;
    if (c.ref.kind == Ref::Kind::note && catalog) {
        auto note = catalog->notes.find(c.ref.id);
        stage = note != catalog->notes.end() && note->second.image && note->second.image->rfind("gesture:", 0) == 0;
    }
    if (c.layout->picture && !stage) kinds.push_back(video ? Mark::Kind::time : Mark::Kind::region);
    if (!c.layout->blocks.empty()) kinds.push_back(Mark::Kind::words);
    return kinds;
}

double OceanModel::markDuration(const CardView& c) const {
    double duration = 30.0;
    if (c.ref.kind == Ref::Kind::film) duration = library ? library->clips[c.ref.index].full.duration : 30;
    if (c.ref.kind == Ref::Kind::note && catalog) {
        auto note = catalog->notes.find(c.ref.id);
        if (note != catalog->notes.end() && note->second.clip) duration = library ? library->clips[*note->second.clip].full.duration : 30;
    }
    return std::max(duration, 0.1);
}

/// Beside the card gone into, what it can be marked with: a button each, the one in hand lit, and one
/// to take the mark off again when there is one. They come with the card going in and go as it comes
/// back, and keep their own size whatever size the card is.
void OceanModel::layTools() {
    std::optional<int> focus = tree && !pressing ? tree->focus() : std::nullopt;
    CardRef c = focus && zoom.target() > 0.5f ? card(*focus) : nullptr;
    if (c && !c->openBuilt) c = nullptr;
    if (c && markKinds(*c).empty()) c = nullptr;
    if (!c && penOn) {
        penOn = false;
        logLine("[ocean] the pen is put down: its card was left");
    }
    std::string key = c ? fmt("%d|%d|%d", *focus, penOn ? 1 : 0, marked(*focus) ? 1 : 0) : "";
    if (key != toolsKey && art) {
        toolsKey = key;
        for (const Entity* e : toolPicks) picks.erase(e);
        toolPicks.clear();
        toolTags.clear();
        toolsMadeAt = time;
        if (tools) {
            for (const EntityRef& child : tools->children) child->inputTarget = false;
            fadeOut(tools, 0.15f);
            tools = nullptr;
        }
        if (c) {
            // A column of three, down from the picture's top right corner and just outside it: the pen, the
            // eraser, and send. The pen is the one the marking gesture's diagram draws, and in hand it lights in
            // the accent as it does there; send turns light once there is something to send; what cannot be
            // used yet is faint.
            EntityRef holder = Entity::make();
            bool marked = this->marked(*focus);
            const Color rest = Color::hex(0x20252E);
            auto add = [&](const char* icon, int what, Color ground, Color mark, const char* says) {
                std::optional<Piece> piece = art->iconButton(icon, toolSize, ground, mark);
                if (!piece) return;
                EntityRef e = art->quad(*piece);
                e->position = {toolSize / 2, -toolSize / 2 - float(what) * (toolSize + toolGap), 0};
                // Its tag: a flat label like every other in the app, behind the button until it is pointed at.
                if (std::optional<Piece> label = art->line(says, toolSize * 0.32f, Font::Weight::semibold, Color::white(), Art::ink, {toolSize * 0.26f, toolSize * 0.31f})) {
                    EntityRef tag = art->quad(*label);
                    tag->position = {e->position.x, e->position.y, -0.002f};
                    tag->opacity = 0.f;
                    tag->isEnabled = false;
                    holder->addChild(tag);
                    toolTags.push_back(ToolTag{e, tag, label->size.x});
                }
                e->collision = {Shape::generateBox({toolSize + toolGap, toolSize + toolGap, 0.01f})};
                e->inputTarget = true;
                e->hover = Art::hover();
                picks[e.get()] = Pick::tool(*focus, what);
                toolPicks.push_back(e.get());
                holder->addChild(e);
            };
            add("marker", 0, penOn ? Art::hot : rest, Color::white(), "Comment");
            add("eraser", 1, rest, Color::white(1, marked ? 1 : 0.32f), "Erase");
            add("send", 2, marked ? Art::paper : rest, marked ? Art::ink : Color::white(1, 0.32f), "Send to Momo");
            toolsTall = 3 * toolSize + 2 * toolGap;
            c->openHolder->addChild(holder);
            fadeIn(holder, 0.3, 0.3f);
            tools = holder;
        }
    }
    // A card's bend changes as it goes in and comes back, and as its layer moves: its marker strokes are bent again to match.
    for (auto& [id, ink] : inks) {
        auto found = cards.find(id);
        if (found != cards.end() && found->second && ink.entity && ink.entity->parent && std::fabs(found->second->curve - ink.curve) > 1e-4f) {
            drawInk(*found->second, ink);
        }
    }
    if (tools && c) {
        // (They keep their own size while the card grows: the holder is the card's, scaled back.)
        PictureFrame picture = pictureFrame(*c);
        float size = std::max(0.05f, length(c->openHolder->transformMatrix(nullptr).columns[0].xyz()));
        tools->scale = Vec3::repeating(1 / size);
        tools->position = {picture.center.x + picture.size.x / 2 + 0.016f / size, picture.center.y + picture.size.y / 2, 0.006f};
        // The tags: out to the right of whichever button a ray rests on, and back when it leaves.
        // (`-toolHover <0…2>` holds one out, for looking at it without hands.)
        static const int held = Flags::has("toolHover") ? Flags::integer("toolHover") : -1;
        float dt = float(std::min(0.1, std::max(0.0, time - toolsLast)));
        bool moving = false;
        for (size_t k = 0; k < toolTags.size() && k < 3; k++) {
            ToolTag& t = toolTags[k];
            bool on = t.button->hovered > 0.05f || int(k) == held;
            // (Made again a moment ago, as when the pen is taken up: it has not been seen to be pointed at yet.)
            if (time - toolsMadeAt < 0.3 && toolOut[k] > 0.5f) on = true;
            float was = toolOut[k];
            toolOut[k] += ((on ? 1.f : 0.f) - toolOut[k]) * std::min(1.f, 14 * dt);
            if (std::fabs(toolOut[k] - (on ? 1.f : 0.f)) < 0.004f) toolOut[k] = on ? 1 : 0;
            if (toolOut[k] != was) moving = true;
            float u = toolOut[k] * toolOut[k] * (3 - 2 * toolOut[k]);
            t.tag->isEnabled = u > 0.01f;
            t.tag->opacity = u;
            // From behind the button to beside it: its left edge ends a little way off the button's right.
            // (As tall as the button, and close against it: the two read as one thing drawn out.)
            float tucked = t.button->position.x, out = t.button->position.x + toolSize / 2 + 0.004f + t.wide / 2;
            t.tag->position.x = tucked + (out - tucked) * u;
        }
        if (moving) {
            c->changed();
            touch(time + 0.1);
        }
    }
    toolsLast = time;
}

void OceanModel::pickTool(int id, int what) {
    if (!(tree && tree->focus() == id)) return;
    CardRef c = card(id);
    if (what == 1) {
        // The eraser. On a service card (core/cards) it takes every mark off, at the service
        // too, as one change that one undo brings back.
        if (c && c->highlights) eraseAll(*c); else clearMark(id);
        return;
    }
    if (what == 2) {
        // Send: what is marked is asked about. (A lesson of the welcome tree has nobody to ask: it is come
        // back out of, which is what its lesson waits for.) On a service (core/cards)
        // card it is a conversation with Momo about the marked part, which leads a layer.
        if (!marked(id)) return;
        penOn = false;
        // (On the walk it goes to Momo, whose answer the walk makes: `tourSend`.)
        if (c && c->ref.kind == Ref::Kind::note && c->ref.id.rfind("welcome", 0) == 0) {
            if (teach.tour >= 0 && onWelcomeTree()) tourSend(); else stepOut();
        }
        else if (c && agentBridge && agentBridge->editable(id)) agentBridge->tellMore(id, tellMoreAbout(*c));
        else askMark(id);
        return;
    }
    // The pen: taken up, or put down.
    penOn = !penOn;
    sound("place", 0.6f);
    logLine(fmt("[ocean] the pen is %s", penOn ? "taken up" : "put down"));
    // On a video, taking it up with nothing marked yet shows the bar to drag along.
    bool video = false;
    if (c) {
        std::vector<Mark::Kind> kinds = markKinds(*c);
        video = std::find(kinds.begin(), kinds.end(), Mark::Kind::time) != kinds.end();
    }
    if (c && art && penOn && video && marks.count(id) == 0 && !c->markHolder) {
        PictureFrame picture = pictureFrame(*c);
        EntityRef holder = Entity::make();
        holder->position = {0, 0, 0.004f};
        EntityRef track = art->swatch(Color::white(0, 1), {picture.size.x, 0.012f}, 0.6f);
        track->position = {picture.center.x, picture.center.y - picture.size.y / 2 + 0.014f, 0};
        holder->addChild(track);
        c->openHolder->addChild(holder);
        c->markHolder = holder;
        c->changed();
    } else if (c && !penOn && marks.count(id) == 0 && c->markHolder) {
        c->markHolder->removeFromParent();
        c->markHolder = nullptr;
        c->changed();
    }
    touch(time + 0.4);
}

/// A card's marker strokes, as one mesh on its face: each a band of the accent with a soft edge and
/// rounded-off ends, as wide as a marker's tip is against the picture.
void OceanModel::drawInk(CardView& c, Ink& ink) {
    if (!lineMaterial) return;
    const int most = 2400;      // points in all
    if (!ink.mesh) {
        LowLevelMesh::Descriptor d;
        d.vertexCapacity = 4 * (most + 64);
        d.indexCapacity = 18 * (most + 64);
        d.vertexAttributes = {{LowLevelMesh::Semantic::position, 3, offsetof(LinkVertex, position)},
                              {LowLevelMesh::Semantic::uv0, 2, offsetof(LinkVertex, rg)},
                              {LowLevelMesh::Semantic::uv1, 2, offsetof(LinkVertex, ba)}};
        d.stride = sizeof(LinkVertex);
        ink.mesh = LowLevelMesh::make(d);
        if (!ink.mesh) return;
        ink.entity = Entity::make(ink.mesh, {*lineMaterial});
        ink.entity->position = {0, 0, 0.001f};
    }
    if (!c.markHolder) {
        EntityRef e = Entity::make();
        e->position = {0, 0, 0.004f};
        c.openHolder->addChild(e);
        c.markHolder = e;
    }
    if (ink.entity->parent != c.markHolder.get()) c.markHolder->addChild(ink.entity);
    PictureFrame picture = pictureFrame(c);
    const float half = std::max(picture.size.x, picture.size.y) * 0.0065f, core = 0.62f;
    const Vec3 accent = Art::hot.linear();
    // The card is bent to its layer's curve, and the strokes with it: each point is carried to the card's
    // own space, bent there as the card's pieces are (bend.h), and brought back. (This mesh is written
    // directly, which Bend cannot cut into columns as it does the card's flat pieces.)
    Mat4 toCard = ink.entity->transformMatrix(c.root), fromCard = toCard.inverse();
    ink.curve = c.curve;
    int nv = 0, ni = 0, points = 0;
    ink.mesh->withUnsafeMutableBytes<LinkVertex>([&](LinkVertex* v, int) {
        ink.mesh->withUnsafeMutableIndices([&](uint32_t* idx, int) {
            auto section = [&](Vec2 p, Vec2 side, float alpha) {
                const float across[4] = {-1, -core, core, 1}, there[4] = {0, alpha, alpha, 0};
                for (int k = 0; k < 4; k++) {
                    Vec2 at = p + side * across[k];
                    Vec3 on = fromCard.point(Bend::drawn(toCard.point({at.x, at.y, 0}), c.curve, Bend::width(toCard)));
                    v[nv++] = LinkVertex{on, Vec2(accent.x, accent.y), Vec2(accent.z, there[k])};
                }
            };
            for (const std::vector<Vec2>& stroke : ink.strokes) {
                int n = int(stroke.size());
                if (n < 2 || points + n > most) continue;
                points += n;
                int base = nv, sections = 0;
                for (int i = 0; i < n; i++) {
                    Vec2 along = stroke[size_t(std::min(i + 1, n - 1))] - stroke[size_t(std::max(i - 1, 0))];
                    float far = length(along);
                    along = far > 1e-7f ? along / far : Vec2{1, 0};
                    Vec2 side = Vec2{-along.y, along.x} * half;
                    // Each end runs on half a width and thins away, which rounds it off.
                    if (i == 0) {
                        section(stroke[0] - along * half, side * 0.5f, 0);
                        sections++;
                    }
                    section(stroke[size_t(i)], side, 0.92f);
                    sections++;
                    if (i == n - 1) {
                        section(stroke[size_t(i)] + along * half, side * 0.5f, 0);
                        sections++;
                    }
                }
                for (int s = 0; s + 1 < sections; s++) {
                    for (int k = 0; k < 3; k++) {
                        int a = base + 4 * s + k, b = a + 4;
                        idx[ni++] = uint32_t(a);
                        idx[ni++] = uint32_t(a + 1);
                        idx[ni++] = uint32_t(b);
                        idx[ni++] = uint32_t(a + 1);
                        idx[ni++] = uint32_t(b + 1);
                        idx[ni++] = uint32_t(b);
                    }
                }
            }
        });
    });
    Vec2 lo = picture.center - picture.size / 2, hi = picture.center + picture.size / 2;
    ink.mesh->setPart(ni, BoundingBox{{lo.x, lo.y, -0.05f}, {hi.x, hi.y, 0.3f}});
    c.changed();
}

/// Takes a card's mark off: what showed it, the question it added, and a video's loop round it.
void OceanModel::clearMark(int id) {
    CardRef held = card(id);
    if (!held || marks.count(id) == 0) return;
    CardView& c = *held;
    Mark gone = marks[id];
    marks.erase(id);
    inks.erase(id);
    if (c.markHolder) c.markHolder->removeFromParent();
    c.markHolder = nullptr;
    if (gone.kind == Mark::Kind::time && screenNode == id) screen->loop(std::nullopt);
    sound("step_out", 0.6f);
    buildRows(c);
    c.changed();
    touch(time + 0.6);
    logLine("[ocean] mark removed: " + described(gone));
}

// MARK: - The ocean: peeking and bringing in

/// Where a film comes to when it is lifted for a look: up off the water, most of the way to you.
Vec3 OceanModel::peekPoint(int film, float tall) const {
    if (!shell) return Vec3::zero();
    Vec3 home = shell->homes[film];
    Vec3 away = home - stage.origin;
    float dist = std::min(2.3f, std::max(1.5f, length(away) * 0.6f));
    Vec3 to = stage.origin + normalize(away) * dist + stage.u * 0.16f;
    // Kai, 2026-11-17: "the item sometimes can get obstructed by a tree sitting on the
    // table - fly them higher so that we make sure that they can be clicked on". Its lower edge goes above the line
    // from your eyes, and from your hand under them, over the top of every tree put away that stands nearer than it
    // and not far to one side: seen past them, and pinched past them.
    Vec3 level = to - stage.origin;
    level -= stage.u * dot(level, stage.u);
    float far = length(level);
    if (far < 0.3f) return to;
    Vec3 ahead = level / far;
    float lowest = dot(to - stage.origin, stage.u) - tall / 2;     // its lower edge, m above the eyes
    float needed = lowest;
    // m: a hand's ray starts about this far under the eyes; and a part counts within this many degrees to either side of
    // the piece's middle, its half width and the hand's being off to one side.
    constexpr float hand = 0.35f, clear = 0.05f, beside = 14;
    Vec3 side = cross(ahead, stage.u);
    for (const Shelved& s : shelf) {
        // The tree and its pictures, not the rings on the ground round it.
        std::vector<EntityRef> parts{s.branches};
        for (const CoverPicture& p : s.pictures) parts.push_back(p.entity);
        for (const EntityRef& part : parts) {
            if (!(part && part->isEnabledInHierarchy())) continue;
            BoundingBox box = part->visualBounds();
            float nearest = INFINITY, top = -INFINITY, left = INFINITY, right = -INFINITY;
            for (float x : {box.min.x, box.max.x}) {
                for (float z : {box.min.z, box.max.z}) {
                    Vec3 corner = root_->convertFrom(Vec3{x, box.max.y, z}, nullptr) - stage.origin;
                    float along = dot(corner, ahead), turn = std::atan2(dot(corner, side), along) * 180 / floatPi;
                    nearest = std::min(nearest, along);
                    top = std::max(top, dot(corner, stage.u));
                    left = std::min(left, turn);
                    right = std::max(right, turn);
                }
            }
            if (nearest < 0.2f || nearest >= far || right < -beside || left > beside) continue;
            needed = std::max(needed, std::max(top * far / nearest, -hand + (top + hand) * far / nearest) + clear);
        }
    }
    return to + stage.u * (needed - lowest);
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
    // (Its card's height as large as it comes to before it is lifted clear of the trees: a little less than it ends.)
    float tall = piece.size.y * length(peekPoint(film, 0) - stage.origin) / 2.3f * 1.6f;
    Vec3 home = shell->center(film), to = peekPoint(film, tall);
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
    soundAt("peek", to);
    logLine("[ocean] peek: " + catalog->title(ref));
    Vec3 seen = to - stage.origin;
    logLine(fmt("[ocean] it comes to %.2f m off, its middle %.1f degrees up", double(length(seen)),
                double(std::asin(std::clamp(dot(normalize(seen), stage.u), -1.f, 1.f)) * 180 / floatPi)));
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
    guideDid("bring");
    Ref ref = catalog->ref(film);
    std::optional<Peek> from = peek && peek->film == film ? peek : std::nullopt;
    std::optional<Vec3> fromPoint = from ? std::optional<Vec3>(from->mover->entity->position) : std::nullopt;
    float fromScale = from ? from->mover->scale.target() : 1.6f, fromWidth = from ? from->width : 0.2f;
    if (tree && agentBridge && agentBridge->serves(*tree)) {
        // AGENT: brought into one of the service's trees, the piece is a card of the service's like every other there, with
        // its look and Momo's rows: it goes to the service, and comes back as its card. Kai's own trees take it as before.
        clearPeek();
        if (fromPoint) soundAt("bring_in", *fromPoint); else sound("bring_in");
        if (!agentBridge->addPiece(ref)) logLine("[ocean] " + catalog->title(ref) + " was not added: the service can't be reached");
    } else if (tree) {
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
        if (fromPoint) soundAt("bring_in", *fromPoint); else sound("bring_in");
        logLine("[ocean] brought in: " + catalog->title(ref));
        restyle();
    } else if (agentBridge) {
        // AGENT: joined to the service, a tree started from a piece of the ocean is the service's, as every other tree is:
        // Momo is asked for it, and it stands when it comes. Kai's own tree, its picks and its questions, is not made.
        clearPeek();
        if (!agentBridge->treeFrom(ref)) logLine("[ocean] the service can't be reached, so no tree is started on " + catalog->title(ref));
    } else {
        clearPeek(false);
        TreeRef t = std::make_shared<Tree>(ref, catalog->short_(ref), Maker::you, catalog);
        standingSpot = std::nullopt;
        standingPlot = std::nullopt;
        stand(t);
        if (fromPoint) {
            if (const CardRef& c = card(t->root)) {
                c->source = *fromPoint;
                c->sourceScale = fromScale * fromWidth / c->smallBody.x;
            }
        }
    }
}

// The two below write numbers for the log (see the end of oceanmodel.h).

namespace {

/// A number written out with the fewest digits that say it exactly, and never without a point.
std::string shortestDouble(double v) {
    std::string out;
    for (int digits = 1; digits <= 17; digits++) {
        out = fmt("%.*g", digits, v);
        if (std::strtod(out.c_str(), nullptr) == v) break;
    }
    if (out.find_first_of(".en") == std::string::npos) out += ".0";
    return out;
}

std::string shortestFloat(float v) {
    std::string out;
    for (int digits = 1; digits <= 9; digits++) {
        out = fmt("%.*g", digits, double(v));
        if (std::strtof(out.c_str(), nullptr) == v) break;
    }
    if (out.find_first_of(".en") == std::string::npos) out += ".0";
    return out;
}

}  // namespace

/// How a mark is written out in a line of the log.
std::string OceanModel::described(const Mark& mark) {
    switch (mark.kind) {
    case Mark::Kind::words:
        return "words(\"" + mark.text + "\")";
    case Mark::Kind::time:
        return "time(from: " + shortestDouble(mark.from) + ", to: " + shortestDouble(mark.to) + ")";
    case Mark::Kind::region:
        return "region(center: SIMD2<Float>(" + shortestFloat(mark.center.x) + ", " + shortestFloat(mark.center.y) + "), size: SIMD2<Float>(" +
               shortestFloat(mark.size.x) + ", " + shortestFloat(mark.size.y) + "))";
    }
    return "";
}

/// `a.lowercased() == b.lowercased()`, without making either.
///
/// Asked of every note's thread on every frame the tree moves, so no string is made for it. Letters of the plain alphabet are compared in place; only if either
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
