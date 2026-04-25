# Browser Use rebuild of changelog media, plus a wave of new model pricing

- Date: `2026-04-24`
- Channel: `nightly`
- Version: `0.1.0-nightly.376.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.376.1

Today's nightly was dominated by a ground-up rebuild of how Aura captures and publishes changelog media, swapping the old Browserbase/Playwright pipeline for a Browser Use planning flow gated by quality and branding checks. Alongside that infra work, the model catalog picked up Fireworks open-weight pricing, first-class DeepSeek direct support, and GPT-5.5.

## 2:34 AM — Browser Use replaces the legacy changelog media pipeline

The old Browserbase/Playwright screenshot stack was retired in favor of an Anthropic-planned, Browser Use-driven capture flow with explicit quality and branding gates.

- Removed the legacy changelog media publishing stack — Browserbase capture, demo seed planner, agent-demo screenshot generator, and the retry/sync workflows — and replaced it with a Browser Use planning pipeline driven by an Anthropic-classified media plan, deleting roughly 20k lines of older capture code. (`888afbe`)
- Added independent quality and branding gates so a screenshot must pass a vision check before branding, and the final branded PNG must clear the same gate before it can publish, with chunked planner calls and a rescue pass to keep large changelogs from dropping entries. (`ff509bb`, `36a29c5`, `36ca8bb`, `9b716b4`)
- Hardened automated capture auth: the server now accepts stateless capture sessions, the trial harness seeds them through the URL fragment, and capture-login secrets are redacted from logs and Browser Use task transcripts. (`a3be62e`, `1fd2c56`, `e7b602e`)

## 5:09 AM — Safer handoff between media evaluation and publish

A small follow-up tightened how the evaluation pipeline hands accepted media off to the publish step.

- Added a safe publish handoff path in the changelog media evaluator and documented it in the Browser Use plan, so only fully gated assets advance toward publishing. (`d2bd4be`)

## 9:45 AM — Fireworks open-model pricing and a wired-up media publish workflow

Midday work brought the new Publish Release Changelog Media GitHub workflow online and added pricing coverage for Fireworks-hosted open models.

- Brought back a Publish Release Changelog Media workflow that runs after the changelog publish job completes, with high-resolution capture, branding, and quality libraries wired into a real publish-changelog-media script — and tightened the trial's desktop viewport floor to 1920×1080 with a 2560×1440 default. (`4535126`, `24208c6`)
- Expanded the server fee schedule from 7 to 15 models, adding Kimi K2.5/K2.6 and their turbo variants, Kimi K2 Thinking, Kimi K2 Instruct 0905, DeepSeek V3.2, and gpt-oss-120b, with normalization for `accounts/fireworks/models/*` and `accounts/fireworks/routers/*` IDs. (`916e38b`)

## 1:49 PM — DeepSeek as a first-class direct provider

DeepSeek moved from a Fireworks-hosted alias to a directly supported provider, and the older Fireworks DeepSeek V3.2 entry was retired from the picker.

- Added DeepSeek as a direct model provider: new `DEEPSEEK_API_KEY` wiring, a `deepseek/deepseek-v4-flash` default, and routing so `aura-deepseek-v4*` and `deepseek-v4*` model IDs resolve to the DeepSeek provider family while legacy `aura-deepseek-v3-2` still maps to Fireworks. (`9e377b5`)
- Taught the usage extractor to read OpenAI-style `prompt_tokens`/`completion_tokens` and DeepSeek's `prompt_cache_hit_tokens`/`prompt_cache_miss_tokens`, so token accounting and cache stats stay accurate across providers. (`9e377b5`)
- Removed the Fireworks-hosted DeepSeek V3.2 model from the picker and benchmark pricing now that direct DeepSeek is the supported path. (`dd65db9`)

## 9:01 PM — GPT-5.5 available in the model picker

Late-night change added GPT-5.5 as a selectable model with matching pricing.

- Added GPT-5.5 to the model constants, chat input picker, and benchmark pricing tables so it can be selected in chat and metered correctly against usage. (`19b65b7`)

## Highlights

- Changelog media pipeline rebuilt around Browser Use planning
- Fireworks Kimi, DeepSeek, and gpt-oss models gain pricing coverage
- DeepSeek direct provider and GPT-5.5 added to the model picker
- Stateless capture auth and seeded sessions harden automated screenshots

