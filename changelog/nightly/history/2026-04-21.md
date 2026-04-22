# Debug app, durable run output, and automated changelog media

- Date: `2026-04-21`
- Channel: `nightly`
- Version: `0.1.0-nightly.326.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.326.1

Today's nightly centers on making dev-loop runs inspectable end-to-end: task and process output now survives reloads, a new Debug app and run-analyze CLI expose every run on disk, and the release pipeline gains an automated screenshot media job with a manual reconcile path. A handful of sidekick polish fixes and a vendored chromiumoxide fork round out the day.

## 10:52 PM — Run panel output survives reloads and TTL pruning

Completed task rows no longer render empty after the in-memory stream is pruned or the page is reloaded, and a narrow sidekick stat gets a layout fix.

<!-- AURA_CHANGELOG_MEDIA:BEGIN {"slotId":"entry-run-panel-output-survives-reloads-and-ttl-pruning","slug":"run-panel-output-survives-reloads-and-ttl-pruning","alt":"Run panel output survives reloads and TTL pruning screenshot"} -->
<!-- AURA_CHANGELOG_MEDIA:PENDING -->
<!-- AURA_CHANGELOG_MEDIA:END entry-run-panel-output-survives-reloads-and-ttl-pruning -->

- Structured task output — timeline, tool cards, and thinking steps — is now persisted to a localStorage turn-cache on TaskCompleted/TaskFailed and loop-end, with a unified useTaskOutputView hook that walks live stream, cache, event store, and server hydration in order so expanding a completed task always shows its body. (`657ef48`)
- Sidekick StatCard values shrink from 18px to 15px with nowrap so compound readouts like "13m 53s" stay on a single line in the narrow column, while the mobile variant keeps its larger size. (`b2f4907`)

## 11:18 PM — Vendored chromiumoxide fork to diagnose CDP WS warnings

The browser backend's constant "WS Invalid message" warning stream now carries the raw payload so schema drift can actually be tracked down.

- Forked chromiumoxide 0.9.1 under vendor/chromiumoxide and pinned it via [patch.crates-io], with a single local edit that attaches the offending JSON payload to the WARN log so each failing CDP method can be identified and patched upstream. No application code changes; aura-os-browser builds unchanged. (`81728bf`)

## 11:42 PM — Live run state rehydrates after refresh

Spinners, live badges, and sidekick tabs now reflect the real loop state after a reload instead of depending on one-shot WebSocket events.

<!-- AURA_CHANGELOG_MEDIA:BEGIN {"slotId":"entry-live-run-state-rehydrates-after-refresh","slug":"live-run-state-rehydrates-after-refresh","alt":"Live run state rehydrates after refresh screenshot"} -->
<!-- AURA_CHANGELOG_MEDIA:PENDING -->
<!-- AURA_CHANGELOG_MEDIA:END entry-live-run-state-rehydrates-after-refresh -->

- /loop/status, /loop/start, /loop/pause, /loop/stop, and /loop/resume now expose active_tasks with task and agent ids, and the UI seeds the Run panel, Tasks-tree "live" dots, and sidebar agent indicator from that response — so a refresh no longer leaves the top spinner spinning over a dark Run panel. (`c16c726`)
- Sidekick tab selection (main, agents, process) is persisted per-surface to localStorage so the app stops snapping back to terminal/profile/process after reload. (`8ec8861`)
- The Active stat card adopts the app's standard success green and now updates live from TaskStarted/TaskCompleted/TaskFailed with optimistic adjustments and a debounced refetch, tracking the automation loop instead of waiting for a chat stream to end. (`9408bf2`)
- Retired the obsolete bottom TaskOutputPanel surface along with its resize/collapse/tab state and the aura-task-output-panel localStorage key, now fully superseded by the sidekick's Run and Terminal panes. (`c351ca8`)

## 12:28 AM — Debug app, on-disk run bundles, and aura-run-analyze CLI

Every dev-loop run is now captured to disk and browsable from a new Debug app, with a Rust CLI and seven heuristic rules for post-hoc analysis.

<!-- AURA_CHANGELOG_MEDIA:BEGIN {"slotId":"entry-debug-app-on-disk-run-bundles-and-aura-run-analyze-cli","slug":"debug-app-on-disk-run-bundles-and-aura-run-analyze-cli","alt":"Debug app, on-disk run bundles, and aura-run-analyze CLI screenshot"} -->
<!-- AURA_CHANGELOG_MEDIA:PENDING -->
<!-- AURA_CHANGELOG_MEDIA:END entry-debug-app-on-disk-run-bundles-and-aura-run-analyze-cli -->

- LoopLogWriter persists every dev-loop run as a structured bundle (metadata.json, events/llm_calls/iterations/blockers/retries jsonl, summary.md) and a new /api/debug/* surface serves projects, runs, metadata, per-channel logs, and a zip export — capture is always on, with AURA_LOOP_LOGS_DIR to redirect the path. (`c18bc88`)
- A new Debug app (Bug icon, after Integrations) ships a project/spec/run nav, run list view, and a run detail view with a virtualized timeline, channel/type/text filters, JSON inspector, copy, and zip export for inspecting LLM retries, blockers, and iteration cost. (`c18bc88`, `ccea501`)
- New aura-run-analyze CLI (--latest / --run / --list, markdown or json) plus an aura-run-heuristics crate implementing seven rules — repeated_blocker_path, high_retry_density, slow_iteration, token_hog_llm_call, unbalanced_io, task_never_completed, zero_tool_calls_in_turn — with exit codes 1/2 for warnings/errors so CI can gate on them. Runs are also tagged with the specs their tasks touched, filterable via ?spec_id=. (`ccea501`)
- Process runs now get the same cache-then-stream treatment as tasks: a per-app process-node-turn-cache and bootstrap keep the "Live Output" panel populated across reloads and WS reconnects, with the panel retitled "Recent Live Output" once a run is no longer streaming. (`3156ede`)
- Run button and sidekick Run/Tasks spinners now stay engaged from click through the first task_started event, with a shared live-task-ids store hydrated from /loop/start and /loop/resume so the first (or interrupted) task of a re-run no longer looks idle during the HTTP→WS handoff. Cargo is also configured to emit plain, line-buffered output workspace-wide so agent/CI transports get legible compiler diagnostics. (`9270310`, `de66693`)

## 4:31 PM — Automated release screenshot media and manual reconcile

The release changelog pipeline gains a dedicated media-publishing workflow, a Browserbase-backed screenshot capture path, and an on-demand reconcile job to backfill or refresh published media.

<!-- AURA_CHANGELOG_MEDIA:BEGIN {"slotId":"entry-automated-release-screenshot-media-and-manual-reconcile","slug":"automated-release-screenshot-media-and-manual-reconcile","alt":"Automated release screenshot media and manual reconcile screenshot"} -->
<!-- AURA_CHANGELOG_MEDIA:PENDING -->
<!-- AURA_CHANGELOG_MEDIA:END entry-automated-release-screenshot-media-and-manual-reconcile -->

- New Publish Release Changelog Media workflow runs after the changelog publish, driving a demo screenshot pipeline (Browserbase by default, Playwright fallback) with a capture-bridge and seeded demo sessions, producing per-release media alongside the generated changelog. (`3b93c76`)
- A new Reconcile Release Changelog workflow lets operators rerun media capture for a specific release run id or channel, optionally refreshing already-published media instead of only backfilling missing or failed slots. (`839f657`)
- Follow-up fixes realigned the changelog workflow triggers and hardened media preview handling across the publish scripts and capture entrypoints to stabilize the new pipeline. (`9159a19`, `93dad69`)

## Highlights

- Completed tasks keep their timeline, tool cards, and thinking across reloads
- New Debug app plus aura-run-analyze CLI for every dev-loop run
- Sidekick tabs and live run state now rehydrate after refresh
- Release changelog media capture and manual reconcile workflows shipped

