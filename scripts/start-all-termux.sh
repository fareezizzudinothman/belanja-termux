#!/usr/bin/env sh
#
# start-all-termux.sh - one-command startup for Belanja on Termux.
#
# Starts PostgreSQL (if installed), verifies the database is reachable, applies
# pending migrations, then starts the Belanja app in the foreground. The
# Cloudflare tunnel is started automatically only if a token has been
# configured with setup-cloudflare.sh.
#
# Stop everything with CTRL+C, or from another shell:
#   ./scripts/stop-termux.sh             # stop Belanja only
#   ./scripts/stop-termux.sh -p          # also stop PostgreSQL
#   ./scripts/stop-cloudflare.sh         # if the tunnel was started
#
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# --- 1. PostgreSQL -----------------------------------------------------------
. "$SCRIPT_DIR/lib-postgres.sh"
if command -v pg_ctl >/dev/null 2>&1; then
  pg_start || exit 1
else
  echo "PostgreSQL: not installed - run ./scripts/setup-termux.sh first." >&2
  exit 1
fi

# --- 2. Cloudflare token configured? -----------------------------------------
WITH_CLOUDFLARE=""
if [ -f "$(dirname "$SCRIPT_DIR")/.config/cloudflared.env" ] ||
   grep -q '^CLOUDFLARE_TUNNEL_TOKEN=' "$(dirname "$SCRIPT_DIR")/app/.env" 2>/dev/null; then
  WITH_CLOUDFLARE="--cloudflare"
fi

# --- 3. Belanja (+ tunnel if configured) -------------------------------------
exec "$SCRIPT_DIR/start-termux.sh" $WITH_CLOUDFLARE