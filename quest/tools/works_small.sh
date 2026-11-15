#!/bin/bash
# Makes the small copies of the works' pictures (512 px JPEG, about 25 MB for 750), for cards a few centimetres wide:
# unpacking a 1600 px HEIC takes the headset about 55 ms, a small JPEG a few. Made once, beside the other caches in
# media-src (which git ignores); a later run only makes what is missing. push_media.sh and judge.sh run it.
#   tools/works_small.sh
set -e
source "$(dirname "$0")/env.sh"
SMALL="$REPO_ROOT/media-src/quest/works-small"
mkdir -p "$SMALL"
for f in "$REPO_ROOT"/public/works/full/*.heic; do
  out="$SMALL/$(basename "${f%.heic}").jpg"
  [ -f "$out" ] && [ "$out" -nt "$f" ] && continue
  echo "$f"
done > "$SMALL/.todo"
if [ -s "$SMALL/.todo" ]; then
  echo "works-small: making $(wc -l < "$SMALL/.todo" | tr -d ' ') small copies"
  tr '\n' '\0' < "$SMALL/.todo" | xargs -0 -P 6 -I{} sh -c 'sips -Z 512 -s format jpeg -s formatOptions 82 "$1" --out "$2/$(basename "${1%.heic}").jpg" >/dev/null 2>&1' _ {} "$SMALL"
fi
rm -f "$SMALL/.todo"
