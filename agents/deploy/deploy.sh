#!/usr/bin/env bash
# Deploys the hosted service to Fly, built on Fly's remote builder from the agents folder. The volume, and so every judge's trees,
# stays. Usage: deploy/deploy.sh [judging|testing]   (FLY_APP names another app; FLY names the flyctl binary)
#   judging, the default: fly.toml's per-headset daily limits.
#   testing: no per-headset daily limits, deploy/testing.env's values over fly.toml's for this release only. The next judging
#   deploy goes back to fly.toml's, with no file edited.
set -euo pipefail
cd "$(dirname "$0")/.."
FLY=${FLY:-fly}
APP=${FLY_APP:-mind-palace-judging}
MODE=${1:-judging}
ENVS=(--env "MIND_PALACE_LIMITS_MODE=$MODE")
case "$MODE" in
  judging) ;;
  testing)
    while IFS= read -r line || [ -n "$line" ]; do
      case "$line" in '' | '#'*) ;; *) ENVS+=(--env "$line") ;; esac
    done < deploy/testing.env
    ;;
  *) echo "Usage: deploy/deploy.sh [judging|testing]" >&2; exit 2 ;;
esac
test -f starter/mindstorm.sqlite || { echo "No starter trees. Run: npm run starter -- --from <data folder>" >&2; exit 1; }
npx tsc --noEmit
node --no-warnings --import tsx --test test/hosted.test.ts
"$FLY" deploy --app "$APP" --remote-only --ha=false "${ENVS[@]}"
curl -fsS "https://$APP.fly.dev/api/health" && echo
