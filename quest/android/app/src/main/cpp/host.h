// What the Quest host's own files share: where things are on the device,
// and the head and hands the OpenXR loop read this frame.
#pragma once
#include <optional>
#include <string>

#include "platform.h"

namespace host {
extern std::string mediaDir;        // the visionOS bundle's resources, pushed by tools/push_media.sh
extern std::string dataDir;         // the app's own files
extern std::string outDir;          // what a run leaves for the Mac to pull: perf logs
extern std::optional<Mat4> head;
extern platform::Hand hands[2];
extern bool handsSupported;
/// Once a frame, with the GL context current: latches every video's newest frame.
void tickVideos();
}
