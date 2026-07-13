# Web search, agent memory continuity, and a smoother Mac update handoff

- Date: `2026-07-13`
- Channel: `nightly`
- Version: `0.1.0-nightly.757.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.757.1

Today's nightly brings two headline capabilities — built-in Aura Web Search with tiered quotas and a new Agent Continuity surface backed by memory-retrieval evidence — alongside a targeted macOS updater fix, a cloud identity resolution repair for tool callbacks, and an expanded model catalog featuring GPT-5.6.

## 9:47 PM — Aura Web Search launches with platform-funded quotas and BYOK

Brave-backed web and news search is now available to every workspace by default, funded by Aura credentials and gated by per-tier quotas, while workspaces that bring their own Brave key keep full control.

- Enabled Brave-backed web and news search out of the box using Aura-funded credentials, with organization membership checks and per-user tier quotas enforced through z-billing. (`66b327d`)
- Kept the platform Brave key strictly server-side: desktop requests are routed through aura-api via a new AURA_PLATFORM_TOOL_ACTION_BASE_URL, and billing calls are hard-gated to validated HTTPS endpoints before any credentials are transmitted. (`66b327d`)
- Preserved optional workspace BYOK so connected org-owned Brave keys continue to live encrypted in aura-integrations and bypass the Aura-funded quota entirely. (`66b327d`)
- Wired the new platform tool-action base URL into desktop validate, nightly, and stable release workflows so packaged builds resolve the correct authenticated endpoint. (`66b327d`)

## 4:26 AM — Cloud tool callbacks now resolve the caller's Aura Network identity

Direct cloud tool-action callbacks that skip the session-enrichment endpoint can now correctly match the caller to an org role, unblocking Web Search and other platform tools from cold JWTs.

- When a zOS JWT identity doesn't match any org member during a role check, the server now fetches the current user from Aura Network, adds that ID to the candidate list, and caches the resolved network_user_id and profile_id on the validation cache for later callbacks. (`c394e57`)
- Added an end-to-end integration test that drives a Brave web-search tool action through a fresh cloud callback and asserts the Aura Network identity is resolved and cached. (`c394e57`)

## 6:39 AM — macOS updater waits for shutdown before relaunching Aura

The macOS auto-update flow no longer races LaunchServices — a small handoff process now waits for the current Aura process to exit before opening the updated bundle.

- Replaced the immediate `open -n` relaunch with a shell handoff that polls until the parent PID disappears (up to a 30-second ceiling) and only then execs `/usr/bin/open` on the updated bundle, preventing LaunchServices from seeing the old instance as still running. (`c8307f1`)
- Applied the same deferred handoff to the `/Applications` relocate-and-relaunch path so first-run installs out of a translocated location reopen cleanly after shutdown, with handoff PIDs recorded in updater diagnostics. (`c8307f1`)

## 7:06 AM — GPT-5.6 family lands with a new XHigh reasoning tier

The model catalog picks up three GPT-5.6 variants and a distinct XHigh reasoning effort that sits between High and Max instead of being folded away.

- Added gpt-5.6-sol, gpt-5.6-terra, and gpt-5.6-luna to the OpenAI catalog with per-model input/output and cache pricing wired into benchmark and pricing tables. (`f0aebe9`)
- Promoted `xhigh` to a first-class ReasoningEffort tier in the aura-protocol runtime request and TypeScript bindings, so GPT-5.6 exposes distinct XHigh and Max budgets instead of collapsing xhigh into high as before. (`f0aebe9`)
- Reframed the ReasoningEffort documentation as a provider-neutral superset, clarifying that Aura Router maps Minimal to `none` for current OpenAI models and translates each tier into the provider's native control. (`f0aebe9`)

## 2:54 PM — Agent Continuity controls and retrieval evidence in the Memory tab

Agents gain a dedicated continuity surface — configuration, approval and correction controls, and a look at what the retriever actually pulled — backed by a new harness proxy and browser-tested flows.

- Introduced continuity configuration plus approval and correction controls in the Agent Info panel's Memory tab, expanding MemoryTab and MemoryPreview with a substantial new UI and analytics coverage. (`fb16613`)
- Exposed the latest retrieval trace so users can see the evidence behind an agent's recall, powered by a new GET `/memory/retrieval/latest` proxy endpoint. (`fb16613`)
- Added authenticated harness proxy routes for reading and updating per-agent memory continuity configuration (`GET`/`PUT /api/harness/agents/:agent_id/memory/continuity`), with mock coverage and forwarding tests. (`fb16613`)
- Locked in the new flows with a Playwright end-to-end suite (`agent-continuity.spec.ts`) and expanded authenticated-app test helpers. (`fb16613`)

## Highlights

- Aura Web Search ships by default with tiered quotas and optional BYOK
- Agent Continuity controls with retrieval evidence in the Memory tab
- macOS relaunch now waits for full shutdown before reopening
- GPT-5.6 (sol, terra, luna) added with a new XHigh reasoning tier

