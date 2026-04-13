# Spec 03 — Settings & API Key Management

## Status

This spec is **superseded**.

The current direction is:

- **Browser-owned settings and session data** persist in **IndexedDB**.
- **JWT/session auth** is browser-managed and should not be written to backend disk.
- **Org integration secrets / API keys** must live in **`aura-integrations`** and not in local backend storage.
- The local backend store may keep lightweight non-secret runtime/compatibility data only.

## Current Implementation Anchors

- Browser auth/session storage: `interface/src/lib/auth-token.ts`
- Browser DB helper: `interface/src/lib/browser-db.ts`
- Integrations CRUD and secret routing: `apps/aura-os-server/src/handlers/orgs.rs`
- Local org integration metadata helpers: `crates/aura-os-orgs/src/lib.rs`

## Notes

- Older references to encrypted secrets in the legacy local store no longer describe the intended architecture.
- Any future rewrite of this spec should describe IndexedDB for browser state and `aura-integrations` for secret storage.
