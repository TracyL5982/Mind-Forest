// Which scene the hosts run: the ocean, or with `-testScene`, a plain scene
// that exercises the renderer and the hand rays without any media.
#pragma once
#include <memory>

#include "scene.h"

std::unique_ptr<PalaceScene> makeScene();
