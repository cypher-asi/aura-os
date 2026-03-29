#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$script_dir/common.sh"

stack_load_env
stack_validate_modes

grep_pattern="${1:-}"
keep_up="${AURA_STACK_KEEP_UP:-0}"
remove_volumes="${AURA_STACK_ONE_SHOT_REMOVE_VOLUMES:-1}"

cleanup() {
  local exit_code=$?
  if [[ "$keep_up" == "1" ]]; then
    return "$exit_code"
  fi

  if [[ "$remove_volumes" == "1" ]]; then
    "$script_dir/down-all.sh" --volumes >/dev/null 2>&1 || true
  else
    "$script_dir/down-all.sh" >/dev/null 2>&1 || true
  fi
  return "$exit_code"
}

trap cleanup EXIT

if [[ "$remove_volumes" == "1" ]]; then
  "$script_dir/down-all.sh" --volumes
else
  "$script_dir/down-all.sh"
fi

"$script_dir/up-all.sh"

if [[ -n "$grep_pattern" ]]; then
  "$script_dir/run-benchmark.sh" "$grep_pattern"
else
  "$script_dir/run-benchmark.sh"
fi
