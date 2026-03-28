#!/bin/sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"

GEM_BIN_DEFAULT="$HOME/.local/share/gem/ruby/3.4.0/bin"
# Prefer the user-local gem bin when fastlane was installed outside the system Ruby.
if [ -d "${AURA_GEM_BIN:-$GEM_BIN_DEFAULT}" ]; then
  export PATH="${AURA_GEM_BIN:-$GEM_BIN_DEFAULT}:$PATH"
fi

is_compatible_java_home() {
  if [ -z "${1:-}" ] || [ ! -x "$1/bin/javac" ]; then
    return 1
  fi

  version="$("$1/bin/javac" -version 2>&1 | awk '{print $2}')"
  major="${version%%.*}"
  [ "$major" -ge 21 ] 2>/dev/null
}

if ! is_compatible_java_home "${JAVA_HOME:-}"; then
  unset JAVA_HOME
fi

# Let local runs override the JDK explicitly before trying common install locations.
if [ -n "${AURA_JAVA_HOME:-}" ] && is_compatible_java_home "$AURA_JAVA_HOME"; then
  JAVA_HOME="$AURA_JAVA_HOME"
  export JAVA_HOME
fi

# Android Studio often points JAVA_HOME at an older bundled JDK, so prefer any 21+ install we can find.
if [ -z "${JAVA_HOME:-}" ]; then
  for candidate in \
    "$HOME/Library/Java/JavaVirtualMachines/azul-22.0.2/Contents/Home" \
    "$HOME/Library/Java/JavaVirtualMachines/temurin-22/Contents/Home" \
    "$HOME/Library/Java/JavaVirtualMachines/temurin-21/Contents/Home" \
    "/Library/Java/JavaVirtualMachines/temurin-22.jdk/Contents/Home" \
    "/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home"
  do
    if is_compatible_java_home "$candidate"; then
      JAVA_HOME="$candidate"
      export JAVA_HOME
      break
    fi
  done
fi

if [ -z "${JAVA_HOME:-}" ] && [ -x /usr/libexec/java_home ]; then
  JAVA_HOME="$(/usr/libexec/java_home -v 22 2>/dev/null || /usr/libexec/java_home -v 21 2>/dev/null || true)"
  if [ -n "$JAVA_HOME" ]; then
    export JAVA_HOME
  fi
fi

if [ -z "${ANDROID_HOME:-}" ] && [ -d "$HOME/Library/Android/sdk" ]; then
  export ANDROID_HOME="$HOME/Library/Android/sdk"
fi

if [ -n "${JAVA_HOME:-}" ]; then
  export PATH="$JAVA_HOME/bin:$PATH"
fi

if [ -n "${ANDROID_HOME:-}" ] && [ -d "$ANDROID_HOME/platform-tools" ]; then
  export PATH="$ANDROID_HOME/platform-tools:$PATH"
fi

# Native mobile builds must target a real Aura host instead of the embedded localhost webview origin.
export VITE_ANDROID_DEFAULT_HOST="${VITE_ANDROID_DEFAULT_HOST:-http://10.0.2.2:3100}"
export VITE_IOS_DEFAULT_HOST="${VITE_IOS_DEFAULT_HOST:-http://127.0.0.1:3100}"

cd "$ROOT_DIR/android"
bundle _2.6.8_ exec fastlane android local_debug
