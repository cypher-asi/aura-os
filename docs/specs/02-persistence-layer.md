# Spec 02 — Persistence Layer

## Status

This spec is **superseded**.

The implementation no longer uses the old embedded database layer. The current model is:

- **Browser-owned persisted state** lives in **IndexedDB** in the interface layer.
- **Request auth** is browser-managed and sent on each request as a JWT.
- **Local backend compatibility/runtime state** lives in the lightweight store behind `aura-os-store`.
- **Secret-backed org integrations** belong to **`aura-integrations`**, not the local store.

## Current Implementation Anchors

- Browser auth/session persistence: `interface/src/lib/auth-token.ts`
- Shared browser DB helper: `interface/src/lib/browser-db.ts`
- Backend local store: `crates/aura-os-store/src/store.rs`
- Backend settings helpers: `crates/aura-os-store/src/store_settings.rs`

## Notes

- Historical references to the old embedded database in older planning docs should be treated as archival context, not the current design.
- If this spec is rewritten in full, it should describe the IndexedDB client model plus the lightweight backend runtime store rather than column-family-based embedded database behavior.
