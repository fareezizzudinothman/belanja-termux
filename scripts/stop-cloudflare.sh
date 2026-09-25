#!/usr/bin/env sh
#
# stop-cloudflare.sh - stop the Belanja Cloudflare tunnel (cloudflared).
#
# Uses the PID file written by start-cloudflare.sh so it stops exactly the
# Belanja tunnel process - never a `pkill cloudflared`, never another
# cloudflared instance.
#
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

. "$SCRIPT_DIR/lib-app.sh"

stop_process "$CLOUDFLARED_PID_FILE" "Cloudflare tunnel"