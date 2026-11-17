#!/usr/bin/env bash
# Deploys the walkthrough demo to Fly as a service of its own (agents/demo/README.md, "On Fly, without the Mac"). It is built on
# Fly's remote builder from the agents folder, beside the judging service and apart from it: another app, no shared volume.
#   deploy/demo.sh setup    the first time, once logged in to Fly: makes the app and its addresses, then deploys
#   deploy/demo.sh          deploys again (new code, a changed script, new trees)
# FLY_DEMO_APP names another app when mind-palace-walkthrough is taken; FLY names the flyctl binary.
# The keys go up from this machine's env file through deploy/demo-secrets.ts, none printed. The demo's own key and address are
# kept in ~/.mind-palace/demo.properties: give that file to whoever joins a headset or opens the page from another Mac.
set -euo pipefail
cd "$(dirname "$0")/.."
FLY=${FLY:-fly}
APP=${FLY_DEMO_APP:-mind-palace-walkthrough}
# The pictures are in Git LFS: a checkout without them holds short text files in their place, and the trees would be blank.
if head -c 60 demo/media/t080.jpg | grep -q 'git-lfs'; then echo "The demo's pictures are not here yet. Run: git lfs pull" >&2; exit 1; fi
# Momo's recorded lines come the same way. Without them she would record every line afresh on Fly, and sound a little different there.
if ls demo/voice/*.pcm >/dev/null 2>&1 && head -c 60 "$(ls demo/voice/*.pcm | head -1)" | grep -q 'git-lfs'; then echo "Momo's recorded lines are not here yet. Run: git lfs pull" >&2; exit 1; fi
if [ "${1:-}" = setup ]; then
  "$FLY" apps create "$APP"
  # fly 0.4.53's first deploy failed to give the app its addresses, so they are allocated here (as deploy/setup.sh does).
  "$FLY" ips allocate-v6 --app "$APP"
  "$FLY" ips allocate-v4 --shared --app "$APP"
fi
npx tsc --noEmit
node --no-warnings --import tsx --test test/demo.test.ts
node --no-warnings --import tsx deploy/demo-secrets.ts "$APP" | "$FLY" secrets import --app "$APP" --stage
"$FLY" deploy --app "$APP" --config fly.demo.toml --dockerfile Dockerfile.demo --ignorefile Dockerfile.demo.dockerignore --remote-only --ha=false
curl -fsS --retry 5 --retry-delay 3 "https://$APP.fly.dev/api/health" && echo
echo "The demo is at https://$APP.fly.dev. Its key is in ~/.mind-palace/demo.properties."
echo "  open its page:    agents/demo/headset.sh fly-page"
echo "  join a headset:   agents/demo/headset.sh fly      (on the cable, once: the app remembers it)"
