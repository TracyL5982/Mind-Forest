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
    audio::play(fmt(forward ? "layer_up_%d" : "layer_down_%d", k), 1, after);
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

void OceanModel::soundLevel(int level) {
    int note = levelNotes[std::min(std::max(level, 0), 9)];
    if (hologram) soundAt(fmt("note_%02d", note).c_str(), hologram->entity->convertTo(Vec3::zero(), nullptr), 0.5f);
}

void OceanModel::updateSound(double now) {
    if (!audio::on()) return;
    // The ocean is always there, and draws back under a film's own sound.
    audio::level("ocean_bed", screenNode ? 0.3f : 1, 1.5f);
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
    if (!held.empty()) audio::level(held, heldLevel, 0.06f);
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
