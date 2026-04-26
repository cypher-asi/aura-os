# Harness-led automation, concurrent loops, and a polished desktop shell

- Date: `2026-04-25`
- Channel: `nightly`
- Version: `0.1.0-nightly.398.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.398.1

A heavy day across the stack: Aura's autonomous dev loop got a thorough reliability pass — smarter retries, better failure surfacing, and a hand-off of completion authority to the harness — followed by a major refactor that lets multiple chats, tasks, and automation loops run side-by-side per project. The desktop shell picked up floating glass capsules, rounded corners, and working Cmd+C/V on macOS, while the changelog media pipeline and release tooling got their own round of hardening.

## 8:52 AM — Autonomous dev loop hardening, harness migration, and desktop shell rebuild

The bulk of the day reshaped how Aura runs autonomous tasks — from retry classification through the Definition-of-Done gate — then migrated automation onto the harness adapter and gave the desktop shell a floating-capsule redesign.

- Dev loop now treats provider 5xx responses, stream aborts, and rate limits as transient with per-class escalating backoff plus ±20% jitter, and bumps the single-task retry budget so one mid-stream blip no longer terminally fails a user-clicked Retry. (`9cb0c6a`, `7150cd3`, `373be42`, `88fa94e`)
- The Definition-of-Done gate got smarter: empty-path write misfires are now recoverable when a real write lands, files_changed is inferred from tool events, and kernel-policy denials short-circuit to an actionable diagnostic across all build/test/fmt/lint axes. (`a8e3e72`, `fcc6c98`, `f1c9dce`, `a2c218d`, `5760d25`, `3bdb2b4`, `71304ce`, `70623bd`)
- Task terminal status is now decoupled from git push outcomes: failed pushes surface a `push_deferred` step and a project-level "push stuck" banner instead of demoting the task, with dedicated handling for Orbit ENOSPC including a 15-minute capacity guard and remediation copy. (`73ab86f`, `f4425e2`, `fc08c18`, `5badbea`)
- Run-pane UX for failures and retries: tool cards live-update through harness retry events with "Writing retrying (n/8)" titles, completed task rows show provider request id / model / error type, and abandoned pending cards resolve cleanly on `task_retrying`. (`d131349`, `27aff59`, `13acee2`, `f474edc`, `4424201`, `0244c85`)
- Task state machine unified through a single bridge-aware `safe_transition`, ready→failed and ready→ready edges made idempotent, and a flat `/api/tasks/:id` / `/api/specs/:id` surface added for harness clients that previously 404'd. (`bde1254`, `ef50887`, `3809aeb`)
- Harness handoff: scheduled work, agent chats, and the dev loop now run through a delegated `aura-os-harness` adapter, the legacy agent-tool dispatcher and external CLI adapters (claude_code, codex, gemini_cli, opencode, cursor) were retired, and the harness is now authoritative for task DoD with aura-os only retaining verification evidence. (`c21106b`, `9e23bbc`, `53ace21`, `d8c2480`, `c1e87fb`, `f39dc74`, `b43e4b8`, `49a1d45`)
- Desktop shell redesigned with three floating glass capsules in the bottom taskbar, rounded inset titlebar and main panel, 5px gaps between sidebar/main/sidekick, and a bottom-fade gradient — paired with a chat input that survives mid-turn refreshes and a fix to a long-standing scroll-jank loop in the sidekick. (`065b565`, `d09c166`, `8d8225f`, `3ace217`, `07c6832`, `078aca5`, `8494863`, `eeba9fc`, `8fc9dbd`, `4474f6c`, `bce7a34`, `0244c85`, `6021e18`)
- macOS desktop fixes: a native AppKit menu now wires Cmd+C/V/X/A/Z through to the WebView, the custom titlebar drags via IPC on macOS and Linux (where `-webkit-app-region: drag` is unsupported), and a black drag-resize fill replaces the jarring white flash on Windows. (`cc3193a`, `c2294d3`, `c1aad81`)
- New browser surface: in-app error overlay for main-frame load failures with Ask Agent / Reload, address-bar restyle as a flat pill with site-info icon, and free-form input now searches DuckDuckGo instead of being silently dropped. (`bd92f08`, `7837adb`, `1c155de`)
- Project-bound agent chats no longer hit "Tool 'X' is not allowed": project self-caps are auto-spliced from the chat session, `X-Aura-Project-Id` is injected on cross-agent dispatch, and `project_id` was dropped from required tool schemas. (`8d0d715`, `b6a066e`, `def464a`, `13acee2`)
- Concurrency and event isolation: chat/automation/task/process/spec loops now run on topic-scoped EventHub channels with a per-loop registry and a `/api/loops` snapshot, surfaced through a unified `LoopProgress` indicator, and harness WS sockets close cleanly on restart so the 128-slot cap stops getting exhausted. (`9860141`, `26ed693`, `ee5d955`, `ac52a80`)
- Chat reliability and copy: mid-turn state now survives a page refresh via in-flight assistant turns and `assistant_turn_progress` events, copy buttons land on file and spec previews with a Capacitor-safe clipboard helper, and project agents can be renamed inline from the sidebar context menu. (`6021e18`, `55eb3c7`, `efa2c79`)

## 11:32 PM — Shared interface scaffolding for the F2 refactor

An empty but intentional checkpoint: reserve the `interface/src/shared/` tree for the next phase of the frontend refactor.

- Created the `shared/{ui,hooks,api,types,lib}` directories under `interface/src/` so subsequent commits can move generic modules out of feature folders without churning import paths twice. (`207756c`)

## 11:35 PM — Desktop sidecar build now scopes aura-node correctly

Follow-up fix to the desktop release script after the harness's `--bin` resolution rules tripped up the previous run.

- `prepare-desktop-sidecar.mjs` now builds aura-node with `-p aura-runtime --bin aura-node` so cargo no longer errors with "no bin target named aura-node in default-run packages" when the binary lives outside the workspace's default-run set. (`4da6c8c`)

## 11:40 PM — Frontend shared/ migration: types, api, utils, hooks, and lib

Bulk move of domain-neutral modules out of feature folders into `interface/src/shared/`, with one revert and one principled exception kept in `api/`.

- Relocated all 11 generic type modules (events, entities, ids, permissions, stream, etc.) to `shared/types/`, with import paths recomputed across ~330 files to avoid colliding with sibling `types.ts` modules. (`7304dc3`)
- Moved framework-agnostic API transport modules to `shared/api/`, leaving `feedback.ts`, `marketplace.ts`, `client.ts`, and (after a follow-up correction) `streams.ts` in `api/` because they couple to stores or app-specific aggregators. (`2a88e81`, `f71b9eb`)
- Promoted clearly generic helpers to `shared/utils/`, `shared/lib/`, and `shared/hooks/` — covering formatters, error extraction, clipboard, browser-db, host config, query client, feature flags, and React hooks like `use-click-outside`, `use-scroll-anchor-v2`, and `ws-reconnect`. (`9c714cf`, `6be59f1`, `a53d32b`)
- Reverted an accidental hooks duplication that moved files into `shared/hooks/` without updating call sites, restoring main to a buildable state. (`2320faf`, `08ec42c`)

## 12:22 AM — Project stats now show real tokens, time, and lines

Stats panel had been silently zeroing out everything except cost; widening the storage deserializer recovers the full picture.

- `ProjectStats` now accepts camelCase, snake_case, and short-form aliases (`tokensUsed`, `inputTokens`, `costUsd`, etc.) for tokens, cost, time, and lines, and the storage client logs the raw stats body so future shape drift is diagnosable. Unit tests pin all three naming conventions. (`da4436e`)

## 10:36 AM — Multi-instance concurrency, sidekick scoping, and team avatars

The afternoon push introduced per-project Loop and ephemeral Executor agent instances, scoped streaming state per project/instance, and shipped team avatar editing — alongside a deep refactor that split large Rust and TypeScript modules into focused submodules.

- Agent instances now carry an `AgentInstanceRole` (Chat / Loop / Executor): each `run_single_task` mints a fresh Executor row so concurrent ad-hoc runs and the project's automation loop stop colliding on the harness's "one in-flight turn per agent_id" rule, with a startup janitor that reaps orphaned Executor rows. (`1102674`, `ae4801e`, `ed8d9f4`, `cf39422`)
- Sidekick streaming state is now scoped per project and per agent instance: `LoopStopped` for project A no longer marks project B's tasks complete, and the streaming dot tracks multiple concurrent agents instead of flickering between them. Automation Bar controls bind to the project's resolved Loop instance so Start no longer aborts an in-flight chat. (`510205d`, `386a905`)
- Dropped main-thread chat streams now surface explicitly: the server emits a `stream_lagged` SSE event when the harness broadcast falls behind, the client classifies idle timeouts and lag as a `streamDropped` variant with a "Chat stream interrupted" banner, and the post-stream history grace window grew to 5s to absorb persistence lag. (`15777df`)
- Team avatar editing landed: avatars can be uploaded from org settings, shown in the topbar selector, and persisted locally as a fallback for hosts that drop avatar updates. The upload field is now wired through to network org metadata. (`41c586f`, `13e4469`, `f67f9ab`, `1c60612`)
- Sidekick terminal switched to a WebGL renderer with canvas fallback and a 100k-line scrollback, the Terminal icon was unified to lucide's SquareTerminal across the sidekick, command blocks, and skill shop, and the sidekick toggle now sits beside the native window controls as one compact group. (`04806b2`, `e1ac283`, `4c5768e`)
- Automation runs now count as sessions in project stats — both loop runs and single-task runs create, update, and end session rows so token/cost/time accounting reflects autonomous work. (`298bb4c`)
- Large foundation modules were split: storage types, agent service, browser CDP backend, integrations + trusted methods, and aura-protocol all moved from monolithic files into focused submodules, and the server's chat, agents, notes, org_tools, and dev_loop streaming handlers were broken up the same way. (`0db6ae9`, `30298f0`, `d9fb000`, `e69d5b7`, `0073ae5`, `385f037`)
- Changelog media pipeline gained AI-generated production-grade media via OpenAI image redraws (gpt-image-2, 2560x1440), visual-surface clustering for candidate media, accepted-proof preservation, and historical backfill targeting through the publish workflow. (`dd065dd`, `0f84019`, `d55c704`, `88fd7cd`, `c68a9a7`, `ee70b4b`, `3aa805a`, `2730c7f`)
- Release infrastructure: the desktop updater sidecar package contract is now validated in CI by `desktop-validate`, `release-nightly`, and `release-stable` workflows, and the desktop build script reinstalls missing tsc/vite binaries instead of skipping npm install on incomplete `node_modules`. (`63d4c89`, `5c51e33`)
- Documentation added for the post-refactor architecture: `frontend-architecture.md` and `rust-module-conventions.md` describe the new shared/ layout and Rust module conventions, with a `lint-file-sizes.mjs` script to keep modules from growing back. (`385f037`)

## Highlights

- Dev loop now retries 5xx, stream aborts, and DoD misses with per-class backoff
- Concurrent chat / loop / task instances no longer collide on the harness
- Desktop shell redesigned with floating capsules, rounded corners, and macOS edit shortcuts
- Browser address bar, in-app error page, and copy buttons across chat surfaces
- Server hand-off: harness is now authoritative for task DoD and command policy
- Nightly 0.1.0-nightly.398.1 shipped for macOS, Windows, and Linux

