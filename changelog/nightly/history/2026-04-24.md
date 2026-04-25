# Browser Use takes over changelog media, plus DeepSeek and GPT‑5.5 model support

- Date: `2026-04-24`
- Channel: `nightly`
- Version: `0.1.0-nightly.378.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.378.1

Today's nightly is dominated by a major rewrite of how Aura produces release changelog media: the old Browserbase/Playwright screenshot pipeline was retired in favor of a Browser Use–driven flow gated by Anthropic planning and OpenAI vision checks. Alongside that infrastructure overhaul, the model catalog picked up DeepSeek direct pricing and a new GPT‑5.5 entry, and the Aura desktop apps gained richer agent-facing semantics for capture.

## 2:34 AM — Changelog media pipeline rebuilt around Browser Use

The legacy Browserbase/Playwright screenshot system was removed and replaced with a leaner Browser Use planning flow, fronted by new quality and branding gates and a stateless capture auth path on the server.

- Retired the old changelog media stack — including the publish, retry, and history-sync workflows, the demo screenshot runner, and the Browserbase-based capture scripts — and introduced a Browser Use trial runner, a media planner, and a navigation-contract sitemap as the new foundation (net ~16k lines removed). (`888afbe`)
- Added structural quality and branding gates so a screenshot must pass proof checks before a branded SVG card is generated, and the branded asset itself must clear separate layout checks before it's considered publish-ready. (`ff509bb`, `9b716b4`, `36a29c5`)
- Hardened the planner so large changelogs are chunked instead of truncated, omitted entries get a rescue pass, and Browser Use is only invoked after Anthropic classifies an entry as desktop, visual, sitemap-backed, and worth capturing. (`36ca8bb`)
- Reworked capture auth on the server with a new stateless `capture_auth` module and seeded capture sessions, and added a dedicated CaptureLoginView so Browser Use runs can authenticate without a persistent profile. (`e7b602e`, `1fd2c56`, `a3be62e`)

## 5:09 AM — Safer handoff from media evaluation to publish

A small follow-up formalized how an evaluated media candidate is passed to the publishing step.

- Added an explicit publish handoff stage in the media evaluation pipeline and documented it in the Browser Use plan, so only candidates that cleared all gates are forwarded for publication. (`d2bd4be`)

## 9:45 AM — Publish workflow, vision gates, and Fireworks pricing

The afternoon batch reintroduced an end-to-end publish workflow on top of the new pipeline, switched the final vision gate to OpenAI, and expanded benchmark pricing coverage for Fireworks open models.

- Rebuilt a Publish Release Changelog Media GitHub workflow that triggers off the upstream changelog publish, plus a `publish-changelog-media.mjs` script and high-resolution capture helper to drive end-to-end media generation. (`4535126`)
- Moved the final media vision gate to OpenAI so the branded PNG is judged by the same model used for branding, and added a hard reject for empty-state or low-content proofs. (`cdb612f`, `a9ab579`)
- Tightened Browser Use behavior with a 2560×1440 desktop viewport floor, sensitive-secret handling for the capture key form, and explicit session creation with keep-alive so captures don't fall back to a weak proof. (`24208c6`)
- Simplified the media card branding layout and added Fireworks open-model pricing coverage to benchmark tooling and the model catalog. (`e1c2792`, `916e38b`)

## 1:45 PM — DeepSeek direct provider and seeded capture plans

The model catalog gained a first-class DeepSeek path, the deprecated Fireworks DeepSeek V3.2 entry was dropped, and capture runs got scalable per-candidate seed plans wired into the Aura 3D apps.

- Added DeepSeek as a direct provider — including DEEPSEEK_API_KEY plumbing, a deepseek-v4-flash default, harness routing for `aura-deepseek-v4*` models, and benchmark pricing/usage support for DeepSeek's prompt cache hit/miss token fields. (`9e377b5`)
- Removed the Fireworks-hosted DeepSeek V3.2 model from the catalog, runtime, and pricing tables now that DeepSeek is wired up directly. (`dd65db9`)
- Introduced per-candidate capture seed plans and a `capture-bridge` in the interface, with new App Shell wiring and updates across the Aura 3D main, sidekick, image generation, and image preview panels so seeded sessions can deep-link into the right surface. (`4636e0d`)

## 8:59 PM — GPT‑5.5 support and tighter agent-facing semantics

Late-night work added GPT‑5.5 to the model lineup, taught the navigation contract about new agent context handles, and calibrated the high-resolution capture path with a curated lessons knowledge base.

- Added GPT‑5.5 as a selectable model with benchmark pricing entries and chat input wiring. (`19b65b7`)
- Extended the Aura navigation contract to recognize `data-agent-context`, `data-agent-context-anchor`, and `data-agent-proof` handles so capture targets bound the visible product boundary instead of grabbing oversized containers, with matching attributes added across Agent, Aura 3D, model generation, and chat input components. (`41ee76d`, `199fb2b`)
- Calibrated the compact high-resolution capture path and seeded a curated `lessons.json` knowledge base that the planner consults to avoid repeating known failure modes. (`7634cce`, `b62958e`)

## Highlights

- Old screenshot pipeline replaced by Browser Use planning
- Layered quality, branding, and vision gates for media
- DeepSeek direct pricing and GPT‑5.5 added to model catalog
- 2560×1440 desktop captures with seeded auth sessions

