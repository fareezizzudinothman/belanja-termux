#!/usr/bin/env sh
#
# start-termux.sh - start Belanja natively in Termux.
#
# Verifies PostgreSQL is running and reachable, checks dependencies, applies
# pending migrations, then starts the app in the FOREGROUND (stop with CTRL+C).
#
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_DIR="$REPO_DIR/app"
ENV_FILE="$APP_DIR/.env"

. "$SCRIPT_DIR/lib-postgres.sh"

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

# --- 6. Foreground start ----------------------------------------------------
echo
echo "Backend:    Starting..."
echo
echo "Belanja running at:"
echo
echo "  http://$HOST:$PORT"
echo
echo "Press CTRL+C to stop."
echo

# Start in the foreground so CTRL+C stops it cleanly (the server also shuts
# down gracefully on SIGINT).
exec env HOST="$HOST" PORT="$PORT" npm --prefix "$APP_DIR" start