#!/bin/bash
# Copies the media the app shows (what the visionOS bundle carries as
# resources) to the headset, once: about 700 MB. A later run sends only a
# folder whose files changed. The app must be installed first; uninstalling
# it removes the media.
#   tools/push_media.sh
set -e
source "$(dirname "$0")/env.sh"
adb shell pm path $APP_ID >/dev/null 2>&1 || { echo "Install the app first: tools/run.sh --build"; exit 1; }
STAGE=/data/local/tmp/ocean-media
adb shell "mkdir -p $DEVICE_FILES/media $DEVICE_FILES/out"

listing() { grep -v '\.DS_Store' | LC_ALL=C sort | shasum | cut -c1-16; }

# adb cannot create folders inside an app's own storage, so a folder goes to
# a staging place first and is copied across on the headset.
sync_dir() {
  local src="$1" name="$2"
  local want have
  want=$(cd "$src" && find . -type f -exec stat -f '%z %N' {} + | listing)
  have=$(adb shell "cd $DEVICE_FILES/media/$name 2>/dev/null && find . -type f -exec stat -c '%s %n' {} +" | tr -d '\r' | listing)
  if [ "$want" = "$have" ]; then
    echo "$name: up to date"
    return
  fi
  echo "$name: sending $(du -sh "$src" | cut -f1)"
  adb shell "rm -rf $STAGE/$name && mkdir -p $STAGE"
  adb push "$src" "$STAGE/$name" | tail -1
  adb shell "find $STAGE/$name -name .DS_Store -delete; rm -rf $DEVICE_FILES/media/$name && cp -r $STAGE/$name $DEVICE_FILES/media/$name && rm -rf $STAGE/$name"
}

"$QUEST_ROOT/tools/works_small.sh"
SMALL="$REPO_ROOT/media-src/quest/works-small"

adb push "$REPO_ROOT/visionos/MindPalace/Resources/ocean.json" $DEVICE_FILES/media/ocean.json | tail -1
# Notes' own pictures: the visionOS bundle holds them at its top, beside ocean.json.
for f in "$REPO_ROOT"/visionos/MindPalace/Resources/Ocean/*; do
  [ -f "$f" ] && adb push "$f" "$DEVICE_FILES/media/$(basename "$f")" | tail -1
done
sync_dir "$REPO_ROOT/public/clips" clips
sync_dir "$REPO_ROOT/public/works" works
sync_dir "$SMALL" works-small
adb shell "du -sh $DEVICE_FILES/media"
