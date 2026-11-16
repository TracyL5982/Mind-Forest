// What the ported sources ask of the machine they run on. Two hosts
// implement this: the Quest (android/, OpenXR) and a Mac preview window
// (desktop/), which exists so a change can be looked at without the headset.
#pragma once
#include <memory>
#include <optional>
#include <string>

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

// MARK: - The room (Quest only: nothing in the Swift)

// The scene keeps its own space: it is built once, round where the eyes were
// and the way they faced, and never rebuilt. The host lays that space over the
// room, and can lay it somewhere else (`carryScene`). The head, the hands and
// the tables below are always given in the scene's space.

/// A table the headset knows in the room (Meta's scene model, label TABLE):
/// its top, as a level rectangle.
struct Table {
    int id = 0;                     // the same table has the same id for as long as the app runs
    Vec3 center;                    // the middle of its top
    Vec3 a, b;                      // level, at right angles: along its two sides
    float halfA = 0, halfB = 0;     // m: half its size along each
};
/// The tables known right now: none until the room has been read, and none where it never can be
/// (no room set up on the headset, the permission refused, the Mac preview without `-desk`).
const std::vector<Table>& tables();
/// False while the first reading of the room is still on its way: the scene waits a moment for it.
bool roomSettled();
/// Reads the room again; what it finds is in `tables()` a moment later.
void readRoom();
/// Lays the scene somewhere else in the room: from now on the head, the hands and the tables are
/// given as `t` times where they were. `t` turns about the vertical and moves, nothing else.
void carryScene(const Mat4& t);
/// Keeps the scene fixed to this table from now on, should the headset shift its own bearings
/// under it (0: to none, the scene rides on the headset's own bearings).
void holdTo(int table);
/// True once, after the user has recentred the headset (held its menu button).
bool recentred();

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
