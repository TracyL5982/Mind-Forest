#!/bin/bash
# Records the headset's own view (one eye, with the room) with the system's recorder, at a chosen size,
# without the Developer Hub: the Hub restarts the headset's system driver each time its quality is
# changed, which can leave the headset with no interface until it is restarted.
#   tools/record.sh start [1080|1440|2160|WxH] [fps] [Mbps]    default 1080 60 40; 2160x2160 is the whole view,
#                                                             of which every other shape is a crop
#   tools/record.sh stop [folder]                          ends it and pulls the film (default quest/film/out/recordings)
# The size, rate and bitrate are system properties the recorder reads when a recording begins
# (debug.oculus.capture.*); they are forgotten when the headset restarts, and while they are set they
# take the place of the Camera app's own settings. `tools/record.sh clear` gives those back.
set -e
source "$(dirname "$0")/env.sh"
SHOTS=/sdcard/Oculus/VideoShots
case "$1" in
  start)
    high="${2:-1080}"; fps="${3:-60}"; mbps="${4:-40}"
    case "$high" in
      1080) wide=1920 ;; 1440) wide=2560 ;; 2160) wide=3840 ;;
      *x*) wide="${high%x*}"; high="${high#*x}" ;;
      *) echo "size: 1080, 1440 or 2160 (16:9), or WIDTHxHEIGHT"; exit 1 ;;
    esac
    adb shell "setprop debug.oculus.capture.width $wide; setprop debug.oculus.capture.height $high; setprop debug.oculus.capture.fps $fps; \
      setprop debug.oculus.capture.bitrate $((mbps * 1000000)); setprop debug.oculus.fullRateCapture 1; \
      setprop debug.oculus.command_line_media_capture VideoCapture; \
      am startservice -n com.oculus.metacam/.capture.CaptureService -a START_INTERNAL_CAPTURE_TO_DISK -e capture_entrypoint ODH" >/dev/null
    echo "recording ${wide}x${high} at $fps a second, $mbps Mbps" ;;
  stop)
    adb shell "am startservice -n com.oculus.metacam/.capture.CaptureService -a STOP_INTERNAL_CAPTURE_TO_DISK" >/dev/null
    # (The file is finished a moment after the recorder is told to stop.)
    adb shell "sleep 3"
    newest=$(adb shell "ls -t $SHOTS | head -1" | tr -d '\r')
    to="${2:-$QUEST_ROOT/film/out/recordings}"; mkdir -p "$to"
    adb pull "$SHOTS/$newest" "$to/$newest" | tail -1
    echo "$to/$newest" ;;
  clear)
    adb shell 'for p in width height fps bitrate; do setprop debug.oculus.capture.$p ""; done; setprop debug.oculus.fullRateCapture ""'
    echo "the Camera app's own settings apply again" ;;
  *) sed -n 2,9p "$0"; exit 1 ;;
esac
