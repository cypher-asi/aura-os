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
  # Mirror the production desktop sidecar
  # (apps/aura-os-desktop/src/harness/sidecar.rs:63-66): export only
  # the env vars that must win, then `exec` the harness binary which
  # calls `dotenvy::dotenv()` on startup (aura-harness/src/main.rs:49)
  # to load the rest of `aura-harness/.env`. `dotenvy::dotenv()` is
  # non-overriding, so anything we export here wins; everything we
  # don't (LLM routing, router URL, internal-service token, Tavily
  # key, enable_cmd_tools, tools.toml path) flows through unchanged
  # — exactly what the bundled desktop sidecar does.
  #
  # Earlier revisions of this branch tried to mirror the dev-fallback
  # autospawn in `apps/aura-os-server/src/app_builder/harness_autospawn.rs`
  # by exporting `BIND_ADDR` / `BIND_PORT`, but the harness's
  # `NodeConfig::from_env` reads `AURA_LISTEN_ADDR` FIRST and falls
  # back to `BIND_ADDR` only when the former is unset
  # (`aura-harness/crates/aura-runtime/src/config/mod.rs:212`). With
  # the harness's own `.env` baking `AURA_LISTEN_ADDR=127.0.0.1:8080`,
  # the autospawn-style exports always lost to the .env; the
  # production sidecar already gets this right by exporting
  # `AURA_LISTEN_ADDR` directly.
  export AURA_LISTEN_ADDR="127.0.0.1:${AURA_STACK_HARNESS_PORT}"
  # Isolate harness state to `.runtime/` instead of the per-user data
  # dir the harness defaults to — same reason the desktop sidecar
  # passes its own `AURA_DATA_DIR` (sidecar.rs:66).
  export AURA_DATA_DIR="${AURA_STACK_RUNTIME_DIR}/aura-harness-data"
  # Optional WS-slot cap forwarding — propagates the eval operator's
  # configured cap into the harness child so both ends agree on the
  # semaphore size. Matches the conditional forward in
  # `harness_autospawn.rs:93-97`.
  if [[ -n "${AURA_STACK_HARNESS_WS_SLOTS:-}" ]]; then
    export AURA_HARNESS_WS_SLOTS="$AURA_STACK_HARNESS_WS_SLOTS"
  fi

  # Forward the Cloudflare-block dump dir to the harness child.
  #
  # `render-envs.sh` writes `AURA_DEBUG_CLOUDFLARE_DUMP_DIR` into
  # `aura-os.env` because the production sidecar path autospawns the
  # harness from inside `aura-os-server` and inherits the parent env.
  # In the local-stack the harness runs as a *sibling* process started
  # by this script — no env file is sourced for the harness branch —
  # so the dump dir env var never reaches the binary, the
  # `if let Ok(dir) = std::env::var("AURA_DEBUG_CLOUDFLARE_DUMP_DIR")`
  # branch in
  # `aura-harness/crates/aura-reasoner/src/anthropic/provider.rs:217`
  # never fires, and `cloudflare-dumps/` stays empty after a CF block.
  # Exporting it here mirrors what the autospawn would have done.
  export AURA_DEBUG_CLOUDFLARE_DUMP_DIR="${AURA_STACK_RUNTIME_DIR}/cloudflare-dumps"
  mkdir -p "$AURA_DEBUG_CLOUDFLARE_DUMP_DIR"

  # Same plumbing for the LLM retry / routing knobs that
  # `render-envs.sh` writes into `aura-os.env`. The harness reads
  # them directly (see `aura-harness/crates/aura-reasoner/src/anthropic/
  # config.rs::AnthropicConfig`), so they have to be in the harness's
  # process env, not just aura-os's.
  if [[ -n "${AURA_STACK_HARNESS_LLM_MAX_RETRIES:-}" ]]; then
    export AURA_LLM_MAX_RETRIES="$AURA_STACK_HARNESS_LLM_MAX_RETRIES"
  fi
  if [[ -n "${AURA_STACK_HARNESS_LLM_ROUTING:-}" ]]; then
    export AURA_LLM_ROUTING="$AURA_STACK_HARNESS_LLM_ROUTING"
  fi

  # Stack URL overrides. AURA_OS_SERVER_URL is always re-stamped
  # because the harness .env's baked `http://127.0.0.1:3100` default
  # routes domain writes to a dead port whenever
  # AURA_STACK_AURA_OS_PORT is anything other than 3100, producing
  # the silent `domain_ok({"ok":false,...})` failure that
  # `harness_autospawn::derive_harness_url_overrides` (autospawn
  # lines 240-267) calls out. The other URLs are only forwarded when
  # this stack actually has values for them — when a service is
  # `disabled`, `stack_resolved_url` returns empty, and we leave the
  # harness .env's production default alone (matching the desktop's
  # "only emit when we have a confident value" stance).
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
