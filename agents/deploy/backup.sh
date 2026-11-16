#!/usr/bin/env bash
# Backs up the volume twice: a snapshot on Fly, and a copy of /data in ~/.mind-palace/backups on this Mac.
# Usage: deploy/backup.sh
set -euo pipefail
cd "$(dirname "$0")/.."
FLY=${FLY:-fly}
APP=${FLY_APP:-mind-palace-judging}
VOLUME=$("$FLY" volumes list --app "$APP" --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=JSON.parse(s).find(v=>v.name==="mind_palace_data");if(!v)process.exit(1);console.log(v.id)})')
"$FLY" volumes snapshots create "$VOLUME"
OUT="$HOME/.mind-palace/backups/$APP-$(date +%Y%m%d-%H%M%S).tgz"
mkdir -p "$(dirname "$OUT")"
"$FLY" ssh console --app "$APP" -C "tar -czf /tmp/data-backup.tgz -C /data ."
"$FLY" ssh sftp get /tmp/data-backup.tgz "$OUT" --app "$APP"
"$FLY" ssh console --app "$APP" -C "rm -f /tmp/data-backup.tgz"
echo "snapshot of $VOLUME made; copy at $OUT"
