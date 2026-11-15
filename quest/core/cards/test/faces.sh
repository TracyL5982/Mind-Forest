#!/bin/bash
# Draws every gallery sample's card, small and opened, to PNG files with the Mac's fonts (faces.cpp).
#   quest/core/cards/test/faces.sh <out folder>
set -e
[ -n "$1" ] || { echo "usage: $0 <out folder>"; exit 2; }
mkdir -p "$1"
OUTDIR="$(cd "$1" && pwd)"
cd "$(dirname "$0")"
BIN="${TMPDIR:-/tmp}/cards-faces"
CORE=../..
DESKTOP=../../../desktop
# Every card source with the Mac host's canvas, and the catalog for the ocean's sizes. Nothing that draws into
# the scene is called, so what it would link to is left out.
xcrun clang++ -std=c++20 -O1 -ObjC++ -fobjc-arc -Wno-deprecated-anon-enum-enum-conversion -I$CORE -I$CORE/ocean -I$DESKTOP \
  faces.cpp ../*.cpp $CORE/ocean/catalog.cpp $CORE/json.cpp $CORE/base.cpp $CORE/scene.cpp $CORE/canvas.cpp $CORE/async.cpp \
  $DESKTOP/canvas_mac.mm $DESKTOP/platform_mac.mm \
  -framework CoreGraphics -framework CoreText -framework ImageIO -framework CoreFoundation -framework Foundation \
  -Wl,-undefined,dynamic_lookup -o "$BIN"
"$BIN" "$OUTDIR"
