# Autonomous dev loop hardening, harness consolidation, and a desktop shell refresh

- Date: `2026-04-25`
- Channel: `nightly`
- Version: `0.1.0-nightly.395.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.395.1

A heavy day for Aura's autonomous loop and runtime: the server now treats provider blips, push backlogs, and policy denials as recoverable instead of terminal, the dev loop and process runtime were folded onto the harness as the single execution path, and the desktop shell got a floating glass-pill makeover. Concurrent agent work was untangled with per-instance roles and topic-scoped loops, and the interface began a structural move toward a shared/ layout.

## 8:52 AM — Autonomous dev loop becomes resilient to provider blips and push outages

A multi-pronged overhaul of the autonomous loop: transient provider errors, stuck git remotes, completion-gate misfires, and policy denials now flow through structured recovery paths instead of terminating tasks.

- Classified 5xx, stream-terminated, and rate-limited failures as transient with escalating, jittered cooldowns and per-task retry budgets, plus a stateful resume preamble so retried turns continue rather than restart from scratch. (`9cb0c6a`, `7150cd3`, `8e75d47`, `373be42`, `88fa94e`)
- Decoupled task completion from git push: pushes that fail due to remote outages now emit push_deferred / project_push_stuck events with a runbook, and an Orbit ENOSPC guard surfaces an amber "Orbit out of disk" indicator with retry windows. (`73ab86f`, `f4425e2`, `5badbea`, `fc08c18`)
- Made the Definition-of-Done gate recoverable: empty-path writes are forgiven once a real write lands, files_changed is inferred from tool events, and a new DoD retry tier re-prompts the agent for missing build/test/fmt/lint axes with a language-neutral note. (`fcc6c98`, `f1c9dce`, `a2c218d`, `70623bd`, `87e929c`)
- Closed the kernel-policy denial gap end-to-end: the desktop sidecar now ships a vetted AURA_ALLOWED_COMMANDS list, external harnesses are checked at boot, and the gate emits an actionable diagnostic that the DoD retry tier refuses to loop on. (`a41c273`, `5760d25`, `f1f4735`, `3bdb2b4`, `71304ce`, `abfb6d1`)
- Stopped tight-loop reconnects on stuck-agent terminal signals and prevented harness WebSocket slot exhaustion by closing reader handles on every restart. (`4c01759`, `ee5d955`)
- Surfaced provider request_id, model, and SSE error type alongside task failure reasons in the Run sidekick, and propagated prior-failure context into single-task retries so the agent doesn't re-run the same prompt blind. (`cb96864`, `aac1050`, `27aff59`, `1292936`)
- Redesigned the desktop shell around floating glass capsules: split the bottom taskbar into three pills, inset and rounded the topbar and main content, restyled the browser address bar, and added a native macOS app menu so Cmd+C/V/X/A/Z work in the WebView. (`065b565`, `d0bd776`, `8d8225f`, `b1c6453`, `8494863`, `8fc9dbd`, `7837adb`, `cc3193a`, `c2294d3`, `bce7a34`)
- Made the harness the sole runtime: removed the legacy agent tool dispatcher, retired external CLI adapters (claude_code, codex, gemini_cli, opencode, cursor), and routed dev loop, process scheduler, and chat through harness automatons via a new aura-os-harness crate. (`c21106b`, `9e23bbc`, `53ace21`, `d8c2480`, `c1e87fb`, `f39dc74`, `b43e4b8`, `49a1d45`)
- Preserved chat state across refresh and stream drops: in-flight assistant turns now rebuild from persisted events, the composer hides until history resolves, and tool-only turns no longer disappear at end-of-stream. (`6021e18`, `07bbdc3`, `2bb8f04`, `4c671f1`)
- Introduced topic-scoped EventHub and LoopRegistry so chat, automation, task, and process loops are tracked per (project, agent_instance, kind), with a shared LoopProgress indicator across agent rows, sidekick tabs, and explorer rows. (`9860141`, `26ed693`, `ac52a80`)
- Added an in-app browser error overlay for main-frame load failures and a free-form DuckDuckGo fallback when the address bar input isn't a URL. (`bd92f08`, `1c155de`)
- Fixed run pane jank and stale rows: replaced observer-based scroll with overflow-anchor + layout-effect scrolling, demoted orphaned active rows on hydration, and lifted the cooking indicator above the bottom fade. (`0244c85`, `3089289`, `2509b9c`)
- Unified the task state machine with aura-storage via a single safe_transition helper and added flat /tasks/:id and /specs/:id routes for harness clients, eliminating the cascade of "Invalid status transition" 400s. (`bde1254`, `ef50887`, `3809aeb`)
- Auto-spliced project self-capabilities for project-bound agent chats and stamped X-Aura-Project-Id on cross-agent dispatch so project-scoped tools (list_specs, create_task, ...) stop being denied when the LLM omits project_id. (`8d0d715`, `b6a066e`, `def464a`, `13acee2`)

## 11:32 PM — Frontend shared/ scaffolding seeded

A small structural step toward the F2 refactor that unblocks the larger shared/ migration later in the day.

- Reserved interface/src/shared/{ui,hooks,api,types,lib}/ with .gitkeep files so subsequent shared/ moves have stable destinations. (`207756c`)

## 11:35 PM — Desktop sidecar build scoped to aura-runtime

Release tooling fix so prepare-desktop-sidecar can locate the aura-node binary inside the harness workspace.

- Disambiguated the aura-node build with -p aura-runtime after --bin-only resolution failed against non-default-run packages. (`4da6c8c`)

## 11:40 PM — Frontend shared/ migration: types, api, utils, lib, and hooks relocated

The bulk of the F2 refactor: domain-neutral types, API transports, utilities, foundational lib modules, and generic React hooks moved into interface/src/shared/, with a partial revert and a careful exception for stores-coupled streams.ts.

- Moved all 11 generic type files into shared/types/ and 38 framework-agnostic API transport modules into shared/api/, codemodding import paths across the interface. (`7304dc3`, `2a88e81`)
- Relocated generic utilities (formatters, clipboard, error extraction, image cropping, text normalization), foundational lib modules (auth-token, browser-db, host-config, native-runtime, query-client, featureFlags), and app-agnostic hooks into shared/. (`9c714cf`, `6be59f1`, `a53d32b`)
- Reverted an accidental hooks move that broke main, then kept api/streams.ts in api/ because its dependency on stores/event-store violates the shared/ rule. (`08ec42c`, `f71b9eb`)

## 12:22 AM — Project stats panel decodes alternative key shapes

Fixes the stats panel showing zero tokens, time, and lines while cost moved.

- Added serde aliases on ProjectStats for camelCase, snake_case, and short-form variants (tokensUsed, inputTokens, costUsd, ...) and logged the raw stats body so future shape drift is diagnosable. (`da4436e`)

## 10:36 AM — Per-instance concurrency, stream-drop banners, and the changelog media pipeline

Late-day work introduces AgentInstanceRole with ephemeral executors so concurrent runs no longer collide, surfaces dropped chat streams as a real banner, counts automation runs as sessions, and overhauls the changelog media capture pipeline.

- Added an AgentInstanceRole foundation (Chat / Loop / Executor) and made every ad-hoc task run allocate a fresh Executor-roled instance, with a startup janitor sweeping orphaned executor rows and integration tests pinning the registry-keying invariant. (`1102674`, `ae4801e`, `ed8d9f4`, `cf39422`)
- Scoped task panel completion and sidekick streaming state per project and agent instance, and bound automation loop start/pause/resume/stop to the project's Loop instance so toggling automation no longer aborts the chat reply. (`510205d`, `386a905`)
- Surfaced dropped main-thread chat streams instead of failing silently: server emits a synthetic stream_lagged event on broadcast lag, the client renders a dedicated "Chat stream interrupted" banner, and the post-stream history grace window is widened to 5s. (`15777df`)
- Wired dev-loop automation into storage sessions so loop and single-task runs create, update, and end session rows for project stats counting. (`298bb4c`)
- Added team avatar uploads with a local override fallback, swapped lucide Terminal for SquareTerminal across terminal and command surfaces, and added a WebGL terminal renderer with a 100k-line scrollback. (`41c586f`, `f67f9ab`, `e1ac283`, `04806b2`)
- Polished the desktop shell further: unified taskbar pill icons with consistent edge rounding, grouped the sidekick toggle with native window controls, softened the chat panel top edge, and tightened pill end padding. (`6e17e33`, `b4525bf`, `4c5768e`, `f7f7bc2`)
- Split large Rust modules (storage types, agents, browser CDP backend, integrations, protocol, server handlers including agents/chat, dev_loop streaming, orgs, specs, notes, tests) into focused submodules, and reorganized interface app components under their app folders. (`0db6ae9`, `30298f0`, `d9fb000`, `e69d5b7`, `0073ae5`, `385f037`)
- Hardened the changelog media pipeline: validated and skipped capture workflows correctly, switched to OpenAI production-grade redraws, preserved accepted proofs, accepted sparse shell media, targeted historical backfills, and updated default models. (`ee70b4b`, `dd065dd`, `0f84019`, `d55c704`, `88fd7cd`, `c68a9a7`, `3aa805a`)
- Validated the desktop updater sidecar package contract in CI and recovered desktop builds when node_modules is missing tsc/vite binaries. (`63d4c89`, `5c51e33`)
- Forwarded org avatar URL patches to network metadata and surfaced storage and metadata failures from refactored process and terminal handlers. (`1c60612`, `414467d`)

## Highlights

- Dev loop survives provider 5xx, stuck pushes, and tool-call retries instead of failing tasks
- Harness becomes the single runtime; legacy agent tool dispatcher and external CLI adapters removed
- Desktop shell redesigned around floating glass capsules with rounded corners and macOS edit shortcuts
- Concurrent chat, automation, and ad-hoc runs now isolate per agent instance and project
- Browser, chat, and run pane reliability fixes for stream drops, refresh state, and stale rows

