#!/usr/bin/env sh
#
# start-termux.sh - start Belanja natively in Termux.
#
# Verifies PostgreSQL is running and reachable, checks dependencies, applies
# pending migrations, then starts the app in the FOREGROUND (stop with CTRL+C
# or ./scripts/stop-termux.sh).
#
# The backend process is tracked by PID file (runtime/belanja.pid): starting
# while Belanja is already running is refused instead of spawning a second
# node process, and CTRL+C removes the PID file on shutdown.
#
set -e

START_CLOUDFLARE=0
for arg in "$@"; do
  case "$arg" in
    --cloudflare) START_CLOUDFLARE=1 ;;
    *) echo "Unknown option: $arg (expected --cloudflare or nothing)." >&2; exit 1 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_DIR="$REPO_DIR/app"
ENV_FILE="$APP_DIR/.env"

. "$SCRIPT_DIR/lib-postgres.sh"
. "$SCRIPT_DIR/lib-app.sh"

# Load configuration the app will use (HOST, PORT, DATABASE_URL, ...).
load_env() {
  HOST="$(sed -n 's/^HOST=//p' "$ENV_FILE" | head -n1)"
  PORT="$(sed -n 's/^PORT=//p' "$ENV_FILE" | head -n1)"
  DB_URL="$(sed -n 's/^DATABASE_URL=//p' "$ENV_FILE" | head -n1)"
  [ -n "$HOST" ] || HOST=127.0.0.1
  [ -n "$PORT" ] || PORT=3000
}

banner() {
  echo "================================="
  echo " Belanja - Termux"
  echo "================================="
  echo
}

banner

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not found. Run ./scripts/setup-termux.sh first." >&2
  exit 1
fi
load_env

# --- 1. PostgreSQL running? ----------------------------------------------
if ! command -v pg_isready >/dev/null 2>&1; then
  echo "PostgreSQL: MISSING (install postgresql via ./scripts/setup-termux.sh)"
  exit 1
fi
if ! pg_start; then
  exit 1
fi
echo "PostgreSQL: OK"

# --- 2. Database reachable ------------------------------------------------
if ! psql "$DB_URL" -tAc 'SELECT 1' >/dev/null 2>&1; then
  echo "ERROR: cannot reach database $DB_URL (edit $ENV_FILE / re-run setup)." >&2
  exit 1
fi
echo "Database:   OK"

# --- 3. Node + dependencies ------------------------------------------------
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js:    MISSING (run ./scripts/setup-termux.sh)"
  exit 1
fi
echo "Node.js:    $(node --version)"

if [ ! -d "$APP_DIR/backend/node_modules" ]; then
  echo "Dependencies: MISSING (backend/node_modules) - run ./scripts/setup-termux.sh."
  exit 1
fi
echo "Dependencies: OK"

# --- 4. pg client present (no ORM/Prisma in Belanja) ----------------------
# Belanja talks to PostgreSQL via the `pg` driver. Re-running `npm install`
# (setup script) is the only "generate" step needed; verify the driver loads.
if ! (cd "$APP_DIR/backend" && node -e "require('pg')" >/dev/null 2>&1); then
  echo "Error: 'pg' client missing. Run ./scripts/setup-termux.sh (npm install)." >&2
  exit 1
fi
echo "pg client:  OK"

# --- 5. Migrations (idempotent; never resets data) --------------------------
echo "Migrations: applying any pending..."
(cd "$APP_DIR" && npm run db:migrate)

# --- 6. Already running? ----------------------------------------------------
BELAJA_RUNNING_NODE="$(pgrep -f "node .*/backend/server\.js" 2>/dev/null | wc -l)"
if [ -n "$(pid_from_file "$BELANJA_PID_FILE")" ]; then
  echo
  echo "ERROR: Belanja is already running (pid $(pid_from_file "$BELANJA_PID_FILE"))." >&2
  echo "       Stop it first with ./scripts/stop-termux.sh." >&2
  exit 1
fi
if [ "${BELAJA_RUNNING_NODE:-0}" -gt 0 ] && [ ! -f "$BELANJA_PID_FILE" ]; then
  echo
  echo "ERROR: a Belanja backend process appears to be running but is not tracked" >&2
  echo "       by $BELANJA_PID_FILE." >&2
  echo "       Stop it first with ./scripts/stop-termux.sh." >&2
  exit 1
fi

# --- 7. Foreground start ----------------------------------------------------
echo
echo "Backend:    Starting..."
echo
echo "Belanja running at:"
echo
echo "  http://$HOST:$PORT"
echo
echo "Press CTRL+C to stop."
echo

# Run node directly (not through npm) so the PID file points at the real server
# process, and clean the PID file up when it exits via CTRL+C / SIGTERM.
(
  cd "$APP_DIR/backend" || exit 1
  exec env HOST="$HOST" PORT="$PORT" node server.js
) &
APP_PID=$!
write_pid "$BELANJA_PID_FILE" "$APP_PID"

CLEANUP_CLOUDFLARE=0
if [ "$START_CLOUDFLARE" -eq 1 ]; then
  echo
  echo "Cloudflare: starting tunnel..."
  "$SCRIPT_DIR/start-cloudflare.sh"
  CLEANUP_CLOUDFLARE=1
fi

cleanup() {
  rm -f "$BELANJA_PID_FILE"
  if [ "$CLEANUP_CLOUDFLARE" -eq 1 ]; then
    "$SCRIPT_DIR/stop-cloudflare.sh" >/dev/null 2>&1 || true
  fi
}
forward() { kill "$APP_PID" 2>/dev/null || true; exit 0; }
trap 'forward' INT TERM
trap 'cleanup' EXIT
wait "$APP_PID"