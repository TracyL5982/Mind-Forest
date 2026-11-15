#!/usr/bin/env bash
# Deploys the hosted service to Fly, built on Fly's remote builder from the agents folder. The volume, and so every judge's trees,
# stays. Usage: deploy/deploy.sh   (FLY_APP names another app; FLY names the flyctl binary)
set -euo pipefail
cd "$(dirname "$0")/.."
FLY=${FLY:-fly}
APP=${FLY_APP:-mind-palace-judging}
test -f starter/mindstorm.sqlite || { echo "No starter trees. Run: npm run starter -- --from <data folder>" >&2; exit 1; }
npx tsc --noEmit
node --no-warnings --import tsx --test test/hosted.test.ts
"$FLY" deploy --app "$APP" --remote-only --ha=false
curl -fsS "https://$APP.fly.dev/api/health" && echo
