#!/usr/bin/env bash
#
# Pre-seed cargo-packager's create-dmg cache with the AURA-patched copy.
#
# cargo-packager 0.11.8 invokes ~/Library/Caches/.cargo-packager/DMG/script/create-dmg
# and only downloads upstream create-dmg v1.1.1 there if the file does not already exist:
#   https://github.com/crabnebula-dev/cargo-packager/blob/cargo-packager-v0.11.8/crates/packager/src/package/dmg/mod.rs
#
# Upstream v1.1.1 attaches the DMG without `-nobrowse` and only retries `hdiutil detach`
# without `-force`. On macOS Intel CI runners (`macos-15-large`), Spotlight, fseventsd,
# and diskimages-helper transiently hold the volume across all 3 default retries, which
# fails packaging with `hdiutil: couldn't eject "diskN" - Resource busy`.
#
# By copying our patched script in first, cargo-packager skips the download and uses our
# version instead. The script is idempotent so it can run before every retry.

set -euo pipefail

if [[ "${OSTYPE:-}" != darwin* ]]; then
  echo "install-patched-create-dmg.sh: skipping on non-macOS host (OSTYPE=${OSTYPE:-unset})"
  exit 0
fi

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
SOURCE="${SCRIPT_DIR}/create-dmg"

if [[ ! -f "${SOURCE}" ]]; then
  echo "install-patched-create-dmg.sh: missing vendored create-dmg at ${SOURCE}" >&2
  exit 1
fi

CACHE_HOME="${HOME:-/Users/$(id -un)}"
CACHE_DIR="${CACHE_HOME}/Library/Caches/.cargo-packager/DMG/script"
TARGET="${CACHE_DIR}/create-dmg"

mkdir -p "${CACHE_DIR}"
cp "${SOURCE}" "${TARGET}"
chmod 0764 "${TARGET}"

echo "install-patched-create-dmg.sh: installed patched create-dmg at ${TARGET}"
