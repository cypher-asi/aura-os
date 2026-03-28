#!/usr/bin/env bash

set -euo pipefail

stack__script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
stack__local_stack_dir="$(cd "$stack__script_dir/.." && pwd)"
stack__repo_root="$(cd "$stack__local_stack_dir/../.." && pwd)"
stack__workspace_root="$(cd "$stack__repo_root/.." && pwd)"

stack_load_env() {
  local env_file="${AURA_STACK_ENV_FILE:-$stack__local_stack_dir/stack.env}"

  if [[ -f "$env_file" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$env_file"
    set +a
  fi

  export AURA_STACK_LOCAL_STACK_DIR="${AURA_STACK_LOCAL_STACK_DIR:-$stack__local_stack_dir}"
  export AURA_STACK_REPO_ROOT="${AURA_STACK_REPO_ROOT:-$stack__repo_root}"
  export AURA_STACK_WORKSPACE_ROOT="${AURA_STACK_WORKSPACE_ROOT:-$stack__workspace_root}"
  export AURA_STACK_RUNTIME_DIR="${AURA_STACK_RUNTIME_DIR:-$AURA_STACK_LOCAL_STACK_DIR/.runtime}"

  export AURA_STACK_NETWORK_DIR="${AURA_STACK_NETWORK_DIR:-$AURA_STACK_WORKSPACE_ROOT/aura-network}"
  export AURA_STACK_STORAGE_DIR="${AURA_STACK_STORAGE_DIR:-$AURA_STACK_WORKSPACE_ROOT/aura-storage}"
  export AURA_STACK_ORBIT_DIR="${AURA_STACK_ORBIT_DIR:-$AURA_STACK_WORKSPACE_ROOT/orbit}"
  export AURA_STACK_HARNESS_DIR="${AURA_STACK_HARNESS_DIR:-$AURA_STACK_WORKSPACE_ROOT/aura-harness}"

  export AURA_STACK_NETWORK_MODE="${AURA_STACK_NETWORK_MODE:-local}"
  export AURA_STACK_STORAGE_MODE="${AURA_STACK_STORAGE_MODE:-local}"
  export AURA_STACK_ORBIT_MODE="${AURA_STACK_ORBIT_MODE:-local}"
  export AURA_STACK_HARNESS_MODE="${AURA_STACK_HARNESS_MODE:-local}"

  export AURA_STACK_REMOTE_NETWORK_URL="${AURA_STACK_REMOTE_NETWORK_URL:-}"
  export AURA_STACK_REMOTE_STORAGE_URL="${AURA_STACK_REMOTE_STORAGE_URL:-}"
  export AURA_STACK_REMOTE_ORBIT_URL="${AURA_STACK_REMOTE_ORBIT_URL:-}"
  export AURA_STACK_REMOTE_HARNESS_URL="${AURA_STACK_REMOTE_HARNESS_URL:-}"

  export AURA_STACK_NETWORK_PORT="${AURA_STACK_NETWORK_PORT:-3401}"
  export AURA_STACK_STORAGE_PORT="${AURA_STACK_STORAGE_PORT:-3402}"
  export AURA_STACK_ORBIT_PORT="${AURA_STACK_ORBIT_PORT:-3403}"
  export AURA_STACK_HARNESS_PORT="${AURA_STACK_HARNESS_PORT:-3404}"
  export AURA_STACK_AURA_OS_PORT="${AURA_STACK_AURA_OS_PORT:-3190}"
  export AURA_STACK_FRONTEND_PORT="${AURA_STACK_FRONTEND_PORT:-4173}"

  export AURA_STACK_NETWORK_DB_PORT="${AURA_STACK_NETWORK_DB_PORT:-5441}"
  export AURA_STACK_STORAGE_DB_PORT="${AURA_STACK_STORAGE_DB_PORT:-5442}"
  export AURA_STACK_ORBIT_DB_PORT="${AURA_STACK_ORBIT_DB_PORT:-5443}"

  export AURA_STACK_AUTH0_DOMAIN="${AURA_STACK_AUTH0_DOMAIN:-auth.zero.tech}"
  export AURA_STACK_NETWORK_AUDIENCE="${AURA_STACK_NETWORK_AUDIENCE:-aura-network}"
  export AURA_STACK_STORAGE_AUDIENCE="${AURA_STACK_STORAGE_AUDIENCE:-aura-storage}"
  export AURA_STACK_ORBIT_AUDIENCE="${AURA_STACK_ORBIT_AUDIENCE:-orbit}"
  export AURA_STACK_AUTH_COOKIE_SECRET="${AURA_STACK_AUTH_COOKIE_SECRET:-}"
  export AURA_STACK_INTERNAL_SERVICE_TOKEN="${AURA_STACK_INTERNAL_SERVICE_TOKEN:-aura-local-internal-token}"
  export AURA_STACK_ZOS_API_URL="${AURA_STACK_ZOS_API_URL:-https://zosapi.zero.tech}"
  export AURA_STACK_ZOS_API_INTERNAL_TOKEN="${AURA_STACK_ZOS_API_INTERNAL_TOKEN:-}"
  export AURA_STACK_ROUTER_URL="${AURA_STACK_ROUTER_URL:-https://aura-router.onrender.com}"
  export AURA_STACK_BILLING_URL="${AURA_STACK_BILLING_URL:-https://z-billing.onrender.com}"
  export AURA_STACK_CORS_ORIGINS="${AURA_STACK_CORS_ORIGINS:-http://127.0.0.1:${AURA_STACK_FRONTEND_PORT},http://localhost:${AURA_STACK_FRONTEND_PORT}}"

  export AURA_STACK_NETWORK_LOG_LEVEL="${AURA_STACK_NETWORK_LOG_LEVEL:-info}"
  export AURA_STACK_STORAGE_LOG_LEVEL="${AURA_STACK_STORAGE_LOG_LEVEL:-info}"
  export AURA_STACK_ORBIT_LOG_LEVEL="${AURA_STACK_ORBIT_LOG_LEVEL:-info}"
  export AURA_STACK_HARNESS_LOG_LEVEL="${AURA_STACK_HARNESS_LOG_LEVEL:-info}"

  export AURA_STACK_HARNESS_LLM_ROUTING="${AURA_STACK_HARNESS_LLM_ROUTING:-proxy}"
  export AURA_STACK_HARNESS_ENABLE_CMD_TOOLS="${AURA_STACK_HARNESS_ENABLE_CMD_TOOLS:-true}"
  export AURA_STACK_HARNESS_ALLOWED_COMMANDS="${AURA_STACK_HARNESS_ALLOWED_COMMANDS:-npm,node,npx,pnpm,bun,cargo,python,python3,pytest,go,git}"
  export AURA_STACK_AURA_ROUTER_JWT="${AURA_STACK_AURA_ROUTER_JWT:-}"
  export AURA_STACK_ANTHROPIC_API_KEY="${AURA_STACK_ANTHROPIC_API_KEY:-}"
  export AURA_STACK_ANTHROPIC_MODEL="${AURA_STACK_ANTHROPIC_MODEL:-claude-opus-4-6}"
  export AURA_STACK_AURA_OS_DATA_DIR="${AURA_STACK_AURA_OS_DATA_DIR:-$AURA_STACK_RUNTIME_DIR/aura-app}"

  export AURA_STACK_EVAL_BASE_URL="${AURA_STACK_EVAL_BASE_URL:-http://127.0.0.1:${AURA_STACK_FRONTEND_PORT}}"
  export AURA_STACK_EVAL_BUNDLE_ID="${AURA_STACK_EVAL_BUNDLE_ID:-local-stack}"

  export AURA_STACK_ORBIT_GIT_STORAGE_ROOT="${AURA_STACK_ORBIT_GIT_STORAGE_ROOT:-$AURA_STACK_RUNTIME_DIR/orbit/repos}"
  export AURA_STACK_DOCKER_COMPOSE_FILE="${AURA_STACK_DOCKER_COMPOSE_FILE:-$AURA_STACK_LOCAL_STACK_DIR/docker-compose.yml}"
}

stack_assert_mode() {
  local value="$1"
  local name="$2"
  case "$value" in
    local|remote|disabled) ;;
    *)
      echo "Invalid ${name}: ${value}. Expected local, remote, or disabled." >&2
      exit 1
      ;;
  esac
}

stack_validate_modes() {
  stack_assert_mode "$AURA_STACK_NETWORK_MODE" "AURA_STACK_NETWORK_MODE"
  stack_assert_mode "$AURA_STACK_STORAGE_MODE" "AURA_STACK_STORAGE_MODE"
  stack_assert_mode "$AURA_STACK_ORBIT_MODE" "AURA_STACK_ORBIT_MODE"
  stack_assert_mode "$AURA_STACK_HARNESS_MODE" "AURA_STACK_HARNESS_MODE"
}

stack_service_mode() {
  local service="$1"
  case "$service" in
    network) printf '%s\n' "$AURA_STACK_NETWORK_MODE" ;;
    storage) printf '%s\n' "$AURA_STACK_STORAGE_MODE" ;;
    orbit) printf '%s\n' "$AURA_STACK_ORBIT_MODE" ;;
    harness) printf '%s\n' "$AURA_STACK_HARNESS_MODE" ;;
    *)
      echo "Unknown service: $service" >&2
      exit 1
      ;;
  esac
}

stack_service_dir() {
  local service="$1"
  case "$service" in
    network) printf '%s\n' "$AURA_STACK_NETWORK_DIR" ;;
    storage) printf '%s\n' "$AURA_STACK_STORAGE_DIR" ;;
    orbit) printf '%s\n' "$AURA_STACK_ORBIT_DIR" ;;
    harness) printf '%s\n' "$AURA_STACK_HARNESS_DIR" ;;
    aura-os) printf '%s\n' "$AURA_STACK_REPO_ROOT" ;;
    frontend) printf '%s\n' "$AURA_STACK_REPO_ROOT/frontend" ;;
    *)
      echo "Unknown service: $service" >&2
      exit 1
      ;;
  esac
}

stack_local_url() {
  local service="$1"
  case "$service" in
    aura_os) printf 'http://127.0.0.1:%s\n' "$AURA_STACK_AURA_OS_PORT" ;;
    network) printf 'http://127.0.0.1:%s\n' "$AURA_STACK_NETWORK_PORT" ;;
    storage) printf 'http://127.0.0.1:%s\n' "$AURA_STACK_STORAGE_PORT" ;;
    orbit) printf 'http://127.0.0.1:%s\n' "$AURA_STACK_ORBIT_PORT" ;;
    harness) printf 'http://127.0.0.1:%s\n' "$AURA_STACK_HARNESS_PORT" ;;
    *)
      echo "Unknown service: $service" >&2
      exit 1
      ;;
  esac
}

stack_remote_url() {
  local service="$1"
  case "$service" in
    network) printf '%s\n' "$AURA_STACK_REMOTE_NETWORK_URL" ;;
    storage) printf '%s\n' "$AURA_STACK_REMOTE_STORAGE_URL" ;;
    orbit) printf '%s\n' "$AURA_STACK_REMOTE_ORBIT_URL" ;;
    harness) printf '%s\n' "$AURA_STACK_REMOTE_HARNESS_URL" ;;
    *)
      echo "Unknown service: $service" >&2
      exit 1
      ;;
  esac
}

stack_resolved_url() {
  local service="$1"
  local mode
  mode="$(stack_service_mode "$service")"
  case "$mode" in
    local) stack_local_url "$service" ;;
    remote) stack_remote_url "$service" ;;
    disabled) printf '\n' ;;
  esac
}

stack_is_local() {
  [[ "$(stack_service_mode "$1")" == "local" ]]
}

stack_require_dir_if_local() {
  local service="$1"
  if ! stack_is_local "$service"; then
    return 0
  fi
  local dir
  dir="$(stack_service_dir "$service")"
  if [[ ! -d "$dir" ]]; then
    echo "Missing local repo for ${service}: ${dir}" >&2
    exit 1
  fi
}

stack_has_any_local_auth_service() {
  stack_is_local network || stack_is_local storage || stack_is_local orbit
}

stack_warn_if_missing_auth_secret() {
  if stack_has_any_local_auth_service && [[ -z "$AURA_STACK_AUTH_COOKIE_SECRET" ]]; then
    echo "Warning: AURA_STACK_AUTH_COOKIE_SECRET is empty. Local auth-backed services will reject Aura login tokens until you set it." >&2
  fi
}

stack_mkdir_runtime() {
  mkdir -p "$AURA_STACK_RUNTIME_DIR"
  mkdir -p "$AURA_STACK_RUNTIME_DIR/orbit/repos"
  mkdir -p "$AURA_STACK_AURA_OS_DATA_DIR"
}

stack_check_command() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd" >&2
    exit 1
  fi
}

stack_docker_services() {
  local services=()
  if stack_is_local network; then
    services+=("aura-network-db")
  fi
  if stack_is_local storage; then
    services+=("aura-storage-db")
  fi
  if stack_is_local orbit; then
    services+=("orbit-db")
  fi
  if stack_is_local harness; then
    services+=("aura-harness")
  fi
  printf '%s\n' "${services[@]}"
}

stack_print_service_matrix() {
  local service mode url
  for service in network storage orbit harness; do
    mode="$(stack_service_mode "$service")"
    url="$(stack_resolved_url "$service")"
    if [[ -z "$url" ]]; then
      url="disabled"
    fi
    printf '%-8s  %-8s  %s\n' "$service" "$mode" "$url"
  done
}
