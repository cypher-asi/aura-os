# Debug app, durable run output, and a new screenshot pipeline

- Date: `2026-04-21`
- Channel: `nightly`
- Version: `0.1.0-nightly.331.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.331.1

Today's nightly centers on making Aura's automation runs legible and durable: a brand-new Debug app with on-disk run bundles and a companion CLI, plus aggressive caching so task and process output survives reloads. Alongside, the release pipeline gained a screenshot-first changelog media workflow that went through a long evening of hardening, and macOS DMG packaging got sturdier retries.

## 10:52 PM — Run panel output survives reloads and stream pruning

The Run panel and sidekick task overlay now keep completed task output visible even after memory pruning or a full page reload, and a small sidekick layout fix keeps compound stat values on a single line.

<!-- AURA_CHANGELOG_MEDIA:BEGIN {"slotId":"entry-run-panel-output-survives-reloads-and-stream-pruning","slug":"run-panel-output-survives-reloads-and-stream-pruning","alt":"Run panel output survives reloads and stream pruning screenshot"} -->
<!-- AURA_CHANGELOG_MEDIA:PENDING -->
<!-- AURA_CHANGELOG_MEDIA:END entry-run-panel-output-survives-reloads-and-stream-pruning -->

- Expanding a completed task now always shows its full timeline, tool cards, and thinking steps — a new localStorage task-turn-cache snapshots structured events on task completion, and a unified useTaskOutputView hook walks live stream, cache, event store, and server hydration in order so rehydration after a reload or TTL prune no longer renders an empty body. (`657ef48`)
- Sidekick StatCard values like "13m 53s" no longer wrap in the narrow column: the value shrinks slightly and uses nowrap, while the mobile variant keeps its larger size. (`b2f4907`)

## 11:18 PM — Vendored chromiumoxide fork to trace CDP serde drift

The browser backend's continuous "WS Invalid message" warning flood is now diagnosable: chromiumoxide 0.9.1 is vendored and patched so the failing CDP payload is logged alongside the serde error.

- Forked chromiumoxide v0.9.1 under vendor/ and pinned the workspace at it via [patch.crates-io], with a single local edit that attaches the raw JSON payload to the WARN tracing field so each failing CDP method can be identified and patched in follow-ups. No application-side changes to aura-os-browser. (`81728bf`)

## 11:42 PM — Live loop status and sidekick state rehydrate cleanly on refresh

A cluster of fixes makes the automation loop and sidekick feel continuous across refreshes: spinners and live badges hydrate from HTTP instead of waiting on replayed WebSocket events, the Active stat card reacts in real time, and the last-used sidekick tab is remembered.

<!-- AURA_CHANGELOG_MEDIA:BEGIN {"slotId":"entry-live-loop-status-and-sidekick-state-rehydrate-cleanly-on-refresh","slug":"live-loop-status-and-sidekick-state-rehydrate-cleanly-on-refresh","alt":"Live loop status and sidekick state rehydrate cleanly on refresh screenshot"} -->
<!-- AURA_CHANGELOG_MEDIA:PENDING -->
<!-- AURA_CHANGELOG_MEDIA:END entry-live-loop-status-and-sidekick-state-rehydrate-cleanly-on-refresh -->

- After a reload, the Run panel, Tasks-tree live badge, and left-nav agent spinner now all light up immediately — /loop/status, /loop/start, /loop/pause, /loop/stop, and /loop/resume surface the currently-streaming task id, and the UI hydrates task-output, live-task-ids, and loop-status stores from that instead of relying on one-shot task_started events. (`c16c726`)
- The Active stat card is now tinted success-green and updates live from TaskStarted/Completed/Failed events scoped to the current project, with an optimistic adjustment plus debounced refetch so the stats grid tracks the automation loop instead of waiting for a chat stream to end. (`9408bf2`)
- Each sidekick (main, agents, process) now remembers its last-active tab in localStorage, so the app stops snapping back to terminal/profile/process after a refresh. (`8ec8861`)
- Removed the legacy bottom TaskOutputPanel surface and its persisted panelHeight/collapsed/activeTab state now that the Sidekick drawer fully replaces it, with a one-shot cleanup of the old localStorage key. (`c351ca8`)

## 12:28 AM — Debug app, on-disk run bundles, and the aura-run-analyze CLI

Every dev-loop run is now captured to disk and inspectable from both a new in-app Debug surface and a standalone CLI, with heuristics that can gate CI. Process runs also gain the same reload-durable live output treatment as tasks, and Run-button spinners stay engaged through the HTTP-to-WebSocket handoff.

<!-- AURA_CHANGELOG_MEDIA:BEGIN {"slotId":"entry-debug-app-on-disk-run-bundles-and-the-aura-run-analyze-cli","slug":"debug-app-on-disk-run-bundles-and-the-aura-run-analyze-cli","alt":"Debug app, on-disk run bundles, and the aura-run-analyze CLI screenshot"} -->
<!-- AURA_CHANGELOG_MEDIA:PENDING -->
<!-- AURA_CHANGELOG_MEDIA:END entry-debug-app-on-disk-run-bundles-and-the-aura-run-analyze-cli -->

- Introduced a Debug app (Bug icon, after Integrations) backed by LoopLogWriter, which always writes metadata, events, LLM calls, iterations, blockers, and retries for every dev-loop run. A new /api/debug/* surface exposes projects, runs, per-channel logs, and a .zip export; the UI offers a project/run nav, virtualized timeline, channel/type/text filters, a JSON inspector, and copy/export. (`c18bc88`)
- Runs are now associated with the specs their tasks touched, the Debug nav groups Project → Spec → Runs with a clearable filter chip, and a new aura-run-analyze CLI (--latest/--run/--list, markdown and json output) runs seven heuristics — repeated blocker paths, high retry density, slow iterations, token-hog LLM calls, unbalanced I/O, tasks that never complete, and zero-tool-call turns — exiting non-zero so CI can gate on findings. The on-disk schema moved into a shared aura-loop-log-schema crate. (`ccea501`)
- The Process Run preview's Live Output panel now survives reloads and WS reconnects: a process-node-turn-cache in localStorage plus a process-stream-bootstrap snapshot events on node/run completion, and the focused node rehydrates to the correct run — the panel is retitled "Recent Live Output" when the run is no longer actively streaming. (`3156ede`)
- Clicking Run (including re-runs) now keeps the Run button and sidekick Run/Tasks spinners engaged continuously from click through the first task_started event, hydrating the Run panel and live-task-ids from the active_tasks already returned by /loop/start and /loop/resume instead of flickering idle during the HTTP→WS handoff. (`9270310`)
- Cargo output is now plain and line-buffered workspace-wide ([term] color=never, progress=never), so agent/CI transports that base64-wrap streams no longer mangle compiler diagnostics with ANSI and CR progress bars; humans can still opt in with --color=always. (`de66693`)

## 4:31 PM — Automated screenshot media for release changelogs

A new changelog media pipeline lands: release-day screenshots are captured via Browserbase (with a local Playwright fallback), wired into a dedicated GitHub workflow, and a manual reconcile rerun is available for backfilling slots.

<!-- AURA_CHANGELOG_MEDIA:BEGIN {"slotId":"entry-automated-screenshot-media-for-release-changelogs","slug":"automated-screenshot-media-for-release-changelogs","alt":"Automated screenshot media for release changelogs screenshot"} -->
<!-- AURA_CHANGELOG_MEDIA:PENDING -->
<!-- AURA_CHANGELOG_MEDIA:END entry-automated-screenshot-media-for-release-changelogs -->

- Shipped a screenshot-first changelog media system with a new Publish Release Changelog Media workflow, a publish-changelog-media.mjs orchestrator, demo-agent brief/seed/catalog libraries, and an in-app capture/screenshot bridge — wired through the existing daily changelog generator and documented in docs/demo-screenshot-pipeline.md. (`3b93c76`)
- Added a Reconcile Release Changelog workflow with optional release_run_id, channel, preview URL, profile, and refresh_existing inputs so already-published media can be regenerated or missing slots backfilled after the fact. (`839f657`)
- Tightened the media workflow's triggers and preview-handling behavior so downstream runs line up with the parent Publish Release Changelog workflow and preview-capture failures surface cleaner summaries. (`9159a19`, `93dad69`)

## 7:56 PM — Changelog media preflights, Browserbase fallback, and macOS DMG retries

Follow-up reliability work on the new screenshot pipeline plus a CI fix for macOS packaging: preflights are stricter, Browserbase quota exhaustion now falls back gracefully, and DMG retries are more resilient.

<!-- AURA_CHANGELOG_MEDIA:BEGIN {"slotId":"entry-changelog-media-preflights-browserbase-fallback-and-macos-dmg-re","slug":"changelog-media-preflights-browserbase-fallback-and-macos-dmg-re","alt":"Changelog media preflights, Browserbase fallback, and macOS DMG retries screenshot"} -->
<!-- AURA_CHANGELOG_MEDIA:PENDING -->
<!-- AURA_CHANGELOG_MEDIA:END entry-changelog-media-preflights-browserbase-fallback-and-macos-dmg-re -->

- Changelog pipelines now accept a preview URL sourced from a repo secret and share hardened preflights across the publish, media, and reconcile workflows, reducing misconfiguration failures before any screenshot work starts. (`9e52bb8`, `dc19892`)
- When Browserbase concurrency/quota is exhausted, the media publisher now falls back cleanly instead of failing the run, and capture inference plus diagnostics were hardened — each run uploads a diagnostics artifact and appends a capture summary to the GitHub Actions step summary. (`8cbc480`, `dce4226`)
- macOS DMG packaging in the nightly and stable release workflows got more resilient retries, backed by a cleanup-stale-macos-dmg helper and tests so transient hdiutil flakes no longer fail a release. (`4818db0`)

## Highlights

- New Debug app with per-run on-disk bundles and a run-analyze CLI
- Task and process Run output now survives reloads and WS reconnects
- Automated screenshot media pipeline for release changelogs
- macOS DMG packaging retries hardened in CI

