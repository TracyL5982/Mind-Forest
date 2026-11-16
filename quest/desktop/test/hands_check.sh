#!/bin/bash
# Builds and runs hands_check.cpp: the fist's and the knife's reading, on made-up hands. Exits with how many checks failed.
#   quest/desktop/test/hands_check.sh
set -e
cd "$(dirname "$0")"
CORE=../../core
OUT="${TMPDIR:-/tmp}/mp-hands-check"
xcrun clang++ -std=c++20 -O1 -I$CORE -I$CORE/ocean hands_check.cpp $CORE/ocean/hands.cpp $CORE/base.cpp -o "$OUT"
"$OUT"
