#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$script_dir/common.sh"

# Default behavior is idempotent: services already running with a
# tracked pid are left in place. `--restart` / `-r` flips that to
# "stop everything host-managed first, then start fresh", which is
# the right mode after rebuilding `aura-os-server` / `aura.exe` /
# any other host service: the cached pid keeps cargo from picking
# up the new binary because `stack_start_background_service`
# short-circuits with "already running" when the pid is alive.
restart=0
while (( $# > 0 )); do
  case "$1" in
    -r|--restart)
      restart=1
      shift
      ;;
    -h|--help)
      cat <<'USAGE'
Usage: up-all.sh [--restart|-r]

  --restart, -r   Stop any host-managed services that are still
                  running before starting fresh. Use this after
                  rebuilding service binaries to ensure the new
                  binaries are loaded; without it, services that
                  are already up are left untouched (idempotent up).
USAGE
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      echo "Run '$0 --help' for usage." >&2
      exit 1
      ;;
  esac
done

stack_load_env
stack_validate_modes
stack_mkdir_runtime

"$script_dir/doctor.sh"
"$script_dir/up.sh"

if (( restart == 1 )); then
  echo
  echo "Stopping host-managed services for restart..."
  while IFS= read -r service; do
    [[ -n "$service" ]] || continue
    stack_stop_background_service "$service"
  done < <(stack_host_managed_services)
fi

echo
echo "Starting host-managed services..."
while IFS= read -r service; do
  [[ -n "$service" ]] || continue
  stack_start_background_service "$service" "$script_dir"
done < <(stack_host_managed_services)

echo
echo "Waiting for service health..."
while IFS= read -r service; do
  [[ -n "$service" ]] || continue
  stack_wait_for_service "$service"
  echo "  ${service}: ready"
done < <(stack_host_managed_services)

echo
echo "Attempting auth bootstrap..."
if "$script_dir/bootstrap-auth.sh" --check >/dev/null 2>&1; then
  "$script_dir/bootstrap-auth.sh"
else
  echo "  skipped: no source Aura session or token override available"
fi

echo
echo "Local stack is ready."
echo "  frontend:  http://127.0.0.1:${AURA_STACK_FRONTEND_PORT}"
echo "  aura-os:   http://127.0.0.1:${AURA_STACK_AURA_OS_PORT}"
echo "  network:   http://127.0.0.1:${AURA_STACK_NETWORK_PORT}"
echo "  storage:   http://127.0.0.1:${AURA_STACK_STORAGE_PORT}"
echo "  orbit:     http://127.0.0.1:${AURA_STACK_ORBIT_PORT}"
echo "  harness:   http://127.0.0.1:${AURA_STACK_HARNESS_PORT}"
echo
echo "Logs:"
while IFS= read -r service; do
  [[ -n "$service" ]] || continue
  echo "  ${service}: $(stack_service_log_file "$service")"
done < <(stack_host_managed_services)
