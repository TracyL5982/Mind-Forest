#!/bin/bash
# Builds and runs the Quest size check (sizes.cpp): every gallery sample small and opened at the ocean's sizes.
#   quest/core/cards/test/sizes.sh
set -e
cd "$(dirname "$0")"
BIN="${TMPDIR:-/tmp}/cards-sizes"
CORE=../..
DESKTOP=../../../desktop
# The card library with the Mac host's canvas, and the catalog for the ocean's own sizes. Nothing that draws
# into the scene is called, so what it would link to is left out.
xcrun clang++ -std=c++20 -O1 -ObjC++ -fobjc-arc -Wno-deprecated-anon-enum-enum-conversion -I$CORE -I$CORE/ocean -I$DESKTOP \
  sizes.cpp ../*.cpp $CORE/ocean/catalog.cpp $CORE/json.cpp $CORE/base.cpp $CORE/scene.cpp $CORE/canvas.cpp $CORE/async.cpp \
  $DESKTOP/canvas_mac.mm $DESKTOP/platform_mac.mm \
  -framework CoreGraphics -framework CoreText -framework ImageIO -framework CoreFoundation -framework Foundation \
  -Wl,-undefined,dynamic_lookup -o "$BIN"
"$BIN"
