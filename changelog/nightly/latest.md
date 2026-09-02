# Manual workspace editing on the web and Claude 5.1 models

- Date: `2026-09-02`
- Channel: `nightly`
- Version: `0.1.0-nightly.828.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.828.1

Today's nightly brings two meaningful additions: Aura Web can now edit workspace files directly with hardened gateway plumbing, and the model catalog picks up Claude Fable 5.1 and Mythos 5.1 with full pricing and capability support.

## 2:56 PM — Manual workspace file editing lands in Aura Web

Aura Web can now save edits to workspace files through the IDE view, backed by a new server-side write path with conflict detection and stricter gateway safety.

- Users can manually edit and save workspace files from the IDE view in Aura Web, with a new hosted write endpoint that proxies PUT api/write-file and rejects stale saves via an expected_revision check so conflicting edits surface as a reopen prompt instead of silent overwrites. (`371abc0`)
- Remote file writes are now pinned to the configured swarm gateway origin using a trusted request builder and typed bearer authentication, closing off origin-spoofing paths through agent-supplied IDs. (`371abc0`)
- Gateway failures are redacted before they reach clients or logs — workspace paths and agent identifiers are kept out of log lines, and oversized files return a clear "too large to edit in Aura Web" error instead of a raw 413. (`371abc0`)
- Added Claude Fable 5.1 and Mythos 5.1 to the model picker as Aura-managed Anthropic models with a 1M context window, the full low→max effort range, and pricing wired in at $10/$50 per Mtok with a discounted $0.25 cache-read rate. (`be09573`)

## Highlights

- Manual file editing in Aura Web with revision-safe saves
- Claude Fable 5.1 and Mythos 5.1 available in the model picker
- Hardened swarm gateway auth and log redaction

