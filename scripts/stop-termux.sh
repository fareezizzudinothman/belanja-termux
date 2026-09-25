#!/usr/bin/env sh
#
# stop-termux.sh - stop the native Termux Belanja app.
#
# Uses the PID file written by start-termux.sh to stop exactly the Belanja
# backend process (no `pkill node`, no broad process sweeping). PostgreSQL is
# NOT touched and keeps running - pass --postgres (or -p) to also stop it,
# which is what start-termux.sh will re-start on the next run.
#
# Usage:
#   ./scripts/stop-termux.sh              # stop Belanja only
#   ./scripts/stop-termux.sh --postgres   # stop Belanja and PostgreSQL
#
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

. "$SCRIPT_DIR/lib-app.sh"

STOP_PG=0
for arg in "$@"; do
  case "$arg" in
    --postgres|-p) STOP_PG=1 ;;
    *) echo "Unknown option: $arg (expected --postgres or nothing)." >&2; exit 1 ;;
  esac
done

echo "Belanja - stop helper"
echo

stop_process "$BELANJA_PID_FILE" "Belanja app"

if [ "$STOP_PG" -eq 1 ]; then
  echo
  . "$SCRIPT_DIR/lib-postgres.sh"
  if command -v pg_ctl >/dev/null 2>&1; then
    pg_stop
    echo "PostgreSQL: stopped."
  else
    echo "PostgreSQL: not installed (nothing to stop)."
  fi
else
  echo
  echo "PostgreSQL is still running (start-termux.sh reuses it)."
  echo "Add --postgres to stop it too, e.g.: ./scripts/stop-termux.sh --postgres"
fi