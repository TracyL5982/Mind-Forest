// What the ported sources ask of the machine they run on. Two hosts
// implement this: the Quest (android/, OpenXR) and a Mac preview window
// (desktop/), which exists so a change can be looked at without the headset.
#pragma once
#include <cstdint>
#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "vecmath.h"
#include "scene.h"

namespace platform {

// MARK: - Files

/// Where a bundled resource is, or "" if it isn't there. Names are as the
/// visionOS bundle has them: "ocean.json", "clips/clips.json", "clips/atlas.jpg",
/// "clips/full/012.mp4", "works/works.json", "works/atlas.jpg", "works/full/<id>.heic".
///   Bundle.main.url(forResource: "ocean", withExtension: "json")  -> resourcePath("ocean.json")
std::string resourcePath(const std::string& name);
/// A resource's whole text, or nullopt.
std::optional<std::string> readText(const std::string& name);
/// A folder the app may write to and that outlives it: Application Support.
std::string dataDirectory();
std::optional<std::string> readFile(const std::string& path);
/// Hands a web address to the system: UIApplication.shared.open(url).
void openURL(const std::string& url);
bool writeFile(const std::string& path, const std::string& contents);

// MARK: - Pictures

/// A picture file (JPEG, PNG, HEIC), decoded. With `maxPixel` > 0, it is
/// made no larger than that on its longer side (CGImageSourceCreateThumbnailAtIndex).
/// If the same file and size was asked for ahead with `prefetchImage`, this
/// hands that over (waiting for it if it is still being unpacked).
ImageRef loadImage(const std::string& path, int maxPixel = 0);
/// Starts unpacking a picture on a background thread, so that a later
/// `loadImage` of the same file and size costs the frame thread nothing.
void prefetchImage(const std::string& path, int maxPixel = 0);
/// Whether a picture asked for ahead is unpacked and waiting.
bool imageReady(const std::string& path, int maxPixel = 0);
/// The host's decoder, which the three above are built on. May be called from any thread.
ImageRef decodeImage(const std::string& path, int maxPixel);

// MARK: - Head and hands

/// The head, in world space (the floor is y = 0): HeadTracker.transform().
/// nullopt until tracking has a pose.
std::optional<Mat4> head();

/// The joints of a hand, in OpenXR's order.
enum class Joint : int {
    palm, wrist,
    thumbMetacarpal, thumbProximal, thumbDistal, thumbTip,
    indexMetacarpal, indexProximal, indexIntermediate, indexDistal, indexTip,
    middleMetacarpal, middleProximal, middleIntermediate, middleDistal, middleTip,
    ringMetacarpal, ringProximal, ringIntermediate, ringDistal, ringTip,
    littleMetacarpal, littleProximal, littleIntermediate, littleDistal, littleTip,
    count
};
// ARKit's names, for the ported gesture code:
//   .wrist -> wrist                  .thumbTip -> thumbTip
//   .indexFingerKnuckle -> indexProximal     .indexFingerTip -> indexTip
//   .middleFingerKnuckle -> middleProximal   .middleFingerTip -> middleTip
//   .ringFingerTip -> ringTip        .littleFingerTip -> littleTip

/// One hand this frame: a HandAnchor with its skeleton, already in world space.
struct Hand {
    bool tracked = false;
    Vec3 joints[int(Joint::count)];
    Quat rotations[int(Joint::count)];
    Vec3 at(Joint j) const { return joints[int(j)]; }
    /// The ray the system aims from this hand (XR_FB_hand_tracking_aim), if it gives one.
    bool aimValid = false;
    Vec3 aimOrigin;
    Vec3 aimDirection;
    /// The palm faces the user and the system has taken the pinch for its own menu.
    bool systemGesture = false;
    /// The system's own reading of an index-finger pinch, 0 (apart) to 1 (closed); -1 where it gives none.
    /// OpenXR's fingertip joints sit inside the finger, so two fingers that touch are still a centimetre
    /// or two apart by their joints: this is the measure to trust for "pinched".
    float pinchStrength = -1;
    /// The system's own reading of a closed hand, 0 (open) to 1 (a fist); -1 where it gives none
    /// (OpenXR's hand interaction profile, `grasp_ext/value`).
    float graspStrength = -1;
};
/// 0 is the left hand, 1 the right.
const Hand& hand(int which);
/// Whether this machine tracks hands at all (HandTrackingProvider.isSupported).
bool handTrackingSupported();

// MARK: - Video

}  // namespace platform

/// AVPlayer with one item, drawn through a Material::videoMaterial.
class VideoPlayer {
public:
    virtual ~VideoPlayer() = default;
    /// player.replaceCurrentItem(with: AVPlayerItem(url:)); an empty path is `replaceCurrentItem(with: nil)`.
    virtual void load(const std::string& path) = 0;
    virtual void play() = 0;
    virtual void pause() = 0;
    /// player.seek(to:), s.
    virtual void seek(double seconds) = 0;
    /// player.currentTime().seconds
    virtual double currentTime() = 0;
    /// The item's duration, s; 0 until known.
    virtual double duration() = 0;
    virtual void setVolume(float volume) = 0;
    virtual void setMuted(bool muted) = 0;
    /// Whether it is playing (rate != 0).
    virtual bool playing() = 0;
    /// Called when the item plays to its end (AVPlayerItem.didPlayToEndTimeNotification), on the frame thread.
    std::function<void()> didPlayToEnd;
    /// True once a frame can be drawn.
    virtual bool ready() = 0;
    /// The frame to draw; the host keeps it current.
    virtual TextureRef texture() = 0;
};
using VideoPlayerRef = std::shared_ptr<VideoPlayer>;

namespace platform {
VideoPlayerRef makeVideoPlayer();
}

// MARK: - Network
// For the agent service: one WebSocket and plain HTTP. Nothing here runs on the frame thread, and
// nothing calls back on it either; the caller hands results over (see core/agent/client.h).

namespace platform {

/// A WebSocket, `ws://` or `wss://`.
class Socket {
public:
    virtual ~Socket() = default;
    /// Queues a text message. False once the socket has closed.
    virtual bool send(const std::string& text) = 0;
    /// Closes it. `closed` still follows, once.
    virtual void close() = 0;
};
using SocketRef = std::shared_ptr<Socket>;

/// What a socket says, on a thread of the host's.
struct SocketEvents {
    std::function<void()> opened;
    std::function<void(const std::string& text)> text;
    /// Once, when it closes or could not open; `why` is for the log.
    std::function<void(const std::string& why)> closed;
};
/// Opens a WebSocket. The host pings it every 20 s, so a connection that died without a word is noticed.
SocketRef openSocket(const std::string& url, SocketEvents events);

struct Request {
    std::string method = "GET";
    std::string url;
    std::vector<std::pair<std::string, std::string>> headers;
    std::string body;
    /// When set, the reply's body goes to this file rather than into `Response::body`.
    std::string saveTo;
    double timeout = 30;
};
struct Response {
    int status = 0;             // 0 when no reply came
    std::string contentType;
    std::string body;
    std::string error;          // why no reply came, or why the file could not be written
};
/// One HTTP request, on a thread of the host's; `done` is called there.
void fetch(Request request, std::function<void(Response)> done);

}  // namespace platform

// MARK: - Typing
// The system keyboard, for typing to the agent where speaking won't do.

namespace platform {

/// What the user types, on a thread of the host's: the whole text after each change, then once the end.
struct KeyboardEvents {
    std::function<void(const std::string& text)> typed;
    /// `sent`: ended with the keyboard's send key, rather than closed.
    std::function<void(const std::string& text, bool sent)> done;
};
/// Brings up the system keyboard holding `text`. False where there is none to bring up.
bool showKeyboard(const std::string& text, KeyboardEvents events);
void hideKeyboard();

}  // namespace platform


// MARK: - Sound
// For talking to the agent: the microphone, and playing what the agent says. Nothing here runs on the frame
// thread, and nothing calls back on it.

namespace platform {

/// The microphone, open.
class Microphone {
public:
    virtual ~Microphone() = default;
    /// Closes it. `heard` is not called once this has returned.
    virtual void stop() = 0;
};
using MicrophoneRef = std::shared_ptr<Microphone>;

/// What the microphone hears, on one thread of the host's.
struct MicrophoneEvents {
    /// 16 kHz mono samples in -1...1, in runs of any length.
    std::function<void(const float* samples, size_t count)> heard;
    /// Once, when it could not open or stopped by itself; `why` is for the log. It may be opened again.
    std::function<void(const std::string& why)> failed;
    /// Once, when the user did not allow it. Opened again, it would ask them again.
    std::function<void()> denied;
    /// Once, when the host is about to ask the user to allow it (the Quest, the first time); `heard` or `denied` follows.
    std::function<void()> asking;
};
/// Opens the microphone. Where the user must allow it first (the Quest), sound starts once they have.
MicrophoneRef openMicrophone(MicrophoneEvents events);

/// A sound file playing.
class Sound {
public:
    virtual ~Sound() = default;
    /// Stops it; `done` follows, once.
    virtual void stop() = 0;
};
using SoundRef = std::shared_ptr<Sound>;
/// Plays a sound file (MP3 or WAV). `done` is called once, on a thread of the host's, when it ends, fails or is
/// stopped: true when it played to its end.
SoundRef playSound(const std::string& path, std::function<void(bool played)> done);

/// Raw sound played as it arrives: 16-bit mono PCM at `rate` Hz, in the order written. The host keeps it until `done`.
class Stream {
public:
    virtual ~Stream() = default;
    /// Queues samples after those already queued. Called from one thread (the frame thread), and never waits.
    virtual void write(const int16_t* samples, size_t count) = 0;
    /// Nothing more will be written: `done(true)` follows once everything queued has played.
    virtual void finish() = 0;
    /// Stops at once and drops what is queued: `done(false)` follows.
    virtual void stop() = 0;
};
using StreamRef = std::shared_ptr<Stream>;
/// `done` is called once, on a thread of the host's. Null, with `done(false)` already called, when it cannot play.
StreamRef playStream(int rate, std::function<void(bool played)> done);

}  // namespace platform
