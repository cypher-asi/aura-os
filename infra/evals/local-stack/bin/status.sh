#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$script_dir/common.sh"

stack_load_env
stack_validate_modes

backend_health_url() {
  local service="$1"
  local mode url
  mode="$(stack_service_mode "$service")"
  case "$mode" in
    local)
      stack_service_health_url "$service"
      ;;
    remote)
      url="$(stack_resolved_url "$service")"
      printf '%s/health\n' "${url%/}"
      ;;
    disabled)
      printf '\n'
      ;;
  esac
}

printf '%-10s %-10s %-10s %s\n' "service" "mode" "runtime" "status"
for service in network storage orbit harness; do
  [[ -n "$service" ]] || continue
  mode="$(stack_service_mode "$service")"
  runtime="-"
  if [[ "$service" == "harness" && "$mode" == "local" ]]; then
    runtime="$AURA_STACK_HARNESS_RUNTIME"
  fi
  status="stopped"
  if [[ "$mode" == "disabled" ]]; then
    status="disabled"
  elif curl -fsS "$(backend_health_url "$service")" >/dev/null 2>&1; then
    status="ready"
  elif [[ "$mode" == "local" ]] && pid="$(stack_service_pid "$service" 2>/dev/null)" && stack_pid_is_running "$pid"; then
    status="starting"
  fi
  printf '%-10s %-10s %-10s %s\n' "$service" "$mode" "$runtime" "$status"
done

for service in aura-os frontend; do
  status="stopped"
  if curl -fsS "$(stack_service_health_url "$service")" >/dev/null 2>&1; then
    status="ready"
  elif pid="$(stack_service_pid "$service" 2>/dev/null)" && stack_pid_is_running "$pid"; then
    status="starting"
  fi
  printf '%-10s %-10s %-10s %s\n' "$service" "local" "-" "$status"
done

printf '\n%-10s %-10s %-10s %s\n' "docker" "mode" "runtime" "status"
while IFS= read -r service; do
  [[ -n "$service" ]] || continue
  status="stopped"
  if docker compose -f "$AURA_STACK_DOCKER_COMPOSE_FILE" ps --status running "$service" 2>/dev/null | tail -n +2 | grep -q .; then
    status="running"
  fi
  printf '%-10s %-10s %-10s %s\n' "$service" "local" "docker" "$status"
done < <(stack_docker_services)
