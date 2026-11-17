#!/bin/bash
# The headset's side of the walkthrough demo. The demo service must be running on this Mac: (cd agents && npm run demo).
#   agents/demo/headset.sh            over the cable: start the app on the headset, joined to the demo service
#   agents/demo/headset.sh wifi       the same, and move adb to the headset's Wi-Fi, so the cable can come out
#   agents/demo/headset.sh resume     on Wi-Fi, after the headset slept: reconnect
#   agents/demo/headset.sh restart    start the app again, joined as before (the page's "Empty stage" does this by itself)
#   agents/demo/headset.sh back       after recording: join the app to the hosted service again (quest/tools/judging.sh)
#   agents/demo/headset.sh status     what adb sees, and whether the service answers
# Flags for the app follow a "--": agents/demo/headset.sh -- -mute
#
# It works on the everyday copy of the app, "Mind Palace Ocean", which is the one that is kept up to date. Another copy is
# named by its suffix: QUEST_APP_SUFFIX=.film agents/demo/headset.sh for the filming copy. The app remembers the service it
# was last joined to, so after a recording the everyday copy joins the demo service until "back" is run.
# The service's key is read from its data folder (agents/data-demo, or MIND_PALACE_DATA) and is never printed.
set -e
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENTS="$(cd "$HERE/.." && pwd)"
REPO="$(cd "$AGENTS/.." && pwd)"
export QUEST_APP_SUFFIX="${QUEST_APP_SUFFIX-}"
export MIND_PALACE_DATA="${MIND_PALACE_DATA:-$AGENTS/data-demo}"
PORT="${MIND_PALACE_PORT:-8787}"

mode=usb
case "$1" in usb|wifi|resume|restart|back|status) mode="$1"; shift ;; esac
[ "$1" = "--" ] && shift
flags="$*"

if [ "$mode" != back ] && [ "$mode" != status ]; then
  curl -fs -m 5 "http://127.0.0.1:$PORT/api/demo/status" -H "authorization: Bearer $(cat "$MIND_PALACE_DATA/token" 2>/dev/null)" >/dev/null || {
    echo "The demo service is not answering on port $PORT. Start it: (cd agents && npm run demo)"
    exit 1
  }
fi

case "$mode" in
  usb|wifi)
    "$REPO/quest/tools/agent.sh" "$mode" ${flags:+-- $flags}
    ;;
  resume|status)
    "$REPO/quest/tools/agent.sh" "$mode"
    ;;
  restart)
    source "$REPO/quest/tools/env.sh"
    # The cable first, then Wi-Fi: with both, adb would not know which is meant.
    serial=$(adb devices | awk 'NR > 1 && $2 == "device" && $1 !~ /:/ {print $1; exit}')
    [ -n "$serial" ] || serial=$(adb devices | awk 'NR > 1 && $2 == "device" {print $1; exit}')
    [ -n "$serial" ] || { echo "adb sees no headset. Plug it in, or on Wi-Fi run: agents/demo/headset.sh resume"; exit 1; }
    export ANDROID_SERIAL="$serial"
    adb reverse "tcp:$PORT" "tcp:$PORT" >/dev/null
    "$REPO/quest/tools/run.sh" -- -agent "ws://127.0.0.1:$PORT" -agentToken "$(cat "$MIND_PALACE_DATA/token")" -cards $flags >/dev/null
    echo "started $APP_ID again, joined to the demo service"
    ;;
  back)
    "$REPO/quest/tools/judging.sh" ${flags:+-- $flags}
    ;;
esac
