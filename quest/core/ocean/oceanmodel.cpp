// Port of visionos/MindPalace/Ocean/OceanModel.swift: the model itself, setup, the frame, the
// glass, the grid under the layers, what the hands are read as, the small tree by hand, panning
// by hand. (See oceanmodel.h for where the rest is.)
#include "oceanmodel.h"

#include <cmath>
#include <cstdlib>

OceanModel::~OceanModel() {
    if (handsLog) std::fclose(handsLog);
}

/// The room stays in sight, barely dimmed (`-dim 1` for not at all).
float OceanModel::surroundingsDim() {
    // NOTE(port): `UserDefaults.standard.object(forKey: "dim") as? Double ?? 0.88` in the Swift,
    // whose cast a launch argument (which arrives as text) may not pass; here `-dim` is read as
    // the number it is meant to be. `v` is the share of the room's light that is kept.
    static const double v = Flags::has("dim") ? Flags::number("dim") : 0.88;
    // (`v >= 0.999 ? nil : .colorMultiply(Color(white: v))`: what is given is the share removed.)
    return v >= 0.999 ? 0 : float(1 - v);
}

void OceanModel::start() {
    // The museum works are there or not: without them the ocean is films alone.
    std::shared_ptr<WorkLibrary> works = Flags::has("noWorks") ? nullptr : WorkLibrary::make();
    std::shared_ptr<ClipLibrary> library = ClipLibrary::make();
    std::shared_ptr<Art> art = library ? Art::make(library) : nullptr;
    std::shared_ptr<Catalog> catalog = art ? Catalog::make(library->clips, works) : nullptr;
    if (!library || !art || !catalog) {
        logLine("[ocean] the clips or ocean.json are missing from the app bundle");
        return;
    }
    if (works) art->hold(works);
    this->library = library;
    this->art = art;
    this->catalog = catalog;
    catalog->chipWidth = [art](const std::string& name) { return art->chipWidth(name); };
    catalog->smallSize = [this](const Ref& ref) { return bodies(ref).small; };
    lineMaterial = Material::line();
    // NOTE(port): the three ShaderGraph materials are the renderer's own here: there is no file
    // to find and nothing that can fail to load, so the Swift's two lines for that ("[ocean] dust
    // material unavailable, the ocean stands still", "[ocean] gaze glow unavailable, a looked-at
    // card brightens instead") are never written. Each is still held as one that may be missing,
    // and everything that uses it still does without where it is.
    {
        Material m = Material::dust();
        m.cull = false;
        m.writesDepth = false;
        dustMaterial = m;
    }
    if (!Flags::has("plainHover")) {
        Material m = Material::hoverGlow();
        m.cull = false;
        m.writesDepth = false;
        gazeMaterial = m;
    }
    // NOTE(port): `await tracker.start()` has nothing to do: the host tracks the head (platform::head).
    hands->start();
    loaded = true;
}

// MARK: - Setup

void OceanModel::build() {
    if (!art || !catalog || !library) return;
    stage = Stage(platform::head());
    shell = std::make_shared<Shell>(stage, art, library->clips, catalog->works, dustMaterial);
    root_->addChild(shell->root);
    for (size_t i = 0; i < shell->specks.size(); i++) picks[shell->specks[i].get()] = Pick::speck(int(i));

    threads = Threads::make(lineMaterial);
    if (threads) root_->addChild(threads->entity);
    panes = PaneMesh::make(lineMaterial, false, stage);
    floatingPanes = PaneMesh::make(lineMaterial, true, stage);
    if (panes) root_->addChild(panes->entity);
    if (floatingPanes) root_->addChild(floatingPanes->entity);
    // NOTE(port): added for Quest. The hand ray's dot rests on the glass under a group instead of
    // flying on to the far backdrop, so it is seen in the plane of the cards it is aimed between. A
    // pinch there still lands on what is behind the glass, as on visionOS.
    if (panes) panes->entity->stopsPointer = true;
    if (floatingPanes) floatingPanes->entity->stopsPointer = true;
    root_->addChild(treeRoot);

    // Behind everything: something for a pinch at nothing to land on.
    EntityRef back = Entity::make();
    back->position = stage.origin + stage.f * 13;
    back->orientation = stage.flat();
    back->collision = {Shape::generateBox({60, 30, 0.05f})};
    back->inputTarget = true;
    root_->addChild(back);
    picks[back.get()] = Pick::background();

    hologram = Hologram::make(lineMaterial);
    handGlow = HandGlow::make(lineMaterial);
    if (handGlow) root_->addChild(handGlow->entity);
    if (hologram) {
        seat(hologram->entity);
        hologram->entity->isEnabled = false;
    }

    if (std::optional<Piece> piece = art->tray("To image generation")) {
        EntityRef tray = art->quad(*piece);
        tray->position = trayPoint() + stage.u * 0.012f;
        tray->orientation = stage.facing(trayPoint());
        root_->addChild(tray);
    }

    loadShelf(catalog);
    rebuildStrip();
    built = true;
    busyUntil = time + 1;
    logLine(fmt("[ocean] ready: %d films, %d works, %d tags, %d notes, ocean %.2f m down, hands %s", int(library->clips.size()),
                int(catalog->works.size()), int(catalog->tags.size()), int(catalog->notes.size()), double(stage.drop),
                hands->tracking ? "tracked" : "not tracked"));
    runFlags();
}

/// The small tree stands low to the left and within reach: it is worked by hand.
void OceanModel::seat(const EntityRef& entity) {
    // `-deckUp 1` stands it higher and further off, where the simulator's view can see it.
    bool seen = Flags::has("deckUp");
    // Well down and to the left, out of the way of a hand reaching for the tree: about 32 cm left, 33 cm ahead, 39 cm below the eyes.
    Vec3 p = seen ? stage.point(-27, -16, 0.62f) : stage.point(-44, -40, 0.6f);
    entity->position = p;
    // Upright, as a tree stands, and turned toward where you sit.
    entity->orientation = stage.upright(p).orientation;
    if (entity->parent == nullptr) root_->addChild(entity);
}

// MARK: - Frame

void OceanModel::update(float dt) {
    if (!loaded) return;
    double began = mediaTime();
    // A slow frame (a step builds its cards) must not swallow the start of a motion.
    time += double(std::min(dt, 1.0f / 40));
    if (!built) build();
    double now = time;

    if (!scheduled.empty()) {
        std::vector<Scheduled> due;
        for (Scheduled& s : scheduled) {
            if (s.at <= now) due.push_back(std::move(s));
        }
        scheduled.erase(std::remove_if(scheduled.begin(), scheduled.end(), [&](const Scheduled& s) { return s.at <= now; }), scheduled.end());
        for (Scheduled& s : due) s.run();
    }
    feelHologram();
    if (hologram) hologram->update(now, dt);
    layHologramLabel(now);
    for (const Hands::Event& event : hands->update(stage.origin, stage.f, dt)) handle(event);
    noteHands();
    screen->update();
    lookAtOcean(dt);
    followPan(dt);
    drawHandGlow(now, dt);
    shelveWaiting();

    standMore();
    // Build a couple of waiting cards a frame, so a step never stalls.
    int budget = 2;
    // NOTE(port): changed for Quest. A work's small card draws its picture from the work's own file,
    // and unpacking that takes several frames' time on the headset's chip. It is unpacked on a
    // background thread, and the card waits in the queue until it is there (showing its placeholder)
    // while the cards behind it are built. The Swift builds the first two, whatever they are.
    size_t next = 0;
    while (budget > 0 && next < buildQueue.size()) {
        int id = buildQueue[next];
        CardRef c = card(id);
        if (c && !c->built && c->ref.kind == Ref::Kind::work && art && catalog &&
            !art->smallReady(catalog->works[c->ref.index]) && buildWaited[id]++ < 900) {
            next++;
            continue;
        }
        buildQueue.erase(buildQueue.begin() + long(next));
        buildWaited.erase(id);
        if (c && !c->built) buildSmall(*c);
        budget -= 1;
    }
    // Open works whose full picture has been unpacked: show it (see `showFull`).
    for (size_t i = 0; i < fullWaiting.size();) {
        int id = fullWaiting[i];
        CardRef c = card(id);
        bool gone = !(c && c->ref.kind == Ref::Kind::work && c->pictureFull && c->picture);
        if (gone || art->fullReady(catalog->works[c->ref.index])) {
            fullWaiting.erase(fullWaiting.begin() + long(i));
            if (!gone) finishFull(id);
        } else {
            i++;
        }
    }

    if (now < busyUntil + 0.1) {
        if (shell) shell->setShift(stirred.value(now));
        double t0 = mediaTime();
        layout(now);
        drawPanes(now);
        double t1 = mediaTime();
        drawGrid(now);
        double t2 = mediaTime();
        drawThreads(now, std::min(dt, 1.0f / 40));
        double t3 = mediaTime();
        parts[0] += t1 - t0; parts[1] += t2 - t1; parts[2] += t3 - t2;
        runFades(now);
        for (const MoverRef& m : movers) apply(*m, now);
        movers.erase(std::remove_if(movers.begin(), movers.end(), [&](const MoverRef& m) {
            if (!(now >= m->removeAt)) return false;
            m->entity->removeFromParent();
            return true;
        }), movers.end());
    } else if (shelfDirty && shelfWaiting.empty()) {
        saveShelf();
    }
    report(dt, mediaTime() - began);
}

/// Brings something small in over a moment.
void OceanModel::fadeIn(const EntityRef& e, double delay, float over) {
    e->opacity = 0.f;
    Tween<float> alpha(0.f);
    alpha.go(1, time, delay, over, Ease::out);
    fades.push_back(Fade{e, alpha, false});
    touch(time + delay + double(over) + 0.05);
}

/// Lets something go over a moment, then takes it away.
void OceanModel::fadeOut(const EntityRef& e, float over) {
    fades.erase(std::remove_if(fades.begin(), fades.end(), [&](const Fade& f) { return f.entity == e; }), fades.end());
    Tween<float> alpha(e->opacity.value_or(1));
    alpha.go(0, time, over, Ease::out);
    fades.push_back(Fade{e, alpha, true});
    touch(time + double(over) + 0.05);
}

void OceanModel::runFades(double now) {
    if (fades.empty()) return;
    for (const Fade& f : fades) {
        float a = f.alpha.value(now);
        if (a > 0.996f) f.entity->opacity.reset(); else f.entity->opacity = a;
    }
    fades.erase(std::remove_if(fades.begin(), fades.end(), [&](const Fade& f) {
        if (!(now >= f.alpha.end())) return false;
        if (f.remove) f.entity->removeFromParent();
        return true;
    }), fades.end());
}

/// The ocean's pieces grow where the head points (there is no knowing where the eyes look).
/// `-gazeAz 30 -gazeEl -12` points a head that isn't there, in degrees right of ahead and up;
/// with `-gazeSweep 20` it then turns that many degrees a second, to and fro. `-noGaze` leaves
/// every piece at rest.
void OceanModel::lookAtOcean(float dt) {
    if (!shell) return;
    if (noGaze()) {
        shell->look(stage.origin, std::nullopt, dt);
    } else if (std::optional<float> az = gazeAz()) {
        float swing = gazeSweep() > 0 ? 25 * std::sin(float(time) * gazeSweep() / 25) : 0;
        shell->look(stage.origin, stage.dir(*az + swing, gazeEl()), dt);
    } else if (std::optional<Mat4> head = platform::head()) {
        // NOTE(port): changed for Quest. The headset's own "ahead" is higher than where the eyes rest
        // in it (its lenses look a little down, and it sits tipped on the face): by about 15 degrees,
        // as Kai found wearing it. The zoom follows the line that much lower.
        float drop = gazeDrop() * floatPi / 180;
        shell->look(head->position(), head->forward() * std::cos(drop) - head->up() * std::sin(drop), dt);
    } else {
        shell->look(stage.origin, std::nullopt, dt);
    }
}

/// The number that follows a launch flag, which may be negative.
std::optional<float> OceanModel::number(const std::string& flag) {
    const std::vector<std::string>& a = Flags::arguments();
    auto i = std::find(a.begin(), a.end(), flag);
    if (i == a.end() || i + 1 == a.end()) return std::nullopt;
    // (`Float(a[i + 1])`: nil unless the whole of it is a number.)
    const std::string& s = *(i + 1);
    char* end = nullptr;
    float v = std::strtof(s.c_str(), &end);
    if (s.empty() || end != s.c_str() + s.size()) return std::nullopt;
    return v;
}

/// Something happened above: the ocean is stirred, and settles into a new arrangement.
void OceanModel::stir() {
    stirred.go(stirred.target() + 1, time, 2.4f, Ease::glide);
    touch(time + 2.45);
}

void OceanModel::after(double delay, std::function<void()> run) {
    scheduled.push_back(Scheduled{time + delay, std::move(run)});
    touch(time + delay + 0.2);
}

void OceanModel::layout(double now) {
    Vec2 pan = this->pan.value(now);
    float level = focusLevel.value(now), z = zoom.value(now);
    std::optional<int> current = tree ? tree->focus() : std::nullopt;
    Vec2 currentXY = pan;
    if (current) {
        if (const CardRef& c = card(*current)) currentXY = c->xy.value(now);
    }
    // NOTE(port): `var sheets: [Int: Stage.Sheet] = [:]`, kept by the model and emptied here (see oceanmodel.h).
    sheets.clear();
    /// (The Swift's `(spot: Stage.Spot, boost: Float, curve: Float, fade: Float)`.)
    struct Placed {
        Stage::Spot spot;
        float boost;
        float curve;
        float fade;
    };
    auto place = [&](CardView& c) -> Placed {
        float behind = level - c.plane.value(now);
        int key = int(std::round(behind * 2000));
        const Stage::Sheet* known = sheets.find(key);
        Stage::Sheet sheet = known ? *known : stage.sheet(behind);
        if (!known) sheets.set(key, sheet);
        float g = Stage::gather(behind);
        Vec2 xy = c.xy.value(now) + c.nudge.value(now) * g;
        // A layer's first card is a step of the path: it shrinks less than the rest of its layer.
        float boost = c.step ? std::sqrt(g) : g;
        float lift = 0;
        if (current && c.id == *current) {
            boost *= 1 + zoomGrowth * z;
            lift = 0.014f;          // the open card lies a hair over its sheet
        } else if (z > 0.001f && current) {
            const TreeNode* node = tree ? find(*tree, c.id) : nullptr;
            if (node && node->parent == current && !node->opened) {
                // What hangs from the open card keeps clear of it as it grows.
                float out = node->chip ? 1 + zoomGrowth * z : 1 + 1.15f * z;
                xy = currentXY + (xy - currentXY) * out;
                if (!node->chip) boost *= 1 - 0.3f * z;
            }
        }
        // Lit only on the layer you work on: the glow goes as a layer sinks away.
        c.setGlow(c.lit && !pressing ? (1 - std::min(1.f, std::max(0.f, behind))) * (1 - 0.5f * c.dimNow()) : 0);
        // A condensed group stands off its sheet, toward you.
        lift += c.float_.value(now) * Branching::float_();
        // Where it belongs in the view, then where the edge of the view lets it show.
        Vec2 v = xy - pan * c.pb.value(now);
        Stage::Squeezed shown = pressing ? Stage::Squeezed{v, 1.f} : stage.squeeze(v);
        c.sheetAt = shown.at;
        c.behind = behind;
        boost *= shown.scale;
        // A card lies on its layer and takes the layer's own curve, as the glass and the grid
        // do: the layer you work on wraps round you, each earlier one is flatter as it unrolls,
        // and a card on its way between two has what its sheet has on the way. Nothing else
        // decides the bend. (It is measured at the card's own distance from the sheet's axis,
        // since a card can stand a little off its sheet.)
        float curve = 0;
        if (sheet.curve > 1e-4f && !flatCards()) {
            float radius = 1 / sheet.curve - lift - sheet.raise;
            float width = c.extent(now).x * boost;
            if (radius > 0.1f && width * width / (8 * radius) > flatWithin) curve = c.grown(now) * boost / radius;
        }
        c.lift = lift;
        return Placed{sheet.at(shown.at, lift), boost, curve, Stage::opacity(behind)};
    };
    for (const auto& [id, c] : cards) {
        Placed p = place(*c);
        c->apply(now, p.spot, p.boost, p.curve, p.fade);
    }
    for (const CardRef& c : leaving) {
        Placed p = place(*c);
        c->apply(now, p.spot, 1, p.curve, p.fade);
    }
    leaving.erase(std::remove_if(leaving.begin(), leaving.end(), [&](const CardRef& c) {
        if (!(now >= c->goneAt)) return false;
        c->root->removeFromParent();
        picks.erase(c->root.get());
        for (const Entity* e : c->extras) picks.erase(e);
        if (c->home && shell) shell->setOut(*c->home, false);
        return true;
    }), leaving.end());
}

// MARK: - Glass

/// A pane of the branch's colour lies behind every group on the layers
/// nearest you, and behind every condensed group, which floats with
/// it. A pane is drawn round its cards as they are right now: a card on
/// its way to another layer, or being put away, draws the edge in after
/// it as it goes. A group's pane also goes round whatever is condensed
/// onto its cards. `-noGlass` leaves them out.
void OceanModel::drawPanes(double now) {
    if (!panes || !floatingPanes) return;
    // NOTE(port): `flat` and `floating` in the Swift, made afresh; here the model's own, emptied.
    std::vector<PaneMesh::Pane>& flat = flatPanes;
    std::vector<PaneMesh::Pane>& floating = floatPanes;
    flat.clear();
    floating.clear();
    if (!tree || pressing || Flags::has("noGlass")) {
        panes->draw(flat);
        floatingPanes->draw(floating);
        return;
    }
    const Tree& tree = *this->tree;
    auto presence = [&](const CardView& c) -> float { return now >= c.bornAt ? c.alpha.value(now) * smoothstep(0, 0.6f, c.emerge.value(now)) : 0; };
    // (In the order of their ids; a Swift dictionary has none.)
    for (const auto& [nid, n] : tree.nodes) {
        if (!n.head) continue;
        const CardRef& held = card(n.id);
        if (!held) continue;
        const CardView& c = *held;
        float here = presence(c);
        if (!(here > 0.03f)) continue;
        float plane = c.plane.value(now), float_ = c.float_.value(now);
        float strength = (tree.folded(n) ? 1 : std::min(1.f, std::max(0.f, Branching::glassLayers - c.behind))) * here * Stage::opacity(c.behind);
        if (!(strength > 0.02f)) continue;
        float condensed = std::min(1.f, float_);
        // How far the edge stands off the cards, which is also how round its corners are.
        float pad = 0.09f * (1 - condensed) + 0.038f * c.scale.value(now) * condensed;
        std::vector<Vec2>& points = panePoints;
        points.clear();
        auto put = [&](Vec2 at, Vec2 half, float more) {
            Vec2 h = half + Vec2::repeating(more);
            points.push_back(at - h);
            points.push_back(at + Vec2(h.x, -h.y));
            points.push_back(at + h);
            points.push_back(at + Vec2(-h.x, h.y));
        };
        // How much of a card is on this pane right now: all of it at rest, none once it has left for another layer.
        auto on = [&](const CardView& k) -> float { return std::min(1.f, std::max(0.f, 1 - std::fabs(k.plane.value(now) - plane))) * presence(k); };
        auto within = [&](auto&& within, const TreeNode& m, Vec2 middle, float air) -> void {
            for (int id : m.children) {
                const TreeNode* node = find(tree, id);
                const CardRef& k = card(id);
                if (!node || !k) continue;
                float w = on(*k);
                if (!(w > 0.01f)) continue;
                Vec2 at = middle + (k->sheetAt - middle) * w;
                put(at, k->half * w, air * w);
                if (node->head) within(within, *node, at, air + 0.014f);
            }
        };
        put(c.sheetAt, c.half, 0);
        for (int id : n.children) {
            const TreeNode* node = find(tree, id);
            const CardRef& k = card(id);
            if (!node || !k) continue;
            float w = on(*k);
            if (!(w > 0.01f)) continue;
            Vec2 at = c.sheetAt + (k->sheetAt - c.sheetAt) * w;
            put(at, k->half * w, 0);
            if (node->head) within(within, *node, at, 0.024f);
        }
        // Behind its cards: on the sheet, or floating with them. (Not with the open card, which lies a hair over the sheet.)
        PaneMesh::Pane pane{PaneMesh::outline(points, pad), stage.sheet(c.behind), float_ * Branching::float_() - 0.012f, c.tint.value(now), strength};
        if (float_ > 0.3f) floating.push_back(std::move(pane)); else flat.push_back(std::move(pane));
    }
    panes->draw(flat);
    floatingPanes->draw(floating);
}

// MARK: - The grid under the layers

/// Sends each layer's grid toward how the layer now lies. A new layer's
/// grid starts exactly where the grid it grew out of was.
void OceanModel::settleSheets(const Tree& tree, const std::vector<LayerFrame>& frames, double now) {
    for (size_t i = 0; i < tree.route.size() && i < frames.size(); i++) {
        int head = tree.route[i];
        const LayerFrame& f = frames[i];
        SheetState s;
        auto mine = sheetStates.find(head);
        auto before = i > 0 ? sheetStates.find(tree.route[i - 1]) : sheetStates.end();
        if (mine != sheetStates.end()) {
            s = mine->second;
        } else if (before != sheetStates.end()) {
            const SheetState& b = before->second;
            s = SheetState{Tween<Vec2>(b.origin.value(now)), Tween<float>(b.gather.value(now)), Tween<float>(b.pan.value(now))};
        } else {
            s = SheetState{Tween<Vec2>(f.origin), Tween<float>(f.gather), Tween<float>(f.pan)};
        }
        if (distance(s.origin.target(), f.origin) > 1e-4f) s.origin.go(f.origin, now, Pace::step, Ease::glide);
        if (std::fabs(s.gather.target() - f.gather) > 1e-4f) s.gather.go(f.gather, now, Pace::step, Ease::glide);
        if (std::fabs(s.pan.target() - f.pan) > 1e-4f) s.pan.go(f.pan, now, Pace::step, Ease::glide);
        sheetStates[head] = s;
    }
    // (`let inLine = Set(tree.route)`: only the layers in line are kept.)
    for (auto it = sheetStates.begin(); it != sheetStates.end();) {
        if (std::find(tree.route.begin(), tree.route.end(), it->first) == tree.route.end()) it = sheetStates.erase(it); else ++it;
    }
}

/// The grid's lines show for as long as the tree is being moved, and a moment after.
void OceanModel::wakeGrid(double seconds) {
    gridUntil = std::max(gridUntil, time + seconds);
    if (gridAwake.target() < 0.5f) gridAwake.go(1, time, 0.18f, Ease::out);
    touch(gridUntil + 0.8);
}

/// The grid under the layer you work on and the two behind it. At rest
/// only the top one shows, as dots; while the tree moves all three do,
/// with their lines.
void OceanModel::drawGrid(double now) {
    auto retire = [&](int head) {
        auto it = grids.find(head);
        if (it == grids.end()) return;
        std::shared_ptr<SheetGrid> g = it->second;
        grids.erase(it);
        g->clear();
        spareGrids.push_back(g);
    };
    if (!tree || pressing || Flags::has("noGrid")) {
        while (!grids.empty()) retire(grids.begin()->first);
        return;
    }
    if (gridAwake.target() > 0.5f && now > gridUntil) {
        gridAwake.go(0, now, 0.6f, Ease::out);
        touch(now + 0.65);
    }
    float awake = gridAwake.value(now), level = focusLevel.value(now);
    Vec2 pan = this->pan.value(now);
    // NOTE(port): `var live: Set<Int> = []`: at most four layers can pass the test below, so they are kept in place.
    std::array<int, 8> live{};
    size_t liveCount = 0;
    auto isLive = [&](int head) { return std::find(live.begin(), live.begin() + liveCount, head) != live.begin() + liveCount; };
    for (size_t i = 0; i < tree->route.size(); i++) {
        int head = tree->route[i];
        float behind = level - float(i);
        auto state = sheetStates.find(head);
        if (!(behind > -0.5f && behind < 2.6f && state != sheetStates.end())) continue;
        const SheetState& s = state->second;
        float top = 1 - std::min(1.f, std::max(0.f, behind));
        // In full on the three nearest layers; a layer just folded away, or one sinking out of the three, fades.
        float strength = Stage::opacity(behind) * std::min(1.f, (2.6f - behind) / 0.6f) * std::min(1.f, 1 + 2 * behind);
        float dots = strength * (top + awake * (1 - top)), lines = strength * awake * (0.6f + 0.4f * top);
        if (!(dots > 0.01f)) continue;
        std::shared_ptr<SheetGrid> grid;
        if (auto g = grids.find(head); g != grids.end()) {
            grid = g->second;
        } else if (!spareGrids.empty()) {
            grid = spareGrids.back();
            spareGrids.pop_back();
        } else {
            grid = SheetGrid::make(lineMaterial);
        }
        if (!grid) continue;
        if (grid->entity->parent == nullptr) root_->addChild(grid->entity);
        grids[head] = grid;
        if (!isLive(head) && liveCount < live.size()) live[liveCount++] = head;
        grid->draw(stage, stage.sheet(behind), s.origin.value(now) - pan * s.pan.value(now), SheetGrid::cell * s.gather.value(now), dots, lines,
                   top > 0.5f);
    }
    for (auto it = grids.begin(); it != grids.end();) {
        int head = it->first;
        ++it;
        if (!isLive(head)) retire(head);
    }
}

// MARK: - What the hands are read as (for testing)

/// A line above the step cards saying what the hands are read as, twice a
/// second, and the same line into a file. Only with `-handsNote`.
void OceanModel::noteHands() {
    if (!(built && time - handsNoteAt > 0.5 && Flags::has("handsNote") && art && hologram)) return;
    const EntityRef& deckEntity = hologram->entity;
    handsNoteAt = time;
    std::string words = hands->summary() + (nearestTip.empty() ? "" : " · " + nearestTip);
    // NOTE(port): Documents/ocean-hands.txt in the Swift; here beside the shelf, in the folder the app may write to.
    if (!handsLog) {
        std::string dir = platform::dataDirectory();
        if (!dir.empty()) handsLog = std::fopen((dir + "/ocean-hands.txt").c_str(), "w");
    }
    if (handsLog) {
        std::string line = fmt("%.1f %s\n", time, words.c_str());
        std::fwrite(line.data(), 1, line.size(), handsLog);
        std::fflush(handsLog);
    }
    if (words == handsNoteWords) return;
    handsNoteWords = words;
    if (handsNote) handsNote->removeFromParent();
    std::optional<Piece> piece = art->line(words, Art::Size::micro, Font::Weight::medium, Color::white(1, 0.85f), Color::white(0, 1));
    if (!piece) return;
    EntityRef e = art->quad(*piece);
    // Above the step cards, a little behind them, facing you.
    e->position = deckEntity->position + stage.u * 0.2f + stage.f * 0.12f;
    e->orientation = stage.facing(e->position);
    root_->addChild(e);
    handsNote = e;
}

// MARK: - The small tree, by hand

/// What the small tree shows: every card that was asked about as an orb
/// on its layer's level, where its group stands on that layer; every
/// other card as a glitter beside the orb it came back to.
void OceanModel::refreshHologram(const Tree& tree) {
    if (!hologram) return;
    int deepest = 0;
    for (const auto& [id, n] : tree.nodes) {
        if (n.head) deepest = std::max(deepest, tree.generation(n.id));
    }
    int layers = deepest + 1;
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
    std::vector<Hologram::Node> out;
    // (`tree.nodes.values.sorted(by: { $0.id < $1.id })`: the map is in that order.)
    for (const auto& [id, n] : tree.nodes) {
        if (n.head) {
            int layer = tree.generation(n.id);
            int branches = 0;
            for (int child : n.children) {
                const TreeNode* k = find(tree, child);
                if (k && k->head) branches += 1;
            }
            auto size = sizes.find(n.id);
            Hologram::Node node{n.id, n.parent, true, layer, Hologram::spot(lifted(tree, n.id), layer, layers), tree.color(n.id)};
            node.weight = float(size != sizes.end() ? size->second : 1) / total;
            node.branches = branches;
            node.onPath = routeIndex(tree, n.id) >= 0;
            node.current = n.id == tree.stand;
            out.push_back(node);
        } else if (n.parent && !n.chip) {
            int p = *n.parent;
            int layer = tree.generation(p);
            Vec3 from = Hologram::spot(lifted(tree, p), layer, layers);
            Hologram::Node node{n.id, p, false, layer, from + Vec3(n.xy.x, 0, -n.xy.y) * (tree.spread(p) * Hologram::glitter), tree.color(n.id)};
            node.importance = n.imp.value_or(0.5f);
            out.push_back(node);
        }
    }
    if (!hologram->entity->isEnabled) {
        hologram->entity->isEnabled = true;
        fadeIn(hologram->entity, 0.2, 0.5f);
    }
    hologram->set(out, layers, tree.standDepth(), time);
}

/// A hand over the small tree makes it grow a little; the fingers'
/// height picks a level, which a pane of light snaps to; a pinch goes
/// to that layer. Either hand will do.
void OceanModel::feelHologram() {
    if (!hologram || !hands->tracking) return;
    double now = time;
    if (!(tree && !pressing && hologram->entity->isEnabled && now >= holoRest)) {
        leaveHologram();
        return;
    }
    // A hand that is carrying the tree, or a pinch that is dragging a card, passes by without waking it.
    bool passing = !holoTouching && (press.has_value() || hands->carrying());
    float margin = holoTouching ? 0.075f : 0.035f;
    /// (The Swift's `(aside: Float, hand: Int)` and `(gap: Float, words: String)`.)
    struct Best {
        float aside;
        int hand;
    };
    struct Closest {
        float gap;
        Vec2 off;
    };
    std::optional<Best> best;
    std::optional<Closest> closest;
    // NOTE(port): changed on 2026-11-14 at Kai's request, after trying it in the headset: only the index
    // finger works the small tree. The Swift lets any fingertip of either hand wake it and hold it, which
    // made it unclear what was doing the picking.
    for (const Hands::Fingertip& finger : hands->fingertips()) {
        int hand = finger.hand;
        Vec3 tip = finger.tip;
        std::optional<Hands::Pointer> index = hands->pointer(hand);
        if (!(index && distance(tip, index->tip) < 1e-5f)) continue;
        // In the tree's own space, so its growing under the hand changes nothing here.
        Vec3 p = hologram->entity->convertFrom(tip, nullptr);
        float aside = std::sqrt(p.x * p.x + p.z * p.z);
        Vec2 off{std::max(aside - hologram->width(), 0.f), std::max({-p.y, 0.f, p.y - hologram->top()})};
        // NOTE(port): the Swift writes the words out for every fingertip that is the nearest so
        // far; here only where it is kept, and the words once, after the last.
        if (!closest || length(off) < closest->gap) closest = Closest{length(off), off};
        if (!(!passing && (holoTouching || !hands->grabbing(hand)))) continue;
        if (!(aside < hologram->width() + margin && p.y > -margin && p.y < hologram->top() + margin)) continue;
        if (!best || aside < best->aside) best = Best{aside, hand};
    }
    nearestTip = closest ? fmt("nearest fingertip %d cm aside of the small tree, %d cm above or below it", int(closest->off.x * 100), int(closest->off.y * 100))
                         : std::string();
    std::optional<Hands::Pointer> pointer = best ? hands->pointer(best->hand) : std::nullopt;
    if (!best || !pointer) {
        // Away for a moment is still there: a hand shifting between levels doesn't let go.
        if (holoTouching) {
            if (!holoLeft) holoLeft = now;
            if (holoLeft && now - *holoLeft > 0.35) leaveHologram();
        }
        return;
    }
    holoLeft = std::nullopt;
    holoHand = best->hand;
    hands->quiet = true;
    hands->hold(0.6);
    if (!holoTouching) {
        holoTouching = true;
        holoArmed = false;
        hologram->hover(true, now);
        hologram->select(hologram->current, now);
        logLine("[ocean] a hand over the small tree");
    }
    if (pointer->pinch > 0.03f) holoArmed = true;
    // The level at the index finger's height. It holds still while the thumb comes in to pinch,
    // and moves on only once the finger is well into the next level.
    if (pointer->pinch > 0.045f) {
        float at = hologram->level(hologram->entity->convertFrom(pointer->tip, nullptr).y);
        float lit = float(hologram->selected.value_or(hologram->current));
        if (std::fabs(at - lit) > 0.62f) hologram->select(int(std::round(at)), now);
    }
    if (holoArmed && pointer->pinch < Hands::pinchClosed) {
        int to = hologram->selected.value_or(hologram->current);
        logLine(fmt("[ocean] layer %d picked on the small tree", to + 1));
        holoRest = now + 0.9;
        leaveHologram();
        jump(to);
    }
}

void OceanModel::leaveHologram() {
    if (!(holoTouching || hands->quiet)) return;
    holoTouching = false;
    holoHand = -1;
    holoLit = std::nullopt;
    hands->quiet = false;
    holoLeft = std::nullopt;
    holoArmed = false;
    if (hologram) hologram->hover(false, time);
}

/// Goes to a layer: along the path you came by if it reaches that far,
/// else to the group most lately asked there.
void OceanModel::jump(int layer) {
    if (!(tree && !pressing && layer != tree->standDepth())) return;
    if (layer >= 0 && layer < int(tree->route.size())) {
        goTo(tree->route[layer]);
    } else {
        // (`.max(by: { $0.id < $1.id })`: the map is in the order of ids, so the last that fits.)
        std::optional<int> head;
        for (const auto& [id, n] : tree->nodes) {
            if (n.head && tree->generation(n.id) == layer) head = n.id;
        }
        if (head) take(*head);
    }
}

/// Beside the pane on the small tree: which layer it is, and what the path asked there.
void OceanModel::layHologramLabel(double now) {
    if (!hologram || !art) return;
    std::string words;
    if (tree && !pressing && hologram->entity->isEnabled) {
        int layer = hologram->selected.value_or(hologram->current);
        std::optional<std::string> name;
        if (layer >= 0 && layer < int(tree->route.size()) && catalog) {
            if (const TreeNode* n = find(*tree, tree->route[layer])) name = catalog->short_(n->ref);
        }
        if (name) {
            words = fmt("%d  %s", layer + 1, name->c_str());
        } else {
            // NOTE(port): the Swift counts the groups every frame and uses the count only here,
            // where the layer has no name; counting changes nothing, so it is done only here.
            int groups = 0;
            for (const auto& [id, n] : tree->nodes) {
                if (n.head && tree->generation(n.id) == layer) groups += 1;
            }
            words = fmt("%d  %d %s", layer + 1, groups, groups == 1 ? "group" : "groups");
        }
    }
    if (!holoLabel || words != holoLabel->words) {
        if (holoLabel) fadeOut(holoLabel->entity, 0.15f);
        holoLabel = std::nullopt;
        if (!words.empty()) {
            if (std::optional<Piece> piece = art->line(words, Art::Size::label, Font::Weight::semibold, Color::white(1, 0.92f))) {
                EntityRef e = art->quad(*piece);
                e->scale = Vec3::repeating(0.62f);
                hologram->entity->addChild(e);
                holoLabel = Label{e, words};
                fadeIn(e, 0, 0.18f);
            }
        }
    }
    if (!(holoLabel && now < hologram->busyUntil + 0.1)) return;
    const EntityRef& label = holoLabel->entity;
    float half = (label->model && label->model->mesh ? label->model->mesh->bounds.extents().x : 0.08f) * 0.62f / 2;
    label->position = hologram->labelSpot(now) + Vec3{half, 0, 0.002f};
}

/// A hand over the small tree, run to one of its levels, and a pinch: as a stand-in where no hands are tracked.
void OceanModel::touchHologramByFlag(int pick) {
    if (!hologram || !tree) return;
    int to = std::min(std::max(pick, 0), hologram->layers - 1);
    hologram->hover(true, time);
    hologram->select(hologram->current, time);
    int at = hologram->current;
    double t = 0.8;
    while (at != to) {
        at += at < to ? 1 : -1;
        int k = at;
        after(t, [this, k] {
            if (hologram) hologram->select(k, time);
        });
        t += 0.4;
    }
    after(t + 0.8, [this, to] {
        if (hologram) hologram->hover(false, time);
        jump(to);
    });
}

/// The tree carried by a closed hand, and let go: as a stand-in where no hands are tracked.
void OceanModel::panByFlag(Vec2 d) {
    int steps = 45;
    for (int k = 0; k < steps; k++) {
        after(double(k) / 45, [this, k, steps, d] {
            // Starts gently, moves, and is let go while still moving.
            float u = float(k) / float(steps), w = 0.4f + 1.2f * u;
            panBy(d / panGain * (w / float(steps)));
        });
    }
    after(1.02, [this, d] { panRelease(d / panGain * 1.6f); });
}

// MARK: - Panning by hand

/// The tree follows a closed hand: `d` is how far the hand moved, right and up, m.
void OceanModel::panBy(Vec2 d) {
    if (!(tree && !pressing)) return;
    // The sheet is three times as far away as the hand, so it moves three times as far: it stays under the fist.
    // NOTE(port): changed for Quest. The Swift puts the tree there at once (`pan.set`), which carries
    // every shiver of the hand into the whole tree. Here the fist says where it should be, and the tree
    // goes there with some weight (`followPan`): steadier, and easier on the stomach.
    if (!panFollowing) {
        panAsked = pan.value(time);
        panFollowing = true;
    }
    panAsked -= d * panGain;
    wakeGrid(0.35);
    touch(time + 0.4);
}

/// The tree closes on where a carrying fist has asked it to be: most of the way in `panWeight` seconds,
/// never past it. A critically damped follower, so it cannot swing.
void OceanModel::followPan(float dt) {
    if (!panFollowing) return;
    // Something else has taken the tree somewhere (a new layer, a step): the fist's say is over.
    if (!(tree && !pressing) || pan.end() > time) {
        panFollowing = false;
        return;
    }
    Vec2 at = pan.value(time);
    Vec2 left = panAsked - at;
    if (length(left) < 0.0006f && !hands->carrying()) {
        pan.set(panAsked);
        panFollowing = false;
        return;
    }
    pan.set(at + left * (1 - std::exp(-dt / panWeight())));
    wakeGrid(0.25);
    touch(time + 0.3);
}

/// Let go: it coasts a little way on, and stops.
void OceanModel::panRelease(Vec2 velocity) {
    if (!(tree && !pressing)) return;
    Vec2 v = velocity * panGain;
    float speed = length(v);
    if (speed > 1.5f) v *= 1.5f / speed;
    if (!(speed > 0.05f)) return;
    // NOTE(port): changed for Quest. The Swift lets it run on 0.15 s of its speed over 0.45 s; in the
    // headset that glide was too long. It runs on a third as far, and settles with the same weight it
    // was carried with.
    if (!panFollowing) {
        panAsked = pan.value(time);
        panFollowing = true;
    }
    panAsked -= v * panCoast();
    wakeGrid(0.5);
    logLine(fmt("[ocean] pan let go at %.2f m/s", double(speed)));
}

void OceanModel::apply(Mover& m, double now) {
    m.entity->position = m.position.value(now);
    m.entity->scale = Vec3::repeating(std::max(0.001f, m.scale.value(now)));
    float a = m.alpha.value(now);
    if (std::fabs(a - m.shownAlpha) > 0.004f) {
        m.shownAlpha = a;
        if (a > 0.996f) m.entity->opacity.reset(); else m.entity->opacity = a;
    }
}

void OceanModel::report(float dt, double work) {
    frames += 1;
    frameTime += double(dt);
    workTime += work;
    if (!(time - lastReport > 2)) return;
    if (Flags::has("fps")) {
        logLine(fmt("[ocean] %.0f fps, update %.2f ms, %d cards, %d threads%s", double(frames) / std::max(frameTime, 1e-6),
                    workTime / double(frames) * 1000, int(cards.size()), int(drawn.size()), time < busyUntil ? ", moving" : ""));
        logLine(fmt("[ocean] parts: layout %.2f grid %.2f threads %.2f ms (bending %.2f of the layout, %.2f at worst)", parts[0] / double(frames) * 1000,
                    parts[1] / double(frames) * 1000, parts[2] / double(frames) * 1000, Bend::spent / double(frames) * 1000, Bend::worst * 1000));
    }
    Bend::spent = 0;
    Bend::worst = 0;
    parts = {0.0, 0.0, 0.0};
    frames = 0;
    frameTime = 0;
    workTime = 0;
    lastReport = time;
}

// MARK: - Light on the hands (Quest)

/// What a closed hand or a finger on the small tree is doing, drawn where the hand is (handglow.h).
/// `-glowDemo decide|pan|layer|tree` shows each without hands, for looking at it in the preview.
void OceanModel::drawHandGlow(double now, float dt) {
    if (!handGlow) return;
    static std::vector<HandGlow::Grab> grabs;
    static std::vector<HandGlow::Finger> fingers;
    grabs.clear();
    fingers.clear();
    Vec3 eye = platform::head() ? platform::head()->position() : stage.origin;
    bool canBack = tree && !pressing && tree->standDepth() > 0;
    bool canForward = tree && !pressing && tree->standDepth() + 1 < int(tree->route.size());

    for (const Hands::Grab& g : hands->grabs()) {
        HandGlow::Grab out;
        out.hand = g.hand;
        out.way = g.way;
        out.centre = g.centre;
        out.turn = g.turn;
        out.offset = g.offset;
        out.ahead = g.ahead;
        out.right = g.right;
        out.carried = g.carried;
        out.depth = g.depth;
        out.base = g.base;
        out.pull = Hands::layerPull;
        out.lock = Hands::fistLock;
        out.canBack = canBack;
        out.canForward = canForward;
        grabs.push_back(out);
    }

    if (holoTouching && holoHand >= 0 && hologram) {
        std::optional<Hands::Pointer> pointer = hands->pointer(holoHand);
        int lit = hologram->selected.value_or(hologram->current);
        if (holoLit && *holoLit != lit) handGlow->pulse(now);
        holoLit = lit;
        if (pointer) {
            // Only the index finger: it is the one that picks.
            Vec3 p = hologram->entity->convertFrom(pointer->tip, nullptr);
            HandGlow::Finger f;
            f.tip = pointer->tip;
            f.lead = true;
            // Brightest on the level that is lit, dimming as the finger nears the height at which the next takes over.
            float off = std::fabs(hologram->level(p.y) - float(lit));
            f.snap = std::min(1.f, std::max(0.f, 1 - off / 0.62f));
            f.closing = std::min(1.f, std::max(0.f, (0.045f - pointer->pinch) / (0.045f - Hands::pinchClosed)));
            f.axis = hologram->entity->convertTo(Vec3{0, p.y, 0}, nullptr);
            fingers.push_back(f);
        }
    }

    if (std::optional<std::string> demo = Flags::string("glowDemo")) {
        // A hand that isn't there: where a right hand would be, doing each thing in turn.
        Vec3 at = stage.origin + stage.f * 0.42f + stage.r * 0.14f - stage.u * 0.22f;
        float t = float(std::fmod(now, 6.0));
        HandGlow::Grab g;
        g.hand = 1;
        g.ahead = stage.f;
        g.right = stage.r;
        g.pull = Hands::layerPull;
        g.lock = Hands::fistLock;
        g.canBack = *demo != "layerEnd";
        // Turned as a fist held out is: knuckles ahead, the back of the hand up; and never quite still.
        g.turn = Quat(Mat3(stage.r, stage.u, -stage.f)) * Quat::angleAxis(0.25f * std::sin(t * 1.3f), Vec3{0, 1, 0}) *
                 Quat::angleAxis(0.2f * std::sin(t * 0.9f), Vec3{0, 0, 1});
        if (*demo == "decide") {
            g.way = 0;
            g.offset = stage.r * (0.012f * std::sin(t * 2)) + stage.u * (0.008f * std::cos(t * 2.6f));
        } else if (*demo == "pan") {
            g.way = 2;
            g.carried = Vec2{0.02f + 0.03f * t, 0.012f * t};
            g.offset = stage.r * g.carried.x + stage.u * g.carried.y;
        } else if (*demo == "layer" || *demo == "layerEnd") {
            g.way = 1;
            float travel = 0.016f * t;                   // pushed away, steadily
            g.depth = *demo == "layerEnd" ? -travel : travel;
            g.base = *demo == "layerEnd" ? 0 : std::floor(travel / g.pull + 1e-4f) * g.pull;
            g.offset = stage.f * g.depth;
        }
        if (*demo != "tree") {
            g.centre = at + g.offset;
            grabs.push_back(g);
        } else if (hologram && tree) {
            float y = hologram->top() * (0.5f + 0.5f * std::sin(t * 1.05f));
            Vec3 local{hologram->width() * 0.55f, y, 0.02f};
            HandGlow::Finger lead;
            lead.lead = true;
            lead.tip = hologram->entity->convertTo(local, nullptr);
            float level = hologram->level(local.y);
            lead.snap = std::min(1.f, std::max(0.f, 1 - std::fabs(level - std::round(level)) / 0.5f));
            lead.closing = std::max(0.f, std::sin(t * 2.1f));
            lead.axis = hologram->entity->convertTo(Vec3{0, local.y, 0}, nullptr);
            fingers.push_back(lead);
        }
    }

    handGlow->draw(eye, grabs, fingers, now, dt);
}
