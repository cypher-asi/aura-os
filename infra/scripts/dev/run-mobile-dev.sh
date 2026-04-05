#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FRONTEND_PORT="${AURA_FRONTEND_PORT:-5173}"
BACKEND_PORT="${AURA_SERVER_PORT:-3100}"
FRONTEND_HOST="${AURA_FRONTEND_HOST:-127.0.0.1}"
BACKEND_HOST="${AURA_SERVER_HOST:-127.0.0.1}"
PUBLIC_HOST="${AURA_PUBLIC_HOST:-$FRONTEND_HOST}"

cd "$ROOT"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

MODE="local-only"
if [ -n "${AURA_NETWORK_URL:-}" ] || [ -n "${AURA_STORAGE_URL:-}" ] || [ -n "${ORBIT_BASE_URL:-}" ]; then
  MODE="remote-backed"
fi

echo "Starting Aura mobile web dev stack (${MODE})"
echo "  Frontend bind: http://${FRONTEND_HOST}:${FRONTEND_PORT}"
echo "  Host API bind: http://${BACKEND_HOST}:${BACKEND_PORT}"
echo
echo "Open on device or simulator:"
echo "  http://${PUBLIC_HOST}:${FRONTEND_PORT}/projects"
if [ "${PUBLIC_HOST}" = "0.0.0.0" ]; then
  echo
  echo "Warning: AURA_PUBLIC_HOST is set to 0.0.0.0."
  echo "Set AURA_PUBLIC_HOST to your real LAN IP for a physical phone, for example:"
  echo "  AURA_PUBLIC_HOST=192.168.1.42"
fi
echo
echo "Stop with Ctrl-C."
echo

cleanup() {
  if [ -n "${FRONTEND_PID:-}" ] && kill -0 "${FRONTEND_PID}" 2>/dev/null; then
    kill "${FRONTEND_PID}" 2>/dev/null || true
  fi
  if [ -n "${SERVER_PID:-}" ] && kill -0 "${SERVER_PID}" 2>/dev/null; then
    kill "${SERVER_PID}" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

(
  cd "$ROOT"
  export AURA_SERVER_HOST="${BACKEND_HOST}"
  export AURA_SERVER_PORT="${BACKEND_PORT}"
  cargo run -p aura-os-server --bin aura-os-server
) &
SERVER_PID=$!

(
  cd "$ROOT/interface"
  npm run dev -- --host "${FRONTEND_HOST}" --port "${FRONTEND_PORT}" --strictPort
) &
FRONTEND_PID=$!

while true; do
  if ! kill -0 "${SERVER_PID}" 2>/dev/null; then
    wait "${SERVER_PID}"
    exit $?
  fi

  if ! kill -0 "${FRONTEND_PID}" 2>/dev/null; then
    wait "${FRONTEND_PID}"
    exit $?
  fi

  sleep 1
done
