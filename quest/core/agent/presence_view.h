// Momo in the scene, low in view: CurioCity's Momo, a white ring with two eyes, the words of the conversation beside
// it, the user's in white and Momo's in amber, and above them a small line for each agent at work. presence_look.h
// says how it moves; this draws it: Momo in light added to what is behind it, with nothing behind Momo itself, and
// under each line of words a bar of the labels' ink with hard edges and square corners, as the ocean's own labels
// have, so the words read against the room. Momo is a mesh written every frame, the bars one written while they
// change, and each line of words a picture of its own, drawn again only when its words change.
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
    /// WS87: what takes a pinch while the microphone is off: Momo herself, with her "microphone off" mark, and the
    /// note's button under its words. The same two entities for good, for the scene's picks to hold
    /// (OceanModel::microphonePicks); each takes pinches only while it shows.
    const EntityRef& momoTarget() const { return target; }
    const EntityRef& noteButton() const { return button; }

private:
    /// One line of words on screen. New words are drawn into a second picture laid over the first, and the first
    /// goes only once the second is on the GPU, so a line never blinks as its words change. An agent's line goes from
    /// the old words to the new by a cross-fade (`leaving`).
    struct Words {
        int key;
        std::string text;
        EntityRef shown;
        float width = 0;            // m, of what `shown` says
        std::string comingText;
        EntityRef coming;
        float comingWidth = 0;
        float appear = 0;           // eases in once there is a picture to show
        float bar = -1;             // m: how long its bar is, on its way to the words' length; -1 before it has one
        EntityRef leaving;          // the words before, fading out as `shown` fades in
        float leavingWidth = 0;
        float mix = 1;              // how far from `leaving` to `shown`, 0 … 1
    };
    /// The bar under one line of words, in Momo's plane, m.
    struct Bar {
        float left, right, bottom, top, alpha;
        bool operator==(const Bar&) const = default;
    };

    std::shared_ptr<Art> art;
    EntityRef group = Entity::make();
    Follow follow;
    Face face;
    Caption caption;
    Roster roster;
    LowLevelMeshRef light, backing;
    std::vector<uint32_t> scratch;  // a mesh's indices, before they are known to have changed
    float step;                     // m from one line of words to the next, and how tall its bar is
    float small;                    // m from one agent's line to the next, and how tall its bar is
    float size;                     // m: Momo's radius, 1.2 and then 1.5 times CurioCity's, which is one line of its words
    float edge;                     // m right of the group's middle, where the words are set round, to where the bars begin
    Vec2 middle;                    // m: Momo's middle, up and to the left of the group's (see `grown`)
    std::vector<Words> words, agents;
    EntityRef target = Entity::make(), button = Entity::make();
    EntityRef mark, buttonFace;     // what each shows: the mark's picture, and the button's
    std::string buttonWords;
    float markShown = 0, buttonShown = 0;
    double last = -1;
    std::vector<Bar> bars, barsDrawn;   // this frame's, and those the mesh holds
    float agentsFrom = 0;           // m up from the group's middle to its lowest agent's line, eased

    void draw();
    /// The mark and the note's button, after the words are laid: the button stands under the note's lowest line.
    void microphone(const Presence& presence, float dt);
    /// Lays a line's words at `y`. `crossFade` s, when more than 0, goes from the old words to the new by a cross-fade;
    /// otherwise the new take the old's place at once. Returns how solid the line is drawn, as its bar should be.
    float write(const std::string& text, Speaker who, size_t name, float y, float opacity, Words& w, float crossFade = 0, float dt = 0);
    EntityRef picture(const std::string& text, Speaker who, size_t name, float& width) const;
};

}  // namespace agent
