#!/usr/bin/env bash
# Pushes the service's secrets to Fly from a pipe: keys through the service's own loader, never printed and never written to a file.
# Usage: deploy/secrets.sh   (restarts the machine when one is running)
set -euo pipefail
cd "$(dirname "$0")/.."
FLY=${FLY:-fly}
APP=${FLY_APP:-mind-palace-judging}
node --no-warnings --import tsx deploy/secrets.ts | "$FLY" secrets import --app "$APP"
