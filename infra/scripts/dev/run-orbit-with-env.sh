#!/usr/bin/env bash
# Run Orbit with TRUSTED_JWT_* set from Aura's ZERO_JWT_* in .env.
# Usage: from aura-app root, ./scripts/run-orbit-with-env.sh
# Requires: ORBIT_BASE_URL or Orbit repo at ../orbit; ZERO_JWT_ISSUER and ZERO_JWT_JWKS_URL in .env.

set -e
AURA_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$AURA_ROOT"
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi
export TRUSTED_JWT_ISSUER="${ZERO_JWT_ISSUER:-$TRUSTED_JWT_ISSUER}"
export TRUSTED_JWT_JWKS_URL="${ZERO_JWT_JWKS_URL:-$TRUSTED_JWT_JWKS_URL}"
ORBIT_DIR="${ORBIT_DIR:-$(dirname "$AURA_ROOT")/orbit}"
if [ ! -d "$ORBIT_DIR" ]; then
  echo "Orbit repo not found at $ORBIT_DIR. Set ORBIT_DIR to the orbit repo path."
  exit 1
fi
cd "$ORBIT_DIR"
exec cargo run
