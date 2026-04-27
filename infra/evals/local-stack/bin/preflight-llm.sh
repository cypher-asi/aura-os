#!/usr/bin/env bash
#
# preflight-llm.sh — probe the LLM path the eval harness will actually
# use, BEFORE the harness launches and burns its 8-attempt retry budget
# on every tool call.
#
# Surfaces each failure mode with an actionable diagnosis instead of the
# opaque "complete_streaming ... cloudflare_html=true" retry storm:
#
#   - Cloudflare WAF block (HTML body) → IP-level CF deny at onrender.com
#       edge; bypass with direct mode or wait for TTL
#   - 401 with non-CF body              → JWT not accepted by aura-router
#       (refresh via bootstrap-auth.sh) or invalid Anthropic key
#   - 403 with non-CF body              → upstream auth rejection at the
#       proxy (rare; usually billing / org missing)
#   - 5xx                               → router cold-start / outage
#   - connect timeout                   → router URL unreachable / DNS
#   - 2xx                               → path is healthy, proceed
#
# Mirrors the request shape the harness builds in
# `aura-reasoner/src/anthropic/provider.rs` build_request: POST
# /v1/messages with `anthropic-version: 2023-06-01`, JSON body, and
# either `Authorization: Bearer {jwt}` (proxy) or `x-api-key: {key}`
# (direct). A `max_tokens=1` payload keeps the probe cost negligible.
#
# Invocation:
#   preflight-llm.sh                    # uses AURA_EVAL_ACCESS_TOKEN
#   preflight-llm.sh <bearer-token>     # uses provided token (proxy)
#
# Behaviour controlled by AURA_STACK_LLM_PREFLIGHT (set in stack.env):
#   fail (default)  — exit non-zero on any probe failure
#   warn            — print the diagnosis but exit 0 (don't block startup)
#   skip            — bypass the probe entirely

set -euo pipefail

# When launched as an absolute Git-for-Windows bash.exe from PowerShell,
# PATH may not include the Unix helper directory that contains curl/sed.
PATH="/usr/bin:/bin:$PATH"
export PATH

script_dir="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$script_dir/common.sh"
stack_load_env

mode="${AURA_STACK_LLM_PREFLIGHT:-fail}"
case "$mode" in
  skip)
    exit 0
    ;;
  fail|warn) ;;
  *)
    echo "[preflight-llm] WARN: unknown AURA_STACK_LLM_PREFLIGHT=$mode (expected fail|warn|skip); treating as fail" >&2
    mode=fail
    ;;
esac

bail() {
  if [[ "$mode" == "warn" ]]; then
    echo "[preflight-llm] AURA_STACK_LLM_PREFLIGHT=warn — continuing anyway" >&2
    exit 0
  fi
  exit 1
}

# Skip when harness isn't even local — the swarm-gateway path doesn't go
# through aura-router on Render and isn't reachable from this script.
if [[ "${AURA_STACK_HARNESS_MODE:-}" != "local" ]]; then
  echo "[preflight-llm] skipping: AURA_STACK_HARNESS_MODE=${AURA_STACK_HARNESS_MODE:-unset} (not local)"
  exit 0
fi

# Effective LLM routing the harness will use. AURA_STACK_HARNESS_LLM_ROUTING
# wins when set; otherwise we assume the harness's own default ("proxy"
# per `aura-reasoner/src/anthropic/config.rs`). We don't read
# aura-harness/.env here because the merge happens later in run-service.sh
# and parsing it from this side would duplicate that logic.
effective_routing="${AURA_STACK_HARNESS_LLM_ROUTING:-proxy}"

case "$effective_routing" in
  proxy)
    router_url="${AURA_STACK_ROUTER_URL:-https://aura-router.onrender.com}"
    token="${1:-${AURA_EVAL_ACCESS_TOKEN:-${AURA_STACK_AURA_ROUTER_JWT:-}}}"
    if [[ -z "$token" ]]; then
      echo "[preflight-llm] FAIL: proxy mode but no JWT available." >&2
      echo "  Run bootstrap-auth.sh first, set AURA_EVAL_ACCESS_TOKEN, or set AURA_STACK_AURA_ROUTER_JWT." >&2
      bail
    fi
    auth_header="Authorization: Bearer $token"
    target_url="$router_url/v1/messages"
    target_label="aura-router proxy at $router_url"
    ;;
  direct)
    api_key="${AURA_STACK_ANTHROPIC_API_KEY:-${AURA_ANTHROPIC_API_KEY:-${ANTHROPIC_API_KEY:-}}}"
    if [[ -z "$api_key" ]]; then
      echo "[preflight-llm] FAIL: direct mode but no Anthropic API key set." >&2
      echo "  Set AURA_STACK_ANTHROPIC_API_KEY in stack.env (or ANTHROPIC_API_KEY in env)." >&2
      bail
    fi
    auth_header="x-api-key: $api_key"
    target_url="https://api.anthropic.com/v1/messages"
    target_label="Anthropic direct at api.anthropic.com"
    ;;
  *)
    echo "[preflight-llm] WARN: unknown effective routing '$effective_routing'; skipping probe." >&2
    exit 0
    ;;
esac

if ! command -v curl >/dev/null 2>&1; then
  echo "[preflight-llm] WARN: curl not on PATH; cannot probe $target_label." >&2
  bail
fi

model="${AURA_STACK_ANTHROPIC_MODEL:-aura-claude-opus-4-7}"
probe_body=$(printf '{"model":"%s","max_tokens":1,"messages":[{"role":"user","content":"."}]}' "$model")

tmp_body=$(mktemp)
trap 'rm -f "$tmp_body"' EXIT

echo "[preflight-llm] probing $target_label (model=$model, routing=$effective_routing)"

set +e
http_status=$(
  curl \
    --silent \
    --show-error \
    --connect-timeout 10 \
    --max-time 30 \
    --output "$tmp_body" \
    --write-out '%{http_code}' \
    -X POST \
    -H "$auth_header" \
    -H 'Content-Type: application/json' \
    -H 'anthropic-version: 2023-06-01' \
    -d "$probe_body" \
    "$target_url" 2>/dev/null
)
curl_exit=$?
set -e

if [[ "$curl_exit" -ne 0 || -z "$http_status" ]]; then
  echo "[preflight-llm] FAIL: curl error (exit=$curl_exit) reaching $target_url" >&2
  echo "  Likely DNS / connect timeout / network egress blocked." >&2
  echo "  Verify AURA_STACK_ROUTER_URL and outbound network access." >&2
  bail
fi

print_cf_block_remediation() {
  local ray ip
  ray=$(grep -oE 'Cloudflare Ray ID[^<]*<strong[^>]*>[^<]+' "$tmp_body" 2>/dev/null \
        | sed 's/.*>//' | head -n1 || true)
  ip=$(grep -oE 'cf-footer-ip">[0-9.]+<' "$tmp_body" 2>/dev/null \
        | sed 's/cf-footer-ip">//;s/<$//' | head -n1 || true)
  echo "  Cloudflare WAF blocked the request at the EDGE of onrender.com," >&2
  echo "  BEFORE it reached aura-router. This is an IP-level deny, not auth." >&2
  [[ -n "$ray" ]] && echo "    Cloudflare Ray ID: $ray" >&2
  [[ -n "$ip" ]]  && echo "    Blocked egress IP: $ip" >&2
  echo >&2
  echo "  Remediation (any of):" >&2
  echo "    a) Bypass aura-router by switching the eval to direct mode" >&2
  echo "       (in infra/evals/local-stack/stack.env):" >&2
  echo "         AURA_STACK_HARNESS_LLM_ROUTING=direct" >&2
  echo "         AURA_STACK_ANTHROPIC_API_KEY=sk-ant-..." >&2
  echo "    b) Throttle the retry storm that reinforces the WAF block:" >&2
  echo "         AURA_STACK_HARNESS_LLM_MAX_RETRIES=1" >&2
  echo "       and wait for the WAF TTL (typically 1-24h) to elapse." >&2
  echo "    c) Have the router/Render owner clear the rule for this IP/Ray ID." >&2
}

print_body_excerpt() {
  echo "  Response body (first 500 bytes):" >&2
  head -c 500 "$tmp_body" >&2
  echo >&2
}

is_cf_html() {
  grep -qiE 'cloudflare|cf-ray|<title>Attention Required|data-translate="block_headline"' \
       "$tmp_body" 2>/dev/null
}

case "$http_status" in
  2*)
    echo "[preflight-llm] OK: $target_label accepted probe (status=$http_status)"
    exit 0
    ;;
  401)
    echo "[preflight-llm] FAIL: $target_label rejected the auth header (status=401)" >&2
    if is_cf_html; then
      print_cf_block_remediation
    else
      print_body_excerpt
      if [[ "$effective_routing" == "proxy" ]]; then
        echo "  Refresh the JWT via bootstrap-auth.sh, or check AURA_STACK_AURA_ROUTER_JWT." >&2
      else
        echo "  Verify AURA_STACK_ANTHROPIC_API_KEY is current and has billing enabled." >&2
      fi
    fi
    bail
    ;;
  403)
    echo "[preflight-llm] FAIL: $target_label returned 403 Forbidden" >&2
    if is_cf_html; then
      print_cf_block_remediation
    else
      print_body_excerpt
      echo "  Non-Cloudflare 403: probably billing/org/quota at the upstream proxy." >&2
    fi
    bail
    ;;
  5*)
    echo "[preflight-llm] FAIL: $target_label upstream error (status=$http_status)" >&2
    print_body_excerpt
    echo "  Likely router cold-start or upstream provider outage. Retry in a minute." >&2
    bail
    ;;
  *)
    echo "[preflight-llm] FAIL: unexpected status $http_status from $target_label" >&2
    print_body_excerpt
    bail
    ;;
esac
