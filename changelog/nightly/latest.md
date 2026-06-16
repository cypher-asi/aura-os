# Smarter status investigations, calmer upgrade gate, and a self-healing desktop harness

- Date: `2026-06-16`
- Channel: `nightly`
- Version: `0.1.0-nightly.681.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.681.1

Today's nightly tightens how Aura's status system reasons about outages, stops the forced-upgrade overlay from interrupting active chats, prunes unavailable image and chat models, and teaches the desktop harness to clear out stale sidecars before launch.

## 7:26 AM — Status probe tuning and grounded investigations

The observability pipeline got more tolerant freshness windows and a stricter, evidence-only investigator so root-cause writeups stop drifting into speculation.

- Relaxed staleness and latency thresholds for API health, snapshot freshness, and the public website snapshot check, and shifted the scheduled observability cron off the hour to avoid runner contention — fewer false 'stale' or latency warnings on the public status surface. (`5a0475f`)
- Raised the model-matrix runtime eval timeout from 45s to 120s (with matching warning/outage budgets up to 180s/360s) so cold model responses no longer trip the status check. (`2049590`)
- The status investigator is now constrained to cite only commits and paths that appear in the supplied evidence, with a sanitization pass that strips unsupported references from proof, causes, affected areas, and follow-up probes. (`2049590`, `7560151`)
- Source discovery now scores and prioritizes search needles (endpoints, error codes, multi-word phrases) and prefers product code paths over observability framework files, producing more focused suspect-change lists. (`7c8e040`)

## 8:52 AM — Forced-upgrade overlay waits for the user to be idle

The upgrade gate no longer interrupts an in-progress turn or extraction; it defers until the active stream finishes.

- Added a global useIsAnyStreaming() selector and used it to defer the ForcedUpgradeOverlay latch while any stream is active. Once the user is idle the gate appears, and a stream starting after the gate is shown will not dismiss it — defer, not cancel. (`04c8143`)

## 10:56 AM — Model catalog cleanup and retry-with-current-model

Unavailable Fable and DALL-E entries were removed from the model picker, retries now use the model you have selected today, and project APIs preserve build/test commands across updates.

- Dropped the unavailable Fable chat model and the DALL-E 2 / DALL-E 3 image models from the picker, defaults, ETA tables, and the whitepaper seed; stale persisted DALL-E selections now fall back to gpt-image-2 instead of staying stuck on a missing model. (`45b40a1`, `0017da2`)
- Retrying a failed chat turn now uses the currently selected model rather than the cached model that originally failed, so swapping away from a broken model and hitting Retry actually re-runs against the new one. (`fa001c1`)
- Project create and update requests now carry build_command and test_command, and the server preserves them across PUT/GET round-trips so tooling metadata no longer gets dropped on edit. (`65d4bed`)

## 1:48 PM — Desktop harness reclaims its port from stale sidecars

On Unix, the desktop app now detects and terminates orphaned managed harness sidecars holding the local port before spawning a fresh one.

- Before launching the local harness, the desktop sidecar manager uses lsof to find processes listening on the harness port, classifies them as the current expected binary or a stale managed sidecar under runtime/sidecar, and terminates stale ones so the new harness can bind cleanly instead of failing health probes. (`d44c39d`)

## Highlights

- Status investigator now stays grounded in real evidence
- Forced-upgrade overlay defers during active streams
- Failed chat turns retry with the model you actually have selected
- Desktop reclaims its port from stale managed sidecars

