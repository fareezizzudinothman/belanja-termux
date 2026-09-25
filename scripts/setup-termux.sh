#!/usr/bin/env sh
#
# setup-termux.sh - one-shot Belanja setup for a fresh Termux installation.
#
# Installs packages, initializes + starts native PostgreSQL, creates the
# database/user, generates .env, installs npm dependencies and applies the
# Belanja migrations. Idempotent: safe to re-run at any time.
#
#   pkg update && pkg install git
#   git clone <repo>
#   cd belanja-termux
#   ./scripts/setup-termux.sh
#
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_DIR="$REPO_DIR/app"
ENV_FILE="$APP_DIR/.env"
ENV_EXAMPLE="$APP_DIR/.env.example"

. "$SCRIPT_DIR/lib-postgres.sh"

say() { echo; echo ">>> $*"; }

# --------------------------------------------------------------------------
# 0. Termux sanity check
# --------------------------------------------------------------------------
if ! command -v pkg >/dev/null 2>&1; then
  echo "ERROR: 'pkg' not found. This script must run inside Termux" >&2
  echo "       (https://termux.com). Please install Termux and try again." >&2
  exit 1
fi

say "Belanja - Termux setup"
echo "  Prefix : $PREFIX"
echo "  App    : $APP_DIR"

# --------------------------------------------------------------------------
# 1. Update Termux packages (safe to repeat)
# --------------------------------------------------------------------------
say "Updating Termux packages (pkg update)..."
pkg update -y

# --------------------------------------------------------------------------
# 2. Install required packages (only the ones actually missing)
# --------------------------------------------------------------------------
say "Installing required packages (git, nodejs, postgresql)..."
REQUIRED_PKGS=""
has_bin() { command -v "$1" >/dev/null 2>&1; }
# nodejs ships npm; check the binaries each package provides.
has_bin git       || REQUIRED_PKGS="$REQUIRED_PKGS git"
has_bin node      || REQUIRED_PKGS="$REQUIRED_PKGS nodejs"
has_bin pg_ctl    || REQUIRED_PKGS="$REQUIRED_PKGS postgresql"
if [ -n "$REQUIRED_PKGS" ]; then
  # shellcheck disable=SC2086
  pkg install -y $REQUIRED_PKGS
else
  echo "   Already installed: git, nodejs, postgresql (nothing to do)."
fi

# --------------------------------------------------------------------------
# 3. Environment file (.env) - create once from the template, never overwrite.
#    Random JWT secret + DB password are generated so nothing shipped uses a
#    known secret.
# --------------------------------------------------------------------------
say "Environment configuration"
if [ -f "$ENV_FILE" ]; then
  echo "  .env already exists, keeping it: $ENV_FILE"
else
  echo "  Creating $ENV_FILE from .env.example..."
  JWT_SECRET="$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")"
  PG_PASS="$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")"
  PG_USER="$(sed -n 's/^POSTGRES_USER=//p' "$ENV_EXAMPLE" | head -n1)"
  PG_DB="$(sed -n 's/^POSTGRES_DB=//p' "$ENV_EXAMPLE" | head -n1)"
  [ -n "$PG_USER" ] || PG_USER=belanja
  [ -n "$PG_DB" ] || PG_DB=belanja
  sed \
    -e "s/^JWT_SECRET=.*/JWT_SECRET=$JWT_SECRET/" \
    -e "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$PG_PASS/" \
    -e "s|^DATABASE_URL=.*|DATABASE_URL=postgres://$PG_USER:$PG_PASS@127.0.0.1:5432/$PG_DB|" \
    "$ENV_EXAMPLE" > "$ENV_FILE"
  echo "  Generated random JWT_SECRET and POSTGRES_PASSWORD."
fi

# Load the values the app will actually use (from the real .env).
PG_USER="$(sed -n 's/^POSTGRES_USER=//p' "$ENV_FILE" | head -n1)"
PG_PASS="$(sed -n 's/^POSTGRES_PASSWORD=//p' "$ENV_FILE" | head -n1)"
PG_DB="$(sed -n 's/^POSTGRES_DB=//p' "$ENV_FILE" | head -n1)"
ENV_PORT="$(sed -n 's/^PORT=//p' "$ENV_FILE" | head -n1)"
[ -n "$PG_USER" ] || PG_USER=belanja
[ -n "$PG_PASS" ] || { echo "ERROR: POSTGRES_PASSWORD missing in $ENV_FILE" >&2; exit 1; }
[ -n "$PG_DB" ] || PG_DB=belanja
[ -n "$ENV_PORT" ] || ENV_PORT=3000

# --------------------------------------------------------------------------
# 4. PostgreSQL: initialize natively (once) and start it
# --------------------------------------------------------------------------
say "PostgreSQL setup"
mkdir -p "$(dirname "$PG_DATA")" "$(dirname "$PG_LOG")" "$PG_SOCKET"

if pg_is_initialized; then
  echo "  Already initialized: $PG_DATA"
else
  echo "  Initializing cluster at $PG_DATA..."
  initdb -D "$PG_DATA" -E UTF8 --locale=C
fi

if ! pg_start; then
  echo "ERROR: could not start PostgreSQL." >&2
  exit 1
fi

# --------------------------------------------------------------------------
# 5. PostgreSQL: database + user (idempotent)
# --------------------------------------------------------------------------
say "PostgreSQL database and user"
pg_ensure_role "$PG_USER" "$PG_PASS"
pg_ensure_db "$PG_DB" "$PG_USER"

echo "  Database '$PG_DB' owned by '$PG_USER' is ready on 127.0.0.1:$PG_PORT."

# --------------------------------------------------------------------------
# 6. npm dependencies
# --------------------------------------------------------------------------
say "Installing npm dependencies (app + backend)..."
npm install --no-audit --no-fund --prefix "$APP_DIR"
npm install --no-audit --no-fund --prefix "$APP_DIR/backend"

# --------------------------------------------------------------------------
# 7. Migrations (deploy-style: apply pending, never reset)
# --------------------------------------------------------------------------
say "Applying database migrations..."
(cd "$APP_DIR" && npm run db:migrate)

# --------------------------------------------------------------------------
# 8. Done
# --------------------------------------------------------------------------
say "Setup complete!"
echo
echo "  Start Belanja with:"
echo "    ./scripts/start-termux.sh"
echo "  Then open http://127.0.0.1:$ENV_PORT in the browser."
echo