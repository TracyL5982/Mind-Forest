// What the Quest host's own files share: where things are on the device,
// and the head and hands the OpenXR loop read this frame.
#pragma once
#include <jni.h>

#include <optional>
#include <string>
#include <vector>

#include "platform.h"

namespace host {
extern std::string mediaDir;        // the visionOS bundle's resources, pushed by tools/push_media.sh
/// The APK's own assets. The judging build carries the media there (assets/media, listed in its index.txt), and a
/// resource is then read from the APK as "apk:media/<name>" in place of a file in mediaDir.
void useAssets(JNIEnv* env, jobject assets);
extern std::string dataDir;         // the app's own files
extern std::string outDir;          // what a run leaves for the Mac to pull: perf logs
extern std::optional<Mat4> head;
extern platform::Hand hands[2];
extern bool handsSupported;
// The room (platform.h, "The room"). The scene has its own space; `sceneFromRoom` is where that lies
// over the headset's (the OpenXR app space), and the head, hands and tables above and below are
// given through it. main.cpp keeps these current; platform_android.cpp hands them to the scene.
extern Mat4 sceneFromRoom;
extern std::vector<platform::Table> tables;
extern bool roomSettled;
extern bool readRoomAsked;          // the scene asked for the room to be read again
extern int heldTable;               // the table the scene is kept fixed to (0: none)
extern bool recentred;              // the headset's own bearings were set anew; cleared when the scene has been told
extern bool resumed;                // the app is in front again; cleared when the scene has been told
/// Once a frame, with the GL context current: latches every video's newest frame.
void tickVideos();
}
