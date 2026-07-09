# Grok 4.5 lands, plus quieter task alerts and authenticated swarm loops

- Date: `2026-07-09`
- Channel: `nightly`
- Version: `0.1.0-nightly.748.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.748.1

Today's nightly brings xAI's Grok 4.5 into the model catalog with full pricing and cache-key support, tightens task-completion notifications so you no longer get double-pinged when a run wraps, and hardens authentication for hosted swarm dev-loops.

## 11:28 PM — Authenticated control for hosted swarm dev-loops

Pause, stop, resume, and status calls now propagate the caller's JWT through to the hosted harness so swarm dev-loops running against remote harnesses no longer fail auth mid-run.

- Loop control endpoints (pause/stop/resume/status) now extract the caller's JWT and forward it through the dev-loop control path and detached-run lookup, fixing hosted harness auth for swarm dev-loops. (`103f263`)
- Introduced a dedicated harness_transport module and threaded a per-run harness_auth_token alongside the base URL so each loop target reconnects to its hosted harness with the correct credentials. (`103f263`)

## 1:19 AM — Grok 4.5 in the catalog and deduplicated task-completion alerts

The interface picks up xAI's Grok 4.5 as a first-class model with pricing and cache-key plumbing, and task-completion notifications now wait briefly to collapse duplicates from terminal loop events.

- Added Grok 4.5 to the model catalog with pricing ($2 in / $6 out per Mtok, $0.5 cache read), aura-grok-4-5 alias resolution, and provider cache-key affinity via xAI's x-grok-conv-id so prompt caching works end-to-end. (`f60b119`)
- Task-completion toasts and OS notifications now hold for a short dedupe window and suppress the redundant alert when the terminal task-run LoopEnded event arrives, so finishing a task no longer fires twice. (`bbddfd9`)

## Highlights

- Grok 4.5 available across the model catalog
- No more duplicate task-completion toasts
- Hosted swarm dev-loop control now carries auth

