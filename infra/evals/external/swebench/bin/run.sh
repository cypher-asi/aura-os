#!/usr/bin/env sh
# POSIX wrapper for the SWE-bench Verified benchmark lane.
#
# Usage:
#   ./infra/evals/external/swebench/bin/run.sh smoke
#   ./infra/evals/external/swebench/bin/run.sh verified
#   ./infra/evals/external/swebench/bin/run.sh --instance-ids django__django-12345
#
# Environment:
#   AURA_EVAL_ACCESS_TOKEN          required, loaded from .env/auth.env if present
#   AURA_EVAL_API_BASE_URL          optional (defaults to http://127.0.0.1:3190)
#   AURA_EVAL_STORAGE_URL           optional
#   AURA_BENCH_LOOP_TIMEOUT_MS      optional (default 1500000 = 25 min)
#   AURA_BENCH_MAX_USD              optional cost cap
#   AURA_BENCH_MAX_WORKERS          optional swebench harness max_workers (default 4)
#   AURA_BENCH_AGENT_MACHINE_TYPE   optional ("local")
#   AURA_BENCH_BUILD_COMMAND        optional placeholder build command
#   AURA_BENCH_TEST_COMMAND         optional placeholder test command

set -eu

# When launched as an absolute Git-for-Windows sh.exe from PowerShell, PATH may
# not include the Unix helper directory that contains dirname/sed/awk/df.
PATH="/usr/bin:/bin:$PATH"
export PATH

err() {
    printf '[swebench-run] error: %s\n' "$1" >&2
    exit 1
}

info() {
    printf '[swebench-run] %s\n' "$1" >&2
}

# Resolve repo root: prefer git, fall back to a relative path.
case "$0" in
    */*) script_dir=${0%/*} ;;
    *) script_dir=. ;;
esac
script_path=$(cd "$script_dir" && pwd)
repo_root=$(git rev-parse --show-toplevel 2>/dev/null || echo "")
if [ -z "$repo_root" ]; then
    repo_root=$(cd "$script_path/../../../../.." && pwd)
fi
cd "$repo_root"

# Load repo .env files and local-stack runtime auth, if present.
# shellcheck disable=SC1091
. "$repo_root/infra/evals/external/bin/load-env.sh"
external_bench_load_env "$repo_root"
if [ -n "${AURA_STACK_AURA_OS_DATA_DIR:-}" ]; then
    mkdir -p "$AURA_STACK_AURA_OS_DATA_DIR/store"
fi

# Parse subset argument: first positional argument unless it starts with "--".
SUBSET="smoke"
if [ "$#" -gt 0 ]; then
    case "$1" in
        --*)
            ;;
        *)
            SUBSET="$1"
            shift
            ;;
    esac
fi

# Preflight: node >= 22.
if ! command -v node >/dev/null 2>&1; then
    err "node is required but not on PATH"
fi
node_version=$(node --version 2>/dev/null | sed 's/^v//')
node_major=$(printf '%s' "$node_version" | awk -F. '{print $1+0}')
if [ "${node_major:-0}" -lt 22 ]; then
    err "node >= 22 is required (found $node_version)"
fi

# Preflight: python3 + swebench harness.
if ! command -v python3 >/dev/null 2>&1; then
    err "python3 is required but not on PATH"
fi
if ! python_platform=$(python3 - <<'PY'
import sys

print(sys.platform)
PY
); then
    err "could not inspect python3 platform"
fi
case "$python_platform" in
    win32|cygwin|msys*)
        err "SWE-bench harness requires Linux/macOS Python; native Windows Python lacks the Unix 'resource' module. Run from WSL2 or another Linux environment."
        ;;
esac
if ! python3 -m pip show swebench >/dev/null 2>&1 && ! pip3 show swebench >/dev/null 2>&1; then
    err "the swebench Python package is not installed; run: pip3 install swebench"
fi

# Preflight: docker daemon.
if ! command -v docker >/dev/null 2>&1; then
    err "docker is required but not on PATH"
fi
if ! docker info >/dev/null 2>&1; then
    err "docker daemon does not respond to 'docker info'; start Docker first"
fi

# Preflight: free disk space >= 20 GB.
df_target="$repo_root"
if ! df_output=$(df -k "$df_target" 2>/dev/null); then
    err "could not run 'df -k' on $df_target"
fi
free_kb=$(printf '%s\n' "$df_output" | awk 'NR==2 {print $4} NR>2 {print $4; exit}')
if [ -z "${free_kb:-}" ]; then
    err "could not parse free space from df output"
fi
free_gb=$(( free_kb / 1024 / 1024 ))
if [ "$free_gb" -lt 20 ]; then
    err "less than 20 GB free on the work-dir partition (~${free_gb} GB)"
fi
info "preflight ok: node=$node_version free=${free_gb}GB"

# Preflight: access token.
if [ -z "${AURA_EVAL_ACCESS_TOKEN:-}" ]; then
    err "AURA_EVAL_ACCESS_TOKEN is not set; bring up the local stack and bootstrap a token first"
fi

# Build run id and out dir.
git_sha=$(git rev-parse --short=12 HEAD 2>/dev/null || echo "unknown")
ts=$(date +%Y%m%d-%H%M%S)
RUN_ID="aura-${git_sha}-${ts}"
OUT_DIR="infra/evals/reports/external/swebench_verified/${RUN_ID}"
mkdir -p "$OUT_DIR"
info "run_id=${RUN_ID} out=${OUT_DIR}"

# Generate dataset manifest if missing.
manifest="infra/evals/external/swebench/datasets/${SUBSET}.jsonl"
if [ ! -f "$manifest" ]; then
    info "manifest $manifest not found; running fetch-dataset"
    node infra/evals/external/swebench/bin/fetch-dataset.mjs --subset "$SUBSET"
fi

# Run the driver. Forward any extra args (e.g. --instance-ids ...).
info "starting AURA driver"
set +e
node infra/evals/external/swebench/run-swebench.mjs \
    --subset "$SUBSET" \
    --out "$OUT_DIR" \
    "$@"
driver_status=$?
set -e
if [ "$driver_status" -ne 0 ]; then
    info "driver exited with status $driver_status; continuing to harness with whatever predictions were produced"
fi

# Run the swebench harness. We don't fail the wrapper if the harness fails;
# partial results are still useful.
predictions="$OUT_DIR/predictions.jsonl"
if [ ! -f "$predictions" ]; then
    info "no predictions.jsonl produced; skipping harness"
else
    info "running swebench harness"
    set +e
    python3 -m swebench.harness.run_evaluation \
        --predictions_path "$predictions" \
        --dataset_name princeton-nlp/SWE-bench_Verified \
        --max_workers "${AURA_BENCH_MAX_WORKERS:-4}" \
        --run_id "$RUN_ID" \
        --report_dir "$OUT_DIR/harness-report"
    harness_status=$?
    set -e
    if [ "$harness_status" -ne 0 ]; then
        info "swebench harness exited with status $harness_status; continuing with partial scoring"
    fi
fi

# Aggregate.
info "aggregating score"
node infra/evals/external/swebench/bin/aggregate-score.mjs --out "$OUT_DIR"

# Final summary.
score_path="$OUT_DIR/score.json"
if [ -f "$score_path" ]; then
    info "score.json: $score_path"
fi
info "tip: if disk usage is high, run 'docker system prune' to reclaim space"
