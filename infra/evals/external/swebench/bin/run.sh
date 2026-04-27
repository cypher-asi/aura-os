#!/usr/bin/env sh
# POSIX wrapper for the SWE-bench Verified benchmark lane.
#
# Usage:
#   ./infra/evals/external/swebench/bin/run.sh smoke
#   ./infra/evals/external/swebench/bin/run.sh verified
#   ./infra/evals/external/swebench/bin/run.sh --instance-ids django__django-12345
#
# Environment:
#   AURA_EVAL_ACCESS_TOKEN          set by zOS login during startup
#   AURA_EVAL_API_BASE_URL          optional (defaults to http://127.0.0.1:3190)
#   AURA_EVAL_STORAGE_URL           optional
#   AURA_BENCH_LOOP_TIMEOUT_MS      optional (default 1500000 = 25 min)
#   AURA_BENCH_MAX_USD              optional cost cap
#   AURA_BENCH_MAX_WORKERS          optional swebench harness max_workers (default 4)
#   AURA_BENCH_AGENT_MACHINE_TYPE   optional ("local")
#   AURA_BENCH_BUILD_COMMAND        optional placeholder build command
#   AURA_BENCH_TEST_COMMAND         optional placeholder test command
#   AURA_EVAL_AGENT_DEFAULT_MODEL   optional model for created benchmark agents
#   AURA_BENCH_SKIP_API_PREFLIGHT   optional, set 1 to skip API auth/org checks
#   AURA_EVAL_USER_EMAIL/PASSWORD   set by interactive zOS login prompt

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

api_base_url() {
    printf '%s' "${AURA_EVAL_API_BASE_URL:-http://127.0.0.1:3190}" | sed 's:/*$::'
}

api_get() {
    endpoint="$1"
    output_file="$2"
    status_file="$3"
    base_url=$(api_base_url)
    curl \
        --silent \
        --show-error \
        --output "$output_file" \
        --write-out '%{http_code}' \
        --connect-timeout 5 \
        --max-time 20 \
        -H "Authorization: Bearer ${AURA_EVAL_ACCESS_TOKEN}" \
        "${base_url}${endpoint}" >"$status_file"
}

json_escape() {
    printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

windows_clipboard_text() {
    if ! command -v powershell.exe >/dev/null 2>&1; then
        return 1
    fi
    powershell.exe -NoProfile -Command "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-Clipboard -Raw" 2>/dev/null |
        sed 's/\r$//' |
        awk 'BEGIN { ORS="" } { if (NR > 1) printf "\n"; printf "%s", $0 }'
}

append_masked_password_text() {
    text="$1"
    while [ -n "$text" ]; do
        char=${text%"${text#?}"}
        text=${text#?}
        case "$char" in
            [[:print:]])
                value="${value}${char}"
                printf '*' > /dev/tty
                ;;
        esac
    done
}

read_masked_password() {
    value=""
    in_bracketed_paste=0
    while IFS= read -r -s -n 1 char < /dev/tty; do
        case "$char" in
            ""|$'\r'|$'\n')
                break
                ;;
            $'\177'|$'\b')
                if [ -n "$value" ]; then
                    value=${value%?}
                    printf '\b \b' > /dev/tty
                fi
                ;;
            $'\026')
                if clipboard="$(windows_clipboard_text)"; then
                    append_masked_password_text "$clipboard"
                fi
                ;;
            $'\033')
                sequence=""
                while IFS= read -r -s -n 1 next < /dev/tty; do
                    sequence="${sequence}${next}"
                    case "$sequence" in
                        "[200~")
                            in_bracketed_paste=1
                            break
                            ;;
                        "[201~")
                            in_bracketed_paste=0
                            break
                            ;;
                    esac
                    if [ "${#sequence}" -ge 5 ]; then
                        break
                    fi
                done
                ;;
            *)
                case "$char" in
                    [[:print:]])
                        append_masked_password_text "$char"
                        ;;
                    *)
                        if [ "$in_bracketed_paste" -eq 1 ]; then
                            append_masked_password_text "$char"
                        fi
                        ;;
                esac
                ;;
        esac
    done
    printf '%s' "$value"
}

prompt_eval_login_credentials() {
    if [ ! -r /dev/tty ]; then
        return 1
    fi

    info "enter zOS login credentials"
    printf 'zOS email: ' > /dev/tty
    IFS= read -r AURA_EVAL_USER_EMAIL < /dev/tty || return 1
    if [ -z "$AURA_EVAL_USER_EMAIL" ]; then
        return 1
    fi
    export AURA_EVAL_USER_EMAIL

    printf 'zOS password: ' > /dev/tty
    AURA_EVAL_USER_PASSWORD="$(read_masked_password)"
    printf '\n' > /dev/tty
    if [ -z "$AURA_EVAL_USER_PASSWORD" ]; then
        return 1
    fi
    export AURA_EVAL_USER_PASSWORD
}

login_eval_api() {
    prompt_eval_login_credentials || return 1
    if ! command -v curl >/dev/null 2>&1; then
        err "curl is required for zOS login"
    fi

    email=$(json_escape "$AURA_EVAL_USER_EMAIL")
    password=$(json_escape "$AURA_EVAL_USER_PASSWORD")
    payload=$(printf '{"email":"%s","password":"%s"}' "$email" "$password")
    tmp_login_body=$(mktemp)
    tmp_login_status=$(mktemp)
    base_url=$(api_base_url)
    if ! curl \
        --silent \
        --show-error \
        --output "$tmp_login_body" \
        --write-out '%{http_code}' \
        --connect-timeout 5 \
        --max-time 30 \
        -H 'Content-Type: application/json' \
        -d "$payload" \
        "${base_url}/api/auth/login" >"$tmp_login_status"
    then
        rm -f "$tmp_login_body" "$tmp_login_status"
        return 1
    fi

    status=$(cat "$tmp_login_status")
    if [ "$status" != "200" ]; then
        body=$(sed 's/[[:cntrl:]]//g' "$tmp_login_body" | cut -c 1-240)
        rm -f "$tmp_login_body" "$tmp_login_status"
        err "zOS login failed with HTTP ${status}: ${body}"
    fi

    token=$(sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p' "$tmp_login_body")
    rm -f "$tmp_login_body" "$tmp_login_status"
    if [ -z "$token" ]; then
        err "zOS login response did not include access_token"
    fi
    AURA_EVAL_ACCESS_TOKEN="$token"
    export AURA_EVAL_ACCESS_TOKEN
    info "zOS login succeeded via $(api_base_url)/api/auth/login"
}

preflight_eval_api() {
    if [ "${AURA_BENCH_SKIP_API_PREFLIGHT:-0}" = "1" ]; then
        info "skipping API preflight because AURA_BENCH_SKIP_API_PREFLIGHT=1"
        return 0
    fi

    if ! command -v curl >/dev/null 2>&1; then
        err "curl is required for API preflight"
    fi

    tmp_body=$(mktemp)
    tmp_status=$(mktemp)
    trap 'stop_harness_log_follower; rm -f "$tmp_body" "$tmp_status"' EXIT

    if ! api_get "/api/auth/session" "$tmp_body" "$tmp_status"; then
        err "API preflight could not reach $(api_base_url)/api/auth/session"
    fi
    status=$(cat "$tmp_status")
    if [ "$status" != "200" ]; then
        body=$(sed 's/[[:cntrl:]]//g' "$tmp_body" | cut -c 1-240)
        err "API preflight auth failed with HTTP ${status}: ${body}"
    fi

    if ! api_get "/api/orgs" "$tmp_body" "$tmp_status"; then
        err "API preflight could not reach $(api_base_url)/api/orgs"
    fi
    status=$(cat "$tmp_status")
    if [ "$status" != "200" ]; then
        body=$(sed 's/[[:cntrl:]]//g' "$tmp_body" | cut -c 1-240)
        err "API preflight org lookup failed with HTTP ${status}: ${body}"
    fi

    rm -f "$tmp_body" "$tmp_status"
    trap 'stop_harness_log_follower' EXIT
    info "API preflight ok: auth/session and org lookup succeeded"
}

free_disk_gb() {
    df_target="$1"
    if ! df_output=$(df -k "$df_target" 2>/dev/null); then
        err "could not run 'df -k' on $df_target"
    fi
    free_kb=$(printf '%s\n' "$df_output" | awk 'NR==2 {print $4} NR>2 {print $4; exit}')
    if [ -z "${free_kb:-}" ]; then
        err "could not parse free space from df output"
    fi
    printf '%s' $(( free_kb / 1024 / 1024 ))
}

preflight_disk_space() {
    df_target="$1"
    free_gb=$(free_disk_gb "$df_target")
    if [ "$free_gb" -ge 20 ]; then
        return 0
    fi

    info "less than 20 GB free on the work-dir partition (~${free_gb} GB); running 'docker system prune'"
    if ! command -v docker >/dev/null 2>&1; then
        err "less than 20 GB free on the work-dir partition (~${free_gb} GB), and docker is not on PATH for cleanup"
    fi
    if ! docker system prune; then
        err "docker system prune failed; still less than 20 GB free on the work-dir partition (~${free_gb} GB)"
    fi

    free_gb=$(free_disk_gb "$df_target")
    if [ "$free_gb" -lt 20 ]; then
        err "less than 20 GB free on the work-dir partition after docker system prune (~${free_gb} GB)"
    fi
}

HARNESS_LOG_FOLLOWER_PID=""

stop_harness_log_follower() {
    if [ -n "$HARNESS_LOG_FOLLOWER_PID" ]; then
        kill "$HARNESS_LOG_FOLLOWER_PID" >/dev/null 2>&1 || true
        wait "$HARNESS_LOG_FOLLOWER_PID" 2>/dev/null || true
        HARNESS_LOG_FOLLOWER_PID=""
    fi
}

start_harness_log_follower() {
    if [ "${AURA_BENCH_HARNESS_LOGS:-1}" = "0" ]; then
        return 0
    fi
    harness_log_file="${AURA_BENCH_HARNESS_LOG_FILE:-${AURA_STACK_LOG_DIR:-$repo_root/infra/evals/local-stack/.runtime/logs}/harness.log}"
    info "following harness logs from ${harness_log_file} (set AURA_BENCH_HARNESS_LOGS=0 to disable)"
    node infra/evals/external/bin/follow-harness-log.mjs \
        --file "$harness_log_file" \
        --from-end \
        --label "harness" &
    HARNESS_LOG_FOLLOWER_PID=$!
}

trap 'stop_harness_log_follower' EXIT

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

# Preflight: zOS login. Keep this before tool and Docker checks so interactive
# runs fail fast on auth instead of waiting on local benchmark setup.
if ! login_eval_api; then
    err "zOS login requires an interactive terminal"
fi
preflight_eval_api

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

SKIP_SWEBENCH_HARNESS=0

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
        SKIP_SWEBENCH_HARNESS=1
        info "native Windows Python detected; AURA driver will run, but the official SWE-bench harness will be skipped because it requires Linux/macOS Python"
        ;;
esac
if [ "$SKIP_SWEBENCH_HARNESS" -eq 0 ] && ! python3 -m pip show swebench >/dev/null 2>&1 && ! pip3 show swebench >/dev/null 2>&1; then
    err "the swebench Python package is not installed; run: pip3 install swebench"
fi

# Preflight: docker daemon. Required only by the official scorer; the AURA
# driver can still emit predictions and per-instance artifacts without it.
if [ "$SKIP_SWEBENCH_HARNESS" -eq 0 ]; then
    if ! command -v docker >/dev/null 2>&1; then
        err "docker is required but not on PATH"
    fi
    if ! docker info >/dev/null 2>&1; then
        err "docker daemon does not respond to 'docker info'; start Docker first"
    fi
fi

# Preflight: free disk space >= 20 GB.
preflight_disk_space "$repo_root"
free_gb=$(free_disk_gb "$repo_root")
info "preflight ok: node=$node_version free=${free_gb}GB"

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
start_harness_log_follower
set +e
node infra/evals/external/swebench/run-swebench.mjs \
    --subset "$SUBSET" \
    --out "$OUT_DIR" \
    "$@"
driver_status=$?
set -e
stop_harness_log_follower
if [ "$driver_status" -ne 0 ]; then
    info "driver exited with status $driver_status; continuing to harness with whatever predictions were produced"
fi

# Run the swebench harness. We don't fail the wrapper if the harness fails;
# partial results are still useful.
predictions="$OUT_DIR/predictions.jsonl"
if [ "$SKIP_SWEBENCH_HARNESS" -eq 1 ]; then
    info "skipping swebench harness on native Windows Python; run this directory from WSL2/Linux for official resolved/not_resolved scoring"
elif [ ! -f "$predictions" ]; then
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
