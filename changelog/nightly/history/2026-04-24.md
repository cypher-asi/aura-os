# Browser Use rebuild of changelog media and DeepSeek pricing support

- Date: `2026-04-24`
- Channel: `nightly`
- Version: `0.1.0-nightly.375.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.375.1

Today's nightly replaces the old screenshot pipeline with a Browser Use–driven changelog media system gated by independent quality and branding checks, and broadens model pricing coverage with new DeepSeek direct support and Fireworks open-model rates. Desktop builds for Mac, Windows, and Linux shipped alongside these changes.

## 2:34 AM — Changelog media pipeline rebuilt on Browser Use

The legacy screenshot pipeline was torn out and replaced with a Browser Use–first media system backed by seeded capture sessions and multi-stage quality gates.

- Retired the old Browserbase-based screenshot workflows and their supporting demo-agent seeding code, replacing them with a Browser Use planning trial, an Aura navigation contract, and a new capture-login view; the server now exposes a dedicated capture_auth path so automated runs can authenticate without leaking secrets. (`888afbe`, `a3be62e`)
- Added independent branding and quality gates — raw screenshots, branded SVG cards, and final branded PNGs each pass their own structural and vision checks before anything is considered publish-ready. (`ff509bb`, `36a29c5`, `36ca8bb`)
- Media runs now use seeded capture sessions passed through the URL fragment, with captureSession values redacted from task prompts and Browser Use message logs so secrets never land in artifacts. (`1fd2c56`, `e7b602e`)
- Hardened the planner so large changelogs are chunked instead of truncated, omitted entries get a rescue pass, and lower-priority candidates are recorded as explicit skips rather than silently dropped; added sharp for real image processing in branding. (`36ca8bb`, `9b716b4`)

## 5:09 AM — Safer publish handoff for media runs

A documented handoff step ensures media is only handed to publish after passing the full evaluator chain.

- Extended the evaluator with a safe publish handoff stage and documented the gate in the Browser Use plan, so media only advances to publish after capture, branding, and vision checks all succeed. (`d2bd4be`)

## 9:45 AM — Higher-resolution capture and Fireworks open-model pricing

The media pipeline moved to 2560×1440 captures with a real publish script, and the server's fee schedule grew to cover Fireworks-hosted open models.

- Bumped the desktop capture viewport to 2560×1440 (1920×1080 minimum), taught the Browser Use task to handle capture-secret prompts via sensitive-data placeholders, and reintroduced a proper publish-release-changelog-media workflow that chains off the changelog publish run with artifact-based metadata. (`24208c6`, `4535126`)
- Added a high-resolution capture library and a real publish-changelog-media script with tests, wiring the evaluator, planner, and branding stages into a single end-to-end publishing path. (`4535126`)
- Expanded the server fee schedule from 7 to 15 models, adding pricing for Kimi K2.5/K2.6 (including turbo and thinking variants), Kimi K2 Instruct 0905, DeepSeek V3.2, and GPT-OSS 120B, and taught model-ID normalization to handle Fireworks account and router prefixes. (`916e38b`)

## 1:49 PM — DeepSeek direct provider support

DeepSeek is now a first-class provider family with its own API key, default model, and usage accounting, while the older Fireworks-hosted DeepSeek V3.2 entry was retired from the model list.

- Added DeepSeek as a recognized provider family with DEEPSEEK_API_KEY wiring, a deepseek-v4-flash default, and provider-family routing that distinguishes aura-deepseek-v4 direct models from the Fireworks-hosted aura-deepseek-v3-2 path. (`9e377b5`)
- Taught usage extraction to accept DeepSeek-style prompt_tokens, completion_tokens, and prompt_cache_hit/miss fields so benchmark pricing and token accounting work against DeepSeek's native API shape. (`9e377b5`)
- Removed the Fireworks-hosted DeepSeek V3.2 model from the public model list now that direct DeepSeek access is available. (`dd65db9`)

## Highlights

- Changelog media pipeline rebuilt around Browser Use planning
- Independent vision, branding, and layout gates before any media publishes
- DeepSeek added as a first-class pricing and provider family
- Fireworks open models (Kimi K2, DeepSeek V3.2, GPT-OSS 120B) now priced

