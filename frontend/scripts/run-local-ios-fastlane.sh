#!/bin/sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"

GEM_BIN_DEFAULT="$HOME/.local/share/gem/ruby/3.4.0/bin"
# Prefer the user-local gem bin when fastlane was installed outside the system Ruby.
if [ -d "${AURA_GEM_BIN:-$GEM_BIN_DEFAULT}" ]; then
  export PATH="${AURA_GEM_BIN:-$GEM_BIN_DEFAULT}:$PATH"
fi

# Native mobile builds must target a real Aura host instead of the embedded localhost webview origin.
export VITE_ANDROID_DEFAULT_HOST="${VITE_ANDROID_DEFAULT_HOST:-http://10.0.2.2:3100}"
export VITE_IOS_DEFAULT_HOST="${VITE_IOS_DEFAULT_HOST:-http://127.0.0.1:3100}"

cd "$ROOT_DIR/ios"
bundle _2.6.8_ exec fastlane ios local_simulator
