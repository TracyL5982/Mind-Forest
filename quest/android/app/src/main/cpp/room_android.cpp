// The room's tables, from Meta's scene model (see room_android.h).
#include "room_android.h"

#include <algorithm>
#include <cmath>
#include <cstring>

#include "base.h"

namespace {
Mat4 poseMatrix(const XrPosef& p) {
    return Mat4::trs({p.position.x, p.position.y, p.position.z},
                     Quat{p.orientation.x, p.orientation.y, p.orientation.z, p.orientation.w}, {1, 1, 1});
}

/// Whether a comma-separated list of labels names a table ("DESK" is what older scans call one).
bool namesTable(const std::string& labels) {
    size_t from = 0;
    while (from <= labels.size()) {
        size_t to = labels.find(',', from);
        if (to == std::string::npos) to = labels.size();
        std::string one = labels.substr(from, to - from);
        if (one == "TABLE" || one == "DESK") return true;
        from = to + 1;
    }
    return false;
}
}  // namespace

std::vector<const char*> Room::extensions() {
    return {XR_FB_SPATIAL_ENTITY_EXTENSION_NAME, XR_FB_SPATIAL_ENTITY_QUERY_EXTENSION_NAME, XR_FB_SPATIAL_ENTITY_STORAGE_EXTENSION_NAME,
            XR_FB_SPATIAL_ENTITY_CONTAINER_EXTENSION_NAME, XR_FB_SCENE_EXTENSION_NAME, XR_FB_SCENE_CAPTURE_EXTENSION_NAME};
}

void Room::start(XrInstance instance, XrSession session, bool enabled) {
    this->instance = instance;
    this->session = session;
    if (!enabled) {
        logLine("[room] the headset does not offer its scene model to this app: no tables");
        return;
    }
    auto get = [&](const char* name, PFN_xrVoidFunction* out) { return XR_SUCCEEDED(xrGetInstanceProcAddr(instance, name, out)) && *out; };
    bool all = get("xrQuerySpacesFB", (PFN_xrVoidFunction*)&querySpaces) &&
               get("xrRetrieveSpaceQueryResultsFB", (PFN_xrVoidFunction*)&retrieveResults) &&
               get("xrGetSpaceComponentStatusFB", (PFN_xrVoidFunction*)&componentStatus) &&
               get("xrSetSpaceComponentStatusFB", (PFN_xrVoidFunction*)&setComponentStatus) &&
               get("xrGetSpaceSemanticLabelsFB", (PFN_xrVoidFunction*)&semanticLabels) &&
               get("xrGetSpaceBoundingBox3DFB", (PFN_xrVoidFunction*)&boundingBox3D) &&
               get("xrGetSpaceBoundingBox2DFB", (PFN_xrVoidFunction*)&boundingBox2D);
    get("xrRequestSceneCaptureFB", (PFN_xrVoidFunction*)&requestCapture);
    this->enabled = all;
    if (!all) logLine("[room] the scene model's functions are missing: no tables");
}

void Room::read() {
    if (!enabled) return;
    if (reading) {
        readAgain = true;
        return;
    }
    attempt = 0;
    ask();
}

/// One query for the room's anchors. The first asks for everything that carries a label; should
/// that come back empty, the next asks for everything with a volume, and the last for everything.
void Room::ask() {
    XrSpaceStorageLocationFilterInfoFB storage{XR_TYPE_SPACE_STORAGE_LOCATION_FILTER_INFO_FB};
    storage.location = XR_SPACE_STORAGE_LOCATION_LOCAL_FB;
    XrSpaceComponentFilterInfoFB component{XR_TYPE_SPACE_COMPONENT_FILTER_INFO_FB};
    component.next = &storage;
    component.componentType = attempt == 0 ? XR_SPACE_COMPONENT_TYPE_SEMANTIC_LABELS_FB : XR_SPACE_COMPONENT_TYPE_BOUNDED_3D_FB;
    XrSpaceQueryInfoFB info{XR_TYPE_SPACE_QUERY_INFO_FB};
    info.queryAction = XR_SPACE_QUERY_ACTION_LOAD_FB;
    info.maxResultCount = 128;
    info.timeout = 0;
    info.filter = attempt < 2 ? (const XrSpaceFilterInfoBaseHeaderFB*)&component : nullptr;
    info.excludeFilter = nullptr;
    for (Found& f : found) f.seen = false;
    anchorsSeen = 0;
    XrResult r = querySpaces(session, (const XrSpaceQueryInfoBaseHeaderFB*)&info, &request);
    if (XR_FAILED(r)) {
        logLine(fmt("[room] could not ask for the room: %d%s", int(r),
                    r == XR_ERROR_PERMISSION_INSUFFICIENT || r == XR_ERROR_SPACE_PERMISSION_INSUFFICIENT_META ? " (the app has not been allowed to see it)" : ""));
        finish(r);
        return;
    }
    reading = true;
}

bool Room::handle(const XrEventDataBuffer& event) {
    if (!enabled) return false;
    switch (event.type) {
    case XR_TYPE_EVENT_DATA_SPACE_QUERY_RESULTS_AVAILABLE_FB: {
        const auto& e = *(const XrEventDataSpaceQueryResultsAvailableFB*)&event;
        XrSpaceQueryResultsFB results{XR_TYPE_SPACE_QUERY_RESULTS_FB};
        if (XR_FAILED(retrieveResults(session, e.requestId, &results)) || results.resultCountOutput == 0) return true;
        std::vector<XrSpaceQueryResultFB> list(results.resultCountOutput);
        results.resultCapacityInput = uint32_t(list.size());
        results.results = list.data();
        if (XR_FAILED(retrieveResults(session, e.requestId, &results))) return true;
        if (e.requestId != request) return true;
        for (uint32_t i = 0; i < results.resultCountOutput; i++) take(list[i]);
        return true;
    }
    case XR_TYPE_EVENT_DATA_SPACE_QUERY_COMPLETE_FB: {
        const auto& e = *(const XrEventDataSpaceQueryCompleteFB*)&event;
        if (e.requestId == request && reading) finish(e.result);
        return true;
    }
    case XR_TYPE_EVENT_DATA_SPACE_SET_STATUS_COMPLETE_FB:
        return true;
    case XR_TYPE_EVENT_DATA_SCENE_CAPTURE_COMPLETE_FB: {
        const auto& e = *(const XrEventDataSceneCaptureCompleteFB*)&event;
        logLine(fmt("[room] Space Setup closed (%d): reading the room again", int(e.result)));
        read();
        return true;
    }
    default:
        return false;
    }
}

/// Whether an anchor has a component switched on; with `enable`, switches it on if it can be.
bool Room::has(XrSpace space, XrSpaceComponentTypeFB component, bool enable) {
    XrSpaceComponentStatusFB status{XR_TYPE_SPACE_COMPONENT_STATUS_FB};
    if (XR_FAILED(componentStatus(space, component, &status))) return false;
    if (status.enabled) return true;
    if (enable && !status.changePending) {
        XrSpaceComponentStatusSetInfoFB set{XR_TYPE_SPACE_COMPONENT_STATUS_SET_INFO_FB};
        set.componentType = component;
        set.enabled = XR_TRUE;
        set.timeout = 0;
        XrAsyncRequestIdFB id = 0;
        setComponentStatus(space, &set, &id);
    }
    return false;
}

void Room::take(const XrSpaceQueryResultFB& result) {
    anchorsSeen += 1;
    XrSpace space = result.space;
    if (!has(space, XR_SPACE_COMPONENT_TYPE_SEMANTIC_LABELS_FB, false)) return;
    // Its labels, asking for today's names (a table is TABLE; without this a runtime may still say DESK).
    XrSemanticLabelsSupportInfoFB support{XR_TYPE_SEMANTIC_LABELS_SUPPORT_INFO_FB};
    support.flags = XR_SEMANTIC_LABELS_SUPPORT_MULTIPLE_SEMANTIC_LABELS_BIT_FB | XR_SEMANTIC_LABELS_SUPPORT_ACCEPT_DESK_TO_TABLE_MIGRATION_BIT_FB |
                    XR_SEMANTIC_LABELS_SUPPORT_ACCEPT_INVISIBLE_WALL_FACE_BIT_FB;
    support.recognizedLabels = "TABLE,COUCH,FLOOR,CEILING,WALL_FACE,INVISIBLE_WALL_FACE,WINDOW_FRAME,DOOR_FRAME,STORAGE,BED,SCREEN,LAMP,PLANT,WALL_ART,OTHER";
    XrSemanticLabelsFB labels{XR_TYPE_SEMANTIC_LABELS_FB};
    labels.next = &support;
    if (XR_FAILED(semanticLabels(session, space, &labels)) || labels.bufferCountOutput == 0) return;
    std::string text(labels.bufferCountOutput, '\0');
    labels.bufferCapacityInput = uint32_t(text.size());
    labels.buffer = text.data();
    if (XR_FAILED(semanticLabels(session, space, &labels))) return;
    text.resize(strnlen(text.c_str(), text.size()));
    if (!namesTable(text)) return;

    XrRect3DfFB box{};
    if (has(space, XR_SPACE_COMPONENT_TYPE_BOUNDED_3D_FB, false) && XR_SUCCEEDED(boundingBox3D(session, space, &box))) {
        // (as given)
    } else {
        XrRect2Df flat{};
        if (!(has(space, XR_SPACE_COMPONENT_TYPE_BOUNDED_2D_FB, false) && XR_SUCCEEDED(boundingBox2D(session, space, &flat)))) return;
        box.offset = {flat.offset.x, flat.offset.y, 0};
        box.extent = {flat.extent.width, flat.extent.height, 0};
    }
    has(space, XR_SPACE_COMPONENT_TYPE_LOCATABLE_FB, true);

    std::string key((const char*)result.uuid.data, sizeof result.uuid.data);
    auto known = ids.find(key);
    int id = known != ids.end() ? known->second : (ids[key] = nextId++);
    for (Found& f : found) {
        if (f.id == id) {
            f.space = space;
            f.box = box;
            f.seen = true;
            return;
        }
    }
    Found f;
    f.id = id;
    f.space = space;
    f.box = box;
    found.push_back(f);
}

void Room::finish(XrResult result) {
    reading = false;
    // Nothing at all came back for this filter: try the next before believing the room is empty.
    if (XR_SUCCEEDED(result) && anchorsSeen == 0 && attempt < 2) {
        attempt += 1;
        ask();
        return;
    }
    if (XR_SUCCEEDED(result)) {
        found.erase(std::remove_if(found.begin(), found.end(), [](const Found& f) { return !f.seen; }), found.end());
    }
    readings += 1;
    if (XR_FAILED(result)) {
        logLine(fmt("[room] reading the room failed: %d", int(result)));
    } else if (anchorsSeen == 0) {
        logLine("[room] nothing known of this room: it has not been scanned (Settings > Environment setup > Space setup), "
                "or the app has not been allowed to see it (the \"spatial data\" permission)");
    } else {
        logLine(fmt("[room] %d anchors in the room, %d of them tables", anchorsSeen, int(found.size())));
    }
    if (readAgain) {
        readAgain = false;
        read();
    }
}

void Room::locate(XrSpace base, XrTime time) {
    const Vec3 up{0, 1, 0};
    for (Found& f : found) {
        XrSpaceLocation location{XR_TYPE_SPACE_LOCATION};
        if (XR_FAILED(xrLocateSpace(f.space, base, time, &location))) continue;
        const XrSpaceLocationFlags both = XR_SPACE_LOCATION_POSITION_VALID_BIT | XR_SPACE_LOCATION_ORIENTATION_VALID_BIT;
        if ((location.locationFlags & both) != both) continue;
        Mat4 pose = poseMatrix(location.pose);
        // Whichever of the anchor's axes stands upright is the table's height; the other two span its top.
        Vec3 axes[3] = {pose.direction({1, 0, 0}), pose.direction({0, 1, 0}), pose.direction({0, 0, 1})};
        float sizes[3] = {f.box.extent.width, f.box.extent.height, f.box.extent.depth};
        float offsets[3] = {f.box.offset.x, f.box.offset.y, f.box.offset.z};
        int tall = 0;
        for (int k = 1; k < 3; k++) {
            if (std::fabs(axes[k].y) > std::fabs(axes[tall].y)) tall = k;
        }
        if (std::fabs(axes[tall].y) < 0.9f) continue;       // not level: not a table top to stand things on
        int u = (tall + 1) % 3, v = (tall + 2) % 3;
        Vec3 middle{};
        middle[u] = offsets[u] + sizes[u] / 2;
        middle[v] = offsets[v] + sizes[v] / 2;
        // Its top: the higher end of the box along the upright axis.
        float lowEnd = offsets[tall], highEnd = offsets[tall] + sizes[tall];
        middle[tall] = axes[tall].y > 0 ? std::max(lowEnd, highEnd) : std::min(lowEnd, highEnd);
        Vec3 a = axes[u];
        a.y = 0;
        if (length(a) < 1e-3f) continue;
        a = normalize(a);
        platform::Table top;
        top.id = f.id;
        top.center = pose.point(middle);
        top.a = a;
        top.b = normalize(cross(up, a));
        top.halfA = sizes[u] / 2;
        top.halfB = sizes[v] / 2;
        if (!f.placed) {
            logLine(fmt("[room] table %d: %.2f x %.2f m, its top %.2f m above the floor", f.id, double(sizes[u]), double(sizes[v]), double(top.center.y)));
        }
        f.pose = pose;
        f.top = top;
        f.placed = true;
    }
}

void Room::capture() {
    if (!enabled || !requestCapture) return;
    XrSceneCaptureRequestInfoFB info{XR_TYPE_SCENE_CAPTURE_REQUEST_INFO_FB};
    XrAsyncRequestIdFB id = 0;
    XrResult r = requestCapture(session, &info, &id);
    logLine(fmt("[room] asked the headset for Space Setup: %d", int(r)));
}

const Room::Found* Room::table(int id) const {
    for (const Found& f : found) {
        if (f.id == id) return &f;
    }
    return nullptr;
}
