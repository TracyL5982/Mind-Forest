// The shell of dust round the room: every piece of the library, far off, that a look brings near.
#pragma once
#include <memory>
#include <optional>
#include <set>
#include <vector>

#include "../base.h"
#include "../vecmath.h"
#include "../scene.h"
#include "shapes.h"
#include "stage.h"
#include "library.h"
#include "tree.h"
#include "art.h"

/// The ocean: dust lying on the floor around the user, out to the horizon.
/// Thousands of pale specks stand for a whole library; the films and museum
/// works that are really there are a little larger, show their picture, and
/// can be picked. A piece rests small, and grows where your head points:
/// with no way to know where the eyes look, the head stands in for them.
/// It is the lowest layer of everything: the tree's layers rise out of it.
///
/// The dust is one mesh, written once. It moves all the same: a swell
/// travels across it, lifting each speck as it passes, and it is stirred
/// into a new arrangement each time something happens above. Both are
/// worked out in its material (DustMaterial.usda), so the app only pushes
/// one number along. The pieces are stirred with it, some hundreds of small
/// moves made only while a stir runs.
class Shell {
public:
    EntityRef root = Entity::make();
    std::vector<EntityRef> specks;              // by piece: the films, then the works. What is picked; its size never changes
    std::vector<Vec3> homes;                    // where each piece lives on the shell: its middle, at rest

private:
    std::vector<EntityRef> faces;               // each piece's picture, which grows where you look
    std::vector<Vec2> full;                     // a picture's size at 1, m
    std::vector<Vec3> ups;                      // which way a picture grows: up, as it faces you
    std::vector<float> grown;                   // how large each picture is now
    std::optional<Vec3> aim;                    // where the growing is centred: it trails the head
    int stirring = 0;                           // pictures still on their way to a size
    std::vector<uint8_t> swollen;               // for the sound: the pieces whose swelling has been told of (`swelled`)
    std::set<int> out;
    std::optional<Material> material;
    // The dust's entity, beside the static `dust` (how many specks). C++ can't have both under one name.
    EntityRef dustEntity;
    std::vector<Vec3> rest;                     // each film's place before any stir
    std::vector<float> seeds;
    const Stage stage;

public:
    float shift = 0;
    // For the ocean's sound: the pieces that
    // began to swell in the last `look`, for a glint each, and where the swelling is centred.
    std::vector<int> swelled;
    std::optional<Vec3> aimed() const { return aim; }

    static constexpr float speckWidth = 0.085f; // m: a film at 1, 4.2 m off, about 1.2 degrees
    // Each of these can be tried at launch: `-oceanRest 0.5 -gazeZoom 1.2 -gazeCone 30 -gazeCore 0.4 -gazeEase 3`.
    static float small() { static const float v = asked("oceanRest").value_or(0.4f); return v; }    // how large a piece rests
    // The growth leans to the middle (Kai, 2026-11-15). The piece dead ahead grows to 2.1 and the growth falls
    // away from there to the cone's edge. `-gazeCore 0.4 -gazeZoom 1.4` grows everything in the inner 40% of the
    // cone to 1.4 alike.
    static float large() { static const float v = asked("gazeZoom").value_or(2.1f); return v; }     // and how large where your head points
    static float cone() { static const float v = asked("gazeCone").value_or(20); return v; }        // degrees across: the part of the view that grows
    static float core() { static const float v = asked("gazeCore").value_or(0); return v; }         // the share of the cone, from its middle, that grows all the way
    // As calm as the lens was tuned in the headset: the middle trails the head, and a piece takes its time.
    static constexpr float trail = 4;           // 1/s: how closely the middle follows the head
    static constexpr float sweep = 50;          // degrees a second, at most
    static float ease() { static const float v = asked("gazeEase").value_or(1.8f); return v; }      // 1/s: how fast a piece grows and shrinks

private:
    static std::optional<float> asked(const char* key) {
        double v = Flags::number(key);
        return v > 0 ? std::optional<float>(float(v)) : std::nullopt;
    }

public:
    static constexpr int dust = 3200;

    static constexpr float filmReach = 0.11f;   // m: how far a stir carries a film

    /// Things farther off are drawn a little larger, so the far ocean doesn't thin to nothing.
    static float farther(float dist) { return std::pow(dist / 4.2f, 0.7f); }

    /// (`works` is empty unless given; it stands before `material`, which must be given, so it is always written.)
    Shell(const Stage& stage, const std::shared_ptr<Art>& art, const std::vector<Clip>& clips, const std::vector<Work>& works,
          const std::optional<Material>& material);

    /// Carries the stir on to `value`: the dust in its material, the films here.
    void setShift(float value);

private:
    /// Where a film sits for the current stir: the same loop the dust's material draws,
    /// along the water, with only a little lift.
    Vec3 place(int i) const;

    /// The dust: one mesh of small squares on the floor, each turned to
    /// face you. A square's four corners carry the same place in the swell
    /// and the same seed, so it moves as one.
    void buildDust(const Stage& stage);

    /// The films and the works: older to the left, newer to the right, each
    /// a small picture standing on the water, turned to face you. None lies
    /// straight ahead and near, where the tree's earlier layers come down.
    /// A hundred films have the room of a narrow band; with the works there
    /// are several hundred pieces, which take a wider and deeper stretch of
    /// the water and stand closer together.
    void buildPieces(const Stage& stage, const std::shared_ptr<Art>& art, const std::vector<Clip>& clips, const std::vector<Work>& works);

public:
    /// A piece's picture as it shows right now: its middle, and how wide it is.
    Vec3 center(int i) const { return homes[i] + ups[i] * ((grown[i] - small()) * full[i].y / 2); }
    float width(int i) const { return full[i].x * grown[i]; }

    /// Pieces grow where the head points, from `eye` along `forward`, and
    /// shrink again as it turns away: all the way within the middle of a
    /// cone, less toward its edge, not at all outside it. A piece grows
    /// upward from its foot, which stays on the water, and no piece makes
    /// room for another: they stand far enough apart at their largest.
    /// With no head to go by (`forward` nil) every piece goes back to rest.
    /// Costs nothing while the head is still and every piece has arrived.
    void look(Vec3 eye, std::optional<Vec3> forward, float dt);

    /// A piece that has left for a tree leaves its place dim, so there's
    /// somewhere to come back to.
    void setOut(int film, bool isOut);

    std::optional<int> film(const EntityRef& entity) const;
};
