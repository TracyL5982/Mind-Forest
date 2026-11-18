#!/bin/bash
# Builds the judging APK: "Mind Palace", com.kaifengwu.mindpalace.ocean.judge, release-signed with the key in
# ~/.mind-palace/keys, joining the service named in ~/.mind-palace/judging.properties by itself, and carrying its media
# inside, so a judge installs one file and opens it. It installs beside the user's two apps and replaces neither.
#   tools/judge.sh             build it, check it, and say where it is
#   tools/judge.sh --install   and install it on the connected headset
set -e
source "$(dirname "$0")/env.sh"
install=0
[ "$1" = "--install" ] && install=1
STAGE="$QUEST_ROOT/android/app/build/judge-media"
OUT="$QUEST_ROOT/android/app/build/outputs/apk/judge"
TOOLS="$ANDROID_HOME/build-tools/34.0.0"
JUDGE_ID=com.kaifengwu.mindpalace.ocean.judge

"$QUEST_ROOT/tools/fetch-voice.sh"
"$QUEST_ROOT/tools/works_small.sh"

# The media as push_media.sh lays it out on the headset, under assets/media, with the list the app reads it by:
# the library's, and the app's own (in git): the sounds, Momo's recorded lines for the walk, the guide's hand model, the greeting's two fonts with their
# notice. Cloned, so the copy takes no room on this Mac.
rm -rf "$STAGE"
mkdir -p "$STAGE/media"
cp -c "$REPO_ROOT/library/ocean.json" "$STAGE/media/"
for f in "$REPO_ROOT"/library/notes/*; do [ -f "$f" ] && cp -c "$f" "$STAGE/media/"; done
cp -cR "$REPO_ROOT/library/clips" "$STAGE/media/clips"
cp -cR "$REPO_ROOT/library/works" "$STAGE/media/works"
cp -cR "$REPO_ROOT/media-src/quest/works-small" "$STAGE/media/works-small"
for own in sounds hands fonts voice; do
  [ -n "$(ls -A "$REPO_ROOT/media-src/quest/$own" 2>/dev/null)" ] || { echo "media-src/quest/$own is missing or empty"; exit 1; }
  cp -cR "$REPO_ROOT/media-src/quest/$own" "$STAGE/media/$own"
done
find "$STAGE" -name '.*' -type f -delete
(cd "$STAGE/media" && find . -type f | sed 's|^\./||' | LC_ALL=C sort > ../index.txt)
mv "$STAGE/index.txt" "$STAGE/media/index.txt"
count=$(wc -l < "$STAGE/media/index.txt" | tr -d ' ')
echo "media: $count files, $(du -sh "$STAGE/media" | cut -f1)"

(cd "$QUEST_ROOT/android" && ./gradlew assembleJudge --console=plain -q)
APK="$OUT/app-judge.apk"

# What a judge's headset would otherwise find out.
badging=$("$TOOLS/aapt2" dump badging "$APK")
echo "$badging" | grep -q "package: name='$JUDGE_ID'" || { echo "not $JUDGE_ID:"; echo "$badging" | head -1; exit 1; }
echo "$badging" | grep -q "application-label:'Mind Palace'" || { echo "not named Mind Palace"; exit 1; }
inside=$(zipinfo -1 "$APK" 'assets/media/*' | grep -v '/$' | grep -vcx 'assets/media/index.txt')
[ "$inside" = "$count" ] || { echo "the APK holds $inside of the $count media files"; exit 1; }
deflated=$(zipinfo "$APK" 'assets/media/*' | grep -v 'assets/media/index.txt' | awk '$6 != "stor"' | grep -c 'assets/media/' || true)
[ "$deflated" = 0 ] || { echo "$deflated media files are compressed inside the APK; films must be stored to play from it"; exit 1; }
signer=$("$TOOLS/apksigner" verify --print-certs "$APK")
version=$(echo "$badging" | sed -n "s/.*versionCode='\([0-9]*\)'.*/\1/p" | head -1)
NAMED="$OUT/MindPalace-judging-$version.apk"
cp -c "$APK" "$NAMED"
echo "$(echo "$badging" | head -1)"
echo "$(echo "$signer" | grep -E 'certificate (DN|SHA-256)')"
echo "$(du -h "$NAMED" | cut -f1)  $NAMED"

if [ $install = 1 ]; then
  adb install -r "$NAMED" | tail -1
fi
