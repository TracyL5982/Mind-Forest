#!/bin/bash
# Joins the app on the headset to the agent service on this Mac. The headset reaches the service at its own
# 127.0.0.1, which adb carries to this Mac, over the cable or over Wi-Fi.
#   tools/agent.sh usb [-- flags]     over the cable, then start the app joined to the service
#   tools/agent.sh wifi [-- flags]    move adb to the headset's Wi-Fi (the cable is needed this once), then the same
#   tools/agent.sh resume             after the headset slept or adb lost it: reconnect and carry the port again
#   tools/agent.sh status             what adb sees and whether the service answers
# The service must be running on this Mac: (cd agents && npm start). Its access key is read from agents/data/token
# (or MIND_PALACE_DATA/token, or MIND_PALACE_TOKEN).
# It works on the copy installed with QUEST_APP_SUFFIX=.agents unless QUEST_APP_SUFFIX says otherwise ("" for the first).
set -e
export QUEST_APP_SUFFIX="${QUEST_APP_SUFFIX-.agents}"
source "$(dirname "$0")/env.sh"
PORT="${MIND_PALACE_PORT:-8787}"
TOKEN="${MIND_PALACE_TOKEN:-$(cat "${MIND_PALACE_DATA:-$REPO_ROOT/agents/data}/token" 2>/dev/null || true)}"
SAVED="$QUEST_ROOT/tools/.headset-address"
mode="$1"; shift || true
[ "$1" = "--" ] && shift
flags="$*"

service_up() {
  curl -fs "http://127.0.0.1:$PORT/api/health" >/dev/null || { echo "The service is not answering on port $PORT. Start it: (cd agents && npm start)"; exit 1; }
  [ -n "$TOKEN" ] || { echo "No access key: agents/data/token is missing. Start the service once, or set MIND_PALACE_TOKEN."; exit 1; }
}

carry() {
  adb reverse "tcp:$PORT" "tcp:$PORT" >/dev/null
  echo "port $PORT carried to the headset ($(adb get-serialno))"
}

start() {
  "$QUEST_ROOT/tools/run.sh" -- -agent "ws://127.0.0.1:$PORT" -agentToken "$TOKEN" $flags >/dev/null
  echo "started, joined to the service"
}

wifi_serial() {
  [ -f "$SAVED" ] || { echo "No headset address saved. Run tools/agent.sh wifi with the cable in once."; exit 1; }
  echo "$(cat "$SAVED"):5555"
}

case "$mode" in
  usb)
    service_up
    serial=$(adb devices | awk 'NR > 1 && $2 == "device" && $1 !~ /:/ {print $1; exit}')
    [ -n "$serial" ] || { echo "No headset on the cable. Plug it in, and allow USB debugging in the headset."; exit 1; }
    export ANDROID_SERIAL="$serial"
    carry
    start
    ;;
  wifi)
    service_up
    serial=$(adb devices | awk 'NR > 1 && $2 == "device" && $1 !~ /:/ {print $1; exit}')
    [ -n "$serial" ] || { echo "Plug the headset in once, so adb can be moved to its Wi-Fi."; exit 1; }
    address=$(adb -s "$serial" shell ip -f inet addr show wlan0 | awk '/inet / {print $2}' | cut -d/ -f1)
    [ -n "$address" ] || { echo "The headset has no Wi-Fi address. Join it to the same network as this Mac."; exit 1; }
    echo "$address" > "$SAVED"
    adb -s "$serial" tcpip 5555 >/dev/null
    sleep 2
    adb connect "$address:5555" | tail -1
    export ANDROID_SERIAL="$address:5555"
    carry
    start
    echo "You can unplug the cable. After the headset sleeps, run: tools/agent.sh resume"
    ;;
  resume)
    service_up
    export ANDROID_SERIAL="$(wifi_serial)"
    adb connect "$ANDROID_SERIAL" | tail -1
    carry
    echo "The app reconnects by itself within 15 seconds."
    ;;
  status)
    adb devices
    for s in $(adb devices | awk 'NR > 1 && $2 == "device" {print $1}'); do echo "$s carries: $(adb -s "$s" reverse --list | tr '\n' ' ')"; done
    curl -fs "http://127.0.0.1:$PORT/api/health" && echo || echo "service: not answering on port $PORT"
    ;;
  *)
    sed -n 2,9p "$0"
    exit 1
    ;;
esac
