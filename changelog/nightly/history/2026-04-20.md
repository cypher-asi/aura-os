# Agent permissions healed, sidekick gets sharper, tasks fail loudly

- Date: `2026-04-20`
- Channel: `nightly`
- Version: `0.1.0-nightly.319.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.319.1

A dense nightly centered on making agent capabilities actually stick, tightening the sidekick's spec/task lifecycle, and hardening how long-running tasks report failure. Desktop gained a real in-app upgrade control, Notes picked up a dedicated table-of-contents panel, and release infrastructure got quieter on Android, Linux sidecar builds, and nightly reruns.

## 9:29 PM — Agent capabilities that finally stick across saves and restarts

A day-long thread of fixes unifies tool permissions behind a single capability-aware registry and ensures UI toggles actually take effect for CEO and regular agents alike.

- Collapsed the old tier-1/tier-2 + CEO short-circuit logic into one capability-aware tool registry, with every tool declaring a Surface and new ReadAllProjects/WriteAllProjects wildcards routing CEO and non-CEO sessions through the same filter — restoring list_agents, send_to_agent, and list_agent_instances in live CEO sessions. (`2a7ac33`)
- Capability toggles now apply without a server restart: update_agent invalidates every session owned by the agent (direct and project-instance), reads fresh parent caps per chat turn, and guards against aura-network PUT/GET responses that drop the permissions column from wiping the user's saved toggles. (`76b34a6`, `9f9784b`, `5c5c565`)
- Replaced the Permissions tab's Save/Discard bar with autosave (~350ms debounce), an inline Saving/Saved/Save-failed pill with Retry, and a flush-on-unmount so pending edits can't be dropped when switching agents. (`7f67bdf`)
- Renaming the CEO SuperAgent or editing its system prompt no longer strips its preset: update_agent reconciles permissions with the local shadow, save_agent_shadow refuses to overwrite a non-empty bundle with an empty one, and the canonical CEO agent_id is stamped at setup for last-resort identity repair. (`2dabef6`)
- Deleting a user-authored skill is now blocked with a 409 and an inline blocker list in the confirm modal while any other local agent still has it installed, and the catalog proxy hides skills whose SKILL.md is gone so stale entries stop reappearing under Available. (`73b0ecb`)
- Cold-boot chat feels noticeably snappier: chat history persists to IndexedDB for instant paint on reload, per-session event reads fan out in parallel bounded by the target window, project-agent discovery is cached with a 30s TTL, and the /agents route drops its lazy import and agent-list gate. (`588bdf3`, `1e7986c`, `3cfc04d`, `6f149de`, `2b05176`)
- Desktop Settings and Team Settings now carry a shared UpdateControl that shows whether you're on the latest version and lets users check for, download, and install updates, with a server-managed fallback on the web. (`267eb96`, `6b6910c`, `d2bc9a8`, `969a9a9`, `823c16d`)
- Notes gets a dedicated Table of Contents panel with scroll-to-heading, split Created at/by rows, Tab/Shift-Tab list indent, Enter-to-exit-codeblock, and server-side note storage that follows a project's Local workspace path with one-time migration of legacy slug folders. (`bf5bddc`, `e970128`, `39b9cf8`, `183ae21`, `d505787`)
- Chat input and sidekick polish: per-agent model memory survives restarts and cold-boot races, Kimi K2.6 is selectable, context usage updates live during streaming, duplicate thinking blocks collapse into one, trailing prose stays above tool cards, and the composer regains native caret-follow with overlay send/attach buttons. (`e4ce879`, `a498597`, `1ddd779`, `8c7d948`, `73f67d2`, `4489726`, `829bdc4`, `5694c24`, `2faa19e`, `3ed5676`)
- Sidekick artifact pipeline is more honest: optimistic specs/tasks push at ToolUseStart with title-matched dedup so triplicate placeholders can't leak, deleted items drop out of the react-query layout cache so Kanban and mobile views update without a refresh, and file explorer shows a current-directory breadcrumb with gated auto-refresh. (`47b2a6c`, `729e320`, `02db7b0`, `ce8e48b`, `f275637`)
- Long-running tasks now surface real failure reasons: the server normalizes reason/error/message, persists them to execution_notes, synthesizes task_failed on stream-closed or error events, and auto-restarts the automaton once on transient infra failures with a task_retrying event between attempts. (`64af31d`)
- Killed a silent QuotaExceededError storm from mirroring IDB writes into localStorage during long spec runs, and stopped polling dead remote agents forever by unregistering on 400/404/410. (`5a76ff1`)
- CEO spec generation stops doubling output tokens: the prompt instructs the agent to pass full markdown only via markdown_contents and to emit one create_spec at a time, keeping multi-spec turns under the Anthropic proxy's per-minute output ceiling. (`4c16263`)
- Release pipelines fail louder and recover better: Android ship/build jobs preflight every required fastlane secret in one pass, packaging retries transient failures, and nightly rerun versioning gets a stabilization pass with artifact-version validation. (`2cce560`, `66ff7e7`, `6b038cb`)

## 6:52 PM — Duplicate stream events eliminated and desktop loopback self-heals

A tight cluster of reliability fixes for shared streams, desktop loopback overrides, and the updater sidecar staging path.

- Shared task and process-node streams now register WebSocket handlers exactly once via a refcounted subscription registry, and the server-side dev-loop forwarder tracks liveness so 'adopt' can reuse a live forwarder instead of spawning duplicates — eliminating the N-copies-per-event fanout in chat and sidekick timelines. (`e2befbf`)
- Desktop startup now strips stale AURA_SERVER_BASE_URL / VITE_API_URL overrides when the embedded server binds an ephemeral port, fixing the 'operation timed out' failures on send_to_agent loopback callbacks and adding a structured diagnostics line correlating bound port and resolved base URL. (`9b1a665`)
- Desktop updater now stages its sidecar outside the install tree so upgrades don't collide with the running binary layout. (`1b37b3c`)
- Run-pane items are per-item collapsibles that auto-collapse when a task transitions from active to completed or failed, and the Tasks sidekick icon now spins during automation runs with Run reordered to sit immediately after Tasks. (`d5d5710`, `b1b00ab`)
- Eval smoke CI gets hardened auth handling and retries so flaky runs stop masking real regressions. (`e1ab35f`)

## 9:01 PM — Task completion notes and changed-files are actually persisted

A small but important correctness fix for the task service.

- complete_task and fail_task now write execution_notes and files_changed back through StorageClient after the status transition, so those fields survive session end instead of being silently dropped from the in-memory Task. (`6c8edae`)

## 9:04 PM — Right-click rename for specs and tasks, plus resilient run-panel state

Inline rename lands in the sidekick, and a set of follow-ups hardens the Explorer, preview headers, and persisted run state across restarts.

- Sidekick specs and tasks can now be renamed in place via right-click: the vendored zui Explorer gains editingNodeId with Enter/Escape/blur handling, SidekickItemContextMenu shows Rename + Delete by default, and useRenameSpec plus TaskList updates apply optimistic sidekick-store and layout-cache patches with rollback on API failure. (`632d298`, `a1d94f5`)
- Run-panel tasks persisted as 'active' on last shutdown are now demoted to a new 'interrupted' terminal status on restart, replacing the forever-spinning 'Waiting for output…' with a muted icon, label, and body fallback. (`b5877f1`)
- Retried tasks no longer revert to 'failed' when navigating back to the TaskList: authoritative task_started and task_became_ready transitions now override the layout cache's terminal status, and the cache subscribes to the became-ready events. (`2150fbc`)
- Sidekick and preview header bottom borders stay visible on button hover by painting them as ::after overlays across Feed, Feedback, and the preview panel. (`5d3cf14`, `46ebba7`)

## 9:28 PM — Linux sidecar build unblocked with libdbus-1-dev

A small CI dependency fix unblocking the v0.3.9 desktop sidecar on Ubuntu runners.

- Added libdbus-1-dev to every Linux apt-get step preceding a Rust build in release-nightly, release-stable, and desktop-validate, fixing the libdbus-sys build-script panic that was blocking the aura-node sidecar for v0.3.9. (`0ae6c5c`)

## 9:29 PM — Stacked Blocks read as a single dense checklist

A small activity-timeline polish that cleans up adjacent block borders.

- Adjacent Block components now share a single 1px divider via a .block + .block selector, so stacks of sibling Blocks in the activity timeline read as a dense checklist instead of doubled borders. (`a02f6d6`)

## Highlights

- Capability toggles now autosave and survive restarts
- Desktop Settings has a first-class upgrade control
- Tasks surface real failure reasons and auto-retry transient infra blips
- Sidekick specs/tasks support inline rename and no longer duplicate
- Android, Linux sidecar, and nightly rerun pipelines fail loudly instead of silently

