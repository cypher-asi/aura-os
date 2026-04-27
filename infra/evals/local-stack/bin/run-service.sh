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
    command=(cargo run -- run --ui none)
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
  # Match the main app's local harness behavior: route through aura-router and
  # let each SessionInit provide the user's token. Only set a process-wide
  # router JWT when the operator explicitly opts into one.
  export AURA_LLM_ROUTING="proxy"
  export AURA_ROUTER_URL="${AURA_STACK_ROUTER_URL:-https://aura-router.onrender.com}"
  export AURA_ROUTER_JWT="$AURA_STACK_AURA_ROUTER_JWT"
  export AURA_ANTHROPIC_MODEL="$AURA_STACK_ANTHROPIC_MODEL"
  export RUST_LOG="$AURA_STACK_HARNESS_LOG_LEVEL"
  mkdir -p "$AURA_DATA_DIR"
fi

cd "$workdir"
exec "${command[@]}"
