#!/usr/bin/env bash
#
# One-shot migration: link the "Competitive Intel" process to the
# "Competition" project. Safe to run multiple times (idempotent).
#
# Usage:
#   AURA_TOKEN="<your-jwt>" ./scripts/migrate-process-to-project.sh
#
# Defaults to localhost:3578. Override with AURA_BASE_URL.

set -euo pipefail

BASE="${AURA_BASE_URL:-http://localhost:3578}"
TOKEN="${AURA_TOKEN:?Set AURA_TOKEN to a valid JWT}"

PROCESS_NAME="Competitive Intel"
PROJECT_NAME="Competition"

AUTH="Authorization: Bearer $TOKEN"
CT="Content-Type: application/json"

echo "==> Fetching projects..."
PROJECT_ID=$(curl -sf -H "$AUTH" "$BASE/api/projects" \
  | jq -r --arg name "$PROJECT_NAME" '.[] | select(.name == $name) | .project_id')

if [ -z "$PROJECT_ID" ]; then
  echo "ERROR: Project '$PROJECT_NAME' not found." >&2
  exit 1
fi
echo "    Found project '$PROJECT_NAME' -> $PROJECT_ID"

echo "==> Fetching processes..."
PROCESS_ID=$(curl -sf -H "$AUTH" "$BASE/api/processes" \
  | jq -r --arg name "$PROCESS_NAME" '.[] | select(.name == $name) | .process_id')

if [ -z "$PROCESS_ID" ]; then
  echo "ERROR: Process '$PROCESS_NAME' not found." >&2
  exit 1
fi
echo "    Found process '$PROCESS_NAME' -> $PROCESS_ID"

echo "==> Linking process to project..."
curl -sf -X PUT -H "$AUTH" -H "$CT" \
  "$BASE/api/processes/$PROCESS_ID" \
  -d "{\"project_id\": \"$PROJECT_ID\"}" \
  | jq '{process_id: .process_id, name: .name, project_id: .project_id}'

echo "==> Done. Process '$PROCESS_NAME' is now linked to project '$PROJECT_NAME'."
