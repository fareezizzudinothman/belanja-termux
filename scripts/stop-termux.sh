#!/usr/bin/env sh
#
# stop-termux.sh - stop the native Termux PostgreSQL cluster.
#
# The Belanja app itself runs in the foreground under start-termux.sh, so it is
# stopped simply by pressing CTRL+C in that terminal. This script only stops
# the background PostgreSQL server (safe when it is already stopped).
#
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPT_DIR/lib-postgres.sh"

echo "Belanja - stop helper"
echo

if command -v pg_ctl >/dev/null 2>&1; then
  pg_stop
else
  echo "PostgreSQL is not installed (nothing to stop)."
fi

echo
echo "Tip: if the Belanja app is still running, press CTRL+C in its terminal "
echo " (or stop it from another shell with: killall node 2>/dev/null)."
echo