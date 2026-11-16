// The room, as the headset knows it: Meta's scene model, read through the
// OpenXR extensions that MR Utility Kit itself is built on (MRUK ships for
// Unity, Unreal and the Spatial SDK only; a native app talks to the scene
// model directly). Only tables are kept: the scene sits at one (core/ocean/desk.h).
//
// The user makes the scene model once, in the headset's Space Setup, and
// must allow the app to see it (com.oculus.permission.USE_SCENE, asked for
// by MainActivity). Without either there are simply no tables.
#pragma once
#include <map>
#include <string>
#include <vector>

#include <openxr/openxr.h>

#include "platform.h"

class Room {
public:
    /// A table: its anchor, and its top as it lies in the space it was last located in.
    struct Found {
        int id = 0;
        XrSpace space = XR_NULL_HANDLE;
        XrRect3DfFB box{};              // in the anchor's own space
        bool placed = false;            // located at least once
        Mat4 pose;                      // the anchor
        platform::Table top;
        bool seen = true;               // in the reading now under way
    };

    /// Whether the headset offers what this needs (to be asked before the instance is made).
    static std::vector<const char*> extensions();

    void start(XrInstance instance, XrSession session, bool enabled);
    /// Asks for the room's anchors, again if it has been read before. Results come by events.
    void read();
    /// True if the event was one of the room's.
    bool handle(const XrEventDataBuffer& event);
    /// Once a frame: where each table is in `base` at `time`.
    void locate(XrSpace base, XrTime time);
    /// Shows the headset's own Space Setup, for the user to scan the room (`-scanRoom`).
    void capture();

    /// The first reading is over, whatever it found.
    bool settled() const { return !enabled || readings > 0; }
    const std::vector<Found>& tables() const { return found; }
    const Found* table(int id) const;

private:
    bool enabled = false;
    XrInstance instance = XR_NULL_HANDLE;
    XrSession session = XR_NULL_HANDLE;
    PFN_xrQuerySpacesFB querySpaces = nullptr;
    PFN_xrRetrieveSpaceQueryResultsFB retrieveResults = nullptr;
    PFN_xrGetSpaceComponentStatusFB componentStatus = nullptr;
    PFN_xrSetSpaceComponentStatusFB setComponentStatus = nullptr;
    PFN_xrGetSpaceSemanticLabelsFB semanticLabels = nullptr;
    PFN_xrGetSpaceBoundingBox3DFB boundingBox3D = nullptr;
    PFN_xrGetSpaceBoundingBox2DFB boundingBox2D = nullptr;
    PFN_xrRequestSceneCaptureFB requestCapture = nullptr;

    bool reading = false;
    XrAsyncRequestIdFB request = 0;
    int attempt = 0;                    // which filter this reading is on (see read)
    int readings = 0;                   // readings finished
    int anchorsSeen = 0;                // anchors of any kind in the reading under way
    bool readAgain = false;
    std::vector<Found> found;
    std::map<std::string, int> ids;     // an anchor's uuid -> the id its table keeps
    int nextId = 1;

    void ask();
    void take(const XrSpaceQueryResultFB& result);
    void finish(XrResult result);
    bool has(XrSpace space, XrSpaceComponentTypeFB component, bool enable);
};
