// Filming on the headset (quest/film/README.md): finds the filming sheet in
// the room and records takes (core/take.h). All of it is off unless the app
// is launched with `-film` or `-take`.
//
//   -film                 look for the sheet, and record a take whenever asked to:
//                         adb shell setprop debug.mindpalace.take 1   (and 0 to end it; quest/film/film.py start / stop)
//   -take                 the same, and a take begins as soon as the scene has
//   -sheetPaper <name>    the paper the sheet was printed on: letter (default), a4, tabloid, a3
//
// The sheet is found through OpenXR's marker tracking (XR_EXT_spatial_marker_tracking over
// XR_EXT_spatial_entity), which on the Quest reads QR codes: the one in the sheet's middle. It
// needs the same permission as the room (com.oculus.permission.USE_SCENE).
//
// The headset places a QR code well only from close by: from further off its readings jump by
// centimetres. So where the sheet is held to be is the person's to settle. An outline of the paper
// is drawn where the headset has the sheet (never part of a take): amber, following the readings,
// and holding still once a few close readings agree (the head within 45 cm, facing it). The filming
// panel (core/ocean/filmpanel.h), to the person's left, has "Lock sheet": pinched, the outline's
// place is kept, the outline turns green, and no reading moves it again until "Unlock sheet". Only a
// locked sheet goes into a take. The panel's other button begins and ends a take, as
// `debug.mindpalace.take` does from the Mac.
//
// The surer way to place the sheet is worked out afterwards on the Mac (quest/film/headset.py), from
// the headset's own passthrough cameras: SheetCamera.kt opens them, and while a take is recorded a
// few of their pictures a second go into it, each with when it was taken. The headset says once
// what its cameras' lenses are and where they sit (CAMI). This needs the user's leave to use the
// headset's cameras (horizonos.permission.HEADSET_CAMERA), asked once a hand is held up.
//
// A take's clock is CLOCK_MONOTONIC, in seconds: a frame's time is when OpenXR predicts it is
// shown, and a sync sound's time is when the audio device says it reached the speakers.
#pragma once
#include <optional>
#include <string>
#include <vector>

#include <openxr/openxr.h>

#include "render.h"
#include "scene.h"
#include "take.h"
#ifndef OCEAN_NO_SCENE
#include "ocean/filmpanel.h"
#endif

class Filming {
public:
    /// Whether filming was asked for at launch.
    static bool wanted();
    /// What finding the sheet needs of the headset: all of them or none.
    static std::vector<const char*> sheetExtensions();

    void start(XrInstance instance, XrSystemId system, XrSession session, bool sheetOffered, bool clockOffered);
    /// Whether the sheet is being looked for but the app has not been allowed to see the room, which it needs.
    bool needsPermission() const { return on && sheetOffered && !sheetOn; }
    /// Once a frame, before the scene's update: asks after the sheet and takes what has come back.
    void locate(XrSpace base, XrTime time);
    /// Once a frame, after it has been drawn and the GL framebuffer let go: begins, records and ends takes.
    /// `started`: the scene is running. `elapsed`, `dim`: what the frame was drawn with.
    void frame(Renderer& renderer, bool started, double elapsed, float dim, XrTime displayTime);
    /// The sheet's outline, for the host to draw with the scene.
    EntityRef visuals() const { return outline; }
    /// The filming panel: for the host to draw, and to give to Input::setFront with `pressed`.
    EntityRef front() const;
    void pressed(const EntityRef& entity);
    /// The app is closing: a take under way is ended.
    void stop(Renderer& renderer);

private:
    bool on = false;
    XrInstance instance = XR_NULL_HANDLE;
    XrSession session = XR_NULL_HANDLE;

    // The sheet.
    bool sheetOn = false;
    XrSpatialContextEXT context = XR_NULL_HANDLE;
    XrFutureEXT contextFuture = XR_NULL_FUTURE_EXT, discoveryFuture = XR_NULL_FUTURE_EXT;
    double askedAt = 0;
    int readings = 0;
    std::optional<Mat4> sheetInRoom;        // where the outline is drawn, in the headset's own space
    std::optional<Mat4> sheetFixed;         // locked there by the person: what a take is given
    std::vector<Mat4> closeLooks;           // the close readings in a row so far
    bool sheetSteady = false;               // the outline is holding the middle of close readings that agreed
    double steadyAt = 0, seenAt = 0;
    float sheetAway = -1;
#ifndef OCEAN_NO_SCENE
    FilmPanel panel;
#endif
    double frameAt = 0;
    void lockSheet();
    Vec3 headInRoom;
    bool headKnown = false;
    float paperWidth = 0.2794f, paperHeight = 0.2159f, codeSide = 0.09f;
    EntityRef outline;
    PFN_xrPollFutureEXT pollFuture = nullptr;
    PFN_xrCreateSpatialContextAsyncEXT createContext = nullptr;
    PFN_xrCreateSpatialContextCompleteEXT completeContext = nullptr;
    PFN_xrCreateSpatialDiscoverySnapshotAsyncEXT createDiscovery = nullptr;
    PFN_xrCreateSpatialDiscoverySnapshotCompleteEXT completeDiscovery = nullptr;
    PFN_xrQuerySpatialComponentDataEXT queryData = nullptr;
    PFN_xrDestroySpatialSnapshotEXT destroySnapshot = nullptr;
    PFN_xrGetSpatialBufferStringEXT bufferString = nullptr;
    PFN_xrGetSpatialBufferUint8EXT bufferBytes = nullptr;
    XrSystemId system = XR_NULL_SYSTEM_ID;
    bool sheetOffered = false;
    double sheetTriedAt = 0;
    void beginSheet();
    void readSheet(XrSpatialSnapshotEXT snapshot);
    void takeReading(const Mat4& seen, float codeWidth);
    void makeOutline();

    // Takes.
    take::Recorder recorder;
    bool takeAtStart = false, asked = false, ending = false;
    std::string askedBy;                    // the property's last value: only a change of it is an asking
    double askCheckedAt = 0, beganAt = 0, endAt = 0, saidAt = 0;
    int64_t syncSeen = -1;                  // the last sync sound whose time has been written down
    bool syncDue = false;
    double syncAskedAt = 0;
    void *convertTime = nullptr;            // PFN_xrConvertTimeToTimespecTimeKHR, when the headset offers it
    double seconds(XrTime time) const;
    void begin(Renderer& renderer);
    bool camerasAsked = false, camerasTold = false;
    double handUpSince = 0;
    void cameras(bool recording);
    void noteSync(bool force);
};
