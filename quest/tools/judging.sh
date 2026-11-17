#!/bin/bash
# Joins a developer copy of the app to the hosted judging service, from the file the judging build is made with
# (~/.mind-palace/judging.properties: server=https://…, appKey=…), so that Momo hears and answers in a build made
# on this Mac. (The judging APK itself also needs the signing key: tools/judge.sh.)
#   tools/judging.sh [-- flags]            the headset on the cable: start the app joined to the hosted service
#   tools/judging.sh preview [-- flags]    the Mac preview instead (it listens to this Mac's microphone, or -wakeClip)
#   tools/judging.sh status                whether the file is there and the service answers
# The token is the app key and a device id, as the judging build sends it (<appKey>.<32 hex digits>). Here the id
# is made from the headset's serial number and the app's id (for the preview, from this Mac's name), so each keeps
# one space on the service. Neither the key nor the token is printed. The app starts with -cards, as the judging
# build does. A headset's copy remembers the service and joins again when started from the library;
# tools/agent.sh forget undoes that.
set -e
source "$(dirname "$0")/env.sh"
FILE="$HOME/.mind-palace/judging.properties"
value() { [ -f "$FILE" ] && sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*\([^[:space:]]*\)[[:space:]]*$/\1/p" "$FILE" | head -1; }
server="$(value server)"
key="$(value appKey)"
mode="headset"
case "$1" in preview|status) mode="$1"; shift ;; esac
[ "$1" = "--" ] && shift
flags="$*"

if [ "$mode" = status ]; then
  [ -f "$FILE" ] && echo "file: $FILE" || echo "file: $FILE is missing"
  [ -n "$server" ] && echo "server: $server" || echo "server: not set"
  [ -n "$key" ] && echo "appKey: set" || echo "appKey: not set"
  [ -n "$server" ] && { curl -fs -m 8 "$server/api/health" >/dev/null && echo "service: answers" || echo "service: not answering"; }
  exit 0
fi
[ -n "$server" ] && [ -n "$key" ] || { echo "$FILE needs server=https://… and appKey=…"; exit 1; }
# (Twice, and patiently: its first answer after a restart has taken 7 s.)
curl -fs -m 20 "$server/api/health" >/dev/null || curl -fs -m 20 "$server/api/health" >/dev/null || { echo "The service at $server is not answering."; exit 1; }

if [ "$mode" = preview ]; then
  id=$(printf 'preview %s' "$(scutil --get ComputerName 2>/dev/null || hostname)" | md5 -q)
  exec "$QUEST_ROOT/desktop/preview" -agent "$server" -agentToken "$key.$id" -cards $flags
fi
serial=$(adb devices | awk 'NR > 1 && $2 == "device" {print $1; exit}')
[ -n "$serial" ] || { echo "No headset on the cable. Plug it in, and allow USB debugging in the headset."; exit 1; }
adb -s "$serial" shell pm path $APP_ID >/dev/null 2>&1 || { echo "Install the app first: tools/run.sh --build"; exit 1; }
id=$(printf '%s %s' "$(adb -s "$serial" get-serialno)" "$APP_ID" | md5 -q)
adb -s "$serial" shell am force-stop $APP_ID
adb -s "$serial" shell am start -n $APP_ID/$APP_ACTIVITY --es args "'-agent $server -agentToken $key.$id -cards $flags'" >/dev/null
echo "started $APP_ID, joined to $server${flags:+ with $flags}"
