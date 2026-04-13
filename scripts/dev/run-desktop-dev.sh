#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FRONTEND_HOST="${AURA_FRONTEND_HOST:-127.0.0.1}"
FRONTEND_PORT="${AURA_FRONTEND_PORT:-5173}"
FRONTEND_CONNECT_HOST="${AURA_DESKTOP_FRONTEND_CONNECT_HOST:-$FRONTEND_HOST}"
DESKTOP_TARGET_DIR="${AURA_DESKTOP_TARGET_DIR:-${CARGO_TARGET_DIR:-$ROOT/target/desktop-dev}}"
DESKTOP_SERVER_PORT="${AURA_DESKTOP_SERVER_PORT:-}"
if [ "${FRONTEND_CONNECT_HOST}" = "0.0.0.0" ]; then
  FRONTEND_CONNECT_HOST="127.0.0.1"
fi
FRONTEND_URL="http://${FRONTEND_CONNECT_HOST}:${FRONTEND_PORT}"

cd "$ROOT"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

echo "Starting Aura desktop dev stack"
echo "  Frontend bind: http://${FRONTEND_HOST}:${FRONTEND_PORT}"
echo "  Desktop dev URL: ${FRONTEND_URL}"
echo "  Cargo target dir: ${DESKTOP_TARGET_DIR}"
if [ -n "${DESKTOP_SERVER_PORT}" ]; then
  echo "  Desktop host port: ${DESKTOP_SERVER_PORT}"
else
  echo "  Desktop host port: auto"
fi
echo
echo "Waiting for Vite before launching the desktop shell..."
echo "Stop with Ctrl-C."
echo

MANAGED_FRONTEND=0

frontend_ready() {
  curl --silent --fail "${FRONTEND_URL}/@vite/client" >/dev/null 2>&1
}

cleanup() {
  if [ -n "${DESKTOP_PID:-}" ] && kill -0 "${DESKTOP_PID}" 2>/dev/null; then
    kill "${DESKTOP_PID}" 2>/dev/null || true
  fi
  if [ "${MANAGED_FRONTEND}" = "1" ] && [ -n "${FRONTEND_PID:-}" ] && kill -0 "${FRONTEND_PID}" 2>/dev/null; then
    kill "${FRONTEND_PID}" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

if frontend_ready; then
  echo "Reusing existing Vite dev server at ${FRONTEND_URL}"
else
  (
    cd "$ROOT/interface"
    exec npm run dev -- --host "${FRONTEND_HOST}" --port "${FRONTEND_PORT}" --strictPort
  ) &
  FRONTEND_PID=$!
  MANAGED_FRONTEND=1

  until frontend_ready; do
    if ! kill -0 "${FRONTEND_PID}" 2>/dev/null; then
      wait "${FRONTEND_PID}"
      exit $?
    fi
    sleep 1
  done
fi

(
  cd "$ROOT"
  export AURA_DESKTOP_FRONTEND_DEV_URL="${FRONTEND_URL}"
  export CARGO_TARGET_DIR="${DESKTOP_TARGET_DIR}"
  if [ -n "${DESKTOP_SERVER_PORT}" ]; then
    export AURA_SERVER_PORT="${DESKTOP_SERVER_PORT}"
  else
    export AURA_SERVER_PORT="0"
  fi
  exec cargo run -p aura-os-desktop
) &
DESKTOP_PID=$!

while true; do
  if [ "${MANAGED_FRONTEND}" = "1" ] && ! kill -0 "${FRONTEND_PID}" 2>/dev/null; then
    wait "${FRONTEND_PID}"
    exit $?
  fi

  if ! kill -0 "${DESKTOP_PID}" 2>/dev/null; then
    wait "${DESKTOP_PID}"
    exit $?
  fi

  sleep 1
done
