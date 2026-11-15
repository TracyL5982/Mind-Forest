// How Momo's presence moves, apart from drawing it (presence_view.h draws it): where the orb rests as the head turns,
// how the orb looks in each state, and which lines of words show beside it and how they come and go. Nothing here
// touches the scene, so the tests drive it frame by frame.
#pragma once
#include <cstdint>
#include <functional>
#include <map>
#include <optional>
#include <string>
#include <vector>

#include "presence.h"
#include "vecmath.h"

namespace agent {

/// Where the orb rests: low in view and a little left of the line of sight, so its words run off to the right. It
/// stays where it is in the room while it is comfortably in view, looked at or not, and only once the head has stayed
/// turned so far that it is not does it glide round to rest in front again. It is never fixed to the head, which is
/// uncomfortable in a headset, and looking down at it to read it never sends it away.
class Follow {
public:
    static constexpr float below = 28;          // degrees under the line of sight: under an open card's rows
    static constexpr float aside = -6;          // degrees to its left
    static constexpr float distance = 1.25f;    // m from the eyes
    static constexpr float slackYaw = 24;       // degrees it may be either side of its place in view before it follows
    static constexpr float slackDown = 18;      // further under the line of sight than its place, near the view's edge
    static constexpr float slackUp = 36;        // degrees above the line of sight it may be: the head looking down at it, and past it
    static constexpr float delay = 0.4f;        // s the head must stay turned so
    static constexpr float glide = 0.3f;        // s: about how long it takes to come round
    static constexpr float fastest = 150;       // degrees a second
    static constexpr float highest = -12;       // degrees of elevation: looking up, it stays below the open card
    static constexpr float lowest = -65;

    /// Once a frame, with where the head is.
    void update(const Mat4& head, float dt);
    Vec3 position() const;
    /// Upright, and turned to face the eyes.
    Quat orientation() const;
    /// Where it is: degrees to the right of ahead (-z), and up from level.
    float yaw() const { return yaw_; }
    float pitch() const { return pitch_; }
    bool moving() const { return coming; }

private:
    bool placed = false;
    float yaw_ = 0, pitch_ = 0;
    float yawSpeed = 0, pitchSpeed = 0;
    Vec3 eye{0, 1.5f, 0};
    Vec3 eyeSpeed;
    float out = 0;          // s the head has stayed turned past the slack
    bool coming = false;    // on its way to rest in front again
};

/// How the orb looks. Each state has a pose it settles into, so every change of state is a smooth one.
class Glow {
public:
    static constexpr float gathering = 0.55f;   // s the orb takes to gather in as a turn is sent

    struct Look {
        float shown = 0;        // 0 gone … 1
        float glow = 0;         // brightness
        float size = 0.8f;      // of its full size
        float warmth = 1;       // 0 the user's white, 1 Momo's amber
        float shimmer = 0;      // thinking: lights circling it
        float breath = 0;       // working: a slow rise and fall
        float voice = 0;        // the voice it answers to, smoothed, as far as this state answers it
        float gather = -1;      // 0…1 through gathering in, -1 when not
    };

    void update(const Presence& p, double now, float dt);
    const Look& look() const { return look_; }

private:
    Look look_;
    float level = 0;
    float hears = 0;
    Presence::State last = Presence::State::off;
    double sentAt = -10;
};

/// Who a line of words is from: the user, Momo (its words, and "Thinking…"), or neither (the hint, "Listening…").
enum class Speaker { user, momo, aside };

/// The words beside the orb: what the user says while they say it, then "Thinking…", then Momo's words as they are
/// spoken. They wrap to a width; the last two lines rest beside the orb, the upper one fainter, and an older line
/// rises and fades as a new one comes. A turn's words stay a while after it ends, then fade.
class Caption {
public:
    static constexpr int rows = 2;              // lines at rest
    static constexpr double linger = 6;         // s a turn's words stay once it is over
    static constexpr double hintFor = 10;       // s the hint stays
    static constexpr float upper = 0.6f;        // how much of itself the upper line shows

    struct Line {
        int key;            // a line of a turn keeps its key while its words change
        Speaker who;
        std::string text;
        float width;        // m, as measured
        float y = 0;        // in lines, up from the middle of the lines at rest
        float opacity = 0;
        float toY = 0, toOpacity = 0, ySpeed = 0;
        bool yields = false;    // it takes another line's place, and shows only once that one has gone
        bool seen = false;
    };

    /// `width` measures words as they will be drawn, m; `most` is the widest a line may be.
    Caption(std::function<float(const std::string&)> width, float most);
    /// `name` is what the agent answers to, for the hint.
    void update(const Presence& p, const std::string& name, double now, float dt);
    /// Every line that shows or is fading, at rest or not.
    const std::vector<Line>& lines() const { return lines_; }
    /// How wide the lines at rest are, m: the widest.
    float width() const;
    /// How many lines are at rest.
    int resting() const;

private:
    enum class Part { hint, listening, user, thinking, momo };
    struct Run {
        Part part;
        std::string text;
        bool operator==(const Run& o) const { return part == o.part && text == o.text; }
    };
    struct Entry {
        int key;
        Part part;
        std::string text;
        float width;
        bool current;       // this turn's, not the last one's
    };

    std::function<float(const std::string&)> measure;
    float most;
    std::map<std::string, float> widths;    // each word's, this turn
    float space = 0;

    Presence::State state = Presence::State::off;
    int turn = 0;
    std::string user, momo, hint, hintName;
    bool userFinal = false;
    double quietSince = -1e9;               // when the last turn ended
    std::optional<double> hintFrom;
    bool hintEarned = true;                 // nothing has been said since the hint last showed

    std::vector<Run> runs;
    std::vector<Entry> history;             // the last turn's lines, until the new one pushes them out
    double historyUntil = 0;
    std::vector<Entry> entries;             // this turn's, wrapped
    std::vector<Line> lines_;

    void startTurn(double now);
    void wrap();
    float wordWidth(const std::string& word);
    float tone(const Entry& e) const;
    void place(float dt);
};

}  // namespace agent
