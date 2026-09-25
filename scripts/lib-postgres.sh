#!/usr/bin/env sh
#
# lib-postgres.sh - shared PostgreSQL helpers for the Belanja Termux scripts.
# POSIX sh only (Termux default shell). Source this file, do NOT execute it.
#
# All paths live inside $PREFIX so every command runs from the Termux user
# account with no root/systemd involved.

# Termux prefix. Guarded so the library can also be exercised on other systems.
PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"

# PostgreSQL data directory (matches the Termux postgresql package layout).
PG_DATA="${BELANJA_PG_DATA:-$PREFIX/var/lib/postgresql}"
# Log file for the background postgres server.
PG_LOG="${BELANJA_PG_LOG:-$PREFIX/var/log/belanja-postgresql.log}"
# Unix socket directory configured for the Termux cluster.
PG_SOCKET="${BELANJA_PG_SOCKET:-$PREFIX/tmp}"
PG_PORT="${BELANJA_PG_PORT:-5432}"

pg_is_initialized() {
  [ -f "$PG_DATA/PG_VERSION" ]
}

pg_is_running() {
  command -v pg_isready >/dev/null 2>&1 && pg_isready -h 127.0.0.1 -p "$PG_PORT" >/dev/null 2>&1
}

# Start postgres in the background (if it is not already running).
pg_start() {
  if pg_is_running; then
    echo "PostgreSQL: already running (port $PG_PORT)"
    return 0
  fi
  if ! pg_is_initialized; then
    echo "ERROR: PostgreSQL is not initialized (no $PG_DATA/PG_VERSION)."
    echo "       Run ./scripts/setup-termux.sh first." >&2
    return 1
  fi
  mkdir -p "$(dirname "$PG_LOG")"
  echo "PostgreSQL: starting (data: $PG_DATA)..."
  # -w: wait for the server to start before returning; -l: server log file.
  if pg_ctl -D "$PG_DATA" -l "$PG_LOG" -w start; then
    echo "PostgreSQL: started OK"
    return 0
  fi
  echo "ERROR: failed to start PostgreSQL. Check $PG_LOG" >&2
  return 1
}

# Stop postgres if it is running. Safe when already stopped.
pg_stop() {
  if ! pg_is_running; then
    echo "PostgreSQL: not running"
    return 0
  fi
  echo "PostgreSQL: stopping..."
  pg_ctl -D "$PG_DATA" -m fast -w stop
}

# Run a SQL command as the cluster superuser (the Termux OS user that owns the
# cluster). Falls back across socket/TCP; used only for admin tasks.
pg_admin() {
  PG_ADMIN_USER="$(id -un)"
  if psql -h "$PG_SOCKET" -U "$PG_ADMIN_USER" -d postgres -p "$PG_PORT" "$@" 2>/dev/null; then
    return 0
  fi
  psql -h 127.0.0.1 -U "$PG_ADMIN_USER" -d postgres -p "$PG_PORT" "$@"
}

# Create the application role if missing. Idempotent.
pg_ensure_role() {
  local role pass
  role="$1"
  pass="$2"
  echo "PostgreSQL: ensuring role '$role' exists..."
  pg_admin -tAc "SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='$role'" | grep -q 1 || {
    pg_admin -c "CREATE ROLE $role LOGIN PASSWORD '$pass'"
  }
}

# Create the application database owned by the role if missing. Idempotent.
pg_ensure_db() {
  local db owner
  db="$1"
  owner="$2"
  echo "PostgreSQL: ensuring database '$db' exists..."
  pg_admin -tAc "SELECT 1 FROM pg_database WHERE datname='$db'" | grep -q 1 || {
    pg_admin -c "CREATE DATABASE $db OWNER $owner"
  }
}