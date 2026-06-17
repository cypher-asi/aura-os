# Resilient chat retries, sharper thinking UI, and harder-edged desktop harness

- Date: `2026-06-16`
- Channel: `nightly`
- Version: `0.1.0-nightly.686.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.686.1

A reliability-heavy nightly: chat turns and storage writes recover more gracefully from upstream failures, the desktop harness sidecar stops fighting stale processes and inherited env, and the assistant's reasoning surface gets a proper collapsible "Thought for Xs" treatment.

## 7:26 AM — Status investigator stops chasing weak suspects

The observability status probes were tuned to reduce noisy investigations and align model evals with real cold-start latency.

- Stabilized the marketing StatusView freshness signals and tightened the underlying status policy and probe expectations. (`5a0475f`)
- Raised the model-matrix eval timeout to 120s (with warning/outage latency budgets bumped to 180s/360s) so cold model responses no longer trip false outages. (`2049590`)
- Constrained the status investigator to evidence-backed commits and paths and dropped weak suspect changes, so RCAs stop citing files and commits that aren't in the evidence packet. (`7c8e040`, `7560151`, `2049590`)

## 8:52 AM — Chat retries on your current model and stops offering dead ones

Chat surfaces now retry failed turns against the model you have selected today, and unavailable model entries were pruned from the picker.

- Retrying a dropped turn now uses the currently selected chat model instead of replaying the cached model from the failed attempt, so switching models after an error actually takes effect. (`fa001c1`)
- Removed the unavailable Fable chat model and the retired DALL·E 2/3 image models from the picker, with stale persisted DALL·E selections silently falling back to gpt-image-2. (`45b40a1`, `0017da2`)
- The forced-upgrade overlay now defers (rather than cancels) while a stream is active, so an in-progress turn or extraction can finish before the upgrade gate appears. (`04c8143`)
- Project build and test command metadata is now preserved end-to-end through the projects API. (`65d4bed`)

## 1:48 PM — Desktop harness reclaims its port and ignores stale env

The managed local harness sidecar on desktop now detects and replaces stale processes and refuses to trust an inherited managed binary path from a previous install.

- Before spawning, the desktop now scans for managed sidecars listening on the harness port and terminates stale ones whose binary no longer matches the bundled path, while leaving the current process untouched. (`d44c39d`)
- An inherited AURA_HARNESS_BIN pointing into the managed staging dir is now ignored so the freshly bundled sidecar can be restaged instead of silently reusing an old binary across upgrades. (`7dcb1d5`)

## 3:28 PM — Chat persistence survives WAF blocks and oversized payloads

Server-side chat persistence and integration secret handling were hardened against upstream rejections and missing data.

- When aura-storage rejects an event with 413 or a WAF block (403 with firewall/blocked markers), the server now retries with a compacted payload for tool snapshots, tool results, and assistant message ends instead of dropping the event. (`cb2ad28`)
- Cold-start conversation history is now capped during compaction so reopening long sessions doesn't blow past safe context limits. (`6ce6353`)
- Org-tool resolution persists hydrated canonical secrets and falls back to shadow MCP secrets when the canonical copy is missing, keeping integrations connected through partial data states. (`95ef7ff`, `46884ff`)
- Projects API now hides stale local shadows once the network is available, so users see authoritative data instead of an outdated cached copy. (`dd3285a`)

## 4:59 PM — Hidden webview no longer deadlocks the desktop reveal

The desktop app's first-paint reveal handshake is now resilient to paused requestAnimationFrame in hidden webviews.

- Introduced scheduleDesktopReveal with a 750ms timer fallback so WKWebView pausing rAF while hidden can no longer block the reveal IPC, and the native runtime now focuses the window on show and handles macOS reopen events. (`b85829b`)

## 8:47 PM — Thinking block streams live, then collapses to "Thought for Xs"

The assistant's reasoning surface was rebuilt on the shared collapsible Block shell with a live-reveal then auto-collapse behavior.

- ThinkingBlock now force-expands with a shimmering "Thinking..." caption while a reasoning segment streams, then collapses to a clickable "Thought for Xs" summary the moment the segment closes. (`2d709c3`)
- The chat-core e2e eval harness now mocks paginated session history, unblocking reliable evaluation of long-session UI behavior. (`b950683`)

## Highlights

- Failed chat turns now retry on the currently selected model
- Compact-retry path rescues chat events blocked by WAF or oversized payloads
- Desktop reclaims stale sidecar ports and ignores inherited harness env
- Reasoning streams live then collapses to a clickable "Thought for Xs"

