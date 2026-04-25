# Browser Use takes over changelog media, plus DeepSeek and GPT‑5.5 pricing

- Date: `2026-04-24`
- Channel: `nightly`
- Version: `0.1.0-nightly.377.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.377.1

Most of today's nightly went into rebuilding how Aura captures and brands its own changelog screenshots — retiring the old Browserbase/Playwright pipeline in favor of a Browser Use–driven flow gated by Anthropic planning and OpenAI vision checks. Alongside that infrastructure work, the model catalog picked up native DeepSeek pricing and a new GPT‑5.5 entry in the chat model list.

## 2:34 AM — Changelog media pipeline rebuilt around Browser Use

The legacy Browserbase/Playwright screenshot pipeline was deleted and replaced with an Anthropic-planned, Browser Use–driven capture flow guarded by quality and branding checks.

- Removed the old changelog media publishing stack — including the publish-release-changelog-media, retry, and history-sync workflows plus ~20k lines of demo screenshot tooling — and replaced it with a Browser Use planning trial driven by new evaluate-changelog-media-pipeline and plan-changelog-media scripts. (`888afbe`)
- Introduced stateless capture authentication on the server with a new capture_auth module, AURA_CHANGELOG_CAPTURE_SECRET, and a dedicated CaptureLoginView so automated media runs can sign in without persisted sessions. (`888afbe`, `a3be62e`, `e7b602e`)
- Added independent quality and branding gates: raw screenshots, branded SVG cards, and final PNGs each pass structural and vision checks, with chunked Anthropic planning and an OpenAI-backed branding stage that only runs after proof gates pass. (`ff509bb`, `9b716b4`, `36a29c5`, `36ca8bb`)
- Switched media runs to seeded capture sessions so Browser Use lands directly inside an authenticated Aura desktop shell instead of getting stuck on the access-key form. (`1fd2c56`)

## 5:09 AM — Safe handoff between capture and publish stages

Added a guarded handoff so the evaluator only forwards assets to the publish step once they've cleared proof gates.

- Documented and implemented a safe publish handoff in evaluate-changelog-media-pipeline so branded media is only released downstream when capture and quality checks succeed. (`d2bd4be`)

## 9:45 AM — OpenAI vision gate and a workflow_run-triggered publisher

The publisher workflow was rewritten to chain off the changelog publish run, and vision gating moved to OpenAI with stricter rejection of empty-state proofs.

- Re-introduced a Publish Release Changelog Media workflow that triggers on workflow_run from the upstream changelog job, resolves the target from publish metadata, and runs a new publish-changelog-media script with high-resolution capture support. (`4535126`)
- Switched the changelog media vision judge to OpenAI and tightened branding so the same vision gate applies to both raw screenshots and the final branded PNG. (`cdb612f`, `e1c2792`)
- Hardened Browser Use task prompts with a sensitive-secret placeholder for the capture access key, raised the desktop viewport target to 2560×1440, and added quality rules that reject empty-state or weak proofs outright. (`24208c6`, `a9ab579`)
- Added Fireworks open-model pricing coverage to the benchmark pricing tables and dev-loop fee schedule. (`916e38b`)

## 1:45 PM — DeepSeek as a first-class provider and seeded capture plans

DeepSeek picked up direct provider routing and pricing, the older Fireworks-hosted DeepSeek V3.2 entry was retired, and capture runs gained scalable per-candidate seed plans.

- Added DeepSeek as a direct provider with its own DEEPSEEK_API_KEY routing, deepseek-v4 model family detection, and benchmark pricing/usage coverage in both the server dev-loop and the interface model constants. (`9e377b5`)
- Removed the Fireworks-hosted DeepSeek V3.2 model from the chat picker, pricing tables, and runtime routing now that DeepSeek is wired up directly. (`dd65db9`)
- Introduced normalized capture seed plans per media candidate, persisted alongside the navigation contract, and tuned branded-card padding so screenshots without a header get tighter framing. (`4636e0d`)
- Added data-agent-context and capture-bridge plumbing across AppShell and the Aura3D image generation surfaces so changed product features expose stable proof handles for screenshot navigation. (`4636e0d`)

## 8:59 PM — Late-night inference tightening and GPT‑5.5 in the chat picker

Closed out the day by sharpening navigation inference, recalibrating compact captures, and adding GPT‑5.5 to the model catalog.

- Added GPT‑5.5 to the interface model list, ChatInputBar picker, and benchmark pricing so it can be selected and costed end-to-end. (`19b65b7`)
- Hardened changelog media inference by teaching the navigation contract about data-agent-context, data-agent-context-anchor, and data-agent-proof handles, and surfaced those across AgentMainPanel, Aura3D, and ChatInputBar. (`41ee76d`)
- Calibrated the high-resolution capture path with a configurable changelog capture zoom and tightened compact-capture quality thresholds after the main merge. (`199fb2b`, `7634cce`)

## Highlights

- Old changelog screenshot pipeline replaced with Browser Use planning
- Stateless capture auth and seeded sessions for media runs
- Multi-stage quality and branding gates on every captured asset
- DeepSeek added as a first-class pricing/provider, GPT‑5.5 in chat picker

