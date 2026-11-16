#!/usr/bin/env bash
# Goes back to an earlier build. The volume, and so every judge's trees, stays as it is.
# Usage: deploy/rollback.sh            lists the releases with their images
#        deploy/rollback.sh <image>    runs that image again, e.g. registry.fly.io/mind-palace-judging:deployment-01J...
set -euo pipefail
cd "$(dirname "$0")/.."
FLY=${FLY:-fly}
APP=${FLY_APP:-mind-palace-judging}
if [ $# -eq 0 ]; then
  "$FLY" releases --app "$APP" --image
  echo "Run again with the image of the release to go back to." >&2
  exit 0
fi
"$FLY" deploy --app "$APP" --image "$1" --ha=false
curl -fsS "https://$APP.fly.dev/api/health" && echo
