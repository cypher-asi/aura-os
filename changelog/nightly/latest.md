# Changelog media pipeline reset and Fireworks pricing coverage

- Date: `2026-04-24`
- Channel: `nightly`
- Version: `0.1.0-nightly.372.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.372.1

Today's nightly tears out the old screenshot-publishing stack and replaces it with a leaner Browser Use planning pipeline gated by hard quality checks, then closes the day by broadening dev-loop cost accounting to Fireworks-hosted open models.

## 2:34 AM — Changelog media pipeline rebuilt around Browser Use

The sprawling demo-screenshot pipeline was removed and replaced with a smaller Browser Use planning flow, then hardened through the morning with auth, quality, branding, and split-host fixes.

- Retired the legacy changelog media publishing stack, deleting the publish, retry, and history-sync workflows along with thousands of lines of demo screenshot seeding and runner code, and replaced it with an Anthropic-planned Browser Use trial plus a new CaptureLoginView entry point. (`888afbe`)
- Rebuilt capture authentication as stateless, signed tokens: short-lived BLAKE3-keyed access tokens (30-minute max age, versioned payloads) are now minted and validated server-side, and the auth guard transparently resolves them into capture sessions. (`a3be62e`, `888afbe`)
- Added hard publish gates for captured media: an Anthropic vision judge, structural quality checks, and a deterministic SVG branding step that wraps — rather than regenerates — the real product screenshot, with failures surfaced as explicit blocked/ready-but-not-run states. (`ff509bb`, `9b716b4`, `36a29c5`)
- Fixed capture entry for split frontend/API deployments by threading an optional AURA_DEMO_SCREENSHOT_API_URL through the login URL, preflight, and Browser Use task, and switched runs to use seeded capture sessions carried in a redacted URL fragment so secrets never leak into task logs. (`e7b602e`, `1fd2c56`)
- Bounded Browser Use runs with explicit timeout, polling interval, and cost-cap options (defaulting to 10 minutes) so release CI can no longer hang on a runaway agent session. (`36a29c5`)

## 11:35 AM — Fireworks-hosted open models priced in the dev loop

The server-side usage cost estimator now understands Kimi, DeepSeek, and GPT-OSS models served through Fireworks, so dev-loop spend reporting stays accurate for open-weights routes.

- Expanded the default fee schedule from 7 to 15 models, adding per-token input, output, and cache rates for kimi-k2p6 and k2p5 (including turbo and thinking variants), kimi-k2-instruct-0905, deepseek-v3p2, and gpt-oss-120b. (`916e38b`)
- Taught the pricing model-id normalizer to strip accounts/fireworks/models/ and accounts/fireworks/routers/ prefixes and to map Aura-branded aliases (aura-kimi-k2-6, aura-kimi-k2-5, aura-deepseek-v3-2, aura-oss-120b) onto their underlying Fireworks IDs so billing matches regardless of how the model is referenced. (`916e38b`)
- Surfaced the same Fireworks pricing table to the interface benchmark tooling and model constants so client-side cost comparisons stay in lockstep with the server. (`916e38b`)

## Highlights

- Legacy demo screenshot stack retired in favor of Browser Use planning
- Capture auth rebuilt around signed, short-lived stateless tokens
- Quality, branding, and cost gates now guard every media run
- Dev-loop pricing now covers Kimi, DeepSeek, and GPT-OSS on Fireworks

