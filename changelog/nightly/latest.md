# Browser Use takes over changelog media capture

- Date: `2026-04-24`
- Channel: `nightly`
- Version: `0.1.0-nightly.373.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.373.1

Today's nightly is dominated by a ground-up rebuild of how Aura produces changelog media: the old screenshot pipeline is gone, replaced by a Browser Use–driven flow guarded by quality, branding, and auth gates. The server side also picked up Fireworks-hosted open model pricing so Kimi, DeepSeek, and GPT-OSS usage is now billable alongside the existing Anthropic and OpenAI lineup.

## 2:34 AM — Changelog media pipeline rebuilt on Browser Use

The legacy demo-screenshot stack was deleted in favor of an Anthropic-planned, Browser Use–driven capture flow with strict quality and branding gates.

- Retired the old media publishing stack — removing the publish/retry/sync media workflows, the Playwright demo seeder, and thousands of lines of produce-agent-demo-screenshots scaffolding — and replaced it with a focused Browser Use planning flow plus a new CaptureLoginView for authenticated capture sessions. (`888afbe`)
- Added first-class quality and branding gates: an Anthropic vision judge for raw screenshots, deterministic SVG branded media cards, and structural layout checks that a branded asset must pass before it can publish. (`ff509bb`, `9b716b4`)
- Hardened Browser Use runs with explicit timeouts, cost caps, and interval controls so release CI can no longer hang for hours on a stuck agent, and codified a quality policy that forbids cropping, zooming, or regenerating product UI. (`36a29c5`)
- Taught the planner to chunk large changelogs, rescue omitted entries, and skip low-priority candidates safely, and bumped the desktop capture viewport to 2560×1440 (min 1920×1080) for sharper proofs — backed by a sharp-powered image toolchain. (`36ca8bb`)
- Introduced stateless capture auth on the Aura server and seeded capture sessions encoded in the login URL fragment, so Browser Use agents can reach the desktop shell without ever seeing or logging the capture secret. (`a3be62e`, `1fd2c56`, `e7b602e`)

## 5:09 AM — Safe handoff from capture to publish

A small but deliberate addition that formalizes when a branded asset is allowed to cross from evaluation into the publish step.

- Documented and wired a safe publish handoff in the changelog media evaluator, so branded outputs only move forward once both the raw screenshot and the final branded PNG have cleared their independent quality gates. (`d2bd4be`)

## 9:45 AM — Publish pipeline rewired and Fireworks pricing lands

The afternoon brought the new publish workflow online and extended server-side usage pricing to Fireworks-hosted open models.

- Reintroduced the Publish Release Changelog Media workflow as a downstream of Publish Release Changelog, gated on upstream success and driven by published metadata artifacts, alongside a new publish-changelog-media script and high-resolution capture helper. (`4535126`)
- Tightened the media quality gates further with additional branding, navigation-contract, and evaluator checks so weak or malformed candidates are rejected before they reach the publish stage. (`24208c6`)
- Added server-side pricing coverage for Fireworks-hosted Kimi K2 (p5, p6, turbo, thinking, instruct-0905), DeepSeek V3.2, and GPT-OSS-120B, including aura-* aliases and `accounts/fireworks/models|routers/` prefix normalization, so usage cost estimation now matches these models end to end. (`916e38b`)

## Highlights

- Legacy demo screenshot pipeline replaced with Browser Use planning
- New quality, branding, and high-res gates for changelog media
- Seeded capture sessions and stateless capture auth for CI runs
- Fireworks open model pricing (Kimi, DeepSeek, GPT-OSS) wired into billing

