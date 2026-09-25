#!/usr/bin/env sh
#
# start-cloudflare.sh - start the Belanja Cloudflare tunnel (cloudflared).
#
# Reads the token from .config/cloudflared.env (written by setup-cloudflare.sh)
# or app/.env's CLOUDFLARE_TUNNEL_TOKEN. Runs cloudflared in the background,
# tracking the PID in runtime/cloudflared.pid so it is never killed by a broad
# `pkill`. Refuses to start a duplicate.
#
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_DIR="$REPO_DIR/app"
ENV_FILE="$APP_DIR/.env"
TOKEN_FILE="$REPO_DIR/.config/cloudflared.env"

. "$SCRIPT_DIR/lib-app.sh"

# --- 1. cloudflared present? -------------------------------------------------
if ! command -v cloudflared >/dev/null 2>&1; then
  echo "cloudflared: missing. Run ./scripts/setup-cloudflare.sh first." >&2
  exit 1
fi

# --- 2. Already running? (idempotent start) ----------------------------------
if pid="$(pid_from_file "$CLOUDFLARED_PID_FILE")"; then
  echo "Cloudflare tunnel is already running (pid $pid)."
  exit 0
fi

# --- 3. Token (never printed) ------------------------------------------------
TOKEN=""
if [ -f "$TOKEN_FILE" ]; then
  TOKEN="$(sed -n 's/^CLOUDFLARE_TUNNEL_TOKEN=//p' "$TOKEN_FILE" | head -n1)"
fi
if [ -z "$TOKEN" ] && [ -f "$ENV_FILE" ]; then
  TOKEN="$(sed -n 's/^CLOUDFLARE_TUNNEL_TOKEN=//p' "$ENV_FILE" | head -n1)"
fi

if [ -z "$TOKEN" ]; then
  echo "ERROR: no Cloudflare token found." >&2
  echo "       Create one with ./scripts/setup-cloudflare.sh (dashboard first," >&2
  echo "       hostname -> http://127.0.0.1:3000)." >&2
  exit 1
fi

# --- 4. Start -----------------------------------------------------------------
mkdir -p "$RUNTIME_DIR"
LOG_FILE="$RUNTIME_DIR/cloudflared.log"
nohup env TUNNEL_TOKEN="$TOKEN" \
  cloudflared tunnel --no-autoupdate run \
  >>"$LOG_FILE" 2>&1 &
CLOUDFLARED_PID=$!
write_pid "$CLOUDFLARED_PID_FILE" "$CLOUDFLARED_PID"
unset TOKEN

echo "Belanja - Cloudflare tunnel (pid $CLOUDFLARED_PID)"
echo
echo "Starting via cloudflared..."
echo "Log: $LOG_FILE"
echo
echo 'Your public URL appears in the log once the tunnel registers (either a'
echo '  *.trycloudflare.com URL or your dashboard hostname).'
echo "Stop it with: ./scripts/stop-cloudflare.sh"