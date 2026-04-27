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

# Mirror the .env parser the main aura-os app uses to seed the harness
# child (apps/aura-os-server/src/app_builder/harness_autospawn.rs:181-198
# `parse_env_file` + lines 102-109 spawn loop): line by line, skip
# comments and blank lines, split on the first `=`, and ALWAYS export so
# the harness's own .env can override the spawn-stage env exports above
# it — exactly the way `cmd.env(key, val)` overwrites prior `cmd.env`
# calls in the desktop spawn. The stack URL re-exports below the call
# site re-stamp the values that must win over the .env (mirroring
# `derive_harness_url_overrides`).
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
    export "$key=$val"
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
  # Mirror apps/aura-os-server/src/app_builder/harness_autospawn.rs
  # `maybe_spawn_local_harness` exactly. The desktop sets only the
  # spawn-port env (BIND_ADDR / BIND_PORT), an optional WS-slot cap,
  # then loads the harness's own .env (which may override the
  # spawn-stage env), then layers `derive_harness_url_overrides` so
  # stack URLs win over the .env. Anything else (RUST_LOG override,
  # AURA_ANTHROPIC_MODEL pin, AURA_DEBUG_CLOUDFLARE_DUMP_DIR, the
  # AURA_STACK_HARNESS_LLM_* override block) is intentionally NOT set
  # here — the desktop never sets any of them, so the harness has no
  # opportunity to emit the symptoms (verbose tool_call_snapshot
  # stream, cf-block-*.html disk fill, model pinning, retry-storm
  # debug WARNs) that those env vars unlock.

  # Stage 1: spawn-port env — mirrors harness_autospawn.rs:76-77.
  export BIND_ADDR="127.0.0.1:${AURA_STACK_HARNESS_PORT}"
  export BIND_PORT="${AURA_STACK_HARNESS_PORT}"
  # Eval-only addition: AURA_DATA_DIR isolates harness state to the
  # `.runtime/` runtime dir instead of the per-user data dir the
  # desktop binary defaults to. The desktop IS the user, so its
  # default is correct there; we cannot share that state across eval
  # runs without contaminating the user's main aura install.
  export AURA_DATA_DIR="${AURA_STACK_RUNTIME_DIR}/aura-harness-data"
  # Optional WS-slot cap forwarding — mirrors autospawn lines 93-97.
  if [[ -n "${AURA_STACK_HARNESS_WS_SLOTS:-}" ]]; then
    export AURA_HARNESS_WS_SLOTS="$AURA_STACK_HARNESS_WS_SLOTS"
  fi

  # Stage 2: load harness's own .env. Mirrors autospawn lines
  # 102-109: `parse_env_file` + per-pair `cmd.env(key, val)` so .env
  # entries OVERRIDE the spawn-stage env. `_load_harness_dotenv` was
  # updated to be overriding for this reason. This is what picks up
  # AURA_LLM_ROUTING, AURA_ROUTER_URL, INTERNAL_SERVICE_TOKEN,
  # TAVILY_API_KEY, ENABLE_CMD_TOOLS, TOOLS_CONFIG, etc. — exactly
  # the same set the desktop autospawn picks up.
  _load_harness_dotenv "$workdir/.env"

  # Stage 3: stack URL re-overrides — mirrors
  # `derive_harness_url_overrides` (autospawn lines 240-267). Stack
  # URLs win over harness .env. AURA_OS_SERVER_URL is always
  # re-stamped because the harness .env's baked `:3100` default
  # routes domain writes to a dead port whenever
  # AURA_STACK_AURA_OS_PORT is anything other than 3100, producing
  # the silent `domain_ok({"ok":false,...})` failure the autospawn
  # comment block warns about. The other URLs are only re-exported
  # when this stack actually has a value for them — when a service
  # is `disabled`, `stack_resolved_url` returns empty, and we leave
  # the harness .env's production default alone (matching the
  # desktop's "only emit when we have a confident value" stance).
  export AURA_OS_SERVER_URL="$(stack_local_url aura_os)"
  network_url="$(stack_resolved_url network)"
  if [[ -n "$network_url" ]]; then
    export AURA_NETWORK_URL="$network_url"
  fi
  storage_url="$(stack_resolved_url storage)"
  if [[ -n "$storage_url" ]]; then
    export AURA_STORAGE_URL="$storage_url"
  fi
  orbit_url="$(stack_resolved_url orbit)"
  if [[ -n "$orbit_url" ]]; then
    export ORBIT_URL="$orbit_url"
  fi

  mkdir -p "$AURA_DATA_DIR"
fi

cd "$workdir"
exec "${command[@]}"
