#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$script_dir/common.sh"

stack_load_env

source_base_url="${AURA_STACK_AUTH_SOURCE_URL:-http://127.0.0.1:3100}"
target_base_url="$(stack_local_url aura_os)"

if ! command -v curl >/dev/null 2>&1; then
  echo "Missing required tool: curl" >&2
  exit 1
fi

echo "Fetching access token from $source_base_url"
token_response="$(curl --silent --show-error --fail "$source_base_url/api/auth/access-token")"
access_token="$(
  printf '%s' "$token_response" | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p'
)"

if [[ -z "$access_token" ]]; then
  echo "Could not extract access_token from source response" >&2
  exit 1
fi

echo "Importing session into $target_base_url"
payload="$(printf '{"access_token":"%s"}' "$access_token")"
curl \
  --silent \
  --show-error \
  --fail \
  -H 'Content-Type: application/json' \
  -d "$payload" \
  "$target_base_url/api/auth/import-access-token" >/dev/null

echo "Validating imported session"
curl --silent --show-error --fail "$target_base_url/api/auth/session"
echo
echo "Local Aura auth bootstrap complete."
