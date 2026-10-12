#!/bin/sh
set -eu

application_uuid=${1:-}
case "$application_uuid" in
  ''|*[!a-z0-9]*)
    printf '%s\n' 'Usage: sh run-solidarity-event-sync.sh <Coolify application UUID> [--dry-run]' >&2
    exit 64
    ;;
esac
if [ "$#" -gt 2 ] || { [ "$#" -eq 2 ] && [ "$2" != '--dry-run' ]; }; then
  printf '%s\n' 'Expected only an optional --dry-run argument' >&2
  exit 64
fi

exec 9>"/var/lock/wcu-event-sync-${application_uuid}.lock"
flock -n 9 || exit 0
container=$(docker ps --filter "name=^/web-${application_uuid}-[0-9]+$" --format '{{.ID}}')
case "$container" in
  ''|*[!a-f0-9]*)
    printf '%s\n' 'Expected exactly one running web container for this application' >&2
    exit 1
    ;;
esac
if [ "${2:-}" = '--dry-run' ]; then
  exec docker exec "$container" node /app/.output/server/solidarity-event-auto.mjs --dry-run
fi
exec docker exec "$container" node /app/.output/server/solidarity-event-auto.mjs
