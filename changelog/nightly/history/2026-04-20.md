# Agent capabilities stick, sidekick gets sharper, and desktop self-heals

- Date: `2026-04-20`
- Channel: `nightly`
- Version: `0.1.0-nightly.320.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.320.1

A dense nightly: the agent permissions system was rebuilt end-to-end so capability toggles finally stay toggled, the sidekick gained inline rename and much tighter spec/task placeholder handling, Notes picked up a real Table of Contents and workspace-aware storage, and the desktop app learned to recover from stale loopback state. Release tooling also got a round of hardening across Android, Linux sidecar builds, and nightly re-runs.

## 9:29 PM — Agent permissions, chat polish, and the in-app updater

A sweeping evening pass rebuilt how agents see their own capabilities, smoothed out the chat and sidekick experience, and added a first-class upgrade control inside Settings.

- Rebuilt the agent tool system around a single capability-aware registry: every tool now declares a Surface, CEO and non-CEO agents flow through the same permission pipeline, and missing tools like list_agents, send_to_agent, and list_agent_instances are back in CEO sessions. Toggling capabilities now invalidates live sessions and the dispatcher cache so changes take effect on the next turn without a restart. (`2a7ac33`, `76b34a6`, `9f9784b`)
- Fixed the long-standing 'capabilities revert after save or restart' bug: the GET path now reconciles permissions against the local shadow when aura-network drops the column, shadow writes refuse to overwrite a non-empty bundle with an empty one, and renaming the CEO SuperAgent no longer strips its preset. The Permissions tab also switched to autosave with an inline status pill replacing the Save/Discard bar. (`5c5c565`, `7f67bdf`, `2dabef6`)
- Added an in-app update control beneath the Settings Version row and in Team Settings > General, letting desktop users check for, download, and install updates with clear progress and failure states; the web build shows a 'managed by the server' fallback. (`267eb96`, `6b6910c`, `d2bc9a8`, `969a9a9`, `823c16d`)
- Reworked the Skills delete flow so a skill still installed on another agent is refused with a 409 and an inline blocker list, and stale catalog entries whose SKILL.md has been removed no longer reappear under Available. (`73b0ecb`)
- Made chat cold-boot noticeably faster: history fetches now fan out per session with a bounded window, project-agent discovery is cached with a short TTL, the agents sidebar preview defers and deprioritizes on cold boot, the /agents route no longer double-waterfalls on a lazy chunk plus list fetch, and chat history hydrates instantly from IndexedDB on reload. (`1e7986c`, `3cfc04d`, `2b05176`, `588bdf3`, `6f149de`)
- Notes picked up a dedicated Table of Contents panel with click-to-scroll, split Created at / Created by rows, Tab/Shift-Tab list indent mid-word, Enter-out-of-codeblock behavior, and server-side storage that follows a project's local workspace path (with a one-time migration from the legacy slug folder). (`bf5bddc`, `e970128`, `39b9cf8`, `183ae21`, `d505787`)
- Chat streaming is cleaner and more trustworthy: context usage updates live during streaming, interleaved thinking deltas collapse into one block, trailing prose stays above tool cards while streaming, the model picker remembers the last model per agent (surviving cold-boot races), and Kimi K2.6 was added to the model list. (`8c7d948`, `73f67d2`, `4489726`, `e4ce879`, `a498597`, `1ddd779`)
- Hardened sidekick artifacts end-to-end: optimistic spec/task placeholders now fire at ToolUseStart, dedupe by title, clean up on stream abort/error/done, and deletes immediately remove items from every view by patching the project-layout cache. Run items are collapsible with auto-collapse on completion, and the Tasks icon spins during automation runs. (`47b2a6c`, `729e320`, `02db7b0`, `e2befbf`, `d5d5710`, `b1b00ab`)
- Task runs are more honest about failure: the server normalizes failure reasons into execution_notes, synthesizes a proper task_failed when the stream closes without a terminal event, and auto-retries once on infra-transient failures with a task_retrying event; the UI clears the streaming indicator defensively and surfaces the reason. (`64af31d`)
- Desktop now self-heals stale AURA_SERVER_BASE_URL / VITE_API_URL overrides on startup when the embedded server falls back to an ephemeral port, unblocking send_to_agent and other loopback calls that previously timed out on a closed port. (`9b1a665`)
- Stopped QuotaExceededError spam from long spec runs by making IndexedDB authoritative for chat history (no more localStorage write-through), and unregistered dead remote agents after 400/404/410 so the console no longer fills with repeating 404s. (`5a76ff1`)
- Reduced spec-generation rate-limit failures by instructing CEO to pass full markdown only via markdown_contents (not duplicated as visible text) and to emit one create_spec call at a time for multi-spec turns. (`4c16263`)
- Small but visible polish: chat input scrolls internally at max height with floating attach/send buttons, sent doc/long-text widgets drop the bubble chrome, preview panels wrap code and tables instead of side-scrolling, the files sidekick shows a path breadcrumb with 3s visibility-gated refresh, and project drag-reorder is now shared across Tasks, Notes, and Process. (`829bdc4`, `2faa19e`, `5694c24`, `3ed5676`, `09ad20d`, `c3f97cc`, `a17483d`, `ce8e48b`, `f275637`, `8f424c3`, `40b94cb`)
- Release pipeline got more resilient: Android ship jobs now preflight every required fastlane secret in one pass, transient packaging steps retry on both nightly and stable desktop builds, and nightly re-runs use stabilized artifact versioning. Eval smoke CI auth and retries were also hardened. (`2cce560`, `66ff7e7`, `6b038cb`, `e1ab35f`)

## 9:01 PM — Task execution notes and file changes now persist

A small but meaningful fix so task metadata actually survives session end.

- complete_task and fail_task now PATCH execution_notes and files_changed through StorageClient after the status transition, so failure reasons and changed-file lists are no longer silently dropped when a session ends. (`6c8edae`)

## 9:04 PM — Inline rename for specs and tasks, plus Run-panel recovery

Right-click rename landed across the sidekick, with a handful of related fixes that make the Run panel and task retries behave correctly after reloads.

- Specs and tasks can now be renamed in place from the sidekick context menu: the vendored zui Explorer gained an editing mode with auto-selected input and Enter/Escape/blur semantics, and PUT helpers plus a useRenameSpec hook provide optimistic updates with rollback on failure. (`632d298`, `a1d94f5`)
- The Run panel no longer gets stuck after a restart: persisted active tasks are demoted to a new 'interrupted' terminal status on load, with a matching muted icon and label so the 'Waiting for output…' indicator doesn't spin forever. (`b5877f1`)
- Retried tasks correctly return to in_progress after navigating away and back: authoritative task_started / task_became_ready events now override terminal cached status, and the project layout subscribes to the ready transitions. (`2150fbc`)
- Kept sidekick and preview header bottom borders visible on button hover by painting them as absolutely positioned ::after overlays, and aligned the preview close X flush with the taskbar icon above. (`5d3cf14`, `46ebba7`)

## 9:28 PM — Linux sidecar build unblocked for v0.3.9

Release infrastructure fix to get the aura-node desktop sidecar building again on Linux runners.

- Added libdbus-1-dev to every Linux apt-get step that precedes a Rust build in release-nightly, release-stable, and desktop-validate workflows so the aura-node sidecar's keyring dependency can find dbus-1.pc, unblocking the v0.3.9 release. (`0ae6c5c`)

## 9:29 PM — Single 1px divider between stacked Blocks

A small visual fix that makes stacks of sibling Blocks read as a single dense checklist.

- Moved the -1px overlap from the ActivityTimeline wrapper into the Block component itself via a .block + .block selector, so adjacent Blocks share one 1px divider instead of doubled borders. (`a02f6d6`)

## 9:55 PM — Clearer release workflow names and mobile paths

Documentation and naming cleanup across release workflows.

- Renamed release workflows for clarity and updated mobile distribution paths and docs across Android, iOS, nightly, stable, desktop-validate, eval, and changelog publish pipelines. (`fd6b0c5`)

## Highlights

- Capability toggles now persist across saves, restarts, and renames
- Inline rename and robust placeholder dedupe in the sidekick
- Notes gains a real TOC panel and follows the project workspace
- Desktop self-heals stale loopback control-plane overrides
- Nightly release pipeline hardened for Android, Linux sidecar, and reruns

