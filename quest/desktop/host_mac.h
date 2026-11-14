#pragma once
#include <optional>
#include <string>
#include <vector>

#include "platform.h"

namespace host {
extern std::string repoRoot;
extern std::optional<Mat4> head;
extern platform::Hand hands[2];
bool savePNG(const std::string& path, int width, int height, const std::vector<uint8_t>& bottomUpRGBA);
}
