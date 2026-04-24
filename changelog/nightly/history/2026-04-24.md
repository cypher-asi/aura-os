# Changelog media pipeline rebuilt on Browser Use

- Date: `2026-04-24`
- Channel: `nightly`
- Version: `0.1.0-nightly.368.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.368.1

Today's nightly retires the old screenshot publishing stack and replaces it with a leaner Browser Use-driven capture pipeline. The work spans a large infrastructure swap, new quality and branding gates, a fix for split-host deployments, and safer seeded capture sessions — all landing in one early-morning batch alongside standard Desktop builds for Mac, Windows, and Linux.

## 2:34 AM — Browser Use replaces the legacy changelog media pipeline

The changelog media stack was rebuilt around Browser Use planning, new proof gates, split-host support, and seeded capture sessions.

- Retired the old Browserbase-based screenshot publishing stack — including the publish, retry, and history-sync GitHub workflows and roughly 20k lines of demo-agent and seed-planner code — in favor of a smaller Browser Use planning pipeline driven by Anthropic candidate selection, with a new capture-auth server module and CaptureLoginView on the frontend. (`888afbe`)
- Added quality and branding gates to the media pipeline so screenshots must clear automated proof checks (including an Anthropic vision judge) before an OpenAI-backed branding step wraps them in a branded SVG card without resampling the raw product pixels. (`ff509bb`)
- Fixed capture for deployments where the frontend and aura-os-server live on different hosts: the capture-login entry now runs from the app root with a `host` parameter and a new `AURA_DEMO_SCREENSHOT_API_URL` env var, and preflight posts to the correct API origin. (`e7b602e`)
- Media runs can now hand Browser Use a short-lived, URL-fragment-encoded capture session instead of a shared secret form, and all task logs and transcripts are scrubbed through a new `redactCaptureLoginSecrets` pass so seeded tokens never leak into artifacts. (`1fd2c56`)

## Highlights

- Browser Use replaces the legacy screenshot pipeline
- New quality and branding gates guard changelog media
- Split-host frontend/API deployments now capture correctly
- Seeded, redacted capture sessions replace shared secrets

