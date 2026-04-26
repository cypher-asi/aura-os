# Harness-driven automation, concurrency isolation, and a redesigned desktop shell

- Date: `2026-04-25`
- Channel: `nightly`
- Version: `0.1.0-nightly.392.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.392.1

A heavy day across the stack: the dev loop was rebuilt around the harness as the source of truth, concurrent loops and tasks were isolated per project and agent instance, and the desktop shell got a sweeping visual refresh with floating capsules, rounded corners, and consistent gaps. Reliability work tightened retry ladders, push-failure handling, and stream recovery, while the interface gained a browser error page, in-app copy buttons, and durable mid-turn chat state.

## 8:52 AM — Dev loop rebuilt around the harness with isolated concurrent loops

A wide-ranging day reshaped automation, retries, the desktop shell, and chat resilience — culminating in retiring the legacy agent-tool stack and routing every loop through harness automatons.

- Retry ladders got dramatically smarter: transient 5xx and stream-terminated errors now classify as recoverable, project cooldowns escalate per-failure-class with ±20% jitter, single-task retries got a 3-attempt budget, completion-gate failures route through the infra retry path, and a dedicated tool-call retry tier (budget 8) consumes harness ToolCallRetrying / ToolCallFailed events with live "retrying n/8" UI on tool cards. (`9cb0c6a`, `7150cd3`, `373be42`, `88fa94e`, `f474edc`, `4424201`, `8e75d47`, `4c01759`)
- The Definition-of-Done gate became far more forgiving and accurate: empty-path writes are now recoverable when a real write lands, files_changed is inferred from tool events, tool_call_completed and tool_result+snapshot fallbacks both feed the gate, and a new DoD retry tier with a language-neutral follow-up prompt re-prompts the agent for missing build/test/fmt/lint axes before failing terminally. (`a8e3e72`, `fcc6c98`, `f1c9dce`, `a2c218d`, `87e929c`, `70623bd`, `3bdb2b4`)
- Push failures no longer demote tasks to failed: a new push_deferred event, project_push_stuck banner, and Orbit ENOSPC capacity guard with a 15-minute cooldown keep automation moving when the remote is out of disk, with a degraded Orbit indicator, retry-window labels, and a remote-push-recovery runbook for operators. (`73ab86f`, `f4425e2`, `fc08c18`, `5badbea`)
- Failure context is now end-to-end correlatable: provider_request_id, model, and sse_error_type are persisted on task_failed and rendered as a compact "req=… · model=… · api_error" label under the Run sidekick's failure reason, with single-task retries also carrying prior_failure into the next attempt's prompt. (`cb96864`, `aac1050`, `27aff59`, `1292936`, `d131349`)
- The desktop shell got a sweeping facelift: the bottom taskbar split into three floating glass capsules, the topbar and main content became inset rounded panels, sidebar/sidekick gaps unified to consistent insets, and corner radii aligned to 20px across the chat input, taskbar, and titlebar. (`065b565`, `d09c166`, `de67ed6`, `8d8225f`, `3ace217`, `07c6832`, `b1c6453`, `6945fe7`, `078aca5`, `8494863`, `21373eb`, `b995cb2`, `eeba9fc`, `8fc9dbd`, `4474f6c`, `bce7a34`, `2251b35`, `fece144`)
- Desktop platform polish: macOS gained a native app menu so Cmd+C/V/X/A/Z work in WebView, a custom titlebar drag bridge fixes window dragging on Mac and Linux, the Windows drag-resize flash now paints black instead of white, and --external-harness validates the harness /health policy at boot. (`cc3193a`, `c2294d3`, `c1aad81`, `ed55e37`, `f1f4735`, `a41c273`, `71304ce`)
- Browser and chat reliability: the in-app browser now renders a branded "Can't connect to server" overlay on main-frame load failures, the address bar searches DuckDuckGo for unresolved input, mid-turn chat state survives page refresh via in-flight session events, and the Run pane / Task Overlay scroll-jank was eliminated with overflow-anchor. (`bd92f08`, `1c155de`, `7837adb`, `6021e18`, `0244c85`, `07bbdc3`)
- Agent permissions and tool wiring became more forgiving: project-bound chats auto-splice ReadProject/WriteProject self-caps, project_id is injected from X-Aura-Project-Id headers (and dropped from required schemas), every capable tool now ships by default, and flat /api/tasks/:id and /api/specs/:id routes match the harness's HttpDomainApi expectations. (`8d0d715`, `b6a066e`, `def464a`, `13acee2`, `6efa695`, `c477313`, `bde1254`)
- Task state-machine transitions were unified with storage via a bridge-aware safe_transition helper, retry became idempotent on already-ready tasks, and a harness WS reader handle prevents the dev loop from exhausting the harness's 128-slot WebSocket cap on every restart. (`ef50887`, `3809aeb`, `ee5d955`)
- A topic-scoped EventHub and LoopRegistry now isolate chat, automation, task, process, and spec loops per (user, project, agent_instance), re-key the automaton registry and task-output cache to (ProjectId, AgentInstanceId), and feed a unified LoopProgress indicator across agent rows, the sidekick Tasks/Run tabs, and per-task explorer rows. (`9860141`)
- A major architectural cleanup retired the legacy agent-tool dispatcher, runtime, and templates crates, deleted external CLI adapters (claude_code, codex, gemini_cli, opencode, cursor) leaving only aura_harness, and routed automation, chat, and scheduled processes through harness automatons — net change of roughly -27k lines across these refactors. (`c21106b`, `9e23bbc`, `53ace21`, `d8c2480`, `00d095e`, `71d1821`, `c1e87fb`, `f39dc74`, `b43e4b8`, `49a1d45`)
- Sidekick and chat polish: copy buttons with cross-OS clipboard support landed on file/spec previews, historical tool markers render as collapsible Blocks in completed task overlays, assistant turns no longer disappear at end-of-stream, and the loop progress spinner keeps rotating in determinate mode. (`55eb3c7`, `cc4781d`, `2bb8f04`, `ac52a80`, `26ed693`, `efa2c79`, `3089289`)
- Project-agent rename from the sidebar context menu (and F2), credit-exhaustion now stops the dev loop terminally, no-change task completions are classified as completion-contract errors instead of triggering decomposition, and tool-input payloads are normalized so stringified arguments stop rendering as character-indexed JSON. (`efa2c79`, `95cd075`, `5fe6976`, `ad52832`, `cc71745`)
- TypeScript hygiene Phase F1: EventType converted to a string-literal union, `any` replaced with `unknown` (or JsonValue) across memory, agent skill, and harness panels, non-null assertions removed across process canvas, terminal, and shell code paths, and a shared parseEventContent helper deduplicated event-store casts. (`d5c36d9`)

## 11:32 PM — Shared module scaffolding for the F2 refactor

Reserved the new shared/ directory layout that subsequent F2 commits would populate.

- Created the interface/src/shared/{ui,hooks,api,types,lib}/ scaffolding (utils/ already existed from Phase F1) so domain-neutral code has an explicit home. (`207756c`)

## 11:35 PM — Desktop sidecar build scoped to aura-runtime

Fixed the harness sidecar build script after Cargo's --bin resolution rules tripped on the workspace layout.

- prepare-desktop-sidecar.mjs now passes `-p aura-runtime` alongside `--bin aura-node` so the desktop sidecar build resolves the binary against the right package instead of failing with "no bin target named aura-node in default-run packages". (`4da6c8c`)

## 11:40 PM — Interface F2 migration into shared/

Moved the framework-agnostic types, API transport, utilities, foundational libs, and generic React hooks out of feature folders and into the new shared/ tree.

- Relocated all 11 generic type files (events, entities, ids, permissions, stream, etc.) and 38 framework-agnostic API modules into shared/types/ and shared/api/, leaving app-coupled aggregators (feedback, marketplace, client) and the stores-coupled streams.ts in api/. (`7304dc3`, `2a88e81`, `f71b9eb`)
- Moved generic utilities (formatters, error extraction, clipboard, image cropping, text normalization, explorer-tree filters) into shared/utils/ and foundational libs (auth-token, browser-db, host-config, native-runtime, query-client, featureFlags) into shared/lib/. (`9c714cf`, `6be59f1`)
- Migrated app-agnostic React hooks — use-click-outside, use-delayed-empty/loading, use-overlay-scrollbar, use-scroll-anchor-v2, use-highlighted-html, use-overflow-tabs, ws-reconnect — into shared/hooks/, after a botched intermediate commit was reverted and re-landed cleanly. (`a53d32b`, `08ec42c`, `2320faf`)

## 12:22 AM — Project stats now decode every key shape from storage

Fixed the project stats panel where Tokens, Time, and Lines stayed at zero while Cost moved.

- ProjectStats deserialization gained serde aliases for camelCase, snake_case, and short-form variants (tokensUsed/inputTokens/costUsd, etc.) so the storage-side stats endpoint populates total tokens, input/output tokens, cost, time, and lines correctly, with the body logged at debug level for future shape drift. (`da4436e`)

## 10:36 AM — Multi-instance concurrency, dropped-stream recovery, and OpenAI-driven changelog media

A second wave landed AgentInstanceRole-based concurrency, surfaced silently dropped chat streams, hardened the desktop sidecar contract, and rebuilt the changelog media pipeline around production-grade OpenAI image generation.

- Concurrent chat, automation, and ad-hoc tasks now coexist per project: a new AgentInstanceRole (Chat/Loop/Executor) plus ephemeral Executor instances let parallel run_single_task calls, a project Loop, and chat sessions all share a project without colliding on the harness's one-turn-per-agent rule. A startup janitor sweeps orphaned executor rows and a Phase 3 integration test pins per-instance stop semantics. (`1102674`, `ae4801e`, `ed8d9f4`, `cf39422`)
- Task panel and sidekick streaming state was rescoped per project and per agent instance: LoopStopped/LoopFinished no longer marks unrelated projects' tasks completed, and streamingAgentInstanceId became a list so two concurrent streams keep their indicators independently. AutomationBar/useLoopControl now bind to the project's resolved Loop instance instead of the URL's chat instance. (`510205d`, `386a905`)
- Silently dropped main-thread chat streams now surface explicitly: the server emits a stream_lagged SSE error when the harness broadcast outpaces the writer, the client classifies idle-timeout and stream_lagged as a "Chat stream interrupted" banner via a new SSEIdleTimeoutError type, and the post-stream history grace window grew from 1.5s to 5s to cover real persistence lag. (`15777df`)
- Release tooling tightened: the desktop updater sidecar package contract is now validated in CI (desktop-validate, release-nightly, release-stable), the changelog media workflow's skip and capture gates were hardened, and the bottom taskbar got unified TaskbarIconButton styling — later balanced with a consistent inner padding pass after edge-rounding was rolled back. (`63d4c89`, `ee70b4b`, `6e17e33`, `b4525bf`)
- Org/team avatars can now be uploaded from settings and shown in the topbar selector, with a local IndexedDB fallback for hosts that drop avatar updates. The sidekick toggle was grouped with the native window controls, the chat top fade softened, terminal got a WebGL renderer with canvas fallback and 100k scrollback, and the lucide Terminal icon was replaced with SquareTerminal across blocks, sidekick, marketplace, and skill rows. (`41c586f`, `f67f9ab`, `4c5768e`, `04806b2`, `629e58d`, `f7f7bc2`, `e756ea5`, `e1ac283`)
- Dev-loop automation now creates, updates, and ends storage session rows so loop and single-task runs count toward project stats, and the capture-auth demo agent stamps the Chat instance role explicitly. (`298bb4c`, `4fd6873`)
- The changelog media pipeline was overhauled to require OpenAI image generation (gpt-image-2, 2560x1440) for publishable assets — legacy SVG/PNG screenshot wrappers are now blocked, accepted media proofs are preserved across runs, historical backfills can be retargeted, and sparse shell-only proofs are accepted with explicit gates. (`dd065dd`, `0f84019`, `d55c704`, `88fd7cd`)
- Desktop chrome refinements: main panel and content radii were tuned to 6px, the topbar align rail was widened to 44px to match the nav rail, terminal content keeps clearance above the sidekick fade, and pill sections regained consistent end padding. (`f3c91d5`, `2f2adb6`, `27efe7a`, `711a391`, `3ab3327`, `13e4469`, `629e58d`)

## Highlights

- Harness now owns task DoD; legacy adapters and 13k+ lines of duplicate logic retired
- Concurrent chat, loop, and ad-hoc tasks isolated per project and agent instance
- Desktop shell redesigned with floating capsules, rounded corners, and unified gaps
- Smarter retry ladders, push-deferred handling, and Orbit ENOSPC remediation
- New browser error overlay, copy buttons, and crash-resistant mid-turn chat state

