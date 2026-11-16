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

# Small copies of the works' pictures (512 px JPEG, about 25 MB for 750), for cards a few centimetres wide:
# unpacking a 1600 px HEIC takes the headset about 55 ms, a small JPEG a few. Made once, beside the other
# caches in media-src (git ignores this one); a later run only makes what is missing.
SMALL="$REPO_ROOT/media-src/quest/works-small"
mkdir -p "$SMALL"
made=0
for f in "$REPO_ROOT"/public/works/full/*.heic; do
  out="$SMALL/$(basename "${f%.heic}").jpg"
  [ -f "$out" ] && [ "$out" -nt "$f" ] && continue
  echo "$f"
  made=$((made + 1))
done > "$SMALL/.todo"
if [ -s "$SMALL/.todo" ]; then
  echo "works-small: making $(wc -l < "$SMALL/.todo" | tr -d ' ') small copies"
  tr '\n' '\0' < "$SMALL/.todo" | xargs -0 -P 6 -I{} sh -c 'sips -Z 512 -s format jpeg -s formatOptions 82 "$1" --out "$2/$(basename "${1%.heic}").jpg" >/dev/null 2>&1' _ {} "$SMALL"
fi
rm -f "$SMALL/.todo"

# The app's own sounds (about 80 MB of wav, in git), made by quest/sound/synth.py: made again only when the
# script is not the one they were last made by (its hash is kept in quest/sound/made-by.sha; a file's date
# says nothing in a fresh clone). Needs numpy and scipy.
SOUNDS="$REPO_ROOT/media-src/quest/sounds"
SYNTH="$REPO_ROOT/quest/sound/synth.py"
STAMP="$REPO_ROOT/quest/sound/made-by.sha"
synth_now=$(shasum -a 256 "$SYNTH" | cut -d' ' -f1)
if [ ! -f "$SOUNDS/manifest.json" ] || [ "$(cat "$STAMP" 2>/dev/null)" != "$synth_now" ]; then
  echo "sounds: making them"
  if python3 "$SYNTH" --out "$SOUNDS"; then
    echo "$synth_now" > "$STAMP"
  else
    echo "sounds: could not be made (python3 with numpy and scipy is needed); the ones already there are sent as they are"
  fi
fi

adb push "$REPO_ROOT/visionos/MindPalace/Resources/ocean.json" $DEVICE_FILES/media/ocean.json | tail -1
# Notes' own pictures: the visionOS bundle holds them at its top, beside ocean.json.
for f in "$REPO_ROOT"/visionos/MindPalace/Resources/Ocean/*; do
  [ -f "$f" ] && adb push "$f" "$DEVICE_FILES/media/$(basename "$f")" | tail -1
done
sync_dir "$REPO_ROOT/public/clips" clips
sync_dir "$REPO_ROOT/public/works" works
sync_dir "$SMALL" works-small
[ -f "$SOUNDS/manifest.json" ] && sync_dir "$SOUNDS" sounds
# The headset's own hand model, for the guide's hands (in git; written once with `-dumpHandMesh`, see tools/hand_mesh.py).
[ -f "$REPO_ROOT/media-src/quest/hands/hand-right.bin" ] && sync_dir "$REPO_ROOT/media-src/quest/hands" hands
# The greeting's lettering (Fraunces 72pt Soft Light and its italic, SIL Open Font License; in git).
[ -d "$REPO_ROOT/media-src/quest/fonts" ] && sync_dir "$REPO_ROOT/media-src/quest/fonts" fonts
adb shell "du -sh $DEVICE_FILES/media"
