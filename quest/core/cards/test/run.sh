#!/bin/bash
# Builds and runs the footprint check: every type the card library draws, on the web client's own samples,
# against the sizing spec's numbers. Pass the web library's golden file, agents/test/footprints.json.
#   quest/core/cards/test/run.sh <path to agents/test/footprints.json>
set -e
[ -n "$1" ] || { echo "usage: $0 <path to agents/test/footprints.json>"; exit 2; }
GOLDEN="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
cd "$(dirname "$0")"
OUT="${TMPDIR:-/tmp}/cards-footprints"
CORE=../..
DESKTOP=../../../desktop
# A face's lines are counted by the host's own layout, so the Mac host's canvas is linked in. Nothing that
# draws into the scene is called, so what it would link to is left out.
xcrun clang++ -std=c++20 -O1 -ObjC++ -fobjc-arc -Wno-deprecated-anon-enum-enum-conversion -I$CORE -I$CORE/ocean -I$DESKTOP \
  footprints.cpp ../*.cpp $CORE/ocean/catalog.cpp $CORE/json.cpp $CORE/base.cpp $CORE/scene.cpp $CORE/canvas.cpp $CORE/async.cpp \
  $DESKTOP/canvas_mac.mm $DESKTOP/platform_mac.mm \
  -framework CoreGraphics -framework CoreText -framework ImageIO -framework CoreFoundation -framework Foundation \
  -Wl,-undefined,dynamic_lookup -o "$OUT"
"$OUT" "$GOLDEN"
