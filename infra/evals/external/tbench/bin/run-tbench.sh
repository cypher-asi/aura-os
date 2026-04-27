#!/bin/sh
# POSIX runner for AURA's Terminal-Bench integration.
#
# Usage:
#   ./infra/evals/external/tbench/bin/run-tbench.sh smoke
#   ./infra/evals/external/tbench/bin/run-tbench.sh full
#
# Honored environment variables:
#   AURA_EVAL_ACCESS_TOKEN          (required, loaded from .env/auth.env if present)
#   AURA_EVAL_API_BASE_URL          (default http://127.0.0.1:3190)
#   AURA_EVAL_STORAGE_URL           (optional)
#   AURA_BENCH_LOOP_TIMEOUT_SECONDS (default 1500)
#   AURA_BENCH_TB_CONCURRENCY       (default 2)
#   AURA_BENCH_BRIDGE_NODE          (default node)
#   AURA_BENCH_TBENCH_DATASET       (default terminal-bench-core==head)
#   TB_EXTRA_ARGS                   (extra args appended verbatim to tb run)

set -eu

PATH="/usr/bin:/bin:$PATH"
export PATH

usage() {
    printf 'Usage: %s {smoke|full}\n' "$0" >&2
    exit 2
}

if [ "$#" -lt 1 ]; then
    usage
fi

SUBSET="$1"
case "$SUBSET" in
    smoke|full) ;;
    verified) SUBSET="full" ;;
    *) usage ;;
esac

die() {
    printf 'run-tbench: %s\n' "$*" >&2
    exit 1
}

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$REPO_ROOT" ]; then
    die "must be run inside a git checkout (git rev-parse --show-toplevel failed)"
fi

# Load repo .env files and local-stack runtime auth, if present.
# shellcheck disable=SC1091
. "$REPO_ROOT/infra/evals/external/bin/load-env.sh"
external_bench_load_env "$REPO_ROOT"
export AURA_EVAL_PRESERVE_ACCESS_TOKEN="${AURA_EVAL_PRESERVE_ACCESS_TOKEN:-1}"
if [ -n "${AURA_STACK_AURA_OS_DATA_DIR:-}" ]; then
    mkdir -p "$AURA_STACK_AURA_OS_DATA_DIR/store"
fi

# --- Preflight ---------------------------------------------------------------

if ! command -v node >/dev/null 2>&1; then
    die "node is not on PATH"
fi
NODE_RAW_VERSION="$(node --version 2>/dev/null || true)"
NODE_RAW_VERSION="${NODE_RAW_VERSION#v}"
NODE_MAJOR="${NODE_RAW_VERSION%%.*}"
case "$NODE_MAJOR" in
    ''|*[!0-9]*) die "could not parse node major version from '$NODE_RAW_VERSION'" ;;
esac
if [ "$NODE_MAJOR" -lt 22 ]; then
    die "node >= 22 required (found $NODE_RAW_VERSION)"
fi

PYTHON_BIN=""
if command -v python3 >/dev/null 2>&1; then
    PYTHON_BIN="python3"
elif command -v python >/dev/null 2>&1; then
    PYTHON_BIN="python"
fi
if [ -z "$PYTHON_BIN" ]; then
    die "python3 is not on PATH"
fi
"$PYTHON_BIN" --version >/dev/null 2>&1 || die "python3 is not runnable"

PIP_BIN=""
if command -v pip3 >/dev/null 2>&1; then
    PIP_BIN="pip3"
elif command -v pip >/dev/null 2>&1; then
    PIP_BIN="pip"
fi
if [ -z "$PIP_BIN" ]; then
    die "pip3 is not on PATH"
fi
if ! "$PIP_BIN" show terminal-bench >/dev/null 2>&1; then
    die "terminal-bench is not installed (run: pip install terminal-bench)"
fi

if ! command -v docker >/dev/null 2>&1; then
    die "docker is not on PATH"
fi
if ! docker info >/dev/null 2>&1; then
    die "docker daemon is not reachable (docker info failed)"
fi

if ! command -v tb >/dev/null 2>&1; then
    die "tb CLI is not on PATH; reinstall terminal-bench"
fi

if [ -z "${AURA_EVAL_ACCESS_TOKEN:-}" ]; then
    die "AURA_EVAL_ACCESS_TOKEN is required"
fi

# Disk preflight: require >= 20 GB free on the partition that holds REPO_ROOT.
# We use POSIX `df -k` and fall back to /tmp if that fails.
disk_target="$REPO_ROOT"
[ -d "$disk_target" ] || disk_target="/tmp"
disk_kb="$(df -kP "$disk_target" 2>/dev/null | awk 'NR==2 { print $4 }')"
if [ -z "$disk_kb" ]; then
    die "could not determine free disk space on $disk_target"
fi
required_kb=$((20 * 1024 * 1024))
if [ "$disk_kb" -lt "$required_kb" ]; then
    have_gb=$((disk_kb / 1024 / 1024))
    die "less than 20 GB free on $disk_target (have ~${have_gb} GB); aborting"
fi

# Live pipeline preflight: actually exercise spec generation, task extraction,
# and the dev loop on a tiny fixture so we fail fast instead of after a long
# Terminal-Bench task. Honors AURA_BENCH_SKIP_LIVE_PREFLIGHT=1 as an opt-out.
if [ "${AURA_BENCH_SKIP_LIVE_PREFLIGHT:-0}" = "1" ]; then
    printf 'run-tbench: skipping live pipeline preflight (AURA_BENCH_SKIP_LIVE_PREFLIGHT=1)\n' >&2
else
    printf 'run-tbench: running live pipeline preflight (auth/spec/tasks/dev-loop)\n' >&2
    if ! node "$REPO_ROOT/interface/scripts/preflight-live-pipeline.mjs"; then
        die "live pipeline preflight failed; aborting before tb run"
    fi
    printf 'run-tbench: live pipeline preflight ok\n' >&2
fi

# --- Subset -> TB CLI args ---------------------------------------------------

case "$SUBSET" in
    smoke) SUBSET_ARGS="--max-tasks 10" ;;
    full)  SUBSET_ARGS="" ;;
esac

# --- Run identity and output dirs --------------------------------------------

GIT_SHORT_SHA="$(git -C "$REPO_ROOT" rev-parse --short=12 HEAD)"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
RUN_ID="aura-${GIT_SHORT_SHA}-${TIMESTAMP}"

OUT_DIR="$REPO_ROOT/infra/evals/reports/external/tbench_2_core/$RUN_ID"
TB_OUT_DIR="$OUT_DIR/tb-output"
RUNS_DIR="$OUT_DIR/runs"
mkdir -p "$OUT_DIR" "$TB_OUT_DIR" "$RUNS_DIR"

# --- Environment for the Python shim ----------------------------------------

PYTHONPATH_PREFIX="$REPO_ROOT/infra/evals/external/tbench"
if [ -n "${PYTHONPATH:-}" ]; then
    PYTHONPATH="$PYTHONPATH_PREFIX:$PYTHONPATH"
else
    PYTHONPATH="$PYTHONPATH_PREFIX"
fi
export PYTHONPATH

export AURA_BENCH_REPO_ROOT="$REPO_ROOT"
export AURA_BENCH_RUN_ID="$RUN_ID"
export AURA_BENCH_TBENCH_RESULTS_DIR="$RUNS_DIR"

DATASET="${AURA_BENCH_TBENCH_DATASET:-terminal-bench-core==head}"
CONCURRENCY="${AURA_BENCH_TB_CONCURRENCY:-2}"

printf 'run-tbench: subset=%s run_id=%s dataset=%s concurrency=%s\n' \
    "$SUBSET" "$RUN_ID" "$DATASET" "$CONCURRENCY" >&2
printf 'run-tbench: results dir = %s\n' "$OUT_DIR" >&2

START_EPOCH="$(date +%s)"

# --- Invoke Terminal-Bench ---------------------------------------------------

set +e
# shellcheck disable=SC2086 # SUBSET_ARGS / TB_EXTRA_ARGS intentionally word-split.
tb run \
    --dataset "$DATASET" \
    --agent-import-path aura_agent.aura_agent:AuraAgent \
    --n-concurrent "$CONCURRENCY" \
    --output-path "$TB_OUT_DIR" \
    $SUBSET_ARGS \
    ${TB_EXTRA_ARGS:-}
TB_EXIT=$?
set -e

END_EPOCH="$(date +%s)"
WALLCLOCK_SECONDS=$((END_EPOCH - START_EPOCH))
printf 'run-tbench: tb run exited with %d after %ds\n' "$TB_EXIT" "$WALLCLOCK_SECONDS" >&2

# --- Aggregate ---------------------------------------------------------------

node "$REPO_ROOT/infra/evals/external/tbench/bin/aggregate-score.mjs" \
    --out "$OUT_DIR" \
    --subset "$SUBSET" \
    --dataset "$DATASET" \
    --wallclock "$WALLCLOCK_SECONDS" \
    --git-sha "$GIT_SHORT_SHA"

SCORE_FILE="$OUT_DIR/score.json"
if [ ! -f "$SCORE_FILE" ]; then
    die "aggregate-score did not produce $SCORE_FILE"
fi

# --- Final summary ----------------------------------------------------------

# Use python3 to extract a few summary fields without taking a JSON dep.
"$PYTHON_BIN" - "$SCORE_FILE" "$WALLCLOCK_SECONDS" <<'PY'
import json
import sys

score_path, wallclock = sys.argv[1], sys.argv[2]
with open(score_path, "r", encoding="utf-8") as f:
    data = json.load(f)
print(f"benchmark      = {data.get('benchmark')}")
print(f"subset         = {data.get('subset')}")
print(f"instance_count = {data.get('instance_count')}")
print(f"score (%)      = {data.get('score')}")
print(f"cost_usd       = {data.get('cost_usd')}")
print(f"total_tokens   = {data.get('total_tokens')}")
print(f"wallclock_s    = {wallclock}")
print(f"score.json     = {score_path}")
note = data.get("confidence_note") or ""
if note:
    print(f"note: {note}")
PY

exit "$TB_EXIT"
