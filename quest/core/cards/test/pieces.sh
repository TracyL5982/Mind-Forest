#!/bin/bash
# Builds and runs the check of the ocean's own pieces as cards (pieces.cpp): every note, film and work at the
# ocean's sizes, read from the repository's ocean.json, clips.json and works.json.
#   quest/core/cards/test/pieces.sh
set -e
cd "$(dirname "$0")"
BIN="${TMPDIR:-/tmp}/cards-pieces"
CORE=../..
DESKTOP=../../../desktop
REPO="$(cd ../../../.. && pwd)"
# The card library with the Mac host's canvas, the catalog and its libraries, and the open note's text blocks
# (notes.cpp) that a card's layout is made of. Nothing that draws into the scene is called.
xcrun clang++ -std=c++20 -O1 -ObjC++ -fobjc-arc -Wno-deprecated-anon-enum-enum-conversion -I$CORE -I$CORE/ocean -I$DESKTOP \
  pieces.cpp ../*.cpp $CORE/ocean/catalog.cpp $CORE/ocean/library.cpp $CORE/ocean/notes.cpp $CORE/json.cpp $CORE/base.cpp $CORE/scene.cpp \
  $CORE/canvas.cpp $CORE/async.cpp $DESKTOP/canvas_mac.mm $DESKTOP/platform_mac.mm \
  -framework CoreGraphics -framework CoreText -framework ImageIO -framework CoreFoundation -framework Foundation \
  -Wl,-undefined,dynamic_lookup -o "$BIN"
"$BIN" "$REPO"
