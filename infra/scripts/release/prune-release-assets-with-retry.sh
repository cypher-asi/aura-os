#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 <repo> <tag>" >&2
  exit 2
fi

repo="$1"
tag="$2"
max_attempts="${GH_RELEASE_PRUNE_MAX_ATTEMPTS:-5}"
retry_delay="${GH_RELEASE_PRUNE_RETRY_DELAY_SECONDS:-5}"

is_retryable_error() {
  local output="$1"
  grep -Eqi 'HTTP (5[0-9]{2})|Server Error|timed out|timeout|connection reset|EOF|TLS|Temporary failure|context deadline exceeded' <<<"$output"
}

gh_api_with_retry() {
  local -a args=("$@")
  local attempt output

  for (( attempt = 1; attempt <= max_attempts; attempt += 1 )); do
    if output="$(gh api "${args[@]}" 2>&1)"; then
      printf '%s' "$output"
      return 0
    fi

    if ! is_retryable_error "$output" || [[ "$attempt" -ge "$max_attempts" ]]; then
      printf '%s\n' "$output" >&2
      return 1
    fi

    echo "Transient GitHub API failure while pruning release assets (attempt ${attempt}/${max_attempts}). Retrying in ${retry_delay}s." >&2
    sleep "$retry_delay"
  done
}

delete_release_asset() {
  local asset_id="$1"
  local endpoint="repos/${repo}/releases/assets/${asset_id}"
  local attempt output

  for (( attempt = 1; attempt <= max_attempts; attempt += 1 )); do
    if output="$(gh api --silent -X DELETE "$endpoint" 2>&1)"; then
      return 0
    fi

    if grep -Eqi 'HTTP 404|Not Found' <<<"$output"; then
      echo "Release asset ${asset_id} already disappeared; continuing." >&2
      return 0
    fi

    if ! is_retryable_error "$output" || [[ "$attempt" -ge "$max_attempts" ]]; then
      printf '%s\n' "$output" >&2
      return 1
    fi

    echo "Transient GitHub API failure while deleting release asset ${asset_id} (attempt ${attempt}/${max_attempts}). Retrying in ${retry_delay}s." >&2
    sleep "$retry_delay"
  done
}

release_id="$(gh api "repos/${repo}/releases/tags/${tag}" --jq '.id' 2>/dev/null || true)"
if [[ -z "$release_id" ]]; then
  echo "No existing ${tag} release found; nothing to prune."
  exit 0
fi

asset_ids="$(gh_api_with_retry --paginate "repos/${repo}/releases/${release_id}/assets" --jq '.[].id')"
while read -r asset_id; do
  [[ -n "$asset_id" ]] || continue
  delete_release_asset "$asset_id"
done <<<"$asset_ids"
