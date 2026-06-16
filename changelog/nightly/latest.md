# Steadier chat turns, sturdier desktop sidecar, and cleaner status signals

- Date: `2026-06-16`
- Channel: `nightly`
- Version: `0.1.0-nightly.684.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.684.1

Today's nightly is a reliability-heavy pass: chat turns recover more gracefully when models or storage misbehave, the desktop harness sidecar stops tripping over its own stale state, and the public status page calms down false-alarm freshness signals. A handful of integration and project fixes round out the day.

## 7:26 AM — Status page freshness tuned to reduce false outages

Observability probes were retuned so transient snapshot lag and slow model warm-ups stop flipping the public status board.

- Relaxed freshness windows and demoted the published snapshot check to informational so a slow upload no longer marks public surfaces as down, with new policy tests locking in the operational behavior. (`5a0475f`)
- Extended the model-matrix runtime eval timeout to 120s (with matching warning/outage latencies) so cold-start model responses don't read as outages. (`2049590`)
- Tightened the status investigator so it only cites commits and paths that actually appear in the evidence packet, and suppressed weak suspect changes that were producing noisy root-cause guesses. (`7c8e040`, `7560151`, `2049590`)

## 8:52 AM — Forced-upgrade overlay waits for your turn to finish

The forced-upgrade gate no longer slams down mid-stream, so an in-progress chat turn or extraction can complete before the upgrade prompt appears.

- The overlay now defers (rather than cancels) while any stream is active and only latches once the app is idle, backed by a new global useIsAnyStreaming() selector. (`04c8143`)
- Once the gate is shown it stays latched even if a new stream starts, preserving the upgrade prompt instead of letting it flicker away. (`04c8143`)

## 10:56 AM — Chat retries honor the currently selected model

The chat surface stopped resurrecting unavailable models on retry and now uses whatever model the user actually has selected.

- Retrying a failed turn now sends with the currently selected model instead of the cached model from the failed attempt, so switching away from a broken model actually takes effect. (`fa001c1`)
- Removed the unavailable Claude Fable chat model and the retired DALL-E 2/3 image models from the picker, with persisted stale selections falling back to gpt-image-2 or gemini-nano-banana. (`45b40a1`, `0017da2`)
- Project API responses now preserve build and test command metadata end-to-end, fixing a round-trip where those fields were being dropped. (`65d4bed`)

## 1:48 PM — Desktop harness sidecar recovers from stale managed processes

The desktop app's local harness sidecar got two fixes that keep launches clean when an old managed instance or inherited env variable is hanging around.

- On startup the desktop now detects managed sidecar processes still listening on the harness port and terminates stale ones before launching the bundled binary, while leaving an already-current process in place. (`d44c39d`)
- An inherited AURA_HARNESS_BIN pointing at a previous managed staging path is now ignored so the bundled sidecar can be restaged, fixing cases where an old env value pinned the app to a stale binary. (`7dcb1d5`)

## 3:28 PM — Chat persistence survives WAF blocks and oversized histories

Server-side chat persistence got more resilient to upstream storage rejections and unbounded cold-start histories.

- When aura-storage rejects an event with a 413 or a WAF block, the server now retries with a compacted payload (tool snapshots, tool results, and assistant message ends) instead of dropping the event, logging the size delta on success. (`cb2ad28`)
- Cold-start conversation history is now capped during compaction so very long sessions can't blow up the first turn, with new truncation tests covering the limit. (`6ce6353`)

## 3:44 PM — Integration secrets and project shadows resolve more predictably

Org integrations and project listings handle hydrated, shadow, and stale data more cleanly when the network state changes.

- Hydrated canonical secrets are now persisted on the org record so integrations don't re-resolve from scratch on every request. (`95ef7ff`)
- Org tool resolution falls back to shadow MCP secrets when the canonical entry is missing, keeping integrations reachable during partial config rollouts. (`46884ff`)
- Project listings now hide stale shadow entries when the network is available, so users see the live project set instead of a mix of cached ghosts. (`dd3285a`)

## Highlights

- Forced-upgrade overlay no longer interrupts an active turn
- Chat retries with the model you actually have selected
- Desktop sidecar replaces stale managed processes instead of fighting them
- Compact retry path keeps chat events persisting through WAF blocks

