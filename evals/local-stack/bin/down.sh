#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$script_dir/common.sh"

remove_volumes=0
if [[ $# -gt 1 ]]; then
  echo "Usage: $0 [--volumes]" >&2
  exit 1
fi

if [[ "${1:-}" == "--volumes" ]]; then
  remove_volumes=1
elif [[ $# -eq 1 ]]; then
  echo "Usage: $0 [--volumes]" >&2
  exit 1
fi

stack_load_env
stack_check_command docker

args=(down --remove-orphans)
if [[ "$remove_volumes" -eq 1 ]]; then
  args+=(-v)
fi

docker compose -f "$AURA_STACK_DOCKER_COMPOSE_FILE" "${args[@]}"
