#!/usr/bin/env bash
# Pushes the service's secrets to Fly from a pipe: keys through the service's own loader, never printed and never written to a file.
# Usage: deploy/secrets.sh   (restarts the machine when one is running)
set -euo pipefail
cd "$(dirname "$0")/.."
FLY=${FLY:-fly}
APP=${FLY_APP:-mind-palace-judging}
# Releases up to 4 sent the user's Instagram account, which the server never needs: take it off if it is still there.
OFF=$("$FLY" secrets list --app "$APP" --json | node -e '
  const names = (JSON.parse(require("node:fs").readFileSync(0, "utf8")) ?? []).map((s) => s.Name ?? s.name);
  if (names.some((n) => typeof n !== "string")) throw new Error("fly secrets list gave an entry with no name");
  process.stdout.write(names.filter((n) => n === "META_IG_TOKEN" || n === "META_IG_USER_ID").join(" "));
')
if [ -n "$OFF" ]; then "$FLY" secrets unset --app "$APP" $OFF; fi
node --no-warnings --import tsx deploy/secrets.ts | "$FLY" secrets import --app "$APP"
