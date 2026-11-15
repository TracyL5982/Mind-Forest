#!/usr/bin/env bash
# The hosted service's status, and its off switch. The admin token is read from ~/.mind-palace/admin-token and never printed.
# Usage: deploy/admin.sh [status|off|on] [service url]
set -euo pipefail
APP=${FLY_APP:-mind-palace-judging}
URL=${2:-https://$APP.fly.dev}
auth() { printf 'Authorization: Bearer %s\n' "$(tr -d '\n' < "$HOME/.mind-palace/admin-token")"; }
case "${1:-status}" in
  status) curl -fsS -H @<(auth) "$URL/admin" ;;
  off) curl -fsS -X POST -H @<(auth) "$URL/admin?off=1" ;;
  on) curl -fsS -X POST -H @<(auth) "$URL/admin?off=0" ;;
  *) echo "usage: deploy/admin.sh [status|off|on] [service url]" >&2; exit 2 ;;
esac
echo
