#pragma once
#include <optional>
#include <string>
#include <vector>

#include "platform.h"

namespace host {
extern std::string repoRoot;
extern std::optional<Mat4> head;
extern platform::Hand hands[2];
/// Where the scene's space lies over the preview's room (platform::carryScene); the head is given through it.
extern Mat4 sceneFromRoom;
/// The preview's one table, in its room, if `-deskAhead` asked for one.
extern std::vector<platform::Table> roomTables;
bool savePNG(const std::string& path, int width, int height, const std::vector<uint8_t>& bottomUpRGBA);
}
