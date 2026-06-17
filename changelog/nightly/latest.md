# Steadier chat turns, calmer status signals, and a smoother desktop launch

- Date: `2026-06-16`
- Channel: `nightly`
- Version: `0.1.0-nightly.685.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.685.1

Today's nightly is a deep reliability pass: chat sessions recover more gracefully from storage and model failures, the status page stops flapping on benign freshness lag, the desktop harness no longer trips over leftover sidecar processes, and a long-standing hidden-window reveal deadlock on desktop is finally unblocked.

## 7:26 AM — Status page stops flagging false outages from snapshot lag

The observability pipeline gets steadier thresholds, smarter investigation prompts, and a longer runtime eval timeout so transient lag stops paging the status page red.

- Relaxed freshness windows and downgraded the published snapshot check to informational so brief publishing delays no longer mark public surfaces as failing. (`5a0475f`)
- Raised the model-matrix eval timeout to 120s and aligned status latency budgets so cold model responses don't spuriously trip outage thresholds. (`2049590`)
- Tightened the status investigator to only cite commits and paths that actually appear in evidence, and suppressed weak suspect changes to cut noise in incident hypotheses. (`7c8e040`, `7560151`)

## 8:52 AM — Chat retries failed turns with your currently selected model

A cluster of chat and model fixes makes failed turns recoverable, prunes models that aren't actually available, and stops upgrade prompts from interrupting an active stream.

- Retrying a failed chat turn now uses the model you've currently selected instead of replaying the one that just failed, so swapping from an unavailable model to a working one actually takes effect. (`fa001c1`)
- Removed the unavailable Fable chat model and the deprecated DALL-E 2 and DALL-E 3 image models from selection, with persistence falling back to a supported image model when a stale DALL-E choice is loaded. (`45b40a1`, `0017da2`)
- The forced-upgrade overlay now waits for an in-flight stream to finish before taking over the UI, so a long extraction or chat turn can't be interrupted mid-response. (`04c8143`)
- Project build and test command metadata is preserved through the projects API, fixing cases where saved commands were silently dropped. (`65d4bed`)

## 1:48 PM — Desktop harness reclaims stale sidecars on launch

Desktop startup gets two fixes that prevent the local harness from getting stuck behind a leftover process or an inherited environment variable.

- On launch, Desktop now detects and terminates stale managed harness sidecars that are still holding the local port, so a previous crashed run can no longer block the new bundled sidecar from starting. (`d44c39d`)
- An inherited AURA_HARNESS_BIN pointing at a previous build's staged sidecar is now ignored, letting the current bundled harness restage cleanly instead of running an outdated binary. (`7dcb1d5`)

## 3:28 PM — Chat persistence survives WAF blocks and cold-start history blowup

Server-side chat persistence becomes resilient to oversized payloads and runaway cold-start histories.

- When the storage backend rejects a chat event with a 413 or a WAF block, the server now retries with a compacted version of tool snapshots, tool results, and assistant message ends instead of dropping the event entirely. (`cb2ad28`)
- Cold-start conversation history is now capped during compaction, preventing very long sessions from ballooning the initial context window on resume. (`6ce6353`)

## 3:44 PM — Integration secrets and project shadows behave more predictably

Org integrations and project listings handle secret hydration and offline shadows more reliably.

- Hydrated canonical integration secrets are now persisted instead of recomputed each time, and resolution falls back to shadow MCP secrets when the canonical entry is missing. (`95ef7ff`, `46884ff`)
- Stale project shadows are hidden from the projects API when the network is available, so users see live project state instead of cached placeholders once they're back online. (`dd3285a`)

## 4:59 PM — Desktop no longer hangs revealing a hidden webview

A long-standing desktop reveal deadlock is fixed by giving the hidden webview a timer fallback and properly handling reopen events.

- The desktop window now reveals reliably even when WKWebView pauses requestAnimationFrame while hidden, thanks to a 750ms timer fallback alongside the post-paint reveal path. (`b85829b`)
- Reopen events (e.g. clicking the dock icon with no visible windows) now re-show and focus the main window instead of leaving the app appearing unresponsive. (`b85829b`)

## Highlights

- Chat retries failed turns with your current model
- WAF-blocked chat events now persist via compacted retry
- Desktop launch reclaims stale sidecars and unblocks hidden webviews
- Status page tolerates snapshot lag without false outages

