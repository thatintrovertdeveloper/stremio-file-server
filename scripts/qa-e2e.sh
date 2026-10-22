#!/usr/bin/env bash
# E2E check entrypoint: start both services against the fixture library, run the
# Stremio-protocol suite, tear everything down, and preserve logs.
#
# Exit codes (QA runner contract):
#   0  all checks passed
#   1  at least one check failed
#   2  the environment could not be brought up (blocked)
# Job control gives every background service its own process group. This matters
# here: the Node binary is a Volta shim (and SDK/child tooling may fork), so
# killing the recorded PID alone leaves the real listener running.
set -m
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
QA_DIR="$ROOT/.qa"
LOG_DIR="$QA_DIR/logs"
FS_PORT="${FS_PORT:-3003}"
ADDON_PORT="${ADDON_PORT:-7001}"
API_KEY="${API_KEY:-test-key}"
MEDIA="$QA_DIR/fixtures/media"

cleanup() {
  # Kill the whole process group of services this script started. Never touch a
  # foreign listener: killing someone else's service is worse than a failed run.
  local pidfile pid
  for sig in TERM KILL; do
    for pidfile in "$QA_DIR"/pids/*; do
      [[ -f "$pidfile" ]] || continue
      pid="$(cat "$pidfile")"
      # Negative PID targets the process group (see `set -m` above).
      kill -"$sig" -- "-$pid" 2>/dev/null || kill -"$sig" "$pid" 2>/dev/null
    done
    [[ "$sig" == TERM ]] && sleep 0.5
  done
  rm -rf "$QA_DIR/pids"
}

port_busy() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null && exec 3>&- && return 0
  return 1
}

# Teardown that reports contamination: a listener surviving our own kill means the
# next run could test a stale binary, so the run is reported BLOCKED, not failed.
finish() {
  local status="$1"
  cleanup
  local busy=0
  for port in "$FS_PORT" "$ADDON_PORT"; do
    if port_busy "$port"; then
      echo "BLOCKED: port $port is still bound after teardown by a process this" >&2
      echo "         script did not start. Inspect it before trusting a rerun." >&2
      busy=1
    fi
  done
  if [[ "$busy" -eq 1 ]]; then exit 2; fi
  exit "$status"
}

trap cleanup EXIT INT TERM

mkdir -p "$LOG_DIR" "$QA_DIR/pids"
rm -f "$LOG_DIR"/*.log

# Preflight: a service already on these ports means the run would assert against
# something other than the code in this checkout. Refuse instead of guessing.
for port in "$FS_PORT" "$ADDON_PORT"; do
  if port_busy "$port"; then
    echo "BLOCKED: port $port is already in use. Stop the existing service first" >&2
    echo "         (a stale listener would make this run test the wrong process)." >&2
    exit 2
  fi
done

bash "$ROOT/scripts/qa-fixtures.sh" || { echo "BLOCKED: fixture generation failed" >&2; exit 2; }

if [[ ! -x "$ROOT/file-server/.venv/bin/python" ]]; then
  echo "BLOCKED: file-server/.venv missing — run scripts/qa-setup.sh first" >&2
  exit 2
fi
if [[ ! -d "$ROOT/addon/node_modules" ]]; then
  echo "BLOCKED: addon/node_modules missing — run scripts/qa-setup.sh first" >&2
  exit 2
fi

wait_for() {
  local url="$1" name="$2" i
  for i in $(seq 1 60); do
    if curl -sf "$url" >/dev/null 2>&1; then return 0; fi
    sleep 0.5
  done
  echo "BLOCKED: $name did not become ready ($url)" >&2
  return 2
}

# --- file server -------------------------------------------------------------
(
  cd "$ROOT/file-server" || exit 2
  SOURCE_DIRS="$MEDIA/tv,$MEDIA/movies" \
  API_KEY="$API_KEY" \
  SUBTITLE_PROVIDERS="" \
  exec .venv/bin/python server.py --port "$FS_PORT" --workers 1 --host 127.0.0.1
) > "$LOG_DIR/file-server.log" 2>&1 &
echo $! > "$QA_DIR/pids/file-server.pid"

wait_for "http://127.0.0.1:$FS_PORT/health" "file-server" || exit 2

# --- addon -------------------------------------------------------------------
(
  cd "$ROOT/addon" || exit 2
  FILE_SERVER_URL="http://127.0.0.1:$FS_PORT" \
  FILE_SERVER_PUBLIC_URL="http://127.0.0.1:$FS_PORT" \
  FILE_SERVER_API_KEY="$API_KEY" \
  PORT="$ADDON_PORT" \
  exec node index.js
) > "$LOG_DIR/addon.log" 2>&1 &
echo $! > "$QA_DIR/pids/addon.pid"

wait_for "http://127.0.0.1:$ADDON_PORT/manifest.json" "addon" || exit 2

# --- checks ------------------------------------------------------------------
cd "$ROOT" || exit 2
ADDON_URL="http://127.0.0.1:$ADDON_PORT" \
FILE_SERVER_URL="http://127.0.0.1:$FS_PORT" \
FILE_SERVER_PUBLIC_URL="http://127.0.0.1:$FS_PORT" \
API_KEY="$API_KEY" \
node --test --test-reporter=tap tests/e2e/*.test.mjs
status=$?

echo "--- service logs retained in $LOG_DIR ---"
tail -5 "$LOG_DIR/file-server.log" >&2 || true
tail -5 "$LOG_DIR/addon.log" >&2 || true

finish "$status"
