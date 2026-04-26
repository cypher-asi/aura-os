# Harness-driven automation, concurrent loops, and a floating desktop shell

- Date: `2026-04-25`
- Channel: `nightly`
- Version: `0.1.0-nightly.393.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.393.1

A heavy day for the autonomy stack: Aura's dev loop was rebuilt around the harness as the source of truth, legacy tool dispatchers and external CLI adapters were retired, and concurrent chats, automation loops, and ad-hoc task runs can now coexist per project. The desktop shell got a coordinated visual pass into floating glass panels, the run pane and chat got several reliability fixes, and the interface began a structured move into a shared/ module layout.

## 8:52 AM — Harness becomes the source of truth for tasks, loops, and tools

The bulk of the day reshaped autonomy: hardened the DoD gate and retry ladders, then replaced the in-server dev loop, agent tool dispatcher, and external CLI adapters with a single aura_harness pathway, while the desktop shell and chat surfaces got a coordinated UX pass.

- Rebuilt the dev loop around harness automatons: removed ~9k lines of in-server orchestration in favor of a thin adapter that delegates execution, recovery decisions, and DoD to the harness, and split the result into focused adapter/control/registry/streaming/signals modules. (`d8c2480`, `00d095e`, `71d1821`, `c1e87fb`, `f39dc74`, `49a1d45`, `c21106b`, `9e23bbc`)
- Retired the legacy agent tool dispatcher and external CLI agent adapters (claude_code, codex, gemini_cli, opencode, cursor); aura_harness is now the only supported runtime, with non-aura_harness adapters explicitly rejected and per-adapter UI, evals, and docs stripped out. (`53ace21`, `b43e4b8`, `c6174bb`)
- Hardened the autonomy retry stack before the rewrite: classified 5xx and stream-terminator errors as transient, added per-class cooldown escalation with jitter, a per-tool-call retry budget consuming tool_call_failed, and a stateful retry preamble so restarted automatons resume instead of redoing setup. (`9cb0c6a`, `7150cd3`, `8e75d47`, `f474edc`, `4424201`, `373be42`, `88fa94e`)
- Made the Definition-of-Done gate recoverable and accurate: empty-path write misfires no longer terminally fail when a real-path write lands, files_changed is inferred from tool events, tool_result + tool_call_snapshot is accepted as a fallback shape, and a DoD retry tier with a language-neutral follow-up prompt re-prompts agents that skipped a verification axis. (`a8e3e72`, `fcc6c98`, `f1c9dce`, `a2c218d`, `87e929c`, `70623bd`, `3bdb2b4`)
- Decoupled task completion from git push and added an Orbit ENOSPC guard: push failures emit push_deferred and project_push_stuck instead of demoting tasks to failed, with a 15-minute Orbit cooldown, an amber UI degraded indicator, and a remote-push-recovery runbook. (`73ab86f`, `f4425e2`, `fc08c18`, `5badbea`)
- Aligned aura-os with run_command-by-default and closed the binary_allowlist policy gap: the desktop sidecar ships a vetted AURA_ALLOWED_COMMANDS default, the external-harness probe checks /health policy fields, and DoD diagnostics now name the actual env knobs to set instead of "no build step was run". (`a41c273`, `5760d25`, `f1f4735`, `76d8a05`, `71304ce`, `abfb6d1`, `d29f248`, `ed55e37`)
- Introduced topic-scoped EventHub and LoopRegistry crates plus a /api/loops snapshot, re-keyed the in-memory automaton and task-output caches by (project, agent_instance) and (project, task), and rendered a unified LoopProgress indicator across agent rows, sidekick tabs, and per-task explorer rows. (`9860141`, `ac52a80`, `61eb586`, `82f93b3`)
- Unified the task state machine with storage via a safe_transition planner, added flat /api/tasks and /api/specs routes for harness clients, and made retry idempotent on ready so the dev loop's "Invalid status transition" 400 spew goes away. (`3809aeb`, `bd92f08`, `ef50887`)
- Plumbed structured failure context (provider_request_id, model, sse_error_type) end-to-end on task_failed and rendered it as a compact "req=… · model=… · api_error" label under the failure reason in the Run sidekick, with a golden test pinning the wire shape. (`aac1050`, `27aff59`, `1292936`, `cb96864`)
- Stopped a tight-loop reconnect on terminal harness errors and a harness WS slot leak: agent-stuck signals now classify as terminal, and AutomatonClient returns an RAII WsReaderHandle that closes the previous socket on every retry/adopt. (`4c01759`, `ee5d955`)
- Repainted the desktop shell into floating glass capsules: the bottom taskbar is split into three pills, the topbar and main panel float with rounded corners and a 2–5px gap that lets the desktop background show through, and corner radii are unified to 20px. (`065b565`, `d0bd776`, `de67ed6`, `8d8225f`, `3ace217`, `07c6832`, `b1c6453`, `6945fe7`, `078aca5`, `8494863`, `21373eb`, `b995cb2`, `eeba9fc`, `8fc9dbd`, `4474f6c`, `bce7a34`, `2251b35`, `fece144`, `2b608a7`, `d973798`)
- Rewrote run-pane and task-overlay scrolling around overflow-anchor + layout-effect commits to eliminate stream jank, reconciled stale active rows, lifted the cooking indicator above the bottom fade, and reserved space so trailing rows stay readable. (`0244c85`, `3089289`, `2509b9c`, `5019432`, `bf02505`, `206097d`, `09b8424`)
- Recovered mid-turn chat state across reloads: the server now emits an in_flight flag and throttled assistant_turn_progress, and the client preserves "tool calls only" turns, guards a 1.5s grace window against history races, and persists the sidekick preview in the URL. (`6021e18`, `2bb8f04`, `4c671f1`)
- Surfaced live tool-card retry state from harness ToolCallRetrying / ToolCallFailed events as "Writing retrying (n/8)…" and a "retried n/max" header on final failure, replacing the stuck "Writing code…" during upstream 5xx storms. (`4424201`, `d131349`)
- Tightened agent permissions and tool dispatch: project self-caps are auto-spliced on project-bound chats (with a persist_ctx fallback), every cross-agent dispatch stamps X-Aura-Project-Id and injects it server-side, and project_id was dropped from required schemas so the LLM no longer has to thread it. (`8d0d715`, `b6a066e`, `def464a`, `13acee2`, `6efa695`, `c477313`)
- Polished the desktop and browser surfaces: a native macOS app menu wires up Cmd+C/V/X/A/Z, custom titlebar drag works on macOS/Linux via tao IPC, the address bar restyles to a flat pill with DuckDuckGo fallback search, and main-frame load failures render a branded in-app error overlay instead of Chromium's. (`cc3193a`, `c2294d3`, `7837adb`, `1c155de`, `bd92f08`, `c1aad81`, `ed55e37`, `55eb3c7`)
- Added a chat copy button with cross-OS clipboard, hoisted live task status into a shared zustand store to fix a render-time setState loop, and stopped repeated sidekick output hydration from churning the event store. (`55eb3c7`, `26ed693`, `09b8424`)
- Introduced a delegated harness adapter crate (aura-os-harness) and tri-state tool approval + permission protocol messages, laying the groundwork for live tool catalogs and ask-state approvals. (`c21106b`, `53b2c16`, `3636203`)
- Phase F1 of the TS refactor converted EventType to a literal union, replaced any with unknown across the memory and skill APIs, dropped non-null assertions, and centralized parseEventContent in shared/utils. (`d5c36d9`)

## 11:35 PM — Desktop sidecar build scoped to the right package

Late-night fix to the release prep script so the bundled aura-node sidecar builds against aura-runtime instead of failing with "no bin target named aura-node".

- prepare-desktop-sidecar.mjs now passes -p aura-runtime alongside --bin aura-node so cargo can resolve the binary in the harness workspace and the desktop installer build stops failing. (`4da6c8c`)

## 11:40 PM — Migration into interface/src/shared/ for types, api, utils, lib, and hooks

Phase F2 of the interface refactor relocated domain-neutral modules out of interface/src/{types,api,utils,lib,hooks}/ into a new shared/ tree, with one false start that was reverted before landing the hooks move cleanly.

- Moved all 11 type DTOs (aura-events, entities, enums, events, ids, permissions, stream, …) into interface/src/shared/types/ and rewrote import paths across the codebase. (`7304dc3`)
- Relocated framework-agnostic API transports to shared/api/ (keeping app-specific aggregators in interface/src/api/) and later kept api/streams.ts in api/ because it imports stores/event-store handlers and would otherwise violate the shared/ no-stores rule. (`2a88e81`, `f71b9eb`)
- Moved generic utilities (formatters, error extraction, clipboard, image cropping, text normalization, explorer-tree filtering) and foundational lib modules (auth-token, browser-db, host-config, native-runtime, query-client, featureFlags) into shared/utils/ and shared/lib/. (`9c714cf`, `6be59f1`)
- Moved generic React hooks (use-click-outside, use-delayed-empty/loading, use-overlay-scrollbar, use-scroll-anchor-v2, use-highlighted-html, use-overflow-tabs, ws-reconnect) into shared/hooks/, after reverting an earlier CI-retrigger commit that had moved the files without rewriting their import sites. (`a53d32b`, `08ec42c`, `2320faf`)

## 12:22 AM — Project stats now decode tokens, time, and lines across key shapes

The project stats panel was showing Cost moving while Tokens, Time, and Lines stayed at zero; the storage client now accepts the camelCase, snake_case, and short-form keys aura-storage actually emits.

- ProjectStats gained serde aliases (tokensUsed, inputTokens, costUsd, …) for total/input/output tokens, cost, time, and lines; the stats body is also fetched as text with a debug log so future shape drift is diagnosable, with unit tests pinning all three naming conventions. (`da4436e`)

## 10:36 AM — Concurrent agent instances per project and a hardened changelog media pipeline

A second wave of platform work: agent instances gained Chat/Loop/Executor roles so chats, automation, and ad-hoc task runs no longer collide on the harness's one-turn-per-agent rule, while the changelog media capture pipeline was rebuilt around OpenAI image generation and stricter quality gates.

- Added an AgentInstanceRole foundation (Chat/Loop/Executor) and used it to allocate ephemeral Executor instances per ad-hoc run, lazily promote a Chat instance to the project's Loop, and sweep orphaned executor rows at startup — so two parallel chats, multiple concurrent task runs, and one automation loop per project all coexist. (`1102674`, `ae4801e`, `ed8d9f4`, `cf39422`, `4fd6873`)
- Scoped task panel and sidekick streaming state per project and agent instance, replaced the single streamingAgentInstanceId with a list, and bound automation-bar Start/Pause/Resume/Stop to the project's Loop instance so a chat reply no longer collides with a loop start. (`510205d`, `386a905`)
- Surfaced dropped main-thread chat streams instead of failing silently: the SSE writer logs lagged broadcasts and emits a synthetic stream_lagged error, the client renders a dedicated "Chat stream interrupted" banner with retry hint, and the post-stream history grace window grew from 1.5s to 5s. (`15777df`)
- Counted automation runs as sessions in storage so loop and single-task runs feed project stats, and added team avatar editing with a local-fallback override for hosts that drop avatar updates. (`298bb4c`, `41c586f`, `f67f9ab`, `13e4469`)
- Added a WebGL terminal renderer with a canvas fallback and 100k scrollback, swapped the sidekick terminal/command iconography to lucide's SquareTerminal, and grouped the sidekick drawer toggle with the native window controls. (`04806b2`, `e1ac283`, `4c5768e`, `629e58d`)
- Validated the desktop updater sidecar package contract in CI and the desktop build, so a misshapen sidecar archive can no longer ship into a nightly or stable updater bundle. (`63d4c89`)
- Rebuilt the changelog media capture pipeline around OpenAI gpt-image-2 production redraws with stricter quality, branding, and seed-plan gates, accepted sparse shell media proofs, preserved accepted proofs, and added historical media backfill targeting plus model-default updates. (`ee70b4b`, `dd065dd`, `0f84019`, `d55c704`, `88fd7cd`, `c68a9a7`)
- Polished the floating desktop shell further: rounded the main panel and content corners, aligned chrome heights, gave bottom taskbar pills consistent end padding, and softened the chat panel's top fade. (`f3c91d5`, `2f2adb6`, `27efe7a`, `711a391`, `6e17e33`, `b4525bf`, `3ab3327`, `f7f7bc2`, `e756ea5`)

## Highlights

- Dev loop rebuilt on harness automatons with concurrent Loop + Executor instances per project
- External CLI adapters and the legacy agent tool dispatcher removed in favor of aura_harness
- Desktop shell redesigned into floating glass capsules with unified corner radii
- Run pane, chat stream, and tool cards hardened against drops, retries, and cross-project bleed
- Interface began structured migration to interface/src/shared/{types,api,utils,lib,hooks}/

