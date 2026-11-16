// The filming panel: a small card to the side of the person in the headset,
// from which they begin and end a take and lock the sheet's place
// (quest/film/README.md).
//
// It is drawn for the person only: it is never part of a take (Entity::unfilmed).
// Its two buttons take a pinch through Input::setFront, so a pinch on them
// never reaches the scene behind.
//
//   Filming                                   ● 0:12      what it is; a take's length while one runs
//   Sheet steady. Lock it.                                 one line on where things stand
//   [ Lock sheet ]                       [ Record ]        the two things to do
//
// It looks as the scene's own cards do: Art's dark panel, its one accent for
// the thing that sends (Record), the system font in two weights.
#pragma once
#include <optional>
#include <string>
#include <vector>

#include "scene.h"

class FilmPanel {
public:
    /// What the panel shows, as the host has it.
    struct State {
        bool sheetSeen = false;         // the headset sees the sheet now, or did a moment ago
        bool sheetSteady = false;       // seen from close by, its readings agreeing: worth locking
        bool sheetLocked = false;
        float sheetAway = -1;           // m from the head to the sheet at the last reading; below 0 when not known
        bool recording = false;
        double recorded = 0;            // s the take has run
        bool operator==(const State& o) const;
    };
    enum class Press { none, lock, record };

    FilmPanel();
    EntityRef root() const { return base; }
    /// Once a frame. The panel comes to the person's left when it is first shown, and again if they have gone from it.
    void update(const State& state, const std::optional<Mat4>& head, float dt);
    /// What a pinch landing on `entity` asks for.
    Press pressed(const EntityRef& entity) const;

private:
    EntityRef base, plate, lockButton, recordButton;
    State shown;
    bool drawnOnce = false, placed = false;
    double farFor = 0;
    float appear = 0;
    // A picture on its way: what is drawn stays until its replacement can be, so nothing blinks.
    struct Waiting {
        EntityRef onto;
        ImageRef image;
    };
    std::vector<Waiting> waiting;
    int shownSecond = -1;

    void place(const Mat4& head);
    void draw(const State& state);
    void set(const EntityRef& onto, const ImageRef& image);
};
