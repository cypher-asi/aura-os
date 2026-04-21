# Agent permissions hardening, in-app updates, and run-panel reliability

- Date: `2026-04-20`
- Channel: `nightly`
- Version: `0.1.0-nightly.321.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.321.1

A dense nightly that tightens agent capability handling end-to-end, ships an in-app upgrade control, and works through a long thread of sidekick, chat, and task-output reliability bugs. Release plumbing also got meaningful attention across Android, Linux, and desktop updater staging.

## 9:29 PM — Unified agent capability pipeline and in-app update control

A deep rework of how agent tools and permissions flow through the system, paired with the first shipping version of the in-app upgrade UI.

- Replaced the tier-1/tier-2 + CEO short-circuit tool model with a single capability-aware registry where every tool declares a Surface, and added ReadAllProjects/WriteAllProjects wildcards so CEO and non-CEO agents share one pipeline — fixing the CEO session missing list_agents, send_to_agent, and list_agent_instances. (`2a7ac33`)
- Capability toggles now actually take effect: update_agent invalidates every session owned by the agent (direct and project-instance), instance chats re-read fresh parent permissions per turn, and a PUT response that omits permissions no longer wipes the user's saved toggles. (`76b34a6`, `9f9784b`, `5c5c565`)
- Permissions tab autosaves ~350ms after the last edit with an inline Saving/Saved/Save failed pill, replacing the old Save/Discard bar and coalescing rapid toggles into a single write. (`7f67bdf`)
- Added a new update status block under Settings > Version on desktop — check for updates, install, and see download/install/failure states — and shared the control into Team Settings > General, with a graceful 'managed by the server' fallback on the web. (`267eb96`, `6b6910c`, `d2bc9a8`, `969a9a9`, `823c16d`)
- Skill deletion now refuses with 409 when the skill is still installed on any other agent and lists the blocking agents inline, while the catalog hides entries whose SKILL.md is gone so deleted skills stop reappearing under Available. (`73b0ecb`)
- Chat history now persists to IndexedDB for instant paint on reload, per-session event reads fan out in parallel and stop early, project-agent discovery is cached with a 30s TTL, and the agents sidebar no longer starves the foreground chat's first paint with preview prefetches. (`1e7986c`, `2b05176`, `588bdf3`, `6f149de`, `3cfc04d`)

## 11:23 PM — Notes sidekick rework, per-agent model memory, and streaming polish

A long run of product work across Notes, chat streaming, the sidekick, and task failures, alongside CI hardening for Android release secrets and transient packaging flakes.

- Notes sidekick now leads with a dedicated Table of Contents panel that scrolls the editor to the clicked heading, splits Info into Created at / Created by rows, and (server-side) stores notes under a project's Local workspace path with a one-time migration from the legacy slug folder. (`bf5bddc`, `183ae21`)
- Notes editor restored list bullets, green link accent, and overlay mode toggle; Tab/Shift-Tab now indent lists mid-word and Enter exits codeblocks cleanly; Rich and Markdown modes share a single scroll container and themed tab styling. (`39b9cf8`, `e970128`, `d505787`)
- Model selection is now remembered per agent across restarts (with a cold-boot race fix so the picker never strands on the adapter default), and Kimi K2.6 joined the model list. (`e4ce879`, `a498597`, `1ddd779`)
- Chat composer regained internal scrolling at max height with send/attach floated as overlays, the scrollbar sits past the send button, duplicate thinking blocks on interleaved streams are deduped, trailing prose stays above tool cards during streaming, and the Context pill now updates live from token deltas. (`829bdc4`, `5694c24`, `2faa19e`, `73f67d2`, `4489726`, `8c7d948`)
- Sidekick artifacts now push optimistically at ToolUseStart with title updates from streaming snapshots, and three belt-and-suspenders guards keep duplicate spec/task placeholders from leaking when streams abort, arrive out of order, or re-issue the same title. (`47b2a6c`, `729e320`, `02db7b0`)
- Tasks now surface a real failure reason (persisted to execution_notes) and auto-retry once on infra-transient automaton failures, while the UI clears the streaming indicator even when TaskFailed never arrives. (`64af31d`)
- Renaming or editing the CEO SuperAgent's system prompt no longer strips its preset: update_agent reconciles permissions against the local shadow and the storage layer refuses to overwrite a non-empty bundle with an empty one. (`2dabef6`)
- Fixed QuotaExceededError spam from oversized localStorage mirrors of chat history and stopped polling 404s for unregistered remote agents; also plugged the CEO spec-tools double-ship that was blowing through the Anthropic output TPM bucket. (`5a76ff1`, `4c16263`)
- Shared project drag-reorder across Tasks, Notes, and Process via a single left-menu hook; added a Files breadcrumb with visibility-gated 3s polling refresh; retheme sent doc/long-text bubbles to sit flush on the app background; and tightened preview overlay header heights, wrapping, and border overlays. (`f275637`, `ce8e48b`, `3ed5676`, `09ad20d`, `a17483d`, `c3f97cc`, `8f424c3`, `40b94cb`)
- Deleting a spec or task now patches the project-layout cache alongside the in-memory filter so Kanban, mobile, and sidekick views update immediately without a refresh. (`02db7b0`)
- CI: the ship-android job now preflights every required fastlane secret in one pass and fails with an actionable error, and desktop/nightly/stable packaging steps retry transient failures. (`2cce560`, `66ff7e7`)

## 6:48 PM — Stable version numbering for nightly reruns

Release-infrastructure tightening so nightly rerun artifacts carry consistent versions.

- Reworked release-nightly.yml and the artifact-version validator to stabilize version numbers across reruns of the nightly pipeline. (`6b038cb`)

## 6:52 PM — Desktop loopback self-heal and live stream de-duplication

Desktop startup now heals stale control-plane URLs, duplicate timeline rows are eliminated at both ends of the stream, and the Run pane gets a collapsible per-task layout.

- Desktop now strips stale AURA_SERVER_BASE_URL/VITE_API_URL overrides that pinned the control plane to a dead port when the embedded server fell back to an ephemeral port, ending the 'operation timed out' failures on send_to_agent and loopback callbacks. (`9b1a665`)
- Duplicate timeline entries in the sidekick and chat are gone: a refcounted shared WebSocket subscription registry on the frontend and RAII-tracked forwarder liveness on the server ensure exactly one subscription and one forwarder per stream key. (`e2befbf`)
- Run items are now per-item collapsibles that auto-collapse on completion while active tasks stay expanded, and the sidekick nav puts Run immediately to the right of Tasks with a spinner on the Tasks icon during runs. (`d5d5710`, `b1b00ab`)
- Desktop updater now stages its sidecar outside the install tree, and CI hardened eval smoke auth and retry behavior. (`1b37b3c`, `e1ab35f`)

## 9:01 PM — Task completion fields now persist to storage

A small but meaningful correctness fix for task bookkeeping.

- complete_task and fail_task now PATCH execution_notes and files_changed back through StorageClient instead of only mutating the in-memory Task, so those fields survive session end. (`6c8edae`)

## 9:04 PM — Inline rename for specs/tasks and Run panel hydration fix

Right-click rename lands across the sidekick, the Run panel stops showing empty rows on reload, and Linux CI unblocks the v0.3.9 sidecar build.

- Specs and tasks can now be renamed inline from the sidekick context menu: the vendored zui Explorer gained an editable node mode, new updateSpec/updateTask API helpers, and an optimistic useRenameSpec hook with rollback on failure. (`632d298`, `a1d94f5`)
- Run panel live streaming and reload hydration are stabilized: WS subscriptions install once at app boot (no more mount-race event drops), persisted statuses are reconciled against the authoritative tasks list instead of blindly demoted to Interrupted, and task-output fetches are deduped with a negative-result cache backed by an unavailable flag from the server. (`c21f3ea`, `b5877f1`)
- Retried tasks no longer revert to Failed after navigating back: authoritative task_started and task_became_ready events now override the layout cache's terminal status. (`2150fbc`)
- Visual polish: sidekick and preview header bottom borders stay visible through button hover, the preview close X aligns with the sidekick taskbar icon above it, and adjacent Blocks collapse into a shared 1px divider. (`5d3cf14`, `46ebba7`, `a02f6d6`)
- Linux CI now installs libdbus-1-dev before every Rust build step across nightly, stable, and desktop-validate, unblocking the aura-node sidecar build for v0.3.9; release workflow names and mobile distribution paths were also clarified. (`0ae6c5c`, `fd6b0c5`)

## Highlights

- Capability toggles now take effect immediately and survive restarts
- New in-app update control in Settings and Team Settings
- Run panel and task streams stop dropping live output and stale rows
- Notes, chat input, and sidekick UI got a round of polish
- CI hardened for Android secrets, Linux dbus deps, and nightly reruns

