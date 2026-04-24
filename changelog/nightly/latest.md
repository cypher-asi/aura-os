# Changelog media pipeline rebuilt around Browser Use

- Date: `2026-04-24`
- Channel: `nightly`
- Version: `0.1.0-nightly.367.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.367.1

Today's nightly retires the old screenshot-publishing machinery and replaces it with a leaner Browser Use–driven capture flow, complete with a dedicated capture login path, quality and branding gates, and support for split frontend/API hosts.

## 2:34 AM — Browser Use replaces the legacy changelog screenshot pipeline

The old Browserbase/Playwright demo-screenshot stack was torn out and replaced with a Browser Use planning flow, a dedicated capture-login surface, and new gates that decide when a shot is publishable.

- Retired the demo-screenshot publishing stack — including the publish, retry, and history-sync workflows plus ~20k lines of seed, planner, and screenshot-runner code — in favor of an Anthropic-planned, Browser Use–driven capture flow with a new server-side capture auth guard and CaptureLoginView. (`888afbe`)
- Added quality and branding gates to the changelog media pipeline: an Anthropic vision judge plus structural checks decide whether a screenshot passes proof, and only then is a branded SVG wrapper generated around the native-resolution product shot. (`ff509bb`)
- Fixed capture login for deployments where the frontend and aura-os-server live on different hosts by moving /capture-login onto a query-param entry in App.tsx and threading a new AURA_DEMO_SCREENSHOT_API_URL through the Browser Use trial and preflight. (`e7b602e`)

## Highlights

- Legacy demo-screenshot pipeline removed in favor of Browser Use planning
- New quality and branding gates guard published changelog media
- Capture login flow now works across split frontend and API hosts

