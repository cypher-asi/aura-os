#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$script_dir/common.sh"

stack_load_env
stack_validate_modes
stack_mkdir_runtime

"$script_dir/doctor.sh"
"$script_dir/up.sh"

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
if curl -fsS "${AURA_STACK_AUTH_SOURCE_URL:-http://127.0.0.1:3100}/api/auth/access-token" >/dev/null 2>&1; then
  "$script_dir/bootstrap-auth.sh"
else
  echo "  skipped: no source Aura session available at ${AURA_STACK_AUTH_SOURCE_URL:-http://127.0.0.1:3100}"
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
