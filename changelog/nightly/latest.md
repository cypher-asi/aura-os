# Model pricing catalog audit and Sonnet 5 introductory rates

- Date: `2026-08-12`
- Channel: `nightly`
- Version: `0.1.0-nightly.789.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.789.1

Today's nightly focuses on getting model cost accounting right across the board. A time-aware pricing schedule was introduced for Claude Sonnet 5, and a broader audit realigned per-token rates across OpenAI, xAI, Fireworks, and DeepSeek catalogs so cost estimates in the UI stay accurate.

## 7:22 AM — Time-aware Sonnet 5 pricing and a full provider catalog audit

A two-step pass on the model pricing layer: first a scheduled Sonnet 5 rate switch, then a broader realignment of rates across providers with the live cost banner now sourcing from the resolver.

- Claude Sonnet 5 now bills at introductory rates ($2 in / $10 out per Mtok) until September 1, 2026 UTC, after which it automatically switches to standard rates ($3 in / $15 out); the resolver accepts a timestamp and covers the full claude-sonnet-5-* family. (`6259444`)
- The Process sidekick's LiveRunBanner stopped hard-coding $3/$15 for cost estimates and now pulls rates through resolvePricing, so displayed run costs stay in sync with catalog changes. (`6259444`)
- A follow-up audit realigned per-token pricing across providers: GPT-5.6 Terra and Luna were repriced, xAI and Fireworks cache-read rates were tightened, DeepSeek v4 Pro/Flash/chat/reasoner rates dropped significantly, and deepseek-v4-pro and v4-flash were added to the Fireworks catalog. (`db913c4`)
- The audit also simplified the Sonnet 5 schedule in the benchmark pricing script back to a single introductory rate, keeping the authoritative time-based logic in the shared model-pricing module. (`db913c4`)

## Highlights

- Sonnet 5 introductory pricing wired into live cost estimates
- Full audit of provider pricing tables across OpenAI, xAI, DeepSeek, and Fireworks
- LiveRunBanner now uses resolved pricing instead of hard-coded rates

