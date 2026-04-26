# Harness consolidation, parallel automatons, and a refreshed desktop shell

- Date: `2026-04-25`
- Channel: `nightly`
- Version: `0.1.0-nightly.394.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.394.1

A heavy day for Aura's foundations: the dev loop finally hands authority for task completion to the harness, the legacy agent-tool dispatcher is gone, and concurrent chat / loop / executor work no longer collide on a single agent slot. The desktop shell also gets a comprehensive glass-pill makeover, and a long tail of streaming, retry, and policy fixes makes autonomous runs noticeably more resilient.

## 8:52 AM — Harness takes over autonomous task completion, with a new desktop shell to match

The longest stretch of the day reshapes how aura-os and the harness divide responsibility for autonomous runs, while the desktop UI is rebuilt around floating glass pills and concurrent-loop isolation.

- Retired the legacy in-tree agent-tool dispatcher, agent-runtime, and agent-templates crates and routed every chat turn, dev-loop run, and scheduled process through the new aura-os-harness adapter — aura-os no longer owns its own DoD ladder, completion gate, or external CLI adapters and instead consumes harness terminal events as authoritative. (`c21106b`, `9e23bbc`, `53ace21`, `d8c2480`, `00d095e`, `71d1821`, `c1e87fb`, `f39dc74`, `49a1d45`, `b43e4b8`)
- Hardened the autonomous dev loop end-to-end: 5xx and stream-terminated errors now classify as transient, project cooldowns escalate with jitter, single-task retries get a budget of 3, completion-gate failures route through the infra retry ladder, push failures stop demoting tasks (with a new push_deferred / project_push_stuck UI banner), and an Orbit ENOSPC guard trips a 15-minute cooldown with operator runbook. (`9cb0c6a`, `7150cd3`, `373be42`, `88fa94e`, `73ab86f`, `f4425e2`, `fc08c18`, `5badbea`, `f474edc`, `4424201`)
- Closed a string of harness policy and state-machine gaps that were silently failing tasks: empty-path write_file misfires are now recoverable, kernel-policy denials surface with a specific diagnostic naming AURA_ALLOW_SHELL / AURA_ALLOWED_COMMANDS, the binary_allowlist denial is matched verbatim, ready→failed transitions bridge through in_progress, retry is idempotent on ready, and stuck-agent terminal signals stop driving tight reconnect loops. (`a8e3e72`, `fcc6c98`, `f1c9dce`, `a2c218d`, `a41c273`, `5760d25`, `76d8a05`, `71304ce`, `ef50887`, `3809aeb`, `3bdb2b4`, `4c01759`, `ee5d955`, `87e929c`)
- Rebuilt the desktop shell around floating glass pills: split the bottom taskbar into three capsules, inset the topbar and main content with matching 5px / 20px radii, added consistent gaps between sidebar / main / sidekick, and unified corner treatments across topbar, taskbar, and chat input. (`c1aad81`, `065b565`, `d0bd776`, `8d8225f`, `3ace217`, `07c6832`, `b1c6453`, `078aca5`, `8494863`, `21373eb`, `eeba9fc`, `8fc9dbd`, `4474f6c`, `bce7a34`, `2251b35`, `fece144`)
- Expanded chat and Run-pane resilience: mid-turn refresh now restores in-flight assistant messages and tool cards, sidekick panes scroll without the up-then-down jank, retry status is rendered live on tool cards (writing retrying n/8...), and stale 'active' rows reconcile cleanly across reloads. (`d131349`, `27aff59`, `0244c85`, `f1f4735`, `4424201`, `6021e18`, `4c671f1`, `3089289`, `cc4781d`, `2bb8f04`, `26ed693`, `09b8424`)
- Browser surface gained a flat Edge-style address bar, a DuckDuckGo fallback for unparseable input, and a dark Aura-branded error overlay (Ask Agent / Show Details / Reload) for main-frame load failures, replacing Chromium's default error page. (`7837adb`, `1c155de`, `bd92f08`)
- Desktop platform polish: --external-harness now actually parses, autonomous sidecars launch with the right policy envs, a native macOS edit menu wires Cmd+C/V/X/A/Z to the WebView, and the custom titlebar is draggable on macOS and Linux via the existing Drag IPC. (`ed55e37`, `a41c273`, `f1f4735`, `cc3193a`, `c2294d3`)
- Introduced topic-scoped EventHub + LoopRegistry so chat, automation, task, process, and spec loops are tracked per (project, agent_instance, kind) instead of one global broadcast, with a /api/loops snapshot, hydration-on-reconnect, and a unified LoopProgress indicator across the agent list and sidekick. (`9860141`, `ac52a80`, `61eb586`, `82f93b3`)
- Added a copy button with cross-OS clipboard support to file and spec previews, inline rename for project agents from the sidebar, and tightened a handful of agent-permissions paths so project-bound chats auto-splice ReadProject/WriteProject and project_id is injected from the X-Aura-Project-Id header instead of being threaded by the LLM. (`55eb3c7`, `efa2c79`, `8d0d715`, `b6a066e`, `def464a`, `13acee2`, `6efa695`)

## 11:35 PM — aura-node release build scoped to the right package

Fixed a follow-up issue in the desktop sidecar release script after the harness migration.

- prepare-desktop-sidecar now builds aura-node with -p aura-runtime --bin aura-node, since cargo's --bin alone could not resolve the binary inside the harness workspace's default-run packages. (`4da6c8c`)

## 11:40 PM — Frontend reorganized into shared/ with stricter typing

Phase F1/F2 of the interface refactor: domain-neutral types, API transports, utils, lib, and hooks moved under interface/src/shared/, and EventType was converted to a literal union.

- Migrated 11 type modules, 38 API transport modules, foundational lib helpers (auth-token, browser-db, host-config, query-client, featureFlags), and seven generic React hooks into interface/src/shared/, with codemodded import paths across hundreds of files. (`7304dc3`, `2a88e81`, `9c714cf`, `6be59f1`, `a53d32b`)
- Kept api/streams.ts in api/ after a brief move, since it imports stores/event-store and would have violated the shared/ no-stores rule alongside feedback.ts, marketplace.ts, and client.ts. (`f71b9eb`, `08ec42c`)

## 12:22 AM — Project stats panel decodes tokens, time, and lines correctly

Stats from aura-storage now hydrate fully instead of staying stuck at zero while only Cost moved.

- Added serde aliases on ProjectStats for camelCase, snake_case, and short-form variants of total/input/output tokens, cost, time, and lines so /api/stats?scope=project no longer silently defaults missing fields to 0; raw response bodies are now debug-logged for future shape drift. (`da4436e`)

## 10:36 AM — Parallel agent instances, dropped-stream banners, and a redesigned taskbar

Concurrency work lands at the agent-instance level, the chat surface stops disappearing on slow turns, and the changelog media pipeline gets a production-grade redraw path.

- Introduced AgentInstanceRole (Chat / Loop / Executor) so a single agent can serve a chat turn, an automation loop, and ad-hoc task runs simultaneously: ad-hoc runs spawn ephemeral Executor instances per call, loop control resolves or lazily creates the project's canonical Loop instance, and a startup janitor sweeps orphaned Executor rows. (`1102674`, `ae4801e`, `ed8d9f4`, `cf39422`, `386a905`, `510205d`, `4fd6873`)
- Surfaced silent main-thread chat drops as an explicit 'Chat stream interrupted' banner: the server logs and emits a synthetic stream_lagged SSE error when the harness broadcast lags, the client classifies idle timeouts and lagged payloads as a streamDropped variant, and the post-stream history grace window grew to 5s to cover persistence lag. (`15777df`)
- Counted dev-loop automation runs as storage sessions so loop and single-task work now show up in project stats, and added uploadable team avatars (with a localStorage fallback for hosts that drop avatar updates) plus the org-avatar URL fix on the server side. (`298bb4c`, `41c586f`, `f67f9ab`, `13e4469`, `1c60612`)
- Bottom taskbar icons unified onto a shared TaskbarIconButton, the sidekick toggle moved next to the native window controls, and the terminal panel switched to a WebGL renderer (with canvas fallback) and 100k scrollback. (`6e17e33`, `b4525bf`, `4c5768e`, `04806b2`, `629e58d`)
- Split aura-os-desktop, aura-os-server handlers, the storage type module, and the agents / browser / integrations / protocol crates into focused submodules, and added refactor architecture notes plus a file-size lint to keep them that way. (`0db6ae9`, `30298f0`, `d9fb000`, `e69d5b7`, `0073ae5`, `385f037`, `414467d`)
- Reworked the changelog media pipeline to redraw screenshots through OpenAI image generation as a publishable production asset, with branding, planner, quality, and seed-plan modules tightened and the workflow capture gates hardened. (`ee70b4b`, `dd065dd`, `0f84019`, `d55c704`, `88fd7cd`, `c68a9a7`)
- Release infrastructure: the desktop updater sidecar package contract is now validated in CI before nightly and stable releases ship, and a missing-tsc/vite check in build.rs recovers desktop builds from incomplete node_modules. (`63d4c89`, `5c51e33`)

## Highlights

- Harness becomes the single source of truth for task DoD
- Concurrent loops, chats, and ad-hoc task runs now run in parallel without collisions
- Desktop shell redesigned around floating glass pills with consistent radii and gaps
- Browser address bar gains DuckDuckGo fallback and a full in-app error overlay
- Dev-loop hardening: ENOSPC guard, kernel-policy diagnostics, push decoupled from task status
- Frontend reorganized into shared/ with literal-union EventType and stricter typing

