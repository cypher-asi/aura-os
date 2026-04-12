#!/bin/sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
BUNDLER_VERSION="2.6.8"

GEM_BIN_DEFAULT="$HOME/.local/share/gem/ruby/3.4.0/bin"
# Prefer the user-local gem bin when fastlane was installed outside the system Ruby.
if [ -d "${AURA_GEM_BIN:-$GEM_BIN_DEFAULT}" ]; then
  export PATH="${AURA_GEM_BIN:-$GEM_BIN_DEFAULT}:$PATH"
fi

bundle_supports_required_version() {
  command -v bundle >/dev/null 2>&1 && bundle "_${BUNDLER_VERSION}_" -v >/dev/null 2>&1
}

if ! bundle_supports_required_version; then
  echo "Bundler ${BUNDLER_VERSION} is required to run the iOS fastlane lane." >&2
  echo "Install it, or point AURA_GEM_BIN at the Ruby gem bin that contains it." >&2
  exit 1
fi

# Native mobile builds must target a real Aura host instead of the embedded localhost webview origin.
export VITE_ANDROID_DEFAULT_HOST="${VITE_ANDROID_DEFAULT_HOST:-http://10.0.2.2:3100}"
export VITE_IOS_DEFAULT_HOST="${VITE_IOS_DEFAULT_HOST:-http://127.0.0.1:3100}"

cd "$ROOT_DIR/ios"
bundle "_${BUNDLER_VERSION}_" exec fastlane ios local_simulator
