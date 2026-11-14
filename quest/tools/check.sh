#!/bin/bash
# Syntax-checks the ported sources with the Mac's clang: no build, no device.
#   tools/check.sh                 every .cpp under core/
#   tools/check.sh core/ocean/tree.cpp
cd "$(dirname "$0")/.."
files=("$@")
if [ ${#files[@]} -eq 0 ]; then
  while IFS= read -r f; do files+=("$f"); done < <(find core -name '*.cpp' | sort)
fi
status=0
for f in "${files[@]}"; do
  case "$f" in
    core/render.cpp) continue ;;   # needs OpenGL headers: checked by the real builds
  esac
  if ! xcrun clang++ -std=c++20 -fsyntax-only -Wall -Wno-unused-variable -Wno-unused-function -Wno-missing-braces \
       -ferror-limit=40 -Icore -Icore/ocean "$f"; then
    status=1
  fi
done
exit $status
