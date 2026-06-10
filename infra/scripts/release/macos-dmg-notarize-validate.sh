#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: macos-dmg-notarize-validate.sh [--notarize] DIR

Validates macOS DMG release artifacts with codesign, stapler, and Gatekeeper.
When --notarize is passed, each DMG is first submitted to Apple's notary
service and stapled using APPLE_API_KEY, APPLE_API_ISSUER, and APPLE_API_KEY_PATH.
USAGE
}

notarize=false
artifact_dir=""

while (($#)); do
  case "$1" in
    --notarize)
      notarize=true
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    -*)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
    *)
      if [[ -n "$artifact_dir" ]]; then
        echo "Only one artifact directory may be provided" >&2
        usage >&2
        exit 2
      fi
      artifact_dir="$1"
      shift
      ;;
  esac
done

if [[ -z "$artifact_dir" ]]; then
  echo "Artifact directory is required" >&2
  usage >&2
  exit 2
fi

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "macOS DMG validation requires a macOS runner" >&2
  exit 2
fi

if [[ ! -d "$artifact_dir" ]]; then
  echo "Artifact directory does not exist: $artifact_dir" >&2
  exit 1
fi

if [[ "$notarize" == true ]]; then
  missing=()
  for name in APPLE_API_KEY APPLE_API_ISSUER APPLE_API_KEY_PATH; do
    if [[ -z "${!name:-}" ]]; then
      missing+=("$name")
    fi
  done
  if ((${#missing[@]})); then
    printf 'Missing required Apple notarization variables: %s\n' "${missing[*]}" >&2
    exit 1
  fi
fi

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/aura-dmg-notary.XXXXXX")"
trap 'rm -rf "$tmp_dir"' EXIT

declare -a dmgs=()
while IFS= read -r -d '' dmg; do
  dmgs+=("$dmg")
done < <(find "$artifact_dir" -type f -name '*.dmg' -print0 | sort -z)

if ((${#dmgs[@]} == 0)); then
  echo "No DMG artifacts found under $artifact_dir" >&2
  exit 1
fi

submit_dmg() {
  local dmg="$1"
  local attempt=1
  local max_attempts=3
  local stdout_file stderr_file status

  while true; do
    stdout_file="$tmp_dir/notary-${attempt}.stdout.json"
    stderr_file="$tmp_dir/notary-${attempt}.stderr.log"

    echo "Submitting $(basename "$dmg") for notarization (attempt ${attempt}/${max_attempts})"
    if xcrun notarytool submit "$dmg" \
      --wait \
      --output-format json \
      --key-id "$APPLE_API_KEY" \
      --key "$APPLE_API_KEY_PATH" \
      --issuer "$APPLE_API_ISSUER" \
      >"$stdout_file" 2>"$stderr_file"; then
      cat "$stdout_file"
      if [[ -s "$stderr_file" ]]; then
        cat "$stderr_file" >&2
      fi

      status="$(
        python3 - "$stdout_file" <<'PY'
import json
import sys
from pathlib import Path

payload = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
print(payload.get("status", ""))
PY
      )"
      if [[ "$status" == "Accepted" ]]; then
        xcrun stapler staple -v "$dmg"
        return 0
      fi

      echo "Notarization finished with status '$status' for $dmg" >&2
    else
      cat "$stdout_file" || true
      cat "$stderr_file" >&2 || true
    fi

    if ((attempt >= max_attempts)); then
      return 1
    fi

    attempt=$((attempt + 1))
    sleep 10
  done
}

for dmg in "${dmgs[@]}"; do
  echo "Validating DMG: $dmg"
  codesign --verify --verbose=2 "$dmg"

  if [[ "$notarize" == true ]]; then
    submit_dmg "$dmg"
  fi

  xcrun stapler validate "$dmg"
  spctl -a -vvv --type open --context context:primary-signature "$dmg"
  spctl -a -vvv --type install "$dmg"
done

echo "Validated ${#dmgs[@]} DMG artifact(s)"
