#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$script_dir/common.sh"

remove_volumes=0
if [[ "${1:-}" == "--volumes" ]]; then
  remove_volumes=1
elif [[ $# -gt 0 ]]; then
  echo "Usage: $0 [--volumes]" >&2
  exit 1
fi

stack_load_env
stack_validate_modes

echo "Stopping host-managed services..."
while IFS= read -r service; do
  [[ -n "$service" ]] || continue
  stack_stop_background_service "$service"
done < <(stack_host_managed_services)

echo "Stopping Docker-managed services..."
if [[ "$remove_volumes" -eq 1 ]]; then
  "$script_dir/down.sh" --volumes
else
  "$script_dir/down.sh"
fi

echo "Local stack is down."
