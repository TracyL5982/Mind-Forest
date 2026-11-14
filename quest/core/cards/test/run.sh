#!/bin/bash
# Builds and runs the footprint check: every type the card library draws, against the web client's own
# footprints. Pass the web library's golden file, agents/test/footprints.json on genui/integration.
#   quest/core/cards/test/run.sh <path to agents/test/footprints.json>
set -e
[ -n "$1" ] || { echo "usage: $0 <path to agents/test/footprints.json>"; exit 2; }
GOLDEN="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
cd "$(dirname "$0")"
OUT="${TMPDIR:-/tmp}/cards-footprints"
# Only the footprint code runs; the drawing code it links against needs no host.
xcrun clang++ -std=c++20 -O1 -Wall -Wno-unused-function -I../.. -I../../ocean footprints.cpp ../*.cpp ../../json.cpp ../../canvas.cpp \
  -Wl,-undefined,dynamic_lookup -o "$OUT"
"$OUT" "$GOLDEN"
