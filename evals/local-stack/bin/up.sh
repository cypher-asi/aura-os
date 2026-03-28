#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$script_dir/common.sh"

stack_load_env
stack_validate_modes
stack_require_dir_if_local network
stack_require_dir_if_local storage
stack_require_dir_if_local orbit
stack_require_dir_if_local harness
stack_check_command docker

"$script_dir/render-envs.sh"

export AURA_STACK_HARNESS_NETWORK_URL="$(stack_resolved_url network)"
export AURA_STACK_HARNESS_STORAGE_URL="$(stack_resolved_url storage)"
export AURA_STACK_HARNESS_ORBIT_URL="$(stack_resolved_url orbit)"

services=()
while IFS= read -r service; do
  if [[ -n "$service" ]]; then
    services+=("$service")
  fi
done < <(stack_docker_services)

if [[ "${#services[@]}" -eq 0 ]]; then
  echo "No local Docker services are enabled. Nothing to start."
  exit 0
fi

docker compose -f "$AURA_STACK_DOCKER_COMPOSE_FILE" up -d "${services[@]}"

echo
echo "Local stack containers are up."
echo
printf '%-8s  %-8s  %s\n' "service" "mode" "target"
stack_print_service_matrix
echo
echo "Next steps:"
echo "  ./evals/local-stack/bin/run-service.sh network"
echo "  ./evals/local-stack/bin/run-service.sh storage"
echo "  ./evals/local-stack/bin/run-service.sh orbit"
echo "  ./evals/local-stack/bin/run-service.sh aura-os"
echo "  ./evals/local-stack/bin/run-service.sh frontend"
