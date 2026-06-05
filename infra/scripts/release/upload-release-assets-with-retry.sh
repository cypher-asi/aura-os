#!/usr/bin/env bash
set -euo pipefail

# Reconcile a GitHub release so it contains every expected artifact, retrying
# transient upload failures (e.g. "other side closed", EPIPE, ECONNRESET) that
# regularly cause softprops/action-gh-release to drop one stream in a parallel
# upload batch. The script is idempotent: it only uploads files that are
# missing or whose remote size does not match the local file, using
# `gh release upload --clobber`.

dry_run=0
if [[ "${1:-}" == "--dry-run" ]]; then
  dry_run=1
  shift
fi

if [[ $# -ne 3 ]]; then
  echo "Usage: $0 [--dry-run] <repo> <tag> <source-dir>" >&2
  exit 2
fi

repo="$1"
tag="$2"
source_dir="$3"

if [[ ! -d "$source_dir" ]]; then
  echo "Source directory '$source_dir' does not exist." >&2
  exit 2
fi

max_attempts="${GH_RELEASE_UPLOAD_MAX_ATTEMPTS:-5}"
retry_delay="${GH_RELEASE_UPLOAD_RETRY_DELAY_SECONDS:-10}"

is_retryable_error() {
  local output="$1"
  grep -Eqi \
    'HTTP (5[0-9]{2})|Server Error|timed out|timeout|connection reset|ECONNRESET|EPIPE|broken pipe|other side closed|stream closed|unexpected EOF|EOF|TLS|Temporary failure|context deadline exceeded' \
    <<<"$output"
}

local_size() {
  local file="$1"
  if [[ "$(uname)" == "Darwin" ]]; then
    stat -f '%z' "$file"
  else
    stat -c '%s' "$file"
  fi
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

    echo "Transient GitHub API failure listing release (attempt ${attempt}/${max_attempts}). Retrying in ${retry_delay}s." >&2
    sleep "$retry_delay"
  done
}

upload_asset_with_retry() {
  local file="$1"
  local attempt output

  for (( attempt = 1; attempt <= max_attempts; attempt += 1 )); do
    if output="$(gh release upload "$tag" "$file" --clobber --repo "$repo" 2>&1)"; then
      echo "Reconciled upload of $(basename "$file")."
      return 0
    fi

    if ! is_retryable_error "$output" || [[ "$attempt" -ge "$max_attempts" ]]; then
      printf '%s\n' "$output" >&2
      return 1
    fi

    echo "Transient GitHub upload failure for $(basename "$file") (attempt ${attempt}/${max_attempts}). Retrying in ${retry_delay}s." >&2
    sleep "$retry_delay"
  done
}

if (( dry_run == 1 )); then
  manifest="$(mktemp)"
  trap 'rm -f "$manifest"' EXIT
  count=0
  while IFS= read -r -d '' file; do
    name="$(basename "$file")"
    printf '%s\t%s\t%s\n' "$name" "$(local_size "$file")" "$file" >> "$manifest"
    count=$(( count + 1 ))
  done < <(find "$source_dir" -type f -print0)

  if (( count == 0 )); then
    echo "No local files under ${source_dir}; nothing to reconcile."
    exit 0
  fi

  duplicates="$(cut -f1 "$manifest" | sort | uniq -d || true)"
  if [[ -n "$duplicates" ]]; then
    echo "Refusing to reconcile: duplicate asset basenames detected under ${source_dir}:" >&2
    while read -r name; do
      [[ -n "$name" ]] || continue
      printf '  %s\n' "$name" >&2
    done <<<"$duplicates"
    exit 2
  fi

  echo "Dry run: would reconcile ${count} asset(s) on release ${tag} in ${repo}."
  sort "$manifest" | while IFS=$'\t' read -r name size _file; do
    printf '  %s (%s bytes)\n' "$name" "$size"
  done
  exit 0
fi

declare -A local_files=()
declare -A duplicates=()
while IFS= read -r -d '' file; do
  name="$(basename "$file")"
  if [[ -n "${local_files[$name]:-}" ]]; then
    duplicates[$name]="${local_files[$name]} <-> ${file}"
  fi
  local_files[$name]="$file"
done < <(find "$source_dir" -type f -print0)

if (( ${#duplicates[@]} > 0 )); then
  echo "Refusing to reconcile: duplicate asset basenames detected under ${source_dir}:" >&2
  for name in "${!duplicates[@]}"; do
    printf '  %s: %s\n' "$name" "${duplicates[$name]}" >&2
  done
  exit 2
fi

if (( ${#local_files[@]} == 0 )); then
  echo "No local files under ${source_dir}; nothing to reconcile."
  exit 0
fi

release_id="$(gh api "repos/${repo}/releases/tags/${tag}" --jq '.id' 2>/dev/null || true)"
if [[ -z "$release_id" ]]; then
  echo "No release found for tag ${tag}; cannot reconcile assets." >&2
  exit 1
fi

declare -A remote_sizes=()
remote_listing="$(gh_api_with_retry --paginate "repos/${repo}/releases/${release_id}/assets" --jq '.[] | "\(.name)\t\(.size)"')"
while IFS=$'\t' read -r name size; do
  [[ -n "$name" ]] || continue
  remote_sizes[$name]="$size"
done <<<"$remote_listing"

missing=()
for name in "${!local_files[@]}"; do
  file="${local_files[$name]}"
  expected="$(local_size "$file")"
  actual="${remote_sizes[$name]:-}"
  if [[ -z "$actual" ]]; then
    echo "Missing on release: ${name}"
    missing+=("$file")
  elif [[ "$actual" != "$expected" ]]; then
    echo "Size mismatch for ${name} (remote=${actual} local=${expected}); will re-upload."
    missing+=("$file")
  fi
done

if (( ${#missing[@]} == 0 )); then
  echo "Release ${tag} already contains every expected asset (${#local_files[@]} files)."
  exit 0
fi

echo "Reconciling ${#missing[@]} asset(s) on release ${tag}."
upload_errors=0
for file in "${missing[@]}"; do
  if ! upload_asset_with_retry "$file"; then
    upload_errors=$(( upload_errors + 1 ))
    echo "Could not upload $(basename "$file") after ${max_attempts} attempts; will keep trying others." >&2
  fi
done

declare -A verify_sizes=()
verify_listing="$(gh_api_with_retry --paginate "repos/${repo}/releases/${release_id}/assets" --jq '.[] | "\(.name)\t\(.size)"')"
while IFS=$'\t' read -r name size; do
  [[ -n "$name" ]] || continue
  verify_sizes[$name]="$size"
done <<<"$verify_listing"

still_missing=()
for name in "${!local_files[@]}"; do
  file="${local_files[$name]}"
  expected="$(local_size "$file")"
  actual="${verify_sizes[$name]:-}"
  if [[ -z "$actual" || "$actual" != "$expected" ]]; then
    still_missing+=("$name")
  fi
done

if (( ${#still_missing[@]} > 0 )); then
  echo "Release reconcile failed after ${max_attempts} attempts; still missing or mismatched:" >&2
  for name in "${still_missing[@]}"; do
    printf '  %s\n' "$name" >&2
  done
  exit 1
fi

if (( upload_errors > 0 )); then
  echo "Reconcile reported ${upload_errors} upload error(s) but verification shows all assets present; continuing." >&2
fi

echo "Verified all ${#local_files[@]} expected asset(s) present on release ${tag}."
