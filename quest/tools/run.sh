#!/bin/bash
# Builds, installs and starts the app on the connected headset.
#   tools/run.sh --build                      build and install the debug build, then start it
#   tools/run.sh -- -demo -fps                start it with the app's launch flags
#   tools/run.sh --build --release -- -demo   the release build (for performance runs)
#   tools/run.sh --host-only --build -- -testScene   the host with its test scene only
#   tools/run.sh --wear                       tell the headset it is being worn (so it draws while on a desk)
#   tools/run.sh --unwear                     and give the wear sensor back
#   tools/run.sh --log                        follow the app's log
set -e
source "$(dirname "$0")/env.sh"
build=0; variant=Debug; scene=ON; flags=""
while [ $# -gt 0 ]; do
  case "$1" in
    --build) build=1 ;;
    --release) variant=Release ;;
    --host-only) scene=OFF ;;
    --wear) adb shell am broadcast -a com.oculus.vrpowermanager.prox_close >/dev/null; echo "wear sensor held closed"; exit 0 ;;
    --unwear) adb shell am broadcast -a com.oculus.vrpowermanager.automation_disable >/dev/null; echo "wear sensor released"; exit 0 ;;
    --log) exec adb logcat -s ocean:V ;;
    --) shift; flags="$*"; break ;;
    *) echo "unknown option $1"; exit 1 ;;
  esac
  shift
done
if [ $build = 1 ]; then
  "$QUEST_ROOT/tools/fetch-voice.sh"
  (cd "$QUEST_ROOT/android" && ./gradlew assemble$variant -PoceanScene=$scene -PappSuffix="${QUEST_APP_SUFFIX:-}" --console=plain -q)
  lower=$(echo $variant | tr A-Z a-z)
  adb install -r "$QUEST_ROOT/android/app/build/outputs/apk/$lower/app-$lower.apk" | tail -1
  # Compile the Kotlin side ahead of time: freshly installed, its text drawing is otherwise interpreted and about twice as slow.
  [ $variant = Release ] && adb shell cmd package compile -m speed -f $APP_ID | tail -1
fi
adb shell am force-stop $APP_ID
adb shell am start -n $APP_ID/$APP_ACTIVITY --es args "'$flags'" >/dev/null
echo "started: $flags"
