#!/usr/bin/env bash
# The first deploy, once the user is logged in to Fly: the app, its volume in San Jose, the secrets, then the service.
# Usage: deploy/setup.sh   (FLY_APP names another app when mind-palace-judging is taken)
set -euo pipefail
cd "$(dirname "$0")/.."
FLY=${FLY:-fly}
APP=${FLY_APP:-mind-palace-judging}
"$FLY" apps create "$APP"
"$FLY" volumes create mind_palace_data --app "$APP" --region sjc --size 3 --yes
deploy/secrets.sh
deploy/deploy.sh
