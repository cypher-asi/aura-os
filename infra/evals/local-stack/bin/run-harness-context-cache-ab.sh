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

cache_on_results_dir="${AURA_EVAL_CACHE_ON_RESULTS_DIR:-test-results/current-harness-suite-cache-on}"
cache_off_results_dir="${AURA_EVAL_CACHE_OFF_RESULTS_DIR:-test-results/current-harness-suite-cache-off}"
compare_name="${AURA_EVAL_COMPARE_NAME:-harness-suite-cache-on-vs-off}"
cache_off_port="${AURA_EVAL_NOCACHE_HARNESS_PORT:-3415}"
cache_off_data_dir="${AURA_EVAL_NOCACHE_DATA_DIR:-$AURA_STACK_RUNTIME_DIR/aura-harness-data-nocache}"
cache_off_log="${AURA_EVAL_NOCACHE_LOG:-$AURA_STACK_RUNTIME_DIR/logs/harness-nocache.log}"

wait_for_url() {
  local url="$1"
  local deadline code
  deadline=$((SECONDS + AURA_STACK_HEALTH_TIMEOUT_SECONDS))
  code=""
  while (( SECONDS < deadline )); do
    code="$(curl -sS -o /dev/null -w '%{http_code}' "$url" 2>/dev/null || true)"
    if [[ "$code" == "200" ]]; then
      return 0
    fi
    sleep 1
  done
  echo "Timed out waiting for ${url} (last status ${code:-unreachable})" >&2
  return 1
}

cleanup() {
  if [[ -n "${cache_off_pid:-}" ]] && kill -0 "$cache_off_pid" >/dev/null 2>&1; then
    kill "$cache_off_pid" >/dev/null 2>&1 || true
    wait "$cache_off_pid" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT

cd "$AURA_STACK_REPO_ROOT"

echo "Running cache-on harness suite..."
AURA_EVAL_RESULTS_DIR="$cache_on_results_dir" \
  "$script_dir/run-harness-context-suite.sh"

echo "Starting cache-off harness on port ${cache_off_port}..."
mkdir -p "$cache_off_data_dir" "$(dirname "$cache_off_log")"
(
  cd "$AURA_STACK_HARNESS_DIR"
  export AURA_LISTEN_ADDR="127.0.0.1:${cache_off_port}"
  export AURA_DATA_DIR="$cache_off_data_dir"
  export AURA_NETWORK_URL="$(stack_resolved_url network)"
  export AURA_STORAGE_URL="$(stack_resolved_url storage)"
  export ORBIT_URL="$(stack_resolved_url orbit)"
  export AURA_LLM_ROUTING="$AURA_STACK_HARNESS_LLM_ROUTING"
  export ENABLE_CMD_TOOLS="$AURA_STACK_HARNESS_ENABLE_CMD_TOOLS"
  export ALLOWED_COMMANDS="$AURA_STACK_HARNESS_ALLOWED_COMMANDS"
  export RUST_LOG="$AURA_STACK_HARNESS_LOG_LEVEL"
  export AURA_DISABLE_PROMPT_CACHING=1
  exec cargo run -- run --ui none
) >"$cache_off_log" 2>&1 &
cache_off_pid=$!

wait_for_url "http://127.0.0.1:${cache_off_port}/health"

echo "Running cache-off harness suite..."
AURA_EVAL_HARNESS_URL="http://127.0.0.1:${cache_off_port}" \
  AURA_EVAL_RESULTS_DIR="$cache_off_results_dir" \
  "$script_dir/run-harness-context-suite.sh"

echo "Comparing cache-on vs cache-off..."
cd "$AURA_STACK_REPO_ROOT"
node ./interface/scripts/compare-benchmark-usage.mjs \
  "interface/${cache_on_results_dir}/aura-benchmark-usage-summary.json" \
  "interface/${cache_off_results_dir}/aura-benchmark-usage-summary.json" \
  "$compare_name"

echo "Cache-on summary: interface/${cache_on_results_dir}/aura-benchmark-usage-summary.json"
echo "Cache-off summary: interface/${cache_off_results_dir}/aura-benchmark-usage-summary.json"
echo "Comparison: test-results/${compare_name}.json"
