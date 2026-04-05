#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$script_dir/common.sh"

stack_load_env

set -a
# shellcheck disable=SC1090
source "$AURA_STACK_RUNTIME_DIR/evals.env"
set +a

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

export AURA_EVAL_HARNESS_URL="${AURA_EVAL_HARNESS_URL:-http://127.0.0.1:${AURA_STACK_HARNESS_PORT}}"
export AURA_EVAL_RESULTS_DIR="${AURA_EVAL_RESULTS_DIR:-test-results/harness-suite}"
export AURA_EVAL_SCENARIOS="${AURA_EVAL_SCENARIOS:-harness-context-static-site,harness-context-repo-iteration}"
export AURA_EVAL_REQUIRE_PRICED_RUNS="${AURA_EVAL_REQUIRE_PRICED_RUNS:-1}"

cd "$AURA_STACK_REPO_ROOT/interface"

IFS=',' read -r -a aura_eval_scenarios <<< "$AURA_EVAL_SCENARIOS"

for scenario_id in "${aura_eval_scenarios[@]}"; do
  AURA_EVAL_SCENARIO_ID="$scenario_id" node ./scripts/run-harness-context-benchmark.mjs
done

node ./scripts/summarize-benchmark-usage.mjs "$AURA_EVAL_RESULTS_DIR"
