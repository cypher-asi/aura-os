#!/usr/bin/env bash

set -euo pipefail

# When launched as an absolute Git-for-Windows bash.exe from PowerShell, PATH may
# not include the Unix helper directory that contains dirname/sed/curl.
PATH="/usr/bin:/bin:$PATH"
export PATH

script_dir="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$script_dir/common.sh"

stack_load_env

target_base_url="$(stack_local_url aura_os)"
source_base_url="${AURA_STACK_AUTH_SOURCE_URL:-http://127.0.0.1:3100}"
auth_env_file="$AURA_STACK_RUNTIME_DIR/auth.env"

default_aura_data_dir() {
  case "$(uname -s 2>/dev/null || printf unknown)" in
    MINGW*|MSYS*|CYGWIN*)
      if [[ -n "${LOCALAPPDATA:-}" ]]; then
        if command -v cygpath >/dev/null 2>&1; then
          cygpath -u "$LOCALAPPDATA/aura"
        else
          printf '%s/aura\n' "$LOCALAPPDATA"
        fi
        return 0
      fi
      ;;
    Darwin*)
      printf '%s/Library/Application Support/aura\n' "$HOME"
      return 0
      ;;
  esac

  if [[ -n "${XDG_DATA_HOME:-}" ]]; then
    printf '%s/aura\n' "$XDG_DATA_HOME"
  else
    printf '%s/.local/share/aura\n' "$HOME"
  fi
}

source_data_dir="${AURA_STACK_AUTH_SOURCE_DATA_DIR:-$(default_aura_data_dir)}"

is_local_dev_jwt() {
  case "$1" in
    eyJhbGciOiJIUzI1Ni*) return 0 ;;
    *) return 1 ;;
  esac
}

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

login_with_credentials() {
  if [[ -z "${AURA_EVAL_USER_EMAIL:-}" || -z "${AURA_EVAL_USER_PASSWORD:-}" ]]; then
    return 1
  fi

  email="$(json_escape "$AURA_EVAL_USER_EMAIL")"
  password="$(json_escape "$AURA_EVAL_USER_PASSWORD")"
  payload="$(printf '{"email":"%s","password":"%s"}' "$email" "$password")"
  login_response="$(
    curl \
      --silent \
      --show-error \
      --fail \
      -H 'Content-Type: application/json' \
      -d "$payload" \
      "$target_base_url/api/auth/login"
  )" || return 1

  token="$(
    printf '%s' "$login_response" | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p'
  )"
  if [[ -z "$token" ]]; then
    return 1
  fi
  printf '%s\n' "$token"
}

resolve_source_access_token() {
  if [[ -n "${AURA_STACK_SOURCE_ACCESS_TOKEN:-}" ]]; then
    printf '%s\n' "$AURA_STACK_SOURCE_ACCESS_TOKEN"
    return 0
  fi

  if [[ -d "$source_data_dir" ]]; then
    if token="$(cargo run -q -p aura-os-server --bin print-auth-token -- "$source_data_dir" 2>/dev/null)"; then
      if [[ -n "$token" ]]; then
        printf '%s\n' "$token"
        return 0
      fi
    fi
  fi

  if token_response="$(curl --silent --show-error --fail "$source_base_url/api/auth/access-token" 2>/dev/null)"; then
    token="$(
      printf '%s' "$token_response" | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p'
    )"
    if [[ -n "$token" ]]; then
      printf '%s\n' "$token"
      return 0
    fi
  fi

  if [[ "${AURA_STACK_ALLOW_ENV_SOURCE_TOKEN:-}" == "1" ]]; then
    if [[ -n "${AURA_EVAL_ACCESS_TOKEN:-}" ]]; then
      printf '%s\n' "$AURA_EVAL_ACCESS_TOKEN"
      return 0
    fi

    if [[ -n "${AURA_ACCESS_TOKEN:-}" ]]; then
      printf '%s\n' "$AURA_ACCESS_TOKEN"
      return 0
    fi

    if [[ -n "${AURA_NETWORK_AUTH_TOKEN:-}" ]]; then
      printf '%s\n' "$AURA_NETWORK_AUTH_TOKEN"
      return 0
    fi
  fi

  return 1
}

if [[ "${1:-}" == "--check" ]]; then
  if resolve_source_access_token >/dev/null || [[ -n "${AURA_EVAL_USER_EMAIL:-}" && -n "${AURA_EVAL_USER_PASSWORD:-}" ]]; then
    exit 0
  fi
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "Missing required tool: curl" >&2
  exit 1
fi

echo "Resolving source auth token"
if ! access_token="$(resolve_source_access_token)"; then
  echo "No source token found; attempting zOS login via $target_base_url/api/auth/login"
  if ! access_token="$(login_with_credentials)"; then
    echo "Could not resolve a source Aura auth token or log in with credentials." >&2
    echo "Checked, in order:" >&2
    echo "  1. AURA_STACK_SOURCE_ACCESS_TOKEN" >&2
    echo "  2. persisted session in $source_data_dir" >&2
    echo "  3. legacy endpoint at $source_base_url/api/auth/access-token" >&2
    echo "  4. env token aliases only when AURA_STACK_ALLOW_ENV_SOURCE_TOKEN=1" >&2
    echo "  5. AURA_EVAL_USER_EMAIL / AURA_EVAL_USER_PASSWORD via /api/auth/login" >&2
    exit 1
  fi
fi

if [[ -z "$access_token" ]]; then
  echo "Resolved source auth token was empty" >&2
  exit 1
fi

if is_local_dev_jwt "$access_token" && [[ "${AURA_STACK_ALLOW_LOCAL_AUTH_TOKEN:-}" != "1" ]]; then
  echo "Resolved source auth token looks like a local/dev HS256 token; attempting zOS login via $target_base_url/api/auth/login"
  if ! access_token="$(login_with_credentials)"; then
    echo "Resolved source auth token looks like a local/dev HS256 token." >&2
    echo "That token can pass the isolated stack but fails aura-router proxy auth." >&2
    echo "Use the real app session, set AURA_STACK_AUTH_SOURCE_DATA_DIR, set AURA_STACK_SOURCE_ACCESS_TOKEN, or set AURA_EVAL_USER_EMAIL/AURA_EVAL_USER_PASSWORD." >&2
    echo "Set AURA_STACK_ALLOW_LOCAL_AUTH_TOKEN=1 only for offline/local-router tests." >&2
    exit 1
  fi
fi

echo "Importing session into $target_base_url"
payload="$(printf '{"access_token":"%s"}' "$access_token")"
import_response="$(
  curl \
  --silent \
  --show-error \
  --fail \
  -H 'Content-Type: application/json' \
  -d "$payload" \
  "$target_base_url/api/auth/import-access-token"
)"

imported_access_token="$(
  printf '%s' "$import_response" | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p'
)"

if [[ -n "$imported_access_token" ]]; then
  access_token="$imported_access_token"
fi

echo "Validating imported session"
curl \
  --silent \
  --show-error \
  --fail \
  -H "Authorization: Bearer $access_token" \
  "$target_base_url/api/auth/session" >/dev/null
echo

cat >"$auth_env_file" <<EOF
#!/usr/bin/env bash
# Generated by evals/local-stack/bin/bootstrap-auth.sh
export AURA_EVAL_ACCESS_TOKEN='$access_token'
EOF
chmod +x "$auth_env_file"

echo "Local Aura auth bootstrap complete."
echo "  wrote benchmark auth token to $auth_env_file"

# Probe the LLM path the harness will actually use, so a misconfigured
# proxy / Cloudflare WAF block / 5xx surfaces here in seconds with a
# clear diagnosis rather than after the harness has spent its 8-attempt
# retry budget on every tool call. Set AURA_STACK_LLM_PREFLIGHT=skip in
# stack.env to disable, or =warn to log without blocking startup.
echo
AURA_EVAL_ACCESS_TOKEN="$access_token" "$script_dir/preflight-llm.sh" "$access_token"
