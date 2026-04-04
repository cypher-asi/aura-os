#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$script_dir/common.sh"

stack_load_env
stack_validate_modes

grep_pattern="${1:-}"
baseline_path="${AURA_EVAL_BENCHMARK_BASELINE:-}"
api_base_url_override="${AURA_EVAL_API_BASE_URL:-}"
base_url_override="${AURA_EVAL_BASE_URL:-}"

set -a
# shellcheck disable=SC1090
source "$AURA_STACK_RUNTIME_DIR/evals.env"
set +a

if [[ -n "$api_base_url_override" ]]; then
  export AURA_EVAL_API_BASE_URL="$api_base_url_override"
fi

if [[ -n "$base_url_override" ]]; then
  export AURA_EVAL_BASE_URL="$base_url_override"
fi

if [[ -f "$AURA_STACK_RUNTIME_DIR/auth.env" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$AURA_STACK_RUNTIME_DIR/auth.env"
  set +a
fi

if [[ -z "${AURA_EVAL_ACCESS_TOKEN:-}" ]]; then
  if access_token="$(cargo run -q -p aura-os-server --bin print-auth-token -- "$AURA_STACK_AURA_OS_DATA_DIR" 2>/dev/null)"; then
    export AURA_EVAL_ACCESS_TOKEN="$access_token"
  fi
fi

if [[ -z "${AURA_EVAL_ACCESS_TOKEN:-}" ]]; then
  echo "No access token available for the API benchmark." >&2
  echo "Run bootstrap-auth.sh, or set AURA_STACK_SOURCE_ACCESS_TOKEN / AURA_EVAL_ACCESS_TOKEN." >&2
  exit 1
fi

export AURA_EVAL_KEEP_ENTITIES="${AURA_EVAL_KEEP_ENTITIES:-0}"

cd "$AURA_STACK_REPO_ROOT/interface"

node ./scripts/run-live-benchmark-api.mjs "$grep_pattern"
node ./scripts/summarize-evals.mjs
node ./scripts/summarize-benchmark-usage.mjs

if [[ -n "$baseline_path" ]]; then
  node ./scripts/compare-benchmark-usage.mjs \
    test-results/aura-benchmark-usage-summary.json \
    "$baseline_path" \
    aura-benchmark-usage-compare
fi
