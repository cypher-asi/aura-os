#!/usr/bin/env bash

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <network|storage|orbit|harness|aura-os|frontend>" >&2
  exit 1
fi

service="$1"
script_dir="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$script_dir/common.sh"

stack_load_env
stack_validate_modes

# Mirror the .env parser the main aura-os app uses to seed the harness child
# (apps/aura-os-server/src/app_builder/harness_autospawn.rs:181-198): line by
# line, skip comments and blank lines, split on the first `=`, only export
# keys that are not already set in the current environment so explicit
# stack-level exports continue to win for stack-specific overrides like
# AURA_OS_SERVER_URL, AURA_LISTEN_ADDR, AURA_DATA_DIR, etc.
_load_harness_dotenv() {
  local env_file="$1"
  [[ -f "$env_file" ]] || return 0
  local line key val
  while IFS= read -r line || [[ -n "$line" ]]; do
    case "$line" in
      ''|\#*) continue ;;
    esac
    if [[ "$line" != *=* ]]; then
      continue
    fi
    key="${line%%=*}"
    val="${line#*=}"
    # Trim leading/trailing whitespace from key.
    key="${key#"${key%%[![:space:]]*}"}"
    key="${key%"${key##*[![:space:]]}"}"
    if [[ -z "$key" || -z "$val" ]]; then
      continue
    fi
    if [[ -z "${!key:-}" ]]; then
      export "$key=$val"
    fi
  done < "$env_file"
}

if [[ ! -d "$AURA_STACK_RUNTIME_DIR" ]]; then
  "$script_dir/render-envs.sh"
fi

runtime_env=""
workdir=""
case "$service" in
  network)
    if ! stack_is_local network; then
      echo "network is not in local mode." >&2
      exit 1
    fi
    runtime_env="$AURA_STACK_RUNTIME_DIR/aura-network.env"
    workdir="$(stack_service_dir network)"
    command=(cargo run -p aura-network-server)
    ;;
  storage)
    if ! stack_is_local storage; then
      echo "storage is not in local mode." >&2
      exit 1
    fi
    runtime_env="$AURA_STACK_RUNTIME_DIR/aura-storage.env"
    workdir="$(stack_service_dir storage)"
    command=(cargo run -p aura-storage-server)
    ;;
  orbit)
    if ! stack_is_local orbit; then
      echo "orbit is not in local mode." >&2
      exit 1
    fi
    runtime_env="$AURA_STACK_RUNTIME_DIR/orbit.env"
    workdir="$(stack_service_dir orbit)"
    command=(cargo run)
    ;;
  harness)
    if ! stack_is_local harness; then
      echo "harness is not in local mode." >&2
      exit 1
    fi
    workdir="$(stack_service_dir harness)"
    # Mirror harness_autospawn.rs: aura-os main app spawns the harness with
    # `--release` (apps/aura-os-server/src/app_builder/harness_autospawn.rs:74).
    # Set AURA_STACK_HARNESS_BUILD_PROFILE=debug to opt out for faster
    # iteration during stack development.
    if [[ "${AURA_STACK_HARNESS_BUILD_PROFILE:-release}" == "release" ]]; then
      command=(cargo run --release -- run --ui none)
    else
      command=(cargo run -- run --ui none)
    fi
    ;;
  aura-os)
    runtime_env="$AURA_STACK_RUNTIME_DIR/aura-os.env"
    workdir="$(stack_service_dir aura-os)"
    command=(cargo run -p aura-os-server --bin aura-os-server)
    ;;
  frontend)
    runtime_env="$AURA_STACK_RUNTIME_DIR/aura-os.env"
    workdir="$(stack_service_dir frontend)"
    command=(npm run dev -- --host 127.0.0.1 --port "$AURA_STACK_FRONTEND_PORT")
    ;;
  *)
    echo "Unknown service: $service" >&2
    exit 1
    ;;
esac

if [[ -n "$runtime_env" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$runtime_env"
  set +a
fi

if [[ "$service" == "harness" ]]; then
  # Stack-owned settings: control-plane URLs, listen addr, data dir. These
  # MUST win over whatever aura-harness/.env says, so we export them first
  # and rely on `_load_harness_dotenv`'s "skip if already set" semantics.
  export AURA_LISTEN_ADDR="127.0.0.1:${AURA_STACK_HARNESS_PORT}"
  export AURA_DATA_DIR="${AURA_STACK_RUNTIME_DIR}/aura-harness-data"
  export AURA_NETWORK_URL="$(stack_resolved_url network)"
  export AURA_STORAGE_URL="$(stack_resolved_url storage)"
  export ORBIT_URL="$(stack_resolved_url orbit)"
  # Point the harness at THIS stack's aura-os-server. The harness's `.env`
  # ships with `AURA_OS_SERVER_URL=http://127.0.0.1:3100`, which silently
  # routes spec/task/log writes from `HttpDomainApi` to a dead port whenever
  # the local stack runs on its default `:3190` (or any other configured
  # port). The failed POST gets wrapped in a `domain_ok({"ok":false,...})`
  # envelope with `is_error=false`, so the LLM perceives it as a soft
  # failure and loops `list_specs` ↔ `create_spec` until `max_turns`. The
  # surface symptom is `[preflight] FAIL list_specs ... returned 0 specs`
  # after an apparently-successful spec_stream.
  export AURA_OS_SERVER_URL="$(stack_local_url aura_os)"
  export RUST_LOG="$AURA_STACK_HARNESS_LOG_LEVEL"
  # Eval pipeline pins a model regardless of LLM routing; harness `.env`
  # leaves it commented out, so we always set it.
  export AURA_ANTHROPIC_MODEL="$AURA_STACK_ANTHROPIC_MODEL"
  # Diagnostic: when the LLM proxy returns a Cloudflare HTML challenge, the
  # harness writes the full body to this dir so we can identify *which* edge
  # blocked (Render's Cloudflare on inbound vs upstream Anthropic Cloudflare
  # passed through aura-router). Cheap to keep on; the file is only written
  # on the rare 403 + cloudflare_html=true path.
  export AURA_DEBUG_CLOUDFLARE_DUMP_DIR="${AURA_STACK_RUNTIME_DIR}/cloudflare-dumps"

  # Mirror harness_autospawn.rs: read aura-harness/.env and merge any keys
  # not already set, picking up AURA_LLM_ROUTING, AURA_ROUTER_URL,
  # INTERNAL_SERVICE_TOKEN, TAVILY_API_KEY, ENABLE_CMD_TOOLS, TOOLS_CONFIG,
  # etc. The harness binary also runs `dotenvy::dotenv()` from cwd, but it
  # is non-overriding and only sees this same file — doing it here makes
  # the stack flow explicit and matches what `harness_autospawn.rs` does
  # before spawning the desktop's local harness child. By default this
  # leaves LLM routing identical to the desktop's local harness path:
  # proxy → aura-router using the per-session token sent by aura-os-server.
  _load_harness_dotenv "$workdir/.env"

  # --- Optional stack-level overrides for LLM routing ---------------------
  # The desktop autospawn flow does NOT override any of these — it inherits
  # whatever the harness's `.env` configured. We follow that by default.
  # When CF on aura-router persistently rule-blocks the eval host, set
  # AURA_STACK_HARNESS_LLM_ROUTING=direct + AURA_STACK_ANTHROPIC_API_KEY in
  # stack.env to bypass the router for this run only. See stack.env.example
  # for the full escape-valve recipe.
  if [[ -n "${AURA_STACK_HARNESS_LLM_ROUTING:-}" ]]; then
    export AURA_LLM_ROUTING="$AURA_STACK_HARNESS_LLM_ROUTING"
  fi
  if [[ -n "${AURA_STACK_ROUTER_URL:-}" ]]; then
    export AURA_ROUTER_URL="$AURA_STACK_ROUTER_URL"
  fi
  if [[ -n "${AURA_STACK_ANTHROPIC_API_KEY:-}" ]]; then
    export AURA_ANTHROPIC_API_KEY="$AURA_STACK_ANTHROPIC_API_KEY"
  fi
  # Only export AURA_ROUTER_JWT when explicitly set. Exporting an empty
  # string short-circuits `aura_agent::session_bootstrap::load_auth_token`'s
  # CredentialStore fallback (it returns `Some("")` instead of `None`),
  # which sends an empty `Bearer ` to aura-router and triggers an upstream
  # Cloudflare HTML 403 on the proxy → Anthropic hop. The IDE flow leaves
  # this unset; we match that.
  if [[ -n "${AURA_STACK_AURA_ROUTER_JWT:-}" ]]; then
    export AURA_ROUTER_JWT="$AURA_STACK_AURA_ROUTER_JWT"
  fi
  # Optional knob to throttle the harness's CloudflareBlock retry storm.
  # `aura-reasoner/src/anthropic/config.rs` reads AURA_LLM_MAX_RETRIES from
  # env (default 8). When the WAF on aura-router rule-blocks the eval IP,
  # eight retries with exponential backoff (250ms→30s) compound the block
  # for tens of minutes per tool call. Set this to 1 or 2 in stack.env when
  # the eval host trips the WAF.
  if [[ -n "${AURA_STACK_HARNESS_LLM_MAX_RETRIES:-}" ]]; then
    export AURA_LLM_MAX_RETRIES="$AURA_STACK_HARNESS_LLM_MAX_RETRIES"
  fi

  mkdir -p "$AURA_DATA_DIR"
fi

cd "$workdir"
exec "${command[@]}"
