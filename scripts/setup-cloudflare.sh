#!/usr/bin/env sh
#
# setup-cloudflare.sh - configure a Cloudflare Quick Tunnel (cloudflared) for
# the native Termux Belanja app.
#
# Steps:
#   1. Creates a tunnel CONNECTOR on the Cloudflare Zero Trust dashboard
#      (dashboard.cloudflare.com -> Zero Trust -> Networks -> Tunnels -> Create
#      a tunnel), then "Install and run" -> copy the `--token` value.
#      On the dashboard, point a public hostname at  http://127.0.0.1:3000
#      (the Belanja native app's default HTTP URL).
#   2. Paste that token here when prompted. It is stored ONLY in
#      .config/cloudflared.env (chmod 600, git-ignored) - never printed, never
#      committed, never logged.
#
# Run this once; afterwards use start-cloudflare.sh / stop-cloudflare.sh, or
# start-termux.sh --cloudflare to bring the tunnel up automatically.
#
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CONFIG_DIR="$REPO_DIR/.config"
TOKEN_FILE="$CONFIG_DIR/cloudflared.env"

echo "=========== Belanja - Cloudflare Tunnel setup ==========="
echo

# --- 1. cloudflared present? -------------------------------------------------
if ! command -v cloudflared >/dev/null 2>&1; then
  echo "cloudflared: missing. Installing via pkg (Termux)..."
  pkg install -y cloudflared
fi
command -v cloudflared >/dev/null 2>&1 || {
  echo "ERROR: cloudflared could not be installed. Install it manually:" >&2
  echo "       pkg install -y cloudflared" >&2
  exit 1
}
echo "cloudflared: $(cloudflared --version | head -n1)"
echo

# --- 2. Existing token? ------------------------------------------------------
if [ -f "$TOKEN_FILE" ]; then
  echo "A tunnel token is already configured at $TOKEN_FILE."
  printf "Replace it? [y/N] "
  read -r REPLACE
  case "$REPLACE" in
    [yY]*) : ;;
    *) echo "Keeping the existing token. Nothing to do."; exit 0 ;;
  esac
  echo
fi

# --- 3. Collect the token ---------------------------------------------------
echo "Paste your Cloudflare tunnel token (from Zero Trust dashboard -> the"
echo "tunnel connector's install command, the value after '--token')."
echo "It will not be echoed back."
echo
stty -echo
printf "Token: "
read -r TOKEN
stty echo
echo
[ -n "$TOKEN" ] || {
  echo "ERROR: empty token. Re-run setup-cloudflare.sh when you have the token." >&2
  exit 1
}

mkdir -p "$CONFIG_DIR"
umask 077
cat > "$TOKEN_FILE" <<EOF
# Cloudflare tunnel token for Belanja (Termux). Private - do not share.
# Written by setup-cloudflare.sh; sourced by start-cloudflare.sh.
CLOUDFLARE_TUNNEL_TOKEN=$TOKEN
EOF
chmod 600 "$TOKEN_FILE"
unset TOKEN

echo
echo "Saved token to $TOKEN_FILE (chmod 600, git-ignored)."
echo "Start the tunnel with:  ./scripts/start-cloudflare.sh"
echo "(or ./scripts/start-termux.sh --cloudflare)"
echo
echo "Dashboard reminder: your tunnel's public hostname must point at"
echo "  http://127.0.0.1:3000"
echo