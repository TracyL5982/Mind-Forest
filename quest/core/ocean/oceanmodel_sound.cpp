// Not a port: the visionOS app has no sounds of its own yet. When each of the
// ocean's sounds is heard. The sounds themselves are made by
// quest/sound/synth.py (which says what each is) and mixed by core/audio.h.
//
// Most are asked for where the thing happens (`sound("take")` in `take`).
// What is here is the asking itself, and what is heard by watching rather
// than by being told: the layer you stand on changing, by whatever means; a
// hand closing or opening; a finger moving on the small tree; and the
// sounds that last (the ocean, the gardener thinking, the next layer's
// chord held while a fist nears its gate).
#include "oceanmodel.h"

#include <cmath>

#include "../audio.h"

namespace {

// These two say what synth.py says, by position: the ladder there is
// D4 E4 F#4 A4 B4 C#5 D5 E5 F#5 G#5 A5 B5 (note_00 … note_11), and layer k's
// chord is a stack of fifths on the k-th step of D E F# A B, round and round.

/// The ladder's notes that belong to each of the five chords, low to high.
const std::vector<int> chordNotes[5] = {
    {0, 1, 3, 6, 7, 10},        // D A E
    {1, 2, 4, 7, 8, 11},        // E B F#
    {2, 5, 8, 9},               // F# C# G#
    {1, 3, 4, 7, 10, 11},       // A E B
    {2, 4, 5, 8, 11},           // B F# C#
};
/// The ladder's note for each level of the small tree: its layer's root, climbing.
constexpr int levelNotes[10] = {0, 1, 2, 3, 4, 6, 7, 8, 10, 11};
/// How many layers have a chord of their own; any deeper one has the last's.
constexpr int layerChords = 14;
/// How many glints there are (glint_00 …), low to high.
constexpr int glints = 10;
/// How loud the bed, the layer chords and the glints are while Momo listens, thinks or speaks, so the user and Momo are
/// heard over them: about 9 dB down.
constexpr float conversationDip = 0.35f;

/// A number from 0 to 1 that is the same for the same `n`, and unlike its neighbours'.
float scattered(uint32_t n) {
    n = (n ^ 61) ^ (n >> 16);
    n *= 9;
    n ^= n >> 4;
    n *= 0x27d4eb2d;
    n ^= n >> 15;
    return float(n & 0xffff) / 65535.f;
}

}  // namespace

void OceanModel::sound(const char* name, float gain, double after) { audio::play(name, gain, after); }

void OceanModel::soundAt(const char* name, Vec3 at, float gain, double after) {
    // Left or right of where the head faces, by no more than most of the way: it is a leaning, not a place.
    std::optional<Mat4> head = platform::head();
    Vec3 eye = head ? head->position() : stage.origin;
    Vec3 ahead = head ? head->forward() : stage.f, right = head ? head->right() : stage.r;
    Vec3 to = at - eye;
    float pan = length(to) > 1e-3f ? std::sin(std::atan2(dot(to, right), std::max(dot(to, ahead), 0.05f))) * 0.7f : 0;
    audio::play(name, gain, after, pan);
}

void OceanModel::soundLayer(int layer, bool forward, double after) {
    int k = std::min(std::max(layer, 0), layerChords - 1);
    audio::play(fmt(forward ? "layer_up_%d" : "layer_down_%d", k), conversing ? conversationDip : 1, after);
}

void OceanModel::soundNotes(int count, double delay) {
    if (!tree || count <= 0) return;
    const std::vector<int>& notes = chordNotes[std::max(tree->standDepth(), 0) % 5];
    int n = std::min(count, 6);
    // Each a little after the last, as the cards are but slower, so it is heard as notes; many are each quieter.
    float gain = 0.5f * (n > 3 ? std::sqrt(3.f / float(n)) : 1);
    for (int i = 0; i < n; i++) {
        float pan = n > 1 ? (float(i) / float(n - 1) - 0.5f) * 0.7f : 0;
        audio::play(fmt("note_%02d", notes[size_t(i) % notes.size()]), gain, delay + double(i) * 0.09, pan);
    }
}

void OceanModel::soundCard(int id) {
    const TreeNode* n = tree ? find(*tree, id) : nullptr;
    const CardRef& c = card(id);
    if (!n) {
        if (c) soundAt("take", c->position); else sound("take");
        return;
    }
    // Its place among the cards that came with it, its parent's, in the order they come (`soundNotes`): so each keeps
    // the note it came in on, neighbours differ, and the notes climb along them. It does not move as cards open.
    size_t place = 0;
    if (const TreeNode* parent = n->parent ? find(*tree, *n->parent) : nullptr) {
        place = size_t(std::find(parent->children.begin(), parent->children.end(), id) - parent->children.begin());
    }
    std::optional<Tree::Place> at = tree->shown(*n);
    const std::vector<int>& notes = chordNotes[std::max(at ? at->depth : tree->standDepth(), 0) % 5];
    std::string name = fmt("note_%02d", notes[place % notes.size()]);
    logLine(fmt("[ocean] %s sounds %s: card %d of its parent's on layer %d", catalog ? catalog->title(n->ref).c_str() : "a card",
                name.c_str(), int(place) + 1, at ? at->depth : tree->standDepth()));
    if (c) soundAt(name.c_str(), c->position); else sound(name.c_str());
}

void OceanModel::soundLevel(int level) {
    int note = levelNotes[std::min(std::max(level, 0), 9)];
    if (hologram) soundAt(fmt("note_%02d", note).c_str(), hologram->entity->convertTo(Vec3::zero(), nullptr), 0.5f);
}

void OceanModel::updateSound(double now) {
    if (!audio::on()) return;
    // The ocean is always there, and draws back under a film's own sound, and quickly while Momo and the user talk.
    audio::level("ocean_bed", (screenNode ? 0.3f : 1) * (conversing ? conversationDip : 1) * bedLevel(), conversing ? 0.3f : 1.5f);
    soundGlints(now);
    audio::level("think", now >= thinkFrom && now < thinkUntil ? 1 : 0, 0.2f);

    // The layer you stand on changed, however it did (a card asked about, a fist, the small tree,
    // a pinch on a group): its chord. A tree that has only just stood says nothing more.
    if (tree && !pressing) {
        int depth = tree->standDepth();
        if (soundTree != tree.get()) {
            soundTree = tree.get();
        } else if (depth != soundDepth) {
            soundLayer(depth, depth > soundDepth, soundLayerAfter);
        }
        soundDepth = depth;
    } else if (!tree) {
        soundTree = nullptr;
    }
    soundLayerAfter = 0;

    // A hand closes on the tree, or lets it go. Between layers, the chord of the layer it is
    // moving toward is held, and swells as the fist nears the gate where that chord is struck.
    bool fists[2] = {false, false};
    std::string held;
    float heldLevel = 0;
    // (What the gauge on the fist was just drawn from, so the chord swells exactly as its arc fills.)
    for (const HandGlow::Grab& g : fistsDrawn) {
        if (g.hand == 0 || g.hand == 1) fists[g.hand] = true;
        if (!(g.way == 1 && tree && !pressing)) continue;
        float moved = (g.depth - g.base) / g.pull;                  // pushed away: forward
        if (!(moved > 0 ? g.canForward : g.canBack) || std::fabs(moved) < 0.05f) continue;
        held = fmt("layer_pad_%d", std::min(std::max(tree->standDepth() + (moved > 0 ? 1 : -1), 0), layerChords - 1));
        heldLevel = std::pow(std::min(1.f, std::fabs(moved)), 1.6f);
    }
    if (!swelling.empty() && swelling != held) audio::level(swelling, 0, 0.3f);
    if (!held.empty()) audio::level(held, heldLevel * (conversing ? conversationDip : 1), 0.06f);
    swelling = held;
    for (int h = 0; h < 2; h++) {
        if (fists[h] == fistSounding[h]) continue;
        fistSounding[h] = fists[h];
        audio::play(fists[h] ? "grab" : "release", 1, 0, h == 0 ? -0.3f : 0.3f);
    }

    // A finger on the small tree: a note for each level it comes to. (Arriving has its own sound.)
    if (holoTouching && hologram) {
        int lit = hologram->selected.value_or(hologram->current);
        if (levelSounded && *levelSounded != lit) soundLevel(lit);
        levelSounded = lit;
    } else {
        levelSounded = std::nullopt;
    }
}

void OceanModel::soundGlints(double now) {
    if (!shell) return;
    // Far more pieces swell than should be heard (some twenty a second in the slowest look round).
    // One is heard for every few degrees the look travels, so a slow look is a glint now and then
    // and a quick one a run of them, never a rattle; and a look that rests is quiet, but for one
    // or two that were still on their way.
    std::optional<Vec3> aim = shell->aimed();
    if (aim && glintAim) glintTravel += std::acos(std::min(1.f, std::max(-1.f, dot(*aim, *glintAim)))) * 180 / floatPi;
    glintAim = aim;
    glintTravel = std::min(glintTravel, glintNeed * 2.5f);
    for (int i : shell->swelled) {
        if (glintsWaiting.size() >= 6) glintsWaiting.erase(glintsWaiting.begin());
        glintsWaiting.push_back(i);
    }
    if (glintsWaiting.empty() || now < glintAt || glintTravel < glintNeed) return;
    // The latest to swell: the one nearest where the look now is.
    int i = glintsWaiting.back();
    glintsWaiting.pop_back();
    uint32_t turn = glintCount++;
    glintTravel -= glintNeed;
    glintNeed = 3 + 3 * scattered(turn * 2 + 1);
    glintAt = now + 0.06 + 0.09 * double(scattered(turn * 2 + 1));

    // A piece has a note of its own, so a stretch of the water has its own run of them.
    int note = int(scattered(uint32_t(i) * 7919u) * float(glints)) % glints;
    if (note == glintNote) note = (note + 3) % glints;
    glintNote = note;

    // Farther pieces are fainter. To the left or right as it lies from the middle of the look: far
    // more than it truly is (the whole of what swells is a few degrees across), so that a look
    // that travels right is heard to.
    std::optional<Mat4> head = platform::head();
    Vec3 eye = head ? head->position() : stage.origin;
    Vec3 to = shell->homes[size_t(i)] - eye;
    float dist = length(to), pan = 0;
    if (aim && dist > 1e-3f) {
        Vec3 right = cross(*aim, Vec3(0, 1, 0));
        if (length(right) > 1e-3f) pan = std::min(1.f, std::max(-1.f, dot(to, normalize(right)) / dist / 0.1f)) * 0.6f;
    }
    float gain = glitter() * (0.5f + 0.5f * scattered(turn * 2)) * std::min(1.2f, std::max(0.45f, std::sqrt(4.2f / std::max(dist, 0.5f))));
    // The ocean is further from mind while a tree stands over it, and further still under a film.
    if (screenNode) gain *= 0.25f; else if (tree) gain *= 0.55f;
    if (conversing) gain *= conversationDip;
    audio::play(fmt("glint_%02d", note), gain, 0, pan);
}

/// A ray comes to rest on something that can be picked: the lightest touch. Not on the ocean's
/// pieces (a ray crossing the water passes hundreds), nor while a hand is busy with something else.
void OceanModel::pointerLanded(int hand, const EntityRef& entity) {
    if (!audio::on() || press || hands->carrying() || holoTouching) return;
    std::optional<Pick> p = pick(entity);
    if (!p || p->kind == Pick::Kind::speck || p->kind == Pick::Kind::background) return;
    // A ray that wavers between two neighbours is heard once.
    bool again = entity.get() == landedLast[0] || entity.get() == landedLast[1];
    if (time - landSounded < (again ? 0.7 : 0.12)) return;
    landedLast[1] = landedLast[0];
    landedLast[0] = entity.get();
    landSounded = time;
    soundAt("hover", entity->convertTo(Vec3::zero(), nullptr));
}
