// A filming take: what the app drew, frame by frame, written to a file, so
// that the same frames can be drawn again afterwards from somewhere else:
// from where a camera stood that was filming the person in the headset
// (quest/film/README.md).
//
// What is written is what the renderer put on screen (Renderer::drawn), not
// what the user did: every model's place, look and picture as that frame had
// them. Drawn again, a take cannot come out differently from what was seen,
// whatever the agent, the network or the app's own code have done since.
//
// One file, `take.bin`: "MPTAKE01", then pieces, each a four-letter tag, a
// length and a body (little-endian throughout).
//   HEAD   text (JSON): who recorded it and how its clock runs
//   MESH   a mesh, when it is first drawn and each time it changes
//   TEXR   a picture, once, read back from the GPU (deflated)
//   VIDE   a film a card plays: its number and its file
//   FRAM   a frame: its time, the head, the hands, the filming sheet, and
//          the models drawn, of which only those that changed are spelled out
//   SYNC   the time a sync sound left the speaker (audio.h)
//   CAMI   text (JSON): what the headset says of its own cameras (their lenses, where they sit)
//   CAMR   a picture from one of the headset's cameras, with when it was taken: the sheet is
//          found in these afterwards, far more surely than the headset finds it for itself
//   TAIL   how many frames there were: a file without it was cut short
// A mesh or picture always comes before the first frame that draws it, except
// pictures, which are read back a few a frame and may come a little after:
// whoever plays the take finds them all before it begins.
#pragma once
#include <array>
#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <vector>

#include "platform.h"
#include "render.h"
#include "scene.h"

namespace take {

/// What a frame carries besides what was drawn.
struct Moment {
    /// Seconds on the take's own clock, for the moment the frame is seen. On the headset this is
    /// CLOCK_MONOTONIC at the display time OpenXR predicts; the sync sounds are on the same clock.
    double time = 0;
    /// The renderer's `time` (the shaders' clock), and what the host drew round the scene.
    double appTime = 0;
    float veil = 1, dim = 0;
    /// In the scene's space, as everything drawn is.
    std::optional<Mat4> head;
    /// The filming sheet (quest/film/sheet.py), where the headset sees it: its middle, x to its
    /// right, y to its top, z out of its face.
    std::optional<Mat4> sheet;
    bool handTracked[2] = {false, false};
    Vec3 joints[2][int(platform::Joint::count)];
};

class Recorder {
public:
    Recorder();
    ~Recorder();
    /// Starts a take in `folder` (made if it is not there). `about` is JSON members, without braces,
    /// for the head of the file: "host":"quest", …
    bool begin(const std::string& folder, const std::string& about);
    bool on() const;
    /// After the frame has been drawn (with `renderer.keepDrawn` set), on the frame thread with its GL context.
    void frame(Renderer& renderer, const Moment& moment);
    /// A sync sound left the speaker at `time` on the take's clock.
    void sync(double time);
    /// Any other piece, written as it is: `tag` is its four letters.
    void extra(const char* tag, const void* bytes, size_t count);
    /// Writes what is left and closes the file.
    void end();
    /// For the log: frames, megabytes, what is still waiting to be written.
    std::string describe() const;
    const std::string& folder() const;

private:
    struct Impl;
    std::unique_ptr<Impl> impl;
};

class Player {
public:
    Player();
    ~Player();
    struct About {
        std::string head;               // the HEAD piece's JSON
        int frames = 0;
        double from = 0, to = 0;        // the first and last frame's time
        bool whole = false;             // it has its TAIL
        std::vector<double> syncs;
        /// The sheet as last seen, and how far it lay from where it was first seen (m): a sheet
        /// that moved during a take cannot place the camera.
        std::optional<Mat4> sheet;
        float sheetMoved = 0;
        int sheetFrames = 0;
        /// Where the head was, ten times a second: (time, x, y, z).
        std::vector<std::array<double, 4>> headAt;
        int pictures = 0, meshes = 0;
        /// The head in every frame, for placing what the headset's cameras saw: (time, where it was).
        std::vector<std::pair<double, Mat4>> heads;
        /// The pieces this reader does not use itself (CAMI, CAMR), for `extra` to fetch.
        struct Extra {
            uint32_t tag = 0;
            long long at = 0;
            uint32_t length = 0;
        };
        std::vector<Extra> extras;
    };
    /// One of `about().extras`, whole.
    std::vector<uint8_t> extra(const About::Extra& which);
    /// Reads the take through once. False for a file that is not a take.
    bool open(const std::string& file);
    const About& about() const;
    /// Brings `root()` and `moment()` to the last frame at or before `time`. False before the first
    /// frame and once `time` is more than `slack` seconds past the last: nothing is to be drawn then.
    bool seek(double time, double slack = 0.1);
    /// The models of the frame, flat, each where it was in the world.
    EntityRef root() const;
    const Moment& moment() const;
    /// Asked for each film a frame shows: the film's frame at `seconds`, or null. Without it no film is drawn.
    std::function<TextureRef(const std::string& source, double seconds)> videoFrame;
    /// Models left out so far because their picture was never written down.
    int missing() const;

private:
    struct Impl;
    std::unique_ptr<Impl> impl;
};

}  // namespace take
