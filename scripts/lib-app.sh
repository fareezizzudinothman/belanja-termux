#!/usr/bin/env sh
#
# lib-app.sh - shared process helpers for the Belanja Termux scripts.
# POSIX sh only (Termux default shell). Source this file, do NOT execute it.
#
# Every long-running Belanja-owned process (the Node backend, cloudflared) is
# tracked by PID file under $BELANJA_RUNTIME_DIR (default: <repo>/runtime).
# This lets stop helpers kill EXACTLY the Belanja process and never a stray
# `node` or `cloudflared` from another project, and makes start helpers
# idempotent (they refuse to spawn a duplicate).

# Runtime dir for PID files (never committed to git).
RUNTIME_DIR="${BELANJA_RUNTIME_DIR:-$REPO_DIR/runtime}"
BELANJA_PID_FILE="$RUNTIME_DIR/belanja.pid"
CLOUDFLARED_PID_FILE="$RUNTIME_DIR/cloudflared.pid"

pid_alive() {
  [ -n "$1" ] && kill -0 "$1" 2>/dev/null
}

# pid_from_file <file> -> echoes the numeric pid, or empty if missing/stale.
pid_from_file() {
  [ -f "$1" ] || return 0
  pid="$(cat "$1" 2>/dev/null | tr -dc '0-9')"
  [ -n "$pid" ] && pid_alive "$pid" && echo "$pid"
}

# write_pid <file> <pid>
write_pid() {
  mkdir -p "$(dirname "$1")"
  echo "$2" > "$1"
}

remove_pid() {
  rm -f "$1"
}

# report <pid_file> <label> -> "true" if that process type is running.
process_running() {
  [ -n "$(pid_from_file "$1")" ] && echo "true" || echo "false"
}

# stop_process <pid_file> <label>: SIGTERM, wait a few seconds, then ensure it
# is gone before returning. Refuses to sweep the whole process class.
stop_process() {
  local pid_file="$1" label="$2" pid
  pid="$(pid_from_file "$pid_file")"
  if [ -z "$pid" ]; then
    echo "$label: not running."
    return 0
  fi
  echo "$label: stopping (pid $pid)..."
  kill "$pid" 2>/dev/null || true
  i=0
  while pid_alive "$pid" && [ "$i" -lt 20 ]; do
    sleep 0.25
    i=$((i + 1))
  done
  if pid_alive "$pid"; then
    echo "$label: still alive after SIGTERM, sending SIGKILL..." >&2
    kill -9 "$pid" 2>/dev/null || true
    sleep 0.25
  fi
  remove_pid "$pid_file"
  echo "$label: stopped."
}