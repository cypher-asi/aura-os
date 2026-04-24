# Changelog media pipeline rebuilt around Browser Use

- Date: `2026-04-24`
- Channel: `nightly`
- Version: `0.1.0-nightly.371.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.371.1

Today's nightly is almost entirely a rewrite of how Aura produces release changelog media. The old screenshot publishing stack — thousands of lines of workflows, seeds, and demo agent scaffolding — was retired in favor of a leaner Browser Use planning pipeline with hard quality and branding gates, a split-host capture flow, and signed stateless capture tokens on the server.

## 2:34 AM — Changelog media pipeline rebuilt on Browser Use planning

The legacy screenshot publishing workflows and demo seed scaffolding were removed and replaced with an Anthropic-planned, Browser Use-driven capture pipeline gated by explicit quality and branding checks.

- Retired the old changelog media publishing stack — four GitHub workflows (publish, retry, sync history, and media publishing), the 2,100-line publish-changelog-media script, demo agent brief/seed planners, and the produce-agent-demo-screenshots pipeline — in favor of a focused Browser Use planning flow with a new CaptureLoginView entry point and refreshed env configuration (ANTHROPIC_API_KEY, BROWSER_USE_API_KEY, AURA_CHANGELOG_CAPTURE_SECRET). (`888afbe`)
- Introduced hard quality and branding gates: captures must pass structural proof checks and an Anthropic vision judge before an SVG branding card is generated, and the documented policy now treats the raw product screenshot as the proof that cannot be cropped, zoomed, or regenerated. (`ff509bb`, `36a29c5`)
- Fixed the split-host capture entry so Browser Use can open the deployed frontend while talking to a separately hosted aura-os-server — buildCaptureLoginUrl and the preflight now carry an apiBaseUrl, and AURA_DEMO_SCREENSHOT_API_URL is documented for split deployments. (`e7b602e`)
- Made capture auth stateless for automated media runs: the server now mints and validates signed, time-bounded capture access tokens (blake3-keyed, 30-minute lifetime, v1-prefixed) and the Browser Use task can carry a seeded capture session in a redacted URL fragment instead of prompting for a secret. (`a3be62e`, `1fd2c56`)
- Bounded Browser Use runs with explicit timeout, polling interval, and cost caps (default 10-minute timeout, 2s interval) and taught the branding card to wrap long titles and subtitles within the layout so generated SVGs never overflow or truncate silently. (`36a29c5`, `9b716b4`)

## Highlights

- Retired the old changelog media publishing stack for a Browser Use planning pipeline
- Hard quality and branding gates now block weak or unbranded captures
- Stateless, signed capture tokens unblock Browser Use runs against real Aura

