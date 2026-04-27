# Concurrent agents, mobile iOS, and a unified Aura model proxy

- Date: `2026-04-26`
- Channel: `nightly`
- Version: `0.1.0-nightly.408.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.408.1

A heavy day across the stack: chat agents now run concurrently without colliding on harness turn-locks, iOS gets a proper first-class mobile shell isolated from desktop, model traffic consolidates onto the Aura proxy, and a long thread of reliability work hardens harness sidecar startup, capacity exhaustion, and dev-loop completion.

## 7:49 PM — Recoverable spec drafts on model timeout

Streamed spec markdown is preserved when create_spec is interrupted, and agent stream output gains better server-side observability.

- Timed-out create_spec runs no longer discard the partially streamed markdown — drafts stay recoverable in the interface, and agents are steered away from oversized spec payloads. (`11cc781`)
- Server now logs structured agent stream output summaries across the chat, persistence, and tool dispatch paths to make production debugging less guesswork. (`285f4bc`)

## 8:14 PM — Desktop refuses to launch with a broken local harness

The Desktop app now fails closed when the managed local harness sidecar never passes its startup health probe.

- If the local harness sidecar fails its startup health check, Desktop kills the managed process instead of proceeding with a half-broken backend, preventing a class of confusing post-launch errors on Mac, Windows, and Linux. (`e2d0540`)

## 8:18 PM — Aura-proxied models, generate_image, and a steadier desktop shell

A wide push consolidates model traffic onto the Aura proxy, ships a built-in image generation tool, and tightens the desktop shell, run pane, and streaming internals.

- All model traffic now routes through the Aura proxy: BYOK org-integration auth and direct provider catalog entries (Anthropic, OpenAI, Gemini, xAI, OpenRouter) are dropped, the chat model picker collapses to a single Aura group, and image-only models are filtered out of the chat picker. (`8b9fbd9`, `1a897b8`)
- gpt-image-2 becomes the default image model, and a new provider-less generate_image workspace tool lets chat agents fulfill natural-language image requests without the /image slash command, with mock-router tests covering happy path and upstream errors. (`03c1449`)
- The middle panel now stays mounted across app switches via a persistent DesktopShell main lane, eliminating the wallpaper-flash on navigation, while floating agent windows hide the cramped '/ for commands' hint. (`c48f160`, `b9f19d3`)
- Run pane reliability: rows are seeded from the authoritative project task list so reloads or cleared local storage no longer hide completed runs, and loop-instance tasks now appear regardless of the chat agent currently being viewed. (`6c1393c`, `5ba2be2`)
- Task output persistence stops repeatedly parsing localStorage during streaming by reusing a single IndexedDB connection and debouncing cache writes, noticeably reducing jank on long runs. (`bac6cf2`)
- Server hardening: stale auth fallback is capped, sensitive routes fail closed, harness WebSocket commands are now bounded with explicit delivery errors and redacted frame logging, and dev-loop runs receive the same normalized agent permissions as chat sessions. (`272818e`, `2af35f3`, `442fd8a`)
- list_agents is promoted to a first-class agent capability and new agent control callback endpoints land on the server, giving permission UI and orchestration explicit, granular handles. (`9fbbd1d`, `fe50f6a`)
- Large internal restructuring across server, crates, and the interface (auth_guard, app_builder, error mapping, entities, permissions, stream handlers, billing/leaderboard queries) sets up the day's later concurrency and capacity work without changing user-facing behavior. (`7b0b4c0`, `1e9b8ee`, `9d3f6f3`, `06af9e7`, `d4e0fa3`, `fbb7520`)

## 1:06 AM — Smarter changelog media planner

The internal changelog media-seeding pipeline learns from past misses and stops emitting low-signal candidates.

- Media planner now preserves intended targets, hardens its inference seeding against navigation-contract drift, and broadens surface coverage so generated changelog media maps to the right screens. (`697ed98`, `4561db0`, `6102050`)
- A new lessons knowledge file lets the planner learn from historical media misses, and token-only candidates are now skipped to avoid noisy seed plans. (`7941c91`, `80889ff`)
- CI re-triggered the desktop sidecar build after the harness ListAgents capability fix to confirm green packaging. (`9cd6bb3`)

## 4:16 PM — iOS becomes a first-class platform with a clean desktop boundary

Aura ships a real mobile iOS experience — dedicated screens, chat input, drawer, and bottom nav — and then isolates it from desktop so neither side regresses.

- First-class iOS views land across project agents, files, tasks, run, process, stats, profile, and settings, with a redesigned MobileChatHeader, MobileChatInputBar, MobileShell, drawer, and bottom nav, all validated against an iPhone simulator signoff matrix. (`8b9c310`)
- Mobile code is then extracted into a dedicated interface/src/mobile tree with a mobile-boundary test, a separate MobileSettingsView, and an explicit isMobileLayout route switch — fixing a regression where /projects/settings briefly rendered the mobile screen on desktop and proven by a route-by-route desktop signoff pass. (`e688532`)

## 9:01 PM — Per-instance harness partitioning ends 'turn in progress' collisions

A multi-phase concurrency overhaul gives each AgentInstance its own upstream harness turn-lock, queues serialized turns cleanly, and surfaces capacity errors as structured states in the UI.

- Each AgentInstance now sends a partitioned {template}::{instance} agent_id upstream, with template_agent_id preserved for skill, permissions, and billing lookups across chat routes, automaton start/run, project-tool sessions, and the in-memory chat session registry — two instances of the same template can finally run in parallel without colliding on the harness turn-lock. (`d0b0c53`, `04f9e58`, `4553edf`, `bb3f3c4`)
- A shared busy guard plus an SSE-level remap converts raw harness 'A turn is currently in progress' strings into a structured agent_busy event, and a per-partition turn slot serializes back-to-back sends with a one-deep queue and a queued progress hint instead of erroring mid-stream. (`4416794`, `3517fca`)
- The chat input now renders 'Queued behind current turn…' distinct from the busy spinner, useAgentBusy detects agent_busy uniformly across both chat routes (with a 'Stop the loop to chat' affordance and queue-full vs automation-running reasons), and harness-protocol TS mirrors the new template_agent_id wire field. (`415baf2`)
- AURA_HARNESS_WS_SLOTS (default 128) makes the upstream concurrent-session cap configurable end-to-end, and capacity exhaustion now surfaces as a structured 503 with retry_after_seconds rendered in the UI as 'Server is busy — try again in N seconds.' instead of a raw 503. (`0091faa`)
- End-to-end concurrent_agents integration tests plus a 32-partition stress test (≤2x single-stream wall clock, zero turn_in_progress observed) validate the contract, backed by a new FakeHarness scaffold that records SessionInits and replays scripted streams. (`9d459c6`)
- An AURA_PARTITION_AGENT_IDS rollout flag was briefly added and then removed once the wire turned out to be backward-compatible by construction, leaving partitioning unconditionally on. (`badccfa`, `e8a5c73`)
- Dev-loop completion gains a 'tests-as-truth' path: a CompletionContract failure with no file edits is bridged to Done when the event stream contains a successful test runner invocation (cargo test, pnpm test, vitest, pytest, go test, …), with the synthetic task_failed replaced by a task_completed carrying TestPassEvidence. (`b898808`)
- Chat now renders [auto-build: …] and [task_done test gate: …] prose markers as collapsible CommandBlock cards (with PASSED/FAILED state) instead of raw markdown, and trims half-typed pseudo-tool prefixes during streaming to avoid flicker. (`a0c1c97`)

## Highlights

- Per-instance harness partitioning unblocks truly concurrent agents
- First-class iOS mobile views with desktop isolation
- All model traffic routes through the Aura proxy
- Dev-loop accepts passing tests as completion proof
- Configurable WS slot cap with clean capacity-exhausted errors

