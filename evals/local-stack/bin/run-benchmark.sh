#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$script_dir/common.sh"

stack_load_env
stack_validate_modes

grep_pattern="${1:-}"

set -a
# shellcheck disable=SC1090
source "$AURA_STACK_RUNTIME_DIR/evals.env"
set +a

access_token="$(
  curl -fsSL "http://127.0.0.1:${AURA_STACK_AURA_OS_PORT}/api/auth/access-token" \
    | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p'
)"

if [[ -z "$access_token" ]]; then
  echo "No access token available from local Aura OS. Sign in first or run bootstrap-auth.sh." >&2
  exit 1
fi

export AURA_EVAL_ACCESS_TOKEN="$access_token"
export AURA_EVAL_KEEP_ENTITIES="${AURA_EVAL_KEEP_ENTITIES:-0}"

cd "$AURA_STACK_REPO_ROOT/frontend"

if [[ -n "$grep_pattern" ]]; then
  npx playwright test tests/e2e/evals/live-benchmark.spec.ts --project=eval-live-desktop --grep "$grep_pattern"
else
  npm run test:evals:benchmark
fi
