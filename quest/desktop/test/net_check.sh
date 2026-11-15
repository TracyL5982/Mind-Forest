#!/bin/bash
# Builds desktop/test/net_check and runs it against a scripted service on a spare port, started and stopped here.
set -e
cd "$(dirname "$0")/../.."
mkdir -p desktop/build
xcrun clang++ -std=c++20 -ObjC++ -fobjc-arc -Wall -Icore -Idesktop desktop/test/net_check.mm desktop/net_mac.mm -framework Foundation -o desktop/build/net_check
data=$(mktemp -d)
port=${PORT:-8792}
(cd ../agents && MIND_PALACE_PORT=$port MIND_PALACE_DATA=$data MIND_PALACE_HOST=127.0.0.1 npm run dev:fake >"$data/log" 2>&1) &
for i in $(seq 1 40); do curl -fs "http://127.0.0.1:$port/api/health" >/dev/null && break; sleep 0.5; done
status=0
desktop/build/net_check "http://127.0.0.1:$port" "$(cat "$data/token")" || status=1
kill $(lsof -nP -iTCP:$port -sTCP:LISTEN -t) 2>/dev/null || true
exit $status
