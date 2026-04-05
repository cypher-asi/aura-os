#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"

export AURA_STACK_PRESET="${AURA_STACK_PRESET:-hybrid-swarm}"

exec "$script_dir/run-one-shot.sh" "$@"
