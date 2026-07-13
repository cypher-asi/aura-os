# Aura Web Search launches with Grok 4.5 and quieter task alerts

- Date: `2026-07-09`
- Channel: `nightly`
- Version: `0.1.0-nightly.749.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.749.1

Today's nightly headlines a new built-in Web Search backed by Aura-funded Brave credentials, alongside a smarter task-completion notifier and a fresh Grok 4.5 entry in the model catalog. Server-side, hosted dev-loop harness calls now carry proper auth end-to-end.

## 11:28 PM — Hosted dev-loop harness now forwards caller auth

The dev-loop control path now threads the caller's JWT through pause, stop, resume, and status so hosted swarm harnesses accept the request.

- Pause, stop, resume, and status handlers now extract the caller's JWT and pass it into control_loop and detached-run lookups, so hosted swarm harnesses receive an authenticated request instead of failing anonymously. (`103f263`)
- Added a dedicated harness_transport module and a per-run harness_auth_token on run handles, giving the server a single place to attach credentials when talking to remote harnesses. (`103f263`)

## 1:19 AM — Quieter task completions and Grok 4.5 in the picker

The notifications hook now debounces task-completed events against the terminal loop event, and Grok 4.5 joins the model catalog with pricing and cache-key support.

- Task completion toasts and desktop notifications are held for a short dedupe window and suppressed when the matching task-run LoopEnded event arrives, eliminating the duplicate 'task completed' popups that fired for the same run. (`bbddfd9`)
- Added Grok 4.5 to the model catalog and pricing tables (input $2 / output $6 per Mtok, with cache read/write rates), including the aura-grok-4-5 alias and xai/grok-4.5 normalization. (`f60b119`)
- Extended prompt-cache affinity docs and plumbing to cover xAI/Grok alongside OpenAI, so stable cache keys now flow through aura-router for Grok conversations as well. (`f60b119`)

## 9:47 PM — Aura Web Search ships with tiered quotas and optional BYOK

Brave-backed web and news search is now available by default via Aura-funded credentials, with per-tier quotas, HTTPS-only billing checks, and an opt-in workspace BYOK path.

- Web and news search are now on by default using a platform-funded Brave key held server-side, with per-user tier quotas enforced from z-billing and organization membership checks gating access. (`66b327d`)
- Workspaces can still bring their own Brave key: connected org-owned credentials stay encrypted in aura-integrations and bypass the Aura-funded quota, with new test coverage for stale BYOK shadows and exact credential routing. (`66b327d`)
- Desktop builds now route tool actions through a configurable AURA_PLATFORM_TOOL_ACTION_BASE_URL (default https://api.aura.ai), wired into desktop-validate, nightly, and stable release workflows so packaged agents call the authenticated cloud endpoint. (`66b327d`)
- Billing transport is hardened to require validated HTTPS endpoints before transmitting authentication, and a new tool_action_rate_limit module plus expanded org_tools tests lock in quota, canonical-failure, and HTTPS-only behavior. (`66b327d`)

## Highlights

- Aura Web Search ships with tiered quotas and BYOK
- Grok 4.5 added to the model catalog
- Task completion notifications no longer double-fire
- Hosted dev-loop harness auth fixed

