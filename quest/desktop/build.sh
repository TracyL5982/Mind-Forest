#!/bin/bash
# Builds the Mac preview (quest/desktop/preview). Needs GLFW: brew install glfw, or its macOS release
# unpacked with include/ and lib/libglfw3.a in GLFW_ROOT (default ~/Library/Developer/glfw-3.5.1).
#   quest/desktop/build.sh            the ocean
#   quest/desktop/build.sh --host-only   the host with its test scene only
set -e
cd "$(dirname "$0")"
REPO="$(cd ../.. && pwd)"
CORE=../core
OUT=build
if [ -d /opt/homebrew/include/GLFW ]; then GLFW_ROOT=/opt/homebrew; GLFW_LIB="-L/opt/homebrew/lib -lglfw"
else GLFW_ROOT="${GLFW_ROOT:-$HOME/Library/Developer/glfw-3.5.1}"; GLFW_LIB="$GLFW_ROOT/lib/libglfw3.a -framework QuartzCore"; fi
mkdir -p $OUT
../tools/fetch-voice.sh
VOICE="$(cd ../vendor/sherpa-onnx && pwd)"
FLAGS="-std=c++20 -O2 -g -Wall -Wno-unused-variable -Wno-unused-function -Wno-missing-braces -Wno-deprecated-declarations \
  -I$CORE -I$CORE/ocean -I. -I$GLFW_ROOT/include -I$VOICE/include -DREPO_ROOT=\"$REPO\""
sources=(main.cpp platform_mac.mm net_mac.mm $CORE/base.cpp $CORE/json.cpp $CORE/scene.cpp $CORE/render.cpp $CORE/input.cpp $CORE/perf.cpp $CORE/async.cpp $CORE/app.cpp)
if [ "$1" = "--host-only" ]; then
  FLAGS="$FLAGS -DOCEAN_NO_SCENE"
else
  sources+=(canvas_mac.mm $CORE/canvas.cpp $CORE/ocean/*.cpp $CORE/agent/*.cpp)
fi
[ "$1" = "--host-only" ] || sources+=($CORE/cards/*.cpp)
objects=()
pids=()
for s in "${sources[@]}"; do
  o="$OUT/$(basename "$s" | sed 's/\.[a-z]*$//').o"
  objects+=("$o")
  if [ ! -f "$o" ] || [ "$s" -nt "$o" ] || [ -n "$(find $CORE . -maxdepth 2 -name '*.h' -newer "$o" | head -1)" ]; then
    case "$s" in
      *.mm) xcrun clang++ $FLAGS -ObjC++ -fobjc-arc -c "$s" -o "$o" & ;;
      *) xcrun clang++ $FLAGS -c "$s" -o "$o" & ;;
    esac
    pids+=($!)
  fi
done
status=0
for p in "${pids[@]}"; do wait $p || status=1; done
[ $status = 0 ] || exit 1
VOICE_LIB=""
[ "$1" = "--host-only" ] || VOICE_LIB="-L$VOICE/mac -lsherpa-onnx-c-api -Wl,-rpath,$VOICE/mac"
xcrun clang++ "${objects[@]}" -o preview $GLFW_LIB $VOICE_LIB -framework OpenGL -framework Cocoa -framework IOKit \
  -framework CoreGraphics -framework CoreText -framework ImageIO -framework CoreFoundation -framework Foundation
echo "built quest/desktop/preview"
