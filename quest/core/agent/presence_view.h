// Momo in the scene, low in view: CurioCity's Momo, a white ring with two eyes, the words of the conversation beside
// it, the user's in white and Momo's in amber, and above them a small line for each agent at work. presence_look.h
// says how it moves; this draws it: Momo in light added to what is behind it, and a soft dark mist behind the words so
// they read against the room, each a mesh written every frame, and each line of words as a picture of its own, drawn
// again only when its words change.
#pragma once
#include <memory>
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

    /// Once a frame. `name` is what the agent answers to.
    void frame(const Presence& presence, const std::string& name, const Mat4& head, double now);
    /// How Momo looks this frame, for `-presenceDemo` to tell.
    const Face& looks() const { return face; }

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
    Face face;
    Caption caption;
    Roster roster;
    LowLevelMeshRef light, mist;
    std::vector<uint32_t> scratch;  // a mesh's indices, before they are known to have changed
    float step;                     // m from one line of words to the next
    float small;                    // m from one agent's line to the next
    float size;                     // m: Momo's radius, one line of its words, as in CurioCity
    std::vector<Words> words, agents;
    double last = -1;
    float mistWidth = 0, mistBottom = 0, mistTop = 0, misty = 0;
    Vec4 mistDrawn{-1, -1, -1, -1};
    float agentsFrom = 0;           // m up from Momo's middle to its lowest agent's line, eased

    void draw();
    void write(const std::string& text, Speaker who, size_t name, float y, float opacity, Words& w);
    EntityRef picture(const std::string& text, Speaker who, size_t name, float& width) const;
};

}  // namespace agent
