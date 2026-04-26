# Concurrent agents, harness-native automation, and a cleaner desktop shell

- Date: `2026-04-25`
- Channel: `nightly`
- Version: `0.1.0-nightly.389.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.389.1

A heavy day of platform work: Aura collapsed its dual agent stack onto the harness, hardened the autonomous dev loop against transient failures and policy denials, and rebuilt task/automation isolation so multiple agents can run in parallel per project. The desktop shell also picked up a new floating-pill look, native macOS edit shortcuts, and a real in-app browser error page.

## 8:52 AM — Autonomous dev loop becomes resilient and harness-native

A long arc of work hardened the autonomous dev loop against transient failures, policy denials, and remote-storage outages, then collapsed the legacy aura-os agent runtime onto the harness so harness terminal events are now authoritative for task completion.

- The dev loop now classifies provider 5xx, stream aborts, push timeouts, and ENOSPC as transient with jittered, escalating cooldowns, retries tool calls up to 8 times against aura-harness's streaming retry loop, and routes completion-gate failures through the same infra-retry ladder so a single mid-stream blip no longer terminates a task. (`9cb0c6a`, `7150cd3`, `373be42`, `88fa94e`, `f474edc`, `fc08c18`, `8e75d47`, `e94aa54`)
- Task terminal status is now decoupled from `git push`: failed pushes emit a `push_deferred` event and a per-project `project_push_stuck` banner with remediation copy, ENOSPC on Orbit trips a 15-minute capacity guard, and a new remote-push-recovery runbook documents the operator path. The stuck-agent harness signal also short-circuits tight-loop reconnects. (`73ab86f`, `f4425e2`, `fc08c18`, `5badbea`, `4c01759`)
- The Definition-of-Done gate stopped failing recovered runs: empty-path writes only fail when nothing real ever lands, `tool_call_completed` and legacy `tool_result+snapshot` shapes both populate `files_changed`, kernel-policy denials (including the `binary_allowlist` and shell variants) emit a specific actionable diagnostic, and a new DoD retry tier with a language-neutral follow-up prompt re-prompts the agent when it skipped build/test/fmt/lint. (`a8e3e72`, `f1c9dce`, `a2c218d`, `87e929c`, `5760d25`, `70623bd`, `3bdb2b4`, `71304ce`)
- The autonomous harness sidecar now ships with the policy envs the dev loop actually needs (`AURA_AUTONOMOUS_DEV_LOOP`, `AURA_ALLOW_SHELL`, a vetted default `AURA_ALLOWED_COMMANDS`), the desktop honors `--external-harness` with a /health policy probe, and harness `run_command` is now on by default in non-strict mode. (`a41c273`, `ed55e37`, `f1f4735`, `76d8a05`, `abfb6d1`)
- The legacy `aura-os-agent-tools` / `agent-runtime` / `agent-templates` stack and the entire process executor crate were deleted (~13k lines). Chat, automation, and scheduled work now go through `aura-os-harness` session bridges and harness automatons, with harness terminal events authoritative for task DoD and credit-exhaustion classified as terminal so the loop stops cleanly. (`c21106b`, `9e23bbc`, `53ace21`, `d8c2480`, `c1e87fb`, `f39dc74`, `49a1d45`, `95cd075`, `b43e4b8`)
- Task state, retry, and the cross-agent dispatcher were unified: every transition now goes through a single `safe_transition` helper aligned with aura-storage's edge list, retries are idempotent on `ready`, project-scoped tools auto-inject `project_id` from session headers, and project self-caps are spliced for project-bound chats so non-CEO agents can call `list_specs` / `create_task` etc. without the LLM threading IDs. (`3809aeb`, `ef50887`, `bde1254`, `8d0d715`, `b6a066e`, `def464a`, `13acee2`, `c477313`)
- A new topic-scoped `aura-os-events` + `aura-os-loops` foundation re-keys the in-memory automaton registry by `(project, agent_instance)` and exposes a `GET /api/loops` snapshot. The UI gets a unified `LoopProgress` indicator across agent rows, sidekick tabs, and per-task explorer rows, plus a 60s stall watchdog and reconnect hydration. (`9860141`)
- The desktop shell was rebuilt as floating glass pills: the bottom taskbar splits into three capsules with insets, the topbar and main content gain rounded corners and gaps that show the desktop background, the sidekick mirrors the left-menu fade, and a copy button appears on file/spec previews with a cross-OS clipboard fallback. (`c1aad81`, `065b565`, `d0bd776`, `8d8225f`, `3ace217`, `07c6832`, `8494863`, `eeba9fc`, `4474f6c`, `bce7a34`, `2251b35`, `fece144`, `55eb3c7`)
- Native desktop polish: macOS now installs an app menu so Cmd+C/V/X/A/Z reach the WebView, the custom titlebar is draggable on macOS and Linux via tao's IPC, the Windows drag-resize flash paints black instead of white, and the browser surfaces a branded error overlay on `Network.loadingFailed` instead of Chromium's default page. (`cc3193a`, `c2294d3`, `c1aad81`, `bd92f08`, `7837adb`, `1c155de`)
- Chat and run-pane reliability: assistant turns survive a mid-stream refresh and tool-only turns no longer disappear at end of stream, the run pane and task overlay drop their MutationObserver-based scroll hack for `overflow-anchor` + sync `scrollTop`, retry/interrupt context is surfaced on tool cards with live `n/8` retry status, and stale active rows are reconciled against the server's loop status. (`6021e18`, `2bb8f04`, `0244c85`, `d131349`, `4424201`, `3089289`, `26ed693`, `cc4781d`, `07bbdc3`)
- A stale harness WS reader is now closed on every restart via an `WsReaderHandle` so the 128-slot harness cap stops filling up with 503s, and the protocol gains live tool-approval prompt/response messages plus per-agent permission overrides for the upcoming approvals UI. (`ee5d955`, `53b2c16`, `3636203`)

## 11:35 PM — Desktop sidecar build scoped to aura-runtime

Fixes the release pipeline's bundled aura-node build, which was failing because `--bin aura-node` couldn't resolve against the harness workspace's default-run packages.

- `prepare-desktop-sidecar` now passes `-p aura-runtime` alongside `--bin aura-node` so cargo can locate the binary inside the harness workspace and the desktop sidecar packaging step succeeds. (`4da6c8c`)

## 11:40 PM — Interface scaffolding moves to shared/ for the F2 refactor

Phase F2 of the interface refactor relocates the generic, app-agnostic types, api transport, utils, lib foundations, and React hooks under `interface/src/shared/` while keeping Aura-specific modules in their original homes.

- All 11 type files plus 38 generic API transport modules moved to `shared/types/` and `shared/api/`, with import paths codemodded across the interface; app-specific aggregators like `client.ts`, `feedback.ts`, and `marketplace.ts` stay in `api/` to avoid `shared/ → apps/` dependencies. (`7304dc3`, `2a88e81`, `f71b9eb`)
- Generic utilities, foundational lib modules, and pure React hooks (click-outside, scroll-anchor, ws-reconnect, etc.) moved to `shared/utils/`, `shared/lib/`, and `shared/hooks/`. An accidental hooks move that broke main was caught and reverted before landing the proper migration. (`9c714cf`, `6be59f1`, `a53d32b`, `2320faf`, `08ec42c`)

## 12:22 AM — Project stats panel decodes tokens, time, and lines again

Recovers the missing numbers in the project stats panel, where Tokens / Time / Lines stuck at zero while Cost moved.

- `ProjectStats` now accepts the camelCase, snake_case, and short-form key shapes that aura-storage's `/api/stats?scope=project` actually emits (e.g. `tokensUsed`, `inputTokens`, `costUsd`), and the response body is debug-logged so future shape drift is diagnosable. (`da4436e`)

## 10:36 AM — Per-instance concurrency for chat, loop, and ad-hoc task runs

A multi-commit Phase 2 lands the foundation for running a chat, an automation loop, and several ad-hoc tasks in the same project simultaneously, plus assorted UI polish, a hardened sidecar release contract, and team avatar editing.

- Agent instances gain an `AgentInstanceRole` (Chat / Loop / Executor) and `run_single_task` now spawns an ephemeral Executor-roled instance per call, so concurrent ad-hoc runs no longer collide on the per-project automaton slot. A startup janitor sweeps orphaned executor rows from previous crashes, and an integration test pins three-way concurrent operation with per-instance stop targeting only one slot. (`1102674`, `ae4801e`, `ed8d9f4`, `cf39422`)
- The frontend stops cross-talk between concurrent loops: `LoopStopped`/`LoopFinished` is scoped to the event's project and agent instance so project A no longer marks project B's tasks completed, the sidekick streaming indicator tracks multiple instance IDs, and AutomationBar/useLoopControl bind to the project's resolved Loop instance instead of the URL's chat instance. (`510205d`, `386a905`)
- Mid-flight chat drops are now surfaced explicitly: the server emits a `stream_lagged` SSE error before closing when the harness broadcast falls behind, the client classifies both that and SSE idle timeouts into a `streamDropped` banner with retry hint, and the post-stream history grace window is widened to 5s to avoid races with `assistant_message_end` persistence. (`15777df`)
- Releases now validate the desktop updater sidecar package contract end-to-end via a new `desktop-validate` workflow, a build-time check, and a `verify-desktop` CI script — pairing with the earlier `prepare-desktop-sidecar` fixes so nightly bundles can no longer ship without the harness binary in the right shape. (`63d4c89`)
- Dev-loop automation runs are now counted as storage sessions (created, updated, and ended for both loop and single-task runs), so project stats reflect autonomous activity instead of only interactive chats. (`298bb4c`)
- Team avatars can be uploaded from settings and render in the topbar selector, with a local-storage fallback for hosts that don't persist avatar updates so the override survives a refresh. (`41c586f`, `13e4469`, `f67f9ab`)
- Desktop shell polish: bottom taskbar pills get consistent end padding, the sidekick toggle joins the native window controls as one compact group, and the embedded terminal switches to a WebGL renderer with a 2D-canvas fallback and 100k-line scrollback. (`6e17e33`, `b4525bf`, `4c5768e`, `04806b2`, `629e58d`, `f7f7bc2`)
- Changelog media capture workflow is hardened with stronger skip and capture gates so failed UI captures no longer silently produce broken release media. (`ee70b4b`)

## Highlights

- Autonomous dev loop survives provider 5xx, push outages, and policy denials
- Legacy agent runtime removed — everything routes through aura_harness
- Concurrent chat, loop, and task runs no longer collide per project
- Desktop shell redesigned as floating glass pills with macOS edit shortcuts
- Mid-stream chat drops now surface a banner instead of failing silently

