#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$script_dir/common.sh"

stack_load_env
stack_validate_modes

stack_check_command docker
stack_check_command cargo
stack_check_command node
stack_check_command npm

stack_require_dir_if_local network
stack_require_dir_if_local storage
stack_require_dir_if_local orbit
stack_require_dir_if_local harness

echo "Aura local stack doctor"
echo
printf '%-8s  %-8s  %-7s  %s\n' "service" "mode" "runtime" "target"
stack_print_service_matrix
echo
echo "workspace: $AURA_STACK_WORKSPACE_ROOT"
echo "repo:      $AURA_STACK_REPO_ROOT"
echo "runtime:   $AURA_STACK_RUNTIME_DIR"
echo "compose:   $AURA_STACK_DOCKER_COMPOSE_FILE"
echo

if stack_has_any_local_auth_service && [[ -z "$AURA_STACK_AUTH_COOKIE_SECRET" ]]; then
  echo "Warning: AURA_STACK_AUTH_COOKIE_SECRET is empty." >&2
  echo "Local aura-network / aura-storage / orbit will not accept Aura login tokens until that is set." >&2
fi

if [[ "$AURA_STACK_NETWORK_MODE" == "remote" && -z "$AURA_STACK_REMOTE_NETWORK_URL" ]]; then
  echo "Warning: network is set to remote but AURA_STACK_REMOTE_NETWORK_URL is empty." >&2
fi
if [[ "$AURA_STACK_STORAGE_MODE" == "remote" && -z "$AURA_STACK_REMOTE_STORAGE_URL" ]]; then
  echo "Warning: storage is set to remote but AURA_STACK_REMOTE_STORAGE_URL is empty." >&2
fi
if [[ "$AURA_STACK_ORBIT_MODE" == "remote" && -z "$AURA_STACK_REMOTE_ORBIT_URL" ]]; then
  echo "Warning: orbit is set to remote but AURA_STACK_REMOTE_ORBIT_URL is empty." >&2
fi
if [[ "$AURA_STACK_HARNESS_MODE" == "remote" && -z "$AURA_STACK_REMOTE_HARNESS_URL" ]]; then
  echo "Warning: harness is set to remote but AURA_STACK_REMOTE_HARNESS_URL is empty." >&2
fi

echo
echo "Doctor check passed."
