# Smarter status investigations, gentler upgrade gating, and a model lineup cleanup

- Date: `2026-06-16`
- Channel: `nightly`
- Version: `0.1.0-nightly.680.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.680.1

Today's nightly tightens up how Aura observes itself, keeps the forced-upgrade overlay from cutting off mid-stream work, and prunes chat and image models that were no longer available. Projects also gained proper persistence for build and test commands.

## 7:26 AM — Status page stops crying wolf on slow model and snapshot signals

Observability evals were retuned so realistic latencies and snapshot ages no longer flip the public status page, and the investigator only cites evidence it actually has.

- Relaxed freshness and latency thresholds across status checks — API health and auth-session staleness moved to 30 minutes, the model matrix now tolerates up to 180s warning / 360s outage latency, and the published observability snapshot is treated as informational with a 6-hour staleness budget so a late snapshot no longer takes the public website check down. (`5a0475f`, `2049590`)
- Raised the agent runtime test-turn timeout from 45s to 120s so cold model responses don't get falsely flagged as runtime failures. (`2049590`)
- Tightened the status investigator so it can no longer mention commits, PRs, or file paths that aren't in the supplied evidence, and weak suspect changes are suppressed instead of being surfaced as causes. (`2049590`, `7560151`)
- Refocused source discovery to prefer product code over the observability framework itself and to score phrase-, endpoint-, and error-code-shaped needles higher, producing more relevant suspect paths. (`7c8e040`)

## 8:52 AM — Forced-upgrade overlay waits for your in-flight turn

The forced-upgrade gate no longer slams shut over an active stream — it defers until the current operation finishes.

- Added a global useIsAnyStreaming() selector and used it to defer the initial latch of the forced-upgrade overlay while any chat turn or extraction is streaming; once the user is idle the gate appears as before. A stream starting after the gate is already shown still can't dismiss it. (`04c8143`)

## 10:56 AM — Fable and DALL-E pulled from pickers, retries honor the live model

Aura's model lineup was trimmed to only what's actually serving, retries now use the currently selected chat model, and projects keep their build and test commands.

- Removed Claude Fable 5 from the Anthropic chat lineup and DALL-E 2 / DALL-E 3 from the image lineup; persisted selections pointing at any of these now fall back to available models (Sonnet 4.6 for chat, gpt-image-2 for images) instead of trying to use something that isn't there. (`45b40a1`, `0017da2`)
- Retrying a failed chat turn now sends with the model you currently have selected rather than the cached model from the failed attempt, so swapping off an unavailable model and hitting Retry actually works. (`fa001c1`)
- Project create and update APIs now accept and round-trip build_command and test_command, so per-project tooling metadata is preserved on PUT and returned on GET. (`65d4bed`)

## Highlights

- Forced-upgrade overlay now defers until your turn finishes
- Removed unavailable Fable chat and DALL-E image models
- Status probes tuned to reduce false alerts
- Project build and test commands now persist via the API

