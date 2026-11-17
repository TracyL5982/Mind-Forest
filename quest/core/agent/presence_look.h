// How Momo's presence moves, apart from drawing it (presence_view.h draws it): where Momo rests as the head turns, how
// it looks in each state, which lines of words show beside it, and the agents' lines above them, and how they come and
// go. Nothing here touches the scene, so the tests drive it frame by frame.
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

/// How Momo looks, apart from drawing it (presence_view.cpp draws it): CurioCity's Momo, from ClandestineOperation's
/// Assets/Scripts/AgentVisual (AgentRing, AgentNoiseDisc) and AgentSphere, with the values its Scene.scene gives them.
/// Three hollow rings, cyan, magenta and yellow, each bent by Perlin noise, add up to one white ring, with two white
/// eyes in the middle that blink and dart. A voice makes the rings wobble further and faster, the user's less than
/// Momo's own, and Momo's own voice draws them apart into coloured fringes. Two looks are Momo's own: thinking, three bubbles form at its upper right,
/// each new one swelling at the base and easing the others out, growing, then all three circle as they hang there;
/// while any agent works it wears a monocle, and its eyes glance about, slower and wider than they dart.
class Face {
public:
    // CurioCity's, in its centimetres, on its ring of 2 cm (the view scales them to Momo's size).
    static constexpr float radius = 2;                  // the ring's outer radius
    static constexpr float innerFraction = 0.2f;        // the band's width, of the radius
    static constexpr int points = 32;                   // round each rim
    static constexpr float noiseScale = 1;
    static constexpr float zGap = 0.1f;                 // between the three rings
    static constexpr float colorIntensity = 0.8f;
    static constexpr float quietDistortion = 1.5f, loudDistortion = 6;
    static constexpr float quietSpeed = 0.15f, loudSpeed = 12;      // noise time a second
    static constexpr float divergence = 1.6f, divergenceExponent = 1.5f;
    static constexpr float eyeSize = 0.08f;             // half the width
    static constexpr float eyeAspect = 5;               // height to width
    static constexpr float eyeDistance = 0.8f, eyeHeight = 0.19f, eyeForward = 1;
    static constexpr float blinkMin = 1.8f, blinkMax = 4, blinkDuration = 0.1f;
    static constexpr float dartMin = 3, dartMax = 6, dartHold = 1.8f, dartAmount = 0.5f;
    static constexpr float attack = 18, release = 6;    // AgentSphere's envelope: how fast it follows a voice up, and down
    static constexpr float speakPulse = 0.18f;          // AgentSphere: it swells this much at full voice
    // Momo's own.
    // How far the user's voice bends the ring and hurries it, of what Momo's own voice does. Kai, 2026-11-16: "Momo
    // morphs a bit too much when you speak", 40% less, and only then. The swell (speakPulse) is as it was.
    static constexpr float userMorph = 0.6f;
    static constexpr float glanceMin = 0.9f, glanceMax = 1.6f;  // s between glances while searching
    static constexpr float glanceAmount = 0.55f;        // as far as the eyes go to either side, past where darts mostly go
    static constexpr float glanceToMonocle = 0.22f;     // and toward the monocle's side, so it stays between the ring and the other eye
    static constexpr float glanceEase = 6;              // a second: slower than a dart's 25
    // The monocle frames the eye on the viewer's left with room round it, set a little outward so it clears the other
    // eye, in fine lines: on the headset at 1.25 m its outline is about a pixel, the eye two.
    static constexpr float monocleRadius = 0.74f;
    static constexpr float monocleShift = 0.12f;
    static constexpr float monocleLine = 0.06f, cordLine = 0.045f;

    /// A thinking bubble: where it is, cm from Momo's middle, and how big.
    struct Dot {
        Vec2 at;
        float radius = 0;           // 0 before it has formed
    };
    // When the bubbles come and how long they stay. They start as the turn is sent, form one after another, and once
    // begun stay until all three have settled, then fade gently; Momo's voice never waits for them.
    static constexpr bool dotsWhenSent = true;          // false: only once thinking, Voice::sentFor after the turn is sent
    static constexpr float dotPopEvery = 0.35f;         // s from one bubble beginning to form to the next
    static constexpr float dotSwell = 0.3f;             // s a new bubble takes to swell up at the base
    static constexpr float dotGlide = 0.4f;             // s a bubble takes to glide one place out
    static constexpr float dotsAtLeast = 2 * dotPopEvery + dotGlide;    // s they show once begun: until all have settled
    static constexpr float dotsFade = 0.2f;             // s, about, they take to fade
    static constexpr float dotTurn = 2.0f;              // s each bubble takes to circle its place, once settled
    static constexpr float bubblesTop = 6.2f;           // cm above Momo's middle the highest reaches
    /// Bubble `j`, 0 the first to form (which ends farthest and largest), `rising` s after the first began.
    static Dot dot(int j, float rising);

    struct Look {
        float shown = 0;            // 0 gone … 1
        float voice = 0;            // the voice it answers to, through AgentSphere's envelope, 0…1
        float time = 0;             // the rings' noise time
        float distortion = quietDistortion;
        float divergence = 0;       // how far apart the three rings' noise times are: their colour
        float scale = 1;            // it swells with a voice
        float openness = 1;         // the eyes: 1 open, 0 shut
        Vec2 gaze;                  // where the eyes have gone, cm
        float monocle = 0;          // 0 off … 1 on
        float dots = 0;             // the thinking dots: 0 gone … 1
        float rising = 0;           // s since they began to come
    };

    explicit Face(uint32_t seed = 7);
    void update(const Presence& p, float dt);
    const Look& look() const { return look_; }
    /// Its eyes glance about, not dart: some agent is at work.
    bool glancing() const { return searching; }

private:
    Look look_;
    uint32_t seed;
    float clock = 0;
    float colour = 0;               // how far the voice is Momo's: only its own voice parts the rings into colour
    float nextBlink = 0, blinkStart = -1;
    float nextDart = 0;
    bool centred = true;
    Vec2 target;
    bool searching = false;
    bool slow = false;              // the eyes are on their way back from glancing about
    float side = 1;
    float random(float lo, float hi);
};

/// Whose a line of words is: the user's words, Momo's, a word on what is happening (the hint, "Listening…",
/// "Thinking…"), or an agent's line above them, each set in a style of its own.
enum class Speaker { user, momo, status, agent };

/// The words beside Momo: what the user says while they say it, then "Thinking…", then Momo's words as they are
/// spoken. They wrap to a width; the last two lines rest beside Momo, the upper one fainter, and an older line rises and
/// fades as a new one comes. A turn's words stay a while after it ends, then fade. Each line stands on a bar of its own
/// (presence_view.h), which is all there while its line is, however faint the words.
class Caption {
public:
    static constexpr int rows = 2;              // lines at rest
    static constexpr double linger = 6;         // s a turn's words stay once it is over
    static constexpr double hintFor = 10;       // s the hint stays
    static constexpr float upper = 0.6f;        // how much of itself the upper line shows

    enum class Part { hint, listening, user, thinking, momo, notice };

    struct Line {
        int key;            // a line of a turn keeps its key while its words change
        Speaker who;
        Part part;
        std::string text;
        float width;        // m, as measured
        float y = 0;        // in lines, up from the middle of the lines at rest
        float opacity = 0;
        float toY = 0, toOpacity = 0, ySpeed = 0;
        bool yields = false;    // it takes another line's place, and shows only once that one has gone
        bool seen = false;
        bool gone = false;      // no longer wanted, and fading
        float there = 0;        // 0 gone … 1: how much of its bar shows, which comes and goes as the line does
    };

    using Measure = std::function<float(const std::string&, Speaker)>;
    /// `width` measures words as they will be drawn in a speaker's style, m; `most` is the widest a line may be.
    Caption(Measure width, float most);
    /// `name` is what the agent answers to, for the hint.
    void update(const Presence& p, const std::string& name, double now, float dt);
    /// Every line that shows or is fading, at rest or not.
    const std::vector<Line>& lines() const { return lines_; }
    /// How wide the lines at rest are, m: the widest.
    float width() const;
    /// How many lines are at rest.
    int resting() const;

private:
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

    Measure measure;
    float most;
    std::map<std::pair<std::string, Speaker>, float> widths;    // each word's, this turn
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
    float wordWidth(const std::string& word, Speaker who);
    static Speaker speaker(Part part);
    float tone(const Entry& e) const;
    void place(float dt);
};

/// The agents' lines above Momo's words, apart from drawing them: one for each agent at work, "Scout · Searching museum
/// collections for dancing people", the one that began first lowest, each cut to one line. A line fades in as it
/// rises into its place, says "finished working" once its agent is done, and fades as it goes, the lines above it
/// sliding down into its place.
class Roster {
public:
    static constexpr const char* finished = "finished working";

    struct Line {
        std::string role;           // whose: a line keeps it while its words change
        std::string text;           // "Scout · Searching museum collections for…"
        size_t name = 0;            // how much of `text` is the agent's name
        float width = 0;            // m, as measured
        float y = 0;                // in lines, up from the lowest
        float opacity = 0;
        float toY = 0, toOpacity = 0, ySpeed = 0;
        AgentLine from;             // what it says, as the voice gave it
    };

    using Measure = std::function<float(const std::string&)>;
    /// `width` measures a line as it will be drawn, m; `most` is the widest a line may be.
    Roster(Measure width, float most);
    void update(const std::vector<AgentLine>& agents, float dt);
    /// Every line that shows or is fading.
    const std::vector<Line>& lines() const { return lines_; }
    /// How many lines are wanted: what the lines take up, once they have come and gone.
    int resting() const;
    /// The widest of the lines wanted, m.
    float width() const;

private:
    Measure measure;
    float most;
    std::vector<Line> lines_;

    void write(Line& line, const AgentLine& agent) const;
};

}  // namespace agent
