# Sharper status signals, smarter chat retries, and a calmer desktop sidecar

- Date: `2026-06-16`
- Channel: `nightly`
- Version: `0.1.0-nightly.682.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.682.1

Today's nightly tightens up how Aura watches itself and how it recovers from rough edges. The observability stack got noticeably less noisy and better focused, the chat surface stops asking users to live with a stale model selection, and the desktop harness learned how to clean up after itself across upgrades.

## 7:26 AM — Observability evals stop flagging false outages

A focused pass on the status pipeline raises the bar for what counts as an incident and what counts as a credible suspect change.

- Loosened snapshot freshness thresholds and downgraded the published observability snapshot to informational, so a late publish no longer flips the public website feature into a degraded state. (`5a0475f`)
- Extended the model runtime eval turn timeout from 45s to 120s (with matching warning/outage latency windows up to 180s/360s) so cold-start model responses no longer trip the model matrix check. (`2049590`)
- Refined investigation source discovery to prefer product code over the observability framework itself, score phrase- and endpoint-like needles higher, and cap matches per needle for tighter, more relevant suspect lists. (`7c8e040`, `7560151`)
- Hardened the investigator so it can only cite commits and paths that actually appear in the evidence packet, preventing hallucinated causes in generated status writeups. (`2049590`)

## 8:52 AM — Forced-upgrade overlay defers instead of interrupting

The upgrade gate now respects work in flight, waiting for the current turn or extraction to finish before it latches.

- A new global useIsAnyStreaming() selector lets the ForcedUpgradeOverlay skip its initial latch while any stream is active; once the app is idle the gate appears, and a stream starting afterward will no longer dismiss it. (`04c8143`)

## 10:56 AM — Chat model lineup cleanup and smarter retry

The model picker drops options that were no longer actually available, and a failed turn now retries against whatever model the user has selected right now.

- Retrying a dropped or errored chat turn now uses the currently selected model rather than replaying the cached model from the failed send, so switching away from a broken model actually unblocks the conversation. (`fa001c1`)
- Removed the unavailable Fable chat model and the DALL-E 2/3 image models from the picker, and made loadPersistedImageModel fall back to gpt-image-2 when a stale DALL-E selection is loaded from storage. (`45b40a1`, `0017da2`)
- Projects API now round-trips build and test command metadata, so configured commands survive edits instead of being silently dropped. (`65d4bed`)

## 1:48 PM — Desktop harness sidecar lifecycle across upgrades

The managed local harness on Desktop now detects and evicts leftover sidecars from prior versions instead of silently colliding with them.

- Before spawning the local harness, Aura now scans for managed sidecars listening on the target port (via lsof on Unix), classifies them as current or stale by comparing against the expected binary path, and terminates stale processes so the bundled sidecar can take over cleanly. (`d44c39d`)
- An inherited AURA_HARNESS_BIN pointing into the managed runtime/sidecar staging directory is now ignored, letting Desktop restage the freshly bundled harness binary after an upgrade instead of reusing the previous version's path. (`7dcb1d5`)

## Highlights

- Status page no longer cries wolf on transient freshness blips
- Forced-upgrade overlay waits politely instead of cutting off a streaming turn
- Chat retries now use the model you actually have selected
- Desktop harness evicts stale sidecars instead of fighting them for the port

