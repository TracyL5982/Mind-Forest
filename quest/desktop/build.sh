#!/bin/bash
# Builds the Mac preview (quest/desktop/preview). Needs GLFW: brew install glfw
#   quest/desktop/build.sh            the ocean
#   quest/desktop/build.sh --host-only   the host with its test scene only
set -e
cd "$(dirname "$0")"
REPO="$(cd ../.. && pwd)"
CORE=../core
OUT=build
mkdir -p $OUT
FLAGS="-std=c++20 -O2 -g -Wall -Wno-unused-variable -Wno-unused-function -Wno-missing-braces -Wno-deprecated-declarations \
  -I$CORE -I$CORE/ocean -I. -I/opt/homebrew/include -DREPO_ROOT=\"$REPO\""
sources=(main.cpp platform_mac.mm $CORE/base.cpp $CORE/json.cpp $CORE/scene.cpp $CORE/render.cpp $CORE/input.cpp $CORE/perf.cpp $CORE/async.cpp $CORE/app.cpp)
if [ "$1" = "--host-only" ]; then
  FLAGS="$FLAGS -DOCEAN_NO_SCENE"
else
  sources+=(canvas_mac.mm $CORE/canvas.cpp $CORE/ocean/*.cpp)
fi
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
xcrun clang++ "${objects[@]}" -o preview -L/opt/homebrew/lib -lglfw -framework OpenGL -framework Cocoa -framework IOKit \
  -framework CoreGraphics -framework CoreText -framework ImageIO -framework CoreFoundation -framework Foundation
echo "built quest/desktop/preview"
