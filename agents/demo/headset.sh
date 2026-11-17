#!/bin/bash
# The headset's side of the walkthrough demo. The demo service must be running on this Mac: (cd agents && npm run demo).
#   agents/demo/headset.sh            over the cable: start the app on the headset, joined to the demo service
#   agents/demo/headset.sh wifi       the same, and move adb to the headset's Wi-Fi, so the cable can come out
#   agents/demo/headset.sh resume     on Wi-Fi, after the headset slept: reconnect
#   agents/demo/headset.sh restart    start the app again, joined as before (the page's "Empty stage" does this by itself)
#   agents/demo/headset.sh back       after recording: join the app to the hosted service again (quest/tools/judging.sh)
#   agents/demo/headset.sh status     what adb sees, and whether the service answers
#   agents/demo/headset.sh page       open the control page of the demo on this Mac
# The demo also runs on Fly, with no Mac needed while recording (agents/deploy/demo.sh puts it there). Its address and key
# are in ~/.mind-palace/demo.properties (server=https://…, token=…), written by the deploy:
#   agents/demo/headset.sh fly        on the cable, once: start the app joined to the demo on Fly. The app remembers it, so
#                                     from then on it joins by itself over Wi-Fi, and run again it starts the app afresh
#   agents/demo/headset.sh fly-page   open the control page of the demo on Fly
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
case "$1" in usb|wifi|resume|restart|back|status|page|fly|fly-page) mode="$1"; shift ;; esac
[ "$1" = "--" ] && shift
flags="$*"

# The demo on Fly: its address and key, from the file the deploy wrote. Neither is printed.
FLY_FILE="$HOME/.mind-palace/demo.properties"
fly_value() { [ -f "$FLY_FILE" ] || return 0; sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*\([^[:space:]]*\)[[:space:]]*$/\1/p" "$FLY_FILE" | head -1; }
if [ "$mode" = fly ] || [ "$mode" = fly-page ]; then
  server="$(fly_value server)"; token="$(fly_value token)"
  [ -n "$server" ] && [ -n "$token" ] || { echo "$FLY_FILE needs server=https://… and token=…. agents/deploy/demo.sh writes it on the Mac that deploys; copy it here."; exit 1; }
  # (Twice, and patiently: a machine's first answer after a deploy can take a few seconds.)
  curl -fs -m 20 "$server/api/health" >/dev/null || curl -fs -m 20 "$server/api/health" >/dev/null || { echo "The demo at $server is not answering."; exit 1; }
  if [ "$mode" = fly-page ]; then
    open "$server/demo#token=$token"
    echo "opened the control page of $server"
    exit 0
  fi
  source "$REPO/quest/tools/env.sh"
  serial=$(adb devices | awk 'NR > 1 && $2 == "device" {print $1; exit}')
  [ -n "$serial" ] || { echo "adb sees no headset. Plug it in, and allow USB debugging in the headset."; exit 1; }
  adb -s "$serial" shell pm path $APP_ID >/dev/null 2>&1 || { echo "Install the app first: quest/tools/run.sh --build --release"; exit 1; }
  adb -s "$serial" shell am force-stop $APP_ID
  adb -s "$serial" shell am start -n $APP_ID/$APP_ACTIVITY --es args "'-agent $server -agentToken $token -cards $flags'" >/dev/null
  echo "started $APP_ID, joined to the demo at $server. It joins there by itself from now on; agents/demo/headset.sh back undoes that."
  exit 0
fi
if [ "$mode" = page ]; then
  open "http://localhost:$PORT/demo#token=$(cat "$MIND_PALACE_DATA/token" 2>/dev/null)"
  echo "opened the control page of the demo on this Mac"
  exit 0
fi

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
