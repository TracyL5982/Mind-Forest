// Not a port: added for Quest. Which finger may work the small tree at your hand (Hologram): only one you can see.
//
// The small tree stands at about lap height, out of view while you look ahead, and a hand resting there took it and
// stilled every other input unseen. The user, 2026-11-17: "if I can see the finger, I can interact with the tree, if
// not, then no blocking and no interaction". OceanModel::feelHologram asks this, frame by frame; the angles and the
// time are here, to be tuned.
#pragma once
#include <cmath>
#include <optional>

#include "../vecmath.h"

struct HoloReach {
    static constexpr float takeAngle = 40;          // degrees from where the head looks: a fingertip in the zone takes it within this
    static constexpr float keepAngle = 50;          // the hand on it keeps it while its fingertip is within this
    static constexpr double unseenFor = 0.5;        // s that fingertip may be past it, holding nothing, before it lets go

    /// How far a fingertip is from where the head looks, degrees.
    static float off(Vec3 eye, Vec3 forward, Vec3 tip) {
        Vec3 to = tip - eye;
        if (!(length(to) > 1e-4f)) return 0;
        return std::acos(std::fmax(-1.f, std::fmin(1.f, dot(normalize(to), normalize(forward))))) * 180 / 3.14159265f;
    }

    /// Whether a fingertip in the zone, not yet on the tree, may take it.
    static bool takes(float degrees) { return degrees <= takeAngle; }

    /// The hand on the tree, this frame: `degrees` is how far its fingertip is from where the head looks, or nothing
    /// when that hand is no longer tracked (as out of view it often is).
    enum class Hold {
        on,             // seen: it works the tree, as Kai made it
        holdingNothing, // out of view: the tree is still lit, but it holds nothing for either hand
        letGo,          // out of view for `unseenFor`: the tree lets go, both hands free at once
    };
    Hold keep(std::optional<float> degrees, double now) {
        if (degrees && *degrees <= keepAngle) {
            unseenSince = std::nullopt;
            return Hold::on;
        }
        if (!unseenSince) unseenSince = now;
        return now - *unseenSince >= unseenFor ? Hold::letGo : Hold::holdingNothing;
    }
    /// The hand is off the tree.
    void reset() { unseenSince = std::nullopt; }
    /// Since when the hand on it has been out of view, if it is.
    std::optional<double> unseenSince;
};
