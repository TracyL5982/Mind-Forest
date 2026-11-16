// Port of visionos/MindPalace/Ocean/CardView.swift.
#include "cardview.h"

namespace {
/// Swift's `defer`: runs `body` when the scope it stands in is left.
template <class F>
struct Deferred {
    F body;
    ~Deferred() { body(); }
};
template <class F>
Deferred(F) -> Deferred<F>;
}  // namespace

CardView::CardView(const TreeNode& node, Vec2 smallBody, Vec2 openBody)
    : id(node.id), ref(node.ref), smallBody(smallBody), openBody(openBody), xy(node.xy), plane(0.f) {
    root->addChild(smallHolder);
    root->addChild(openHolder);
    root->addChild(stepHolder);
    stepHolder->isEnabled = false;
    openHolder->isEnabled = false;
    root->isEnabled = false;
}

void CardView::apply(double now, const Stage::Spot& spot, float boost, float curve, float fade) {
    bool moved = false;         // one of its faces changed size within it
    Deferred bending{[&] {
        // Bent, or flat again after having been: every piece of the faces that show follows.
        this->curve = curve;
        if (root->isEnabled && (curve > 1e-4f || bend)) {
            if (!bend) bend = std::make_shared<Bend>();
            bend->update(root, curve, moved);
        }
    }};
    Vec3 treePoint = spot.position;
    if (!(now >= bornAt)) return;
    float a = alpha.value(now);
    // Folded away: nothing to draw until it comes back.
    if (a < 0.004f && alpha.target() < 0.004f && emerge.target() > 0.5f) {
        if (root->isEnabled) root->isEnabled = false;
        return;
    }
    if (!root->isEnabled) root->isEnabled = true;
    float e = emerge.value(now);
    position = source + (treePoint - source) * e + drag.value(now);
    root->position = position;
    root->orientation = spot.orientation();
    if (sourceTurn && e < 1) root->orientation = slerp(*sourceTurn, spot.orientation(), smoothstep(0, 0.7f, e));      // NOTE(port): see `sourceTurn`
    right = spot.right;
    up = spot.up;
    normal = spot.normal;
    float s = grown(now) * boost;
    if (sourceTurn) s = sourceScale + (scale.value(now) * boost - sourceScale) * std::min(e, 1.f);
    root->scale = Vec3::repeating(std::max(s, 0.001f));
    float step = stepMix.value(now);
    half = extent(now) * (boost / 2);

    float d = dim.value(now);
    if ((std::fabs(d - shownDim) > 0.012f || (d == 0) != (shownDim == 0)) && smallQuad) {
        shownDim = d;
        if (shade) shade(smallQuad->entity, smallQuad->texture, d);
    }

    float seen = a * smoothstep(0, 0.25f, e) * fade;
    if (sourceTurn) {
        seen = a * (1 + (fade - 1) * smoothstep(0, 0.5f, e));
        if (e >= 1) sourceTurn.reset();
    }
    if (std::fabs(seen - shownAlpha) > 0.004f) {
        shownAlpha = seen;
        if (seen > 0.996f) root->opacity.reset(); else root->opacity = seen;
    }

    float m = openMix.value(now);
    if (!(std::fabs(m - shownMix) > 0.0005f || std::fabs(step - shownStep) > 0.004f)) return;
    shownMix = m;
    shownStep = step;
    moved = true;
    stepHolder->isEnabled = step > 0.005f;
    if (step > 0.996f) stepHolder->opacity.reset(); else stepHolder->opacity = step;
    // The small card grows to the open one's size and gives way to it.
    float g = growth();
    smallHolder->isEnabled = m < 0.995f && step < 0.995f;
    openHolder->isEnabled = m > 0.005f && openBuilt;
    smallHolder->scale = Vec3::repeating(1 + (g - 1) * m);
    openHolder->scale = Vec3::repeating(1 / g + (1 - 1 / g) * m);
    float smallAlpha = (openBuilt ? 1 - smoothstep(0.35f, 0.8f, m) : 1) * (1 - step);
    float openAlpha = smoothstep(0.2f, 0.7f, m);
    if (smallAlpha > 0.996f) smallHolder->opacity.reset(); else smallHolder->opacity = smallAlpha;
    if (openAlpha > 0.996f) openHolder->opacity.reset(); else openHolder->opacity = openAlpha;
    if (badge) {
        Vec2 half = (smallBody + (openBody - smallBody) * m) / 2;
        badge->position = {-half.x, half.y, 0.004f};
    }
}

Vec3 CardView::point(Vec2 at, float lift) const {
    float s = std::max(root->scale.x, 1e-4f);
    Vec3 p = Bend::bent({at.x / s, at.y / s, lift / s}, curve) * s;
    return position + right * p.x + up * p.y + normal * p.z;
}

Vec3 CardView::unbent(Vec3 world) const {
    Vec3 v = (world - position) / std::max(root->scale.x, 1e-4f);
    return Bend::flat({dot(v, right), dot(v, up), dot(v, normal)}, curve);
}

Vec2 CardView::onFace(Vec3 world) const {
    Vec3 p = openHolder->convertFrom(Bend::flat(root->convertFrom(world, nullptr), curve), root);
    return {p.x, p.y};
}

void CardView::addGlow(const EntityRef& glow, const EntityRef& holder) {
    if (!glow) return;
    glow->position.z = -0.003f;
    holder->addChild(glow);
    glows.push_back(glow);
    shownGlow = -1;
}

void CardView::setGlow(float v) {
    if (!(std::fabs(v - shownGlow) > 0.01f || (v == 0) != (shownGlow == 0))) return;
    shownGlow = v;
    for (const EntityRef& g : glows) {
        g->isEnabled = v > 0.01f;
        if (v > 0.01f) g->opacity = v;
    }
}

Screen::Screen(bool muted) {
    // NOTE(port): `player.actionAtItemEnd = .none` has nothing to set here: a VideoPlayer does
    // nothing of its own at the end of its film but call `didPlayToEnd`.
    player->setVolume(muted ? 0 : 0.35f);
    material = Material::videoMaterial(player);
    // NOTE(port): the Swift hears of every item that ends and checks that it is this player's
    // current one; `didPlayToEnd` is this player's own, so there is nothing to check.
    player->didPlayToEnd = [this] {
        player->seek(0);
        player->play();
    };
}

void Screen::show(int film, const std::string& url, Vec2 size, const EntityRef& holder, Vec2 offset) {
    if (!(this->film != film)) return;
    hide();
    this->film = film;
    span.reset();
    // An ordinary mesh: a video on a LowLevelMesh crashes the headset's renderer.
    EntityRef e = Entity::make(Mesh::generatePlane(size.x, size.y), {material});
    e->position = {offset.x, offset.y, 0.002f};
    e->isEnabled = false;
    holder->addChild(e);
    entity = e;
    player->load(url);
    player->play();
}

void Screen::loop(std::optional<Span> range) {
    span = range;
    if (!(range && film)) return;
    // NOTE(port): the Swift seeks with no tolerance either side (to the very frame), here and
    // in `update`; VideoPlayer::seek has one kind of seek, and how near it lands is the host's.
    player->seek(range->lowerBound);
    player->play();
}

void Screen::hide() {
    if (!film) return;
    film.reset();
    span.reset();
    player->pause();
    // The picture goes first and the player's film a moment later, or
    // the last thing seen is a black frame.
    if (entity) entity->removeFromParent();
    entity = nullptr;
    // NOTE(port): the Swift asks the main queue to run this 0.15 s on: if no film is showing
    // by then and the player still holds the one it held here, the player lets it go. There
    // is no queue to ask here; the moment is kept and `update`, which runs every frame, acts
    // on it. A film shown and hidden again in between moves the moment on, as there.
    dropAt = mediaTime() + 0.15;
}

void Screen::update() {
    if (dropAt && mediaTime() >= *dropAt) {
        dropAt.reset();
        // `player.replaceCurrentItem(with: nil)`: an empty path lets the film go.
        if (!film) player->load("");
    }
    // NOTE(port): `player.currentItem` is there whenever `entity` is (`show` sets both), and
    // `item.status == .readyToPlay` is `player->ready()`.
    if (!entity) return;
    if (span && player->ready() && player->currentTime() >= span->upperBound) {
        player->seek(span->lowerBound);
    }
    if (entity->isEnabled) return;
    if (player->ready() && player->currentTime() > 0.12) entity->isEnabled = true;
}
