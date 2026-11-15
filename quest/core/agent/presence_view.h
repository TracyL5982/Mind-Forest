// Momo in the scene: a soft glowing orb low in view, with the words of the conversation beside it, the user's in
// white and Momo's in its amber. presence_look.h says how it moves; this draws it: the orb's light, and a soft dark
// mist behind the words so they read against the room, each a mesh written every frame, and each line of words as a
// picture of its own, drawn again only when its words change.
#pragma once
#include <memory>
#include <optional>
#include <string>
#include <vector>

#include "presence.h"
#include "presence_look.h"
#include "scene.h"

class Art;

namespace agent {

class PresenceView {
public:
    /// Draws with the scene's type (`art`) and its line material, under `parent`.
    PresenceView(std::shared_ptr<Art> art, const Material& line, EntityRef parent);
    ~PresenceView();
    PresenceView(const PresenceView&) = delete;
    PresenceView& operator=(const PresenceView&) = delete;

    /// Once a frame. `name` is what the agent answers to; `workingAt` is where the card being worked on is, if one is.
    void frame(const Presence& presence, const std::string& name, std::optional<Vec3> workingAt, const Mat4& head, double now);

private:
    /// One line of words on screen. New words are drawn into a second picture laid over the first, and the first
    /// goes only once the second is on the GPU, so a line never blinks as its words change.
    struct Words {
        int key;
        std::string text;
        EntityRef shown;
        float width = 0;            // m, of what `shown` says
        std::string comingText;
        EntityRef coming;
        float comingWidth = 0;
        float appear = 0;           // eases in once there is a picture to show
    };

    std::shared_ptr<Art> art;
    EntityRef group = Entity::make();
    Follow follow;
    Glow glow;
    Caption caption;
    LowLevelMeshRef lights, mist;
    std::vector<uint32_t> scratch;  // a mesh's indices, before they are known to have changed
    float step;                     // m from one line of words to the next
    std::vector<Words> words;
    double last = -1;
    float mistWidth = 0, mistRows = 0, misty = 0;
    Vec3 mistDrawn{-1, -1, -1};
    float working = 0;              // how far the orb looks to the card being worked on
    std::optional<Vec3> workedOn;   // the last place it looked

    void draw(double now);
    void write(const Caption::Line& line, Words& w);
    EntityRef picture(const std::string& text, Speaker who, float& width) const;
};

}  // namespace agent
