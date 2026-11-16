#!/bin/bash
# Builds the agent core's tests with the Mac's clang and runs them twice, under the address and
# undefined-behaviour sanitizers and under the thread sanitizer. Then checks every outbound message
# against the service's own schema. The listener's tests hear the real spotter, which fetch-voice.sh fetches once.
#   quest/core/agent/test/run.sh
set -e
TEST="$(cd "$(dirname "$0")" && pwd)"
CORE="$(cd "$TEST/../.." && pwd)"
AGENTS="$(cd "$CORE/../../agents" && pwd)"
"$CORE/../tools/fetch-voice.sh"
VOICE="$(cd "$CORE/../vendor/sherpa-onnx" && pwd)"
OUT="$(mktemp -d "${TMPDIR:-/tmp}/mind-palace-agent-tests.XXXX")"
trap 'rm -rf "$OUT"' EXIT
SOURCES=("$CORE/base.cpp" "$CORE/json.cpp" "$CORE/agent/protocol.cpp" "$CORE/agent/mirror.cpp" "$CORE/agent/client.cpp" "$CORE/agent/spotter.cpp" "$CORE/agent/listener.cpp" "$CORE/agent/voice.cpp" "$CORE/agent/crew.cpp" "$CORE/agent/presence_look.cpp" "$CORE/agent/plots.cpp" "$CORE/agent/connection.cpp" "$TEST"/*_test.cpp "$TEST/main.cpp")
FLAGS=(-std=c++20 -g -O1 -Wall -Wextra -Werror -I"$CORE" -I"$VOICE/include" -L"$VOICE/mac" -lsherpa-onnx-c-api -Wl,-rpath,"$VOICE/mac")

xcrun clang++ "${FLAGS[@]}" -fsanitize=address,undefined -fno-sanitize-recover=all "${SOURCES[@]}" -o "$OUT/tests" &
xcrun clang++ "${FLAGS[@]}" -fsanitize=thread "${SOURCES[@]}" -o "$OUT/tests-tsan" &
wait %1 && wait %2

echo "address and undefined-behaviour sanitizers:"
"$OUT/tests" 2>"$OUT/log.txt" || { cat "$OUT/log.txt"; exit 1; }
echo "thread sanitizer:"
TSAN_OPTIONS=halt_on_error=1 "$OUT/tests-tsan" 2>"$OUT/log-tsan.txt" || { cat "$OUT/log-tsan.txt"; exit 1; }
echo "against the service's schema:"
"$OUT/tests" --outbound | (cd "$AGENTS" && node --no-warnings --import tsx "$TEST/outbound.ts")
