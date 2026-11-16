#!/bin/bash
# Builds and runs the checks of how a card is drawn: its pieces bent alike (bend.cpp).
#   quest/core/ocean/test/run.sh
set -e
cd "$(dirname "$0")"
CORE=../..
OUT="$(mktemp -d "${TMPDIR:-/tmp}/ocean-tests.XXXX")"
trap 'rm -rf "$OUT"' EXIT
xcrun clang++ -std=c++20 -O1 -g -Wall -I$CORE -I$CORE/ocean -fsanitize=address,undefined -fno-sanitize-recover=all \
  bend.cpp ../bend.cpp $CORE/scene.cpp $CORE/base.cpp -o "$OUT/bend"
"$OUT/bend"
