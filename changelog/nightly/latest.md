# Sturdier chat turns, calmer upgrade gate, and steadier status signals

- Date: `2026-06-16`
- Channel: `nightly`
- Version: `0.1.0-nightly.683.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.683.1

Today's nightly focuses on resilience across the stack: chat persistence survives WAF blocks and bloated payloads, the forced-upgrade overlay stops interrupting active turns, the desktop harness sidecar no longer gets stuck on stale processes, and the public status page rides through transient freshness blips without flipping red. Unavailable image and chat models were also pruned so the model picker reflects what actually works.

## 7:26 AM — Status page stops flapping on stale freshness data

The observability pipeline was retuned so transient snapshot lag and slow model probes no longer trip false outages on the public status surface.

- Loosened snapshot freshness thresholds and demoted the published-observability-snapshot check to informational so a late snapshot keeps the public website feature operational instead of marking it failed. (`5a0475f`)
- Raised the model-matrix latency budget to 180s/360s and extended the runtime test turn timeout from 45s to 120s so cold model responses no longer register as outages. (`2049590`)
- Hardened the status investigator so it only cites commits and file paths that actually appear in the evidence packet, and suppressed weak suspect-change hypotheses from investigation output. (`7c8e040`, `7560151`)

## 8:52 AM — Forced-upgrade overlay defers until your turn finishes

The mandatory upgrade gate no longer latches mid-stream, so an in-progress chat turn or extraction can complete before the overlay appears.

- Added a global useIsAnyStreaming() selector and gated the forced-upgrade overlay on it, so the gate defers (not cancels) while any stream is active and appears once the app is idle. (`04c8143`)
- Once the gate has latched, a newly started stream cannot dismiss it — preserving the upgrade requirement while protecting active work. (`04c8143`)

## 10:56 AM — Chat retries respect the current model, and dead model IDs are gone

Failed chat turns now retry against whichever model the user has selected now, and the model catalog was trimmed to remove options that no longer work.

- Retrying a failed turn now uses the currently selected chat model instead of the cached model from the failed attempt, so switching models after an error actually takes effect on retry. (`fa001c1`)
- Removed the unavailable Fable chat model and the discontinued DALL-E 2 and DALL-E 3 image models from the picker, and made stale persisted DALL-E selections fall back to gpt-image-2. (`45b40a1`, `0017da2`)
- Project API responses now preserve build and test command metadata so configured commands survive round-trips through the projects endpoint. (`65d4bed`)

## 1:48 PM — Desktop harness sidecar recovers from stale managed processes

The desktop app's local harness sidecar can now detect and replace orphaned managed instances, and ignores inherited environment that would pin it to a stale binary.

- On launch, the desktop sidecar enumerates processes listening on the harness port and terminates stale managed sidecars under the runtime/sidecar staging dir before starting the bundled binary. (`d44c39d`)
- An inherited AURA_HARNESS_BIN pointing at a previously staged managed binary is now ignored so the freshly bundled sidecar can be restaged instead of running an outdated nightly. (`7dcb1d5`)

## 3:28 PM — Chat history survives WAF blocks and cold-start bloat

Server-side chat persistence got two resilience fixes so storage rejections and oversized cold-start histories no longer drop events.

- When aura-storage rejects a chat event with 413 or a WAF/Cloudflare 403 block page, the server now retries with a compacted payload (tool-call snapshots, tool results, and assistant_message_end are trimmed) and logs the original vs. compacted byte sizes on success. (`cb2ad28`)
- Cold-start conversation history is now capped during compaction so very long sessions don't blow past truncation limits on the first turn after resume. (`6ce6353`)

## Highlights

- Forced-upgrade overlay now waits for active turns
- Chat persistence retries with a compacted payload after WAF or 413 rejections
- Desktop sidecar reliably replaces stale managed harness processes
- Status page tolerates transient snapshot freshness gaps

