# Autonomous loop hardening, harness consolidation, and a glassier desktop shell

- Date: `2026-04-25`
- Channel: `nightly`
- Version: `0.1.0-nightly.399.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.399.1

A heavy day across the autonomous dev loop, the harness boundary, and the desktop shell. The server learned to keep tasks running through provider 5xx storms, push outages, and harness policy lock-downs; the agent runtime collapsed onto a single aura_harness path and gained per-instance concurrency; and the interface picked up a floating glass desktop, a real browser error overlay, and tighter chat/sidekick streaming behavior. Late in the day a large refactor split the monorepo into smaller modules and moved generic frontend code into a shared/ tree.

## 8:52 AM — Resilient autonomous dev loop with harness-first execution

The bulk of the day rebuilt the autonomous dev loop around the harness: tasks now survive transient provider errors, push outages, kernel policy denials, and DoD misfires, and the runtime is consolidated onto a single aura_harness path with per-instance concurrency primitives.

- Classified provider 5xx, stream-terminated, and rate-limit errors as transient and gave them their own retry ladders, escalating cooldowns with ±20% jitter, a per-task SINGLE_TASK_RESTART_BUDGET=3, and a TOOL_CALL_RETRY_BUDGET=8 that consumes the harness's tool_call_retrying / tool_call_failed events. (`9cb0c6a`, `7150cd3`, `373be42`, `88fa94e`, `f474edc`, `4c01759`)
- Made the Definition-of-Done gate recoverable and operator-actionable: empty-path write misfires no longer permanently fail a task once a real write lands, files_changed is inferred from successful tool events, kernel-policy denials (run_command, allow_shell, binary_allowlist) short-circuit to a specific diagnostic, and a new DoD retry tier re-prompts the agent with a language-neutral follow-up before giving up. (`a8e3e72`, `fcc6c98`, `f1c9dce`, `a2c218d`, `5760d25`, `70623bd`, `3bdb2b4`, `71304ce`)
- Decoupled task completion from git push: failed pushes now emit push_deferred / project_push_stuck events with retry hints instead of demoting tasks, an Orbit ENOSPC guard trips a 15-minute cooldown with an amber UI banner, and the Run sidekick surfaces push-deferred and rolled-back commits, retry attempts, and provider request_id / model context on failed turns. (`73ab86f`, `f4425e2`, `fc08c18`, `5badbea`, `d131349`, `8e75d47`, `27aff59`, `13acee2`)
- Unified the task state machine with aura-storage via a single safe_transition helper, added flat /tasks and /specs routes for harness clients, made retry idempotent on ready, persisted durable sync checkpoints across push recovery, and fixed harness WebSocket leaks that were exhausting the 128-slot cap on every infra retry. (`3809aeb`, `bde1254`, `ef50887`, `a69f2e3`, `68be945`, `ee5d955`)
- Consolidated the agent runtime onto aura_harness: deleted the legacy agent-tool dispatcher, agent-runtime, and agent-templates crates, removed the Claude Code / Codex / Gemini / OpenCode / Cursor adapter pathway from runtime, UI, evals, and docs, and routed scheduled process work and chat turns through the new aura-os-harness session bridge. (`c21106b`, `9e23bbc`, `53ace21`, `d8c2480`, `c1e87fb`, `f39dc74`, `b43e4b8`, `49a1d45`)
- Introduced topic-scoped EventHub and LoopRegistry crates so chat, automation, task, and process loops are tracked per (project, agent_instance) instead of fanning through one global broadcast, and re-keyed the automaton registry / task output cache to (ProjectId, AgentInstanceId) / (ProjectId, TaskId) to remove cross-agent bleed. (`9860141`)
- Closed two long-standing project-scoped tool gaps: agent chat sessions now auto-splice ReadProject/WriteProject self-caps from either the request body or the persisted project binding, and the cross-agent dispatcher injects project_id from the X-Aura-Project-Id header so list_specs / create_spec / create_task no longer fail with "Tool not allowed". (`8d0d715`, `b6a066e`, `def464a`, `13acee2`, `6efa695`, `c477313`)
- Rebuilt the desktop shell into a floating-glass layout: bottom taskbar split into three rounded capsules, topbar/sidebar/sidekick gain margins and 20px rounded corners, the run pane uses CSS overflow-anchor instead of MutationObserver tricks to stop the up-then-down scroll blink, and Cmd+C/V/X/A/Z plus a custom titlebar drag now work on macOS and Linux WebViews. (`065b565`, `d09c166`, `8d8225f`, `3ace217`, `07c6832`, `4474f6c`, `bce7a34`, `0244c85`, `cc3193a`, `c2294d3`, `c1aad81`)
- Browser gets a real failure path: main-frame load errors render a dark Aura-branded "Can't connect" overlay with Ask Agent / Reload, and unresolved address-bar input now falls through to a DuckDuckGo search instead of being dropped silently. (`bd92f08`, `1c155de`, `7837adb`)
- Chat and sidekick reliability got a layered fix: streaming turns survive a hard refresh via in_flight session events plus a throttled assistant_turn_progress, the assistant turn no longer disappears at end-of-stream from three independent client-side races, tool calls and historical [tool: ...] markers consistently render through the shared Block registry, and a CopyButton with cross-OS clipboard ships on file/spec previews. (`6021e18`, `2bb8f04`, `cc4781d`, `cc71745`, `ad52832`, `4c671f1`, `55eb3c7`, `26ed693`, `09b8424`)
- Operators get more clues when things go sideways: the run sidekick separates retry-interrupted tool cards from real crashes, completion-gate rejections appear as a red card, push-stuck banners explain the remote is blocked, and a remote-push-recovery runbook documents the manual unblock procedure. (`d131349`, `4424201`, `5badbea`)
- Desktop sidecar policy aligned with the new aura-harness defaults: bundled aura-node now runs with a vetted AURA_ALLOWED_COMMANDS list plus AURA_ALLOW_SHELL, --external-harness probes /health and warns (rather than silently failing) on incomplete command policy, and docs cover the ENOSPC and external-harness recipes. (`a41c273`, `ed55e37`, `f1f4735`, `76d8a05`, `71304ce`, `abfb6d1`, `d29f248`)

## 11:32 PM — Frontend shared/ scaffolding lands

Reserved the shared/ directory tree that the F2 refactor will move generic frontend code into.

- Added empty .gitkeep placeholders for interface/src/shared/{ui,hooks,api,types,lib}/, complementing the existing utils/ directory carried over from Phase F1. (`207756c`)

## 11:35 PM — Desktop sidecar build scoped to aura-runtime package

Unblocked the release pipeline after the aura-node binary moved inside the harness workspace.

- prepare-desktop-sidecar.mjs now passes -p aura-runtime alongside --bin aura-node so cargo can resolve the binary, fixing the "no bin target named aura-node in default-run packages" build break. (`4da6c8c`)

## 11:40 PM — Generic frontend code relocated under shared/

Moved domain-neutral types, api transports, utils, lib, and hooks out of the app tree into interface/src/shared/, with one revert and a follow-up that keeps stores-coupled modules in api/.

- Relocated all 11 generic type files, 38 framework-agnostic api transport modules, foundational lib/* (auth-token, browser-db, host-config, native-runtime, query-client, featureFlags), generic React hooks (use-click-outside, ws-reconnect, use-scroll-anchor-v2, ...), and generic utils (format, extract-error-message, clipboard, crop-image, ...) into interface/src/shared/, codemodding all import paths. (`7304dc3`, `2a88e81`, `9c714cf`, `6be59f1`, `a53d32b`)
- Reverted an accidental hook-folder move that landed without import updates and broke main, then repositioned api/streams.ts back into api/ because it imports from stores/event-store and would otherwise violate the shared/ no-stores rule. (`08ec42c`, `f71b9eb`, `2320faf`)

## 12:22 AM — Project stats decode tokens, time, and lines correctly

Fixed a serde shape mismatch that left several headline numbers stuck at zero in the project stats panel.

- ProjectStats now accepts the camelCase, snake_case, and short-form aliases that aura-storage's /api/stats?scope=project actually emits (tokensUsed, inputTokens, costUsd, …), with the response body logged at debug level so future shape drift is diagnosable; new unit tests pin all three naming variants. (`da4436e`)

## 10:36 AM — Per-instance concurrency, dropped-stream recovery, and a major module split

Late-day work introduced AgentInstanceRole, ephemeral Executor instances, and a startup janitor so chat, automation, and ad-hoc task runs can coexist; surfaced dropped main-thread chat streams instead of failing silently; and split large Rust and TypeScript modules into focused submodules.

- Phase 1/2/3 of multi-instance concurrency: introduced AgentInstanceRole (Chat/Loop/Executor), allocated a fresh Executor-roled project_agents row per run_single_task call so concurrent ad-hoc runs no longer collide on the (project, instance) registry key, ensured a default Loop instance for projects, scoped the AutomationBar / useLoopControl / chat-stream loop bridge to the project's Loop id, and added a startup janitor that purges orphaned executor rows after a crash. Pinned by an integration test that runs three automatons concurrently under distinct ids. (`1102674`, `ae4801e`, `ed8d9f4`, `cf39422`, `386a905`, `510205d`, `4fd6873`)
- Surfaced silently dropped main-thread chat streams: harness_broadcast_to_sse now logs and emits a synthetic stream_lagged SSE error instead of swallowing RecvError::Lagged, the client classifies idle-timeout and stream_lagged into a new "Chat stream interrupted" banner, and the post-stream history grace window grew from 1.5s to 5s to ride out persistence lag. (`15777df`)
- Split monolithic Rust files into focused module trees across desktop (frontend, harness, init, net, ui, updater), aura-os-server handlers (agents/chat, agents/crud, notes, org_tools, orgs, specs, dev_loop/streaming, projects_helpers, harness_proxy/local, loop_log) and crates (aura-os-agents service split, aura-os-browser cdp_backend, aura-os-integrations, aura-protocol, aura-os-storage types), plus a sister TypeScript pass that moved app components under their app folders and added rust-module / frontend-architecture conventions docs and a file-size linter. (`e69d5b7`, `d9fb000`, `30298f0`, `0db6ae9`, `0073ae5`, `385f037`)
- Wired dev-loop automation into storage sessions so loop and single-task runs create, update, and end session rows that feed project stats, and forwarded org avatar updates so editing a team avatar from settings actually persists end-to-end. (`298bb4c`, `41c586f`, `f67f9ab`, `1c60612`)
- Sidekick terminal switched to a WebGL renderer with canvas fallback and 100k scrollback, the bottom taskbar's icons were unified into a single TaskbarIconButton with consistent hover/edge styling, and the desktop topbar grouped the sidekick toggle next to the native window controls. (`04806b2`, `6e17e33`, `b4525bf`, `4c5768e`, `e1ac283`)
- Hardened release tooling: a desktop-validate workflow now checks the updater sidecar package contract, the build script reinstalls missing tsc/vite when node_modules is partial, and the changelog media pipeline gained AI-assisted capture quality gates, sparse-shell proof acceptance, visual-surface clustering of candidates, and a skip rule for media-infra screenshots. (`63d4c89`, `5c51e33`, `ee70b4b`, `dd065dd`, `0f84019`, `d55c704`, `88fd7cd`, `c68a9a7`, `3aa805a`, `2730c7f`, `9ea2845`)

## Highlights

- Dev loop survives provider 5xx, push outages, and DoD misfires
- Harness becomes the single agent runtime; external CLI adapters removed
- Per-instance concurrency lets chat, loop, and ad-hoc tasks run in parallel
- Desktop shell goes floating-glass with rounded panels and a draggable titlebar
- Browser gains an in-app error overlay and free-form DuckDuckGo search
- Frontend monorepo gets a shared/ scaffold for types, api, hooks, utils, and lib

