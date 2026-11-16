#!/usr/bin/env bash
# The hosted service's status, and its off switch. The admin token is read from ~/.mind-palace/admin-token and never printed.
# Usage: deploy/admin.sh [status|off|on] [service url]
#        deploy/admin.sh delete <device id> [service url]   deletes that device's space and its folder
set -euo pipefail
APP=${FLY_APP:-mind-palace-judging}
if [ "${1:-}" = delete ]; then URL=${3:-https://$APP.fly.dev}; else URL=${2:-https://$APP.fly.dev}; fi
auth() { printf 'Authorization: Bearer %s\n' "$(tr -d '\n' < "$HOME/.mind-palace/admin-token")"; }
case "${1:-status}" in
  status) curl -fsS -H @<(auth) "$URL/admin" ;;
  off) curl -fsS -X POST -H @<(auth) "$URL/admin?off=1" ;;
  on) curl -fsS -X POST -H @<(auth) "$URL/admin?off=0" ;;
  delete) curl -fsS -X DELETE -H @<(auth) "$URL/admin/spaces/${2:?a device id}" ;;
  *) echo "usage: deploy/admin.sh [status|off|on] [service url], or delete <device id> [service url]" >&2; exit 2 ;;
esac
echo
