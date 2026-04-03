#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
INTERFACE_DIR="$ROOT_DIR/interface"

if [[ -f "$ROOT_DIR/evals/local-stack/.runtime/evals.env" ]]; then
  # shellcheck disable=SC1091
  source "$ROOT_DIR/evals/local-stack/.runtime/evals.env"
fi

if [[ -f "$ROOT_DIR/evals/local-stack/.runtime/auth.env" ]]; then
  # shellcheck disable=SC1091
  source "$ROOT_DIR/evals/local-stack/.runtime/auth.env"
fi

cd "$INTERFACE_DIR"
node scripts/external-agents/run-external-agent-benchmark.mjs
