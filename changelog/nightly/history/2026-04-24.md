# Changelog media pipeline rebuilt around Browser Use

- Date: `2026-04-24`
- Channel: `nightly`
- Version: `0.1.0-nightly.370.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.370.1

Today's nightly is almost entirely an infrastructure day: the old screenshot-publishing pipeline was torn out and replaced with a new Browser Use–driven capture flow, backed by a redesigned capture login entry point, signed stateless capture tokens on the server, and quality and branding gates that decide when a screenshot is actually ready to ship.

## 2:34 AM — Browser Use replaces the Browserbase screenshot pipeline

The changelog media system was rebuilt from the ground up: legacy publishing workflows and demo seed tooling were removed and replaced with a Browser Use planning flow, a seeded capture login entry point, signed stateless capture tokens, and new quality and branding gates.

- Retired the Browserbase-based changelog media stack — including the publish, retry, and history-sync GitHub workflows and roughly 20k lines of demo seed, screenshot runner, and publish-media scripts — in favor of a leaner Browser Use planning pipeline with a new CaptureLoginView and Anthropic-driven candidate selection. (`888afbe`)
- Added quality and branding gates that judge captured screenshots (including an optional Anthropic vision judge) and only produce a branded SVG media card once a shot passes proof checks, so the pipeline can mark runs publish-ready instead of shipping weak captures. (`ff509bb`, `9b716b4`)
- Taught the capture flow to handle split frontend and API hosts via a new AURA_DEMO_SCREENSHOT_API_URL, and to boot Browser Use straight into an authenticated desktop using a seeded capture session passed through the login URL fragment, with the secret redacted from logs and task prompts. (`e7b602e`, `1fd2c56`)
- Hardened capture authentication on aura-os-server with versioned, BLAKE3-signed access tokens that expire after 30 minutes and are validated statelessly by the auth guard, removing the need for a server-side session store during media runs. (`a3be62e`)

## Highlights

- Old Browserbase screenshot pipeline replaced with Browser Use planning
- Stateless, signed capture access tokens for media runs
- Quality and branding gates now decide when media is publish-ready

