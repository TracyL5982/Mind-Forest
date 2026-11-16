#!/usr/bin/env bash
# Copies the user's list of Instagram accounts, and the library the Mac's service has read from them, onto the volume: never into
# git or the image. Then restarts the machine, so the service opens the one library every space searches. Run it again for a fuller one.
# Usage: deploy/instagram.sh   (MIND_PALACE_IG_LIBRARY names a library folder other than the main checkout's agents/data/instagram)
set -euo pipefail
cd "$(dirname "$0")/.."
FLY=${FLY:-fly}
APP=${FLY_APP:-mind-palace-judging}
LIST="$HOME/.mind-palace/instagram-following.md"
MAIN="$(cd "$(git rev-parse --git-common-dir)/.." && pwd)"
LIBRARY=${MIND_PALACE_IG_LIBRARY:-$MAIN/agents/data/instagram}
test -f "$LIST" || { echo "No list at $LIST" >&2; exit 1; }
test -d "$LIBRARY/accounts" && test -d "$LIBRARY/pictures" || { echo "No library at $LIBRARY" >&2; exit 1; }
WORK=$(mktemp -d)
trap 'rm -r "$WORK"' EXIT
tar -czf "$WORK/instagram.tgz" -C "$LIBRARY" accounts pictures
"$FLY" ssh console --app "$APP" -C "rm -f /data/instagram-following.md /data/instagram.tgz"
"$FLY" ssh sftp put "$LIST" /data/instagram-following.md --app "$APP"
"$FLY" ssh sftp put "$WORK/instagram.tgz" /data/instagram.tgz --app "$APP"
"$FLY" ssh console --app "$APP" -C "sh -c 'mkdir -p /data/instagram && tar -xzf /data/instagram.tgz -C /data/instagram && rm /data/instagram.tgz'"
"$FLY" apps restart "$APP"
echo "list and library copied: $(ls "$LIBRARY/accounts" | wc -l | tr -d ' ') accounts, $(ls "$LIBRARY/pictures" | wc -l | tr -d ' ') pictures"
